import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import { supabase } from '../lib/supabase'

const ONGLETS = ['Clients', 'Équipe', 'Fournisseurs']

export default function ContactsScreen() {
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [ongletActif, setOngletActif] = useState('Clients')
  const [contacts, setContacts] = useState({ Clients: [], Équipe: [], Fournisseurs: [] })
  const [selectionnes, setSelectionnes] = useState({})
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [typeEnvoi, setTypeEnvoi] = useState('sms')
  const [message, setMessage] = useState('')

  useEffect(() => { chargerRestaurants() }, [])
  useEffect(() => { if (restoSelectionne) chargerContacts() }, [restoSelectionne])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
    if (data && data.length > 0) setRestoSelectionne(data[0])
  }

  async function chargerContacts() {
    setLoading(true)
    setSelectionnes({})

    const [
      { data: commandes },
      { data: travailleurs },
      { data: fournisseurs },
    ] = await Promise.all([
      supabase.from('commandes')
        .select('contact_client, partenaire')
        .eq('point_id', supabase.from('points').select('id').eq('restaurant_id', restoSelectionne.id)),
      supabase.from('travailleurs')
        .select('id, nom, poste, contact')
        .eq('restaurant_id', restoSelectionne.id)
        .eq('actif', true)
        .not('contact', 'is', null),
      supabase.from('fournisseurs')
        .select('id, nom, type, contact')
        .eq('restaurant_id', restoSelectionne.id)
        .eq('actif', true)
        .not('contact', 'is', null),
    ])

    // Clients uniques avec contact non vide
    const clientsMap = {}
    ;(commandes || []).forEach(c => {
      const num = (c.contact_client || '').trim()
      if (num && num.length >= 8 && !clientsMap[num]) {
        clientsMap[num] = { id: num, nom: num, detail: c.partenaire || 'Client', numero: num }
      }
    })

    setContacts({
      Clients: Object.values(clientsMap),
      Équipe: (travailleurs || []).filter(t => t.contact).map(t => ({
        id: t.id, nom: t.nom, detail: t.poste || 'Équipe', numero: t.contact,
      })),
      Fournisseurs: (fournisseurs || []).filter(f => f.contact).map(f => ({
        id: f.id, nom: f.nom, detail: f.type === 'cotisation' ? 'Cotisation' : 'Fournisseur', numero: f.contact,
      })),
    })
    setLoading(false)
  }

  // Requête clients séparée (join via points)
  async function chargerClients() {
    const { data: points } = await supabase
      .from('points').select('id').eq('restaurant_id', restoSelectionne.id)
    const pointIds = (points || []).map(p => p.id)
    if (pointIds.length === 0) return []

    const { data: commandes } = await supabase
      .from('commandes').select('contact_client, partenaire')
      .in('point_id', pointIds)
      .not('contact_client', 'is', null)
      .neq('contact_client', '')

    const map = {}
    ;(commandes || []).forEach(c => {
      const num = (c.contact_client || '').trim()
      if (num && num.length >= 8 && !map[num]) {
        map[num] = { id: num, nom: num, detail: c.partenaire || 'Client', numero: num }
      }
    })
    return Object.values(map)
  }

  useEffect(() => {
    if (!restoSelectionne) return
    setLoading(true)
    setSelectionnes({})

    Promise.all([
      chargerClients(),
      supabase.from('travailleurs').select('id, nom, poste, contact')
        .eq('restaurant_id', restoSelectionne.id).eq('actif', true).not('contact', 'is', null),
      supabase.from('fournisseurs').select('id, nom, type, contact')
        .eq('restaurant_id', restoSelectionne.id).eq('actif', true).not('contact', 'is', null),
    ]).then(([clients, { data: travs }, { data: fours }]) => {
      setContacts({
        Clients: clients,
        Équipe: (travs || []).map(t => ({ id: t.id, nom: t.nom, detail: t.poste || 'Équipe', numero: t.contact })),
        Fournisseurs: (fours || []).map(f => ({ id: f.id, nom: f.nom, detail: f.type === 'cotisation' ? 'Cotisation' : 'Fournisseur', numero: f.contact })),
      })
      setLoading(false)
    })
  }, [restoSelectionne])

  const listeActive = contacts[ongletActif] || []

  function toggleSelection(id) {
    setSelectionnes(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function toutSelectionner() {
    const tous = {}
    listeActive.forEach(c => { tous[c.id] = true })
    setSelectionnes(tous)
  }

  function toutDeselectionner() {
    setSelectionnes({})
  }

  const nbSelectionnes = Object.values(selectionnes).filter(Boolean).length
  const numerosSelectionnes = listeActive
    .filter(c => selectionnes[c.id])
    .map(c => c.numero)

  function ouvrirComposeur(type) {
    if (numerosSelectionnes.length === 0) {
      Alert.alert('Aucun contact', 'Sélectionnez au moins un contact.')
      return
    }
    setTypeEnvoi(type)
    setModalVisible(true)
  }

  function envoyerSMS() {
    if (!message.trim()) {
      Alert.alert('Message vide', 'Écrivez votre message avant d\'envoyer.')
      return
    }
    const nums = numerosSelectionnes.join(',')
    const encodedMsg = encodeURIComponent(message)
    const sep = Platform.OS === 'ios' ? '&' : '?'
    const url = `sms:${nums}${sep}body=${encodedMsg}`
    Linking.openURL(url).catch(() =>
      Alert.alert('Erreur', 'Impossible d\'ouvrir l\'application SMS.')
    )
    setModalVisible(false)
    setMessage('')
  }

  function envoyerWhatsApp(numero) {
    const num = numero.replace(/\s+/g, '').replace(/[^\d+]/g, '')
    const encodedMsg = encodeURIComponent(message)
    const url = `https://wa.me/${num}?text=${encodedMsg}`
    Linking.openURL(url).catch(() =>
      Alert.alert('Erreur', 'Impossible d\'ouvrir WhatsApp.')
    )
    setModalVisible(false)
    setMessage('')
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
        <Text style={styles.headerTitre}>Contacts</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filtre restaurant */}
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

      {/* Onglets */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ongletBar}>
        {ONGLETS.map(o => {
          const nb = contacts[o]?.length || 0
          return (
            <TouchableOpacity
              key={o}
              style={[styles.ongletBtn, ongletActif === o && styles.ongletBtnActive]}
              onPress={() => { setOngletActif(o); setSelectionnes({}) }}
            >
              <Text style={[styles.ongletTxt, ongletActif === o && styles.ongletTxtActive]}>
                {o} {nb > 0 ? `(${nb})` : ''}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement...</Text>
        </View>
      ) : (
        <>
          {/* Barre tout sélectionner */}
          {listeActive.length > 0 && (
            <View style={styles.selectBar}>
              <Text style={styles.selectInfo}>
                {nbSelectionnes > 0 ? `${nbSelectionnes} sélectionné${nbSelectionnes > 1 ? 's' : ''}` : 'Aucun sélectionné'}
              </Text>
              <View style={styles.selectBtns}>
                <TouchableOpacity style={styles.selectBtn} onPress={toutSelectionner}>
                  <Text style={styles.selectBtnTxt}>Tout</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.selectBtn} onPress={toutDeselectionner}>
                  <Text style={styles.selectBtnTxt}>Aucun</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {listeActive.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>
                  {ongletActif === 'Clients' ? '🛵' : ongletActif === 'Équipe' ? '👥' : '🧾'}
                </Text>
                <Text style={styles.emptyTxt}>Aucun contact pour cet onglet</Text>
                <Text style={styles.emptySub}>
                  {ongletActif === 'Clients'
                    ? 'Les contacts clients viennent des livraisons enregistrées'
                    : 'Ajoutez des numéros dans Paramètres'}
                </Text>
              </View>
            ) : (
              listeActive.map(c => {
                const isSelected = !!selectionnes[c.id]
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.contactCard, isSelected && styles.contactCardSelected]}
                    onPress={() => toggleSelection(c.id)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={[styles.contactAvatar, isSelected && { backgroundColor: '#534AB7' }]}>
                      <Text style={styles.contactAvatarTxt}>
                        {c.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={styles.contactNom}>{c.nom}</Text>
                      <Text style={styles.contactDetail}>{c.detail}</Text>
                      <Text style={styles.contactNum}>{c.numero}</Text>
                    </View>
                    {/* WhatsApp rapide individuel */}
                    <TouchableOpacity
                      style={styles.waBtn}
                      onPress={() => {
                        const num = c.numero.replace(/\s+/g, '').replace(/[^\d+]/g, '')
                        Linking.openURL(`https://wa.me/${num}`).catch(() =>
                          Alert.alert('Erreur', 'Impossible d\'ouvrir WhatsApp.')
                        )
                      }}
                    >
                      <Text style={styles.waBtnTxt}>WA</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                )
              })
            )}
            <View style={{ height: 120 }} />
          </ScrollView>

          {/* Barre d'action fixe en bas */}
          {nbSelectionnes > 0 && (
            <View style={styles.actionBar}>
              <Text style={styles.actionCount}>{nbSelectionnes} contact{nbSelectionnes > 1 ? 's' : ''}</Text>
              <View style={styles.actionBtns}>
                <TouchableOpacity style={styles.smsBtn} onPress={() => ouvrirComposeur('sms')}>
                  <Text style={styles.smsBtnTxt}>💬 SMS</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.waActionBtn} onPress={() => ouvrirComposeur('whatsapp')}>
                  <Text style={styles.waActionBtnTxt}>WhatsApp</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      {/* Modal composer message */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.modal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>
                    {typeEnvoi === 'sms' ? '💬 Envoyer SMS' : 'WhatsApp'}
                  </Text>
                  <Text style={styles.modalSub}>
                    {numerosSelectionnes.length} destinataire{numerosSelectionnes.length > 1 ? 's' : ''} — {restoSelectionne?.nom}
                  </Text>
                </View>

                <Text style={styles.modalLabel}>Votre message</Text>
                <TextInput
                  style={styles.messageInput}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Bonjour, nous avons une offre spéciale pour vous..."
                  placeholderTextColor="#bbb"
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  autoFocus
                />
                <Text style={styles.charCount}>{message.length} caractère{message.length > 1 ? 's' : ''}</Text>

                {/* Aperçu destinataires */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.destRow}>
                  {numerosSelectionnes.slice(0, 8).map((num, i) => (
                    <View key={i} style={styles.destBadge}>
                      <Text style={styles.destNum} numberOfLines={1}>{num}</Text>
                    </View>
                  ))}
                  {numerosSelectionnes.length > 8 && (
                    <View style={styles.destBadge}>
                      <Text style={styles.destNum}>+{numerosSelectionnes.length - 8}</Text>
                    </View>
                  )}
                </ScrollView>

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => { setModalVisible(false); setMessage('') }}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, typeEnvoi === 'whatsapp' && styles.modalConfirmWA]}
                    onPress={typeEnvoi === 'sms' ? envoyerSMS : () => {
                      if (!message.trim()) { Alert.alert('Message vide', 'Écrivez votre message.'); return }
                      // WhatsApp : ouvre un par un
                      Alert.alert(
                        'WhatsApp',
                        `WhatsApp sera ouvert ${numerosSelectionnes.length} fois (un par contact). Continuer ?`,
                        [
                          { text: 'Annuler', style: 'cancel' },
                          {
                            text: 'Continuer', onPress: () => {
                              numerosSelectionnes.forEach((num, i) => {
                                setTimeout(() => envoyerWhatsApp(num), i * 1500)
                              })
                            }
                          }
                        ]
                      )
                    }}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {typeEnvoi === 'sms' ? '💬 Envoyer SMS' : '📲 Envoyer WhatsApp'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
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
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff' },
  restoBar: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  restoTxt: { fontSize: 12, color: '#888' },
  restoTxtActive: { color: '#534AB7', fontWeight: '600' },
  ongletBar: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  ongletBtn: { paddingHorizontal: 18, paddingVertical: 12 },
  ongletBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  ongletTxt: { fontSize: 13, color: '#888' },
  ongletTxtActive: { color: '#534AB7', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  selectBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#EEEDFE', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#CECBF6'
  },
  selectInfo: { fontSize: 12, color: '#534AB7', fontWeight: '500' },
  selectBtns: { flexDirection: 'row', gap: 8 },
  selectBtn: { backgroundColor: '#534AB7', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  selectBtnTxt: { fontSize: 11, color: '#fff', fontWeight: '500' },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6, textAlign: 'center', paddingHorizontal: 20 },
  contactCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 0.5, borderColor: '#eee'
  },
  contactCardSelected: { borderColor: '#534AB7', backgroundColor: '#F5F4FE' },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    borderColor: '#ccc', alignItems: 'center', justifyContent: 'center'
  },
  checkboxSelected: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  checkmark: { fontSize: 13, color: '#fff', fontWeight: '700' },
  contactAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  contactAvatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  contactInfo: { flex: 1 },
  contactNom: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  contactDetail: { fontSize: 11, color: '#888', marginTop: 1 },
  contactNum: { fontSize: 12, color: '#534AB7', marginTop: 2 },
  waBtn: { backgroundColor: '#25D366', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  waBtnTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', padding: 16, paddingBottom: 28,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: '#eee',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 8,
  },
  actionCount: { fontSize: 13, fontWeight: '600', color: '#534AB7' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  smsBtn: { backgroundColor: '#534AB7', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  smsBtnTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  waActionBtn: { backgroundColor: '#25D366', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  waActionBtnTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { marginBottom: 20 },
  modalTitre: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  modalSub: { fontSize: 12, color: '#888', marginTop: 4 },
  modalLabel: { fontSize: 11, fontWeight: '600', color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  messageInput: {
    backgroundColor: '#f5f5f5', borderRadius: 14, padding: 14,
    fontSize: 14, color: '#1a1a1a', minHeight: 110, marginBottom: 6
  },
  charCount: { fontSize: 10, color: '#bbb', textAlign: 'right', marginBottom: 12 },
  destRow: { maxHeight: 36, marginBottom: 16 },
  destBadge: { backgroundColor: '#EEEDFE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginRight: 6 },
  destNum: { fontSize: 11, color: '#534AB7', fontWeight: '500', maxWidth: 100 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#534AB7', alignItems: 'center' },
  modalConfirmWA: { backgroundColor: '#25D366' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
})
