// ──────────────────────────────────────────────────────────────────────────────
// Filet de sécurité de l'écran Vérification : un point validé dont les
// totaux ne correspondent plus à ses lignes réelles est signalé, au lieu de
// passer en silence. Trois incohérences rencontrées le 15/10/2026 :
//   • vente théorique ≠ somme des ventes des shifts (Maroc 14/10, Yop 18/09) ;
//   • site POS : vente machine ≠ somme des ventes système (Maroc sept.) ;
//   • déductions du gérant enregistrées mais rien de déduit (7E 06/08).
// Tests : lib/coherencePoint.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

import { totalBrouillonGerant } from './brouillonGerant.js'

const n = v => parseFloat(v) || 0
const TOLERANCE = 1 // arrondis des anciens calculs
// Les journées d'avant ont été revues une par une le 15/10/2026 : celles
// laissées telles quelles l'ont été par choix (KMS 13/09, Maroc 14/08,
// brouillons de mai à juillet). On ne les signale plus.
export const DEBUT_CONTROLE_DEDUCTIONS = '2026-10-15'

/**
 * `deductionsEnregistrees` : somme des lignes depenses_gerant_caisse du point
 * (repli quand la colonne depenses_gerant_caisse_total est vide).
 * Renvoie [{ code, message, ecart }] — vide si tout concorde.
 */
export function incoherencesPoint(point, shifts, { deductionsEnregistrees = 0 } = {}) {
  const liste = shifts || []
  if (!point?.valide || liste.length === 0) return []
  const alertes = []

  const somme = liste.reduce((s, x) => s + n(x.vente_shift), 0)
  const ecartVente = n(point.vente_total) - somme
  if (Math.abs(ecartVente) > TOLERANCE) {
    alertes.push({ code: 'vente_shifts', ecart: ecartVente,
      message: 'La vente théorique du point ne correspond pas à la somme des ventes de ses shifts.' })
  }

  const pos = liste.filter(x => x.vente_systeme_pos !== null && x.vente_systeme_pos !== undefined && x.vente_systeme_pos !== '')
  if (pos.length > 0) {
    const ecartMachine = n(point.vente_machine) - pos.reduce((s, x) => s + n(x.vente_systeme_pos), 0)
    if (Math.abs(ecartMachine) > TOLERANCE) {
      alertes.push({ code: 'machine_pos', ecart: ecartMachine,
        message: 'La vente machine ne correspond pas aux ventes système envoyées par le POS.' })
    }
  }

  const brouillon = totalBrouillonGerant(point.draft_gerant)
  const deduit = Math.max(n(point.depenses_gerant_caisse_total), n(deductionsEnregistrees))
  if (brouillon > 0 && deduit === 0 && (point.date || '') >= DEBUT_CONTROLE_DEDUCTIONS) {
    alertes.push({ code: 'deductions_gerant', ecart: brouillon,
      message: 'Des déductions du gérant sont enregistrées, mais aucune n’a été retirée des espèces à la validation.' })
  }
  return alertes
}
