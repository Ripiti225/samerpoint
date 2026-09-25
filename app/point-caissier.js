import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import DetailShiftCaissier from '../components/DetailShiftCaissier'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { chargerDetailShift } from '../lib/detailShift'
import { aBesoinExplication, grouperShiftsParJour, troisDerniersJours } from '../lib/pointCaissier'
import { supabase } from '../lib/supabase'

const DETAIL_VIDE = { depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: false }

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }

// « Aujourd'hui » pour la première journée, la date longue pour les autres.
function titreJour(date, index) {
  const [an, mois, jour] = date.split('-').map(Number)
  const longue = new Date(an, mois - 1, jour)
    .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return index === 0 ? `Aujourd'hui · ${longue}` : longue
}

export default function PointCaissierScreen() {
  const { colors } = useTheme()
  const { restaurantId, roleActif } = useApp()
  const estAdmin = roleActif === 'manager' || roleActif === 'directeur'
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  const [restoChoisi, setRestoChoisi] = useState(null)
  const [pickerVisible, setPickerVisible] = useState(false)
  const [groupes, setGroupes] = useState(() => grouperShiftsParJour([]))
  const [loading, setLoading] = useState(true)
  const [shiftDetail, setShiftDetail] = useState(null)
  const [detail, setDetail] = useState(DETAIL_VIDE)

  // Le gérant est rattaché à son restaurant ; manager et directeur n'en ont
  // aucun dans leur contexte, ils le choisissent ici.
  useEffect(() => {
    if (!estAdmin) return
    supabase.from('restaurants').select('id, nom').order('nom').then(({ data }) => {
      setRestaurants(data || [])
      setRestoChoisi(prev => prev || data?.[0]?.id || null)
    })
  }, [estAdmin])

  const restoActif = estAdmin ? restoChoisi : restaurantId

  const charger = useCallback(async () => {
    setLoading(true)
    if (!restoActif) {
      setGroupes(grouperShiftsParJour([]))
      setLoading(false)
      return
    }
    // Trois jours d'un seul restaurant : très loin de la limite de 1000 lignes.
    const { data } = await supabase
      .from('points_shifts')
      .select('*')
      .eq('restaurant_id', restoActif)
      .in('date', troisDerniersJours())
    setGroupes(grouperShiftsParJour(data || []))
    setLoading(false)
  }, [restoActif])

  useEffect(() => { charger() }, [charger])

  async function ouvrir(shift) {
    setShiftDetail(shift)
    setDetail({ ...DETAIL_VIDE, loading: true })
    const data = await chargerDetailShift(shift)
    setDetail({ ...data, loading: false })
  }

  const totalShifts = groupes.reduce((somme, g) => somme + g.shifts.length, 0)

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Point caissier</Text>
          <Text style={styles.headerSub}>Shifts clôturés · 3 derniers jours</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {estAdmin && (
        <View style={styles.filtreRow}>
          <TouchableOpacity style={styles.restoBtn} onPress={() => setPickerVisible(true)}>
            <Text style={styles.restoBtnTxt} numberOfLines={1}>
              🏪 {restaurants.find(r => r.id === restoActif)?.nom || 'Choisir un restaurant'} ▾
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {!restoActif ? (
          <View style={styles.videBox}>
            <Text style={styles.videTxt}>
              {estAdmin ? 'Choisissez un restaurant pour voir ses shifts.' : 'Aucun restaurant associé à votre compte.'}
            </Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#EF9F27" />
            <Text style={styles.loadingTxt}>Chargement…</Text>
          </View>
        ) : (
          <>
            {totalShifts === 0 && (
              <View style={styles.videBox}>
                <Text style={styles.videTxt}>Aucun shift clôturé sur les trois derniers jours.</Text>
              </View>
            )}

            {groupes.map((groupe, index) => (
              <View key={groupe.date} style={styles.jour}>
                <Text style={styles.jourTitre}>{titreJour(groupe.date, index)}</Text>

                {groupe.shifts.length === 0 ? (
                  <View style={styles.jourVide}>
                    <Text style={styles.jourVideTxt}>Aucun shift clôturé ce jour-là</Text>
                  </View>
                ) : groupe.shifts.map(shift => (
                  <TouchableOpacity key={shift.id} style={styles.card} onPress={() => ouvrir(shift)}>
                    <View style={styles.cardHead}>
                      <Text style={styles.cardCaissier}>👤 {shift.caissier_nom || 'Caissier'}</Text>
                      <Text style={styles.cardHeures}>
                        ⏰ {shift.heure_debut || '—'} → {shift.heure_fin || '—'}
                      </Text>
                    </View>

                    <View style={styles.cardRow}>
                      <Text style={styles.cardLabel}>Vente shift</Text>
                      <Text style={styles.cardVal}>{fmt(shift.vente_shift)}</Text>
                    </View>

                    <View style={[styles.cardRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.cardLabel}>Écart de caisse</Text>
                      <Text style={[styles.cardVal, couleurEcart(shift.ecartEspeces)]}>
                        {shift.ecartEspecesTexte}
                      </Text>
                    </View>

                    {String(shift.explication_ecart || '').trim() !== '' && (
                      <Text style={styles.cardExplication}>« {shift.explication_ecart.trim()} »</Text>
                    )}

                    {aBesoinExplication(shift) && (
                      <View style={styles.badgeSansExplication}>
                        <Text style={styles.badgeSansExplicationTxt}>⚠ Sans explication</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={pickerVisible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setPickerVisible(false)}>
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerModal}>
              <Text style={styles.pickerTitre}>Choisir un restaurant</Text>
              <ScrollView>
                {restaurants.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.pickerItem}
                    onPress={() => { setRestoChoisi(r.id); setPickerVisible(false) }}
                  >
                    <Text style={[styles.pickerItemTxt, restoActif === r.id && styles.pickerItemTxtActif]}>
                      🏪 {r.nom}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <DetailShiftCaissier
        shift={shiftDetail}
        data={detail}
        onClose={() => setShiftDetail(null)}
        afficherEcartPOS
      />
    </SafeAreaView>
  )
}

// Rouge = manquant, vert = excédent. Un écart nul ou indisponible reste neutre.
function couleurEcart(ecart) {
  if (typeof ecart !== 'number' || ecart === 0) return null
  return { color: ecart < 0 ? '#A32D2D' : '#3B6D11', fontWeight: '700' }
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  body: { flex: 1, padding: 14 },
  filtreRow: {
    paddingHorizontal: 14, paddingTop: 12,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border,
    paddingBottom: 12,
  },
  restoBtn: {
    backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  restoBtnTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  pickerModal: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 18, paddingBottom: 30, maxHeight: '70%',
  },
  pickerTitre: {
    fontSize: 15, fontWeight: '700', color: colors.text,
    paddingHorizontal: 20, paddingBottom: 12,
  },
  pickerItem: {
    paddingVertical: 14, paddingHorizontal: 20,
    borderTopWidth: 0.5, borderTopColor: colors.borderLight,
  },
  pickerItemTxt: { fontSize: 14, color: colors.text },
  pickerItemTxtActif: { fontWeight: '700', color: '#EF9F27' },
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  loadingTxt: { color: colors.textMuted, marginTop: 10, fontSize: 13 },
  videBox: { alignItems: 'center', paddingVertical: 30 },
  videTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 20 },
  jour: { marginBottom: 18 },
  jourTitre: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 8,
  },
  jourVide: {
    backgroundColor: colors.surfaceAlt, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', borderWidth: 0.5, borderColor: colors.borderLight,
  },
  jourVideTxt: { fontSize: 12, color: colors.textPlaceholder },
  card: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  cardHead: { marginBottom: 8 },
  cardCaissier: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardHeures: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.bg,
  },
  cardLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  cardVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  cardExplication: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginTop: 8 },
  badgeSansExplication: {
    marginTop: 10, alignSelf: 'flex-start',
    backgroundColor: '#FAECE7', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeSansExplicationTxt: { fontSize: 11, color: '#A32D2D', fontWeight: '600' },
}) }
