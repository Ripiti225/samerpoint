// « Dépenses + Salaires » d'un shift caissier, quel que soit le chemin qui
// l'a écrit.
//
// La colonne `points_shifts.depenses` n'a pas le même sens partout :
//   - saisie caissier (point-shift)  → catégories + paies + fournisseurs
//   - pont POS (samtrackly-shift.ts) → achats seuls, la paie part en présences
//   - correction manager             → catégories seules
// Lire `depenses` telle quelle oublie donc les salaires sur tous les sites POS.
//
// La vente du shift, elle, les contient toujours : c'est ce que le caissier a
// sorti de la caisse plus ce qu'il a encaissé. On retranche les encaissements
// et les fournisseurs, il reste les dépenses et les salaires — exactement le
// montant qui est entré dans le calcul de la vente.

const n = v => parseFloat(v) || 0

const ENCAISSEMENTS = ['kdo', 'points_fidelite', 'retour', 'yango_cse', 'glovo_cse', 'wave', 'djamo', 'om', 'espece']

export function depensesSalairesShift(shift) {
  if (shift?.vente_shift == null || shift.vente_shift === '') return n(shift?.depenses)
  const encaisse = ENCAISSEMENTS.reduce((somme, cle) => somme + n(shift[cle]), 0)
  return n(shift.vente_shift) - encaisse - n(shift.fournisseurs)
}

export function totalDepensesShifts(shifts) {
  const liste = shifts || []
  const depensesSalaires = liste.reduce((somme, s) => somme + depensesSalairesShift(s), 0)
  const fournisseurs = liste.reduce((somme, s) => somme + n(s.fournisseurs), 0)
  return { depensesSalaires, fournisseurs, total: depensesSalaires + fournisseurs }
}
