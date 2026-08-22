// ──────────────────────────────────────────────────────────────────────────────
// Saisie d'un contrat de travail.
//
// L'ordre des champs suit le raisonnement du RH : quel type, à partir de quand,
// pour combien de temps, et la preuve. La date de fin n'est pas un champ à
// remplir mais un résultat affiché — sauf si la durée sort des trois cas.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  TYPES_CONTRAT, DUREES_MOIS, calculerDateFin, validerFormulaireContrat,
  aujourdhuiISO, ajouterJours, finEffective,
} from '../lib/contrats'
import { uploaderFichier } from '../lib/uploadFichier'

const LIBELLE_DUREE = { 3: '3 mois', 6: '6 mois', 12: '1 an' }

function formatFR(iso) {
  if (!iso) return ''
  const [a, m, j] = iso.split('-')
  return `${j}/${m}/${a}`
}

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
  visible, travailleur, contratsExistants, colors, onFermer, onEnregistrer,
}) {
  const [type, setType] = useState('CDD')
  const [dateDebut, setDateDebut] = useState('')
  const [duree, setDuree] = useState(6)
  const [dateFinLibre, setDateFinLibre] = useState('')
  const [photo, setPhoto] = useState(null)
  const [upload, setUpload] = useState(false)
  const [enreg, setEnreg] = useState(false)

  useEffect(() => {
    if (!visible) return
    setType('CDD')
    setDateDebut(debutParDefaut(travailleur, contratsExistants))
    setDuree(6)
    setDateFinLibre('')
    setPhoto(null)
    // Volontairement limité : recharger `contratsExistants` pendant la saisie
    // ne doit pas remettre le formulaire à zéro sous les doigts du RH.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travailleur?.id])

  const estCDI = type === 'CDI'
  const dureeLibre = duree === 'autre'
  const dateFin = estCDI ? '' : (dureeLibre ? dateFinLibre : calculerDateFin(dateDebut, duree))

  const form = {
    type,
    date_debut: dateDebut,
    date_fin: estCDI ? '' : dateFin,
    duree_mois: estCDI || dureeLibre ? null : duree,
    photo_url: photo?.url || null,
  }
  const validation = validerFormulaireContrat(form)

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
      duree_mois: estCDI || dureeLibre ? null : duree,
      photo_url: photo.url,
      photo_type: photo.type,
    })
    setEnreg(false)
  }

  const label = { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }
  const input = { backgroundColor: colors.bg, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, marginBottom: 14 }
  const puce = { flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border }
  const puceActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }
  const txtPuce = actif => ({ fontSize: 13, color: actif ? '#fff' : colors.textMuted, fontWeight: actif ? '600' : '400' })

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Nouveau contrat</Text>
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
                <TouchableOpacity key={t} style={[puce, type === t && puceActive]} onPress={() => setType(t)}>
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
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {DUREES_MOIS.map(d => (
                    <TouchableOpacity key={d} style={[puce, duree === d && puceActive]} onPress={() => setDuree(d)}>
                      <Text style={txtPuce(duree === d)}>{LIBELLE_DUREE[d]}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[puce, dureeLibre && puceActive]} onPress={() => setDuree('autre')}>
                    <Text style={txtPuce(dureeLibre)}>Autre</Text>
                  </TouchableOpacity>
                </View>

                {dureeLibre ? (
                  <>
                    <Text style={label}>Date de fin *</Text>
                    <TextInput
                      style={input}
                      placeholder="AAAA-MM-JJ"
                      value={dateFinLibre}
                      onChangeText={setDateFinLibre}
                      placeholderTextColor="#bbb"
                    />
                  </>
                ) : (
                  <View style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.text }}>
                      {dateFin
                        ? `Se termine le ${formatFR(dateFin)}`
                        : 'Renseigne la date de début pour voir la date de fin.'}
                    </Text>
                  </View>
                )}
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
              <Text style={{ fontSize: 15, color: photo ? colors.text : '#bbb' }}>
                {upload ? 'Envoi en cours…' : photo ? `✓ ${photo.type === 'pdf' ? 'PDF' : 'Photo'} ajouté` : 'Ajouter le contrat signé'}
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
