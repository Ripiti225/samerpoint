// ─────────────────────────────────────────────────────────────────────────
//  FACE ID / EMPREINTE — APPLI INSTALLÉE (expo-local-authentication)
//
//  ⚠ La même mise à jour OTA (runtime 1) arrive sur les ANCIENNES applis,
//  construites sans ce module natif. L'importer directement les ferait
//  planter au démarrage. On vérifie donc d'abord que le module existe
//  (requireOptionalNativeModule) : absent → estSupportee() répond false
//  et l'écran de connexion garde les codes, comme avant.
//
//  Pas de clé cryptographique ici : le téléphone confirme seulement le
//  visage / le doigt (sans repli sur le code du téléphone), et l'on garde
//  un enrôlement par compte dans AsyncStorage, même format que le web.
// ─────────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage'
import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'
import {
  ajouterEnrolement, empreinteTexte, normaliserEnrolements, retirerEnrolement, texteSignature,
} from './biometrie'

let LA = null
if (Platform.OS !== 'web' && requireOptionalNativeModule('ExpoLocalAuthentication')) {
  LA = require('expo-local-authentication')
}

const CLE = 'samerpoint_biometrie'
const CLE_REFUS = 'samerpoint_biometrie_refus_'

export async function estSupportee() {
  if (!LA) return false
  try {
    return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync())
  } catch {
    return false
  }
}

export async function signature(utilisateur, restaurant) {
  return empreinteTexte(texteSignature(utilisateur, restaurant))
}

export async function lireEnrolements() {
  try {
    const brut = await AsyncStorage.getItem(CLE)
    return normaliserEnrolements(brut ? JSON.parse(brut) : null)
  } catch {
    return []
  }
}

async function ecrire(liste) {
  try { await AsyncStorage.setItem(CLE, JSON.stringify(liste)) } catch {}
  return liste
}

export async function oublierEnrolement(credentialId) {
  return ecrire(retirerEnrolement(await lireEnrolements(), credentialId))
}

export async function aRefuse(userId) {
  try { return (await AsyncStorage.getItem(CLE_REFUS + userId)) === '1' } catch { return false }
}

export async function noterRefus(userId) {
  try { await AsyncStorage.setItem(CLE_REFUS + userId, '1') } catch {}
}

// Annulation / échec → même nom d'erreur que le web, pour messageErreur().
async function demander(message) {
  const r = await LA.authenticateAsync({
    promptMessage: message,
    cancelLabel: 'Annuler',
    disableDeviceFallback: true,
  })
  if (!r.success) {
    const err = new Error(r.error || 'echec')
    err.name = ['user_cancel', 'system_cancel', 'app_cancel', 'authentication_failed'].includes(r.error)
      ? 'NotAllowedError'
      : 'Error'
    throw err
  }
}

export async function activer(utilisateur, restaurant) {
  await demander('Activer Face ID / empreinte pour SamerPoint')
  const enrolement = {
    credentialId: `natif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    userId: utilisateur.id,
    userNom: utilisateur.nom,
    restaurantId: restaurant?.id ?? null,
    restaurantNom: restaurant?.nom ?? 'Administration',
    signature: await signature(utilisateur, restaurant),
    creeLe: new Date().toISOString(),
  }
  return ecrire(ajouterEnrolement(await lireEnrolements(), enrolement))
}

export async function verifier(enrolement) {
  await demander(`Entrer : ${enrolement.userNom}`)
}
