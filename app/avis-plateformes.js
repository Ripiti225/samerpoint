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
  kpisAvis, kpisParPlateforme, kpisParRestaurant, noteSur5, plateforme,
} from '../lib/avisPlateformes'
import {
  chargerAvis, chargerAvisNonRattaches, dernierRun, rattacherBoutique,
} from '../lib/avisPlateformesDb'

const TODAY = new Date().toISOString().split('T')[0]

function ilYA(jours) {
  const d = new Date()
  d.setDate(d.getDate() - jours)
  return d.toISOString().split('T')[0]
}

const PERIODES = [
  { key: 'jour', label: "Aujourd'hui", plage: () => ({ debut: TODAY, fin: TODAY }) },
  { key: 'semaine', label: '7 jours', plage: () => ({ debut: ilYA(6), fin: TODAY }) },
  { key: 'mois', label: '30 jours', plage: () => ({ debut: ilYA(29), fin: TODAY }) },
  {
    key: 'mois_calendaire',
    label: 'Ce mois',
    plage: () => {
      const n = new Date()
      return { debut: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`, fin: TODAY }
    },
  },
]

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
  const { userId, userNom } = useApp()

  const [onglet, setOnglet] = useState('avis')          // 'avis' | 'rattacher'
  const [periodeKey, setPeriodeKey] = useState('mois')
  const [restoFilter, setRestoFilter] = useState(null)
  const [platformFilter, setPlatformFilter] = useState(null)
  const [classFilter, setClassFilter] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  const [restaurants, setRestaurants] = useState([])
  const [avis, setAvis] = useState([])
  const [orphelins, setOrphelins] = useState([])
  const [run, setRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [visible, setVisible] = useState(PAR_PAGE)

  // Boutique en cours de rattachement : { platform, label }
  const [aRattacher, setARattacher] = useState(null)

  const periode = PERIODES.find(p => p.key === periodeKey) || PERIODES[2]

  useEffect(() => {
    supabase.from('restaurants').select('id, nom').order('nom')
      .then(({ data }) => setRestaurants(data || []))
  }, [])

  useEffect(() => { charger() }, [periodeKey, restoFilter, platformFilter, classFilter])

  async function charger() {
    setLoading(true)
    setErreur(null)
    try {
      const { debut, fin } = periode.plage()
      const [lignes, sansResto, dernier] = await Promise.all([
        chargerAvis({ debut, fin, restaurantId: restoFilter, platform: platformFilter, classification: classFilter }),
        chargerAvisNonRattaches(),
        dernierRun().catch(() => null),
      ])
      setAvis(lignes)
      setOrphelins(sansResto)
      setRun(dernier)
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

  const kpis = useMemo(() => kpisAvis(avis), [avis])
  const parPlateforme = useMemo(() => kpisParPlateforme(avis), [avis])
  const parResto = useMemo(() => kpisParRestaurant(avis, nomsParId), [avis, nomsParId])
  const boutiques = useMemo(() => boutiquesARattacher(orphelins), [orphelins])

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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Avis clients</Text>
        <Text style={styles.headerSub}>Yango & Glovo · notes et commentaires</Text>
      </View>

      {/* Onglets */}
      <View style={styles.ongletsBar}>
        <TouchableOpacity
          style={[styles.ongletBtn, onglet === 'avis' && styles.ongletBtnActif]}
          onPress={() => setOnglet('avis')}
        >
          <Text style={[styles.ongletTxt, onglet === 'avis' && styles.ongletTxtActif]}>Avis</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ongletBtn, onglet === 'rattacher' && styles.ongletBtnActif]}
          onPress={() => setOnglet('rattacher')}
        >
          <Text style={[styles.ongletTxt, onglet === 'rattacher' && styles.ongletTxtActif]}>
            À rattacher{boutiques.length ? ` (${boutiques.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator size="large" color={colors.primary} /></View>
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
          {/* Période */}
          <View style={styles.chipsRow}>
            {PERIODES.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.chip, periodeKey === p.key && styles.chipActif]}
                onPress={() => setPeriodeKey(p.key)}
              >
                <Text style={[styles.chipTxt, periodeKey === p.key && styles.chipTxtActif]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Restaurant */}
          <TouchableOpacity style={styles.selecteur} onPress={() => setShowRestoPicker(true)}>
            <Text style={styles.selecteurTxt}>🏪 {restoNom}</Text>
            <Text style={styles.selecteurChevron}>▾</Text>
          </TouchableOpacity>

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

          {/* KPI */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Note moyenne</Text>
              <Text style={styles.kpiVal}>{kpis.noteMoyenne != null ? `${kpis.noteMoyenne} / 5` : '—'}</Text>
              <Text style={styles.kpiSous}>{kpis.nbNotes} avis notés</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Avis reçus</Text>
              <Text style={styles.kpiVal}>{kpis.nb}</Text>
              <Text style={styles.kpiSous}>{kpis.nbBons} bons</Text>
            </View>
            <View style={[styles.kpiCard, kpis.pctNegatifs > 20 && { backgroundColor: '#C62828' }]}>
              <Text style={styles.kpiLabel}>Négatifs</Text>
              <Text style={styles.kpiVal}>{kpis.pctNegatifs} %</Text>
              <Text style={styles.kpiSous}>{kpis.nbNegatifs} avis</Text>
            </View>
          </View>

          {/* Par plateforme */}
          <View style={styles.blocSection}>
            {PLATEFORMES.map(p => {
              const k = parPlateforme[p.key]
              return (
                <View key={p.key} style={styles.ligneSimple}>
                  <Badge texte={p.label} couleur={p.couleur} />
                  <Text style={styles.ligneVal}>
                    {k.nb} avis{k.noteMoyenne != null ? ` · ${k.noteMoyenne}/5` : ''}
                    {k.nb ? ` · ${k.pctNegatifs} % négatifs` : ''}
                  </Text>
                </View>
              )
            })}
          </View>

          {/* Par restaurant (masqué si un seul restaurant est filtré) */}
          {!restoFilter && parResto.length > 1 ? (
            <View style={styles.blocSection}>
              <Text style={styles.blocTitre}>Par restaurant</Text>
              {parResto.map(r => (
                <View key={r.restaurant_id || 'orphelins'} style={styles.ligneSimple}>
                  <Text style={styles.ligneNom} numberOfLines={1}>{r.nom}</Text>
                  <Text style={[styles.ligneVal, r.pctNegatifs > 20 && { color: '#C62828', fontWeight: '700' }]}>
                    {r.nb} avis{r.noteMoyenne != null ? ` · ${r.noteMoyenne}/5` : ''} · {r.pctNegatifs} % nég.
                  </Text>
                </View>
              ))}
            </View>
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
              <View key={a.id} style={[styles.card, negatif && styles.cardNegatif]}>
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
              </View>
            )
          })}

          {avis.length > visible ? (
            <TouchableOpacity style={styles.btnSecondaire} onPress={() => setVisible(v => v + PAR_PAGE)}>
              <Text style={styles.btnSecondaireTxt}>Afficher {Math.min(PAR_PAGE, avis.length - visible)} avis de plus</Text>
            </TouchableOpacity>
          ) : null}

          {/* État de la dernière extraction */}
          {run ? (
            <Text style={styles.pied}>
              Dernière extraction : {fmtDate(run.run_date)} · {run.inserted} nouvel{run.inserted > 1 ? 's' : ''} avis ·
              {' '}{run.litiges_crees} litige{run.litiges_crees > 1 ? 's' : ''} créé{run.litiges_crees > 1 ? 's' : ''}
              {run.unmapped ? ` · ${run.unmapped} à rattacher` : ''}
            </Text>
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

  header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  backBtn: { marginBottom: 8 },
  backTxt: { color: colors.primaryText, fontSize: 14 },
  headerTitre: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },

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

  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpiCard: { flex: 1, backgroundColor: colors.primary, borderRadius: 12, padding: 12, alignItems: 'center' },
  kpiLabel: { fontSize: 10, color: colors.primaryText, marginBottom: 4 },
  kpiVal: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  kpiSous: { fontSize: 10, color: colors.primaryText, marginTop: 3 },

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
