// Écriture d'une ligne de journal comptable (commun aux journaux CA, BQ, OD).
// Montant arrondi au franc ; positif au sens demandé, négatif → l'autre sens,
// zéro → aucune ligne. Renvoie le montant arrondi signé (+ débit, − crédit).
import { COMPTES } from './comptesSyscohada.js'

export const arrondiFranc = v => Math.round(parseFloat(v) || 0)

/**
 * @param {{ journal: string, date: string, piece: string, restaurant: string, lignes: object[] }} ctx
 * @returns {(cle: string, libelle: string, montant: number, sens: 'debit'|'credit') => number}
 */
export function ecrivain({ journal, date, piece, restaurant, lignes }) {
  return function ecrire(cle, libelle, montant, sens) {
    const m = arrondiFranc(montant)
    if (m === 0) return 0
    const c = COMPTES[cle]
    if (!c) throw new Error(`Compte inconnu : ${cle}`)
    const auDebit = (sens === 'debit') === (m > 0)
    lignes.push({
      journal, date, piece, compte: c.compte, intitule: c.intitule, libelle,
      debit: auDebit ? Math.abs(m) : 0, credit: auDebit ? 0 : Math.abs(m), restaurant,
    })
    return sens === 'debit' ? m : -m
  }
}

/** Totaux par journal (CA, BQ, OD) et solde du compte d'attente 471, pour l'onglet de contrôle. */
export function controleParJournal(lignes = []) {
  const parJournal = {}
  let attente = 0
  const compteAttente = COMPTES.attente.compte
  for (const l of lignes || []) {
    const j = parJournal[l.journal] || (parJournal[l.journal] = { lignes: 0, debit: 0, credit: 0, difference: 0 })
    j.lignes += 1; j.debit += l.debit; j.credit += l.credit
    if (l.compte === compteAttente) attente += l.debit - l.credit
  }
  for (const j of Object.values(parJournal)) j.difference = j.debit - j.credit
  return { parJournal, attente }
}
