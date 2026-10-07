// ──────────────────────────────────────────────────────────────────────────────
// La vraie vente d'un point = la VENTE MACHINE (points.vente_machine).
// La vente théorique (points.vente_total, calculée depuis le stock et les
// shifts) n'est qu'un comparatif : c'est le levier de contrôle, affiché en
// face de la vente machine, jamais compté comme vente.
//
// Un jour sans vente machine saisie (rare : 1 point sur ~200 par mois) retombe
// sur la vente théorique, pour ne pas compter 0 F ce jour-là.
// Tests : lib/venteMachine.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0

/** Vente qui compte pour un point (objectif, classements, rentabilité). */
export function venteRetenue(p) {
  if (!p) return 0
  return n(p.vente_machine) > 0 ? n(p.vente_machine) : n(p.vente_total)
}

/** Vente théorique d'un point (comparatif). */
export function venteTheorique(p) {
  return p ? n(p.vente_total) : 0
}

/** Somme des deux ventes d'une liste de points → { machine, theorique, ecart }. */
export function ventesDouble(points = []) {
  let machine = 0
  let theorique = 0
  for (const p of points) { machine += venteRetenue(p); theorique += venteTheorique(p) }
  return { machine, theorique, ecart: theorique - machine }
}

/** Champs à lire dans `points` pour ces calculs. */
export const CHAMPS_VENTE = 'vente_total, vente_machine'
