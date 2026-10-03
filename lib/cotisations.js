// ──────────────────────────────────────────────────────────────────────────────
// Cotisations des restaurants (supabase_tresorerie_cotisations.sql).
//
// Un restaurant met de côté une part de ses salaires, CNPS, impôts… sur un
// fournisseur « cotisation » de son point. Quand il remet l'argent au RH, celui-ci
// note la « cotisation reçue » sur la charge : l'argent entre en Espèces, le
// solde de la cotisation baisse, et le résultat net ne déduit plus que le reste.
//
// Pur : testé par lib/cotisations.test.mjs. Écritures : lib/tresorerieDb.js.
// ──────────────────────────────────────────────────────────────────────────────

const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Quelle cotisation du restaurant diminue pour chaque charge (par son nom).
const MOTIFS = {
  salaire: /cotisation\s*salaire|^salaires?$/,
  cnps: /cnps/,
  impot: /impot/,
  its: /^its$/,
  tee: /^tee$|^ite$/,
  loyer: /loyer/,
  bail: /bail/,
}

export const CATEGORIES_COTISABLES = Object.keys(MOTIFS)

/** La cotisation attendue pour cette charge dans ce restaurant, ou null. */
export function cotisationPourCategorie(categorie, fournisseurs = [], restaurantId) {
  const motif = MOTIFS[categorie]
  if (!motif) return null
  const duResto = (fournisseurs || []).filter(f => f.restaurant_id === restaurantId && f.actif !== false)
  return duResto.find(f => motif.test(normaliser(f.nom))) || null
}

/** Total cotisé par dû : { [du_id]: montant }. */
export function cotiseParDu(cotisations = []) {
  const out = {}
  for (const c of cotisations || []) out[c.du_id] = (out[c.du_id] || 0) + (Number(c.montant) || 0)
  return out
}

/** Ce que la charge pèse encore sur le résultat : le dû moins la part cotisée (jamais négatif). */
export function chargeApresCotisation(montantDu, cotise) {
  return Math.max(0, (Number(montantDu) || 0) - (Number(cotise) || 0))
}

/**
 * Écritures d'une cotisation reçue (pures, pour être testées) :
 * le mouvement d'Espèces, la transaction fournisseur et le nouveau solde.
 */
export function ecrituresCotisation({ montant, creditActuel }) {
  const m = Math.round(Number(montant) || 0)
  const avant = Number(creditActuel) || 0
  // Une cotisation est un crédit négatif (le restaurant a avancé de l'argent) :
  // la remettre au RH le rapproche de 0.
  return { mouvement: m, nouveauCredit: avant + m, transaction: { facture: m, paye: 0, credit: avant, reste: avant + m } }
}
