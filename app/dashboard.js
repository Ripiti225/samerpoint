import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Dimensions, Modal,
  SafeAreaView, ScrollView, StyleSheet,
  Text, TouchableOpacity, View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import {
  VictoryArea, VictoryAxis, VictoryBar,
  VictoryChart, VictoryLabel, VictoryLine,
  VictoryPie, VictoryTheme
} from 'victory-native'
import { useApp } from '../context/AppContext'
import { getPointsPeriode } from '../lib/api'
import { supabase } from '../lib/supabase'

const { width } = Dimensions.get('window')
const CHART_WIDTH = width - 48

const PERIODES = [
  { label: "Aujourd'hui", key: 'today' },
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: '📅 Période', key: 'custom' },
]

export default function DashboardScreen() {
  const {
    totalDepenses, totalPaie, totalFournisseurs,
    depensesJour, ventesJour, totalVentes,
    resteEspeces, fc, beneficeSC,
    restaurantId, restaurantNom, pointId,
    roleActif,
  } = useApp()

  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'

  const [periodeKey, setPeriodeKey] = useState('today')
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalCalendrier, setModalCalendrier] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [etapeCalendrier, setEtapeCalendrier] = useState('debut')

  // Cumul shifts pour aujourd'hui
  const [cumulShifts, setCumulShifts] = useState(null)
  const [chargementShifts, setChargementShifts] = useState(false)

  useEffect(() => {
    if (periodeKey !== 'today' && periodeKey !== 'custom') chargerPoints()
  }, [periodeKey, restaurantId])

  useEffect(() => {
    if (periodeKey === 'today' && pointId) chargerCumulShifts()
  }, [periodeKey, pointId])

  async function chargerCumulShifts() {
    setChargementShifts(true)
    const { data: shifts } = await supabase
      .from('points_shifts')
      .select('*')
      .eq('point_id', pointId)

    if (shifts && shifts.length > 0) {
      setCumulShifts({
        depenses: shifts.reduce((sum, s) => sum + (s.depenses || 0), 0),
        fournisseurs: shifts.reduce((sum, s) => sum + (s.fournisseurs || 0), 0),
        kdo: shifts.reduce((sum, s) => sum + (s.kdo || 0), 0),
        retour: shifts.reduce((sum, s) => sum + (s.retour || 0), 0),
        yangoCse: shifts.reduce((sum, s) => sum + (s.yango_cse || 0), 0),
        glovoCse: shifts.reduce((sum, s) => sum + (s.glovo_cse || 0), 0),
        wave: shifts.reduce((sum, s) => sum + (s.wave || 0), 0),
        djamo: shifts.reduce((sum, s) => sum + (s.djamo || 0), 0),
        om: shifts.reduce((sum, s) => sum + (s.om || 0), 0),
        espece: shifts.reduce((sum, s) => sum + (s.espece || 0), 0),
        venteTotal: shifts.reduce((sum, s) => sum + (s.vente_shift || 0), 0),
        nbShifts: shifts.length,
      })
    } else {
      setCumulShifts(null)
    }
    setChargementShifts(false)
  }

  function getDateRange() {
    const today = new Date()
    const fmt = d => d.toISOString().split('T')[0]
    if (periodeKey === '7days') {
      const d = new Date(today); d.setDate(d.getDate() - 6)
      return { debut: fmt(d), fin: fmt(today) }
    }
    if (periodeKey === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { debut: fmt(d), fin: fmt(today) }
    }
    if (periodeKey === 'lastmonth') {
      const debut = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const fin = new Date(today.getFullYear(), today.getMonth(), 0)
      return { debut: fmt(debut), fin: fmt(fin) }
    }
    if (periodeKey === 'custom') return { debut: dateDebut, fin: dateFin }
    return null
  }

  async function chargerPoints() {
    if (!restaurantId) return
    setLoading(true)
    const range = getDateRange()
    if (range && range.debut && range.fin) {
      const data = await getPointsPeriode(restaurantId, range.debut, range.fin)
      setPoints(data)
    }
    setLoading(false)
  }

  function ouvrirCalendrier() {
    setDateDebut(''); setDateFin('')
    setEtapeCalendrier('debut')
    setModalCalendrier(true)
  }

  function choisirDate(day) {
    if (etapeCalendrier === 'debut') {
      setDateDebut(day.dateString)
      setEtapeCalendrier('fin')
    } else {
      if (day.dateString < dateDebut) {
        setDateDebut(day.dateString)
      } else {
        setDateFin(day.dateString)
      }
    }
  }

  async function confirmerPeriode() {
    if (!dateDebut || !dateFin) return
    setModalCalendrier(false)
    setPeriodeKey('custom')
    setLoading(true)
    const data = await getPointsPeriode(restaurantId, dateDebut, dateFin)
    setPoints(data)
    setLoading(false)
  }

  function markedDates() {
    const marked = {}
    if (dateDebut) marked[dateDebut] = { selected: true, selectedColor: '#EF9F27', startingDay: true }
    if (dateFin) marked[dateFin] = { selected: true, selectedColor: '#EF9F27', endingDay: true }
    if (dateDebut && dateFin) {
      let current = new Date(dateDebut)
      current.setDate(current.getDate() + 1)
      while (current < new Date(dateFin)) {
        const str = current.toISOString().split('T')[0]
        marked[str] = { selected: true, selectedColor: '#FAEEDA', selectedTextColor: '#412402' }
        current.setDate(current.getDate() + 1)
      }
    }
    return marked
  }

  function totalPeriode(champ) {
    return points.reduce((sum, p) => sum + (parseFloat(p[champ]) || 0), 0)
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' F' }
  function fmtFull(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]}`
  }

  function formatDateLong(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function tauxRenta(ventes, benefice) {
    if (!ventes || ventes === 0) return 0
    return (benefice / ventes * 100)
  }

  const isToday = periodeKey === 'today'

  // Pour aujourd'hui — utiliser le cumul shifts si disponible
  function ventesToday() {
    if (cumulShifts) return cumulShifts.venteTotal
    return totalVentes()
  }

  function depensesToday() {
    if (cumulShifts) return cumulShifts.depenses + cumulShifts.fournisseurs
    return totalDepenses()
  }

  function beneficeToday() {
    if (cumulShifts) {
      // BSC = (YangoTab×0.77) + (GlovoTab×0.705) + (OM×0.99) + (Wave×0.99) + (Djamo×0.99) + Reste
      const yangoTab = parseFloat(ventesJour.yangoTab) || 0
      const glovoTab = parseFloat(ventesJour.glovoTab) || 0
      const om = cumulShifts.om
      const wave = cumulShifts.wave
      const djamo = cumulShifts.djamo
      const reste = ventesToday() - depensesToday() - cumulShifts.yangoCse - cumulShifts.glovoCse
        - wave - om - djamo - cumulShifts.kdo - cumulShifts.retour
      return (yangoTab * 0.77) + (glovoTab * 0.705) + (om * 0.99) + (wave * 0.99) + (djamo * 0.99) + reste
    }
    return beneficeSC()
  }

  const ventesPeriode = isToday ? ventesToday() : totalPeriode('vente_total')
  const depensesPeriode = isToday ? depensesToday() : totalPeriode('depense_total')
  const beneficePeriode = isToday ? beneficeToday() : totalPeriode('benefice_sc')
  const nbJours = isToday ? 1 : points.length

  function titrePeriode() {
    if (periodeKey === 'today') return "Aujourd'hui"
    if (periodeKey === '7days') return '7 derniers jours'
    if (periodeKey === 'month') return 'Ce mois'
    if (periodeKey === 'lastmonth') return 'Mois précédent'
    if (periodeKey === 'custom' && dateDebut && dateFin)
      return `${formatDate(dateDebut)} → ${formatDate(dateFin)}`
    return 'Période personnalisée'
  }

  const dataVentes = points.map((p, i) => ({
    x: i + 1, y: (p.vente_total || 0) / 1000, label: formatDate(p.date)
  }))
  const dataBenefice = points.map((p, i) => ({
    x: i + 1, y: (p.benefice_sc || 0) / 1000
  }))
  const dataRentabilite = points.map((p, i) => ({
    x: i + 1, y: tauxRenta(p.vente_total || 0, p.benefice_sc || 0)
  }))

  const dataCamembert = isToday && cumulShifts ? [
    { x: 'Yango CSE', y: cumulShifts.yangoCse },
    { x: 'Glovo CSE', y: cumulShifts.glovoCse },
    { x: 'Wave', y: cumulShifts.wave },
    { x: 'OM', y: cumulShifts.om },
    { x: 'Djamo', y: cumulShifts.djamo },
    { x: 'Espèces', y: cumulShifts.espece },
  ].filter(d => d.y > 0) : isToday ? [
    { x: 'Yango', y: (parseFloat(ventesJour.yangoTab) || 0) + (parseFloat(ventesJour.yangoCse) || 0) },
    { x: 'Glovo', y: (parseFloat(ventesJour.glovoTab) || 0) + (parseFloat(ventesJour.glovoCse) || 0) },
    { x: 'Wave', y: parseFloat(ventesJour.wave) || 0 },
    { x: 'OM', y: parseFloat(ventesJour.om) || 0 },
    { x: 'Djamo', y: parseFloat(ventesJour.djamo) || 0 },
    { x: 'Espèces', y: Math.max(resteEspeces(), 0) },
  ].filter(d => d.y > 0) : []

  const PIE_COLORS = ['#EF9F27', '#3B6D11', '#185FA5', '#993C1D', '#534AB7', '#888']

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Tableau de bord</Text>
          <Text style={styles.headerSub}>{restaurantNom || 'Mon restaurant'}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodeBar}>
        {PERIODES.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodeBtn, periodeKey === p.key && styles.periodeBtnActive]}
            onPress={() => p.key === 'custom' ? ouvrirCalendrier() : setPeriodeKey(p.key)}
          >
            <Text style={[styles.periodeTxt, periodeKey === p.key && styles.periodeTxtActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Bannière shifts */}
      {isToday && cumulShifts && (
        <View style={styles.shiftsBanner}>
          <Text style={styles.shiftsBannerTxt}>
            ⏱️ {cumulShifts.nbShifts} shift(s) — Vente shifts : {fmtFull(cumulShifts.venteTotal)}
          </Text>
        </View>
      )}

      {periodeKey !== 'today' && (
        <View style={styles.periodeBanner}>
          <Text style={styles.periodeBannerTxt}>📅 {titrePeriode()}</Text>
          <Text style={styles.periodeBannerSub}>{nbJours} point(s) validé(s)</Text>
        </View>
      )}

      {loading || chargementShifts ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement des données...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {!isToday && points.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTxt}>Aucun point validé sur cette période</Text>
              <Text style={styles.emptySub}>Les points doivent être validés pour apparaître ici</Text>
            </View>
          ) : (
            <>
              {/* KPIs */}
              <View style={styles.kpiGrid}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Ventes {isToday ? 'du jour' : `(${nbJours}j)`}</Text>
                  <Text style={[styles.kpiValue, { color: '#BA7517' }]}>{fmtFull(ventesPeriode)}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Dépenses</Text>
                  <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{fmtFull(depensesPeriode)}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Bénéfice SC</Text>
                  <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{fmtFull(beneficePeriode)}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Rentabilité</Text>
                  <Text style={[styles.kpiValue, { color: '#185FA5' }]}>
                    {tauxRenta(ventesPeriode, beneficePeriode).toFixed(1)}%
                  </Text>
                </View>
              </View>

              {/* Graphiques période */}
              {!isToday && points.length > 1 && (
                <>
                  <View style={styles.graphCard}>
                    <Text style={styles.graphTitre}>📈 Évolution des ventes (en milliers FCFA)</Text>
                    <VictoryChart
                      width={CHART_WIDTH} height={200}
                      theme={VictoryTheme.material}
                      padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
                    >
                      <VictoryAxis
                        tickValues={points.map((_, i) => i + 1)}
                        tickFormat={points.map(p => formatDate(p.date))}
                        style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }}
                      />
                      <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                      <VictoryLine
                        data={dataVentes}
                        style={{ data: { stroke: '#EF9F27', strokeWidth: 2.5 } }}
                        interpolation="monotoneX"
                      />
                      <VictoryLine
                        data={dataBenefice}
                        style={{ data: { stroke: '#3B6D11', strokeWidth: 2, strokeDasharray: '4,4' } }}
                        interpolation="monotoneX"
                      />
                    </VictoryChart>
                    <View style={styles.legende}>
                      <View style={styles.legendeItem}>
                        <View style={[styles.legendeColor, { backgroundColor: '#EF9F27' }]} />
                        <Text style={styles.legendeTxt}>Ventes</Text>
                      </View>
                      <View style={styles.legendeItem}>
                        <View style={[styles.legendeColor, { backgroundColor: '#3B6D11' }]} />
                        <Text style={styles.legendeTxt}>Bénéfice SC</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.graphCard}>
                    <Text style={styles.graphTitre}>📊 Ventes vs Dépenses (en milliers FCFA)</Text>
                    <VictoryChart
                      width={CHART_WIDTH} height={200}
                      theme={VictoryTheme.material}
                      padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
                      domainPadding={{ x: 20 }}
                    >
                      <VictoryAxis
                        tickValues={points.map((_, i) => i + 1)}
                        tickFormat={points.map(p => formatDate(p.date))}
                        style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }}
                      />
                      <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                      <VictoryBar
                        data={points.map((p, i) => ({ x: i + 1 - 0.2, y: (p.vente_total || 0) / 1000 }))}
                        style={{ data: { fill: '#EF9F27', width: 8 } }}
                      />
                      <VictoryBar
                        data={points.map((p, i) => ({ x: i + 1 + 0.2, y: (p.depense_total || 0) / 1000 }))}
                        style={{ data: { fill: '#A32D2D', width: 8, opacity: 0.7 } }}
                      />
                    </VictoryChart>
                    <View style={styles.legende}>
                      <View style={styles.legendeItem}>
                        <View style={[styles.legendeColor, { backgroundColor: '#EF9F27' }]} />
                        <Text style={styles.legendeTxt}>Ventes</Text>
                      </View>
                      <View style={styles.legendeItem}>
                        <View style={[styles.legendeColor, { backgroundColor: '#A32D2D' }]} />
                        <Text style={styles.legendeTxt}>Dépenses</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.graphCard}>
                    <Text style={styles.graphTitre}>📉 Évolution de la rentabilité (%)</Text>
                    <VictoryChart
                      width={CHART_WIDTH} height={200}
                      theme={VictoryTheme.material}
                      padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
                    >
                      <VictoryAxis
                        tickValues={points.map((_, i) => i + 1)}
                        tickFormat={points.map(p => formatDate(p.date))}
                        style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }}
                      />
                      <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                      <VictoryArea
                        data={dataRentabilite}
                        style={{ data: { fill: '#185FA520', stroke: '#185FA5', strokeWidth: 2 } }}
                        interpolation="monotoneX"
                      />
                    </VictoryChart>
                  </View>

                  <View style={styles.graphCard}>
                    <Text style={styles.graphTitre}>🏆 Bénéfice SC par jour (en milliers FCFA)</Text>
                    <VictoryChart
                      width={CHART_WIDTH} height={200}
                      theme={VictoryTheme.material}
                      padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
                      domainPadding={{ x: 15 }}
                    >
                      <VictoryAxis
                        tickValues={points.map((_, i) => i + 1)}
                        tickFormat={points.map(p => formatDate(p.date))}
                        style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }}
                      />
                      <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                      <VictoryBar
                        data={points.map((p, i) => ({
                          x: i + 1, y: (p.benefice_sc || 0) / 1000,
                          fill: (p.benefice_sc || 0) >= 0 ? '#3B6D11' : '#A32D2D'
                        }))}
                        style={{ data: { fill: ({ datum }) => datum.fill, width: 12 } }}
                      />
                    </VictoryChart>
                  </View>
                </>
              )}

              {/* Camembert aujourd'hui */}
              {isToday && dataCamembert.length > 0 && (
                <View style={styles.graphCard}>
                  <Text style={styles.graphTitre}>🥧 Répartition des canaux de vente</Text>
                  <View style={styles.pieContainer}>
                    <VictoryPie
                      data={dataCamembert}
                      width={CHART_WIDTH * 0.6}
                      height={200}
                      colorScale={PIE_COLORS}
                      innerRadius={50}
                      labelRadius={80}
                      style={{ labels: { fontSize: 8, fill: '#555' } }}
                      labelComponent={<VictoryLabel />}
                    />
                    <View style={styles.pieLegend}>
                      {dataCamembert.map((d, i) => (
                        <View key={i} style={styles.pieLegendItem}>
                          <View style={[styles.legendeColor, { backgroundColor: PIE_COLORS[i] }]} />
                          <View>
                            <Text style={styles.pieLegendLabel}>{d.x}</Text>
                            <Text style={styles.pieLegendValue}>{fmtFull(d.y)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {/* Résultats aujourd'hui */}
              {isToday && (
                <>
                  {/* Cumul shifts */}
                  {cumulShifts && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitre}>⏱️ Cumul {cumulShifts.nbShifts} shift(s)</Text>
                      <View style={styles.resultCard}>
                        {[
                          { label: 'Dépenses caissiers', val: cumulShifts.depenses },
                          { label: 'Fournisseurs caissiers', val: cumulShifts.fournisseurs },
                          { label: 'KDO', val: cumulShifts.kdo },
                          { label: 'Retour', val: cumulShifts.retour },
                          { label: 'Yango CSE', val: cumulShifts.yangoCse },
                          { label: 'Glovo CSE', val: cumulShifts.glovoCse },
                          { label: 'Wave', val: cumulShifts.wave },
                          { label: 'Djamo', val: cumulShifts.djamo },
                          { label: 'Orange Money', val: cumulShifts.om },
                          { label: 'Espèces', val: cumulShifts.espece },
                        ].filter(r => r.val > 0).map((r, i, arr) => (
                          <View key={i} style={[styles.resultRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                            <Text style={styles.resultLabel}>{r.label}</Text>
                            <Text style={styles.resultValue}>{fmtFull(r.val)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Résultats financiers */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitre}>Résultats financiers</Text>
                    <View style={styles.resultCard}>
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Total ventes shifts</Text>
                        <Text style={[styles.resultValue, { color: '#BA7517' }]}>
                          {fmtFull(ventesPeriode)}
                        </Text>
                      </View>
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Total dépenses</Text>
                        <Text style={[styles.resultValue, { color: '#A32D2D' }]}>
                          {fmtFull(depensesPeriode)}
                        </Text>
                      </View>
                      {(parseFloat(ventesJour.yangoTab) || 0) > 0 && (
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Yango TAB</Text>
                          <Text style={styles.resultValue}>{fmtFull(parseFloat(ventesJour.yangoTab) || 0)}</Text>
                        </View>
                      )}
                      {(parseFloat(ventesJour.glovoTab) || 0) > 0 && (
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Glovo TAB</Text>
                          <Text style={styles.resultValue}>{fmtFull(parseFloat(ventesJour.glovoTab) || 0)}</Text>
                        </View>
                      )}
                      <View style={[styles.resultRow, { borderBottomWidth: 0 }]}>
                        <Text style={[styles.resultLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 14 }]}>
                          Bénéfice SC
                        </Text>
                        <Text style={[styles.resultValue, { color: '#3B6D11', fontSize: 16, fontWeight: '700' }]}>
                          {fmtFull(beneficePeriode)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Message motivation */}
                  <View style={styles.messageCard}>
                    {tauxRenta(ventesPeriode, beneficePeriode) >= 30 ? (
                      <Text style={styles.messageOk}>
                        🏆 Félicitations — bonne journée ! Rentabilité de {tauxRenta(ventesPeriode, beneficePeriode).toFixed(1)}%
                      </Text>
                    ) : tauxRenta(ventesPeriode, beneficePeriode) >= 15 ? (
                      <Text style={styles.messageWarn}>
                        💪 Courage — demain sera meilleure ! Rentabilité de {tauxRenta(ventesPeriode, beneficePeriode).toFixed(1)}%
                      </Text>
                    ) : (
                      <Text style={styles.messageBad}>
                        ⚠ Journée difficile — analysez les dépenses. Rentabilité de {tauxRenta(ventesPeriode, beneficePeriode).toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </>
              )}

              {/* Détail par jour — périodes */}
              {!isToday && points.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitre}>Détail par jour</Text>
                  <View style={styles.resultCard}>
                    {points.map((p, i) => (
                      <View key={i} style={[styles.resultRow, i === points.length - 1 && { borderBottomWidth: 0 }]}>
                        <View>
                          <Text style={[styles.resultLabel, { fontWeight: '500', color: '#1a1a1a' }]}>
                            {formatDateLong(p.date)}
                          </Text>
                          <Text style={styles.dateSmall}>Dép: {fmtFull(p.depense_total || 0)}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.resultValue}>{fmtFull(p.vente_total || 0)}</Text>
                          <Text style={[styles.dateSmall, {
                            color: (p.benefice_sc || 0) >= 0 ? '#3B6D11' : '#A32D2D'
                          }]}>
                            BSC: {fmtFull(p.benefice_sc || 0)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      {/* Modal calendrier */}
      <Modal visible={modalCalendrier} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Choisir une période</Text>
              <TouchableOpacity onPress={() => setModalCalendrier(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.etapeRow}>
              <View style={[styles.etapeBadge, etapeCalendrier === 'debut' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'debut' && styles.etapeTxtActive]}>
                  1. Date début
                </Text>
              </View>
              <View style={styles.etapeLine} />
              <View style={[styles.etapeBadge, etapeCalendrier === 'fin' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'fin' && styles.etapeTxtActive]}>
                  2. Date fin
                </Text>
              </View>
            </View>
            <View style={styles.selectedDates}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Début</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateDebut ? '#1a1a1a' : '#ccc' }}>
                  {dateDebut ? formatDateLong(dateDebut) : 'Non sélectionné'}
                </Text>
              </View>
              <Text style={{ fontSize: 16, color: '#EF9F27', marginHorizontal: 8 }}>→</Text>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Fin</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateFin ? '#1a1a1a' : '#ccc' }}>
                  {dateFin ? formatDateLong(dateFin) : 'Non sélectionné'}
                </Text>
              </View>
            </View>
            <Calendar
              onDayPress={choisirDate}
              markedDates={markedDates()}
              markingType="period"
              maxDate={new Date().toISOString().split('T')[0]}
              theme={{
                selectedDayBackgroundColor: '#EF9F27',
                selectedDayTextColor: '#412402',
                todayTextColor: '#EF9F27',
                dayTextColor: '#1a1a1a',
                textDisabledColor: '#ccc',
                arrowColor: '#EF9F27',
                monthTextColor: '#1a1a1a',
              }}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setModalCalendrier(false)}>
                <Text style={styles.modalCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (!dateDebut || !dateFin) && { opacity: 0.4 }]}
                onPress={confirmerPeriode}
                disabled={!dateDebut || !dateFin}
              >
                <Text style={styles.modalConfirmTxt}>Voir les résultats</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  periodeBar: { backgroundColor: '#fff', maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  periodeBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  periodeBtnActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  periodeTxt: { fontSize: 13, color: '#888' },
  periodeTxtActive: { color: '#EF9F27', fontWeight: '600' },
  shiftsBanner: {
    backgroundColor: '#EEEDFE', padding: 8, paddingHorizontal: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#CECBF6'
  },
  shiftsBannerTxt: { fontSize: 12, color: '#534AB7', fontWeight: '500' },
  periodeBanner: {
    backgroundColor: '#FAEEDA', padding: 10,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16
  },
  periodeBannerTxt: { fontSize: 13, color: '#854F0B', fontWeight: '500' },
  periodeBannerSub: { fontSize: 11, color: '#BA7517' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6, textAlign: 'center' },
  body: { flex: 1, padding: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: {
    width: (width - 44) / 2, backgroundColor: '#fff',
    borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  kpiLabel: { fontSize: 11, color: '#888', marginBottom: 6 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  graphCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  graphTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  legende: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 4 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeColor: { width: 12, height: 12, borderRadius: 3 },
  legendeTxt: { fontSize: 11, color: '#888' },
  pieContainer: { flexDirection: 'row', alignItems: 'center' },
  pieLegend: { flex: 1, paddingLeft: 8 },
  pieLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  pieLegendLabel: { fontSize: 11, fontWeight: '600', color: '#1a1a1a' },
  pieLegendValue: { fontSize: 10, color: '#888' },
  section: { marginBottom: 14 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5
  },
  resultCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 0.5, borderColor: '#eee'
  },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 7,
    borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  resultLabel: { fontSize: 13, color: '#888' },
  resultValue: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  dateSmall: { fontSize: 10, color: '#aaa', marginTop: 2 },
  messageCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 0.5, borderColor: '#eee', marginBottom: 14
  },
  messageOk: { fontSize: 14, color: '#3B6D11', fontWeight: '500', textAlign: 'center', lineHeight: 22 },
  messageWarn: { fontSize: 14, color: '#854F0B', fontWeight: '500', textAlign: 'center', lineHeight: 22 },
  messageBad: { fontSize: 14, color: '#A32D2D', fontWeight: '500', textAlign: 'center', lineHeight: 22 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 20, paddingBottom: 40
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16
  },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a' },
  modalClose: { fontSize: 18, color: '#888' },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 20, backgroundColor: '#f5f5f5', alignItems: 'center'
  },
  etapeBadgeActive: { backgroundColor: '#EF9F27' },
  etapeTxt: { fontSize: 12, color: '#888', fontWeight: '500' },
  etapeTxtActive: { color: '#412402' },
  etapeLine: { width: 20, height: 1, backgroundColor: '#eee', marginHorizontal: 4 },
  selectedDates: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f5f5f5', borderRadius: 12, padding: 12, marginBottom: 14
  },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#EF9F27', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
})