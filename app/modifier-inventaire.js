import { router } from 'expo-router'
import { useEffect, useState, useMemo } from 'react'
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
import { CATEGORIES_INVENTAIRE as CATEGORIES } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { useTheme } from '../context/ThemeContext'

export default function ModifierInventaireScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
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
      .eq('shift_numero', 1)

    const newStocks = {}
    ;(invData || []).forEach(inv => {
      newStocks[inv.produit_id] = {
        initial: String(inv.stock_initial ?? ''),
        entrees: String(inv.entrees ?? ''),
        sorties: String(inv.sorties ?? ''),
        final: String(inv.stock_final ?? ''),
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

        const { error: delErr } = await supabase
          .from('inventaires').delete()
          .eq('point_id', pointId)
          .eq('shift_numero', 1)

        if (delErr) {
          setLoading(false)
          Alert.alert('Erreur', delErr.message)
          return
        }

        const lignes = []
        CATEGORIES.forEach(cat => {
          cat.produits.forEach(p => {
            const s = stocks[p.id]
            if (s && (s.initial || s.entrees || s.sorties || s.final)) {
              lignes.push({
                point_id: pointId,
                produit_id: p.id,
                produit_nom: p.nom,
                stock_initial: parseFloat(s.initial) || 0,
                entrees: parseFloat(s.entrees) || 0,
                sorties: parseFloat(s.sorties) || 0,
                stock_final: parseFloat(s.final) || 0,
                ecart: 0,
                prevision: 0,
                shift_numero: 1,
                shift_nom: 'Journée',
                heure_debut: '00:00',
                heure_fin: '23:59',
              })
            }
          })
        })

        if (lignes.length > 0) {
          const { error: insErr } = await supabase.from('inventaires').insert(lignes)
          if (insErr) {
            setLoading(false)
            Alert.alert('Erreur', insErr.message)
            return
          }
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
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

              <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  stepBar: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginRight: 6, borderWidth: 0.5, borderColor: colors.border },
  stepDone: { backgroundColor: colors.primary },
  stepActive: { backgroundColor: colors.primary },
  stepNumTxt: { fontSize: 11, fontWeight: '600', color: colors.surface },
  stepLine: { width: 30, height: 1, backgroundColor: colors.border, marginHorizontal: 6 },
  stepLabel: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  stepLabelActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 16 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  restoCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: colors.border },
  restoDot: { width: 12, height: 12, borderRadius: 6 },
  restoNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  restoSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  restoArrow: { marginLeft: 'auto', fontSize: 18, color: '#ccc' },
  calendar: { borderRadius: 14, borderWidth: 0.5, borderColor: colors.border, marginBottom: 14 },
  infoBar: { backgroundColor: colors.headerBg, padding: 12, paddingHorizontal: 16 },
  infoBarTxt: { fontSize: 13, fontWeight: '600', color: colors.surface },
  tabs: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  tab: { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabTxt: { fontSize: 12, color: colors.textMuted },
  tabTxtActive: { color: colors.primary, fontWeight: '600' },
  prodCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: colors.border },
  prodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  prodNom: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  prodMontant: { fontSize: 12, fontWeight: '600', color: '#EF9F27' },
  catTotalCard: { backgroundColor: colors.orangeLight, borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#FAC775' },
  catTotalLabel: { fontSize: 12, fontWeight: '600', color: colors.orangeDark },
  catTotalVal: { fontSize: 14, fontWeight: '700', color: colors.orangeDark },
  prodFields: { flexDirection: 'row', gap: 4 },
  fieldBox: { flex: 1, alignItems: 'center' },
  fieldLabel: { fontSize: 9, color: colors.textMuted, marginBottom: 4 },
  fieldInput: { width: '100%', backgroundColor: colors.bg, borderRadius: 6, padding: 6, fontSize: 12, textAlign: 'center', color: colors.text },
  fieldEdit: { backgroundColor: colors.orangeLight, color: '#412402' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 20 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: colors.surface },
}) }