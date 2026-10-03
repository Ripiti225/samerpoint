// ──────────────────────────────────────────────────────────────────────────────
// Objectif de chiffre d'affaires mensuel d'un restaurant (restaurants.objectif_mensuel) :
// où il en est, et où il finira le mois au rythme actuel.
// Saisi depuis le Dashboard global, lu aussi par Rapports → Mensuel.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ventes : ventes du mois à ce jour ; jour : jour du mois (1–31) ;
 * joursMois : nombre de jours du mois.
 * Renvoie null sans objectif.
 */
export function progressionObjectif({ ventes, objectif, jour, joursMois }) {
  const o = Number(objectif) || 0
  if (o <= 0) return null
  const v = Number(ventes) || 0
  const j = Math.max(1, Math.min(Number(jour) || 1, Number(joursMois) || 30))
  const projection = Math.round((v / j) * (Number(joursMois) || 30))
  return {
    pct: Math.round((v / o) * 100),
    projection,
    pctProjete: Math.round((projection / o) * 100),
    // En avance si, au rythme actuel, l'objectif est atteint à la fin du mois.
    enAvance: projection >= o,
  }
}

/** Variation en % de b vers a (null si b vaut 0 : pas de base de comparaison). */
export function variation(a, b) {
  const x = Number(a) || 0
  const y = Number(b) || 0
  if (!y) return null
  return Math.round(((x - y) / Math.abs(y)) * 100)
}
