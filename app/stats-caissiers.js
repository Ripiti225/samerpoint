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
import {
  aggregerStatsCaissiers,
  choisirInventaireShift,
  resumerEcartShift,
  resumerInventaire,
} from '../lib/statsCaissiers'

const PERIODES = [
  { label: '7 jours', jours: 7 },
  { label: '30 jours', jours: 30 },
  { label: '90 jours', jours: 90 },
]

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('fr-FR') + ' F'
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(1) + ' %'
}

function dateDepuis(jours) {
  const d = new Date()
  d.setDate(d.getDate() - jours)
  return d.toISOString().split('T')[0]
}

function formatDate(dateStr) {
  if (!dateStr) return 'Date inconnue'
  const [annee, mois, jour] = dateStr.split('-')
  return `${jour}/${mois}/${annee}`
}

function formatHeure(heure) {
  return heure ? String(heure).slice(0, 5) : '—'
}

export default function StatsCaissiers() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { restaurantId } = useApp()
  const [periodeIdx, setPeriodeIdx] = useState(0)
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const periode = PERIODES[periodeIdx]

  const charger = useCallback(async () => {
    setLoading(true)
    try {
      const since = dateDepuis(periode.jours)
      let query = supabase
        .from('points_shifts')
        .select('*')
        .eq('valide', true)
        .gte('date', since)
        .order('date', { ascending: false })

      if (restaurantId) query = query.eq('restaurant_id', restaurantId)

      const { data, error } = await query
      if (!error) setShifts(data || [])
    } catch (_) {}
    setLoading(false)
  }, [periode.jours, restaurantId])

  useEffect(() => { charger() }, [charger])

  async function onRefresh() {
    setRefreshing(true)
    await charger()
    setRefreshing(false)
  }

  // Agrégation par caissier
  const statsCaissiers = useMemo(() => aggregerStatsCaissiers(shifts), [shifts])

  const totalGlobal = useMemo(() => ({
    venteTotal: statsCaissiers.reduce((s, c) => s + c.venteTotal, 0),
    nbShifts: statsCaissiers.reduce((s, c) => s + c.nbShifts, 0),
  }), [statsCaissiers])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Statistiques caissiers</Text>
        <Text style={styles.headerSub}>Performance par caissier</Text>
      </View>

      {/* Sélecteur de période */}
      <View style={styles.periodeBar}>
        {PERIODES.map((p, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.periodeBtn, i === periodeIdx && styles.periodeBtnActif]}
            onPress={() => setPeriodeIdx(i)}
          >
            <Text style={[styles.periodeTxt, i === periodeIdx && styles.periodeTxtActif]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#534AB7" />
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#534AB7" />}
        >
          {/* KPI global */}
          <View style={styles.globalRow}>
            <View style={styles.globalCard}>
              <Text style={styles.globalLabel}>Total ventes</Text>
              <Text style={styles.globalVal}>{fmt(totalGlobal.venteTotal)}</Text>
            </View>
            <View style={styles.globalCard}>
              <Text style={styles.globalLabel}>Shifts enregistrés</Text>
              <Text style={styles.globalVal}>{totalGlobal.nbShifts}</Text>
            </View>
            <View style={styles.globalCard}>
              <Text style={styles.globalLabel}>Caissiers actifs</Text>
              <Text style={styles.globalVal}>{statsCaissiers.length}</Text>
            </View>
          </View>

          {statsCaissiers.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyTxt}>Aucun shift sur cette période</Text>
            </View>
          ) : (
            statsCaissiers.map((c, idx) => (
              <CaissierCard
                key={c.nom + idx}
                caissier={c}
                rang={idx + 1}
                venteMax={statsCaissiers[0].venteTotal}
                totalGlobal={totalGlobal.venteTotal}
              />
            ))
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function CaissierCard({ caissier, rang, venteMax, totalGlobal }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [expanded, setExpanded] = useState(false)
  const pctTotal = totalGlobal > 0 ? (caissier.venteTotal / totalGlobal) * 100 : 0
  const barWidth = venteMax > 0 ? (caissier.venteTotal / venteMax) * 100 : 0

  const medailleColors = ['#F4C430', '#B0B0B0', '#CD7F32']
  const medaille = rang <= 3 ? medailleColors[rang - 1] : null

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Fermer' : 'Ouvrir'} les ${caissier.nbShifts} shifts de ${caissier.nom}`}
        accessibilityState={{ expanded }}
      >
        <View style={[styles.rangBadge, medaille ? { backgroundColor: medaille } : {}]}>
          <Text style={styles.rangTxt}>{rang}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.caissierNom}>{caissier.nom}</Text>
          <Text style={styles.caissierMeta}>{caissier.nbShifts} shift{caissier.nbShifts > 1 ? 's' : ''} · moy. {fmt(caissier.venteMoyenne)}/shift</Text>
          {caissier.manquantTotal > 0 && (
            <Text style={styles.caissierManquant}>
              Manquants : {fmt(caissier.manquantTotal)} · {caissier.shiftsAvecManquant} shift{caissier.shiftsAvecManquant > 1 ? 's' : ''}
            </Text>
          )}
          {/* Barre de progression */}
          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${barWidth}%` }]} />
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
          <Text style={styles.caissierVente}>{fmt(caissier.venteTotal)}</Text>
          <Text style={styles.caissierPct}>{fmtPct(pctTotal)} du total</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detailBox}>
          <Text style={styles.resumeTitre}>Résumé sur {periodeLabel(caissier.nbShifts)}</Text>
          <DetailLigne label="Ventes totales" valeur={fmt(caissier.venteTotal)} couleur={colors.primary} />
          <DetailLigne label="Espèces encaissées" valeur={fmt(caissier.especeTotal)} />
          <DetailLigne label="Dépenses" valeur={fmt(caissier.depensesTotal)} couleur={colors.error} />
          <DetailLigne label="Fournisseurs" valeur={fmt(caissier.fournisseursTotal)} couleur={colors.error} />
          {caissier.kdoTotal > 0 && <DetailLigne label="KDO offerts" valeur={fmt(caissier.kdoTotal)} couleur={colors.warning} />}
          {caissier.retourTotal > 0 && <DetailLigne label="Retours" valeur={fmt(caissier.retourTotal)} couleur={colors.warning} />}
          <DetailLigne label="Total manquants" valeur={fmt(caissier.manquantTotal)} couleur={caissier.manquantTotal > 0 ? colors.error : colors.success} />
          {caissier.surplusTotal > 0 && <DetailLigne label="Total surplus" valeur={fmt(caissier.surplusTotal)} couleur={colors.primary} />}
          {caissier.shiftsSansMesure > 0 && (
            <Text style={styles.donneeIndisponible}>
              {caissier.shiftsSansMesure} shift{caissier.shiftsSansMesure > 1 ? 's' : ''} sans mesure POS
            </Text>
          )}

          <Text style={styles.shiftsTitre}>Détail par shift</Text>
          {caissier.shifts.map(shift => (
            <ShiftCard key={shift.id || `${shift.date}-${shift.heure_debut}`} shift={shift} />
          ))}
        </View>
      )}
    </View>
  )
}

function periodeLabel(nbShifts) {
  return `${nbShifts} shift${nbShifts > 1 ? 's' : ''}`
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
        <Text style={styles.shiftChevron}>{expanded ? '▲' : '▼'}</Text>
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
  header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  backBtn: { marginBottom: 8 },
  backTxt: { color: colors.primaryText, fontSize: 14 },
  headerTitre: { fontSize: 22, fontWeight: '700', color: colors.surface },
  headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },

  periodeBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  periodeBtn: { flex: 1, minHeight: 44, paddingVertical: 12, alignItems: 'center' },
  periodeBtnActif: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  periodeTxt: { fontSize: 13, color: colors.textMuted },
  periodeTxtActif: { color: colors.primary, fontWeight: '700' },

  body: { flex: 1, padding: 16 },

  globalRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  globalCard: { flex: 1, backgroundColor: colors.primary, borderRadius: 12, padding: 12, alignItems: 'center' },
  globalLabel: { fontSize: 10, color: colors.primaryText, marginBottom: 4 },
  globalVal: { fontSize: 15, fontWeight: '700', color: colors.surface },

  emptyBox: { alignItems: 'center', paddingVertical: 50 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 15, color: colors.textMuted },

  card: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 10, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 64, padding: 14 },
  rangBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  rangTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  caissierNom: { fontSize: 14, fontWeight: '700', color: colors.text },
  caissierMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  caissierManquant: { fontSize: 11, color: colors.error, fontWeight: '600', marginTop: 3 },
  barBg: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 6 },
  barFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  caissierVente: { fontSize: 14, fontWeight: '700', color: colors.primary },
  caissierPct: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 10, color: colors.textPlaceholder, marginLeft: 6 },

  detailBox: { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingHorizontal: 14, paddingVertical: 12 },
  resumeTitre: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  donneeIndisponible: { fontSize: 12, color: colors.textMuted, marginTop: 5 },
  shiftsTitre: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 9 },
  detailLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  detailLabel: { flex: 1, fontSize: 13, color: colors.textSecondary, paddingRight: 10 },
  detailVal: { fontSize: 13, fontWeight: '600', textAlign: 'right' },

  shiftCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 10, overflow: 'hidden', backgroundColor: colors.surface },
  shiftHeader: { minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  shiftDate: { fontSize: 14, fontWeight: '700', color: colors.text },
  shiftHeures: { fontSize: 12, color: colors.textMuted, marginTop: 3, textTransform: 'capitalize' },
  shiftMontants: { alignItems: 'flex-end', marginLeft: 8, maxWidth: '45%' },
  shiftVente: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  shiftChevron: { fontSize: 10, color: colors.textPlaceholder, marginLeft: 8 },
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
