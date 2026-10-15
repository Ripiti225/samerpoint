// ──────────────────────────────────────────────────────────────────────────────
// Le récap du point est-il encore à jour au moment de valider ?
//
// Le récap lit les shifts à l'ouverture de l'écran. Sur un site POS, un shift
// arrive tout seul quand la caissière clôture son service : si le gérant
// valide juste après, les totaux écrits dans `points` oublient ce shift.
// Constaté à Samer Maroc le 14/10/2026 : shift de 158 300 arrivé à 00:10:02,
// point validé à 00:10:12 avec une vente théorique de 109 500 au lieu de
// 267 800.
//
// On compare donc la liste affichée à celle de la base juste avant d'écrire.
// Tests : lib/shiftsAJour.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const CHAMPS = ['vente_shift', 'vente_systeme_pos', 'espece', 'depenses', 'fournisseurs',
  'kdo', 'retour', 'yango_cse', 'glovo_cse', 'wave', 'om', 'djamo']

const signature = shifts => (shifts || [])
  .map(s => [s.id, ...CHAMPS.map(c => Number(s[c]) || 0)].join(':'))
  .sort()
  .join('|')

/** Vrai si les shifts en base ne sont plus ceux affichés (ajout, retrait ou montant modifié). */
export function shiftsOntChange(affiches, enBase) {
  return signature(affiches) !== signature(enBase)
}
