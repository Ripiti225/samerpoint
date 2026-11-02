// ──────────────────────────────────────────────────────────────────────────────
// Rapport mensuel — présentation (logique pure) : la couleur propre à chaque
// restaurant et le résultat net, identique à Trésorerie → Résultat net.
// Tests : lib/rapportPresentation.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

// Huit couleurs bien distinctes (hexa sans '#', format pptxgenjs).
export const PALETTE_RESTAURANTS = ['E8590C', '1971C2', '2B8A3E', 'AE3EC9', '0C8599', 'C2255C', 'F59F00', '3B5BDB']

const cle = r => String(r?.nom || '').trim().toLocaleLowerCase('fr')

/**
 * { id: 'RRGGBB' } : une couleur par restaurant, dans l'ordre alphabétique des
 * noms, pour qu'un restaurant garde sa couleur d'un mois à l'autre.
 */
export function couleursRestaurants(restaurants = []) {
  const tries = [...(restaurants || [])].sort((a, b) => cle(a).localeCompare(cle(b), 'fr'))
  return Object.fromEntries(tries.map((r, i) => [r.id, PALETTE_RESTAURANTS[i % PALETTE_RESTAURANTS.length]]))
}

/** 'RRGGBB' → [r, g, b] (jsPDF). */
export function rgb(hex) {
  const h = String(hex || '').replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0)
}

/** Teinte très claire d'une couleur (fonds de tuiles) : mélange avec du blanc. */
export function eclaircir(hex, part = 0.88) {
  return rgb(hex).map(c => Math.round(c + (255 - c) * part).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Résultat net du groupe ({ valeur, prec }) tel que Trésorerie l'affiche, ou null. */
export function resultatNetGroupe(rapport) {
  const t = rapport?.analyse?.totaux
  if (!t || t.netGroupe == null) return null
  return { valeur: t.netGroupe, prec: t.netGroupePrec ?? null, arrieres: t.arrieresGroupe || 0 }
}

/** Résultat net d'un restaurant ({ valeur, prec }) d'après l'analyse, ou null. */
export function resultatNetResto(rapport, restaurantId) {
  const l = (rapport?.analyse?.lignes || []).find(x => x.id === restaurantId)
  if (!l || l.net == null) return null
  return { valeur: l.net, prec: l.netPrec ?? null }
}
