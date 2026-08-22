// ──────────────────────────────────────────────────────────────────────────────
// Saisie d'un contrat de travail — création ou correction.
//
// L'ordre des champs suit le raisonnement du RH : quel type, à partir de quand,
// pour combien de temps, et la preuve. La date de fin est un résultat calculé,
// mais elle reste modifiable pour le contrat qui ne tombe pas sur un nombre
// entier de mois (« jusqu'au 30 juin »). La corriger à la main met duree_mois à
// null : on n'enregistre pas une durée qui ne correspond plus aux dates.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  TYPES_CONTRAT, DUREES_MOIS, calculerDateFin, validerFormulaireContrat,
  validerDureeLibre, aujourdhuiISO, ajouterJours, finEffective, formatFR,
} from '../lib/contrats'
import { uploaderFichier } from '../lib/uploadFichier'

const LIBELLE_DUREE = { 1: '1 mois', 2: '2 mois', 3: '3 mois', 6: '6 mois', 12: '1 an' }

// Premier contrat : la date d'embauche. Renouvellement : le lendemain de la fin
// du dernier contrat, pour ne pas laisser de trou par inadvertance.
function debutParDefaut(travailleur, contratsExistants) {
  const finsConnues = (contratsExistants || [])
    .map(finEffective)
    .filter(Boolean)
    .sort()
  if (finsConnues.length > 0) return ajouterJours(finsConnues[finsConnues.length - 1], 1)
  return travailleur?.date_embauche || aujourdhuiISO()
}

export default function FormulaireContrat({
  visible, travailleur, contratsExistants, contratEdite, colors, onFermer, onEnregistrer,
}) {
  const enCorrection = !!contratEdite

  const [type, setType] = useState('CDD')
  const [dateDebut, setDateDebut] = useState('')
  const [duree, setDuree] = useState(3)
  const [dureeLibre, setDureeLibre] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [finManuelle, setFinManuelle] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [upload, setUpload] = useState(false)
  const [enreg, setEnreg] = useState(false)

  useEffect(() => {
    if (!visible) return
    if (contratEdite) {
      setType(contratEdite.type)
      setDateDebut(contratEdite.date_debut)
      setDateFin(contratEdite.date_fin || '')
      // Un contrat sans duree_mois a eu sa date de fin saisie à la main.
      const connue = DUREES_MOIS.includes(contratEdite.duree_mois)
      setDuree(connue ? contratEdite.duree_mois : (contratEdite.duree_mois ? 'autre' : 3))
      setDureeLibre(connue || !contratEdite.duree_mois ? '' : String(contratEdite.duree_mois))
      setFinManuelle(!contratEdite.duree_mois && !!contratEdite.date_fin)
    } else {
      setType('CDD')
      setDateDebut(debutParDefaut(travailleur, contratsExistants))
      setDuree(3)
      setDureeLibre('')
      setDateFin('')
      setFinManuelle(false)
    }
    setPhoto(null)
    // Volontairement limité : recharger la liste des contrats pendant la saisie
    // ne doit pas remettre le formulaire à zéro sous les doigts du RH.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travailleur?.id, contratEdite?.id])

  const estCDI = type === 'CDI'
  const dureeLibreChoisie = duree === 'autre'

  // Recalcule la date de fin tant que l'utilisateur ne l'a pas reprise à la main.
  useEffect(() => {
    if (estCDI) { setDateFin(''); return }
    if (finManuelle) return
    const mois = dureeLibreChoisie ? validerDureeLibre(dureeLibre).mois : duree
    setDateFin(mois && dateDebut ? calculerDateFin(dateDebut, mois) : '')
  }, [estCDI, finManuelle, dureeLibreChoisie, dureeLibre, duree, dateDebut])

  const dureeMois = estCDI || finManuelle
    ? null
    : (dureeLibreChoisie ? validerDureeLibre(dureeLibre).mois : duree)

  const photoUrl = photo?.url || contratEdite?.photo_url || null
  const photoType = photo?.type || contratEdite?.photo_type || 'photo'

  const erreurDuree = (!estCDI && dureeLibreChoisie && !finManuelle)
    ? validerDureeLibre(dureeLibre).erreur
    : null
  const validation = erreurDuree
    ? { ok: false, erreur: erreurDuree }
    : validerFormulaireContrat({
        type,
        date_debut: dateDebut,
        date_fin: estCDI ? '' : dateFin,
        duree_mois: dureeMois,
        photo_url: photoUrl,
      })

  function choisirDuree(d) {
    setDuree(d)
    setFinManuelle(false)   // reprendre un bouton reprend la main sur la date
  }

  function choisirFichier() {
    Alert.alert('Contrat signé', 'Type de fichier', [
      { text: 'Photo (JPG/PNG)', onPress: () => prendrePhoto() },
      { text: 'Document PDF', onPress: () => prendrePDF() },
      { text: 'Annuler', style: 'cancel' },
    ])
  }

  async function prendrePhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85,
    })
    if (r.canceled) return
    await televerser(r.assets[0].uri, false)
  }

  async function prendrePDF() {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' })
    if (r.canceled) return
    await televerser(r.assets[0].uri, true)
  }

  async function televerser(uri, estPDF) {
    setUpload(true)
    try {
      const res = await uploaderFichier({
        uri, dossier: 'documents-travailleurs', prefixe: 'contrat', estPDF,
      })
      setPhoto(res)
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer le fichier. Vérifie ta connexion.")
    }
    setUpload(false)
  }

  async function enregistrer() {
    if (!validation.ok) {
      Alert.alert('Contrat incomplet', validation.erreur)
      return
    }
    setEnreg(true)
    await onEnregistrer({
      type,
      date_debut: dateDebut,
      date_fin: estCDI ? null : dateFin,
      duree_mois: dureeMois,
      photo_url: photoUrl,
      photo_type: photoType,
    })
    setEnreg(false)
  }

  const label = { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }
  const input = { backgroundColor: colors.bg, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, marginBottom: 14 }
  const puce = { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border }
  const puceActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }
  const txtPuce = actif => ({ fontSize: 13, color: actif ? '#fff' : colors.textMuted, fontWeight: actif ? '600' : '400' })

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
              {enCorrection ? 'Corriger le contrat' : 'Nouveau contrat'}
            </Text>
            <TouchableOpacity onPress={onFermer} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 22, color: colors.textMuted }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 18 }}>
              {travailleur?.nom}
            </Text>

            <Text style={label}>Type de contrat *</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {TYPES_CONTRAT.map(t => (
                <TouchableOpacity key={t} style={[puce, { flex: 1 }, type === t && puceActive]} onPress={() => setType(t)}>
                  <Text style={txtPuce(type === t)}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={label}>Date de début *</Text>
            <TextInput
              style={input}
              placeholder="AAAA-MM-JJ"
              value={dateDebut}
              onChangeText={setDateDebut}
              placeholderTextColor="#bbb"
            />

            {!estCDI && (
              <>
                <Text style={label}>Durée *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {DUREES_MOIS.map(d => (
                    <TouchableOpacity
                      key={d}
                      style={[puce, duree === d && !finManuelle && puceActive]}
                      onPress={() => choisirDuree(d)}
                    >
                      <Text style={txtPuce(duree === d && !finManuelle)}>{LIBELLE_DUREE[d]}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[puce, dureeLibreChoisie && !finManuelle && puceActive]}
                    onPress={() => choisirDuree('autre')}
                  >
                    <Text style={txtPuce(dureeLibreChoisie && !finManuelle)}>Autre</Text>
                  </TouchableOpacity>
                </View>

                {dureeLibreChoisie && (
                  <TextInput
                    style={input}
                    placeholder="Nombre de mois (ex : 4)"
                    value={dureeLibre}
                    onChangeText={t => { setDureeLibre(t); setFinManuelle(false) }}
                    keyboardType="number-pad"
                    placeholderTextColor="#bbb"
                  />
                )}

                <Text style={label}>Date de fin *</Text>
                <TextInput
                  style={input}
                  placeholder="AAAA-MM-JJ"
                  value={dateFin}
                  onChangeText={t => { setDateFin(t); setFinManuelle(true) }}
                  placeholderTextColor="#bbb"
                />
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: -8, marginBottom: 14 }}>
                  {finManuelle
                    ? 'Date saisie à la main — la durée ne sera pas enregistrée.'
                    : dateFin
                      ? `Calculée : se termine le ${formatFR(dateFin)}.`
                      : 'Renseigne la date de début et la durée.'}
                </Text>
              </>
            )}

            {estCDI && (
              <View style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.textMuted }}>
                  Un CDI n'a pas de date de fin : aucune alerte, aucune désactivation automatique.
                </Text>
              </View>
            )}

            <Text style={label}>Contrat signé * (photo ou PDF)</Text>
            <TouchableOpacity
              style={[input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
              onPress={choisirFichier}
              disabled={upload}
            >
              <Text style={{ fontSize: 15, color: photoUrl ? colors.text : '#bbb' }}>
                {upload
                  ? 'Envoi en cours…'
                  : photo
                    ? `✓ ${photo.type === 'pdf' ? 'PDF' : 'Photo'} ajouté`
                    : contratEdite?.photo_url
                      ? `✓ ${contratEdite.photo_type === 'pdf' ? 'PDF' : 'Photo'} déjà enregistré — appuyer pour remplacer`
                      : 'Ajouter le contrat signé'}
              </Text>
              {upload ? <ActivityIndicator size="small" /> : <Text style={{ color: '#185FA5' }}>+</Text>}
            </TouchableOpacity>

            {!validation.ok && (
              <Text style={{ fontSize: 13, color: '#993C1D', marginBottom: 14 }}>{validation.erreur}</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 30 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center' }}
                onPress={onFermer}
              >
                <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: validation.ok ? '#185FA5' : colors.border, alignItems: 'center' }}
                onPress={enregistrer}
                disabled={!validation.ok || enreg}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {enreg ? 'Enregistrement…' : 'Enregistrer'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
