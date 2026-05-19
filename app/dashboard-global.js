import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { useTheme } from '../context/ThemeContext'
import { supabase } from '../lib/supabase'

const { width } = Dimensions.get('window')

function couleurResto(c) {
  return { vert: '#2D7D46', bleu: '#185FA5', rouge: '#A32D2D', violet: '#534AB7' }[c] || '#EF9F27'
}
function familleResto(nom) {
  return (nom || '').toLowerCase().includes('al kayan') ? 'Al Kayan' : 'Samer'
}
function courtNom(nom) {
  if (!nom) return ''
  if (nom.length <= 9) return nom
  return nom.substring(0, 8) + '…'
}

const PERIODES = [
  { label: "Aujourd'hui", key: 'today' },
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: '📅 Période', key: 'custom' },
]

export default function DashboardGlobalScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [periodeKey, setPeriodeKey] = useState('7days')
  const [points, setPoints] = useState({})
  const [loading, setLoading] = useState(false)
  const [modalCalendrier, setModalCalendrier] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [etapeCalendrier, setEtapeCalendrier] = useState('debut')
  const [restaurants, setRestaurants] = useState([])

  useEffect(() => { chargerRestaurants() }, [])

  useEffect(() => {
    if (restaurants.length > 0 && periodeKey !== 'custom') {
      chargerPoints(restaurants)
    }
  }, [periodeKey, restaurants])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom, couleur').order('nom')
    if (data?.length) setRestaurants(data)
  }

  function getDateRange() {
    const today = new Date()
    const fmt = d => d.toISOString().split('T')[0]
    if (periodeKey === 'today') return { debut: fmt(today), fin: fmt(today) }
    if (periodeKey === '7days') { const d = new Date(today); d.setDate(d.getDate() - 6); return { debut: fmt(d), fin: fmt(today) } }
    if (periodeKey === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { debut: fmt(d), fin: fmt(today) } }
    if (periodeKey === 'lastmonth') { const debut = new Date(today.getFullYear(), today.getMonth() - 1, 1); const fin = new Date(today.getFullYear(), today.getMonth(), 0); return { debut: fmt(debut), fin: fmt(fin) } }
    if (periodeKey === 'custom') return { debut: dateDebut, fin: dateFin }
    return null
  }

  async function chargerPoints(restoList) {
    const list = restoList || restaurants
    if (!list.length) return
    setLoading(true)
    const range = getDateRange()
    if (!range) { setLoading(false); return }

    const { data: allPoints, error } = await supabase
      .from('points')
      .select('id, date, restaurant_id, vente_total, depense_total, benefice_sc')
      .gte('date', range.debut)
      .lte('date', range.fin)

    if (error) { console.error('[Dashboard]', error.message); setLoading(false); return }

    const resultats = {}
    list.forEach(r => { resultats[r.id] = [] })
    ;(allPoints || []).forEach(p => {
      if (resultats[p.restaurant_id] !== undefined) resultats[p.restaurant_id].push(p)
    })
    setPoints(resultats)
    setLoading(false)
  }

  function totalResto(restId, champ) {
    return (points[restId] || []).reduce((sum, p) => sum + (parseFloat(p[champ]) || 0), 0)
  }

  function totalGlobal(champ) {
    return restaurants.reduce((sum, r) => sum + totalResto(r.id, champ), 0)
  }

  function tauxRenta(ventes, benefice) {
    if (!ventes || ventes === 0) return 0
    return (benefice / ventes * 100)
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }
  function fmtK(n) { return (Math.round(n) / 1000).toFixed(0) + 'k' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function ouvrirCalendrier() {
    setDateDebut(''); setDateFin(''); setEtapeCalendrier('debut'); setModalCalendrier(true)
  }

  function choisirDate(day) {
    if (etapeCalendrier === 'debut') { setDateDebut(day.dateString); setEtapeCalendrier('fin') }
    else { if (day.dateString < dateDebut) { setDateDebut(day.dateString) } else { setDateFin(day.dateString) } }
  }

  async function confirmerPeriode() {
    if (!dateDebut || !dateFin) return
    setModalCalendrier(false); setPeriodeKey('custom'); setLoading(true)

    const { data: allPoints, error } = await supabase
      .from('points')
      .select('id, date, restaurant_id, vente_total, depense_total, benefice_sc')
      .gte('date', dateDebut)
      .lte('date', dateFin)

    if (error) { console.error('[Dashboard]', error.message); setLoading(false); return }

    const resultats = {}
    restaurants.forEach(r => { resultats[r.id] = [] })
    ;(allPoints || []).forEach(p => {
      if (resultats[p.restaurant_id] !== undefined) resultats[p.restaurant_id].push(p)
    })
    setPoints(resultats); setLoading(false)
  }

  function markedDates() {
    const marked = {}
    if (dateDebut) marked[dateDebut] = { selected: true, selectedColor: '#534AB7', startingDay: true }
    if (dateFin) marked[dateFin] = { selected: true, selectedColor: '#534AB7', endingDay: true }
    if (dateDebut && dateFin) {
      let current = new Date(dateDebut); current.setDate(current.getDate() + 1)
      while (current < new Date(dateFin)) {
        const str = current.toISOString().split('T')[0]
        marked[str] = { selected: true, selectedColor: '#EEEDFE', selectedTextColor: '#3C3489' }
        current.setDate(current.getDate() + 1)
      }
    }
    return marked
  }

  function titrePeriode() {
    if (periodeKey === 'today') return "Aujourd'hui"
    if (periodeKey === '7days') return '7 derniers jours'
    if (periodeKey === 'month') return 'Ce mois'
    if (periodeKey === 'lastmonth') return 'Mois précédent'
    if (periodeKey === 'custom' && dateDebut && dateFin) return `${formatDate(dateDebut)} → ${formatDate(dateFin)}`
    return 'Période personnalisée'
  }

  const classement = restaurants
    .map(r => ({
      ...r,
      court: courtNom(r.nom),
      couleur: couleurResto(r.couleur),
      famille: familleResto(r.nom),
      ventes: totalResto(r.id, 'vente_total'),
      depenses: totalResto(r.id, 'depense_total'),
      benefice: totalResto(r.id, 'benefice_sc'),
      nbJours: (points[r.id] || []).length,
    }))
    .sort((a, b) => b.benefice - a.benefice)

  const maxVentes = Math.max(...classement.map(r => r.ventes), 1)
  const maxBenefice = Math.max(...classement.map(r => Math.abs(r.benefice)), 1)
  const maxRenta = Math.max(...classement.map(r => tauxRenta(r.ventes, r.benefice)), 1)

  // Graphique barres horizontal custom
  function GraphiqueBarres({ data, max, couleurFn, labelFn, titre, unite }) {
    return (
      <View style={styles.graphCard}>
        <Text style={styles.graphTitre}>{titre}</Text>
        {data.map((item, i) => {
          const pct = max > 0 ? (Math.abs(item.valeur) / max) * 100 : 0
          return (
            <View key={i} style={styles.barRow}>
              <Text style={styles.barLabel}>{item.nom}</Text>
              <View style={styles.barTrack}>
                <View style={[
                  styles.barFill,
                  { width: `${pct}%`, backgroundColor: couleurFn(item) }
                ]} />
              </View>
              <Text style={styles.barValeur}>{labelFn(item.valeur)}</Text>
            </View>
          )
        })}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/accueil') }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Dashboard Global</Text>
          <Text style={styles.headerSub}>Tous les restaurants</Text>
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
            <Text style={[styles.periodeTxt, periodeKey === p.key && styles.periodeTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.periodeBanner}>
        <Text style={styles.periodeBannerTxt}>📅 {titrePeriode()}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement de tous les restaurants...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

          {/* KPIs */}
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Ventes totales</Text>
              <Text style={[styles.kpiValue, { color: '#BA7517' }]}>{fmt(totalGlobal('vente_total'))}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Dépenses totales</Text>
              <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{fmt(totalGlobal('depense_total'))}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Bénéfice SC global</Text>
              <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{fmt(totalGlobal('benefice_sc'))}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Rentabilité moy.</Text>
              <Text style={[styles.kpiValue, { color: '#534AB7' }]}>
                {tauxRenta(totalGlobal('vente_total'), totalGlobal('benefice_sc')).toFixed(1)}%
              </Text>
            </View>
          </View>

          {/* GRAPHIQUE 1 — Ventes par restaurant */}
          <GraphiqueBarres
            titre="📊 Ventes par restaurant"
            data={classement.map(r => ({ nom: r.court, valeur: r.ventes, couleur: r.couleur }))}
            max={maxVentes}
            couleurFn={item => item.couleur}
            labelFn={v => fmtK(v)}
            unite="FCFA"
          />

          {/* GRAPHIQUE 2 — Bénéfice SC par restaurant */}
          <GraphiqueBarres
            titre="💰 Bénéfice SC par restaurant"
            data={classement.map(r => ({ nom: r.court, valeur: r.benefice, positif: r.benefice >= 0 }))}
            max={maxBenefice}
            couleurFn={item => item.positif ? '#3B6D11' : '#A32D2D'}
            labelFn={v => fmtK(v)}
            unite="FCFA"
          />

          {/* GRAPHIQUE 3 — Rentabilité par restaurant */}
          <View style={styles.graphCard}>
            <Text style={styles.graphTitre}>📈 Rentabilité par restaurant</Text>
            {classement.map((r, i) => {
              const renta = tauxRenta(r.ventes, r.benefice)
              const pct = Math.min(renta, 100)
              return (
                <View key={i} style={styles.barRow}>
                  <Text style={styles.barLabel}>{r.court}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: renta >= 20 ? '#3B6D11' : '#A32D2D' }]} />
                    <View style={[styles.barMark, { left: '20%' }]} />
                  </View>
                  <Text style={[styles.barValeur, { color: renta >= 20 ? '#3B6D11' : '#A32D2D' }]}>{renta.toFixed(1)}%</Text>
                </View>
              )
            })}
            <Text style={styles.graphNote}>Ligne = seuil 20%</Text>
            <View style={styles.legende}>
              <View style={styles.legendeItem}>
                <View style={[styles.legendeColor, { backgroundColor: '#3B6D11' }]} />
                <Text style={styles.legendeTxt}>≥ 20%</Text>
              </View>
              <View style={styles.legendeItem}>
                <View style={[styles.legendeColor, { backgroundColor: '#A32D2D' }]} />
                <Text style={styles.legendeTxt}>{'< 20%'}</Text>
              </View>
            </View>
          </View>

          {/* GRAPHIQUE 4 — Comparaison Samer vs Al Kayan */}
          <View style={styles.graphCard}>
            <Text style={styles.graphTitre}>⚖️ Samer vs Al Kayan</Text>
            {['Samer', 'Al Kayan'].map(famille => {
              const restos = classement.filter(r => r.famille === famille)
              const totalBenef = restos.reduce((s, r) => s + r.benefice, 0)
              const totalVent = restos.reduce((s, r) => s + r.ventes, 0)
              const renta = tauxRenta(totalVent, totalBenef)
              const couleur = famille === 'Samer' ? '#EF9F27' : '#2D7D46'
              const maxGlobal = Math.max(
                classement.filter(r => r.famille === 'Samer').reduce((s, r) => s + r.benefice, 0),
                classement.filter(r => r.famille === 'Al Kayan').reduce((s, r) => s + r.benefice, 0),
                1
              )
              const pct = (Math.abs(totalBenef) / maxGlobal) * 100
              return (
                <View key={famille} style={styles.familleGraphRow}>
                  <View style={[styles.famillePuce, { backgroundColor: couleur }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.familleGraphNom}>{famille}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: couleur }]} />
                    </View>
                    <Text style={styles.familleGraphSub}>
                      BSC: {fmt(totalBenef)} | Renta: {renta.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>

          {/* Classement */}
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>🏆 Classement par bénéfice SC</Text>
            <View style={styles.classementCard}>
              {classement.map((r, i) => (
                <View key={r.id} style={[styles.classementRow, i === classement.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={styles.classementLeft}>
                    <View style={[styles.rangBadge, i === 0 && styles.rangOr, i === 1 && styles.rangArgent, i === 2 && styles.rangBronze]}>
                      <Text style={styles.rangTxt}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</Text>
                    </View>
                    <View style={styles.classementInfo}>
                      <Text style={styles.classementNom}>{r.nom}</Text>
                      <View style={styles.classementBadgeRow}>
                        <View style={[styles.familleBadge, { backgroundColor: r.famille === 'Samer' ? '#FAEEDA' : '#EAF3DE' }]}>
                          <Text style={[styles.familleTxt, { color: r.famille === 'Samer' ? '#854F0B' : '#3B6D11' }]}>{r.famille}</Text>
                        </View>
                        <Text style={styles.classementJours}>{r.nbJours}j validé(s)</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.classementRight}>
                    <Text style={[styles.classementBenefice, { color: r.benefice >= 0 ? '#3B6D11' : '#A32D2D' }]}>{fmt(r.benefice)}</Text>
                    <Text style={styles.classementVentes}>{fmt(r.ventes)}</Text>
                    <Text style={[styles.classementRenta, { color: tauxRenta(r.ventes, r.benefice) >= 20 ? '#3B6D11' : '#888' }]}>
                      {tauxRenta(r.ventes, r.benefice).toFixed(1)}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Comparaison familles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>Récapitulatif par famille</Text>
            <View style={styles.familleCompare}>
              <View style={[styles.familleBox, { borderColor: '#FAC775' }]}>
                <Text style={styles.familleTitre}>🟡 Samer</Text>
                <Text style={styles.familleValeur}>
                  {fmt(classement.filter(r => r.famille === 'Samer').reduce((sum, r) => sum + totalResto(r.id, 'benefice_sc'), 0))}
                </Text>
                <Text style={styles.familleSub}>Bénéfice SC</Text>
                <Text style={styles.familleVenteVal}>
                  {fmt(classement.filter(r => r.famille === 'Samer').reduce((sum, r) => sum + totalResto(r.id, 'vente_total'), 0))}
                </Text>
                <Text style={styles.familleSub}>Ventes</Text>
              </View>
              <View style={[styles.familleBox, { borderColor: '#C0DD97' }]}>
                <Text style={styles.familleTitre}>🟢 Al Kayan</Text>
                <Text style={[styles.familleValeur, { color: '#3B6D11' }]}>
                  {fmt(classement.filter(r => r.famille === 'Al Kayan').reduce((sum, r) => sum + totalResto(r.id, 'benefice_sc'), 0))}
                </Text>
                <Text style={styles.familleSub}>Bénéfice SC</Text>
                <Text style={styles.familleVenteVal}>
                  {fmt(classement.filter(r => r.famille === 'Al Kayan').reduce((sum, r) => sum + totalResto(r.id, 'vente_total'), 0))}
                </Text>
                <Text style={styles.familleSub}>Ventes</Text>
              </View>
            </View>
          </View>

          {/* Récapitulatif global */}
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>Récapitulatif global</Text>
            <View style={styles.recapCard}>
              <View style={styles.recapRow}><Text style={styles.recapLabel}>Total ventes</Text><Text style={styles.recapValue}>{fmt(totalGlobal('vente_total'))}</Text></View>
              <View style={styles.recapRow}><Text style={styles.recapLabel}>Total dépenses</Text><Text style={[styles.recapValue, { color: '#A32D2D' }]}>{fmt(totalGlobal('depense_total'))}</Text></View>
              <View style={[styles.recapRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Bénéfice SC global</Text>
                <Text style={[styles.recapValue, { color: '#3B6D11', fontWeight: '600', fontSize: 16 }]}>{fmt(totalGlobal('benefice_sc'))}</Text>
              </View>
            </View>
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      )}

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
                <Text style={[styles.etapeTxt, etapeCalendrier === 'debut' && styles.etapeTxtActive]}>1. Date début</Text>
              </View>
              <View style={styles.etapeLine} />
              <View style={[styles.etapeBadge, etapeCalendrier === 'fin' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'fin' && styles.etapeTxtActive]}>2. Date fin</Text>
              </View>
            </View>
            <View style={styles.selectedDates}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Début</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateDebut ? '#1a1a1a' : '#ccc' }}>
                  {dateDebut ? formatDate(dateDebut) : 'Non sélectionné'}
                </Text>
              </View>
              <Text style={{ fontSize: 16, color: '#534AB7', marginHorizontal: 8 }}>→</Text>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Fin</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateFin ? '#1a1a1a' : '#ccc' }}>
                  {dateFin ? formatDate(dateFin) : 'Non sélectionné'}
                </Text>
              </View>
            </View>
            <Calendar
              onDayPress={choisirDate}
              markedDates={markedDates()}
              markingType="period"
              maxDate={new Date().toISOString().split('T')[0]}
              theme={{
                selectedDayBackgroundColor: '#534AB7',
                selectedDayTextColor: '#fff',
                todayTextColor: '#534AB7',
                dayTextColor: '#1a1a1a',
                textDisabledColor: '#ccc',
                arrowColor: '#534AB7',
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

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  periodeBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  periodeBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  periodeBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  periodeTxt: { fontSize: 13, color: colors.textMuted },
  periodeTxtActive: { color: colors.primary, fontWeight: '600' },
  periodeBanner: { backgroundColor: colors.primaryLight, padding: 10, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.primaryText },
  periodeBannerTxt: { fontSize: 13, color: colors.primaryDark, fontWeight: '500' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { width: (width - 44) / 2, backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 6 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  graphCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  graphTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 12 },
  graphNote: { fontSize: 10, color: '#aaa', textAlign: 'center', marginTop: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  barLabel: { fontSize: 11, color: colors.textSecondary, width: 60 },
  barTrack: { flex: 1, height: 14, backgroundColor: colors.bg, borderRadius: 7, overflow: 'hidden', marginHorizontal: 8, position: 'relative' },
  barFill: { height: '100%', borderRadius: 7 },
  barMark: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: '#ccc' },
  barValeur: { fontSize: 11, fontWeight: '600', color: colors.text, width: 40, textAlign: 'right' },
  legende: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeColor: { width: 12, height: 12, borderRadius: 3 },
  legendeTxt: { fontSize: 11, color: colors.textMuted },
  familleGraphRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  famillePuce: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  familleGraphNom: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 4 },
  familleGraphSub: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  section: { marginBottom: 14 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  classementCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  classementRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.bg },
  classementLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rangBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  rangOr: { backgroundColor: '#FFF3CC' },
  rangArgent: { backgroundColor: colors.borderLight },
  rangBronze: { backgroundColor: '#FAE8DC' },
  rangTxt: { fontSize: 14 },
  classementInfo: { flex: 1 },
  classementNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 3 },
  classementBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  familleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  familleTxt: { fontSize: 9, fontWeight: '500' },
  classementJours: { fontSize: 10, color: '#bbb' },
  classementRight: { alignItems: 'flex-end' },
  classementBenefice: { fontSize: 14, fontWeight: '600' },
  classementVentes: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  classementRenta: { fontSize: 10, marginTop: 1 },
  familleCompare: { flexDirection: 'row', gap: 10 },
  familleBox: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: 'center' },
  familleTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 },
  familleValeur: { fontSize: 15, fontWeight: '600', color: '#BA7517' },
  familleSub: { fontSize: 10, color: colors.textMuted, marginBottom: 6 },
  familleVenteVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  recapCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.bg },
  recapLabel: { fontSize: 13, color: colors.textMuted },
  recapValue: { fontSize: 13, fontWeight: '500', color: colors.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: colors.text },
  modalClose: { fontSize: 18, color: colors.textMuted },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.bg, alignItems: 'center' },
  etapeBadgeActive: { backgroundColor: colors.primary },
  etapeTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  etapeTxtActive: { color: colors.surface },
  etapeLine: { width: 20, height: 1, backgroundColor: colors.borderLight, marginHorizontal: 4 },
  selectedDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, padding: 12, marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: colors.textMuted },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },
}) }