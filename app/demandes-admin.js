import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import { TYPES_DEMANDE } from '../lib/constants'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'

const STATUT_CONFIG = {
  en_attente: { label: '🟡 En attente', bg: '#FEF9EC', text: '#854F0B' },
  validee:    { label: '✅ Validée',    bg: '#EAF3DE', text: '#3B6D11' },
  declinee:   { label: '❌ Déclinée',   bg: '#FAECE7', text: '#993C1D' },
  annulee:    { label: '🚫 Annulée',    bg: '#F1EFE8', text: '#666'    },
}

const FILTRES_STATUT = ['Toutes', 'En attente', 'Validées', 'Déclinées', 'Annulées']
const STATUT_FILTRE_MAP = {
  'En attente': 'en_attente',
  'Validées': 'validee',
  'Déclinées': 'declinee',
  'Annulées': 'annulee',
}

function fmtDate(d) {
  if (!d) return ''
  const [y, m, j] = d.split('-')
  const mois = ['jan','fév','mar','avr','mai','juin','jul','aoû','sep','oct','nov','déc']
  return `${parseInt(j)} ${mois[parseInt(m) - 1]} ${y}`
}

export default function DemandesAdminScreen() {
  const { userId, userNom, roleActif } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const peutAnnuler = roleActif === 'rh' || roleActif === 'directeur' || roleActif === 'manager'

  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(null)
  const [statutFilter, setStatutFilter] = useState('Toutes')
  const [demandes, setDemandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  // Modal déclin
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [demandeEnCours, setDemandeEnCours] = useState(null)
  const [motifDecline, setMotifDecline] = useState('')
  const [saving, setSaving] = useState(false)
  // Modal confirmation annulation
  const [showAnnulerModal, setShowAnnulerModal] = useState(false)
  const [demandeAnnuler, setDemandeAnnuler] = useState(null)

  useEffect(() => {
    chargerRestaurants()
  }, [])

  useEffect(() => {
    charger()
  }, [restoFilter, statutFilter])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom').order('nom')
    setRestaurants(data || [])
  }

  async function charger() {
    setLoading(true)
    let q = supabase.from('demandes').select('*').order('created_at', { ascending: false })
    if (restoFilter) q = q.eq('restaurant_id', restoFilter)
    const sf = STATUT_FILTRE_MAP[statutFilter]
    if (sf) q = q.eq('statut', sf)
    const { data } = await q
    setDemandes(data || [])
    setLoading(false)
  }

  async function valider(d) {
    if (saving) return
    setSaving(true)
    await supabase.from('demandes').update({
      statut: 'validee',
      traite_par_id: userId,
      traite_par_nom: userNom,
      traite_at: new Date().toISOString(),
    }).eq('id', d.id)
    creerNotification({
      type: 'demande_validee',
      titre: 'Demande validée',
      message: `✅ ${d.type} pour ${d.travailleur_nom} — validée`,
      restaurant_id: d.restaurant_id,
      cible_user_id: d.cree_par_id,
      created_by: userId,
      screen: 'demandes',
    }).catch(() => {})
    journaliser({ action: 'demande_validee', details: `${d.type} pour ${d.travailleur_nom}`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  function ouvrirDeclin(d) {
    setDemandeEnCours(d)
    setMotifDecline('')
    setShowDeclineModal(true)
  }

  async function confirmerDeclin() {
    if (!motifDecline.trim()) return Alert.alert('Erreur', 'Le motif du refus est obligatoire')
    setSaving(true)
    await supabase.from('demandes').update({
      statut: 'declinee',
      motif_decline: motifDecline.trim(),
      traite_par_id: userId,
      traite_par_nom: userNom,
      traite_at: new Date().toISOString(),
    }).eq('id', demandeEnCours.id)
    creerNotification({
      type: 'demande_declinee',
      titre: 'Demande déclinée',
      message: `❌ ${demandeEnCours.type} pour ${demandeEnCours.travailleur_nom} — Motif : ${motifDecline.trim()}`,
      restaurant_id: demandeEnCours.restaurant_id,
      cible_user_id: demandeEnCours.cree_par_id,
      created_by: userId,
      screen: 'demandes',
    }).catch(() => {})
    journaliser({ action: 'demande_declinee', details: `${demandeEnCours.type} — motif: ${motifDecline.trim()}`, userId, restaurantId: demandeEnCours.restaurant_id }).catch(() => {})
    setSaving(false)
    setShowDeclineModal(false)
    setDemandeEnCours(null)
    charger()
  }

  function confirmerAnnulation(d) {
    setDemandeAnnuler(d)
    setShowAnnulerModal(true)
  }

  async function executerAnnulation() {
    if (!demandeAnnuler || saving) return
    setSaving(true)
    await supabase.from('demandes').update({
      statut: 'annulee',
      annule_par_id: userId,
      annule_par_nom: userNom,
      annule_at: new Date().toISOString(),
    }).eq('id', demandeAnnuler.id)
    creerNotification({
      type: 'demande_annulee',
      titre: 'Demande annulée',
      message: `🚫 ${demandeAnnuler.type} pour ${demandeAnnuler.travailleur_nom} — annulée par ${userNom}`,
      restaurant_id: demandeAnnuler.restaurant_id,
      cible_user_id: demandeAnnuler.cree_par_id,
      created_by: userId,
      screen: 'demandes',
    }).catch(() => {})
    journaliser({ action: 'demande_annulee', details: `${demandeAnnuler.type} pour ${demandeAnnuler.travailleur_nom}, annulé par ${userNom}`, userId, restaurantId: demandeAnnuler.restaurant_id }).catch(() => {})
    setSaving(false)
    setShowAnnulerModal(false)
    setDemandeAnnuler(null)
    charger()
  }

  const restoNom = restoFilter
    ? restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant'
    : 'Tous les restaurants'

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Demandes</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filtre restaurant */}
      <View style={styles.filtersRow}>
        <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoBtnTxt}>🏪 {restoNom} ▾</Text>
        </TouchableOpacity>
      </View>

      {/* Filtre statut */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statutFilters} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {FILTRES_STATUT.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.statutFilterBtn, statutFilter === f && styles.statutFilterBtnActive]}
            onPress={() => setStatutFilter(f)}
          >
            <Text style={[styles.statutFilterTxt, statutFilter === f && styles.statutFilterTxtActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {demandes.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTxt}>Aucune demande{statutFilter !== 'Toutes' ? ` (${statutFilter.toLowerCase()})` : ''}</Text>
            </View>
          ) : (
            demandes.map(d => {
              const cfg = STATUT_CONFIG[d.statut] || STATUT_CONFIG.en_attente
              const typeDef = TYPES_DEMANDE.find(t => t.label === d.type)
              const restoNomCarte = restaurants.find(r => r.id === d.restaurant_id)?.nom || ''
              return (
                <View key={d.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardType}>{typeDef?.icon || '📋'} {d.type}</Text>
                    <View style={[styles.statutBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statutTxt, { color: cfg.text }]}>{cfg.label}</Text>
                    </View>
                  </View>

                  <Text style={styles.cardTrav}>{d.travailleur_nom}</Text>
                  {restoNomCarte ? <Text style={styles.cardResto}>🏪 {restoNomCarte}</Text> : null}
                  {d.cree_par_nom ? <Text style={styles.cardGerant}>👤 Soumis par {d.cree_par_nom}</Text> : null}
                  {d.date_debut && (
                    <Text style={styles.cardDates}>📅 {fmtDate(d.date_debut)} → {fmtDate(d.date_fin)}</Text>
                  )}
                  {d.description ? <Text style={styles.cardDesc}>"{d.description}"</Text> : null}
                  <Text style={styles.cardMeta}>Le {fmtDate(d.created_at?.split('T')[0])}</Text>

                  {d.statut === 'validee' && d.traite_par_nom && (
                    <Text style={styles.cardMeta}>✅ Validé par {d.traite_par_nom}</Text>
                  )}
                  {d.statut === 'declinee' && (
                    <View style={styles.declineBox}>
                      <Text style={styles.declineTitre}>Motif du refus :</Text>
                      <Text style={styles.declineTxt}>{d.motif_decline}</Text>
                    </View>
                  )}
                  {d.statut === 'annulee' && d.annule_par_nom && (
                    <Text style={styles.cardMeta}>🚫 Annulé par {d.annule_par_nom}</Text>
                  )}

                  {/* Actions */}
                  {d.statut === 'en_attente' && (
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.btnValider} onPress={() => valider(d)} disabled={saving}>
                        <Text style={styles.btnValiderTxt}>✅ Valider</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.btnDecliner} onPress={() => ouvrirDeclin(d)} disabled={saving}>
                        <Text style={styles.btnDeclinerTxt}>❌ Décliner</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {d.statut === 'validee' && peutAnnuler && (
                    <TouchableOpacity style={styles.btnAnnuler} onPress={() => confirmerAnnulation(d)} disabled={saving}>
                      <Text style={styles.btnAnnulerTxt}>🚫 Annuler la validation</Text>
                    </TouchableOpacity>
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
              <TouchableOpacity style={styles.pickerItem} onPress={() => { setRestoFilter(null); setShowRestoPicker(false) }}>
                <Text style={[styles.pickerItemTxt, !restoFilter && { fontWeight: '700', color: '#534AB7' }]}>🌍 Tous les restaurants</Text>
              </TouchableOpacity>
              {restaurants.map(r => (
                <TouchableOpacity key={r.id} style={styles.pickerItem} onPress={() => { setRestoFilter(r.id); setShowRestoPicker(false) }}>
                  <Text style={[styles.pickerItemTxt, restoFilter === r.id && { fontWeight: '700', color: '#534AB7' }]}>
                    🏪 {r.nom}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Modal confirmation annulation */}
      <Modal visible={showAnnulerModal} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => { setShowAnnulerModal(false); setDemandeAnnuler(null) }}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.declineModal, { padding: 24 }]}>
                <Text style={[styles.modalTitre, { marginBottom: 12 }]}>Annuler la validation ?</Text>
                {demandeAnnuler && (
                  <Text style={[styles.declineInfo, { marginBottom: 16 }]}>
                    {demandeAnnuler.type} pour {demandeAnnuler.travailleur_nom}{'\n'}
                    Le travailleur redeviendra immédiatement modifiable dans Présences.
                  </Text>
                )}
                <TouchableOpacity
                  style={[styles.btnDeclinerConfirm, { backgroundColor: '#666' }, saving && { opacity: 0.5 }]}
                  onPress={executerAnnulation}
                  disabled={saving}
                >
                  <Text style={styles.btnDeclinerConfirmTxt}>{saving ? 'Annulation...' : '🚫 Confirmer l\'annulation'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnDeclinerConfirm, { backgroundColor: colors.surface, marginTop: 10 }]}
                  onPress={() => { setShowAnnulerModal(false); setDemandeAnnuler(null) }}
                >
                  <Text style={[styles.btnDeclinerConfirmTxt, { color: colors.text }]}>Retour</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Modal motif déclin */}
      <Modal visible={showDeclineModal} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <View style={styles.declineModal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>Motif du refus</Text>
                  <TouchableOpacity onPress={() => { setShowDeclineModal(false); setMotifDecline('') }}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                {demandeEnCours && (
                  <Text style={styles.declineInfo}>
                    {demandeEnCours.type} — {demandeEnCours.travailleur_nom}
                  </Text>
                )}
                <TextInput
                  style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Expliquez le motif du refus (obligatoire)..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={4}
                  value={motifDecline}
                  onChangeText={setMotifDecline}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.btnDeclinerConfirm, (!motifDecline.trim() || saving) && { opacity: 0.5 }]}
                  onPress={confirmerDeclin}
                  disabled={!motifDecline.trim() || saving}
                >
                  <Text style={styles.btnDeclinerConfirmTxt}>{saving ? 'Envoi...' : '❌ Confirmer le refus'}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
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
    filtersRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    restoBtn: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border },
    restoBtnTxt: { fontSize: 14, color: colors.text, fontWeight: '500' },
    statutFilters: { paddingVertical: 8 },
    statutFilterBtn: { backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
    statutFilterBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    statutFilterTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    statutFilterTxtActive: { color: '#fff' },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    emptyBox: { alignItems: 'center', paddingTop: 60 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { color: colors.textMuted, fontSize: 15 },
    card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    cardType: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
    statutBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    statutTxt: { fontSize: 12, fontWeight: '600' },
    cardTrav: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 2 },
    cardResto: { fontSize: 13, color: colors.textMuted, marginBottom: 2 },
    cardGerant: { fontSize: 13, color: colors.textMuted, marginBottom: 2 },
    cardDates: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
    cardDesc: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
    cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
    declineBox: { backgroundColor: '#FAECE7', borderRadius: 8, padding: 10, marginTop: 8 },
    declineTitre: { fontSize: 12, fontWeight: '700', color: '#993C1D', marginBottom: 2 },
    declineTxt: { fontSize: 13, color: '#993C1D' },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    btnValider: { flex: 1, backgroundColor: '#EAF3DE', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnValiderTxt: { color: '#3B6D11', fontWeight: '700', fontSize: 14 },
    btnDecliner: { flex: 1, backgroundColor: '#FAECE7', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnDeclinerTxt: { color: '#993C1D', fontWeight: '700', fontSize: 14 },
    btnAnnuler: { marginTop: 10, backgroundColor: '#F1EFE8', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnAnnulerTxt: { color: '#666', fontWeight: '600', fontSize: 13 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    pickerModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '60%' },
    pickerTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
    pickerItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    pickerItemTxt: { fontSize: 15, color: colors.text },
    declineModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    modalTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    modalClose: { fontSize: 20, color: colors.textMuted, padding: 4 },
    declineInfo: { fontSize: 14, color: colors.textMuted, marginBottom: 12, fontStyle: 'italic' },
    textArea: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 100, textAlignVertical: 'top', marginBottom: 16, backgroundColor: colors.background },
    btnDeclinerConfirm: { backgroundColor: '#993C1D', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    btnDeclinerConfirmTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  })
}
