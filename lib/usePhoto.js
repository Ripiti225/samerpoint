import * as ImagePicker from 'expo-image-picker'
import { Platform } from 'react-native'
import { uploadPhoto } from './api'

export function usePhoto() {

  async function prendrePhoto(dossier = 'general') {
    // Sur web, la caméra n'est pas disponible — on utilise le sélecteur de fichiers
    if (Platform.OS === 'web') return choisirPhoto(dossier)

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        alert('Permission caméra refusée')
        return null
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        allowsEditing: false,
      })

      if (result.canceled || !result.assets[0]) return null
      const url = await uploadPhoto(result.assets[0].uri, dossier)
      return url || result.assets[0].uri
    } catch (err) {
      console.error('Erreur prendrePhoto:', err)
      return null
    }
  }

  async function choisirPhoto(dossier = 'general') {
    try {
      // Sur web, pas besoin de demander la permission
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (!permission.granted) {
          alert('Permission galerie refusée')
          return null
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.7,
        allowsEditing: false,
        mediaTypes: ['images'],
      })

      if (result.canceled || !result.assets[0]) return null
      const url = await uploadPhoto(result.assets[0].uri, dossier)
      return url || result.assets[0].uri
    } catch (err) {
      console.error('Erreur choisirPhoto:', err)
      return null
    }
  }

  return { prendrePhoto, choisirPhoto }
}