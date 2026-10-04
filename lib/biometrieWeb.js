// ─────────────────────────────────────────────────────────────────────────
//  FACE ID / EMPREINTE — PARTIE NAVIGATEUR (WebAuthn)
//
//  Uniquement sur la version web (Safari iPhone, Chrome Android) : l'appli
//  installée n'embarque pas le module natif, et un nouveau build ne
//  parviendrait pas aux gérants. Ailleurs, estSupportee() répond false et
//  rien ne s'affiche.
//
//  Les appels à navigator.credentials doivent partir directement d'un appui
//  (Safari refuse sinon) : ne jamais placer un fetch AVANT eux.
//
//  L'enrôlement est lié au domaine du site : après un changement d'adresse
//  (Vercel → alkayanabj.com), chaque gérant doit réactiver Face ID.
// ─────────────────────────────────────────────────────────────────────────
import { Platform } from 'react-native'
import { depuisBase64Url, texteSignature, versBase64Url } from './biometrie'

const CLE = 'samerpoint_biometrie'
const CLE_REFUS = 'samerpoint_biometrie_refus_'

function aleatoire(n = 32) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export async function estSupportee() {
  if (Platform.OS !== 'web') return false
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential) return false
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function signature(utilisateur, restaurant) {
  const octets = new TextEncoder().encode(texteSignature(utilisateur, restaurant))
  const hash = await crypto.subtle.digest('SHA-256', octets)
  return versBase64Url(new Uint8Array(hash))
}

export function lireEnrolement() {
  if (Platform.OS !== 'web') return null
  try {
    const brut = localStorage.getItem(CLE)
    const e = brut ? JSON.parse(brut) : null
    return e?.credentialId && e?.userId && e?.restaurantId ? e : null
  } catch {
    return null
  }
}

export function oublierEnrolement() {
  try { localStorage.removeItem(CLE) } catch {}
}

export function aRefuse(userId) {
  try { return localStorage.getItem(CLE_REFUS + userId) === '1' } catch { return false }
}

export function noterRefus(userId) {
  try { localStorage.setItem(CLE_REFUS + userId, '1') } catch {}
}

// Appelé depuis un appui sur « Activer ». Remplace un éventuel enrôlement
// précédent : un téléphone = un gérant.
export async function activer(utilisateur, restaurant) {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: aleatoire(),
      rp: { name: 'SamerPoint' },
      user: {
        id: new TextEncoder().encode(utilisateur.id),
        name: `${utilisateur.nom} — ${restaurant.nom}`,
        displayName: utilisateur.nom,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      attestation: 'none',
      timeout: 60_000,
    },
  })
  const enrolement = {
    credentialId: versBase64Url(new Uint8Array(credential.rawId)),
    userId: utilisateur.id,
    userNom: utilisateur.nom,
    restaurantId: restaurant.id,
    restaurantNom: restaurant.nom,
    signature: await signature(utilisateur, restaurant),
    creeLe: new Date().toISOString(),
  }
  localStorage.setItem(CLE, JSON.stringify(enrolement))
  return enrolement
}

// Appelé depuis un appui sur « Entrer avec Face ID ». Rejette si
// l'utilisateur annule ou si le visage / doigt n'est pas reconnu.
export async function verifier(enrolement) {
  await navigator.credentials.get({
    publicKey: {
      challenge: aleatoire(),
      allowCredentials: [{ type: 'public-key', id: depuisBase64Url(enrolement.credentialId) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })
}

export function messageErreur(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
    return 'Face ID annulé ou non reconnu. Réessayez ou entrez vos codes.'
  }
  if (err?.name === 'InvalidStateError') {
    return 'Face ID est déjà activé sur ce téléphone.'
  }
  return 'Face ID n’a pas fonctionné sur ce téléphone. Entrez vos codes.'
}
