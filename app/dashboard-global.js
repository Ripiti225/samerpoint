import { router } from 'expo-router'
import { useEffect, useState } from 'react'
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
import { supabase } from '../lib/supabase'

const { width } = Dimensions.get('window')

const RESTAURANTS = [
  { id: '2f09688d-a4b9-4b14-8c45-943543953379', nom: 'Samer Angré 7E', court: 'Angré 7E', couleur: '#EF9F27', famille: 'Samer' },
  { id: 'rest2', nom: 'Samer Lavage', court: 'Lavage', couleur: '#F5B942', famille: 'Samer' },
  { id: 'rest3', nom: 'Samer Oasis', court: 'Oasis', couleur: '#F5C842', famille: 'Samer' },
  { id: 'rest4', nom: 'Samer Maroc', court: 'Maroc', couleur: '#E8952A', famille: 'Samer' },
  { id: 'rest5', nom: 'Samer Palm', court: 'Palm', couleur: '#D4841A', famille: 'Samer' },
  { id: 'rest6', nom: 'Al Kayan Yop', court: 'AK Yop', couleur: '#2D7D46', famille: 'Al Kayan' },
  { id: 'rest7', nom: 'Al Kayan KMS', court: 'AK KMS', couleur: '#3B9957', famille: 'Al Kayan' },
]

const PERIODES = [
  { label: "Aujourd'hui", key: 'today' },
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: '📅 Période', key: 'custom' },
]

export default function DashboardGlobalScreen() {
  const [periodeKey, setPeriodeKey] = useState('today')
  const [points, setPoints] = useState({})
  const [loading, setLoading] = useState(false)
  const [modalCalendrier, setModalCalendrier] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [etapeCalendrier, setEtapeCalendrier] = useState('debut')

  useEffect(() => {
    if (periodeKey !== 'custom') chargerPoints()
  }, [periodeKey])

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

  async function chargerPoints() {
    setLoading(true)
    const range = getDateRange()
    if (!range) { setLoading(false); return }
    const resultats = {}
    for (const rest of RESTAURANTS) {
      const { data } = await supabase
        .from('points').select('*')
        .eq('restaurant_id', rest.id).eq('valide', true)
        .gte('date', range.debut).lte('date', range.fin)
      resultats[rest.id] = data || []
    }
    setPoints(resultats)
    setLoading(false)
  }

  function totalResto(restId, champ) {
    return (points[restId] || []).reduce((sum, p) => sum + (parseFloat(p[champ]) || 0), 0)
  }

  function totalGlobal(champ) {
    return RESTAURANTS.reduce((sum, r) => sum + totalResto(r.id, champ), 0)
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
    const resultats = {}
    for (const rest of RESTAURANTS) {
      const { data } = await supabase
        .from('points').select('*')
        .eq('restaurant_id', rest.id).eq('valide', true)
        .gte('date', dateDebut).lte('date', dateFin)
      resultats[rest.id] = data || []
    }
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

  const classement = [...RESTAURANTS]
    .map(r => ({
      ...r,
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
                  {fmt(RESTAURANTS.filter(r => r.famille === 'Samer').reduce((sum, r) => sum + totalResto(r.id, 'benefice_sc'), 0))}
                </Text>
                <Text style={styles.familleSub}>Bénéfice SC</Text>
                <Text style={styles.familleVenteVal}>
                  {fmt(RESTAURANTS.filter(r => r.famille === 'Samer').reduce((sum, r) => sum + totalResto(r.id, 'vente_total'), 0))}
                </Text>
                <Text style={styles.familleSub}>Ventes</Text>
              </View>
              <View style={[styles.familleBox, { borderColor: '#C0DD97' }]}>
                <Text style={styles.familleTitre}>🟢 Al Kayan</Text>
                <Text style={[styles.familleValeur, { color: '#3B6D11' }]}>
                  {fmt(RESTAURANTS.filter(r => r.famille === 'Al Kayan').reduce((sum, r) => sum + totalResto(r.id, 'benefice_sc'), 0))}
                </Text>
                <Text style={styles.familleSub}>Bénéfice SC</Text>
                <Text style={styles.familleVenteVal}>
                  {fmt(RESTAURANTS.filter(r => r.famille === 'Al Kayan').reduce((sum, r) => sum + totalResto(r.id, 'vente_total'), 0))}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#534AB7', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#CECBF6', textAlign: 'center' },
  periodeBar: { backgroundColor: '#fff', maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  periodeBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  periodeBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  periodeTxt: { fontSize: 13, color: '#888' },
  periodeTxtActive: { color: '#534AB7', fontWeight: '600' },
  periodeBanner: { backgroundColor: '#EEEDFE', padding: 10, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: '#CECBF6' },
  periodeBannerTxt: { fontSize: 13, color: '#3C3489', fontWeight: '500' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { width: (width - 44) / 2, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: '#eee' },
  kpiLabel: { fontSize: 11, color: '#888', marginBottom: 6 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  graphCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: '#eee' },
  graphTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  graphNote: { fontSize: 10, color: '#aaa', textAlign: 'center', marginTop: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  barLabel: { fontSize: 11, color: '#555', width: 60 },
  barTrack: { flex: 1, height: 14, backgroundColor: '#f5f5f5', borderRadius: 7, overflow: 'hidden', marginHorizontal: 8, position: 'relative' },
  barFill: { height: '100%', borderRadius: 7 },
  barMark: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: '#ccc' },
  barValeur: { fontSize: 11, fontWeight: '600', color: '#1a1a1a', width: 40, textAlign: 'right' },
  legende: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeColor: { width: 12, height: 12, borderRadius: 3 },
  legendeTxt: { fontSize: 11, color: '#888' },
  familleGraphRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  famillePuce: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  familleGraphNom: { fontSize: 12, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  familleGraphSub: { fontSize: 10, color: '#888', marginTop: 4 },
  section: { marginBottom: 14 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  classementCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: '#eee' },
  classementRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  classementLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rangBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  rangOr: { backgroundColor: '#FFF3CC' },
  rangArgent: { backgroundColor: '#F0F0F0' },
  rangBronze: { backgroundColor: '#FAE8DC' },
  rangTxt: { fontSize: 14 },
  classementInfo: { flex: 1 },
  classementNom: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 3 },
  classementBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  familleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  familleTxt: { fontSize: 9, fontWeight: '500' },
  classementJours: { fontSize: 10, color: '#bbb' },
  classementRight: { alignItems: 'flex-end' },
  classementBenefice: { fontSize: 14, fontWeight: '600' },
  classementVentes: { fontSize: 10, color: '#888', marginTop: 2 },
  classementRenta: { fontSize: 10, marginTop: 1 },
  familleCompare: { flexDirection: 'row', gap: 10 },
  familleBox: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: 'center' },
  familleTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  familleValeur: { fontSize: 15, fontWeight: '600', color: '#BA7517' },
  familleSub: { fontSize: 10, color: '#888', marginBottom: 6 },
  familleVenteVal: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  recapCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: '#eee' },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  recapLabel: { fontSize: 13, color: '#888' },
  recapValue: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a' },
  modalClose: { fontSize: 18, color: '#888' },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#f5f5f5', alignItems: 'center' },
  etapeBadgeActive: { backgroundColor: '#534AB7' },
  etapeTxt: { fontSize: 12, color: '#888', fontWeight: '500' },
  etapeTxtActive: { color: '#fff' },
  etapeLine: { width: 20, height: 1, backgroundColor: '#eee', marginHorizontal: 4 },
  selectedDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 12, padding: 12, marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#534AB7', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
})