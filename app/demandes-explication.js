import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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
import { uploadFichier } from '../lib/api'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifExplicationNouvelle } from '../lib/notifications'
import { genererPdfExplication } from '../lib/pdfDocuments'
import { supabase } from '../lib/supabase'

export const STATUT_EXPLICATION = {
  en_attente_acceptation: { label: "🟡 En attente d'acceptation", bg: '#FEF9EC', text: '#854F0B' },
  acceptee:               { label: '📤 Acceptée — à envoyer',      bg: '#E7EEFB', text: '#1D4FA0' },
  envoyee:                { label: '📨 Envoyée — attente réponse',  bg: '#EAF3DE', text: '#3B6D11' },
  reponse_recuperee:      { label: '✅ Réponse récupérée',          bg: '#E0F9EE', text: '#157548' },
  relancee:               { label: '🔁 Relancée (2ᵉ demande)',      bg: '#FBEEDD', text: '#9A5B0B' },
  refusee:                { label: '❌ Refusée',                    bg: '#FAECE7', text: '#993C1D' },
  annulee:                { label: '🚫 Annulée',                    bg: '#F1EFE8', text: '#666'    },
}

export function fmtDateHeure(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DemandesExplicationScreen() {
  const { restaurantId, restaurantNom, userId, userNom, roleActif } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [demandes, setDemandes] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const [formTrav, setFormTrav] = useState(null)
  const [formMotif, setFormMotif] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [uploadingId, setUploadingId] = useState(null)

  useEffect(() => {
    if (restaurantId) charger()
  }, [restaurantId])

  async function charger() {
    setLoading(true)
    const [{ data: travData }, { data: demData }] = await Promise.all([
      supabase.from('travailleurs').select('id, nom, poste').eq('restaurant_id', restaurantId).eq('actif', true).order('nom'),
      supabase.from('demandes_explication').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
    ])
    setTravailleurs(travData || [])
    setDemandes(demData || [])
    setLoading(false)
  }

  function resetForm() {
    setFormTrav(null)
    setFormMotif('')
    setFormDesc('')
  }

  async function soumettre() {
    if (!formTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (!formMotif.trim()) return Alert.alert('Erreur', "Précisez le motif de la demande d'explication")
    setSaving(true)
    const { error } = await supabase.from('demandes_explication').insert({
      restaurant_id: restaurantId,
      travailleur_id: formTrav.id,
      travailleur_nom: formTrav.nom,
      travailleur_poste: formTrav.poste || null,
      motif: formMotif.trim(),
      description: formDesc.trim() || null,
      statut: 'en_attente_acceptation',
      numero: 1,
      cree_par_id: userId,
      cree_par_nom: userNom,
      cree_par_role: roleActif,
    })
    if (error) {
      setSaving(false)
      return Alert.alert('Erreur', error.message)
    }
    creerNotification({
      type: 'explication_nouvelle',
      titre: "Demande d'explication",
      message: `📨 ${formTrav.nom} — ${restaurantNom} · à accepter`,
      restaurant_id: restaurantId,
      cible_role: ['directeur', 'rh', 'manager'],
      created_by: userId,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    envoyerNotifExplicationNouvelle(formTrav.nom, restaurantId).catch(() => {})
    journaliser({ action: 'explication_creee', details: `${formTrav.nom} — ${formMotif.trim()}`, userId, restaurantId }).catch(() => {})
    setSaving(false)
    setShowModal(false)
    resetForm()
    charger()
  }

  async function imprimerPdf(d) {
    try {
      await genererPdfExplication({
        travailleurNom: d.travailleur_nom,
        poste: d.travailleur_poste,
        restaurantNom,
        motif: d.motif,
        description: d.description,
        date: d.envoyee_at || d.created_at,
      })
    } catch (_e) {
      Alert.alert('Erreur', "Impossible de générer le PDF")
    }
  }

  async function uploaderReponse(d, mode) {
    if (uploadingId) return
    let uri = null
    try {
      if (mode === 'image') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (perm.status !== 'granted' && Platform.OS !== 'web') {
          return Alert.alert('Autorisation requise', "Autorisez l'accès aux photos pour uploader la réponse.")
        }
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 })
        if (res.canceled) return
        uri = res.assets?.[0]?.uri
      } else {
        const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
        if (res.canceled) return
        uri = res.assets?.[0]?.uri
      }
    } catch (_e) {
      return Alert.alert('Erreur', "Impossible d'ouvrir le sélecteur de fichier")
    }
    if (!uri) return
    setUploadingId(d.id)
    const url = await uploadFichier(uri, 'reponses_explication')
    if (!url) { setUploadingId(null); return Alert.alert('Erreur', "L'upload a échoué. Réessayez.") }
    await supabase.from('demandes_explication').update({
      reponse_fichier_url: url,
      reponse_fichier_type: mode === 'image' ? 'image' : 'pdf',
      reponse_uploadee_at: new Date().toISOString(),
    }).eq('id', d.id)
    creerNotification({
      type: 'explication_reponse_upload',
      titre: 'Réponse reçue',
      message: `📎 Réponse de ${d.travailleur_nom} déposée — ${restaurantNom}`,
      restaurant_id: restaurantId,
      cible_role: ['directeur', 'rh', 'manager'],
      created_by: userId,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    journaliser({ action: 'explication_reponse_upload', details: `${d.travailleur_nom}`, userId, restaurantId }).catch(() => {})
    setUploadingId(null)
    charger()
  }

  function voirFichier(url) {
    if (!url) return
    if (Platform.OS === 'web') window.open(url, '_blank')
    else Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir le fichier"))
  }

  if (loading) return (
    <SafeAreaView style={styles.container}>
      <Header styles={styles} />
      <View style={styles.loadingBox}><ActivityIndicator size="large" color="#534AB7" /></View>
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={styles.container}>
      <Header styles={styles} />
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.addBtn} onPress={() => { resetForm(); setShowModal(true) }}>
          <Text style={styles.addBtnTxt}>+ Demander une explication</Text>
        </TouchableOpacity>

        {demandes.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📨</Text>
            <Text style={styles.emptyTxt}>{"Aucune demande d'explication"}</Text>
          </View>
        ) : (
          demandes.map(d => {
            const cfg = STATUT_EXPLICATION[d.statut] || STATUT_EXPLICATION.en_attente_acceptation
            return (
              <View key={d.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTrav}>📨 {d.travailleur_nom}{d.travailleur_poste ? ` · ${d.travailleur_poste}` : ''}{d.numero > 1 ? `  (relance ${d.numero})` : ''}</Text>
                  <View style={[styles.statutBadge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.statutTxt, { color: cfg.text }]}>{cfg.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardMotif}>{d.motif}</Text>
                {d.description ? <Text style={styles.cardDesc}>{`« ${d.description} »`}</Text> : null}
                <Text style={styles.cardMeta}>Soumise le {fmtDateHeure(d.created_at)}</Text>
                {d.statut === 'acceptee' && d.accepte_par_nom && (
                  <Text style={styles.cardMeta}>✅ Acceptée par {d.accepte_par_nom}</Text>
                )}
                {d.envoyee_at && <Text style={styles.cardMeta}>📤 Envoyée le {fmtDateHeure(d.envoyee_at)}</Text>}
                {d.statut === 'reponse_recuperee' && (
                  <Text style={styles.cardMeta}>✅ Réponse récupérée le {fmtDateHeure(d.reponse_recuperee_at)}</Text>
                )}
                {d.statut === 'refusee' && (
                  <View style={styles.declineBox}>
                    <Text style={styles.declineTitre}>Motif du refus :</Text>
                    <Text style={styles.declineTxt}>{d.refus_motif}</Text>
                  </View>
                )}
                {['acceptee', 'envoyee', 'relancee', 'reponse_recuperee'].includes(d.statut) && (
                  <TouchableOpacity style={styles.pdfBtn} onPress={() => imprimerPdf(d)}>
                    <Text style={styles.pdfBtnTxt}>{"📄 Télécharger la demande d'explication"}</Text>
                  </TouchableOpacity>
                )}

                {/* Réponse du travailleur (upload gérant) */}
                {d.reponse_fichier_url ? (
                  <TouchableOpacity style={styles.reponseVoir} onPress={() => voirFichier(d.reponse_fichier_url)}>
                    <Text style={styles.reponseVoirTxt}>
                      {d.reponse_fichier_type === 'pdf' ? '📄' : '🖼️'} Réponse déposée — voir
                    </Text>
                  </TouchableOpacity>
                ) : ['envoyee', 'relancee'].includes(d.statut) ? (
                  <View style={styles.reponseBloc}>
                    <Text style={styles.reponseLabel}>📎 Déposer la réponse du travailleur :</Text>
                    {uploadingId === d.id ? (
                      <View style={styles.reponseUploading}>
                        <ActivityIndicator size="small" color="#534AB7" />
                        <Text style={styles.reponseUploadingTxt}>Envoi…</Text>
                      </View>
                    ) : (
                      <View style={styles.reponseBtns}>
                        <TouchableOpacity style={styles.reponseBtn} onPress={() => uploaderReponse(d, 'image')}>
                          <Text style={styles.reponseBtnTxt}>🖼️ Photo</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.reponseBtn} onPress={() => uploaderReponse(d, 'pdf')}>
                          <Text style={styles.reponseBtnTxt}>📄 PDF</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            )
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showModal} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <View style={styles.modal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>{"Demande d'explication"}</Text>
                  <TouchableOpacity onPress={() => { setShowModal(false); resetForm() }}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={styles.label}>Travailleur concerné</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {travailleurs.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.travChip, formTrav?.id === t.id && styles.travChipActive]}
                        onPress={() => setFormTrav(t)}
                      >
                        <Text style={[styles.travChipTxt, formTrav?.id === t.id && styles.travChipTxtActive]}>{t.nom}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={styles.label}>Motif de la demande</Text>
                  <TextInput
                    style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Ex : Retard répété, caisse manquante…"
                    placeholderTextColor={colors.textMuted}
                    value={formMotif}
                    onChangeText={setFormMotif}
                  />

                  <Text style={styles.label}>Détails (optionnel)</Text>
                  <TextInput
                    style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Précisez les faits, dates, montants…"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={3}
                    value={formDesc}
                    onChangeText={setFormDesc}
                  />

                  <TouchableOpacity
                    style={[styles.submitBtn, saving && { opacity: 0.6 }]}
                    onPress={soumettre}
                    disabled={saving}
                  >
                    <Text style={styles.submitBtnTxt}>{saving ? 'Envoi...' : '📤 Soumettre'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>La demande sera acceptée puis envoyée par le manager, la RH ou la direction.</Text>
                  <View style={{ height: 30 }} />
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

function Header({ styles }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
        <Text style={styles.back}>‹ Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitre}>Explications</Text>
      <View style={{ width: 60 }} />
    </View>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    back: { fontSize: 16, color: '#534AB7', fontWeight: '500' },
    headerTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, paddingHorizontal: 16 },
    addBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 16 },
    addBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    emptyBox: { alignItems: 'center', paddingTop: 60 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { color: colors.textMuted, fontSize: 15 },
    card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
    cardTrav: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
    statutBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    statutTxt: { fontSize: 11, fontWeight: '600' },
    cardMotif: { fontSize: 14, color: colors.text, marginBottom: 4 },
    cardDesc: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
    cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
    declineBox: { backgroundColor: '#FAECE7', borderRadius: 8, padding: 10, marginTop: 8 },
    declineTitre: { fontSize: 12, fontWeight: '700', color: '#993C1D', marginBottom: 2 },
    declineTxt: { fontSize: 13, color: '#993C1D' },
    pdfBtn: { marginTop: 12, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    pdfBtnTxt: { color: '#534AB7', fontWeight: '700', fontSize: 13 },
    reponseBloc: { marginTop: 12, backgroundColor: colors.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    reponseLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600', marginBottom: 8 },
    reponseBtns: { flexDirection: 'row', gap: 10 },
    reponseBtn: { flex: 1, backgroundColor: '#534AB7', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    reponseBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    reponseUploading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
    reponseUploadingTxt: { color: colors.textMuted, fontSize: 13 },
    reponseVoir: { marginTop: 12, backgroundColor: '#E0F9EE', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#A8E8CC' },
    reponseVoirTxt: { color: '#157548', fontWeight: '700', fontSize: 13 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '92%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    modalClose: { fontSize: 20, color: colors.textMuted, padding: 4 },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    travChip: { backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
    travChipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    travChipTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    travChipTxtActive: { color: '#fff' },
    input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16, backgroundColor: colors.background },
    textArea: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 16, backgroundColor: colors.background },
    submitBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    submitBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    hint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  })
}
