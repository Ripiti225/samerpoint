import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { supabase } from '../lib/supabase'

const CATEGORIES = [
  {
    nom: 'Pains',
    produits: [
      { id: 'p1', nom: 'Pain chawarma', prix: 2500 },
      { id: 'p2', nom: 'Pain burger', prix: 3500 },
      { id: 'p3', nom: 'Pain fahita', prix: 3000 },
    ]
  },
  {
    nom: 'Poulet',
    produits: [
      { id: 'po1', nom: 'Poulet frais', prix: 0, noAlert: true },
      { id: 'po2', nom: 'Pané', prix: 0 },
      { id: 'po3', nom: 'Rôti', prix: 0 },
      { id: 'po4', nom: 'Braise', prix: 0 },
      { id: 'po5', nom: 'Désossé', prix: 0 },
      { id: 'po6', nom: 'Cuisses de poulet', prix: 0 },
      { id: 'po8', nom: 'Total poulet', prix: 8000, totalPoulet: true },
    ]
  },
  {
    nom: 'Apéritifs',
    produits: [
      { id: 'a1', nom: 'Nems', prix: 2000 },
      { id: 'a2', nom: 'Kébbé', prix: 1000 },
      { id: 'a3', nom: 'Bourak', prix: 2000 },
      { id: 'a4', nom: 'Fatayer viande', prix: 1000 },
      { id: 'a5', nom: 'Fatayer légumes', prix: 1000 },
      { id: 'a6', nom: 'Fatayer maison', prix: 1500 },
      { id: 'a8', nom: 'Mini tacos', prix: 2000 },
      { id: 'a10', nom: 'Brochette poulet', prix: 5000 },
      { id: 'a11', nom: 'Brochette viande', prix: 5000 },
    ]
  },
  {
    nom: 'Fromage',
    produits: [
      { id: 'f1', nom: 'Philadelphia', prix: 2500 },
      { id: 'f10', nom: 'Total Fromage (g)', prix: 5, totalFromage: true },
    ]
  },
  {
    nom: 'Boissons',
    produits: [
      { id: 'b1', nom: 'Nespresso', prix: 1000 },
      { id: 'b2', nom: 'Eau G', prix: 1000 },
      { id: 'b3', nom: 'Eau P', prix: 500 },
      { id: 'b4', nom: 'Boisson 1000f', prix: 1000 },
      { id: 'b5', nom: 'Boisson 1500f', prix: 1500 },
      { id: 'b6', nom: 'Pot Fresco', prix: 1000 },
      { id: 'b8', nom: 'Thé', prix: 1000 },
    ]
  },
  {
    nom: 'Glaces',
    produits: [
      { id: 'g3', nom: 'Pot de glace', prix: 6000 },
      { id: 'g4', nom: 'Cornets', prix: 1000 },
    ]
  },
  {
    nom: 'Frites',
    produits: [
      { id: 'fr3', nom: 'Sachet de frites', prix: 2500 },
    ]
  },
]

export default function ModifierInventaireScreen() {
  const [etape, setEtape] = useState(1)
  const [restaurants, setRestaurants] = useState([])
  const [selectedResto, setSelectedResto] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [datesAvec, setDatesAvec] = useState({})
  const [catActive, setCatActive] = useState('Pains')
  const [stocks, setStocks] = useState({})
  const [loading, setLoading] = useState(false)
  const [pointId, setPointId] = useState(null)

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
  }

  async function chargerDatesAvec(restoId) {
    const { data } = await supabase
      .from('points').select('date, valide')
      .eq('restaurant_id', restoId)
    const marked = {}
    ;(data || []).forEach(p => {
      marked[p.date] = {
        marked: true,
        dotColor: p.valide ? '#3B6D11' : '#EF9F27',
      }
    })
    setDatesAvec(marked)
  }

  async function chargerInventaire(restoId, date) {
    setLoading(true)
    const { data: pointData } = await supabase
      .from('points').select('id')
      .eq('restaurant_id', restoId)
      .eq('date', date)
      .single()

    if (!pointData) {
      Alert.alert('Aucun point', 'Aucun point trouvé pour cette date.')
      setLoading(false)
      return
    }

    setPointId(pointData.id)
    const { data: invData } = await supabase
      .from('inventaires').select('*')
      .eq('point_id', pointData.id)

    const newStocks = {}
    ;(invData || []).forEach(inv => {
      newStocks[inv.produit_id] = {
        initial: String(inv.initial || ''),
        entrees: String(inv.entrees || ''),
        sorties: String(inv.sorties || ''),
        final: String(inv.final || ''),
      }
    })
    setStocks(newStocks)
    setEtape(3)
    setLoading(false)
  }

  function getStock(id, champ) { return stocks[id]?.[champ] || '' }
  function setStock(id, champ, val) {
    setStocks(prev => ({ ...prev, [id]: { ...prev[id], [champ]: val } }))
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  async function sauvegarder() {
    Alert.alert('Confirmer', 'Enregistrer les modifications de l\'inventaire ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', onPress: async () => {
        setLoading(true)
        await supabase.from('inventaires').delete().eq('point_id', pointId)

        const lignes = []
        CATEGORIES.forEach(cat => {
          cat.produits.forEach(p => {
            const s = stocks[p.id]
            if (s && (s.initial || s.entrees || s.sorties || s.final)) {
              lignes.push({
                point_id: pointId,
                produit_id: p.id,
                produit_nom: p.nom,
                initial: parseFloat(s.initial) || 0,
                entrees: parseFloat(s.entrees) || 0,
                sorties: parseFloat(s.sorties) || 0,
                final: parseFloat(s.final) || 0,
              })
            }
          })
        })

        if (lignes.length > 0) {
          await supabase.from('inventaires').insert(lignes)
        }

        setLoading(false)
        Alert.alert('Succès', 'Inventaire modifié !')
        if (router.canGoBack()) router.back()
        else router.replace('/accueil')
      }}
    ])
  }

  const catCourante = CATEGORIES.find(c => c.nom === catActive)

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (etape > 1) setEtape(etape - 1)
          else if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Modifier inventaire</Text>
          <Text style={styles.headerSub}>
            {etape === 1 ? 'Choisir restaurant' : etape === 2 ? 'Choisir date' : formatDate(selectedDate)}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.stepBar}>
        {['Restaurant', 'Date', 'Inventaire'].map((s, i) => (
          <View key={i} style={styles.stepItem}>
            <View style={[styles.stepNum, etape > i + 1 && styles.stepDone, etape === i + 1 && styles.stepActive]}>
              <Text style={styles.stepNumTxt}>{etape > i + 1 ? '✓' : i + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, etape === i + 1 && styles.stepLabelActive]}>{s}</Text>
            {i < 2 && <View style={styles.stepLine} />}
          </View>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
        </View>
      ) : (
        <>
          {etape === 1 && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitre}>Choisissez un restaurant</Text>
              {restaurants.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.restoCard}
                  onPress={() => {
                    setSelectedResto(r)
                    chargerDatesAvec(r.id)
                    setEtape(2)
                  }}
                >
                  <View style={[styles.restoDot, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]} />
                  <View>
                    <Text style={styles.restoNom}>{r.nom}</Text>
                    <Text style={styles.restoSub}>{r.localisation || 'Abidjan'}</Text>
                  </View>
                  <Text style={styles.restoArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {etape === 2 && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitre}>{selectedResto?.nom}</Text>
              <Calendar
                onDayPress={day => {
                  setSelectedDate(day.dateString)
                  chargerInventaire(selectedResto.id, day.dateString)
                }}
                markedDates={{
                  ...datesAvec,
                  ...(selectedDate ? { [selectedDate]: { selected: true, selectedColor: '#534AB7' } } : {})
                }}
                maxDate={new Date().toISOString().split('T')[0]}
                theme={{
                  selectedDayBackgroundColor: '#534AB7',
                  todayTextColor: '#534AB7',
                  arrowColor: '#534AB7',
                  monthTextColor: '#1a1a1a',
                  dayTextColor: '#1a1a1a',
                  textDisabledColor: '#ccc',
                }}
                style={styles.calendar}
              />
            </ScrollView>
          )}

          {etape === 3 && (
            <>
              <View style={styles.infoBar}>
                <Text style={styles.infoBarTxt}>{selectedResto?.nom} — {formatDate(selectedDate)}</Text>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.nom}
                    style={[styles.tab, catActive === cat.nom && styles.tabActive]}
                    onPress={() => setCatActive(cat.nom)}
                  >
                    <Text style={[styles.tabTxt, catActive === cat.nom && styles.tabTxtActive]}>{cat.nom}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
                {(() => {
                  let catMontant = 0
                  catCourante?.produits.forEach(p => {
                    const final = parseFloat(getStock(p.id, 'final')) || 0
                    catMontant += (p.prix || 0) * final
                  })
                  return (
                    <>
                      {catCourante?.produits.map(produit => {
                        const final = parseFloat(getStock(produit.id, 'final')) || 0
                        const montant = produit.prix > 0 ? produit.prix * final : 0
                        return (
                          <View key={produit.id} style={styles.prodCard}>
                            <View style={styles.prodHeader}>
                              <Text style={styles.prodNom}>{produit.nom}</Text>
                              {produit.prix > 0 && (
                                <Text style={styles.prodMontant}>
                                  {montant > 0 ? montant.toLocaleString('fr-FR') + ' F' : produit.prix.toLocaleString() + ' F/u'}
                                </Text>
                              )}
                            </View>
                            <View style={styles.prodFields}>
                              {['initial', 'entrees', 'sorties', 'final'].map(champ => (
                                <View key={champ} style={styles.fieldBox}>
                                  <Text style={styles.fieldLabel}>{champ === 'initial' ? 'Initial' : champ === 'entrees' ? 'Entrées' : champ === 'sorties' ? 'Sorties' : 'Final'}</Text>
                                  <TextInput
                                    style={[styles.fieldInput, champ !== 'initial' && styles.fieldEdit]}
                                    placeholder="0"
                                    value={getStock(produit.id, champ)}
                                    onChangeText={v => setStock(produit.id, champ, v)}
                                    keyboardType="numeric"
                                    placeholderTextColor="#ccc"
                                  />
                                </View>
                              ))}
                            </View>
                          </View>
                        )
                      })}
                      {catMontant > 0 && (
                        <View style={styles.catTotalCard}>
                          <Text style={styles.catTotalLabel}>Valeur stock — {catActive}</Text>
                          <Text style={styles.catTotalVal}>{catMontant.toLocaleString('fr-FR')} FCFA</Text>
                        </View>
                      )}
                    </>
                  )
                })()}

                <TouchableOpacity style={styles.saveBtn} onPress={sauvegarder}>
                  <Text style={styles.saveTxt}>Enregistrer l'inventaire</Text>
                </TouchableOpacity>
                <View style={{ height: 40 }} />
              </ScrollView>
            </>
          )}
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#534AB7', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#CECBF6', textAlign: 'center' },
  stepBar: { flexDirection: 'row', backgroundColor: '#fff', padding: 14, borderBottomWidth: 0.5, borderBottomColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center', marginRight: 6, borderWidth: 0.5, borderColor: '#eee' },
  stepDone: { backgroundColor: '#534AB7' },
  stepActive: { backgroundColor: '#534AB7' },
  stepNumTxt: { fontSize: 11, fontWeight: '600', color: '#fff' },
  stepLine: { width: 30, height: 1, backgroundColor: '#eee', marginHorizontal: 6 },
  stepLabel: { fontSize: 11, color: '#888', marginRight: 6 },
  stepLabelActive: { color: '#534AB7', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 16 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  restoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#eee' },
  restoDot: { width: 12, height: 12, borderRadius: 6 },
  restoNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  restoSub: { fontSize: 11, color: '#888', marginTop: 2 },
  restoArrow: { marginLeft: 'auto', fontSize: 18, color: '#ccc' },
  calendar: { borderRadius: 14, borderWidth: 0.5, borderColor: '#eee', marginBottom: 14 },
  infoBar: { backgroundColor: '#534AB7', padding: 12, paddingHorizontal: 16 },
  infoBarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  tabs: { backgroundColor: '#fff', maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  tab: { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  tabTxt: { fontSize: 12, color: '#888' },
  tabTxtActive: { color: '#534AB7', fontWeight: '600' },
  prodCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#eee' },
  prodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  prodNom: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', flex: 1 },
  prodMontant: { fontSize: 12, fontWeight: '600', color: '#EF9F27' },
  catTotalCard: { backgroundColor: '#FAEEDA', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#FAC775' },
  catTotalLabel: { fontSize: 12, fontWeight: '600', color: '#854F0B' },
  catTotalVal: { fontSize: 14, fontWeight: '700', color: '#854F0B' },
  prodFields: { flexDirection: 'row', gap: 4 },
  fieldBox: { flex: 1, alignItems: 'center' },
  fieldLabel: { fontSize: 9, color: '#888', marginBottom: 4 },
  fieldInput: { width: '100%', backgroundColor: '#f5f5f5', borderRadius: 6, padding: 6, fontSize: 12, textAlign: 'center', color: '#1a1a1a' },
  fieldEdit: { backgroundColor: '#FAEEDA', color: '#412402' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 20 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
})