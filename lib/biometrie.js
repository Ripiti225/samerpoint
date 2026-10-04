// ─────────────────────────────────────────────────────────────────────────
//  FACE ID / EMPREINTE — RÈGLES (logique pure, testée)
//
//  Sur la version web, un gérant peut remplacer ses deux codes (restaurant
//  + personnel) par Face ID, Touch ID ou l'empreinte de SON téléphone ;
//  un compte administration (manager, directeur, RH) remplace son code
//  personnel — il n'a pas de restaurant.
//  L'appareil ne dit jamais QUI a posé le doigt, seulement qu'une personne
//  enregistrée sur ce téléphone l'a fait : l'activation est donc toujours
//  un choix du gérant, appareil par appareil, jamais automatique.
//
//  L'enrôlement garde une signature des deux codes : si l'un change, ou si
//  le compte est désactivé / change de rôle, l'empreinte cesse de marcher
//  et le gérant retape ses codes. La partie navigateur est dans
//  lib/biometrieWeb.js.
// ─────────────────────────────────────────────────────────────────────────

import { ROLES_GLOBAUX } from './constants.js'

// Vérificateurs et caissiers exclus : appareils partagés.
export const ROLES_BIOMETRIE = ['gerant', 'manager', 'directeur', 'rh']

export function texteSignature(utilisateur, restaurant) {
  return [utilisateur?.id, String(utilisateur?.pin ?? ''), restaurant?.id, String(restaurant?.pin ?? '')].join('|')
}

export function peutProposerActivation({ estWeb, supporte, role, dejaActive, refuse }) {
  return !!(estWeb && supporte && ROLES_BIOMETRIE.includes(role) && !dejaActive && !refuse)
}

const MSG_CODES = 'Face ID n’est plus valable pour ce compte. Entrez vos codes, puis réactivez-le.'

export function controlerEnrolement(enrolement, { utilisateur, restaurant, signature }) {
  const global = !enrolement.restaurantId
  if (!global && !restaurant) {
    return { ok: false, oublier: false, message: 'Restaurant introuvable. Vérifiez la connexion internet ou entrez vos codes.' }
  }
  if (!utilisateur || utilisateur.actif === false) {
    return { ok: false, oublier: true, message: 'Ce compte n’est plus actif. Entrez vos codes ou contactez le manager.' }
  }
  // Un compte passé de gérant à administration (ou l'inverse) n'ouvre plus
  // le même espace : on exige les codes.
  if (!ROLES_BIOMETRIE.includes(utilisateur.role) || utilisateur.id !== enrolement.userId
    || ROLES_GLOBAUX.includes(utilisateur.role) !== global) {
    return { ok: false, oublier: true, message: MSG_CODES }
  }
  if (signature !== enrolement.signature) {
    return { ok: false, oublier: true, message: MSG_CODES }
  }
  return { ok: true }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function versBase64Url(octets) {
  const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets)
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
    if (i + 1 < b.length) s += ALPHABET[(n >> 6) & 63]
    if (i + 2 < b.length) s += ALPHABET[n & 63]
  }
  return s
}

export function depuisBase64Url(texte) {
  const octets = []
  let tampon = 0
  let bits = 0
  for (const c of texte) {
    const v = ALPHABET.indexOf(c)
    if (v < 0) continue
    tampon = (tampon << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      octets.push((tampon >> bits) & 255)
    }
  }
  return new Uint8Array(octets)
}
