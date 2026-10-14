// Déplacer un shift d'un point à un autre (Modifier le point → « Déplacer ce
// shift »), typiquement un shift de nuit ouvert avant minuit et rangé la veille.
//
// Le shift emporte TOUT ce qu'il a fait entrer dans le point, pas seulement sa
// vente : encaissements, dépenses + salaires, et donc ses espèces. Avant ce
// module seul vente_total suivait : le 10/10 de Yop (shift d'AMARA) affichait
// 33 886 de reste espèces au lieu de 153 386, et le 09/10 gardait 119 500
// d'espèces qui n'étaient plus à lui.
//
// Seuls les points VALIDÉS sont corrigés ici, par différence (le point peut
// porter des saisies du gérant que les shifts ne connaissent pas). Un point
// non validé se recalcule entièrement depuis ses shifts à la validation.
//
// Le fond de caisse : le point source perd les espèces du shift, le point
// cible les gagne. Les jours validés entre les deux reportent cet écart
// (fc_veille et reste_fc) ; à partir du plus tardif des deux, il s'annule —
// le fond de fin et les jours suivants ne bougent pas.

import { depensesSalairesShift } from './depensesShift.js'
import { COEFFICIENTS } from './constants.js'

const n = v => parseFloat(v) || 0

const ENCAISSEMENTS = ['kdo', 'retour', 'yango_cse', 'glovo_cse', 'wave', 'om', 'djamo']

export function impactShift(shift) {
  const impact = { vente_total: n(shift.vente_shift) }
  for (const cle of ENCAISSEMENTS) impact[cle] = n(shift[cle])
  impact.depense_total = depensesSalairesShift(shift) + n(shift.fournisseurs)
  impact.reste_especes = impact.vente_total - impact.depense_total
    - ENCAISSEMENTS.reduce((somme, cle) => somme + impact[cle], 0)
  impact.benefice_sc = impact.reste_especes
    + impact.wave * COEFFICIENTS.WAVE
    + impact.om * COEFFICIENTS.OM
    + impact.djamo * COEFFICIENTS.DJAMO
  return impact
}

// `points` : les points du restaurant, au moins de la plus ancienne à la plus
// récente des deux dates (les autres sont ignorés). Renvoie [{ id, maj }] à
// écrire dans `points`, uniquement pour les points validés qui changent.
export function majPointsDeplacement({ shift, sourceId, cibleId, points }) {
  const impact = impactShift(shift)
  const liste = [...(points || [])].sort((a, b) => a.date.localeCompare(b.date))
  const source = liste.find(p => p.id === sourceId)
  const cible = liste.find(p => p.id === cibleId)
  if (!source || !cible) return []
  const debut = source.date < cible.date ? source.date : cible.date
  const fin = source.date < cible.date ? cible.date : source.date

  const majs = []
  let report = 0 // écart de fond hérité du dernier point validé
  for (const p of liste) {
    if (p.date < debut || p.date > fin || !p.valide) continue
    const signe = p.id === sourceId ? -1 : p.id === cibleId ? 1 : 0
    const maj = {}
    if (signe !== 0) {
      for (const cle of ['vente_total', 'depense_total', ...ENCAISSEMENTS, 'reste_especes']) {
        maj[cle] = n(p[cle]) + signe * impact[cle]
      }
    }
    if (report !== 0) maj.fc_veille = n(p.fc_veille) + report
    report += signe * impact.reste_especes
    if (report !== 0 || signe !== 0) {
      // reste_fc = reste_especes + fc_veille (+ fonds reçus) : il suit les deux.
      maj.reste_fc = n(p.reste_fc) + report
    }
    if (signe !== 0) maj.benefice_sc = n(p.benefice_sc) + signe * impact.benefice_sc
    if (Object.keys(maj).length > 0) majs.push({ id: p.id, maj })
  }
  return majs
}
