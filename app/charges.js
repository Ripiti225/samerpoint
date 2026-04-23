import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'

const MOIS_NOMS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
]

export default function ChargesScreen() {
  const { roleActif } = useApp()
  const isRH = roleActif === 'rh'

  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [moisSelectionne, setMoisSelectionne] = useState(() => {
    // Par défaut : mois en cours
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [charges, setCharges] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalCharge, setModalCharge] = useState(false)
  const [formCharge, setFormCharge] = useState({ libelle: '', montant: '' })
  const [chargeEnEdition, setChargeEnEdition] = useState(null)
  const [bscMois, setBscMois] = useState(0)
  const [pointsValideCount, setPointsValideCount] = useState(0)
  const [recalculating, setRecalculating] = useState(false)

  useEffect(() => { chargerRestaurants() }, [])
  useEffect(() => {
    if (restoSelectionne) chargerCharges()
  }, [restoSelectionne, moisSelectionne])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
    if (data && data.length > 0) setRestoSelectionne(data[0])
  }

  async function chargerCharges() {
    setLoading(true)

    // Charger les charges
    const { data: chargesData } = await supabase
      .from('charges')
      .select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .eq('mois', moisSelectionne)
      .order('created_at')
    setCharges(chargesData || [])

    // Charger le BSC du mois — calculé en live depuis les shifts (évite les valeurs périmées)
    if (!isRH) {
      const debut = `${moisSelectionne}-01`
      const [y, m] = moisSelectionne.split('-').map(Number)
      const dernierJour = new Date(y, m, 0).getDate()
      const fin = `${moisSelectionne}-${String(dernierJour).padStart(2, '0')}`
      const { data: points } = await supabase
        .from('points')
        .select('id, yango_tab, glovo_tab')
        .eq('restaurant_id', restoSelectionne.id)
        .eq('valide', true)
        .gte('date', debut)
        .lte('date', fin)

      setPointsValideCount((points || []).length)

      let totalBSC = 0
      for (const point of points || []) {
        const { data: shifts } = await supabase
          .from('points_shifts')
          .select('om, wave, djamo, espece')
          .eq('point_id', point.id)

        const s = (shifts || []).reduce((acc, sh) => ({
          om: acc.om + (sh.om || 0),
          wave: acc.wave + (sh.wave || 0),
          djamo: acc.djamo + (sh.djamo || 0),
          espece: acc.espece + (sh.espece || 0),
        }), { om: 0, wave: 0, djamo: 0, espece: 0 })

        const yangoTab = parseFloat(point.yango_tab) || 0
        const glovoTab = parseFloat(point.glovo_tab) || 0
        totalBSC += (yangoTab * 0.77) + (glovoTab * 0.705)
          + (s.om * 0.99) + (s.wave * 0.99) + (s.djamo * 0.99) + s.espece
      }
      setBscMois(totalBSC)
    }

    setLoading(false)
  }

  async function recalculerBSC() {
    setRecalculating(true)
    const debut = `${moisSelectionne}-01`
    const [ry, rm] = moisSelectionne.split('-').map(Number)
    const fin = `${moisSelectionne}-${String(new Date(ry, rm, 0).getDate()).padStart(2, '0')}`
    const { data: points } = await supabase
      .from('points')
      .select('id, yango_tab, glovo_tab')
      .eq('restaurant_id', restoSelectionne.id)
      .eq('valide', true)
      .gte('date', debut)
      .lte('date', fin)

    for (const point of points || []) {
      const { data: shifts } = await supabase
        .from('points_shifts')
        .select('om, wave, djamo, espece')
        .eq('point_id', point.id)

      const s = (shifts || []).reduce((acc, sh) => ({
        om: acc.om + (sh.om || 0),
        wave: acc.wave + (sh.wave || 0),
        djamo: acc.djamo + (sh.djamo || 0),
        espece: acc.espece + (sh.espece || 0),
      }), { om: 0, wave: 0, djamo: 0, espece: 0 })

      const yangoTab = parseFloat(point.yango_tab) || 0
      const glovoTab = parseFloat(point.glovo_tab) || 0
      const bsc = (yangoTab * 0.77) + (glovoTab * 0.705)
        + (s.om * 0.99) + (s.wave * 0.99) + (s.djamo * 0.99) + s.espece

      await supabase.from('points').update({ benefice_sc: bsc }).eq('id', point.id)
    }

    setRecalculating(false)
    chargerCharges()
    Alert.alert('✅ BSC recalculé', `${(points || []).length} point(s) mis à jour.`)
  }

  function totalCharges() {
    return charges.reduce((sum, c) => sum + (parseFloat(c.montant) || 0), 0)
  }

  function beneficeReel() {
    return bscMois - totalCharges()
  }

  function beneficeApresCharge() {
    const montant = parseFloat(formCharge.montant) || 0
    const ancienMontant = chargeEnEdition ? (parseFloat(chargeEnEdition.montant) || 0) : 0
    return bscMois - (totalCharges() - ancienMontant + montant)
  }

  function totalApresCharge() {
    const montant = parseFloat(formCharge.montant) || 0
    const ancienMontant = chargeEnEdition ? (parseFloat(chargeEnEdition.montant) || 0) : 0
    return totalCharges() - ancienMontant + montant
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatMois(moisStr) {
    if (!moisStr) return ''
    const [y, m] = moisStr.split('-')
    return `${MOIS_NOMS[parseInt(m) - 1]} ${y}`
  }

  function getMoisListe() {
    const mois = []
    const today = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      mois.push(str)
    }
    return mois
  }

  async function sauvegarder() {
    if (!formCharge.libelle) {
      Alert.alert('Erreur', 'Le libellé est obligatoire')
      return
    }
    if (!formCharge.montant || parseFloat(formCharge.montant) <= 0) {
      Alert.alert('Erreur', 'Le montant doit être supérieur à 0')
      return
    }
    setSaving(true)

    if (chargeEnEdition) {
      await supabase.from('charges')
        .update({ libelle: formCharge.libelle, montant: parseFloat(formCharge.montant) })
        .eq('id', chargeEnEdition.id)
    } else {
      await supabase.from('charges').insert({
        restaurant_id: restoSelectionne.id,
        mois: moisSelectionne,
        libelle: formCharge.libelle,
        montant: parseFloat(formCharge.montant),
      })
    }

    setSaving(false)
    setModalCharge(false)
    setFormCharge({ libelle: '', montant: '' })
    setChargeEnEdition(null)
    chargerCharges()
  }

  async function supprimerCharge(charge) {
    await supabase.from('charges').delete().eq('id', charge.id)
    chargerCharges()
  }

  function ouvrirEdition(charge) {
    setChargeEnEdition(charge)
    setFormCharge({ libelle: charge.libelle, montant: String(charge.montant) })
    setModalCharge(true)
  }

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
          <Text style={styles.headerTitre}>Charges du mois</Text>
          <Text style={styles.headerSub}>{restoSelectionne?.nom || ''}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Sélection restaurant */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.restoBar}>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, restoSelectionne?.id === r.id && styles.restoBtnActive]}
            onPress={() => setRestoSelectionne(r)}
          >
            <Text style={[styles.restoTxt, restoSelectionne?.id === r.id && styles.restoTxtActive]}>
              {r.nom}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sélection mois */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moisBar}>
        {getMoisListe().map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.moisBtn, moisSelectionne === m && styles.moisBtnActive]}
            onPress={() => setMoisSelectionne(m)}
          >
            <Text style={[styles.moisTxt, moisSelectionne === m && styles.moisTxtActive]}>
              {formatMois(m)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Bilan financier — uniquement pour manager/admin */}
          {!isRH && (
            <View style={styles.bilanCard}>
              <Text style={styles.bilanTitre}>📊 Bilan — {formatMois(moisSelectionne)}</Text>

              {/* BSC = bénéfice avant déduction des charges */}
              <View style={styles.bscBanner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bscLabel}>Bénéfice sans charges</Text>
                  <Text style={styles.bscSub}>
                    {pointsValideCount > 0
                      ? `${pointsValideCount} jour(s) validé(s) ce mois`
                      : 'Aucun point validé ce mois'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={styles.bscVal}>{fmt(bscMois)}</Text>
                  {pointsValideCount > 0 && (
                    <TouchableOpacity
                      style={styles.recalcBtn}
                      onPress={recalculerBSC}
                      disabled={recalculating}
                    >
                      <Text style={styles.recalcTxt}>
                        {recalculating ? '...' : '🔄 Recalculer'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.bilanRow}>
                <Text style={styles.bilanLabel}>− Total charges</Text>
                <Text style={[styles.bilanValue, { color: '#A32D2D' }]}>{fmt(totalCharges())}</Text>
              </View>
              <View style={[styles.bilanRow, { borderBottomWidth: 0, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#C0A860' }]}>
                <Text style={[styles.bilanLabel, { fontSize: 16, fontWeight: '700', color: '#1a1a1a' }]}>
                  = Bénéfice réel
                </Text>
                <Text style={[styles.bilanValue, {
                  fontSize: 20, fontWeight: '700',
                  color: beneficeReel() >= 0 ? '#3B6D11' : '#A32D2D'
                }]}>
                  {fmt(beneficeReel())}
                </Text>
              </View>
            </View>
          )}

          {/* Liste des charges */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitre}>
              Charges — {formatMois(moisSelectionne)}
            </Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                setChargeEnEdition(null)
                setFormCharge({ libelle: '', montant: '' })
                setModalCharge(true)
              }}
            >
              <Text style={styles.addTxt}>+ Ajouter</Text>
            </TouchableOpacity>
          </View>

          {charges.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTxt}>Aucune charge pour ce mois</Text>
              <Text style={styles.emptySub}>Appuyez sur "+ Ajouter" pour commencer</Text>
            </View>
          ) : (
            <View style={styles.chargesCard}>
              {charges.map((c, i) => (
                <View key={c.id} style={[
                  styles.chargeRow,
                  i === charges.length - 1 && { borderBottomWidth: 0 }
                ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chargeLibelle}>{c.libelle}</Text>
                  </View>
                  <Text style={styles.chargeMontant}>{fmt(c.montant)}</Text>
                  <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirEdition(c)}>
                    <Text style={styles.editTxt}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimerCharge(c)}>
                    <Text style={styles.deleteTxt}>🗑</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total charges</Text>
                <Text style={styles.totalVal}>{fmt(totalCharges())}</Text>
              </View>
            </View>
          )}

          {/* Bénéfice réel en bas en gras — uniquement manager/admin */}
          {!isRH && charges.length > 0 && (
            <View style={[styles.beneficeCard, {
              backgroundColor: beneficeReel() >= 0 ? '#EAF3DE' : '#FAECE7',
              borderColor: beneficeReel() >= 0 ? '#3B6D11' : '#A32D2D',
            }]}>
              <Text style={styles.beneficeLabel}>Bénéfice réel du mois</Text>
              <Text style={[styles.beneficeVal, {
                color: beneficeReel() >= 0 ? '#3B6D11' : '#A32D2D'
              }]}>
                {fmt(beneficeReel())}
              </Text>
              <Text style={styles.beneficeSub}>
                BSC {fmt(bscMois)} − Charges {fmt(totalCharges())}
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Modal ajout/édition charge */}
      <Modal visible={modalCharge} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView
              style={styles.modal}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.modalTitre}>
                {chargeEnEdition ? 'Modifier la charge' : 'Nouvelle charge'}
              </Text>

              <Text style={styles.modalLabel}>Libellé *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Ex: Loyer, Électricité, Salaire fixe..."
                value={formCharge.libelle}
                onChangeText={v => setFormCharge(p => ({ ...p, libelle: v }))}
                placeholderTextColor="#bbb"
              />

              <Text style={styles.modalLabel}>Montant (FCFA) *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Ex: 500000"
                value={formCharge.montant}
                onChangeText={v => setFormCharge(p => ({ ...p, montant: v }))}
                keyboardType="numeric"
                placeholderTextColor="#bbb"
              />

              {!isRH && parseFloat(formCharge.montant) > 0 && (
                <View style={[styles.previewBox, {
                  backgroundColor: beneficeApresCharge() >= 0 ? '#EAF3DE' : '#FAECE7',
                  borderColor: beneficeApresCharge() >= 0 ? '#3B6D11' : '#A32D2D',
                }]}>
                  <Text style={styles.previewLabel}>Bénéfice réel après cette charge</Text>
                  <Text style={[styles.previewVal, {
                    color: beneficeApresCharge() >= 0 ? '#3B6D11' : '#A32D2D'
                  }]}>
                    {fmt(beneficeApresCharge())}
                  </Text>
                  <Text style={styles.previewSub}>
                    BSC {fmt(bscMois)} − Charges {fmt(totalApresCharge())}
                  </Text>
                </View>
              )}

              <View style={[styles.modalBtns, { paddingBottom: 20 }]}>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => {
                    setModalCharge(false)
                    setChargeEnEdition(null)
                    setFormCharge({ libelle: '', montant: '' })
                  }}
                >
                  <Text style={styles.modalCancelTxt}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, saving && { opacity: 0.6 }]}
                  onPress={sauvegarder}
                  disabled={saving}
                >
                  <Text style={styles.modalConfirmTxt}>
                    {saving ? 'Enregistrement...' : 'Enregistrer'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#534AB7', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#CECBF6', textAlign: 'center' },
  restoBar: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  restoTxt: { fontSize: 12, color: '#888' },
  restoTxtActive: { color: '#534AB7', fontWeight: '600' },
  moisBar: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  moisBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  moisBtnActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  moisTxt: { fontSize: 12, color: '#888' },
  moisTxtActive: { color: '#EF9F27', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  bilanCard: {
    backgroundColor: '#FAEEDA', borderRadius: 14, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: '#FAC775'
  },
  bilanTitre: { fontSize: 14, fontWeight: '600', color: '#854F0B', marginBottom: 12 },
  bilanRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#F5C87A'
  },
  bilanLabel: { fontSize: 14, color: '#854F0B' },
  bilanValue: { fontSize: 15, fontWeight: '600' },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10
  },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { backgroundColor: '#534AB7', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  addTxt: { fontSize: 13, color: '#fff', fontWeight: '500' },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6 },
  chargesCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  chargeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5', gap: 8
  },
  chargeLibelle: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  chargeMontant: { fontSize: 14, fontWeight: '600', color: '#534AB7' },
  editBtn: { padding: 4 },
  editTxt: { fontSize: 16 },
  deleteBtn: { padding: 4 },
  deleteTxt: { fontSize: 16 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#eee'
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  totalVal: { fontSize: 16, fontWeight: '600', color: '#534AB7' },
  beneficeCard: {
    borderRadius: 14, padding: 16, marginBottom: 14,
    borderWidth: 2, alignItems: 'center'
  },
  beneficeLabel: { fontSize: 13, color: '#555', marginBottom: 8 },
  beneficeVal: { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  beneficeSub: { fontSize: 11, color: '#888', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 24, paddingBottom: 40
  },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 20 },
  modalLabel: { fontSize: 11, fontWeight: '600', color: '#888', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  modalInput: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#534AB7', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  bscBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFF8E8', borderRadius: 10, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#F5C87A',
  },
  bscLabel: { fontSize: 13, fontWeight: '700', color: '#854F0B' },
  bscSub: { fontSize: 10, color: '#BA7517', marginTop: 2 },
  bscVal: { fontSize: 18, fontWeight: '800', color: '#854F0B' },
  previewBox: {
    borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, alignItems: 'center',
  },
  previewLabel: { fontSize: 11, color: '#555', marginBottom: 6, fontWeight: '500' },
  previewVal: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  previewSub: { fontSize: 11, color: '#888', textAlign: 'center' },
  recalcBtn: {
    backgroundColor: '#BA7517', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  recalcTxt: { fontSize: 11, fontWeight: '600', color: '#fff' },
})