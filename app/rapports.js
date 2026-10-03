import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import OngletAnalyse from '../components/rapports/OngletAnalyse'
import { retour } from '../lib/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import {
  ActivityIndicator,
  Alert,
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
import { listerMoisAvecTotaux, chargerRapportMensuel } from '../lib/rapportMensuel'
import { chargerAnalyse } from '../lib/analyseMoisDb'
import { exporterPptx, exporterXlsx, exporterPdf } from '../lib/exportRapportMensuel'
import '../lib/webAlert'   // remplace Alert.alert par les dialogues du navigateur

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
  const [onglet, setOnglet] = useState('analyse')
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
        <h1>Rapport hebdomadaire — SAMER</h1>
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

  const enTete = (
    <View style={styles.header}>
      <View style={styles.headerLigne}>
        <TouchableOpacity onPress={() => retour()} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCentre}>
          <View style={styles.headerIcone}><MaterialCommunityIcons name="file-chart" size={18} color="#FFFFFF" /></View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.headerTitre}>Rapports</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {onglet === 'analyse' ? 'Analyse complète d’un mois'
                : onglet === 'hebdo' ? '3 derniers mois · semaine par semaine'
                  : 'Mois clos · PowerPoint, Excel et PDF'}
            </Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>
    </View>
  )

  const onglets = (
    <View style={styles.ongletBar}>
      {[['analyse', 'Analyse', 'chart-box-outline'], ['hebdo', 'Hebdo', 'calendar-week'], ['mensuel', 'Exports', 'file-export-outline']].map(([cle, libelle, icone]) => {
        const actif = onglet === cle
        return (
          <TouchableOpacity key={cle} style={[styles.ongletBtn, actif && styles.ongletBtnActif]} onPress={() => setOnglet(cle)}>
            <MaterialCommunityIcons name={icone} size={16} color={actif ? '#FFFFFF' : colors.primary} />
            <Text style={[styles.ongletTxt, actif && styles.ongletTxtActif]}>{libelle}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )

  if (onglet === 'analyse') {
    return (
      <SafeAreaView style={styles.container}>
        {enTete}
        {onglets}
        <OngletAnalyse onExporter={() => setOnglet('mensuel')} />
      </SafeAreaView>
    )
  }

  if (onglet === 'mensuel') {
    return (
      <SafeAreaView style={styles.container}>
        {enTete}
        {onglets}
        <OngletMensuel />
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        {enTete}
        {onglets}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {enTete}
      {onglets}

      {restaurants.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.restoBar, { flexGrow: 0 }]}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {rapports.length === 0 ? (
          <View style={styles.emptyBox}>
            <MaterialCommunityIcons name="chart-box-outline" size={44} color={colors.textMuted} />
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

// ─── Onglet « Mensuel » ────────────────────────────────────────────────────
// Liste les mois CLOS avec leurs chiffres clés (lecture légère), et génère à
// la demande le rapport complet. L'agrégation complète prend une vingtaine de
// secondes : on ne la lance qu'au clic sur un bouton d'export.

const FORMATS = [
  { cle: 'pptx', libelle: 'PowerPoint', icone: 'file-powerpoint-outline', couleur: '#C2410C', exporter: exporterPptx },
  { cle: 'xlsx', libelle: 'Excel', icone: 'file-excel-outline', couleur: '#15803D', exporter: exporterXlsx },
  { cle: 'pdf', libelle: 'PDF', icone: 'file-pdf-box', couleur: '#B91C1C', exporter: exporterPdf },
]

function OngletMensuel() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [mois, setMois] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erreur, setErreur] = useState(null)
  // { mois, format, etape } pendant une génération, null sinon
  const [travail, setTravail] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setErreur(null)
      setMois(await listerMoisAvecTotaux())
    } catch (e) {
      console.error('[RapportMensuel] chargement', e)
      setErreur(e.message)
    }
    setLoading(false)
    setRefreshing(false)
  }

  async function exporter(m, format) {
    if (travail) return
    setTravail({ mois: m.mois, format: format.cle, etape: 'Préparation…' })
    try {
      const suivre = etape => setTravail(t => (t ? { ...t, etape } : t))
      const rapport = await chargerRapportMensuel(m.mois, suivre)
      // L'analyse (faits, résultat net, POS, équipe) rejoint l'export ; si elle
      // échoue, le rapport sort quand même, sans ces sections.
      rapport.analyse = await chargerAnalyse(m.mois, suivre).catch(e => {
        console.warn('[RapportMensuel] analyse indisponible', e?.message)
        return null
      })
      await format.exporter(rapport, suivre)
    } catch (e) {
      console.error('[RapportMensuel] export', e)
      Alert.alert('Export impossible', e.message || 'Une erreur est survenue.')
    }
    setTravail(null)
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.body}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); charger() }}
          tintColor={colors.primary}
        />
      }
    >
      {erreur && (
        <View style={styles.erreurBox}>
          <Text style={styles.erreurTxt}>Impossible de charger les mois : {erreur}</Text>
        </View>
      )}

      {mois.length === 0 && !erreur ? (
        <View style={styles.emptyBox}>
          <MaterialCommunityIcons name="folder-open-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyTitre}>Aucun mois clos</Text>
          <Text style={styles.emptySub}>
            Le rapport mensuel ne porte que sur des mois terminés. Le mois en cours
            apparaîtra ici une fois achevé.
          </Text>
        </View>
      ) : (
        mois.map(m => (
          <MoisCard
            key={m.mois}
            mois={m}
            travail={travail?.mois === m.mois ? travail : null}
            bloque={!!travail}
            onExporter={format => exporter(m, format)}
          />
        ))
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

function MoisCard({ mois, travail, bloque, onExporter }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const marge = mois.ca ? Math.round((mois.benefice / mois.ca) * 1000) / 10 : null

  return (
    <View style={styles.card}>
      <View style={styles.moisHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.moisTitre}>{mois.label}</Text>
          <Text style={styles.cardMeta}>
            {mois.nbRestaurants} restaurant{mois.nbRestaurants > 1 ? 's' : ''} ·{' '}
            {mois.nbValides} journée{mois.nbValides > 1 ? 's' : ''} validée
            {mois.nbValides > 1 ? 's' : ''}
            {mois.nbPoints !== mois.nbValides ? ` sur ${mois.nbPoints}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.kpiRow}>
        <View style={styles.kpiItem}>
          <Text style={styles.kpiLabel}>Chiffre d'affaires</Text>
          <Text style={styles.kpiVente}>{fmt(mois.ca)}</Text>
        </View>
        <View style={styles.kpiItem}>
          <Text style={styles.kpiLabel}>Bénéfice</Text>
          <Text style={[styles.kpiBenef, mois.benefice < 0 && styles.kpiNeg]}>
            {fmt(mois.benefice)}
          </Text>
        </View>
        <View style={[styles.kpiItem, { borderRightWidth: 0 }]}>
          <Text style={styles.kpiLabel}>Marge</Text>
          <Text style={styles.kpiBenef}>{marge == null ? '—' : `${marge} %`}</Text>
        </View>
      </View>

      {travail ? (
        <View style={styles.travailBox}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.travailTxt} numberOfLines={1}>
            {travail.etape}
          </Text>
        </View>
      ) : (
        <View style={styles.formatsRow}>
          {FORMATS.map(f => (
            <TouchableOpacity
              key={f.cle}
              style={[styles.formatBtn, bloque && styles.formatBtnBloque]}
              disabled={bloque}
              onPress={() => onExporter(f)}
            >
              <MaterialCommunityIcons name={f.icone} size={22} color={f.couleur} />
              <Text style={styles.formatTxt}>{f.libelle}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
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
            Semaine du {formatDateFr(rapport.semaine_debut)} au {formatDateFr(rapport.semaine_fin)}
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
          {exporting
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <MaterialCommunityIcons name="share-variant-outline" size={18} color={colors.primary} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ paddingLeft: 8 }}>
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textMuted} />
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
  body: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },

  ongletBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  ongletBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 42,
    borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  ongletBtnActif: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  ongletTxt: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
  ongletTxtActif: { color: '#FFFFFF', fontWeight: '800' },

  moisHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  moisTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 2 },

  formatsRow: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.borderLight },
  formatBtn: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 14, paddingVertical: 12, alignItems: 'center', gap: 4 },
  formatBtnBloque: { opacity: 0.4 },
  formatTxt: { fontSize: 12.5, fontWeight: '800', color: colors.text },

  travailBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.borderLight },
  travailTxt: { flex: 1, fontSize: 13, color: colors.textSecondary },

  erreurBox: { backgroundColor: colors.errorLight, borderRadius: 10, padding: 14, marginBottom: 14 },
  erreurTxt: { fontSize: 13, color: colors.errorDark },

  restoBar: { maxHeight: 56, marginTop: 4 },
  restoChip: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
  restoChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  restoChipTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  restoChipTxtActive: { color: '#fff', fontWeight: '600' },

  emptyBox: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyTitre: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 12, marginBottom: 6 },
  emptySub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  card: { backgroundColor: colors.surface, borderRadius: 20, marginBottom: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  cardSemaine: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 2 },
  cardMeta: { fontSize: 12, color: colors.textMuted },

  partagerBtn: { backgroundColor: colors.primaryLight, borderRadius: 12, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },

  kpiRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.borderLight },
  kpiItem: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRightWidth: 1, borderRightColor: colors.borderLight },
  kpiLabel: { fontSize: 10.5, color: colors.textMuted, marginBottom: 4, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiVente: { fontSize: 14, fontWeight: '800', color: colors.text },
  kpiBenef: { fontSize: 14, fontWeight: '800', color: colors.successDark },
  kpiDep: { fontSize: 14, fontWeight: '800', color: colors.error },
  kpiNeg: { color: colors.error },

  varBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  varPos: { backgroundColor: colors.successLight },
  varNeg: { backgroundColor: colors.errorLight },
  varTxt: { fontSize: 10, fontWeight: '600' },
  varTxtPos: { color: colors.successDark },
  varTxtNeg: { color: colors.error },

  detailBox: { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  detailTitre: { fontSize: 12, fontWeight: '700', color: colors.primary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  restoRow: { marginBottom: 10 },
  restoNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  restoStats: { flexDirection: 'row', gap: 8 },
  restoStat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 8, alignItems: 'center' },
  restoStatLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  restoStatVal: { fontSize: 12, fontWeight: '700', color: colors.text },
}) }
