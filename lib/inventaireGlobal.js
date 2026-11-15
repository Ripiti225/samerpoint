// ──────────────────────────────────────────────────────────────────────────────
// Vérification → Stock : inventaire GLOBAL du jour (somme des shifts) et plats
// qui ont fait sortir un produit. Calcul pur, testé : lib/inventaireGlobal.test.mjs
// Recettes : lib/recettesInventaire.js
// ──────────────────────────────────────────────────────────────────────────────
import { UNITES, recettePour } from './recettesInventaire.js'

const PRECISION = 100
const arrondi = v => Math.round((Number(v) || 0) * PRECISION) / PRECISION
const nombre = v => Number(v) || 0

/**
 * Inventaire du jour, produit par produit, à partir des shifts dans l'ordre
 * chronologique : stock du début = celui du 1er shift où le produit est compté,
 * entrées / sorties / écarts additionnés, stock réel = celui du dernier shift.
 * Seules les lignes comptées (stock_reel renseigné) entrent, comme dans le détail.
 * @param {Array<{ lignes: Array<object> }>} shifts
 * @returns {Array<{ produitId, produitNom, stockInitial, entrees, sorties, stockReel, ecart, nbShifts }>}
 */
export function inventaireGlobal(shifts) {
  const parProduit = new Map()
  for (const shift of shifts || []) {
    for (const l of shift?.lignes || []) {
      if (l.stock_reel === null || l.stock_reel === undefined) continue
      const cle = l.produit_id || l.produit_nom
      const avant = parProduit.get(cle)
      parProduit.set(cle, avant
        ? {
          ...avant,
          entrees: avant.entrees + nombre(l.entrees),
          sorties: avant.sorties + nombre(l.sorties),
          stockReel: nombre(l.stock_reel),
          ecart: avant.ecart + nombre(l.ecart),
          nbShifts: avant.nbShifts + 1,
        }
        : {
          produitId: l.produit_id || null,
          produitNom: l.produit_nom || 'Produit',
          stockInitial: nombre(l.stock_initial),
          entrees: nombre(l.entrees),
          sorties: nombre(l.sorties),
          stockReel: nombre(l.stock_reel),
          ecart: nombre(l.ecart),
          nbShifts: 1,
        })
    }
  }
  return [...parProduit.values()].map(p => ({
    ...p,
    stockInitial: arrondi(p.stockInitial),
    entrees: arrondi(p.entrees),
    sorties: arrondi(p.sorties),
    stockReel: arrondi(p.stockReel),
    ecart: arrondi(p.ecart),
  }))
}

/**
 * Plats vendus de plusieurs services de caisse, additionnés : { nom: quantité }.
 * Les suppléments payants (« Fromage » +1 000 F) ne sont pas des plats.
 * @param {{ [serviceId: string]: Array<{ nom: string, qte: number, supplement?: boolean }> }} parService
 * @param {string[]} serviceIds
 */
export function cumulerVentes(parService, serviceIds) {
  const total = {}
  for (const id of serviceIds || []) {
    for (const v of parService?.[id] || []) {
      if (v.supplement) continue
      total[v.nom] = (total[v.nom] || 0) + nombre(v.qte)
    }
  }
  return total
}

/**
 * Plats qui ont consommé un produit, du plus gros consommateur au plus petit,
 * et l'écart avec la sortie calculée par le POS (KDO, annulation, plat
 * absent de la recette…).
 * @param {string} produitId
 * @param {{ [plat: string]: number }} ventes
 * @param {number} sortiePOS
 */
export function platsDuProduit(produitId, ventes, sortiePOS) {
  const recette = recettePour(produitId)
  const unite = UNITES[produitId] || ''
  if (!recette) return { lignes: [], totalCalcule: 0, ecart: arrondi(sortiePOS), aRecette: false, unite }
  const lignes = Object.entries(ventes || {})
    .filter(([plat, n]) => recette[plat] && nombre(n) > 0)
    .map(([plat, n]) => ({ plat, nombre: nombre(n), parPlat: recette[plat], consomme: arrondi(nombre(n) * recette[plat]) }))
    .sort((a, b) => b.consomme - a.consomme || a.plat.localeCompare(b.plat))
  const totalCalcule = arrondi(lignes.reduce((s, l) => s + l.consomme, 0))
  return { lignes, totalCalcule, ecart: arrondi(nombre(sortiePOS) - totalCalcule), aRecette: true, unite }
}
