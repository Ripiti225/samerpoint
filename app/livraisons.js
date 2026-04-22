import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
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
import { saveCommandes } from '../lib/api'

export default function LivraisonsScreen() {
  const partenaires = ['Yango', 'Glovo', 'OM', 'Wave', 'Djamo', 'Client']
  const [partenaire, setPartenaire] = useState('Yango')
  const [commandes, setCommandes] = useState({ Yango: [], Glovo: [], OM: [], Wave: [], Djamo: [], Client: [] })
  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState({ numero: '', contact: '', plat: '' })
  const { livraisonsJour, setLivraisonsJour, pointId } = useApp()

  useEffect(() => {
    if (livraisonsJour && Object.values(livraisonsJour).some(arr => arr.length > 0)) {
      setCommandes(livraisonsJour)
    }
  }, [])

  function appeler(numero) {
    if (!numero) return
    Linking.openURL(`tel:${numero.replace(/\s/g, '')}`)
  }

  function ajouterCommande() {
    if (!form.numero && !form.contact && !form.plat) {
      Alert.alert('Attention', 'Remplissez au moins un champ')
      return
    }
    setCommandes(prev => ({
      ...prev,
      [partenaire]: [...(prev[partenaire] || []), { ...form, id: Date.now() }]
    }))
    setForm({ numero: '', contact: '', plat: '' })
    setModalVisible(false)
  }

  function supprimerCommande(id) {
    Alert.alert('Supprimer', 'Supprimer cette commande ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => {
        setCommandes(prev => ({ ...prev, [partenaire]: prev[partenaire].filter(c => c.id !== id) }))
      }}
    ])
  }

  function totalCommandes() {
    return Object.values(commandes).reduce((sum, arr) => sum + arr.length, 0)
  }

  async function enregistrer() {
    Alert.alert('Confirmer', `Enregistrer ${totalCommandes()} commandes ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', onPress: async () => {
        setLivraisonsJour(commandes)
        if (pointId) await saveCommandes(pointId, commandes)
        Alert.alert('Succès', 'Livraisons enregistrées !')
        if (router.canGoBack()) router.back()
        else router.replace('/accueil')
      }}
    ])
  }

  const commandesPartenaire = commandes[partenaire] || []

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          setLivraisonsJour(commandes)
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Livraisons</Text>
          <Text style={styles.headerSub}>Samer Angré 7E</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeText}>{totalCommandes()} cdes</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {partenaires.map(p => (
          <TouchableOpacity key={p} style={[styles.tab, partenaire === p && styles.tabActive]} onPress={() => setPartenaire(p)}>
            <Text style={[styles.tabText, partenaire === p && styles.tabTextActive]}>{p}</Text>
            {(commandes[p] || []).length > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{(commandes[p] || []).length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {commandesPartenaire.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune commande {partenaire} pour ce shift</Text>
            <Text style={styles.emptySub}>Appuyez sur + pour ajouter une commande</Text>
          </View>
        ) : (
          commandesPartenaire.map((cmd, i) => (
            <View key={cmd.id} style={styles.cmdCard}>
              <View style={styles.cmdLeft}>
                <View style={styles.cmdNum}>
                  <Text style={styles.cmdNumText}>#{i + 1}</Text>
                </View>
                <View style={styles.cmdInfo}>
                  {cmd.numero ? <Text style={styles.cmdNumCde}>Cde n° {cmd.numero}</Text> : null}
                  {cmd.contact ? (
                    <TouchableOpacity style={styles.cmdContactRow} onPress={() => appeler(cmd.contact)}>
                      <Text style={styles.cmdContact}>{cmd.contact}</Text>
                      <View style={styles.callBtn}><Text style={styles.callBtnTxt}>📞</Text></View>
                    </TouchableOpacity>
                  ) : null}
                  {cmd.plat ? <Text style={styles.cmdPlat}>🍽 {cmd.plat}</Text> : null}
                </View>
              </View>
              <TouchableOpacity onLongPress={() => supprimerCommande(cmd.id)} style={styles.cmdBadge}>
                <Text style={styles.cmdBadgeTxt}>{partenaire}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={styles.recapCard}>
          <Text style={styles.recapTitre}>Récapitulatif du shift</Text>
          {partenaires.map(p => (
            <View key={p} style={styles.recapRow}>
              <Text style={styles.recapLabel}>{p}</Text>
              <Text style={[styles.recapValue, (commandes[p] || []).length > 0 && styles.recapValueActive]}>
                {(commandes[p] || []).length} commande(s)
              </Text>
            </View>
          ))}
          <View style={styles.recapTotal}>
            <Text style={styles.recapTotalLabel}>Total</Text>
            <Text style={styles.recapTotalValue}>{totalCommandes()} commandes</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={enregistrer}>
          <Text style={styles.saveTxt}>Enregistrer les livraisons</Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabTxt}>+</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
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
              <Text style={styles.modalTitre}>Nouvelle commande {partenaire}</Text>
              <Text style={styles.modalLabel}>Numéro de commande</Text>
              <TextInput style={styles.modalInput} placeholder="Ex: 1098" value={form.numero} onChangeText={v => setForm(p => ({ ...p, numero: v }))} keyboardType="numeric" placeholderTextColor="#bbb" />
              <Text style={styles.modalLabel}>Contact client</Text>
              <View style={styles.contactRow}>
                <TextInput style={[styles.modalInput, { flex: 1, marginBottom: 0 }]} placeholder="Ex: +225 07 12 34 56" value={form.contact} onChangeText={v => setForm(p => ({ ...p, contact: v }))} keyboardType="phone-pad" placeholderTextColor="#bbb" />
                {form.contact ? (
                  <TouchableOpacity style={styles.callBtnModal} onPress={() => appeler(form.contact)}>
                    <Text style={styles.callBtnModalTxt}>📞</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={[styles.modalLabel, { marginTop: 14 }]}>Plat commandé</Text>
              <TextInput style={styles.modalInput} placeholder="Ex: Chawarma poulet" value={form.plat} onChangeText={v => setForm(p => ({ ...p, plat: v }))} placeholderTextColor="#bbb" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
              <View style={[styles.modalBtns, { paddingBottom: 20 }]}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => { setForm({ numero: '', contact: '', plat: '' }); setModalVisible(false) }}>
                  <Text style={styles.modalCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} onPress={ajouterCommande}>
                  <Text style={styles.modalConfirmText}>Ajouter</Text>
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
  header: { backgroundColor: '#EF9F27', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  totalBadge: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  totalBadgeText: { fontSize: 11, color: '#FAEEDA', fontWeight: '500' },
  tabs: { backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee', maxHeight: 46 },
  tab: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  tabText: { fontSize: 13, color: '#888' },
  tabTextActive: { color: '#EF9F27', fontWeight: '600' },
  tabBadge: { backgroundColor: '#FAEEDA', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  tabBadgeText: { fontSize: 10, color: '#BA7517', fontWeight: '600' },
  body: { flex: 1, padding: 16 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6 },
  cmdCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#eee' },
  cmdLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  cmdNum: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FAEEDA', alignItems: 'center', justifyContent: 'center' },
  cmdNumText: { fontSize: 13, fontWeight: '600', color: '#BA7517' },
  cmdInfo: { flex: 1 },
  cmdNumCde: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 3 },
  cmdContactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  cmdContact: { fontSize: 12, color: '#888' },
  callBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EAF3DE', alignItems: 'center', justifyContent: 'center' },
  callBtnTxt: { fontSize: 14 },
  cmdPlat: { fontSize: 12, color: '#555' },
  cmdBadge: { backgroundColor: '#FAEEDA', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  cmdBadgeTxt: { fontSize: 10, color: '#BA7517', fontWeight: '500' },
  recapCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 0.5, borderColor: '#eee' },
  recapTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 10 },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  recapLabel: { fontSize: 13, color: '#888' },
  recapValue: { fontSize: 13, color: '#ccc' },
  recapValueActive: { color: '#1a1a1a', fontWeight: '500' },
  recapTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 },
  recapTotalLabel: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  recapTotalValue: { fontSize: 16, fontWeight: '600', color: '#EF9F27' },
  saveBtn: { backgroundColor: '#EF9F27', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 80 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
  fab: { position: 'absolute', bottom: 30, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  fabTxt: { fontSize: 28, color: '#412402', fontWeight: '300', lineHeight: 32 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 20 },
  modalLabel: { fontSize: 12, fontWeight: '600', color: '#888', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  modalInput: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 14 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 0 },
  callBtnModal: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EAF3DE', alignItems: 'center', justifyContent: 'center' },
  callBtnModalTxt: { fontSize: 22 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelText: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#EF9F27', alignItems: 'center' },
  modalConfirmText: { fontSize: 14, fontWeight: '600', color: '#412402' },
})