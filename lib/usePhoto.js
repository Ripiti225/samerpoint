import * as ImagePicker from 'expo-image-picker'
import { Alert, Platform } from 'react-native'
import { uploadPhoto } from './api'
import { isOnlineNow } from './networkStatus'
import { enfilerPhoto } from './photoQueue'

// Envoie la photo, ou la met en file d'attente si le réseau manque.
//
// Ne renvoie JAMAIS l'URI locale de l'appareil : c'était l'ancien comportement
// (`return url || result.assets[0].uri`) et il a coûté 81 factures. Cette URI
// passait le contrôle « photo obligatoire », partait en base, puis n'affichait
// plus qu'un cadre noir dans Vérification depuis un autre appareil.
async function traiterPhoto(uri, dossier) {
  if (isOnlineNow()) {
    const url = await uploadPhoto(uri, dossier)
    if (url) return url
  }

  const jeton = await enfilerPhoto(uri, dossier)
  if (jeton) {
    Alert.alert(
      'Photo en attente',
      isOnlineNow()
        ? "L'envoi a échoué. La photo est gardée sur l'appareil et sera renvoyée automatiquement."
        : 'Pas de connexion. La photo est gardée sur l\'appareil et sera envoyée dès le retour du réseau.'
    )
    return jeton
  }

  Alert.alert('Photo non enregistrée', "La photo n'a pas pu être conservée. Reprends-la, sinon la facture partira sans justificatif.")
  return null
}

export function usePhoto() {

  async function prendrePhoto(dossier = 'general') {
    // Sur web, la caméra n'est pas disponible — on utilise le sélecteur de fichiers
    if (Platform.OS === 'web') return choisirPhoto(dossier)

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('Permission caméra refusée')
        return null
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.4,
        allowsEditing: false,
        exif: false,
      })

      if (result.canceled || !result.assets[0]) return null
      return await traiterPhoto(result.assets[0].uri, dossier)
    } catch (err) {
      console.error('Erreur prendrePhoto:', err)
      Alert.alert('Caméra', "Impossible d'ouvrir la caméra : " + (err?.message || 'erreur inconnue'))
      return null
    }
  }

  async function choisirPhoto(dossier = 'general') {
    try {
      // Sur web, pas besoin de demander la permission
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (!permission.granted) {
          Alert.alert('Permission galerie refusée')
          return null
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.4,
        allowsEditing: false,
        mediaTypes: ['images'],
        exif: false,
      })

      if (result.canceled || !result.assets[0]) return null
      return await traiterPhoto(result.assets[0].uri, dossier)
    } catch (err) {
      console.error('Erreur choisirPhoto:', err)
      Alert.alert('Photo', "La photo n'a pas pu être ajoutée : " + (err?.message || 'erreur inconnue'))
      return null
    }
  }

  return { prendrePhoto, choisirPhoto }
}
