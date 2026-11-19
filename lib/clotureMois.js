// ──────────────────────────────────────────────────────────────────────────────
// Clôture du mois : état d'un mois avant clôture (logique pure, testée sous node).
//
// Un mois se clôture pour tout le groupe, une fois terminé et toutes ses
// journées validées ET vérifiées. Les jours sans point sont listés (fermeture
// possible), jamais bloquants.
// Le verrou lui-même est dans la base : supabase_cloture_mois.sql.
// Tests : lib/clotureMois.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { libelleMois } from './tresorerie.js'

export { libelleMois }

const deux = n => String(n).padStart(2, '0')
const cleMois = mois => String(mois).slice(0, 7)
const jour = date => String(date).slice(0, 10)

// « 2026-10 » est terminé le 19/11/2026 ; « 2026-11 » ne l'est pas encore.
export function moisTermine(mois, aujourdhui) {
  return cleMois(mois) < cleMois(aujourdhui)
}

// Les n derniers mois terminés (« AAAA-MM »), du plus récent au plus ancien.
export function listeMois(aujourdhui, n = 12) {
  const t0 = Number(aujourdhui.slice(0, 4)) * 12 + Number(aujourdhui.slice(5, 7)) - 1
  return Array.from({ length: n }, (_, i) => {
    const t = t0 - i - 1
    return `${Math.floor(t / 12)}-${deux((t % 12) + 1)}`
  })
}

// Pour une requête : date >= debut et date < fin.
export function bornesMois(mois) {
  const t = Number(String(mois).slice(0, 4)) * 12 + Number(String(mois).slice(5, 7))
  return { debut: `${cleMois(mois)}-01`, fin: `${Math.floor(t / 12)}-${deux((t % 12) + 1)}-01` }
}

export function joursDuMois(mois) {
  const cle = cleMois(mois)
  const nb = new Date(Date.UTC(Number(cle.slice(0, 4)), Number(cle.slice(5, 7)), 0)).getUTCDate()
  return Array.from({ length: nb }, (_, i) => `${cle}-${deux(i + 1)}`)
}

const parDateEtNom = (a, b) => a.date.localeCompare(b.date) || a.nom.localeCompare(b.nom)

// points : [{ id, restaurant_id, date, valide, verifie }] ; restaurants : [{ id, nom }].
export function etatMois({ mois, points = [], restaurants = [], aujourdhui }) {
  const cle = cleMois(mois)
  const nomDe = id => restaurants.find(r => r.id === id)?.nom || '?'
  const duMois = (points || []).filter(p => cleMois(p.date) === cle)

  const bloquants = duMois
    .filter(p => !p.valide || !p.verifie)
    .map(p => ({
      restaurantId: p.restaurant_id,
      nom: nomDe(p.restaurant_id),
      date: jour(p.date),
      raison: p.valide ? 'non_verifie' : 'non_valide',
      pointId: p.id,
    }))
    .sort(parDateEtNom)

  const avecPoint = new Set(duMois.map(p => `${p.restaurant_id}|${jour(p.date)}`))
  const jours = joursDuMois(cle)
  const joursVides = (restaurants || [])
    .map(r => ({ restaurantId: r.id, nom: r.nom, dates: jours.filter(j => !avecPoint.has(`${r.id}|${j}`)) }))
    .filter(r => r.dates.length)

  return { bloquants, joursVides, peutCloturer: moisTermine(cle, aujourdhui) && bloquants.length === 0 }
}
