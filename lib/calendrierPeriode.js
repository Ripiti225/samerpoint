// ──────────────────────────────────────────────────────────────────────────────
// Choix d'une période au calendrier (components/ChampDate.js → CalendrierPeriode).
//
// Demande du 18/10/2026 : toucher « octobre » ouvre les 12 mois, toucher un mois
// choisit le mois ENTIER (1er → dernier jour) en un seul geste ; toucher
// « 2026 » ouvre les années. Les jours restent cliquables pour une période libre.
//
// Pur : testé par lib/calendrierPeriode.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const deux = n => String(n).padStart(2, '0')

/** Dernier jour (AAAA-MM-JJ) du mois 'AAAA-MM'. */
export function dernierJourMois(mois) {
  const [a, m] = mois.split('-').map(Number)
  return `${mois}-${deux(new Date(Date.UTC(a, m, 0)).getUTCDate())}`
}

/**
 * Le mois 'AAAA-MM' entier, borné par min/maxDate : le mois en cours s'arrête
 * à aujourd'hui quand maxDate vaut aujourd'hui. null si le mois est hors bornes.
 */
export function periodeMois(mois, { minDate, maxDate } = {}) {
  let debut = `${mois}-01`
  let fin = dernierJourMois(mois)
  if (minDate && debut < minDate) debut = minDate
  if (maxDate && fin > maxDate) fin = maxDate
  if (debut > fin) return null
  return { debut, fin }
}

/** Mois 'AAAA-MM' hors bornes (aucun jour choisissable). */
export function moisHorsBornes(mois, { minDate, maxDate } = {}) {
  return periodeMois(mois, { minDate, maxDate }) === null
}

/**
 * Un toucher sur un jour. Premier toucher = début ; second = fin (un jour avant
 * le début devient le nouveau début) ; une période complète repart de zéro.
 */
export function toucherJour({ debut = '', fin = '' } = {}, jour) {
  if (!debut || fin) return { debut: jour, fin: '' }
  if (jour < debut) return { debut: jour, fin: '' }
  return { debut, fin: jour }
}

/** Le mois 'AAAA-MM' quand la période le couvre exactement (bornes comprises), sinon null. */
export function moisDeLaPeriode(debut, fin, bornes = {}) {
  if (!debut || !fin || debut.slice(0, 7) !== fin.slice(0, 7)) return null
  const p = periodeMois(debut.slice(0, 7), bornes)
  return p && p.debut === debut && p.fin === fin ? debut.slice(0, 7) : null
}

/** Les jours de debut à fin inclus (AAAA-MM-JJ), pour colorer la période. */
export function joursEntre(debut, fin) {
  if (!debut || !fin || fin < debut) return debut ? [debut] : []
  const out = []
  const d = new Date(`${debut}T00:00:00Z`)
  const f = new Date(`${fin}T00:00:00Z`)
  while (d <= f && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
