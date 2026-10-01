// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — alertes automatiques. Logique pure.
//
//  - Restaurant déficitaire : résultat net négatif sur le dernier mois TERMINÉ.
//  - CNPS impayée depuis plus de 60 jours après son échéance.
//  - Fond insuffisant : « FC de la veille » du dernier point d'un restaurant
//    sous le plafond réglé pour ce restaurant → il faut rajouter la différence.
//
// Chaque alerte a une clé stable : la notification à M. Zreik ne part qu'une
// fois par clé (vérification après chaque validation de point).
// Tests : lib/alertes.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { joursDeRetard, libelleMois, resteDu } from './tresorerie.js'

export const SEUIL_RETARD_CNPS = 60

const n = v => Number(v) || 0
const fmtF = v => `${Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`

// Mois terminé précédent (AAAA-MM) d'une date ISO.
export function moisTerminePrecedent(aujourdhui) {
  const a = Number(aujourdhui.slice(0, 4))
  const m = Number(aujourdhui.slice(5, 7)) - 1
  const t = a * 12 + m - 1
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

// Dernier point de chaque restaurant : { [restaurant_id]: point }.
export function derniersPoints(points = []) {
  const out = {}
  for (const p of points || []) {
    if (!p.restaurant_id || !p.date) continue
    if (!out[p.restaurant_id] || p.date > out[p.restaurant_id].date) out[p.restaurant_id] = p
  }
  return out
}

/**
 * resultats : { [restaurant_id]: { [AAAA-MM]: { net } } } (lib/direction.js)
 * cnps : dus CNPS ; paiements : paiements de ces dus
 * points : points récents (restaurant_id, date, fc_veille)
 * plafonds : [{ restaurant_id, plafond }]
 * nomResto : id → nom
 */
export function calculerAlertes({
  resultats = {}, cnps = [], paiements = [], points = [], plafonds = [], aujourdhui, nomResto = id => id,
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

  // 2. CNPS en retard de plus de 60 jours.
  const parDu = {}
  for (const p of paiements || []) (parDu[p.du_id] ||= []).push(p)
  for (const du of cnps || []) {
    if (du.categorie !== 'cnps') continue
    const reste = resteDu(du, parDu[du.id])
    const retard = joursDeRetard(du.echeance, aujourdhui)
    if (reste > 0 && retard > SEUIL_RETARD_CNPS) {
      alertes.push({
        cle: `cnps:${du.id}`, type: 'cnps', niveau: 'rouge', restaurant_id: du.restaurant_id,
        titre: `CNPS ${nomResto(du.restaurant_id)} en retard`,
        message: `CNPS ${nomResto(du.restaurant_id)} de ${libelleMois(du.mois).toLowerCase()} impayée depuis ${retard} jours (${fmtF(reste)}).`,
      })
    }
  }

  // 3. Fond sous le plafond.
  const derniers = derniersPoints(points)
  for (const pl of plafonds || []) {
    const p = derniers[pl.restaurant_id]
    const plafond = n(pl.plafond)
    if (!p || !plafond) continue
    const fond = n(p.fc_veille)
    if (fond < plafond) {
      alertes.push({
        cle: `fond:${pl.restaurant_id}:${p.date}`, type: 'fond', niveau: 'orange', restaurant_id: pl.restaurant_id,
        titre: `Fond bas ${nomResto(pl.restaurant_id)}`,
        message: `Fond bas ${nomResto(pl.restaurant_id)} : ${fmtF(fond)} laissés, plafond ${fmtF(plafond)} → rajouter ${fmtF(plafond - fond)}.`,
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
