// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — alertes automatiques. Logique pure.
//
//  - Restaurant déficitaire : résultat net négatif sur le dernier mois TERMINÉ.
//  - Fond insuffisant : fond laissé par le dernier point VALIDÉ d'un restaurant
//    (ce qu'il passe au lendemain : reste FC + ajustement du fond, la même somme
//    que le « FC de la veille » du point suivant) sous le plafond réglé pour ce
//    restaurant → il faut rajouter la différence. Le point du jour, encore vide
//    tant qu'il n'est pas validé, n'est jamais lu (il donnait « 0 F laissés »).
//
// L'alerte « CNPS impayée depuis plus de 60 jours » a disparu le 12/10/2026 :
// la CNPS est devenue un fournisseur administratif (lib/fournisseursAdmin.js).
//
// Chaque alerte a une clé stable : la notification à M. Zreik ne part qu'une
// fois par clé (vérification après chaque validation de point).
// Tests : lib/alertes.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { libelleMois } from './tresorerie.js'

const n = v => Number(v) || 0
const fmtF = v => `${Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`

// Mois terminé précédent (AAAA-MM) d'une date ISO.
export function moisTerminePrecedent(aujourdhui) {
  const a = Number(aujourdhui.slice(0, 4))
  const m = Number(aujourdhui.slice(5, 7)) - 1
  const t = a * 12 + m - 1
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

// Dernier point validé de chaque restaurant : { [restaurant_id]: point }.
export function derniersPoints(points = []) {
  const out = {}
  for (const p of points || []) {
    if (!p.restaurant_id || !p.date || !p.valide) continue
    if (!out[p.restaurant_id] || p.date > out[p.restaurant_id].date) out[p.restaurant_id] = p
  }
  return out
}

// Fond que le point laisse au lendemain (app/ventes.js : FC de la veille).
export function fondLaisse(point) {
  return n(point?.reste_fc) + n(point?.ajustement_fond)
}

/**
 * resultats : { [restaurant_id]: { [AAAA-MM]: { net } } } (lib/direction.js)
 * points : points récents (restaurant_id, date, valide, reste_fc, ajustement_fond)
 * plafonds : [{ restaurant_id, plafond }]
 * nomResto : id → nom
 */
export function calculerAlertes({
  resultats = {}, points = [], plafonds = [], aujourdhui, nomResto = id => id,
}) {
  const alertes = []

  // 1. Déficit sur le dernier mois terminé.
  const mois = moisTerminePrecedent(aujourdhui)
  for (const [resto, parMois] of Object.entries(resultats || {})) {
    const c = parMois?.[mois]
    if (c && c.net < 0) {
      alertes.push({
        cle: `deficit:${resto}:${mois}`, type: 'deficit', niveau: 'rouge', restaurant_id: resto,
        titre: `${nomResto(resto)} déficitaire`,
        message: `${nomResto(resto)} est déficitaire en ${libelleMois(`${mois}-01`).toLowerCase()} : ${fmtF(c.net)} après charges.`,
      })
    }
  }

  // 2. Fond sous le plafond.
  const derniers = derniersPoints(points)
  for (const pl of plafonds || []) {
    const p = derniers[pl.restaurant_id]
    const plafond = n(pl.plafond)
    if (!p || !plafond) continue
    const fond = fondLaisse(p)
    if (fond < plafond) {
      alertes.push({
        cle: `fond:${pl.restaurant_id}:${p.date}`, type: 'fond', niveau: 'orange', restaurant_id: pl.restaurant_id, fond,
        titre: `Fond bas ${nomResto(pl.restaurant_id)}`,
        message: `Fond bas ${nomResto(pl.restaurant_id)} : fond de la veille ${fmtF(fond)}, plafond ${fmtF(plafond)} → rajouter ${fmtF(plafond - fond)}.`,
      })
    }
  }

  return alertes
}

// Alertes pas encore notifiées.
export function alertesNouvelles(alertes = [], clesEnvoyees = []) {
  const deja = new Set(clesEnvoyees)
  return alertes.filter(a => !deja.has(a.cle))
}
