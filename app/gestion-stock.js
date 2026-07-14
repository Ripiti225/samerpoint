import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { supabase } from '../lib/supabase'

// Index produit_id → catégorie (+ ordre d'affichage des catégories)
const PRODUIT_CAT = {}
CATEGORIES_INVENTAIRE.forEach(c => c.produits.forEach(p => { PRODUIT_CAT[p.id] = c.nom }))
const CAT_ORDER = [...CATEGORIES_INVENTAIRE.map(c => c.nom), 'Autres']

function isoJour(d) {
  return d.toISOString().split('T')[0]
}

// Presets de période → { debut, fin } en 'YYYY-MM-DD'
function calcPreset(preset) {
  const fin = new Date()
  const debut = new Date()
  if (preset === '7j') debut.setDate(fin.getDate() - 6)
  else if (preset === '30j') debut.setDate(fin.getDate() - 29)
  else if (preset === 'mois') { debut.setDate(1) }
  else if (preset === 'jour') { /* aujourd'hui */ }
  return { debut: isoJour(debut), fin: isoJour(fin) }
}

const PRESETS = [
  { key: 'jour', label: "Aujourd'hui" },
  { key: '7j', label: '7 jours' },
  { key: '30j', label: '30 jours' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'perso', label: 'Personnalisé' },
]

function fmtDateCourt(iso) {
  if (!iso) return ''
  const [y, m, j] = iso.split('-')
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(j)} ${mois[parseInt(m) - 1]} ${y}`
}

export default function GestionStockScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  const [preset, setPreset] = useState('30j')
  const [debut, setDebut] = useState(calcPreset('30j').debut)
  const [fin, setFin] = useState(calcPreset('30j').fin)
  const [showCalendar, setShowCalendar] = useState(false)
  const [champDate, setChampDate] = useState(null) // 'debut' | 'fin'

  const [produits, setProduits] = useState([])
  const [loading, setLoading] = useState(true)
  const [categoriesRepliees, setCategoriesRepliees] = useState({})

  function toggleCat(nom) {
    setCategoriesRepliees(prev => ({ ...prev, [nom]: !prev[nom] }))
  }

  useEffect(() => {
    supabase.from('restaurants').select('id, nom').order('nom').then(({ data }) => setRestaurants(data || []))
  }, [])

  useEffect(() => { charger() }, [restoFilter, debut, fin])

  function choisirPreset(key) {
    setPreset(key)
    if (key === 'perso') { setShowCalendar(true); setChampDate('debut'); return }
    const p = calcPreset(key)
    setDebut(p.debut); setFin(p.fin)
  }

  async function charger() {
    setLoading(true)
    const map = {}
    const PAGE = 1000
    let from = 0
    // Pagination : PostgREST plafonne à 1000 lignes par requête. Sans ça, le
    // total « tous les restaurants » est tronqué et devient faux (plus petit
    // qu'un restaurant seul).
    for (;;) {
      let q = supabase
        .from('inventaire_lignes')
        .select('produit_id, produit_nom, sorties, entrees, inventaires_shifts!inner(date, restaurant_id)')
        .gte('inventaires_shifts.date', debut)
        .lte('inventaires_shifts.date', fin)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (restoFilter) q = q.eq('inventaires_shifts.restaurant_id', restoFilter)
      const { data, error } = await q
      if (error) { setProduits([]); setLoading(false); return }
      for (const l of data || []) {
        const key = l.produit_id
        if (!map[key]) map[key] = { produit_id: key, produit_nom: l.produit_nom || key, sorties: 0, entrees: 0 }
        map[key].sorties += Number(l.sorties) || 0
        map[key].entrees += Number(l.entrees) || 0
      }
      if (!data || data.length < PAGE) break
      from += PAGE
    }
    const rows = Object.values(map).sort((a, b) => b.sorties - a.sorties)
    setProduits(rows)
    setLoading(false)
  }

  const totalSorties = produits.reduce((s, p) => s + p.sorties, 0)
  const totalEntrees = produits.reduce((s, p) => s + p.entrees, 0)
  const restoNom = restoFilter ? restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant' : 'Tous les restaurants'

  // Regroupement par catégorie (ordre CAT_ORDER, produits triés par sorties desc)
  const categories = useMemo(() => {
    const par = {}
    for (const p of produits) {
      const cat = PRODUIT_CAT[p.produit_id] || 'Autres'
      if (!par[cat]) par[cat] = { nom: cat, produits: [], sorties: 0, entrees: 0 }
      par[cat].produits.push(p)
      par[cat].sorties += p.sorties
      par[cat].entrees += p.entrees
    }
    return CAT_ORDER
      .filter(nom => par[nom])
      .map(nom => ({ ...par[nom], produits: par[nom].produits.sort((a, b) => b.sorties - a.sorties) }))
  }, [produits])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Gestion de stock</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filtre restaurant */}
      <View style={styles.filtersRow}>
        <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoBtnTxt}>🏪 {restoNom} ▾</Text>
        </TouchableOpacity>
      </View>

      {/* Filtre période */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {PRESETS.map(p => (
          <TouchableOpacity key={p.key} style={[styles.presetBtn, preset === p.key && styles.presetBtnActive]} onPress={() => choisirPreset(p.key)}>
            <Text style={[styles.presetTxt, preset === p.key && styles.presetTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity style={styles.periodeInfo} onPress={() => { setPreset('perso'); setShowCalendar(true); setChampDate('debut') }}>
        <Text style={styles.periodeTxt}>📅 {fmtDateCourt(debut)} → {fmtDateCourt(fin)}</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#534AB7" /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {/* Totaux */}
          <View style={styles.totauxRow}>
            <View style={[styles.totalCard, { borderColor: '#A32D2D' }]}>
              <Text style={styles.totalLabel}>Total sorties</Text>
              <Text style={[styles.totalVal, { color: '#A32D2D' }]}>{totalSorties.toLocaleString('fr-FR')}</Text>
            </View>
            <View style={[styles.totalCard, { borderColor: '#3B6D11' }]}>
              <Text style={styles.totalLabel}>Total entrées</Text>
              <Text style={[styles.totalVal, { color: '#3B6D11' }]}>{totalEntrees.toLocaleString('fr-FR')}</Text>
            </View>
          </View>

          {produits.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTxt}>Aucune donnée de stock sur cette période</Text>
            </View>
          ) : (
            categories.map(cat => {
              const ouvert = !categoriesRepliees[cat.nom]
              return (
                <View key={cat.nom} style={styles.catBloc}>
                  <TouchableOpacity style={styles.catHead} onPress={() => toggleCat(cat.nom)} activeOpacity={0.7}>
                    <Text style={styles.catTitre}>{ouvert ? '▾' : '▸'} {cat.nom}</Text>
                    <View style={styles.catTotaux}>
                      <Text style={styles.catEntrees}>+{cat.entrees.toLocaleString('fr-FR')}</Text>
                      <Text style={styles.catSorties}>−{cat.sorties.toLocaleString('fr-FR')}</Text>
                    </View>
                  </TouchableOpacity>
                  {ouvert && (
                    <>
                      <View style={styles.tableHead}>
                        <Text style={styles.thProduit}>Produit</Text>
                        <Text style={styles.thNum}>Entrées</Text>
                        <Text style={styles.thNum}>Sorties</Text>
                      </View>
                      {cat.produits.map(p => (
                        <View key={p.produit_id} style={styles.row}>
                          <Text style={styles.rowProduit} numberOfLines={2}>{p.produit_nom}</Text>
                          <Text style={styles.rowEntrees}>{p.entrees.toLocaleString('fr-FR')}</Text>
                          <Text style={styles.rowSorties}>{p.sorties.toLocaleString('fr-FR')}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Picker restaurant */}
      <Modal visible={showRestoPicker} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setShowRestoPicker(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.pickerModal}>
              <Text style={styles.pickerTitre}>Choisir un restaurant</Text>
              <ScrollView>
                <TouchableOpacity style={styles.pickerItem} onPress={() => { setRestoFilter(null); setShowRestoPicker(false) }}>
                  <Text style={[styles.pickerItemTxt, !restoFilter && { fontWeight: '700', color: '#534AB7' }]}>🌍 Tous les restaurants</Text>
                </TouchableOpacity>
                {restaurants.map(r => (
                  <TouchableOpacity key={r.id} style={styles.pickerItem} onPress={() => { setRestoFilter(r.id); setShowRestoPicker(false) }}>
                    <Text style={[styles.pickerItemTxt, restoFilter === r.id && { fontWeight: '700', color: '#534AB7' }]}>🏪 {r.nom}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Calendrier période personnalisée */}
      <Modal visible={showCalendar} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setShowCalendar(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.pickerModal}>
                <Text style={styles.pickerTitre}>
                  {champDate === 'debut' ? 'Date de début' : 'Date de fin'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <TouchableOpacity style={[styles.dateBtn, champDate === 'debut' && styles.dateBtnActive]} onPress={() => setChampDate('debut')}>
                    <Text style={[styles.dateBtnTxt, champDate === 'debut' && { color: '#fff' }]}>{fmtDateCourt(debut)}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.textMuted, alignSelf: 'center' }}>→</Text>
                  <TouchableOpacity style={[styles.dateBtn, champDate === 'fin' && styles.dateBtnActive]} onPress={() => setChampDate('fin')}>
                    <Text style={[styles.dateBtnTxt, champDate === 'fin' && { color: '#fff' }]}>{fmtDateCourt(fin)}</Text>
                  </TouchableOpacity>
                </View>
                <Calendar
                  onDayPress={day => {
                    if (champDate === 'debut') {
                      setDebut(day.dateString)
                      if (day.dateString > fin) setFin(day.dateString)
                      setChampDate('fin')
                    } else {
                      setFin(day.dateString < debut ? debut : day.dateString)
                      setShowCalendar(false)
                    }
                  }}
                  markedDates={{
                    [debut]: { selected: true, selectedColor: '#534AB7' },
                    [fin]: { selected: true, selectedColor: '#3B6D11' },
                  }}
                  theme={{
                    selectedDayBackgroundColor: champDate === 'debut' ? '#534AB7' : '#3B6D11',
                    todayTextColor: '#534AB7', arrowColor: '#534AB7',
                    monthTextColor: colors.text, dayTextColor: colors.text, textDisabledColor: '#ccc',
                  }}
                />
                <TouchableOpacity style={styles.closeCalBtn} onPress={() => setShowCalendar(false)}>
                  <Text style={styles.closeCalTxt}>Fermer</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    back: { fontSize: 16, color: '#534AB7', fontWeight: '500' },
    headerTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    filtersRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    restoBtn: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border },
    restoBtnTxt: { fontSize: 14, color: colors.text, fontWeight: '500' },
    presetRow: { paddingVertical: 8, flexGrow: 0 },
    presetBtn: { backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
    presetBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    presetTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    presetTxtActive: { color: '#fff' },
    periodeInfo: { paddingHorizontal: 16, paddingBottom: 8 },
    periodeTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, paddingHorizontal: 16 },
    totauxRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 16 },
    totalCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: 'center' },
    totalLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
    totalVal: { fontSize: 22, fontWeight: '800' },
    emptyBox: { alignItems: 'center', paddingTop: 50 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
    catBloc: { marginBottom: 16 },
    catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
    catTitre: { fontSize: 15, fontWeight: '800', color: colors.text, flex: 1 },
    catTotaux: { flexDirection: 'row', gap: 14 },
    catEntrees: { fontSize: 14, fontWeight: '700', color: '#3B6D11' },
    catSorties: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
    tableHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: colors.border },
    thProduit: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    thNum: { width: 70, textAlign: 'right', fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, borderRadius: 8, marginTop: 4 },
    rowProduit: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500', paddingRight: 8 },
    rowEntrees: { width: 70, textAlign: 'right', fontSize: 14, color: '#3B6D11', fontWeight: '600' },
    rowSorties: { width: 70, textAlign: 'right', fontSize: 14, color: '#A32D2D', fontWeight: '700' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    pickerModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
    pickerTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
    pickerItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    pickerItemTxt: { fontSize: 15, color: colors.text },
    dateBtn: { flex: 1, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    dateBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    dateBtnTxt: { fontSize: 13, color: colors.text, fontWeight: '600' },
    closeCalBtn: { marginTop: 14, backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    closeCalTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  })
}
