// ──────────────────────────────────────────────────────────────────────────────
// Upload d'un fichier vers un bucket Supabase Storage.
//
// Deux chemins parce que l'URI n'a pas la même nature : sur le web c'est une
// blob URL qu'on refetch, en natif un chemin de fichier qu'on lit en base64.
// Passer par le client supabase-js directement échoue sur l'un des deux.
// ──────────────────────────────────────────────────────────────────────────────
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import { supabase } from './supabase'

export async function uploaderFichier({ uri, bucket, prefixe, estPDF = false }) {
  const ext = estPDF ? 'pdf' : 'jpg'
  const contentType = estPDF ? 'application/pdf' : 'image/jpeg'
  const filename = `${prefixe}_${Date.now()}.${ext}`

  let blob
  if (Platform.OS === 'web') {
    const resp = await fetch(uri)
    blob = await resp.blob()
  } else {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
    const octets = atob(b64)
    const tableau = new Uint8Array(octets.length)
    for (let i = 0; i < octets.length; i++) tableau[i] = octets.charCodeAt(i)
    blob = new Blob([tableau], { type: contentType })
  }

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, blob, { contentType, upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename)
  return { url: data.publicUrl, type: estPDF ? 'pdf' : 'photo' }
}
