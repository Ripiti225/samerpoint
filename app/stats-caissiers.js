// ──────────────────────────────────────────────────────────────────────────────
// Note des caissiers — sur 20, sur les 30 derniers jours.
// Jamais le volume de ventes (il dépend du restaurant) : justesse de la caisse,
// numéros des clients, inventaire, clients et plateformes, présence, plus un
// bonus « ventes additionnelles ». Règles et garde-fous : lib/noteCaissier.js
// Chargement : lib/noteCaissierDb.js. Le détail des shifts reste en bas de chaque fiche.
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { retour } from '../lib/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { choisirInventaireShift, resumerEcartShift, resumerInventaire } from '../lib/statsCaissiers'
import { BAREME, MIN_SHIFTS, TOLERANCE_ECART, appreciation } from '../lib/noteCaissier'
import { chargerNotesCaissiers } from '../lib/noteCaissierDb'

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('fr-FR') + ' F'
}

function formatDate(dateStr) {
  if (!dateStr) return 'Date inconnue'
  const [annee, mois, jour] = dateStr.split('-')
  return `${jour}/${mois}/${annee}`
}

function formatHeure(heure) {
  return heure ? String(heure).slice(0, 5) : '—'
}

const fmtNote = v => (v === null || v === undefined ? '—' : String(v).replace('.', ','))

// Icône et couleur de chaque critère, les mêmes partout (et demain dans le POS).
const CRITERES = {
  caisse: { nom: 'Justesse de la caisse', icone: 'cash-check', couleur: '#10B981' },
  contacts: { nom: 'Numéros des clients', icone: 'phone-check-outline', couleur: '#0EA5E9' },
  inventaire: { nom: 'Inventaire et comptage', icone: 'package-variant-closed', couleur: '#D97706' },
  clients: { nom: 'Clients et plateformes', icone: 'star-check-outline', couleur: '#DB2777' },
  presence: { nom: 'Présence', icone: 'account-clock-outline', couleur: '#6C63E0' },
  bonus: { nom: 'Ventes additionnelles (bonus)', icone: 'trending-up', couleur: '#F59E0B' },
}

function couleurTon(ton, colors) {
  return { vert: colors.success, bleu: '#0EA5E9', orange: colors.warning, rouge: colors.error, gris: colors.textMuted }[ton] || colors.textMuted
}

const initiales = nom => String(nom || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase()

export default function StatsCaissiers() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { restaurantId, roleActif } = useApp()
  const estGerant = roleActif === 'gerant'
  const [donnees, setDonnees] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [restoFiltre, setRestoFiltre] = useState(null)
  const [ouvert, setOuvert] = useState(null)
  const [regles, setRegles] = useState(false)

  const charger = useCallback(async () => {
    setErreur(null)
    try {
      setDonnees(await chargerNotesCaissiers({ restaurantId: estGerant ? restaurantId : null }))
    } catch (e) {
      setErreur(e?.message || 'Chargement impossible.')
    }
    setLoading(false)
  }, [estGerant, restaurantId])

  useEffect(() => { charger() }, [charger])

  async function onRefresh() {
    setRefreshing(true)
    await charger()
    setRefreshing(false)
  }

  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || ''
  const notes = useMemo(
    () => (donnees?.notes || []).filter(x => !restoFiltre || x.restaurantId === restoFiltre),
    [donnees, restoFiltre],
  )
  const precedentes = useMemo(() => new Map((donnees?.notesPrec || []).map(x => [x.cle, x.note])), [donnees])
  const notes20 = notes.filter(x => x.note !== null)
  const pasNotes = notes.filter(x => x.note === null)
  const moyenne = notes20.length ? Math.round((notes20.reduce((s, x) => s + x.note, 0) / notes20.length) * 10) / 10 : null
  const restosAvecCaissiers = (donnees?.restaurants || []).filter(r => (donnees?.notes || []).some(x => x.restaurantId === r.id))

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLigne}>
          <TouchableOpacity onPress={() => retour()} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Retour">
            <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCentre}>
            <View style={styles.headerIcone}><MaterialCommunityIcons name="account-star" size={18} color="#FFFFFF" /></View>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.headerTitre}>Note des caissiers</Text>
              <Text style={styles.headerSub}>Sur 20 · 30 derniers jours</Text>
            </View>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </View>

      {!estGerant && restosAvecCaissiers.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtres}
          contentContainerStyle={{ paddingHorizontal: 14, gap: 6, alignItems: 'center' }}>
          {[{ id: null, nom: 'Tous' }, ...restosAvecCaissiers].map(r => {
            const actif = restoFiltre === r.id
            return (
              <TouchableOpacity key={r.id || 'tous'} style={[styles.filtre, actif && styles.filtreActif]} onPress={() => setRestoFiltre(r.id)}>
                <Text style={[styles.filtreTxt, actif && styles.filtreTxtActif]}>{r.nom}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centreTxt}>Calcul des notes…</Text>
        </View>
      ) : erreur ? (
        <View style={styles.centre}>
          <MaterialCommunityIcons name="wifi-off" size={40} color={colors.error} />
          <Text style={[styles.centreTxt, { color: colors.error }]}>{erreur}</Text>
          <TouchableOpacity style={styles.boutonPlein} onPress={charger}><Text style={styles.boutonPleinTxt}>Réessayer</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          <View style={styles.hero}>
            <View style={[styles.heroRond, { top: -70, right: -50, width: 190, height: 190 }]} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.heroIcone}><MaterialCommunityIcons name="account-group" size={18} color="#FFFFFF" /></View>
              <Text style={styles.heroLbl} numberOfLines={1}>Moyenne de l’équipe{restoFiltre ? ` · ${nomResto(restoFiltre)}` : ''}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 10 }}>
              <Text style={styles.heroValeur}>{fmtNote(moyenne)}</Text>
              <Text style={styles.heroSur}>/20</Text>
            </View>
            <Text style={styles.heroSous}>{appreciation(moyenne).mot}</Text>
            <View style={styles.heroCases}>
              {[
                { label: 'Notés', valeur: String(notes20.length), point: '#BAE6FD' },
                { label: 'Excellent (17+)', valeur: String(notes20.filter(x => x.note >= 17).length), point: '#A7F3D0' },
                { label: 'À accompagner', valeur: String(notes20.filter(x => x.note < 10).length), point: '#FCA5A5' },
              ].map(c => (
                <View key={c.label} style={styles.heroCase}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.point }} />
                    <Text style={styles.heroCaseLbl} numberOfLines={1}>{c.label}</Text>
                  </View>
                  <Text style={styles.heroCaseVal}>{c.valeur}</Text>
                </View>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.reglesBtn} onPress={() => setRegles(r => !r)} accessibilityRole="button" accessibilityState={{ expanded: regles }}>
            <MaterialCommunityIcons name="help-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.reglesBtnTxt}>Comment la note est calculée</Text>
            <MaterialCommunityIcons name={regles ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
          </TouchableOpacity>
          {regles && <Regles styles={styles} colors={colors} posErreur={donnees?.posErreur} />}

          {notes20.length === 0 && pasNotes.length === 0 && (
            <View style={styles.centre}>
              <MaterialCommunityIcons name="account-search-outline" size={40} color={colors.textMuted} />
              <Text style={styles.centreTxt}>Aucun shift sur les 30 derniers jours</Text>
            </View>
          )}

          {notes20.length > 0 && <Text style={styles.sectionTitre}>Classement</Text>}
          {notes20.map((x, i) => (
            <FicheCaissier key={x.cle} n={x} rang={i + 1} notePrec={precedentes.get(x.cle)} resto={nomResto(x.restaurantId)}
              ouvert={ouvert === x.cle} onBasculer={() => setOuvert(o => (o === x.cle ? null : x.cle))} styles={styles} colors={colors} />
          ))}

          {pasNotes.length > 0 && (
            <>
              <Text style={styles.sectionTitre}>Pas encore notés · moins de {MIN_SHIFTS} shifts</Text>
              {pasNotes.map(x => (
                <FicheCaissier key={x.cle} n={x} notePrec={null} resto={nomResto(x.restaurantId)}
                  ouvert={ouvert === x.cle} onBasculer={() => setOuvert(o => (o === x.cle ? null : x.cle))} styles={styles} colors={colors} />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// Le barème et les garde-fous, affichés tels quels : la note ne doit pas être une boîte noire.
function Regles({ styles, colors, posErreur }) {
  const lignes = [
    ['caisse', `${BAREME.caisse} pts`, `Part des shifts sans manquant ni surplus de plus de ${TOLERANCE_ECART} F : un surplus est aussi une erreur de caisse.`],
    ['contacts', `${BAREME.contacts} pts`, 'Part des livraisons où le numéro est noté : 4 à partir de 95 %, 3,5 dès 90 %, 3 dès 80 %, 2 dès 70 %, 1 dès 50 %.'],
    ['inventaire', `${BAREME.inventaire} pts`, 'Montants imputés par shift : 4 jusqu’à 300 F, 3 jusqu’à 750 F, 2 jusqu’à 1 500 F, 1 jusqu’à 3 000 F.'],
    ['clients', `${BAREME.clients} pts`, 'Mauvais avis, erreurs Yango/Glovo et points pas faits à son nom, pour 20 shifts. Un bon avis rapporte 0,5.'],
    ['presence', `${BAREME.presence} pts`, '−0,5 par absence non justifiée. Malade, congé et permission ne comptent pas.'],
    ['bonus', `+${BAREME.bonus} pt`, 'Ticket moyen au-dessus de celui de son restaurant : +0,5 dès +5 %, +1 dès +10 %. Jamais de pénalité.'],
  ]
  return (
    <View style={styles.reglesCarte}>
      {lignes.map(([cle, pts, texte]) => (
        <View key={cle} style={styles.regleLigne}>
          <View style={[styles.pastille, { backgroundColor: CRITERES[cle].couleur + '1F' }]}>
            <MaterialCommunityIcons name={CRITERES[cle].icone} size={16} color={CRITERES[cle].couleur} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.regleTitre}>{CRITERES[cle].nom} · {pts}</Text>
            <Text style={styles.regleTxt}>{texte}</Text>
          </View>
        </View>
      ))}
      <View style={styles.gardeFous}>
        <MaterialCommunityIcons name="shield-check-outline" size={18} color={colors.successDark} />
        <Text style={styles.gardeFousTxt}>
          Jamais le volume de ventes. Pas de note avant {MIN_SHIFTS} shifts. Un critère qui ne s’applique pas (ex. aucune
          livraison) est neutre : ses points sont répartis sur les autres. Un écart justifié ou annulé dans Vérification ne compte pas.
          Les 30 derniers jours seulement : les vieilles erreurs s’effacent.
        </Text>
      </View>
      {posErreur ? (
        <Text style={[styles.regleTxt, { color: colors.warningDark, marginTop: 8 }]}>
          Bonus ventes indisponible pour l’instant : {posErreur}
        </Text>
      ) : null}
    </View>
  )
}

function FicheCaissier({ n, rang, notePrec, resto, ouvert, onBasculer, styles, colors }) {
  const [voirShifts, setVoirShifts] = useState(false)
  const app = appreciation(n.note)
  const ton = couleurTon(app.ton, colors)
  const delta = n.note !== null && notePrec !== null && notePrec !== undefined ? Math.round((n.note - notePrec) * 10) / 10 : null
  const tous = [...n.criteres, n.bonus]
  return (
    <View style={[styles.fiche, ouvert && { borderColor: ton + '66' }]}>
      <TouchableOpacity style={styles.ficheHaut} onPress={onBasculer} activeOpacity={0.7}
        accessibilityRole="button" accessibilityState={{ expanded: ouvert }}
        accessibilityLabel={`${n.nom}, ${n.note === null ? 'pas encore noté' : `${fmtNote(n.note)} sur 20`}`}>
        {rang ? (
          <View style={[styles.rang, rang <= 3 && { backgroundColor: ['#F59E0B', '#94A3B8', '#B45309'][rang - 1] }]}>
            <Text style={[styles.rangTxt, rang <= 3 && { color: '#FFFFFF' }]}>{rang}</Text>
          </View>
        ) : null}
        <View style={[styles.avatar, { backgroundColor: ton + '1F' }]}>
          <Text style={[styles.avatarTxt, { color: ton }]}>{initiales(n.nom)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.ficheNom} numberOfLines={1}>{n.nom}</Text>
          <Text style={styles.ficheSous} numberOfLines={1}>{resto}{resto ? ' · ' : ''}{n.nbShifts} shift{n.nbShifts > 1 ? 's' : ''}</Text>
          {/* Une petite barre par critère : la note se lit d'un coup d'œil */}
          <View style={styles.miniBarres}>
            {n.criteres.map(c => (
              <View key={c.cle} style={[styles.miniPiste, { flex: c.max }]}>
                {c.applicable ? (
                  <View style={{ height: '100%', width: `${(c.points / c.max) * 100}%`, backgroundColor: CRITERES[c.cle].couleur, borderRadius: 3 }} />
                ) : null}
              </View>
            ))}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <View style={[styles.notePilule, { backgroundColor: ton + '1F' }]}>
            <Text style={[styles.noteGrand, { color: ton }]}>{fmtNote(n.note)}</Text>
            {n.note !== null ? <Text style={[styles.noteSur, { color: ton }]}>/20</Text> : null}
          </View>
          {delta !== null && delta !== 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <MaterialCommunityIcons name={delta > 0 ? 'arrow-up' : 'arrow-down'} size={12} color={delta > 0 ? colors.successDark : colors.error} />
              <Text style={[styles.delta, { color: delta > 0 ? colors.successDark : colors.error }]}>{fmtNote(Math.abs(delta))}</Text>
            </View>
          ) : (
            <Text style={styles.motNote}>{app.mot}</Text>
          )}
        </View>
      </TouchableOpacity>

      {ouvert && (
        <View style={styles.ficheDetail}>
          {n.note === null && (
            <Text style={styles.avertissement}>
              {n.nbShifts} shift{n.nbShifts > 1 ? 's' : ''} sur 30 jours : la note apparaîtra à partir de {MIN_SHIFTS}. Le détail ci-dessous est donné pour information.
            </Text>
          )}
          {n.rapproches?.length ? (
            <View style={styles.rapproche}>
              <MaterialCommunityIcons name="link-variant" size={15} color={colors.textSecondary} />
              <Text style={styles.rapprocheTxt}>
                Shifts du POS au nom de {n.rapproches.map(x => `« ${x} »`).join(', ')} rattachés à ce compte.
              </Text>
            </View>
          ) : null}
          {tous.map(c => {
            const meta = CRITERES[c.cle]
            return (
              <View key={c.cle} style={styles.critere}>
                <View style={[styles.pastille, { backgroundColor: meta.couleur + '1F' }]}>
                  <MaterialCommunityIcons name={meta.icone} size={16} color={meta.couleur} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={styles.critereNom} numberOfLines={1}>{meta.nom}</Text>
                    <Text style={[styles.criterePts, { color: c.applicable ? meta.couleur : colors.textMuted }]}>
                      {c.applicable ? `${c.cle === 'bonus' ? '+' : ''}${fmtNote(c.points)} / ${c.max}` : 'neutre'}
                    </Text>
                  </View>
                  {c.applicable && c.cle !== 'bonus' ? (
                    <View style={styles.critPiste}>
                      <View style={{ height: '100%', width: `${(c.points / c.max) * 100}%`, backgroundColor: meta.couleur, borderRadius: 4 }} />
                    </View>
                  ) : null}
                  <Text style={styles.critereResume}>{c.resume}</Text>
                  {c.conseil ? <Text style={styles.critereConseil}>{c.conseil}</Text> : null}
                  {c.cle === 'clients' && c.incidents?.length ? (
                    <Text style={styles.critereResume}>{c.incidents.map(i => `${i.nature} le ${formatDate(i.date)}`).join(' · ')}</Text>
                  ) : null}
                </View>
              </View>
            )
          })}

          <TouchableOpacity style={styles.voirShifts} onPress={() => setVoirShifts(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: voirShifts }}>
            <MaterialCommunityIcons name="format-list-bulleted" size={17} color={colors.primary} />
            <Text style={styles.voirShiftsTxt}>{voirShifts ? 'Masquer' : 'Voir'} ses {n.nbShifts} shifts</Text>
            <MaterialCommunityIcons name={voirShifts ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
          </TouchableOpacity>
          {voirShifts && [...n.shifts]
            .sort((a, b) => `${b.date}${b.heure_debut || ''}`.localeCompare(`${a.date}${a.heure_debut || ''}`))
            .map(shift => <ShiftCard key={shift.id || `${shift.date}-${shift.heure_debut}`} shift={shift} />)}
        </View>
      )}
    </View>
  )
}

function ShiftCard({ shift }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [expanded, setExpanded] = useState(false)
  const [inventaire, setInventaire] = useState(null)
  const [inventaireEtat, setInventaireEtat] = useState('idle')
  const ecart = resumerEcartShift(shift)

  async function chargerInventaire() {
    if (['loading', 'loaded', 'absent'].includes(inventaireEtat)) return
    if (!shift.point_id || !shift.caissier_id) {
      setInventaireEtat('absent')
      return
    }

    setInventaireEtat('loading')
    try {
      const { data, error } = await supabase
        .from('inventaires_shifts')
        .select(`
          id, point_id, caissier_id, pos_service_id, date, type_shift, heure_debut, heure_fin,
          valide, montant_a_deduire, created_at,
          inventaire_lignes(
            produit_id, produit_nom, stock_initial, entrees, sorties,
            stock_reel, ecart, nombre_explique, explication, montant_deduit
          )
        `)
        .eq('point_id', shift.point_id)
        .eq('caissier_id', shift.caissier_id)
        .order('created_at', { ascending: false })

      if (error) throw error
      const choisi = choisirInventaireShift(shift, data || [])
      setInventaire(choisi)
      setInventaireEtat(choisi ? 'loaded' : 'absent')
    } catch (_) {
      setInventaireEtat('error')
    }
  }

  function basculer() {
    const prochain = !expanded
    setExpanded(prochain)
    if (prochain) chargerInventaire()
  }

  return (
    <View style={styles.shiftCard}>
      <TouchableOpacity
        style={styles.shiftHeader}
        onPress={basculer}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Fermer' : 'Ouvrir'} le shift du ${formatDate(shift.date)}`}
        accessibilityState={{ expanded }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.shiftDate}>{formatDate(shift.date)}</Text>
          <Text style={styles.shiftHeures}>
            {formatHeure(shift.heure_debut)} → {formatHeure(shift.heure_fin)}
            {shift.type_shift ? ` · ${shift.type_shift}` : ''}
          </Text>
        </View>
        <View style={styles.shiftMontants}>
          <Text style={styles.shiftVente}>{fmt(shift.vente_shift)}</Text>
          <EcartBadge ecart={ecart} />
        </View>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.shiftBody}>
          <EcartDetail ecart={ecart} ecartReconciliation={shift.ecart_reconciliation} />

          <Text style={styles.blocTitre}>Point du shift</Text>
          <View style={styles.dataCard}>
            <DetailLigne label="Vente du shift" valeur={fmt(shift.vente_shift)} couleur={colors.primary} />
            {shift.vente_systeme_pos != null && <DetailLigne label="Vente système POS" valeur={fmt(shift.vente_systeme_pos)} />}
            <DetailLigne label="Espèces comptées" valeur={fmt(shift.espece)} />
            <DetailLigne label="Dépenses" valeur={fmt(shift.depenses)} couleur={colors.error} />
            <DetailLigne label="Fournisseurs" valeur={fmt(shift.fournisseurs)} couleur={colors.error} />
          </View>

          <Text style={styles.blocTitre}>Encaissements et ajustements</Text>
          <View style={styles.dataCard}>
            <MontantsShift shift={shift} />
          </View>

          <Text style={styles.blocTitre}>Inventaire du shift</Text>
          <InventaireDetail inventaire={inventaire} etat={inventaireEtat} />
        </View>
      )}
    </View>
  )
}

function EcartBadge({ ecart }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const apparence = {
    manquant: { fond: colors.errorLight, texte: colors.error, label: `Manquant ${fmt(ecart.montant)}` },
    surplus: { fond: colors.primaryLight, texte: colors.primary, label: `Surplus ${fmt(ecart.montant)}` },
    equilibre: { fond: colors.successLight, texte: colors.success, label: 'Caisse juste' },
    indisponible: { fond: colors.surfaceAlt, texte: colors.textMuted, label: 'Non mesuré' },
  }[ecart.type]

  return (
    <View style={[styles.ecartBadge, { backgroundColor: apparence.fond }]}>
      <Text style={[styles.ecartBadgeTxt, { color: apparence.texte }]}>{apparence.label}</Text>
    </View>
  )
}

function EcartDetail({ ecart, ecartReconciliation }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const estAlerte = ecart.type === 'manquant' || ecart.type === 'surplus'
  const fond = ecart.type === 'manquant' ? colors.errorLight : ecart.type === 'surplus' ? colors.primaryLight : colors.surfaceAlt

  return (
    <View style={[styles.ecartBox, { backgroundColor: fond }]}>
      <Text style={styles.ecartTitre}>Contrôle de caisse</Text>
      <View style={styles.ecartEntete}>
        <Text style={styles.ecartLabel}>
          {ecart.type === 'manquant' ? 'Manquant espèces' : ecart.type === 'surplus' ? 'Surplus espèces' : ecart.type === 'equilibre' ? 'Écart espèces' : 'Mesure espèces'}
        </Text>
        <Text style={[styles.ecartMontant, ecart.type === 'manquant' && { color: colors.error }, ecart.type === 'surplus' && { color: colors.primary }]}>
          {ecart.type === 'indisponible' ? 'Non disponible' : fmt(ecart.montant)}
        </Text>
      </View>
      {ecartReconciliation != null && (
        <View style={styles.ecartEntete}>
          <Text style={styles.ecartLabel}>Écart global rapport Z</Text>
          <Text style={styles.ecartMontant}>{fmt(ecartReconciliation)}</Text>
        </View>
      )}
      {(estAlerte || ecart.explication) && (
        <View style={styles.explicationBox}>
          <Text style={styles.explicationLabel}>Explication du caissier</Text>
          <Text style={[styles.explicationTxt, !ecart.explication && styles.explicationAbsente]}>
            {ecart.explication ? `« ${ecart.explication} »` : 'Aucune explication fournie'}
          </Text>
        </View>
      )}
    </View>
  )
}

function MontantsShift({ shift }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const lignes = [
    ['Wave', shift.wave],
    ['Djamo', shift.djamo],
    ['Orange Money', shift.om],
    ['Yango CSE', shift.yango_cse],
    ['Glovo CSE', shift.glovo_cse],
    ['KDO offerts', shift.kdo],
    ['Retours saisis', shift.retour],
    ['Retours POS', shift.retour_pos],
  ].filter(([, valeur]) => Number(valeur) > 0)

  if (lignes.length === 0) return <Text style={styles.montantsVide}>Aucun autre montant enregistré</Text>
  return lignes.map(([label, valeur]) => <DetailLigne key={label} label={label} valeur={fmt(valeur)} />)
}

function InventaireDetail({ inventaire, etat }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  if (etat === 'loading') {
    return <View style={styles.inventaireEtat}><ActivityIndicator color={colors.primary} /><Text style={styles.inventaireEtatTxt}>Chargement de l’inventaire…</Text></View>
  }
  if (etat === 'error') return <Text style={styles.erreurTxt}>Impossible de charger l’inventaire. Fermez puis rouvrez ce shift pour réessayer.</Text>
  if (etat === 'absent') return <Text style={styles.inventaireVide}>Aucun inventaire associé à ce shift.</Text>
  if (!inventaire) return null

  const resume = resumerInventaire(inventaire)
  return (
    <View style={styles.inventaireCard}>
      <View style={styles.inventaireResume}>
        <Text style={styles.inventaireStatut}>{inventaire.valide ? 'Inventaire verrouillé' : 'Inventaire en cours'}</Text>
        <Text style={styles.inventaireMeta}>{resume.nbProduits} produits · {resume.nbEcarts} écart{resume.nbEcarts > 1 ? 's' : ''}</Text>
        {resume.montantADeduire > 0 && <Text style={styles.inventaireDeduction}>À déduire : {fmt(resume.montantADeduire)}</Text>}
      </View>

      {resume.lignesEcart.length === 0 ? (
        <Text style={styles.inventaireOk}>Aucun écart d’inventaire.</Text>
      ) : resume.lignesEcart.map((ligne, index) => (
        <View key={ligne.produitId || index} style={[styles.invLigne, index === resume.lignesEcart.length - 1 && { borderBottomWidth: 0 }]}>
          <View style={styles.invLigneEntete}>
            <Text style={styles.invProduit}>{ligne.produitNom}</Text>
            <Text style={[styles.invEcart, { color: ligne.ecart < 0 ? colors.error : colors.primary }]}>
              {ligne.ecart > 0 ? '+' : ''}{ligne.ecart}
            </Text>
          </View>
          <Text style={styles.invStocks}>Attendu {ligne.stockAttendu} · Réel {ligne.stockReel} · Expliqué {ligne.nombreExplique}</Text>
          <Text style={[styles.invExplication, !ligne.explication && styles.explicationAbsente]}>
            {ligne.explication ? `Explication : ${ligne.explication}` : 'Aucune explication d’inventaire'}
          </Text>
          {ligne.montantDeduit > 0 && <Text style={styles.invDeduction}>Déduction : {fmt(ligne.montantDeduit)}</Text>}
        </View>
      ))}
    </View>
  )
}

function DetailLigne({ label, valeur, couleur }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const textColor = couleur || colors.text
  return (
    <View style={styles.detailLigne}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailVal, { color: textColor }]}>{valeur}</Text>
    </View>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22, zIndex: 2,
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  headerLigne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  enteteBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  headerCentre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerIcone: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: colors.primaryText, fontWeight: '600', marginTop: 1 },

  filtres: { maxHeight: 52, marginTop: 10, flexGrow: 0 },
  filtre: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
  filtreActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  filtreTxtActif: { color: '#FFFFFF', fontWeight: '800' },

  body: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  centre: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, gap: 12, paddingHorizontal: 24 },
  centreTxt: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  boutonPlein: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 22 },
  boutonPleinTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

  hero: {
    backgroundColor: colors.headerBg, borderRadius: 24, padding: 18, marginBottom: 12, overflow: 'hidden',
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 18, elevation: 6,
  },
  heroRond: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroIcone: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  heroLbl: { flex: 1, fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 },
  heroValeur: { fontSize: 44, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1.5 },
  heroSur: { fontSize: 20, fontWeight: '800', color: 'rgba(255,255,255,0.75)' },
  heroSous: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  heroCases: { flexDirection: 'row', gap: 8, marginTop: 14 },
  heroCase: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9 },
  heroCaseLbl: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  heroCaseVal: { fontSize: 18, color: '#FFFFFF', fontWeight: '800', marginTop: 3 },

  reglesBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.primaryLight, marginBottom: 10 },
  reglesBtnTxt: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.primary },
  reglesCarte: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.borderLight, gap: 12 },
  regleLigne: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  regleTitre: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  regleTxt: { fontSize: 12.5, color: colors.textSecondary, lineHeight: 18, marginTop: 2 },
  gardeFous: { flexDirection: 'row', gap: 8, backgroundColor: colors.successLight, borderRadius: 12, padding: 12 },
  gardeFousTxt: { flex: 1, fontSize: 12.5, color: colors.successDark, lineHeight: 18, fontWeight: '600' },
  pastille: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  sectionTitre: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 8 },

  fiche: { backgroundColor: colors.surface, borderRadius: 18, marginBottom: 10, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  ficheHaut: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 72 },
  rang: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  rangTxt: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  avatar: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '800' },
  ficheNom: { fontSize: 15, fontWeight: '800', color: colors.text },
  ficheSous: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  miniBarres: { flexDirection: 'row', gap: 3, marginTop: 7, height: 6 },
  miniPiste: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  notePilule: { flexDirection: 'row', alignItems: 'baseline', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  noteGrand: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  noteSur: { fontSize: 12, fontWeight: '800', marginLeft: 1 },
  delta: { fontSize: 12, fontWeight: '800' },
  motNote: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },

  ficheDetail: { borderTopWidth: 1, borderTopColor: colors.borderLight, padding: 12, gap: 12 },
  rapproche: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 9 },
  rapprocheTxt: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  avertissement: { fontSize: 12.5, color: colors.warningDark, backgroundColor: colors.warningLight, borderRadius: 12, padding: 10, lineHeight: 18 },
  critere: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  critereNom: { flexShrink: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  criterePts: { fontSize: 14, fontWeight: '800' },
  critPiste: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: 6 },
  critereResume: { fontSize: 12.5, color: colors.textSecondary, marginTop: 5, lineHeight: 17 },
  critereConseil: { fontSize: 12.5, color: colors.primary, marginTop: 3, lineHeight: 17, fontWeight: '600' },
  voirShifts: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.primaryLight },
  voirShiftsTxt: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.primary },

  detailLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  detailLabel: { flex: 1, fontSize: 13, color: colors.textSecondary, paddingRight: 10 },
  detailVal: { fontSize: 13, fontWeight: '600', textAlign: 'right' },

  shiftCard: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: 14, marginBottom: 8, overflow: 'hidden', backgroundColor: colors.surface },
  shiftHeader: { minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  shiftDate: { fontSize: 14, fontWeight: '700', color: colors.text },
  shiftHeures: { fontSize: 12, color: colors.textMuted, marginTop: 3, textTransform: 'capitalize' },
  shiftMontants: { alignItems: 'flex-end', marginLeft: 8, maxWidth: '45%' },
  shiftVente: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  shiftBody: { padding: 12, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.surfaceAlt },

  ecartBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  ecartBadgeTxt: { fontSize: 10, fontWeight: '700' },
  ecartBox: { borderRadius: 10, padding: 12, marginBottom: 14 },
  ecartTitre: { fontSize: 12, fontWeight: '700', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 7 },
  ecartEntete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  ecartLabel: { flex: 1, fontSize: 13, color: colors.textSecondary, paddingRight: 8 },
  ecartMontant: { fontSize: 14, fontWeight: '700', color: colors.text },
  explicationBox: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 9 },
  explicationLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.35 },
  explicationTxt: { fontSize: 14, lineHeight: 20, color: colors.text, marginTop: 5 },
  explicationAbsente: { color: colors.error, fontStyle: 'italic' },

  blocTitre: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3, marginBottom: 6 },
  dataCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, marginBottom: 14 },
  montantsVide: { color: colors.textMuted, fontSize: 13 },

  inventaireEtat: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 10 },
  inventaireEtatTxt: { fontSize: 13, color: colors.textMuted },
  inventaireVide: { fontSize: 13, color: colors.textMuted, backgroundColor: colors.surface, borderRadius: 10, padding: 14, textAlign: 'center' },
  erreurTxt: { fontSize: 13, color: colors.error, backgroundColor: colors.errorLight, borderRadius: 10, padding: 14, textAlign: 'center' },
  inventaireCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, borderRadius: 10, overflow: 'hidden' },
  inventaireResume: { padding: 11, backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  inventaireStatut: { fontSize: 13, fontWeight: '700', color: colors.text },
  inventaireMeta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  inventaireDeduction: { fontSize: 12, fontWeight: '700', color: colors.error, marginTop: 4 },
  inventaireOk: { fontSize: 13, color: colors.success, padding: 13 },
  invLigne: { padding: 11, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  invLigneEntete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  invProduit: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text, paddingRight: 8 },
  invEcart: { fontSize: 14, fontWeight: '800' },
  invStocks: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  invExplication: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 7 },
  invDeduction: { fontSize: 12, fontWeight: '700', color: colors.error, marginTop: 5 },
}) }
