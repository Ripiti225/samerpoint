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

/**
 * Objectif du mois vu par le gérant, sur l'accueil.
 * ventes : ventes des jours TERMINÉS du mois (aujourd'hui exclu) ;
 * joursEcoules : nombre de ces jours (0 le 1er du mois).
 * Le rythme se calcule sur les jours terminés : compter aujourd'hui, encore
 * vide, ferait croire à un retard tous les matins.
 * Renvoie null sans objectif.
 */
export function objectifDuMois({ ventes, objectif, joursEcoules, joursMois }) {
  const o = Number(objectif) || 0
  if (o <= 0) return null
  const v = Number(ventes) || 0
  const total = Number(joursMois) || 30
  const ecoules = Math.max(0, Math.min(Number(joursEcoules) || 0, total))
  const prog = ecoules > 0 ? progressionObjectif({ ventes: v, objectif: o, jour: ecoules, joursMois: total }) : null
  const reste = Math.max(0, o - v)
  const joursRestants = total - ecoules
  return {
    pct: Math.round((v / o) * 100),
    pctProjete: prog ? prog.pctProjete : null,
    enAvance: prog ? prog.enAvance : null,
    reste,
    joursRestants,
    parJour: reste > 0 ? Math.ceil(reste / Math.max(1, joursRestants)) : 0,
    atteint: v >= o,
  }
}

/**
 * Niveau du rythme (pctProjete) pour la couleur de l'objectif gérant :
 * 'bon' ≥ 100 % (objectif tenu), 'presque' de 90 à 99 %, 'retard' en dessous.
 * null sans rythme (le 1er du mois).
 */
export function niveauRythme(pctProjete) {
  if (pctProjete == null) return null
  return pctProjete >= 100 ? 'bon' : pctProjete >= 90 ? 'presque' : 'retard'
}
