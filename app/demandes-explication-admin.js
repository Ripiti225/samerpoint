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
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifExplicationStatut } from '../lib/notifications'
import { genererPdfExplication } from '../lib/pdfDocuments'
import { supabase } from '../lib/supabase'
import { STATUT_EXPLICATION, fmtDateHeure } from './demandes-explication'

const TROIS_JOURS = 3 * 24 * 60 * 60 * 1000

function enRetard(d) {
  return d.statut === 'envoyee' && d.envoyee_at && (Date.now() - new Date(d.envoyee_at).getTime() > TROIS_JOURS)
}

export default function DemandesExplicationAdminScreen() {
  const { userId, userNom, roleActif } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [onglet, setOnglet] = useState('recues') // 'recues' | 'miennes'
  const [demandes, setDemandes] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  // Modals action
  const [demandeEnCours, setDemandeEnCours] = useState(null)
  const [showRefus, setShowRefus] = useState(false)
  const [motifRefus, setMotifRefus] = useState('')
  const [showReponse, setShowReponse] = useState(false)
  const [noteReponse, setNoteReponse] = useState('')

  // Modal création (mes demandes)
  const [showCreer, setShowCreer] = useState(false)
  const [creerResto, setCreerResto] = useState(null)
  const [travailleurs, setTravailleurs] = useState([])
  const [formTrav, setFormTrav] = useState(null)
  const [formMotif, setFormMotif] = useState('')
  const [formDesc, setFormDesc] = useState('')

  useEffect(() => { chargerRestaurants() }, [])
  useEffect(() => { charger() }, [onglet, restoFilter])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom').order('nom')
    setRestaurants(data || [])
  }

  async function charger() {
    setLoading(true)
    let q = supabase.from('demandes_explication').select('*').order('created_at', { ascending: false })
    // « Reçues » = demandes à examiner, émises par un rôle non-admin : le gérant,
    // et le vérificateur (demande automatique quand ≥ 40 % des produits comptés
    // sont en écart). Sans 'verificateur' ici, ces demandes n'apparaissaient
    // dans aucun des deux onglets.
    if (onglet === 'recues') q = q.in('cree_par_role', ['gerant', 'verificateur'])
    else q = q.eq('cree_par_id', userId)
    if (restoFilter) q = q.eq('restaurant_id', restoFilter)
    const { data } = await q
    setDemandes(data || [])
    setLoading(false)
  }

  // ── Acceptation ──
  async function accepter(d) {
    if (saving) return
    setSaving(true)
    const now = new Date().toISOString()
    await supabase.from('demandes_explication').update({
      statut: 'acceptee', accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now,
    }).eq('id', d.id)
    notifierGerant(d, 'acceptee')
    journaliser({ action: 'explication_acceptee', details: `${d.travailleur_nom}`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  function ouvrirRefus(d) { setDemandeEnCours(d); setMotifRefus(''); setShowRefus(true) }
  async function confirmerRefus() {
    if (!motifRefus.trim()) return Alert.alert('Erreur', 'Le motif du refus est obligatoire')
    setSaving(true)
    await supabase.from('demandes_explication').update({
      statut: 'refusee', refus_motif: motifRefus.trim(), refuse_par_nom: userNom, refuse_at: new Date().toISOString(),
    }).eq('id', demandeEnCours.id)
    notifierGerant(demandeEnCours, 'refusee')
    journaliser({ action: 'explication_refusee', details: `${demandeEnCours.travailleur_nom} — ${motifRefus.trim()}`, userId, restaurantId: demandeEnCours.restaurant_id }).catch(() => {})
    setSaving(false); setShowRefus(false); setDemandeEnCours(null); charger()
  }

  // ── Marquer envoyée ──
  async function marquerEnvoyee(d) {
    if (saving) return
    setSaving(true)
    await supabase.from('demandes_explication').update({
      statut: 'envoyee', envoyee_par_id: userId, envoyee_par_nom: userNom, envoyee_at: new Date().toISOString(),
    }).eq('id', d.id)
    journaliser({ action: 'explication_envoyee', details: `${d.travailleur_nom}`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  // ── Réponse récupérée ──
  function ouvrirReponse(d) { setDemandeEnCours(d); setNoteReponse(''); setShowReponse(true) }
  async function confirmerReponse() {
    setSaving(true)
    await supabase.from('demandes_explication').update({
      statut: 'reponse_recuperee', reponse_recuperee_par: userNom,
      reponse_recuperee_at: new Date().toISOString(), reponse_note: noteReponse.trim() || null,
    }).eq('id', demandeEnCours.id)
    journaliser({ action: 'explication_reponse', details: `${demandeEnCours.travailleur_nom}`, userId, restaurantId: demandeEnCours.restaurant_id }).catch(() => {})
    setSaving(false); setShowReponse(false); setDemandeEnCours(null); charger()
  }

  // ── Relancer (2e demande) ──
  function confirmerRelance(d) {
    Alert.alert(
      'Relancer ?',
      `Aucune réponse de ${d.travailleur_nom}. Une 2ᵉ demande d'explication sera créée et marquée envoyée.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Relancer', style: 'destructive', onPress: () => relancer(d) },
      ],
    )
  }
  async function relancer(d) {
    if (saving) return
    setSaving(true)
    const now = new Date().toISOString()
    // L'originale devient terminale
    await supabase.from('demandes_explication').update({ statut: 'relancee' }).eq('id', d.id)
    // 2e demande, directement envoyée
    await supabase.from('demandes_explication').insert({
      restaurant_id: d.restaurant_id,
      travailleur_id: d.travailleur_id,
      travailleur_nom: d.travailleur_nom,
      travailleur_poste: d.travailleur_poste,
      motif: d.motif,
      description: d.description,
      statut: 'envoyee',
      numero: (d.numero || 1) + 1,
      relance_de: d.id,
      cree_par_id: d.cree_par_id,
      cree_par_nom: d.cree_par_nom,
      cree_par_role: d.cree_par_role,
      accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now,
      envoyee_par_id: userId, envoyee_par_nom: userNom, envoyee_at: now,
    })
    creerNotification({
      type: 'explication_relance',
      titre: 'Relance explication',
      message: `🔁 2ᵉ demande envoyée à ${d.travailleur_nom}`,
      restaurant_id: d.restaurant_id,
      cible_role: ['directeur', 'rh', 'manager'],
      cible_user_id: d.cree_par_id,
      created_by: userId,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    journaliser({ action: 'explication_relance', details: `${d.travailleur_nom} (2e demande)`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  function notifierGerant(d, statut) {
    creerNotification({
      type: statut === 'refusee' ? 'explication_refusee' : 'explication_acceptee',
      titre: statut === 'refusee' ? 'Explication refusée' : 'Explication acceptée',
      message: `${statut === 'refusee' ? '❌' : '✅'} ${d.travailleur_nom} — par ${userNom}`,
      restaurant_id: d.restaurant_id,
      cible_user_id: d.cree_par_id,
      created_by: userId,
      screen: 'demandes-explication',
    }).catch(() => {})
    envoyerNotifExplicationStatut(d.travailleur_nom, statut, d.cree_par_id).catch(() => {})
  }

  function voirFichier(url) {
    if (!url) return
    if (Platform.OS === 'web') window.open(url, '_blank')
    else Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir le fichier"))
  }

  async function imprimerPdf(d) {
    const restoNom = restaurants.find(r => r.id === d.restaurant_id)?.nom || ''
    try {
      await genererPdfExplication({
        travailleurNom: d.travailleur_nom, poste: d.travailleur_poste, restaurantNom: restoNom,
        motif: d.motif, description: d.description, date: d.envoyee_at || d.created_at,
      })
    } catch (_e) { Alert.alert('Erreur', 'Impossible de générer le PDF') }
  }

  // ── Création (mes demandes) : auto-acceptée ──
  async function ouvrirCreer() {
    setCreerResto(null); setTravailleurs([]); setFormTrav(null); setFormMotif(''); setFormDesc('')
    setShowCreer(true)
  }
  async function choisirRestoCreer(r) {
    setCreerResto(r); setFormTrav(null)
    const { data } = await supabase.from('travailleurs').select('id, nom, poste').eq('restaurant_id', r.id).eq('actif', true).order('nom')
    setTravailleurs(data || [])
  }
  async function soumettreCreation() {
    if (!creerResto) return Alert.alert('Erreur', 'Sélectionnez un restaurant')
    if (!formTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (!formMotif.trim()) return Alert.alert('Erreur', 'Précisez le motif')
    setSaving(true)
    const now = new Date().toISOString()
    const { error } = await supabase.from('demandes_explication').insert({
      restaurant_id: creerResto.id,
      travailleur_id: formTrav.id,
      travailleur_nom: formTrav.nom,
      travailleur_poste: formTrav.poste || null,
      motif: formMotif.trim(),
      description: formDesc.trim() || null,
      statut: 'acceptee', // auto-accepté (saute l'étape acceptation)
      numero: 1,
      cree_par_id: userId, cree_par_nom: userNom, cree_par_role: roleActif,
      accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now,
    })
    if (error) { setSaving(false); return Alert.alert('Erreur', error.message) }
    journaliser({ action: 'explication_creee_admin', details: `${formTrav.nom} — ${formMotif.trim()}`, userId, restaurantId: creerResto.id }).catch(() => {})
    setSaving(false); setShowCreer(false); setOnglet('miennes'); charger()
  }

  const restoNomFiltre = restoFilter ? restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant' : 'Tous les restaurants'

  function renderActions(d) {
    if (onglet === 'recues' && d.statut === 'en_attente_acceptation') {
      return (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnValider} onPress={() => accepter(d)} disabled={saving}>
            <Text style={styles.btnValiderTxt}>✅ Accepter</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnDecliner} onPress={() => ouvrirRefus(d)} disabled={saving}>
            <Text style={styles.btnDeclinerTxt}>❌ Refuser</Text>
          </TouchableOpacity>
        </View>
      )
    }
    if (d.statut === 'acceptee') {
      return (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => marquerEnvoyee(d)} disabled={saving}>
            <Text style={styles.btnPrimaryTxt}>📤 Marquer envoyée</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={() => imprimerPdf(d)}>
            <Text style={styles.btnGhostTxt}>📄 PDF</Text>
          </TouchableOpacity>
        </View>
      )
    }
    if (d.statut === 'envoyee') {
      return (
        <>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnValider} onPress={() => ouvrirReponse(d)} disabled={saving}>
              <Text style={styles.btnValiderTxt}>✅ Réponse récupérée</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnRelance} onPress={() => confirmerRelance(d)} disabled={saving}>
              <Text style={styles.btnRelanceTxt}>🔁 Relancer</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.pdfBtn} onPress={() => imprimerPdf(d)}>
            <Text style={styles.pdfBtnTxt}>📄 Imprimer le PDF</Text>
          </TouchableOpacity>
        </>
      )
    }
    if (['relancee', 'reponse_recuperee'].includes(d.statut)) {
      return (
        <TouchableOpacity style={styles.pdfBtn} onPress={() => imprimerPdf(d)}>
          <Text style={styles.pdfBtnTxt}>📄 Imprimer le PDF</Text>
        </TouchableOpacity>
      )
    }
    return null
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Explications</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Onglets */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, onglet === 'recues' && styles.tabActive]} onPress={() => setOnglet('recues')}>
          <Text style={[styles.tabTxt, onglet === 'recues' && styles.tabTxtActive]}>📥 Reçues</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, onglet === 'miennes' && styles.tabActive]} onPress={() => setOnglet('miennes')}>
          <Text style={[styles.tabTxt, onglet === 'miennes' && styles.tabTxtActive]}>📨 Mes demandes</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filtersRow}>
        <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoBtnTxt}>🏪 {restoNomFiltre} ▾</Text>
        </TouchableOpacity>
        {onglet === 'miennes' && (
          <TouchableOpacity style={styles.addBtnSmall} onPress={ouvrirCreer}>
            <Text style={styles.addBtnSmallTxt}>+ Nouvelle</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#534AB7" /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {demandes.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📨</Text>
              <Text style={styles.emptyTxt}>Aucune demande</Text>
            </View>
          ) : (
            demandes.map(d => {
              const cfg = STATUT_EXPLICATION[d.statut] || STATUT_EXPLICATION.en_attente_acceptation
              const restoNomCarte = restaurants.find(r => r.id === d.restaurant_id)?.nom || ''
              const retard = enRetard(d)
              return (
                <View key={d.id} style={[styles.card, retard && styles.cardRetard]}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTrav}>📨 {d.travailleur_nom}{d.travailleur_poste ? ` · ${d.travailleur_poste}` : ''}{d.numero > 1 ? `  (relance ${d.numero})` : ''}</Text>
                    <View style={[styles.statutBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statutTxt, { color: cfg.text }]}>{cfg.label}</Text>
                    </View>
                  </View>
                  {retard && <Text style={styles.retardTxt}>⏰ En retard — plus de 3 jours sans réponse</Text>}
                  {restoNomCarte ? <Text style={styles.cardResto}>🏪 {restoNomCarte}</Text> : null}
                  <Text style={styles.cardMotif}>{d.motif}</Text>
                  {d.description ? <Text style={styles.cardDesc}>{`« ${d.description} »`}</Text> : null}
                  {d.cree_par_nom ? <Text style={styles.cardMeta}>👤 Demandé par {d.cree_par_nom}</Text> : null}
                  {d.envoyee_at && <Text style={styles.cardMeta}>📤 Envoyée le {fmtDateHeure(d.envoyee_at)}</Text>}
                  {d.statut === 'reponse_recuperee' && (
                    <Text style={styles.cardMeta}>✅ Réponse récupérée le {fmtDateHeure(d.reponse_recuperee_at)}{d.reponse_note ? ` — ${d.reponse_note}` : ''}</Text>
                  )}
                  {d.statut === 'refusee' && (
                    <View style={styles.declineBox}>
                      <Text style={styles.declineTitre}>Motif du refus :</Text>
                      <Text style={styles.declineTxt}>{d.refus_motif}</Text>
                    </View>
                  )}
                  {d.reponse_fichier_url && (
                    <TouchableOpacity style={styles.reponseVoir} onPress={() => voirFichier(d.reponse_fichier_url)}>
                      <Text style={styles.reponseVoirTxt}>
                        {d.reponse_fichier_type === 'pdf' ? '📄' : '🖼️'} Réponse déposée par le gérant — voir
                      </Text>
                    </TouchableOpacity>
                  )}
                  {renderActions(d)}
                </View>
              )
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Picker restaurant (filtre) */}
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

      {/* Modal refus */}
      <Modal visible={showRefus} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <View style={styles.actionModal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>Motif du refus</Text>
                  <TouchableOpacity onPress={() => { setShowRefus(false); setMotifRefus('') }}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Expliquez le motif du refus (obligatoire)..."
                  placeholderTextColor={colors.textMuted}
                  multiline value={motifRefus} onChangeText={setMotifRefus} autoFocus
                />
                <TouchableOpacity style={[styles.btnDangerConfirm, (!motifRefus.trim() || saving) && { opacity: 0.5 }]} onPress={confirmerRefus} disabled={!motifRefus.trim() || saving}>
                  <Text style={styles.btnDangerConfirmTxt}>{saving ? 'Envoi...' : '❌ Confirmer le refus'}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Modal réponse récupérée */}
      <Modal visible={showReponse} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <View style={styles.actionModal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>Réponse récupérée</Text>
                  <TouchableOpacity onPress={() => { setShowReponse(false); setNoteReponse('') }}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Note sur la réponse reçue (optionnel)..."
                  placeholderTextColor={colors.textMuted}
                  multiline value={noteReponse} onChangeText={setNoteReponse}
                />
                <TouchableOpacity style={[styles.btnOkConfirm, saving && { opacity: 0.5 }]} onPress={confirmerReponse} disabled={saving}>
                  <Text style={styles.btnOkConfirmTxt}>{saving ? '...' : '✅ Confirmer'}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Modal création (mes demandes) */}
      <Modal visible={showCreer} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <View style={styles.creerModal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>{"Nouvelle demande d'explication"}</Text>
                  <TouchableOpacity onPress={() => setShowCreer(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={styles.label}>Restaurant</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {restaurants.map(r => (
                      <TouchableOpacity key={r.id} style={[styles.travChip, creerResto?.id === r.id && styles.travChipActive]} onPress={() => choisirRestoCreer(r)}>
                        <Text style={[styles.travChipTxt, creerResto?.id === r.id && styles.travChipTxtActive]}>{r.nom}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {creerResto && (
                    <>
                      <Text style={styles.label}>Travailleur</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                        {travailleurs.length === 0 ? (
                          <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>Aucun travailleur actif</Text>
                        ) : travailleurs.map(t => (
                          <TouchableOpacity key={t.id} style={[styles.travChip, formTrav?.id === t.id && styles.travChipActive]} onPress={() => setFormTrav(t)}>
                            <Text style={[styles.travChipTxt, formTrav?.id === t.id && styles.travChipTxtActive]}>{t.nom}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Text style={styles.label}>Motif</Text>
                  <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="Ex : Retard répété…" placeholderTextColor={colors.textMuted} value={formMotif} onChangeText={setFormMotif} />

                  <Text style={styles.label}>Détails (optionnel)</Text>
                  <TextInput style={[styles.textArea, { color: colors.text, borderColor: colors.border }]} placeholder="Précisez les faits…" placeholderTextColor={colors.textMuted} multiline value={formDesc} onChangeText={setFormDesc} />

                  <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={soumettreCreation} disabled={saving}>
                    <Text style={styles.submitBtnTxt}>{saving ? 'Envoi...' : '📤 Créer (acceptée automatiquement)'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>Vos demandes sont acceptées automatiquement — il reste à les marquer « envoyée ».</Text>
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

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    back: { fontSize: 16, color: '#534AB7', fontWeight: '500' },
    headerTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
    tab: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tabActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    tabTxt: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    tabTxtActive: { color: '#fff' },
    filtersRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, gap: 8 },
    restoBtn: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
    restoBtnTxt: { fontSize: 14, color: colors.text, fontWeight: '500' },
    addBtnSmall: { backgroundColor: '#534AB7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
    addBtnSmallTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    emptyBox: { alignItems: 'center', paddingTop: 60 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { color: colors.textMuted, fontSize: 15 },
    card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
    cardRetard: { borderWidth: 1.5, borderColor: '#EF9F27' },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
    cardTrav: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
    statutBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    statutTxt: { fontSize: 11, fontWeight: '600' },
    retardTxt: { fontSize: 12, color: '#9A5B0B', fontWeight: '700', marginBottom: 4 },
    cardResto: { fontSize: 13, color: colors.textMuted, marginBottom: 2 },
    cardMotif: { fontSize: 14, color: colors.text, marginBottom: 4, marginTop: 2 },
    cardDesc: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
    cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
    declineBox: { backgroundColor: '#FAECE7', borderRadius: 8, padding: 10, marginTop: 8 },
    declineTitre: { fontSize: 12, fontWeight: '700', color: '#993C1D', marginBottom: 2 },
    declineTxt: { fontSize: 13, color: '#993C1D' },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    btnValider: { flex: 1, backgroundColor: '#EAF3DE', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnValiderTxt: { color: '#3B6D11', fontWeight: '700', fontSize: 13 },
    btnDecliner: { flex: 1, backgroundColor: '#FAECE7', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnDeclinerTxt: { color: '#993C1D', fontWeight: '700', fontSize: 13 },
    btnPrimary: { flex: 1, backgroundColor: '#534AB7', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnPrimaryTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    btnGhost: { backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    btnGhostTxt: { color: '#534AB7', fontWeight: '700', fontSize: 13 },
    btnRelance: { flex: 1, backgroundColor: '#FBEEDD', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    btnRelanceTxt: { color: '#9A5B0B', fontWeight: '700', fontSize: 13 },
    pdfBtn: { marginTop: 10, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    pdfBtnTxt: { color: '#534AB7', fontWeight: '700', fontSize: 13 },
    reponseVoir: { marginTop: 10, backgroundColor: '#E0F9EE', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#A8E8CC' },
    reponseVoirTxt: { color: '#157548', fontWeight: '700', fontSize: 13 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    pickerModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
    pickerTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
    pickerItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    pickerItemTxt: { fontSize: 15, color: colors.text },
    actionModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
    creerModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '92%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    modalTitre: { fontSize: 18, fontWeight: '700', color: colors.text, flex: 1 },
    modalClose: { fontSize: 20, color: colors.textMuted, padding: 4 },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    travChip: { backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
    travChipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    travChipTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    travChipTxtActive: { color: '#fff' },
    input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16, backgroundColor: colors.background },
    textArea: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 90, textAlignVertical: 'top', marginBottom: 16, backgroundColor: colors.background },
    submitBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    submitBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    hint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
    btnDangerConfirm: { backgroundColor: '#993C1D', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    btnDangerConfirmTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    btnOkConfirm: { backgroundColor: '#3B6D11', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    btnOkConfirmTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  })
}
