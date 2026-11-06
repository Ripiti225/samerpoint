// Fenêtres de l'écran Équipe globale : formulaire travailleur, archivage,
// transfert, choix d'une période.
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import {
  Alert, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native'
import ChampDate, { CalendrierPeriode } from '../ChampDate'
import { aujourdhuiISO } from '../../lib/contrats'
import { BLEU, MOTIFS_ARCHIVE, formatDate } from '../../lib/equipe'
import { champsIdentite, enregistrerTravailleur } from '../../lib/equipeDb'
import { JOURS_COURTS, nomJour } from '../../lib/joursRepos'
import { nomSuivi } from '../../lib/miseAJourFiches'
import { CIVILITES, SITUATIONS_FAMILLE } from '../../lib/recrutement'
import { uploaderFichier } from '../../lib/uploadFichier'
import { usePhoto } from '../../lib/usePhoto'
import FormulaireTravailleur from '../FormulaireTravailleur'

const TYPES_PAPIERS = ['CNI', 'Passeport', 'Permis de conduire', 'Autre']

// État civil et pièce d'identité : les mêmes champs que le formulaire complet
// d'ajout (FormulaireDemande), modifiables ici ; ils alimentent la Carte PDF.
const CHAMPS_IDENTITE = [
  'civilite', 'nom_famille', 'prenoms', 'date_naissance', 'lieu_naissance', 'nationalite',
  'situation_famille', 'cni_numero', 'nni_numero', 'lieu_residence',
]
const identiteDepuis = t => Object.fromEntries(CHAMPS_IDENTITE.map(c => [c, t?.[c] || '']))

function formVide() {
  return {
    nom: '', poste: '', type_contrat: 'CDD', contact: '', salaire_journalier: '', date_embauche: aujourdhuiISO(), photo_url: null,
    jour_repos_choix: 'auto', ...identiteDepuis(null),
  }
}

function formDepuis(t) {
  return {
    ...identiteDepuis(t),
    nom: t.nom, poste: t.poste || '', type_contrat: t.type_contrat || 'CDD', contact: t.contact || '',
    salaire_journalier: t.salaire_journalier?.toString() || '', date_embauche: t.date_embauche || '', photo_url: t.photo_url || null,
    // 'auto' = l'analyse décide ; 1…7 ou 'aucun' = fixé à la main (lib/equipeDb.js).
    jour_repos_choix: t.jour_repos_source === 'manuel' ? (t.jour_repos || 'aucun') : 'auto',
  }
}

// Sur iOS, toucher hors d'un champ ferme le clavier ; sur le web, ce wrapper
// avalerait les clics, on ne le met pas.
// Le plafond « 92 % de l'écran » est porté par l'enveloppe, dont la hauteur
// est connue. Posé sur la feuille elle-même, il valait 92 % d'un parent sans
// hauteur, donc rien : un long formulaire poussait son haut hors de l'écran,
// impossible à atteindre (constaté le 14/10/2026 sur l'ajout d'un travailleur).
function FondModal({ styles, children }) {
  const contenu = (
    <View style={styles.modalOverlay}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.enveloppeModal}>{children}</KeyboardAvoidingView>
    </View>
  )
  return Platform.OS === 'web' ? contenu : <TouchableWithoutFeedback onPress={Keyboard.dismiss}>{contenu}</TouchableWithoutFeedback>
}

function EnTete({ styles, titre, onFermer }) {
  return (
    <View style={styles.modalHeader}>
      <Text style={styles.modalTitre}>{titre}</Text>
      <TouchableOpacity onPress={onFermer}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
    </View>
  )
}

// ── Ajout / modification ──────────────────────────────────────────────────────
export function ModalFormTravailleur({ visible, edition, restaurants, restoParDefaut, styles, colors, ctx, onFermer, onEnregistre }) {
  const { choisirPhoto } = usePhoto()
  const [form, setForm] = useState(formVide())
  const [restoId, setRestoId] = useState(null)
  const [papiers, setPapiers] = useState([])
  const [uploadPapier, setUploadPapier] = useState(false)
  const [uploadPhoto, setUploadPhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setForm(edition ? formDepuis(edition) : formVide())
    setRestoId(edition ? edition.restaurant_id : restoParDefaut)
    setPapiers([])
  }, [visible, edition, restoParDefaut])

  const resto = restaurants.find(r => r.id === restoId) || null
  const peutEnregistrer = form.nom.trim() && form.poste.trim() && (edition || resto)
  const nouveauNom = edition ? nomSuivi(edition, champsIdentite(form)) : null

  async function photoProfil() {
    setUploadPhoto(true)
    const url = await choisirPhoto('photos')
    if (url) setForm(p => ({ ...p, photo_url: url }))
    setUploadPhoto(false)
  }

  async function ajouterPapier(typeDoc, estPDF) {
    let uri
    if (estPDF) {
      const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' })
      if (r.canceled) return
      uri = r.assets[0].uri
    } else {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })
      if (r.canceled) return
      uri = r.assets[0].uri
    }
    setUploadPapier(true)
    try {
      const { url, type } = await uploaderFichier({ uri, dossier: 'documents-travailleurs', prefixe: 'papier', estPDF })
      setPapiers(prev => [...prev, { type_document: typeDoc, fichier_url: url, fichier_type: type === 'pdf' ? 'pdf' : 'image' }])
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer le fichier")
    }
    setUploadPapier(false)
  }

  async function enregistrer() {
    if (!form.nom.trim() || !form.poste.trim()) { Alert.alert('Erreur', 'Le nom et le poste sont obligatoires'); return }
    if (!edition && !resto) { Alert.alert('Erreur', 'Choisissez le restaurant du travailleur'); return }
    setSaving(true)
    try {
      await enregistrerTravailleur({ form, travailleurEdition: edition, resto, papiers, ctx })
      onEnregistre()
      Alert.alert('Succès', edition ? 'Travailleur modifié !' : 'Travailleur ajouté !')
    } catch (e) {
      Alert.alert('Erreur', e?.francais ? e.message : "L'enregistrement a échoué. Vérifiez la connexion et réessayez.")
    }
    setSaving(false)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <FondModal styles={styles}>
        <ScrollView style={styles.modal} showsVerticalScrollIndicator={false}>
          <EnTete styles={styles} titre={edition ? 'Modifier le travailleur' : 'Nouveau travailleur'} onFermer={onFermer} />

          <View style={styles.photoProfilBox}>
            {form.photo_url
              ? <Image source={{ uri: form.photo_url }} style={styles.photoProfil} />
              : <View style={styles.photoProfilVide}><Text style={{ fontSize: 30 }}>👤</Text></View>}
            <TouchableOpacity style={styles.chipPetit} onPress={photoProfil} disabled={uploadPhoto}>
              <Text style={[styles.chipPetitTxt, { color: BLEU }]}>
                {uploadPhoto ? '⏳ Envoi…' : form.photo_url ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
              </Text>
            </TouchableOpacity>
          </View>

          {!edition && (
            <>
              <Text style={styles.modalLabel}>Restaurant *</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {restaurants.map(r => (
                  <TouchableOpacity key={r.id} style={[styles.motifBtn, restoId === r.id && styles.motifBtnActive]} onPress={() => setRestoId(r.id)}>
                    <Text style={[styles.motifTxt, restoId === r.id && styles.motifTxtActive]}>{r.nom}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <FormulaireTravailleur form={form} setForm={setForm} colors={colors} nomEditable={!edition} />

          <SectionIdentite form={form} setForm={setForm} styles={styles} />
          {nouveauNom && (
            <Text style={[styles.motifTxt, { fontSize: 13, fontWeight: '700', marginBottom: 14 }]}>
              ✏️ Nom complet : {edition.nom} → {nouveauNom}
            </Text>
          )}

          <Text style={styles.modalLabel}>Jour de repos</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {[{ v: 'auto', l: 'Automatique' }, ...JOURS_COURTS.map((l, i) => ({ v: i + 1, l })), { v: 'aucun', l: 'Aucun jour fixe' }].map(c => {
              const actif = form.jour_repos_choix === c.v
              return (
                <TouchableOpacity key={c.v} style={[styles.motifBtn, { paddingHorizontal: 11 }, actif && styles.motifBtnActive]}
                  onPress={() => setForm(p => ({ ...p, jour_repos_choix: c.v }))}>
                  <Text style={[styles.motifTxt, actif && styles.motifTxtActive]}>{c.l}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={[styles.motifTxt, { fontSize: 12, fontWeight: '400', marginBottom: 14 }]}>
            {form.jour_repos_choix === 'auto'
              ? (edition?.jour_repos && edition.jour_repos_source !== 'manuel'
                ? `Déduit des pointages : ${nomJour(edition.jour_repos)}. Mis à jour par « Analyser les jours de repos ».`
                : 'Déduit des pointages dès qu\'il y aura assez de semaines de données.')
              : 'Fixé à la main : l\'analyse automatique ne le changera pas.'}
          </Text>

          <Text style={styles.modalLabel}>Papiers</Text>
          <View style={{ marginBottom: 14 }}>
            {TYPES_PAPIERS.map(type => {
              const existant = papiers.find(p => p.type_document === type)
              return (
                <View key={type} style={styles.papierRow}>
                  <Text style={styles.papierType}>{type}</Text>
                  {existant ? (
                    <View style={styles.papierDone}>
                      <Text style={styles.papierDoneTxt}>✓ {existant.fichier_type === 'pdf' ? 'PDF' : 'Photo'}</Text>
                      <TouchableOpacity onPress={() => setPapiers(prev => prev.filter(p => p.type_document !== type))}>
                        <Text style={styles.papierRemove}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    // Deux boutons distincts : sur le web, un menu Alert se réduit
                    // à window.confirm et le choix PDF ne serait jamais atteignable.
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity style={[styles.petitBtn, uploadPapier && { opacity: 0.5 }]} onPress={() => ajouterPapier(type, false)} disabled={uploadPapier}>
                        <Text style={styles.petitBtnTxt}>{uploadPapier ? '…' : '📷 Photo'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.petitBtn, uploadPapier && { opacity: 0.5 }]} onPress={() => ajouterPapier(type, true)} disabled={uploadPapier}>
                        <Text style={styles.petitBtnTxt}>{uploadPapier ? '…' : '📄 PDF'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )
            })}
          </View>

          <View style={styles.modalBtns}>
            <TouchableOpacity style={styles.modalCancel} onPress={onFermer}>
              <Text style={styles.modalCancelTxt}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalConfirm, (!peutEnregistrer || saving) && { opacity: 0.5 }]} onPress={enregistrer} disabled={!peutEnregistrer || saving}>
              <Text style={styles.modalConfirmTxt}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      </FondModal>
    </Modal>
  )
}

// ── État civil et pièce d'identité ───────────────────────────────────────────
function SectionIdentite({ form, setForm, styles }) {
  const maj = (cle, v) => setForm(p => ({ ...p, [cle]: v }))
  const texte = (cle, label, props = {}) => (
    <>
      <Text style={styles.modalLabel}>{label}</Text>
      <TextInput style={styles.modalInput} value={form[cle] || ''} onChangeText={v => maj(cle, v)} placeholderTextColor="#999" {...props} />
    </>
  )
  const puces = (cle, elements) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      {elements.map(([v, l]) => (
        // Toucher le choix actif l'efface (champ facultatif).
        <TouchableOpacity key={v} style={[styles.motifBtn, form[cle] === v && styles.motifBtnActive]} onPress={() => maj(cle, form[cle] === v ? '' : v)}>
          <Text style={[styles.motifTxt, form[cle] === v && styles.motifTxtActive]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
  return (
    <>
      <Text style={[styles.modalTitre, { flex: 0, fontSize: 15, marginTop: 4, marginBottom: 10 }]}>État civil</Text>
      <Text style={styles.modalLabel}>Civilité</Text>
      {puces('civilite', CIVILITES.map(c => [c, c === 'M.' ? 'Monsieur' : 'Madame']))}
      {texte('nom_famille', 'Nom de famille', { placeholder: 'Ex. GBADIE', autoCapitalize: 'characters' })}
      {texte('prenoms', 'Prénoms', { placeholder: 'Ex. Gogre Tanguy' })}
      <View style={{ marginBottom: 14 }}>
        <ChampDate label="Date de naissance" valeur={form.date_naissance || ''} onChange={v => maj('date_naissance', v)}
          maxDate={aujourdhuiISO()} naissance effacable />
      </View>
      {texte('lieu_naissance', 'Lieu de naissance', { placeholder: 'Ex. Yopougon' })}
      {texte('nationalite', 'Nationalité', { placeholder: 'Ex. Ivoirienne' })}
      <Text style={styles.modalLabel}>Situation de famille</Text>
      {puces('situation_famille', SITUATIONS_FAMILLE.map(s => [s, s]))}
      {texte('lieu_residence', 'Lieu de résidence', { placeholder: 'Ex. Yopougon' })}

      <Text style={[styles.modalTitre, { flex: 0, fontSize: 15, marginTop: 4, marginBottom: 10 }]}>Pièce d'identité</Text>
      {texte('cni_numero', "N° de carte d'identité (CNI)", { placeholder: 'Ex. CI007879705', autoCapitalize: 'characters' })}
      {texte('nni_numero', 'NNI (si connu)', { placeholder: 'Ex. 11919240401', keyboardType: 'number-pad' })}
    </>
  )
}

// ── Archivage ─────────────────────────────────────────────────────────────────
export function ModalArchive({ trav, styles, peutSupprimer, onFermer, onArchiver, onSupprimer }) {
  const [motif, setMotif] = useState('Démission')
  const [autre, setAutre] = useState('')
  const [saving, setSaving] = useState(false)
  const [badge, setBadge] = useState(null)   // true = rendu, false = gardé ; obligatoire
  useEffect(() => { if (trav) { setMotif('Démission'); setAutre(''); setBadge(null) } }, [trav])
  if (!trav) return null

  async function archiver() {
    if (badge === null) return
    setSaving(true)
    await onArchiver(trav, motif === 'Autre' ? (autre.trim() || 'Autre') : motif, badge)
    setSaving(false)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <FondModal styles={styles}>
        <ScrollView style={styles.modal} showsVerticalScrollIndicator={false}>
          <EnTete styles={styles} titre={`Archiver ${trav.nom}`} onFermer={onFermer} />
          <Text style={styles.modalLabel}>Motif d'archivage</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {MOTIFS_ARCHIVE.map(m => (
              <TouchableOpacity key={m} style={[styles.motifBtn, motif === m && styles.motifBtnActive]} onPress={() => setMotif(m)}>
                <Text style={[styles.motifTxt, motif === m && styles.motifTxtActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {motif === 'Autre' && (
            <>
              <Text style={styles.modalLabel}>Préciser le motif</Text>
              <TextInput style={styles.modalInput} placeholder="Ex : Fin de mission, Mutation…" value={autre} onChangeText={setAutre} placeholderTextColor="#999" />
            </>
          )}
          <Text style={styles.modalLabel}>Badge (carte du travailleur) récupéré ?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            {[[true, '✅ Oui, rendu'], [false, '⚠️ Non, gardé']].map(([v, l]) => (
              <TouchableOpacity key={l} style={[styles.motifBtn, { flex: 1, alignItems: 'center' }, badge === v && styles.motifBtnActive]} onPress={() => setBadge(v)}>
                <Text style={[styles.motifTxt, badge === v && styles.motifTxtActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.sousNom, { marginBottom: 12 }]}>
            {badge === false
              ? 'Sa carte affichera « Ne fait plus partie du personnel » au scan. La fiche gardera « Badge non rendu ».'
              : 'Une fois archivé, sa carte affiche « Ne fait plus partie du personnel » au scan.'}
          </Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            <TouchableOpacity style={[styles.modalConfirm, { flex: 0 }, (saving || badge === null) && { opacity: 0.5 }]} onPress={archiver} disabled={saving || badge === null}>
              <Text style={styles.modalConfirmTxt}>{saving ? 'Archivage…' : '📦 Archiver ce travailleur'}</Text>
            </TouchableOpacity>
            {peutSupprimer && (
              <TouchableOpacity style={[styles.btnRouge, { padding: 14, borderRadius: 14 }]} onPress={() => onSupprimer(trav)}>
                <Text style={[styles.btnRougeTxt, { fontSize: 14 }]}>🗑 Supprimer définitivement</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.modalCancel, { flex: 0 }]} onPress={onFermer}>
              <Text style={styles.modalCancelTxt}>Annuler</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      </FondModal>
    </Modal>
  )
}

// ── Droits dus après l'archivage d'un CDI ────────────────────────────────────
// Deux vrais boutons, pas d'Alert (un menu à 3 choix perd le 3e sur le web).
export function ModalDroitsDus({ trav, motif, styles, onFermer, onEnregistrer }) {
  const [montant, setMontant] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (trav) setMontant('') }, [trav])
  if (!trav) return null
  const v = parseInt(montant, 10) || 0

  async function enregistrer() {
    if (v <= 0) return
    setSaving(true)
    await onEnregistrer(v)
    setSaving(false)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <FondModal styles={styles}>
        <ScrollView style={styles.modal} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <EnTete styles={styles} titre="Lui doit-on de l'argent ?" onFermer={onFermer} />
          <Text style={styles.modalLabel}>{trav.nom} (CDI) · {motif}</Text>
          <Text style={styles.modalLabel}>Montant dû (FCFA)</Text>
          <TextInput style={[styles.modalInput, { fontSize: 18, fontWeight: '700' }]} value={montant}
            onChangeText={t => setMontant(t.replace(/[^0-9]/g, ''))} keyboardType="numeric"
            placeholder="0" placeholderTextColor="#999" />
          <Text style={[styles.modalLabel, { fontWeight: '400' }]}>
            Le droit s'ajoute dans Trésorerie → À payer → Anciens travailleurs. Le gérant pourra le payer en caisse.
          </Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            <TouchableOpacity style={[styles.modalConfirm, { flex: 0 }, (v <= 0 || saving) && { opacity: 0.5 }]}
              onPress={enregistrer} disabled={v <= 0 || saving}>
              <Text style={styles.modalConfirmTxt}>{saving ? 'Enregistrement…' : 'Enregistrer ce montant dû'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalCancel, { flex: 0 }]} onPress={onFermer}>
              <Text style={styles.modalCancelTxt}>Rien n'est dû</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      </FondModal>
    </Modal>
  )
}

// ── Transfert ─────────────────────────────────────────────────────────────────
export function ModalTransfert({ trav, restaurants, styles, onFermer, onTransferer }) {
  const [cible, setCible] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setCible(null) }, [trav])
  if (!trav) return null
  const autres = restaurants.filter(r => r.id !== trav.restaurant_id)

  async function confirmer() {
    setSaving(true)
    await onTransferer(trav, restaurants.find(r => r.id === cible))
    setSaving(false)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.modalOverlay}>
        <ScrollView style={[styles.modal, styles.enveloppeModal]}>
          <EnTete styles={styles} titre={`Transférer ${trav.nom}`} onFermer={onFermer} />
          <Text style={styles.modalLabel}>Restaurant de destination</Text>
          {autres.map(r => (
            <TouchableOpacity key={r.id} style={[styles.choix, cible === r.id && styles.choixActive]} onPress={() => setCible(r.id)}>
              <Text style={[styles.choixTxt, cible === r.id && styles.choixTxtActive]}>{r.nom}</Text>
              {cible === r.id && <Text style={{ color: '#fff', fontSize: 16 }}>✓</Text>}
            </TouchableOpacity>
          ))}
          <View style={[styles.modalBtns, { marginTop: 18 }]}>
            <TouchableOpacity style={styles.modalCancel} onPress={onFermer}>
              <Text style={styles.modalCancelTxt}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalConfirm, (!cible || saving) && { opacity: 0.5 }]} onPress={confirmer} disabled={!cible || saving}>
              <Text style={styles.modalConfirmTxt}>{saving ? 'Transfert…' : 'Confirmer'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </Modal>
  )
}

// ── Période personnalisée ─────────────────────────────────────────────────────
export function ModalCalendrier({ visible, styles, colors, onFermer, onValider }) {
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')
  const [etape, setEtape] = useState('debut')
  useEffect(() => { if (visible) { setDebut(''); setFin(''); setEtape('debut') } }, [visible])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.modalOverlay}>
        <ScrollView style={[styles.modal, styles.enveloppeModal]}>
          <EnTete styles={styles} titre="Choisir une période" onFermer={onFermer} />
          <View style={styles.etapeRow}>
            <View style={[styles.etapeBadge, etape === 'debut' && styles.etapeBadgeActive]}>
              <Text style={[styles.etapeTxt, etape === 'debut' && styles.etapeTxtActive]}>1. Date début</Text>
            </View>
            <View style={styles.etapeLine} />
            <View style={[styles.etapeBadge, etape === 'fin' && styles.etapeBadgeActive]}>
              <Text style={[styles.etapeTxt, etape === 'fin' && styles.etapeTxtActive]}>2. Date fin</Text>
            </View>
          </View>
          <View style={styles.datesChoisies}>
            {[['Début', debut], ['Fin', fin]].map(([l, v], i) => (
              <View key={l} style={{ flex: 1, alignItems: 'center', flexDirection: i ? 'row-reverse' : 'row', justifyContent: 'center' }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>{l}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: v ? colors.text : colors.textPlaceholder }}>{v ? formatDate(v) : 'Non sélectionné'}</Text>
                </View>
              </View>
            ))}
          </View>
          <CalendrierPeriode debut={debut} fin={fin} couleur={BLEU}
            onChange={p => { setDebut(p.debut); setFin(p.fin); setEtape(p.debut && !p.fin ? 'fin' : 'debut') }}
            onMoisEntier={p => onValider(p)} />
          <View style={[styles.modalBtns, { marginTop: 12 }]}>
            <TouchableOpacity style={styles.modalCancel} onPress={onFermer}>
              <Text style={styles.modalCancelTxt}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalConfirm, (!debut || !fin) && { opacity: 0.4 }]} onPress={() => debut && fin && onValider({ debut, fin })} disabled={!debut || !fin}>
              <Text style={styles.modalConfirmTxt}>Voir les résultats</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}
