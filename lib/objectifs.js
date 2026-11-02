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

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const iso = (a, m, j) => `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`

/**
 * Mois des objectifs du Dashboard global, d'après la période choisie :
 * « Mois préc. » → le mois précédent ; « Période » → le mois de sa date de fin ;
 * sinon le mois en cours. Le mois en cours ne compte que les jours TERMINÉS
 * (jusqu'à hier), comme l'accueil du gérant (choix du 02/11/2026).
 * aujourdhui : 'AAAA-MM-JJ'. Rend { debut, fin, joursMois, joursEcoules, termine, nom }
 * (fin < debut le 1er du mois : aucun jour terminé).
 */
export function moisObjectif({ periodeKey, dateFin, aujourdhui }) {
  const [ya, ma, ja] = String(aujourdhui).split('-').map(Number)
  let a = ya
  let m = ma
  if (periodeKey === 'lastmonth') { m -= 1; if (m === 0) { m = 12; a -= 1 } }
  else if (periodeKey === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(dateFin || '')) [a, m] = dateFin.split('-').map(Number)
  const joursMois = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const enCours = a === ya && m === ma
  const futur = a > ya || (a === ya && m > ma)
  const joursEcoules = enCours ? ja - 1 : futur ? 0 : joursMois
  const fin = joursEcoules > 0 ? iso(a, m, joursEcoules) : new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10)
  return { debut: iso(a, m, 1), fin, joursMois, joursEcoules, termine: !enCours && !futur, nom: NOMS_MOIS[m - 1] }
}

/**
 * Objectif d'un restaurant pour un mois ('AAAA-MM' ou 'AAAA-MM-01') :
 * la ligne de ce mois dans objectifs_restaurants, sinon celle du dernier mois
 * fixé avant (janvier reprend décembre), sinon l'objectif de base
 * (restaurants.objectif_mensuel, d'avant le 02/11/2026). null = aucun objectif.
 */
export function objectifPour(restaurant, lignes = [], mois) {
  const m = String(mois).slice(0, 7)
  const ligne = (lignes || [])
    .filter(l => l.restaurant_id === restaurant?.id && String(l.mois).slice(0, 7) <= m)
    .sort((a, b) => String(b.mois).localeCompare(String(a.mois)))[0]
  const v = ligne ? ligne.montant : restaurant?.objectif_mensuel
  return Number(v) > 0 ? Number(v) : null
}

/** Les restaurants avec objectif_mensuel remplacé par l'objectif du mois (copies). */
export function appliquerObjectifsMois(restaurants = [], lignes = [], mois) {
  return (restaurants || []).map(r => ({ ...r, objectif_mensuel: objectifPour(r, lignes, mois) }))
}
