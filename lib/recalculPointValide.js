// ──────────────────────────────────────────────────────────────────────────────
// Corriger un point DÉJÀ VALIDÉ sans casser ses totaux ni le fond de caisse.
//
// Dans « Modifier le point », corriger, supprimer ou restaurer un shift ne
// recalculait que `vente_total` : espèces, encaissements, dépenses, bénéfice
// et fond restaient sur l'ancien chiffre (Angré 7E, 17-18/08 : 25 250
// d'espèces jamais entrées dans le fond). Corriger les ventes ou les
// déductions du gérant changeait le fond du jour, mais pas celui des jours
// suivants, qui partaient de l'ancien.
//
// Même principe que lib/deplacementShift.js : on corrige PAR DIFFÉRENCE (le
// point porte aussi des saisies du gérant que les shifts ne connaissent pas),
// et seulement les points validés — un point non validé se recalcule
// entièrement depuis ses shifts à sa validation.
// `vente_total` n'est pas touché ici : l'appelant le recalcule en entier
// depuis les shifts (somme des vente_shift).
// Tests : lib/recalculPointValide.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

import { impactShift } from './deplacementShift.js'

const n = v => parseFloat(v) || 0

const CHAMPS = ['depense_total', 'kdo', 'points_fidelite', 'retour', 'yango_cse', 'glovo_cse', 'wave', 'om', 'djamo',
  'reste_especes', 'benefice_sc']

function ecart(changements) {
  const d = Object.fromEntries(CHAMPS.map(c => [c, 0]))
  for (const { avant, apres } of changements || []) {
    const a = avant ? impactShift(avant) : {}
    const b = apres ? impactShift(apres) : {}
    for (const c of CHAMPS) d[c] += n(b[c]) - n(a[c])
  }
  return d
}

/**
 * Le fond d'un point validé a bougé de `delta` : chaque jour validé suivant
 * part d'un fond de la veille décalé d'autant, et laisse un fond décalé
 * d'autant. Renvoie [{ id, maj }] à écrire dans `points`.
 */
export function majReportFond({ pointId, delta, points }) {
  const d = n(delta)
  const p = (points || []).find(x => x.id === pointId)
  if (!d || !p || !p.valide) return []
  return (points || [])
    .filter(x => x.valide && x.date > p.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(x => ({ id: x.id, maj: { fc_veille: n(x.fc_veille) + d, reste_fc: n(x.reste_fc) + d } }))
}

/**
 * Shifts d'un point validé changés : `changements` = [{ avant, apres }]
 * (avant = null pour un shift ajouté ou restauré, apres = null pour un shift
 * supprimé). Renvoie [{ id, maj }] : le point lui-même, puis le fond des
 * jours validés suivants.
 */
export function majPointsApresShifts({ pointId, changements, points }) {
  const p = (points || []).find(x => x.id === pointId)
  if (!p || !p.valide) return []
  const d = ecart(changements)
  const maj = {}
  for (const c of CHAMPS) if (d[c] !== 0) maj[c] = n(p[c]) + d[c]
  if (d.reste_especes !== 0) maj.reste_fc = n(p.reste_fc) + d.reste_especes
  const majs = Object.keys(maj).length > 0 ? [{ id: p.id, maj }] : []
  return [...majs, ...majReportFond({ pointId, delta: d.reste_especes, points })]
}
