// ──────────────────────────────────────────────────────────────────────────────
// Cotisations des restaurants (supabase_tresorerie_cotisations.sql).
//
// Un restaurant met de côté une part de ses salaires, CNPS, impôts… sur un
// fournisseur « cotisation » de son point. Quand il remet l'argent au RH, celui-ci
// note la « cotisation reçue » sur la charge : l'argent entre en Espèces, le
// solde de la cotisation baisse, et le résultat net ne déduit plus que le reste.
//
// Depuis le 24/10/2026 (supabase_cotisations_banque.sql), la remise se note
// dans Banque, le jour où elle arrive, sur le compte « Cotisation salaire » ou
// « Cotisations autres » : l'argent reste sur ce compte (plus en Espèces), et le
// résultat du restaurant déduit la remise de ses charges du mois de réception,
// quelle que soit la cotisation (choix du 24/10). Ces remises n'ont pas de
// charge (du_id vide) ; les anciennes, rattachées à une charge, ne changent pas.
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
  for (const c of cotisations || []) if (c.du_id) out[c.du_id] = (out[c.du_id] || 0) + (Number(c.montant) || 0)
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

// ── Remises notées dans Banque ───────────────────────────────────────────────

export const COMPTE_COTISATION_SALAIRE = 'Cotisation salaire'
export const COMPTE_COTISATIONS_AUTRES = 'Cotisations autres'
export const CATEGORIES_COTISATIONS_AUTRES = ['cnps', 'impot', 'its', 'tee', 'loyer', 'bail']

export const LIBELLES_COTISATION = {
  salaire: 'Cotisation salaire', cnps: 'CNPS', impot: 'Impôt et timbre', its: 'ITS', tee: 'TEE', loyer: 'Loyer', bail: 'Bail',
}

/** Les cotisations qu'un compte de Banque reçoit, ou null si ce n'est pas un compte de cotisation. */
export function categoriesDuCompte(compte) {
  if (compte?.nom === COMPTE_COTISATION_SALAIRE) return ['salaire']
  if (compte?.nom === COMPTE_COTISATIONS_AUTRES) return CATEGORIES_COTISATIONS_AUTRES
  return null
}

const estRemiseBanque = c => c && !c.du_id && c.restaurant_id && c.categorie && /^\d{4}-\d{2}/.test(String(c.date || '')) && Number(c.montant) > 0

/**
 * Lignes de charges du résultat (lib/chargesMois.js) pour les remises de Banque :
 * une ligne NÉGATIVE par restaurant, mois de la date et cotisation.
 */
export function lignesResultatCotisations(cotisations = []) {
  const parCle = new Map()
  for (const c of cotisations || []) {
    if (!estRemiseBanque(c)) continue
    const mois = String(c.date).slice(0, 7)
    const cle = `${c.restaurant_id}|${mois}|${c.categorie}`
    if (!parCle.has(cle)) {
      parCle.set(cle, {
        restaurant_id: c.restaurant_id, mois, categorie: c.categorie, montant: 0, source: 'tresorerie',
        libelle: `${LIBELLES_COTISATION[c.categorie] || c.categorie} reçue (remise au RH)`,
      })
    }
    parCle.get(cle).montant -= Math.round(Number(c.montant))
  }
  return [...parCle.values()]
}

/** Total remis dans Banque par un restaurant pour une cotisation, sur un mois ('AAAA-MM' ou 'AAAA-MM-01'). */
export function recuDuMois(cotisations = [], { restaurantId, categorie, mois }) {
  const m = String(mois || '').slice(0, 7)
  return (cotisations || [])
    .filter(c => estRemiseBanque(c) && c.restaurant_id === restaurantId && c.categorie === categorie && String(c.date).slice(0, 7) === m)
    .reduce((s, c) => s + Math.round(Number(c.montant)), 0)
}
