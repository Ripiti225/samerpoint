// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — historiques. Logique pure.
//
//  - loyers payés : lignes de loyer soldées, filtrées sur le mois consommé ;
//  - dettes remboursées : créanciers et prêts soldés, autres charges passées en
//    Dette puis soldées, charges à échéance payées après leur date limite
//    (vrais paiements : un paiement « avant la trésorerie » n'est pas un retard),
//    filtrées sur la date du remboursement ;
//  - fiche par restaurant : tout ce que le restaurant a dû et payé, mois par mois
//    (mois consommé ; autres charges : mois de leur saisie).
//
// periode : { an: 2026, mois: 9 } ou { an: 2026, mois: null } (toute l'année) ;
// null = tout.
// Tests : lib/historique.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { CATEGORIES_SERIE, joursDeRetard, paiementsParDu, resteDu, totalPaye } from './tresorerie.js'

const n = v => Number(v) || 0

export function dansPeriode(iso, periode) {
  if (!periode) return true
  if (!iso) return false
  if (Number(iso.slice(0, 4)) !== periode.an) return false
  return !periode.mois || Number(iso.slice(5, 7)) === periode.mois
}

export function anneesDisponibles(dates = [], anCourant) {
  const annees = new Set([anCourant])
  for (const d of dates || []) if (d) annees.add(Number(String(d).slice(0, 4)))
  return [...annees].filter(Boolean).sort((a, b) => b - a)
}

// Date du dernier versement d'une ligne.
function dateDuSolde(paiements = []) {
  return (paiements || []).reduce((max, p) => (p.date && p.date > max ? p.date : max), '') || null
}

// Mois de rattachement d'une ligne : mois consommé, sinon mois de saisie.
function moisDe(du) {
  if (du.mois) return du.mois
  const d = du.created_at || du.echeance
  return d ? `${String(d).slice(0, 7)}-01` : null
}

export function loyersPayes(dus = [], paiements = [], periode = null) {
  const parDu = paiementsParDu(paiements)
  return (dus || [])
    .filter(d => d.categorie === 'loyer' && parDu[d.id]?.length && resteDu(d, parDu[d.id]) === 0 && dansPeriode(d.mois, periode))
    .map(d => ({ du: d, paiements: parDu[d.id], soldeLe: dateDuSolde(parDu[d.id]) }))
    .sort((a, b) => (b.du.mois || '').localeCompare(a.du.mois || '') || (a.du.restaurant_id || '').localeCompare(b.du.restaurant_id || ''))
}

export function dettesRemboursees(dus = [], paiements = [], periode = null) {
  const parDu = paiementsParDu(paiements)
  const out = []
  for (const d of dus || []) {
    const p = parDu[d.id] || []
    if (!p.length || resteDu(d, p) > 0) continue
    const vrais = p.filter(x => x.source !== 'avant')
    const soldeLe = dateDuSolde(p)
    const enRetard = CATEGORIES_SERIE.includes(d.categorie) && d.echeance && vrais.some(x => x.date > d.echeance)
    if (d.categorie !== 'dette' && !d.en_dette_depuis && !enRetard) continue
    if (!dansPeriode(soldeLe, periode)) continue
    out.push({ du: d, paiements: p, soldeLe, retard: enRetard ? joursDeRetard(d.echeance, soldeLe) : 0 })
  }
  return out.sort((a, b) => (b.soldeLe || '').localeCompare(a.soldeLe || ''))
}

// Ordre d'affichage : charges en série (loyer, salaires…), puis le reste.
const rang = c => (CATEGORIES_SERIE.includes(c) ? CATEGORIES_SERIE.indexOf(c) : 99)

// [{ mois, du, paye, reste, lignes: [{ du, paye, reste }] }], le plus récent d'abord.
export function historiqueRestaurant(dus = [], paiements = [], restaurantId, { periode = null, categories = null } = {}) {
  const parDu = paiementsParDu(paiements)
  const parMois = {}
  for (const d of dus || []) {
    if (d.restaurant_id !== restaurantId) continue
    if (categories && !categories.includes(d.categorie)) continue
    const mois = moisDe(d)
    if (!mois || !dansPeriode(mois, periode)) continue
    const paye = totalPaye(parDu[d.id])
    const ligne = { du: d, paye, reste: resteDu(d, parDu[d.id]) }
    ;(parMois[mois] ||= []).push(ligne)
  }
  return Object.entries(parMois)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mois, lignes]) => ({
      mois,
      du: lignes.reduce((s, l) => s + n(l.du.montant_du), 0),
      paye: lignes.reduce((s, l) => s + l.paye, 0),
      reste: lignes.reduce((s, l) => s + l.reste, 0),
      lignes: lignes.sort((a, b) => rang(a.du.categorie) - rang(b.du.categorie)),
    }))
}
