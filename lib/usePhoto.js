import * as ImagePicker from 'expo-image-picker'
import { uploadPhoto } from './api'

export function usePhoto() {

  async function prendrePhoto(dossier = 'general') {
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

      const uri = result.assets[0].uri

      // Uploader sur Supabase Storage
      const url = await uploadPhoto(uri, dossier)
      return url || uri // Si upload échoue, retourne l'URI local en fallback
    } catch (err) {
      console.error('Erreur prendrePhoto:', err)
      return null
    }
  }

  async function choisirPhoto(dossier = 'general') {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        alert('Permission galerie refusée')
        return null
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.7,
        allowsEditing: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      })

      if (result.canceled || !result.assets[0]) return null

      const uri = result.assets[0].uri

      // Uploader sur Supabase Storage
      const url = await uploadPhoto(uri, dossier)
      return url || uri
    } catch (err) {
      console.error('Erreur choisirPhoto:', err)
      return null
    }
  }

  return { prendrePhoto, choisirPhoto }
}