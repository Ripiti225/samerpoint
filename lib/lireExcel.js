// ──────────────────────────────────────────────────────────────────────────────
// Choisir un fichier Excel et en lire la première feuille en lignes de cellules.
// Web : le navigateur donne directement le contenu. Mobile : lecture en base64.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'
import * as XLSX from 'xlsx'

// Rend { nom, lignes } ou null si l'utilisateur a annulé.
export async function choisirEtLireExcel() {
  const res = await DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      '*/*',
    ],
    copyToCacheDirectory: true,
  })
  if (res.canceled || !res.assets?.[0]) return null
  const asset = res.assets[0]

  let classeur
  if (Platform.OS === 'web') {
    const buffer = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer()
    classeur = XLSX.read(buffer, { type: 'array', cellDates: true })
  } else {
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
    classeur = XLSX.read(b64, { type: 'base64', cellDates: true })
  }

  const feuille = classeur.Sheets[classeur.SheetNames[0]]
  const lignes = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: null })
  return { nom: asset.name || 'export.xlsx', lignes }
}
