import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
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

export default function StatsCaissiers() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { restaurantId } = useApp()
  const [periodeIdx, setPeriodeIdx] = useState(0)
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const periode = PERIODES[periodeIdx]

  useEffect(() => { charger() }, [periodeIdx, restaurantId])

  async function charger() {
    setLoading(true)
    try {
      const since = dateDepuis(periode.jours)
      let query = supabase
        .from('points_shifts')
        .select('caissier_id, caissier_nom, vente_shift, depenses, fournisseurs, kdo, retour, yango_cse, glovo_cse, wave, djamo, om, espece, date, heure_debut, heure_fin')
        .eq('valide', true)
        .gte('date', since)
        .order('date', { ascending: false })

      if (restaurantId) query = query.eq('restaurant_id', restaurantId)

      const { data, error } = await query
      if (!error) setShifts(data || [])
    } catch (_) {}
    setLoading(false)
  }

  async function onRefresh() {
    setRefreshing(true)
    await charger()
    setRefreshing(false)
  }

  // Agrégation par caissier
  const statsCaissiers = useMemo(() => {
    const map = {}
    for (const s of shifts) {
      const key = s.caissier_id || s.caissier_nom || 'Inconnu'
      if (!map[key]) {
        map[key] = {
          nom: s.caissier_nom || 'Inconnu',
          nbShifts: 0,
          venteTotal: 0,
          depensesTotal: 0,
          fournisseursTotal: 0,
          especeTotal: 0,
          kdoTotal: 0,
          retourTotal: 0,
        }
      }
      const c = map[key]
      c.nbShifts++
      c.venteTotal += s.vente_shift || 0
      c.depensesTotal += s.depenses || 0
      c.fournisseursTotal += s.fournisseurs || 0
      c.especeTotal += s.espece || 0
      c.kdoTotal += s.kdo || 0
      c.retourTotal += s.retour || 0
    }
    return Object.values(map)
      .map(c => ({
        ...c,
        venteTotal: Math.round(c.venteTotal),
        depensesTotal: Math.round(c.depensesTotal),
        fournisseursTotal: Math.round(c.fournisseursTotal),
        especeTotal: Math.round(c.especeTotal),
        kdoTotal: Math.round(c.kdoTotal),
        retourTotal: Math.round(c.retourTotal),
        venteMoyenne: c.nbShifts > 0 ? Math.round(c.venteTotal / c.nbShifts) : 0,
      }))
      .sort((a, b) => b.venteTotal - a.venteTotal)
  }, [shifts])

  const totalGlobal = useMemo(() => ({
    venteTotal: statsCaissiers.reduce((s, c) => s + c.venteTotal, 0),
    nbShifts: statsCaissiers.reduce((s, c) => s + c.nbShifts, 0),
  }), [statsCaissiers])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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
      <TouchableOpacity style={styles.cardHeader} onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
        <View style={[styles.rangBadge, medaille ? { backgroundColor: medaille } : {}]}>
          <Text style={styles.rangTxt}>{rang}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.caissierNom}>{caissier.nom}</Text>
          <Text style={styles.caissierMeta}>{caissier.nbShifts} shift{caissier.nbShifts > 1 ? 's' : ''} · moy. {fmt(caissier.venteMoyenne)}/shift</Text>
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
          <DetailLigne label="Ventes totales" valeur={fmt(caissier.venteTotal)} couleur="#534AB7" />
          <DetailLigne label="Espèces encaissées" valeur={fmt(caissier.especeTotal)} />
          <DetailLigne label="Dépenses" valeur={fmt(caissier.depensesTotal)} couleur="#E05050" />
          <DetailLigne label="Fournisseurs" valeur={fmt(caissier.fournisseursTotal)} couleur="#E05050" />
          {caissier.kdoTotal > 0 && <DetailLigne label="KDO offerts" valeur={fmt(caissier.kdoTotal)} couleur="#EF9F27" />}
          {caissier.retourTotal > 0 && <DetailLigne label="Retours" valeur={fmt(caissier.retourTotal)} couleur="#EF9F27" />}
        </View>
      )}
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
  periodeBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rangBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  rangTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  caissierNom: { fontSize: 14, fontWeight: '700', color: colors.text },
  caissierMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  barBg: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 6 },
  barFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  caissierVente: { fontSize: 14, fontWeight: '700', color: colors.primary },
  caissierPct: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 10, color: colors.textPlaceholder, marginLeft: 6 },

  detailBox: { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingHorizontal: 16, paddingVertical: 10 },
  detailLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  detailLabel: { fontSize: 13, color: colors.textSecondary },
  detailVal: { fontSize: 13, fontWeight: '600' },
}) }
