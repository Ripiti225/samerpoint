// ──────────────────────────────────────────────────────────────────────────────
// Qui alimente le point d'un restaurant : Samtrackly ou le POS ?
//
// Point de décision UNIQUE, pour que les sites équipés du POS et ceux qui ne le
// sont pas encore ne se mélangent jamais. Tout le reste de l'app passe par ici.
// Tests : lib/sourcePoint.test.mjs (`npm test`).
//
// ⚠ CE DRAPEAU NE DIT PAS SI LE SITE A LE POS.
// Il dit si le point de ce site ARRIVE du POS. Angré 7E a le POS installé et il
// tourne depuis le 2026-08-17 au matin, et pourtant ses caissières tapaient
// encore leur point ici la veille au soir. Un site ne se bascule qu'une fois
// qu'on a VU un shift arriver du POS (requête de feu vert en section 6 de
// supabase_pos_bascule.sql).
//
// ⚠ SENS DU REPLI, décidé volontairement : tout ce qui n'est pas explicitement
// 'POS' vaut SAMTRACKLY. Colonne pas encore créée, valeur nulle, orthographe
// inattendue, restaurant introuvable, appareil hors ligne qui n'a jamais vu ce
// site — dans tous ces cas le site se comporte comme aujourd'hui.
//
// Le raisonnement : verrouiller par erreur un site SANS POS empêche ses
// caissières de travailler le soir même, et personne sur place ne peut rien y
// faire. Laisser par erreur la saisie ouverte sur un site AVEC POS crée au pire
// un doublon, visible et corrigeable par un manager. La panne bénigne est donc
// toujours du même côté.
// ──────────────────────────────────────────────────────────────────────────────

export const SOURCE_SAMTRACKLY = 'SAMTRACKLY'
export const SOURCE_POS = 'POS'

/**
 * Normalise la valeur brute de la colonne `restaurants.source_point`.
 * Tout ce qui n'est pas exactement 'POS' (à la casse et aux espaces près)
 * retombe sur SAMTRACKLY.
 */
export function normaliserSourcePoint(valeur) {
  return String(valeur ?? '').trim().toUpperCase() === SOURCE_POS
    ? SOURCE_POS
    : SOURCE_SAMTRACKLY
}

/**
 * Le point de ce restaurant arrive-t-il du POS ?
 * @param {object|null} restaurant  fiche telle que renvoyée par getRestaurants()
 */
export function estSurPOS(restaurant) {
  return normaliserSourcePoint(restaurant?.source_point) === SOURCE_POS
}

/** Rôles dont la saisie passe dans le POS sur un site basculé. */
const ROLES_REPRIS_PAR_LE_POS = ['caissier']

/**
 * Découpe une liste de comptes en deux : ceux qu'on affiche, et ceux que le POS
 * a repris. La seconde liste sert à EXPLIQUER l'absence à l'écran — un compte
 * qui disparaît sans un mot déclenche un appel au support.
 *
 * Les comptes ne sont jamais désactivés ni supprimés : un UPDATE sur
 * `restaurants.source_point` les fait revenir au prochain chargement de l'app.
 */
export function separerComptesPOS(restaurant, utilisateurs) {
  const liste = utilisateurs || []
  if (!estSurPOS(restaurant)) return { visibles: liste, reprisParLePOS: [] }

  const visibles = []
  const reprisParLePOS = []
  liste.forEach(u => {
    const role = String(u?.role ?? '').trim().toLowerCase()
    ;(ROLES_REPRIS_PAR_LE_POS.includes(role) ? reprisParLePOS : visibles).push(u)
  })
  return { visibles, reprisParLePOS }
}

/**
 * Champs que le POS remplit lui-même, et qui passent donc en lecture seule pour
 * le gérant sur un site basculé (décision du 2026-08-17).
 *
 * Restent volontairement en saisie : `yango_nb_commandes` /
 * `glovo_nb_commandes` — le gérant garde le compte pris dans l'app partenaire,
 * et l'écart avec celui du POS est un contrôle croisé. Restent également à lui
 * ses propres déductions et les fournisseurs.
 */
export const CHAMPS_REMPLIS_PAR_LE_POS = [
  'vente_machine',
  'photo_vente_machine',
  'ecart',
  'ecart_par_caissier',
  'depenses_caissier',
  'presences_caissier',
  'paies_caissier',
]

/**
 * Un seul point de décision, pour que l'écran Ventes, l'écran Dépenses et
 * l'écran Présences ne puissent pas se contredire.
 */
export function estRempliParLePOS(restaurant, champ) {
  return estSurPOS(restaurant) && CHAMPS_REMPLIS_PAR_LE_POS.includes(champ)
}
