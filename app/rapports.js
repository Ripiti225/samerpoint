import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { supabase } from '../lib/supabase'

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('fr-FR') + ' F'
}

function formatDateFr(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function getLundi(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const lundi = new Date(d)
  lundi.setDate(d.getDate() + diff)
  return lundi.toISOString().split('T')[0]
}

function getDimanche(lundiStr) {
  const d = new Date(lundiStr)
  d.setDate(d.getDate() + 6)
  return d.toISOString().split('T')[0]
}

function buildRapport(lundi, points, restaurants) {
  const parResto = {}
  points.forEach(p => {
    if (!parResto[p.restaurant_id]) {
      parResto[p.restaurant_id] = { venteTotal: 0, beneficeTotal: 0, depenseTotal: 0, nbJours: 0 }
    }
    parResto[p.restaurant_id].venteTotal += p.vente_total || 0
    parResto[p.restaurant_id].beneficeTotal += p.benefice_sc || 0
    parResto[p.restaurant_id].depenseTotal += p.depense_total || 0
    parResto[p.restaurant_id].nbJours++
  })
  const detail_restaurants = restaurants
    .filter(r => parResto[r.id])
    .map(r => ({
      id: r.id,
      nom: r.nom,
      venteTotal: Math.round(parResto[r.id].venteTotal),
      beneficeTotal: Math.round(parResto[r.id].beneficeTotal),
      depenseTotal: Math.round(parResto[r.id].depenseTotal),
      nbJours: parResto[r.id].nbJours,
    }))
  return {
    id: lundi,
    semaine_debut: lundi,
    semaine_fin: getDimanche(lundi),
    nb_points: points.length,
    nb_restaurants: new Set(points.map(p => p.restaurant_id)).size,
    vente_total: Math.round(points.reduce((s, p) => s + (p.vente_total || 0), 0)),
    benefice_total: Math.round(points.reduce((s, p) => s + (p.benefice_sc || 0), 0)),
    depense_total: Math.round(points.reduce((s, p) => s + (p.depense_total || 0), 0)),
    detail_restaurants,
  }
}

function VariationBadge({ valeur, reference }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (reference == null || reference === 0) return null
  const pct = ((valeur - reference) / Math.abs(reference)) * 100
  const pos = pct >= 0
  return (
    <View style={[styles.varBadge, pos ? styles.varPos : styles.varNeg]}>
      <Text style={[styles.varTxt, pos ? styles.varTxtPos : styles.varTxtNeg]}>
        {pos ? '▲' : '▼'} {Math.abs(pct).toFixed(1)} %
      </Text>
    </View>
  )
}

export default function RapportsScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [rapports, setRapports] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [restaurants, setRestaurants] = useState([])
  const [restoFiltre, setRestoFiltre] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: restosData } = await supabase.from('restaurants').select('id, nom').order('nom')
    const restos = restosData || []
    setRestaurants(restos)
    await charger(restos)
    setLoading(false)
  }

  async function charger(restos) {
    try {
      const dateMin = new Date()
      dateMin.setMonth(dateMin.getMonth() - 3)
      const { data: points, error } = await supabase
        .from('points')
        .select('id, date, restaurant_id, vente_total, depense_total, benefice_sc')
        .gte('date', dateMin.toISOString().split('T')[0])
        .order('date', { ascending: false })
      if (error) throw error

      const parSemaine = {}
      ;(points || []).forEach(p => {
        const lundi = getLundi(p.date)
        if (!parSemaine[lundi]) parSemaine[lundi] = []
        parSemaine[lundi].push(p)
      })

      const liste = Object.keys(parSemaine)
        .sort((a, b) => b.localeCompare(a))
        .map(lundi => buildRapport(lundi, parSemaine[lundi], restos || restaurants))

      setRapports(liste)
    } catch (e) {
      console.error('[Rapports]', e.message)
    }
  }

  async function onRefresh() {
    setRefreshing(true)
    const { data: restosData } = await supabase.from('restaurants').select('id, nom').order('nom')
    const restos = restosData || []
    setRestaurants(restos)
    await charger(restos)
    setRefreshing(false)
  }

  async function exporterRapport(rapport) {
    setExporting(true)
    try {
      const detail = Array.isArray(rapport.detail_restaurants) ? rapport.detail_restaurants : []
      if (detail.length === 0) { alert('Aucune donnée pour ce rapport.'); setExporting(false); return }

      const filtreDetail = restoFiltre ? detail.filter(r => r.id === restoFiltre) : detail
      if (filtreDetail.length === 0) { alert('Aucune donnée pour ce restaurant.'); setExporting(false); return }

      const venteT = filtreDetail.reduce((s, r) => s + (r.venteTotal || 0), 0)
      const benefT = filtreDetail.reduce((s, r) => s + (r.beneficeTotal || 0), 0)
      const depT = filtreDetail.reduce((s, r) => s + (r.depenseTotal || 0), 0)
      const restoNom = restoFiltre ? (restaurants.find(r => r.id === restoFiltre)?.nom || 'Restaurant') : 'Tous les restaurants'

      const lignesDetail = filtreDetail.length > 1 ? filtreDetail.map(r => `
        <tr>
          <td>${r.nom || '—'}</td>
          <td style="color:#BA7517;font-weight:600">${(r.venteTotal || 0).toLocaleString('fr-FR')} F</td>
          <td style="color:${(r.beneficeTotal || 0) >= 0 ? '#2D7D46' : '#A32D2D'};font-weight:600">${(r.beneficeTotal || 0).toLocaleString('fr-FR')} F</td>
          <td style="color:#A32D2D;font-weight:600">${(r.depenseTotal || 0).toLocaleString('fr-FR')} F</td>
          <td style="text-align:center">${r.nbJours || 0}j</td>
        </tr>
      `).join('') : ''

      const html = `<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 30px; color: #1a1a1a; }
          h1 { color: #185FA5; font-size: 20px; margin-bottom: 4px; }
          .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
          .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; }
          .kpi { flex: 1; background: #F5F5F5; border-radius: 10px; padding: 14px; text-align: center; }
          .kpi-label { font-size: 11px; color: #888; margin-bottom: 6px; }
          .kpi-val { font-size: 15px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
          th { background: #185FA5; color: white; padding: 8px 12px; text-align: left; font-size: 12px; }
          td { padding: 8px 12px; border-bottom: 1px solid #eee; }
          .footer { margin-top: 30px; font-size: 10px; color: #bbb; text-align: right; }
        </style>
      </head><body>
        <h1>📊 Rapport Hebdomadaire — SAMER</h1>
        <div class="sub">${restoNom} · Semaine du ${formatDateFr(rapport.semaine_debut)} au ${formatDateFr(rapport.semaine_fin)}</div>
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-label">Ventes totales</div><div class="kpi-val" style="color:#BA7517">${venteT.toLocaleString('fr-FR')} F</div></div>
          <div class="kpi"><div class="kpi-label">Bénéfice SC</div><div class="kpi-val" style="color:${benefT >= 0 ? '#2D7D46' : '#A32D2D'}">${benefT.toLocaleString('fr-FR')} F</div></div>
          <div class="kpi"><div class="kpi-label">Dépenses</div><div class="kpi-val" style="color:#A32D2D">${depT.toLocaleString('fr-FR')} F</div></div>
        </div>
        ${lignesDetail ? `<table><tr><th>Restaurant</th><th>Ventes</th><th>Bénéfice SC</th><th>Dépenses</th><th>Jours</th></tr>${lignesDetail}</table>` : ''}
        <div class="footer">Généré le ${new Date().toLocaleString('fr-FR')} · SAMER</div>
      </body></html>`

      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          const blob = new Blob([html], { type: 'text/html' })
          const file = new File([blob], `rapport-${rapport.semaine_debut}.html`, { type: 'text/html' })
          try {
            await navigator.share({ title: `Rapport — ${restoNom}`, files: [file] })
          } catch (e) {
            if (e.name !== 'AbortError') throw e
          }
        } else {
          await Print.printAsync({ html })
        }
      } else {
        const result = await Print.printToFileAsync({ html })
        if (!result?.uri) throw new Error('Fichier PDF non généré')
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: `Rapport — ${restoNom}`, UTI: 'com.adobe.pdf' })
        } else {
          alert("Le partage n'est pas disponible sur cet appareil.")
        }
      }
    } catch (e) {
      console.error('[exporterRapport]', e)
      alert(`Erreur export : ${e.message}`)
    }
    setExporting(false)
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backTxt}>← Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>Rapports hebdomadaires</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#534AB7" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Rapports hebdomadaires</Text>
        <Text style={styles.headerSub}>3 derniers mois · tous restaurants</Text>
      </View>

      {restaurants.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.restoBar}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 10 }}
        >
          <TouchableOpacity
            style={[styles.restoChip, !restoFiltre && styles.restoChipActive]}
            onPress={() => setRestoFiltre(null)}
          >
            <Text style={[styles.restoChipTxt, !restoFiltre && styles.restoChipTxtActive]}>Tous</Text>
          </TouchableOpacity>
          {restaurants.map(r => (
            <TouchableOpacity
              key={r.id}
              style={[styles.restoChip, restoFiltre === r.id && styles.restoChipActive]}
              onPress={() => setRestoFiltre(restoFiltre === r.id ? null : r.id)}
            >
              <Text style={[styles.restoChipTxt, restoFiltre === r.id && styles.restoChipTxtActive]} numberOfLines={1}>
                {r.nom}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <ScrollView
        style={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#534AB7" />}
      >
        {rapports.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitre}>Aucune donnée</Text>
            <Text style={styles.emptySub}>Aucun point trouvé sur les 3 derniers mois.</Text>
          </View>
        ) : (
          rapports.map((r, idx) => (
            <RapportCard
              key={r.id}
              rapport={r}
              precedent={rapports[idx + 1] || null}
              restoFiltre={restoFiltre}
              onPartager={() => exporterRapport(r)}
              exporting={exporting}
            />
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function RapportCard({ rapport, precedent, restoFiltre, onPartager, exporting }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [expanded, setExpanded] = useState(false)
  const detail = rapport.detail_restaurants || []

  const filtreDetail = restoFiltre ? detail.filter(r => r.id === restoFiltre) : null
  const venteAff = filtreDetail ? filtreDetail.reduce((s, r) => s + r.venteTotal, 0) : rapport.vente_total
  const benefAff = filtreDetail ? filtreDetail.reduce((s, r) => s + r.beneficeTotal, 0) : rapport.benefice_total
  const depAff = filtreDetail ? filtreDetail.reduce((s, r) => s + r.depenseTotal, 0) : rapport.depense_total

  const prevDetail = restoFiltre ? (precedent?.detail_restaurants || []).filter(r => r.id === restoFiltre) : null
  const prevVente = prevDetail ? prevDetail.reduce((s, r) => s + r.venteTotal, 0) : precedent?.vente_total
  const prevBenef = prevDetail ? prevDetail.reduce((s, r) => s + r.beneficeTotal, 0) : precedent?.benefice_total
  const prevDep = prevDetail ? prevDetail.reduce((s, r) => s + r.depenseTotal, 0) : precedent?.depense_total

  const detailAff = filtreDetail || detail

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
          <Text style={styles.cardSemaine}>
            📅 Semaine du {formatDateFr(rapport.semaine_debut)} au {formatDateFr(rapport.semaine_fin)}
          </Text>
          <Text style={styles.cardMeta}>
            {rapport.nb_restaurants} restaurant{rapport.nb_restaurants > 1 ? 's' : ''} · {rapport.nb_points} point{rapport.nb_points > 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.partagerBtn, exporting && { opacity: 0.5 }]}
          onPress={onPartager}
          disabled={exporting}
        >
          <Text style={styles.partagerTxt}>{exporting ? '⏳' : '📤 Partager'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ paddingLeft: 8 }}>
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.kpiRow}>
        <View style={styles.kpiItem}>
          <Text style={styles.kpiLabel}>Ventes</Text>
          <Text style={styles.kpiVente}>{fmt(venteAff)}</Text>
          <VariationBadge valeur={venteAff} reference={prevVente} />
        </View>
        <View style={styles.kpiItem}>
          <Text style={styles.kpiLabel}>Bénéfice SC</Text>
          <Text style={[styles.kpiBenef, benefAff < 0 && styles.kpiNeg]}>{fmt(benefAff)}</Text>
          <VariationBadge valeur={benefAff} reference={prevBenef} />
        </View>
        <View style={styles.kpiItem}>
          <Text style={styles.kpiLabel}>Dépenses</Text>
          <Text style={styles.kpiDep}>{fmt(depAff)}</Text>
          <VariationBadge valeur={depAff} reference={prevDep} />
        </View>
      </View>

      {expanded && detailAff.length > 0 && (
        <View style={styles.detailBox}>
          <Text style={styles.detailTitre}>Détail par restaurant</Text>
          {detailAff.map(resto => (
            <View key={resto.id} style={styles.restoRow}>
              <Text style={styles.restoNom} numberOfLines={1}>{resto.nom}</Text>
              <View style={styles.restoStats}>
                <View style={styles.restoStat}>
                  <Text style={styles.restoStatLabel}>Ventes</Text>
                  <Text style={styles.restoStatVal}>{fmt(resto.venteTotal)}</Text>
                </View>
                <View style={styles.restoStat}>
                  <Text style={styles.restoStatLabel}>Bénéf.</Text>
                  <Text style={[styles.restoStatVal, resto.beneficeTotal < 0 && styles.kpiNeg]}>{fmt(resto.beneficeTotal)}</Text>
                </View>
                <View style={styles.restoStat}>
                  <Text style={styles.restoStatLabel}>Jours</Text>
                  <Text style={styles.restoStatVal}>{resto.nbJours}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
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
  body: { flex: 1, padding: 16 },

  restoBar: { backgroundColor: colors.surface, maxHeight: 50, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  restoChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderLight },
  restoChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  restoChipTxt: { fontSize: 13, color: colors.textMuted },
  restoChipTxtActive: { color: '#fff', fontWeight: '600' },

  emptyBox: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitre: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: 8 },
  emptySub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  card: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 14, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  cardSemaine: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  cardMeta: { fontSize: 12, color: colors.textMuted },
  chevron: { fontSize: 12, color: colors.textMuted },

  partagerBtn: { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  partagerTxt: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },

  kpiRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.borderLight },
  kpiItem: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRightWidth: 1, borderRightColor: colors.borderLight },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  kpiVente: { fontSize: 13, fontWeight: '700', color: colors.primary },
  kpiBenef: { fontSize: 13, fontWeight: '700', color: '#27A369' },
  kpiDep: { fontSize: 13, fontWeight: '700', color: '#E05050' },
  kpiNeg: { color: '#E05050' },

  varBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  varPos: { backgroundColor: colors.successLight },
  varNeg: { backgroundColor: colors.errorLight },
  varTxt: { fontSize: 10, fontWeight: '600' },
  varTxtPos: { color: '#1B7E4F' },
  varTxtNeg: { color: '#C0392B' },

  detailBox: { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  detailTitre: { fontSize: 12, fontWeight: '700', color: colors.primary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  restoRow: { marginBottom: 10 },
  restoNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  restoStats: { flexDirection: 'row', gap: 8 },
  restoStat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 8, alignItems: 'center' },
  restoStatLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  restoStatVal: { fontSize: 12, fontWeight: '700', color: colors.text },
}) }
