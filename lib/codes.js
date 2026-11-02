// ──────────────────────────────────────────────────────────────────────────────
// Codes personnels (connexion) : règles d'un nouveau code et petits calculs.
// Depuis le 02/11/2026, les codes ne quittent plus le serveur : la vérification
// et le changement passent par les fonctions de supabase_codes_securises.sql,
// qui appliquent les MÊMES règles (code_trop_simple). Ce module ne sert qu'à
// répondre tout de suite à l'écran, avant l'appel au serveur.
// Tests : lib/codes.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { empreinteTexte } from './biometrie.js'

export const LONGUEUR_NOUVEAU_CODE = 6

/** Même règle que code_trop_simple() côté serveur. */
export function codeTropSimple(code) {
  const c = String(code ?? '')
  if (!/^\d{6}$/.test(c)) return true
  if (/^(\d)\1{5}$/.test(c)) return true            // 111111
  if (/^(\d\d)\1\1$/.test(c)) return true           // 121212
  if (/^(\d{3})\1$/.test(c)) return true            // 123123
  return '01234567890123'.includes(c) || '98765432109876'.includes(c) // 123456, 654321
}

/** Message d'erreur en français courant, ou null si le nouveau code convient. */
export function problemeNouveauCode(nouveau, ancien = null) {
  const c = String(nouveau ?? '')
  if (!/^\d{6}$/.test(c)) return 'Le code doit faire exactement 6 chiffres.'
  if (ancien != null && c === String(ancien)) return 'Le nouveau code doit être différent de l\'ancien.'
  if (codeTropSimple(c)) return 'Code trop facile à deviner (comme 123456, 111111 ou 121212). Choisissez-en un autre.'
  return null
}

/** Nombre de chiffres du code d'un compte (anciens codes : 4). */
export const longueurCode = u => (Number(u?.pin_longueur) > 0 ? Number(u.pin_longueur) : 4)

/**
 * Empreinte gardée sur le téléphone après une connexion réussie, pour pouvoir
 * se reconnecter sans internet sur CE téléphone (jamais le code lui-même).
 */
export const empreinteHorsLigne = (userId, code) => empreinteTexte(`hors-ligne|${userId}|${code}`)

/** « 45 s », « 2 min », « 15 min » : attente avant de pouvoir réessayer. */
export function libelleAttente(secondes) {
  const s = Math.max(0, Math.ceil(Number(secondes) || 0))
  return s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`
}
