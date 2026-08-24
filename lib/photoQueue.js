// File d'attente des photos non encore envoyées sur Supabase Storage.
//
// Historique du bug : `usePhoto` retombait sur l'URI locale (`file:///…` ou
// `blob:…`) quand l'upload échouait, et cette URI partait telle quelle en base
// dans `photo_url`. Elle n'est valable que sur l'appareil qui l'a créée (et le
// cache ImagePicker d'Android est purgé), donc la photo apparaissait en noir
// dans Vérification. 81 factures ont été perdues comme ça.
//
// Principe du remplacement : quand l'envoi est impossible, on recopie l'image
// dans un stockage *persistant* et on renvoie un jeton `pending-photo://<id>`
// à la place de l'URI locale. Ce jeton est enregistré en base tel quel, puis
// remplacé par la vraie URL Supabase au retour du réseau — via le mécanisme de
// mappings déjà utilisé par offlineQueue (`patchArgs` fait un simple
// remplacement de chaîne, donc un jeton se substitue comme un ID local).
//
// Le jeton est volontairement reconnaissable : les écrans peuvent afficher
// « en cours d'envoi » plutôt qu'un cadre noir, et les contrôles « facture sans
// photo » l'acceptent (le travail hors ligne ne doit pas être bloqué) tout en
// continuant de refuser une URI locale.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { File, Paths } from 'expo-file-system'
import { Platform } from 'react-native'
import { supabase } from './supabase'

const PENDING_KEY = 'samtrackly_photos_pending'

export const PENDING_PREFIX = 'pending-photo://'

// Au-delà, on refuse de stocker sur le web : le base64 va dans localStorage
// (~5 Mo au total, partagés avec la session et le brouillon de shift).
const MAX_BASE64_WEB = 3 * 1024 * 1024

// ─── Reconnaissance des URLs ──────────────────────────────────────────────

// Photo en attente d'envoi : présente sur l'appareil, pas encore sur Supabase.
export function estPhotoEnAttente(url) {
  return typeof url === 'string' && url.startsWith(PENDING_PREFIX)
}

// Vraie photo, consultable depuis n'importe quel appareil.
export function estPhotoDistante(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

// URI purement locale (`file:///…`, `blob:…`, `data:…`) : c'est exactement ce
// qui ne doit JAMAIS être enregistré en base.
export function estPhotoLocale(url) {
  return typeof url === 'string' && /^(file:|blob:|data:|content:|ph:|assets-library:)/i.test(url)
}

// Ce qu'un contrôle « photo obligatoire » doit accepter.
export function estPhotoValide(url) {
  return estPhotoDistante(url) || estPhotoEnAttente(url)
}

// ─── Stockage ─────────────────────────────────────────────────────────────

async function lireFile() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function ecrireFile(items) {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(items))
    return true
  } catch (e) {
    console.error('photoQueue.ecrireFile:', e)
    return false
  }
}

function nouveauJeton() {
  return `${PENDING_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Recopie l'image dans un emplacement durable et renvoie de quoi la relire.
// Le cache ImagePicker n'est pas fiable : Android le vide quand il veut, et
// c'est précisément ce qui a rendu les 81 photos irrécupérables.
async function persister(uri, jeton) {
  if (Platform.OS === 'web') {
    const reponse = await fetch(uri)
    if (!reponse.ok) return null
    const blob = await reponse.blob()
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
    if (!dataUrl || dataUrl.length > MAX_BASE64_WEB) return null
    return { source: dataUrl }
  }

  const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg'
  const nom = `photo_attente_${jeton.slice(PENDING_PREFIX.length)}.${ext}`
  const destination = new File(Paths.document, nom)
  await new File(uri).copy(destination)
  return { source: destination.uri, fichier: nom }
}

function supprimerFichier(item) {
  if (Platform.OS === 'web' || !item?.fichier) return
  try { new File(Paths.document, item.fichier).delete() } catch {}
}

// ─── Réparation des lignes déjà enregistrées ──────────────────────────────

// Toutes les colonnes de la base qui peuvent contenir une URL de photo, donc
// un jeton en attente. Vérifié colonne par colonne contre le schéma : ni
// `presences`, ni `inventaires`, ni `commandes` n'ont de colonne photo.
const EMPLACEMENTS_PHOTO = [
  ['transactions_fournisseurs', 'photo_url'],
  ['sequences', 'photo_url'],
  ['depenses', 'photo_url'],
  ['historique_credit_fournisseurs', 'photo_url'],
  ['points', 'photo_yango_tab'],
  ['points', 'photo_glovo_tab'],
  ['points', 'photo_vente_machine'],
  ['points_shifts', 'photo_kdo'],
  ['points_shifts', 'photo_retour'],
  ['points_shifts', 'photo_yango_cse'],
  ['points_shifts', 'photo_glovo_cse'],
  ['points_shifts', 'photo_wave'],
  ['points_shifts', 'photo_djamo'],
  ['points_shifts', 'photo_om'],
]

// Remplace le jeton par la vraie URL partout où il a pu être enregistré.
//
// Indispensable quand la saisie est partie en ligne alors que seul l'upload de
// la photo avait échoué : l'opération n'est pas dans offlineQueue, donc
// patchArgs ne la verra jamais et la ligne resterait bloquée sur le jeton.
// Le jeton est unique, ces UPDATE ne peuvent donc toucher aucune autre ligne.
async function reparerLignes(jeton, url) {
  for (const [table, colonne] of EMPLACEMENTS_PHOTO) {
    try {
      await supabase.from(table).update({ [colonne]: url }).eq(colonne, jeton)
    } catch (e) {
      console.warn(`photoQueue: réparation ${table}.${colonne} impossible`, e)
    }
  }
}

// ─── API publique ─────────────────────────────────────────────────────────

// Met une photo en attente. Renvoie le jeton à enregistrer en base, ou null si
// même la copie locale a échoué (dans ce cas l'appelant doit refuser la saisie).
export async function enfilerPhoto(uri, dossier = 'general') {
  try {
    const jeton = nouveauJeton()
    const persiste = await persister(uri, jeton)
    if (!persiste) return null

    const items = await lireFile()
    items.push({
      jeton,
      dossier,
      source: persiste.source,
      fichier: persiste.fichier || null,
      timestamp: Date.now(),
      tentatives: 0,
    })
    if (!await ecrireFile(items)) {
      supprimerFichier(persiste)
      return null
    }
    return jeton
  } catch (e) {
    console.error('photoQueue.enfilerPhoto:', e)
    return null
  }
}

export async function nombrePhotosEnAttente() {
  return (await lireFile()).length
}

// Tente d'envoyer toutes les photos en attente.
// `uploadFn` est `api.uploadPhoto` (injecté pour éviter un import circulaire).
// Renvoie { jeton: urlSupabase } pour les photos parties.
export async function viderFilePhotos(uploadFn) {
  const items = await lireFile()
  if (items.length === 0) return {}

  const mappings = {}
  const restants = []

  for (const item of items) {
    let url = null
    try {
      url = await uploadFn(item.source, item.dossier)
    } catch (e) {
      console.warn('photoQueue: envoi impossible', item.jeton, e)
    }

    if (url) {
      mappings[item.jeton] = url
      await reparerLignes(item.jeton, url)
      supprimerFichier(item)
    } else {
      // On ne jette jamais une photo : sans elle la facture n'est plus
      // justifiable. On compte les tentatives pour pouvoir alerter, pas pour
      // abandonner.
      restants.push({ ...item, tentatives: (item.tentatives || 0) + 1 })
    }
  }

  await ecrireFile(restants)
  return mappings
}
