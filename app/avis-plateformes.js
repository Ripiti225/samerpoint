// ──────────────────────────────────────────────────────────────────────────────
//  AVIS CLIENTS — Yango & Glovo
//
//  Consolide les notes et avis extraits chaque jour des portails Yango
//  (étoiles 1-5) et Glovo (pouce 👍/👎) par l'Edge Function `ingest-reviews`.
//  Les avis négatifs sont AUSSI créés comme litiges (litiges_avis_clients,
//  type « mauvais ») : on les voit ici en détail, et dans l'écran Litiges pour
//  leur incidence financière.
//
//  Onglet « À rattacher » : 9 boutiques Glovo et 17 restaurants Yango pour
//  7 restaurants SamerTrackly. Tant qu'une boutique n'est pas rattachée, ses
//  avis n'entrent dans aucun total — c'est la file de travail à vider.
// ──────────────────────────────────────────────────────────────────────────────
import { retour } from '../lib/navigation'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { supabase } from '../lib/supabase'
import { journaliser } from '../lib/journal'
import {
  CLASSIFICATIONS, PLATEFORMES, boutiquesARattacher, classifierAvis,
  kpisParPlateforme, kpisParRestaurant, noteSur5, plateforme,
  plateformesEnRetard, texteRetard,
} from '../lib/avisPlateformes'
import {
  chargerAvis, chargerAvisNonRattaches, chargerLitigesDesAvis, chargerShifts, dernierAvisRecu, dernierRun, rattacherBoutique,
} from '../lib/avisPlateformesDb'
import ResumeAvis from '../components/avis/ResumeAvis'
import { ChampDates, EnTete, Puces, useEcranModerne } from '../components/ui/EcranModerne'
import {
  PERIODES_AVIS, caissierDeLAvis, classementCaissiers, periodePrecedente, plagePeriode, resumeChiffres, topMotifs,
} from '../lib/avisResume'
import { useFocusRecherche } from '../lib/useFocusRecherche'

// Au-delà, on n'affiche pas tout d'un coup : un mois d'avis sur 7 restaurants
// fige la page sur un iPhone.
const PAR_PAGE = 60

function fmtDate(d) {
  if (!d) return '—'
  const [a, m, j] = d.split('-')
  return `${j}/${m}/${a.slice(2)}`
}

function etoiles(note) {
  if (note == null) return null
  const pleines = Math.round(note)
  return '★'.repeat(pleines) + '☆'.repeat(Math.max(0, 5 - pleines))
}

export default function AvisPlateformes() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { userId, userNom, roleActif } = useApp()

  // Ouvert depuis la recherche globale : avis du jour cherché, encadré.
  const params = useLocalSearchParams()
  const dateRecherche = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null
  const focus = useFocusRecherche(params.focus)
  const [onglet, setOnglet] = useState(params.focus ? 'avis' : 'resume')        // 'resume' | 'avis' | 'rattacher'
  const [periodeKey, setPeriodeKey] = useState(dateRecherche ? 'perso' : 'mois')
  const [perso, setPerso] = useState({ debut: dateRecherche, fin: dateRecherche })
  const [champDate, setChampDate] = useState(null)
  const [avisPrec, setAvisPrec] = useState([])
  const [litiges, setLitiges] = useState([])
  const [litigesPrec, setLitigesPrec] = useState([])
  const [shifts, setShifts] = useState([])
  const em = useEcranModerne('orange')
  const [restoFilter, setRestoFilter] = useState(typeof params.restaurant_id === 'string' ? params.restaurant_id : null)
  const [platformFilter, setPlatformFilter] = useState(null)
  const [classFilter, setClassFilter] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  const [restaurants, setRestaurants] = useState([])
  const [avis, setAvis] = useState([])
  const [orphelins, setOrphelins] = useState([])
  const [run, setRun] = useState(null)
  const [retards, setRetards] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [visible, setVisible] = useState(PAR_PAGE)

  // Boutique en cours de rattachement : { platform, label }
  const [aRattacher, setARattacher] = useState(null)

  const aujourdhui = new Date().toISOString().slice(0, 10)
  const plage = plagePeriode(periodeKey, aujourdhui, perso)

  useEffect(() => {
    supabase.from('restaurants').select('id, nom').order('nom')
      .then(({ data }) => setRestaurants(data || []))
  }, [])

  useEffect(() => { charger() }, [periodeKey, perso.debut, perso.fin, restoFilter, platformFilter, classFilter])

  async function charger() {
    setLoading(true)
    setErreur(null)
    try {
      if (!plage) { setLoading(false); return }   // dates au choix incomplètes
      const prec = periodePrecedente(plage)
      const filtres = { restaurantId: restoFilter, platform: platformFilter, classification: classFilter }
      const [lignes, lignesPrec, sansResto, dernier, derniersEnvois, sh] = await Promise.all([
        chargerAvis({ debut: plage.debut, fin: plage.fin, ...filtres }),
        chargerAvis({ debut: prec.debut, fin: prec.fin, ...filtres }),
        chargerAvisNonRattaches(),
        dernierRun().catch(() => null),
        dernierAvisRecu().catch(() => null),
        chargerShifts({ restaurantId: restoFilter, debut: plage.debut, fin: plage.fin }).catch(() => []),
      ])
      const [lit, litPrec] = await Promise.all([
        chargerLitigesDesAvis(lignes.map(a => a.id)).catch(() => []),
        chargerLitigesDesAvis(lignesPrec.map(a => a.id)).catch(() => []),
      ])
      setAvis(lignes)
      setAvisPrec(lignesPrec)
      setLitiges(lit)
      setLitigesPrec(litPrec)
      setShifts(sh)
      setOrphelins(sansResto)
      setRun(dernier)
      setRetards(derniersEnvois ? plateformesEnRetard(derniersEnvois) : [])
      setVisible(PAR_PAGE)
    } catch (e) {
      // Message en français : la cause la plus probable est que la migration
      // supabase_avis_plateformes.sql n'a pas encore été exécutée.
      const msg = String(e?.message || e)
      setErreur(/relation|does not exist|schema cache/i.test(msg)
        ? "Les tables des avis n'existent pas encore. Exécutez supabase_avis_plateformes.sql dans Supabase."
        : "Impossible de charger les avis pour le moment.")
      setAvis([])
    }
    setLoading(false)
  }

  async function onRefresh() {
    setRefreshing(true)
    await charger()
    setRefreshing(false)
  }

  const nomsParId = useMemo(() => {
    const m = {}
    for (const r of restaurants) m[r.id] = r.nom
    return m
  }, [restaurants])

  const parPlateforme = useMemo(() => kpisParPlateforme(avis), [avis])
  const parResto = useMemo(() => kpisParRestaurant(avis, nomsParId), [avis, nomsParId])
  const boutiques = useMemo(() => boutiquesARattacher(orphelins), [orphelins])
  const caissierPar = useMemo(() => {
    const litigeParReview = Object.fromEntries(litiges.map(l => [l.review_id, l]))
    return Object.fromEntries(avis.map(a => [a.id, caissierDeLAvis(a, { shifts, litigeParReview })]))
  }, [avis, litiges, shifts])
  const chiffres = useMemo(() => resumeChiffres(avis, litiges), [avis, litiges])
  const chiffresPrec = useMemo(() => resumeChiffres(avisPrec, litigesPrec), [avisPrec, litigesPrec])
  const caissiers = useMemo(() => classementCaissiers(avis, caissierPar), [avis, caissierPar])
  const motifs = useMemo(() => topMotifs(avis), [avis])

  async function confirmerRattachement(restaurant) {
    const { platform, label } = aRattacher
    setARattacher(null)
    try {
      const nb = await rattacherBoutique({ platform, label, restaurantId: restaurant.id })
      journaliser('avis_boutique_rattachee', { platform, label, restaurant: restaurant.nom, avis: nb },
        { restaurantId: restaurant.id, userId, userNom }).catch(() => {})
      Alert.alert('Boutique rattachée',
        `${label} → ${restaurant.nom}\n${nb} avis rattaché${nb > 1 ? 's' : ''}. Les avis négatifs deviennent des litiges.`)
      await charger()
    } catch (_e) {
      Alert.alert('Rattachement impossible', "L'enregistrement n'a pas pu être fait. Réessayez dans un instant.")
    }
  }

  const restoNom = restoFilter
    ? (nomsParId[restoFilter] || 'Restaurant')
    : 'Tous les restaurants'

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="⭐ Avis clients" sous="Yango & Glovo" onRetour={() => retour()} styles={em.styles} />

      <View style={styles.hautFixe}>
        <Puces ligne elements={PERIODES_AVIS} actif={periodeKey} onChoisir={setPeriodeKey} styles={em.styles} />
        {periodeKey === 'perso' ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
            <ChampDates debut={perso.debut} fin={perso.fin}
              setDebut={d => setPerso(p => ({ ...p, debut: d }))} setFin={d => setPerso(p => ({ ...p, fin: d }))}
              champ={champDate} setChamp={setChampDate} styles={em.styles} colors={em.colors} accent={em.accent} couleur={em.principale} />
          </View>
        ) : null}
        <View style={styles.ligneOutils}>
          <TouchableOpacity style={[styles.selecteur, { flex: 1, marginBottom: 0 }]} onPress={() => setShowRestoPicker(true)}>
            <Text style={styles.selecteurTxt}>🏪 {restoNom}</Text>
            <Text style={styles.selecteurChevron}>▾</Text>
          </TouchableOpacity>
          {roleActif === 'manager' ? (
            <TouchableOpacity onPress={() => router.push('/bouton-avis')} style={styles.lienBouton}>
              <Text style={styles.lienBoutonTxt}>🔖 Bouton avis</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.ongletsBar}>
        {[['resume', 'Résumé'], ['avis', 'Avis'], ['rattacher', `À rattacher${boutiques.length ? ` (${boutiques.length})` : ''}`]].map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.ongletBtn, onglet === cle && styles.ongletBtnActif]} onPress={() => setOnglet(cle)}>
            <Text style={[styles.ongletTxt, onglet === cle && styles.ongletTxtActif]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !plage ? (
        <View style={styles.centre}><Text style={styles.emptyTxt}>Choisissez une date de début et une date de fin.</Text></View>
      ) : onglet === 'resume' ? (
        <ScrollView
          style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {retards.map(r => (
            <View key={r.platform} style={styles.rappelBox}>
              <Text style={styles.rappelTxt}>
                ⏰ {texteRetard(r)} — ouvrez le portail {r.label}{r.platform === 'yango' ? ' (page Avis)' : ''} et cliquez sur le bouton avis.
              </Text>
            </View>
          ))}
          {erreur ? <View style={styles.erreurBox}><Text style={styles.erreurTxt}>{erreur}</Text></View> : null}
          <ResumeAvis chiffres={chiffres} chiffresPrec={chiffresPrec} parPlateforme={parPlateforme}
            parResto={parResto} caissiers={caissiers} motifs={motifs} colors={colors} />
          {run ? (
            <Text style={styles.pied}>
              Dernier envoi complet : {fmtDate(run.run_date)} · {run.inserted} nouvel{run.inserted > 1 ? 's' : ''} avis
            </Text>
          ) : null}
          <View style={{ height: 40 }} />
        </ScrollView>
      ) : onglet === 'rattacher' ? (
        <ScrollView
          style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          <Text style={styles.explication}>
            Chaque boutique Yango ou Glovo doit pointer vers un restaurant. Tant qu'elle
            n'est pas rattachée, ses avis ne comptent dans aucun total et ses avis
            négatifs ne créent pas de litige. Le rattachement reprend les avis déjà reçus.
          </Text>

          {boutiques.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>✅</Text>
              <Text style={styles.emptyTxt}>Toutes les boutiques sont rattachées</Text>
            </View>
          ) : boutiques.map(b => (
            <View key={`${b.platform}::${b.label}`} style={styles.card}>
              <View style={styles.ligneHaut}>
                <Badge texte={plateforme(b.platform)?.label || b.platform} couleur={plateforme(b.platform)?.couleur} />
                <Text style={styles.boutiqueNb}>
                  {b.nb} avis{b.nbNegatifs ? ` · ${b.nbNegatifs} négatif${b.nbNegatifs > 1 ? 's' : ''}` : ''}
                </Text>
              </View>
              <Text style={styles.boutiqueLabel}>{b.label}</Text>
              {b.dernier ? <Text style={styles.ligneSous}>Dernier avis le {fmtDate(b.dernier)}</Text> : null}
              <TouchableOpacity style={styles.btnPrincipal} onPress={() => setARattacher(b)}>
                <Text style={styles.btnPrincipalTxt}>Rattacher à un restaurant</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Plateforme + classification */}
          <View style={styles.chipsRow}>
            <TouchableOpacity
              style={[styles.chip, !platformFilter && styles.chipActif]}
              onPress={() => setPlatformFilter(null)}
            >
              <Text style={[styles.chipTxt, !platformFilter && styles.chipTxtActif]}>Les deux</Text>
            </TouchableOpacity>
            {PLATEFORMES.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.chip, platformFilter === p.key && { backgroundColor: p.couleur, borderColor: p.couleur }]}
                onPress={() => setPlatformFilter(platformFilter === p.key ? null : p.key)}
              >
                <Text style={[styles.chipTxt, platformFilter === p.key && { color: '#fff', fontWeight: '700' }]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.chipsRow}>
            <TouchableOpacity
              style={[styles.chip, !classFilter && styles.chipActif]}
              onPress={() => setClassFilter(null)}
            >
              <Text style={[styles.chipTxt, !classFilter && styles.chipTxtActif]}>Tous</Text>
            </TouchableOpacity>
            {CLASSIFICATIONS.map(c => (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, classFilter === c.key && { backgroundColor: c.couleur, borderColor: c.couleur }]}
                onPress={() => setClassFilter(classFilter === c.key ? null : c.key)}
              >
                <Text style={[styles.chipTxt, classFilter === c.key && { color: '#fff', fontWeight: '700' }]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {erreur ? (
            <View style={styles.erreurBox}><Text style={styles.erreurTxt}>{erreur}</Text></View>
          ) : null}

          {/* Liste des avis */}
          {avis.length === 0 && !erreur ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTxt}>Aucun avis sur cette période</Text>
            </View>
          ) : avis.slice(0, visible).map(a => {
            const negatif = classifierAvis(a) === 'negatif'
            const note = noteSur5(a)
            return (
              <View key={a.id} {...focus.props(a.id)} style={[styles.card, negatif && styles.cardNegatif, focus.style(a.id)]}>
                <View style={styles.ligneHaut}>
                  <Badge texte={plateforme(a.platform)?.label || a.platform} couleur={plateforme(a.platform)?.couleur} />
                  <Text style={styles.ligneSous}>{fmtDate(a.review_date)}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.classif, { color: negatif ? '#C62828' : '#2E7D32' }]}>
                    {negatif ? '👎 Négatif' : '👍 Bon'}
                  </Text>
                </View>
                <Text style={styles.ligneNom} numberOfLines={1}>
                  {a.restaurant_id ? (nomsParId[a.restaurant_id] || 'Restaurant inconnu') : `⚠️ ${a.external_store_label || 'Boutique à rattacher'}`}
                </Text>
                {note != null ? <Text style={styles.note}>{etoiles(note)} {note}/5</Text> : null}
                {a.comment ? <Text style={styles.commentaire}>« {a.comment} »</Text> : null}
                {a.external_ref ? <Text style={styles.ligneSous}>Commande {a.external_ref}</Text> : null}
                <Text style={styles.ligneSous}>
                  {a.commande_le ? `Commande à ${new Date(a.commande_le).toISOString().slice(11, 16)} · ` : 'Heure de commande inconnue · '}
                  {caissierPar[a.id]?.caissier_nom ? `Caissier : ${caissierPar[a.id].caissier_nom}` : 'Caissier : non trouvé'}
                </Text>
              </View>
            )
          })}

          {avis.length > visible ? (
            <TouchableOpacity style={styles.btnSecondaire} onPress={() => setVisible(v => v + PAR_PAGE)}>
              <Text style={styles.btnSecondaireTxt}>Afficher {Math.min(PAR_PAGE, avis.length - visible)} avis de plus</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Choix du restaurant (filtre) */}
      <Modal visible={showRestoPicker} transparent animationType="fade" onRequestClose={() => setShowRestoPicker(false)}>
        <TouchableOpacity style={styles.modalFond} activeOpacity={1} onPress={() => setShowRestoPicker(false)}>
          <View style={styles.modalBoite}>
            <Text style={styles.modalTitre}>Restaurant</Text>
            <ScrollView>
              <TouchableOpacity style={styles.pickerItem} onPress={() => { setRestoFilter(null); setShowRestoPicker(false) }}>
                <Text style={[styles.pickerItemTxt, !restoFilter && styles.pickerItemActif]}>🌍 Tous les restaurants</Text>
              </TouchableOpacity>
              {restaurants.map(r => (
                <TouchableOpacity key={r.id} style={styles.pickerItem} onPress={() => { setRestoFilter(r.id); setShowRestoPicker(false) }}>
                  <Text style={[styles.pickerItemTxt, restoFilter === r.id && styles.pickerItemActif]}>🏪 {r.nom}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Choix du restaurant (rattachement d'une boutique) */}
      <Modal visible={!!aRattacher} transparent animationType="fade" onRequestClose={() => setARattacher(null)}>
        <TouchableOpacity style={styles.modalFond} activeOpacity={1} onPress={() => setARattacher(null)}>
          <View style={styles.modalBoite}>
            <Text style={styles.modalTitre}>Rattacher à…</Text>
            <Text style={styles.modalSous} numberOfLines={2}>{aRattacher?.label}</Text>
            <ScrollView>
              {restaurants.map(r => (
                <TouchableOpacity key={r.id} style={styles.pickerItem} onPress={() => confirmerRattachement(r)}>
                  <Text style={styles.pickerItemTxt}>🏪 {r.nom}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

function Badge({ texte, couleur }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.badge, { backgroundColor: (couleur || colors.textMuted) + '22', borderColor: couleur || colors.border }]}>
      <Text style={[styles.badgeTxt, { color: couleur || colors.textSecondary }]}>{texte}</Text>
    </View>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },


  ongletsBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  ongletBtn: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  ongletBtnActif: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  ongletTxt: { fontSize: 14, color: colors.textMuted },
  ongletTxtActif: { color: colors.primary, fontWeight: '700' },

  body: { flex: 1, padding: 16 },
  explication: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: 14 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 38, justifyContent: 'center' },
  chipActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 13, color: colors.textSecondary },
  chipTxtActif: { color: '#FFFFFF', fontWeight: '700' },

  selecteur: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, minHeight: 48, marginBottom: 10 },
  selecteurTxt: { fontSize: 14, color: colors.text, fontWeight: '600' },
  selecteurChevron: { fontSize: 14, color: colors.textMuted },

  erreurBox: { backgroundColor: colors.errorLight, borderRadius: 10, padding: 12, marginBottom: 12 },
  erreurTxt: { fontSize: 13, color: colors.errorDark, lineHeight: 19 },
  rappelBox: { backgroundColor: '#FFF3E0', borderRadius: 10, borderWidth: 1, borderColor: '#EF9F27', padding: 12, marginBottom: 12 },
  rappelTxt: { fontSize: 13, color: '#8A4B00', lineHeight: 19, fontWeight: '600' },
  lienBouton: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' },
  lienBoutonTxt: { color: colors.text, fontSize: 13, fontWeight: '700' },
  hautFixe: { paddingBottom: 10 },
  ligneOutils: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, alignItems: 'center' },


  blocSection: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 14 },
  blocTitre: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 },
  ligneSimple: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6 },
  ligneNom: { fontSize: 13, fontWeight: '600', color: colors.text, flexShrink: 1 },
  ligneVal: { fontSize: 12, color: colors.textSecondary },
  ligneSous: { fontSize: 11, color: colors.textMuted },

  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardNegatif: { borderLeftWidth: 3, borderLeftColor: '#C62828' },
  ligneHaut: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  classif: { fontSize: 12, fontWeight: '700' },
  note: { fontSize: 13, color: colors.orange, marginTop: 4, letterSpacing: 1 },
  commentaire: { fontSize: 13, color: colors.textSecondary, marginTop: 6, lineHeight: 19, fontStyle: 'italic' },
  boutiqueLabel: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 4 },
  boutiqueNb: { fontSize: 12, color: colors.textSecondary },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },

  btnPrincipal: { backgroundColor: colors.primary, borderRadius: 10, minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  btnPrincipalTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  btnSecondaire: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, minHeight: 48, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  btnSecondaireTxt: { color: colors.primary, fontSize: 14, fontWeight: '600' },

  emptyBox: { alignItems: 'center', paddingVertical: 50 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 15, color: colors.textMuted },

  pied: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 6 },

  modalFond: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 24 },
  modalBoite: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, maxHeight: '70%' },
  modalTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  modalSous: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  pickerItemTxt: { fontSize: 14, color: colors.text },
  pickerItemActif: { fontWeight: '700', color: colors.primary },
}) }
