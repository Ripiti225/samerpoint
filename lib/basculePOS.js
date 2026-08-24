// ──────────────────────────────────────────────────────────────────────────────
// Le feu vert avant de basculer un site vers le POS.
//
// On ne bascule pas un site parce que la caisse y est installée, mais parce
// qu'on a VU un shift en arriver. La différence a un coût réel : le 2026-08-17,
// Angré 7E est passé sur le POS le matin alors que la remontée n'existait pas.
// Mettre ce site en 'POS' ce jour-là aurait fait disparaître Marie-Paule, Hilary
// et Flora de l'écran de connexion sans rien mettre à la place — trois shifts de
// recette perdus par jour, sans message d'erreur.
//
// Cette règle vivait en commentaire dans supabase_pos_bascule.sql. Elle est
// désormais exécutable, et l'écran Paramètres → Restaurants s'appuie dessus.
//
// Tests : lib/basculePOS.test.mjs (`npm test`).
// ──────────────────────────────────────────────────────────────────────────────
// Extension explicite : Metro s'en accommode, et `node --test` l'exige.
import { estSurPOS } from './sourcePoint.js'

export const ETAT_BASCULE = {
  /** Sur Samtrackly, et aucun shift n'est jamais arrivé du POS. */
  PAS_PRET: 'PAS_PRET',
  /** Sur Samtrackly, mais la remontée fonctionne : on peut basculer. */
  PRET: 'PRET',
  /** Basculé, et plus personne ne saisit à la main. Situation normale. */
  BASCULE: 'BASCULE',
  /** Basculé, et pourtant des shifts arrivent encore à la main. */
  INCOHERENT: 'INCOHERENT',
}

/**
 * Compte, par restaurant, les shifts venus du POS et ceux saisis à la main.
 *
 * Un shift vient du POS si et seulement si `pos_service_id` est renseigné —
 * c'est la clé d'idempotence posée à la remontée, donc le seul marqueur fiable.
 *
 * Les shifts sans `restaurant_id` sont ignorés : ils ont déjà cassé le report de
 * stock une fois (cf. supabase_shift_restaurant_obligatoire.sql), on ne les
 * laisse pas fausser un diagnostic de bascule.
 *
 * @param {{restaurant_id: string|null, pos_service_id: string|null}[]} shifts
 * @returns {Record<string, {pos: number, main: number}>}
 */
export function compterShiftsParRestaurant(shifts) {
  const parResto = {}
  for (const s of shifts || []) {
    const id = s?.restaurant_id
    if (!id) continue
    if (!parResto[id]) parResto[id] = { pos: 0, main: 0 }
    if (s.pos_service_id) parResto[id].pos++
    else parResto[id].main++
  }
  return parResto
}

/** Lit un compteur venu du réseau sans jamais lever. */
function nombre(valeur) {
  const n = Number(valeur)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Diagnostic d'un site, à partir de ses shifts des derniers jours.
 *
 * @param {object|null} restaurant  fiche avec `source_point`
 * @param {{pos?: number, main?: number}|null} comptes
 *        `pos`  = shifts arrivés du POS (pos_service_id non nul)
 *        `main` = shifts saisis à la main dans Samtrackly
 * @returns {{etat: string, peutBasculer: boolean, peutRevenir: boolean, message: string}}
 */
export function diagnosticBascule(restaurant, comptes) {
  const pos = nombre(comptes?.pos)
  const main = nombre(comptes?.main)
  const nom = restaurant?.nom?.trim() || 'Ce restaurant'

  if (estSurPOS(restaurant)) {
    // La sortie de secours ne se ferme JAMAIS. Le mini-PC d'un site est déjà
    // tombé plusieurs fois ; le soir où ça arrive, le manager doit pouvoir
    // rendre la saisie à ses caissières sans aucune condition.
    if (main > 0) {
      return {
        etat: ETAT_BASCULE.INCOHERENT,
        peutBasculer: false,
        peutRevenir: true,
        message:
          `${nom} est sur le POS, mais ${main} shift${main > 1 ? 's ont' : ' a'} encore été saisi` +
          `${main > 1 ? 's' : ''} à la main ces 7 derniers jours. Une journée risque d'être comptée deux fois — ` +
          `vérifiez avec le gérant avant de valider les points concernés.`,
      }
    }
    return {
      etat: ETAT_BASCULE.BASCULE,
      peutBasculer: false,
      peutRevenir: true,
      message:
        `${nom} est sur le POS. Ses caissières ne se connectent plus ici : leur point, ` +
        `leurs dépenses et leur inventaire arrivent automatiquement de la caisse.`,
    }
  }

  if (pos > 0) {
    return {
      etat: ETAT_BASCULE.PRET,
      peutBasculer: true,
      peutRevenir: false,
      message:
        `La remontée fonctionne : ${pos} shift${pos > 1 ? 's sont arrivés' : ' est arrivé'} du POS ` +
        `ces 7 derniers jours. Vous pouvez basculer ${nom} — ses caissières cesseront alors de ` +
        `saisir ici.`,
    }
  }

  return {
    etat: ETAT_BASCULE.PAS_PRET,
    peutBasculer: false,
    peutRevenir: false,
    message:
      `Aucun shift n'est encore arrivé du POS pour ${nom}. Basculer maintenant ferait ` +
      `disparaître ses caissières de la connexion sans rien mettre à la place : le point de la ` +
      `journée n'atterrirait nulle part. Attendez d'avoir vu un premier shift remonter.`,
  }
}
