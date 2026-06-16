import * as DocumentPicker from 'expo-document-picker'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import {
    ActivityIndicator,
    Alert,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Linking,
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
import { creerNotification } from '../lib/notificationsInterne'
import { usePhoto } from '../lib/usePhoto'
import { supabase } from '../lib/supabase'

export default function DocumentsScreen() {
  const { roleActif, restaurantId, restaurantNom } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { prendrePhoto: capturer, choisirPhoto: choisir } = usePhoto()
  const isRH = roleActif === 'rh'
  const isManager = roleActif === 'manager'
  const canAdd = isRH || isManager
  const canView = ['manager', 'rh', 'gerant'].includes(roleActif)
  const hasRestoFixe = !isManager && !isRH  // gérant et caissier ont un resto fixe

  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalDoc, setModalDoc] = useState(false)
  const [docEnEdition, setDocEnEdition] = useState(null)
  const [form, setForm] = useState({
    titre: '',
    description: '',
    type: 'photo',
    url: null,
    localUri: null,
  })
  const [modalPreview, setModalPreview] = useState(false)
  const [docSelectionne, setDocSelectionne] = useState(null)
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [pdfName, setPdfName] = useState('')

  useEffect(() => {
    if (hasRestoFixe) {
      // Gérant/caissier : on charge directement leur restaurant
      if (restaurantId) setRestoSelectionne({ id: restaurantId, nom: restaurantNom })
    } else {
      chargerRestaurants()
    }
  }, [])

  useEffect(() => {
    if (restoSelectionne) chargerDocuments()
  }, [restoSelectionne])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
    if (data && data.length > 0) setRestoSelectionne(data[0])
  }

  async function chargerDocuments() {
    setLoading(true)
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .order('created_at', { ascending: false })
    setDocuments(data || [])
    setLoading(false)
  }

  async function choisirPhoto() {
    const url = await choisir('documents')
    if (url) setForm(p => ({ ...p, type: 'photo', localUri: url, url }))
  }

  async function prendrePhoto() {
    const url = await capturer('documents')
    if (url) setForm(p => ({ ...p, type: 'photo', localUri: url, url }))
  }

  async function sauvegarder() {
    if (!form.titre) {
      Alert.alert('Erreur', 'Le titre est obligatoire')
      return
    }
    setSaving(true)

    try {
      if (docEnEdition) {
        await supabase.from('documents')
          .update({
            titre: form.titre,
            description: form.description,
            type: form.type,
            url: form.url,
          })
          .eq('id', docEnEdition.id)
      } else {
        await supabase.from('documents').insert({
          restaurant_id: restoSelectionne.id,
          titre: form.titre,
          description: form.description,
          type: form.type,
          url: form.url,
          created_by: roleActif,
        })
        creerNotification({
          type: 'nouveau_document',
          titre: '📁 Nouveau document',
          message: `"${form.titre}" ajouté`,
          restaurant_id: restoSelectionne.id,
          cible_role: ['manager', 'directeur'],
          screen: 'documents',
        }).catch(() => {})
      }

      setSaving(false)
      setModalDoc(false)
      resetForm()
      chargerDocuments()
      Alert.alert('Succès', 'Document enregistré !')
    } catch (error) {
      setSaving(false)
      Alert.alert('Erreur', error.message)
    }
  }

  async function supprimerDoc(doc) {
    Alert.alert('Confirmer', `Supprimer "${doc.titre}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await supabase.from('documents').delete().eq('id', doc.id)
        chargerDocuments()
      }}
    ])
  }

  function resetForm() {
    setForm({ titre: '', description: '', type: 'photo', url: null, localUri: null })
    setDocEnEdition(null)
    setPdfName('')
  }

  async function choisirPDF() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      setUploadingPdf(true)

      const path = `${restoSelectionne.id}/${Date.now()}_${asset.name || 'document.pdf'}`
      const response = await fetch(asset.uri)
      const blob = await response.blob()

      const { error } = await supabase.storage
        .from('documents-pdf')
        .upload(path, blob, { contentType: 'application/pdf', upsert: true })

      if (error) {
        const msg = error.message?.includes('Bucket not found')
          ? "Bucket introuvable.\n\nExécutez dans Supabase SQL Editor :\n\nINSERT INTO storage.buckets (id, name, public)\nVALUES ('documents-pdf', 'documents-pdf', true);"
          : "Upload impossible : " + error.message
        Alert.alert('Erreur upload PDF', msg)
        setUploadingPdf(false)
        return
      }

      const { data: urlData } = supabase.storage.from('documents-pdf').getPublicUrl(path)
      setForm(p => ({ ...p, type: 'pdf', url: urlData.publicUrl }))
      setPdfName(asset.name || 'document.pdf')
      setUploadingPdf(false)
    } catch (err) {
      setUploadingPdf(false)
      Alert.alert('Erreur', err.message)
    }
  }

  function ouvrirEdition(doc) {
    setDocEnEdition(doc)
    setForm({
      titre: doc.titre,
      description: doc.description || '',
      type: doc.type || 'photo',
      url: doc.url,
      localUri: doc.url,
    })
    setModalDoc(true)
  }

  function ouvrirPreview(doc) {
    setDocSelectionne(doc)
    setModalPreview(true)
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
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
          <Text style={styles.headerTitre}>Documents</Text>
          <Text style={styles.headerSub}>{restoSelectionne?.nom || ''}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Sélection restaurant — uniquement manager/RH */}
      {!hasRestoFixe && (
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
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement des documents...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

          {/* Bouton ajouter */}
          {canAdd && (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => { resetForm(); setModalDoc(true) }}
            >
              <Text style={styles.addTxt}>+ Ajouter un document</Text>
            </TouchableOpacity>
          )}

          {/* Liste documents */}
          {documents.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📁</Text>
              <Text style={styles.emptyTxt}>Aucun document pour ce restaurant</Text>
              {canAdd && (
                <Text style={styles.emptySub}>Appuyez sur "+ Ajouter" pour commencer</Text>
              )}
            </View>
          ) : (
            <>
              <Text style={styles.sectionTitre}>{documents.length} document(s)</Text>
              {documents.map((doc, i) => (
                <TouchableOpacity
                  key={doc.id}
                  style={styles.docCard}
                  onPress={() => ouvrirPreview(doc)}
                >
                  <View style={styles.docLeft}>
                    {/* Miniature si photo */}
                    {doc.type === 'photo' && doc.url ? (
                      <Image
                        source={{ uri: doc.url }}
                        style={styles.docThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.docIconBox}>
                        <Text style={styles.docIcon}>
                          {doc.type === 'pdf' ? '📄' : '📁'}
                        </Text>
                      </View>
                    )}

                    <View style={{ flex: 1 }}>
                      <Text style={styles.docTitre}>{doc.titre}</Text>
                      {doc.description ? (
                        <Text style={styles.docDesc} numberOfLines={1}>{doc.description}</Text>
                      ) : null}
                      <Text style={styles.docDate}>{formatDate(doc.created_at)}</Text>
                    </View>
                  </View>

                  <View style={styles.docActions}>
                    <View style={[styles.docTypeBadge, { backgroundColor: doc.type === 'pdf' ? '#E6F1FB' : '#EAF3DE' }]}>
                      <Text style={[styles.docTypeTxt, { color: doc.type === 'pdf' ? '#185FA5' : '#3B6D11' }]}>
                        {doc.type === 'pdf' ? 'PDF' : 'Photo'}
                      </Text>
                    </View>
                    {canAdd && (
                      <>
                        <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirEdition(doc)}>
                          <Text>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimerDoc(doc)}>
                          <Text>🗑</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Modal ajout/édition */}
      <Modal visible={modalDoc} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView style={styles.modal} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitre}>
                  {docEnEdition ? 'Modifier le document' : 'Nouveau document'}
                </Text>

                <Text style={styles.modalLabel}>Titre *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ex: Registre de commerce, Contrat loyer..."
                  value={form.titre}
                  onChangeText={v => setForm(p => ({ ...p, titre: v }))}
                  placeholderTextColor="#bbb"
                />

                <Text style={styles.modalLabel}>Description (optionnel)</Text>
                <TextInput
                  style={[styles.modalInput, { height: 80, textAlignVertical: 'top' }]}
                  placeholder="Description du document..."
                  value={form.description}
                  onChangeText={v => setForm(p => ({ ...p, description: v }))}
                  multiline
                  placeholderTextColor="#bbb"
                />

                <Text style={styles.modalLabel}>Type de document</Text>
                <View style={styles.typeRow}>
                  {['photo', 'pdf'].map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.typeBtn, form.type === t && styles.typeBtnActive]}
                      onPress={() => setForm(p => ({ ...p, type: t }))}
                    >
                      <Text style={[styles.typeTxt, form.type === t && styles.typeTxtActive]}>
                        {t === 'photo' ? '📷 Photo' : '📄 PDF'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Boutons upload photo */}
                {form.type === 'photo' && (
                  <View style={styles.uploadRow}>
                    <TouchableOpacity style={styles.uploadBtn} onPress={prendrePhoto}>
                      <Text style={styles.uploadTxt}>📷 Prendre photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.uploadBtn} onPress={choisirPhoto}>
                      <Text style={styles.uploadTxt}>🖼 Galerie</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Préview */}
                {form.localUri && form.type === 'photo' && (
                  <Image
                    source={{ uri: form.localUri }}
                    style={styles.previewImg}
                    resizeMode="cover"
                  />
                )}

                {form.type === 'pdf' && (
                  <View>
                    <TouchableOpacity
                      style={[styles.uploadBtn, { marginBottom: 10 }, uploadingPdf && { opacity: 0.6 }]}
                      onPress={choisirPDF}
                      disabled={uploadingPdf}
                    >
                      {uploadingPdf ? (
                        <ActivityIndicator size="small" color="#534AB7" />
                      ) : (
                        <Text style={styles.uploadTxt}>📄 Choisir un fichier PDF</Text>
                      )}
                    </TouchableOpacity>
                    {form.url ? (
                      <View style={styles.pdfSelected}>
                        <Text style={styles.pdfSelectedIcon}>✅</Text>
                        <Text style={styles.pdfSelectedTxt} numberOfLines={1}>
                          {pdfName || 'PDF uploadé'}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.pdfHint}>Sélectionnez un PDF depuis votre appareil</Text>
                    )}
                  </View>
                )}

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => { setModalDoc(false); resetForm() }}
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
                <View style={{ height: 30 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Modal préview document */}
      <Modal visible={modalPreview} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.previewHeader}>
            <TouchableOpacity onPress={() => setModalPreview(false)}>
              <Text style={styles.previewClose}>✕ Fermer</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.previewTitre}>{docSelectionne?.titre}</Text>
              {docSelectionne?.description ? (
                <Text style={styles.previewDesc}>{docSelectionne.description}</Text>
              ) : null}
            </View>
          </View>
          {docSelectionne?.url && docSelectionne?.type === 'photo' && (
            <Image
              source={{ uri: docSelectionne.url }}
              style={{ flex: 1 }}
              resizeMode="contain"
            />
          )}
          {(!docSelectionne?.url || docSelectionne?.type !== 'photo') && (
            <View style={styles.previewEmpty}>
              <Text style={{ fontSize: 60 }}>📄</Text>
              <Text style={{ color: '#fff', marginTop: 12, fontSize: 14, fontWeight: '600' }}>
                {docSelectionne?.titre}
              </Text>
              {docSelectionne?.description ? (
                <Text style={{ color: '#888', marginTop: 6, fontSize: 12 }}>
                  {docSelectionne.description}
                </Text>
              ) : null}
              {docSelectionne?.url ? (
                <TouchableOpacity
                  style={styles.openPdfBtn}
                  onPress={() => Linking.openURL(docSelectionne.url)}
                >
                  <Text style={styles.openPdfTxt}>🔗 Ouvrir le PDF</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  restoBar: { backgroundColor: colors.surface, maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  restoTxt: { fontSize: 12, color: colors.textMuted },
  restoTxtActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  addBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
    borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 14
  },
  addTxt: { fontSize: 14, color: colors.primary, fontWeight: '500' },
  sectionTitre: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10
  },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 50, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6 },
  docCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  docLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  docThumb: { width: 56, height: 56, borderRadius: 10 },
  docIconBox: {
    width: 56, height: 56, borderRadius: 10,
    backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center'
  },
  docIcon: { fontSize: 28 },
  docTitre: { fontSize: 14, fontWeight: '600', color: colors.text },
  docDesc: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  docDate: { fontSize: 10, color: colors.textPlaceholder, marginTop: 4 },
  docActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docTypeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  docTypeTxt: { fontSize: 10, fontWeight: '500' },
  editBtn: { padding: 4 },
  deleteBtn: { padding: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 24, maxHeight: '90%'
  },
  modalTitre: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 20 },
  modalLabel: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase'
  },
  modalInput: {
    backgroundColor: colors.surfaceAlt, borderRadius: 12,
    padding: 14, fontSize: 15, color: colors.text, marginBottom: 14
  },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  typeBtn: {
    flex: 1, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', borderWidth: 0.5, borderColor: colors.border
  },
  typeBtnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeTxt: { fontSize: 14, color: colors.textMuted },
  typeTxtActive: { color: colors.primary, fontWeight: '600' },
  uploadRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  uploadBtn: {
    flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12,
    padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border
  },
  uploadTxt: { fontSize: 13, color: colors.textSecondary },
  previewImg: { width: '100%', height: 200, borderRadius: 12, marginBottom: 14 },
  pdfInfo: { backgroundColor: '#E6F1FB', borderRadius: 12, padding: 12, marginBottom: 14 },
  pdfInfoTxt: { fontSize: 12, color: '#185FA5', marginBottom: 8 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: colors.textMuted },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },
  previewHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, backgroundColor: '#111'
  },
  previewClose: { fontSize: 14, color: '#fff' },
  previewTitre: { fontSize: 15, fontWeight: '600', color: '#fff' },
  previewDesc: { fontSize: 11, color: '#888', marginTop: 2 },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  openPdfBtn: {
    marginTop: 24, backgroundColor: '#534AB7',
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 28
  },
  openPdfTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
  pdfSelected: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EAF3DE', borderRadius: 10, padding: 10, marginBottom: 10
  },
  pdfSelectedIcon: { fontSize: 16 },
  pdfSelectedTxt: { flex: 1, fontSize: 13, color: '#3B6D11', fontWeight: '500' },
  pdfHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 10 },
}) }