// ──────────────────────────────────────────────────────────────────────────────
// Fond donné par la Trésorerie → « FC reçu » du point d'un restaurant. Logique pure.
//
// Un fond en espèces donné au restaurant (Dépenses direction, « Fond », passe
// par le point) s'ajoute ; un fond en nature n'y entre pas (charge du résultat) ;
// une entrée d'espèces venant du restaurant (Banque et espèces) se déduit. Une
// ligne compte dans le point de sa date ; si ce point est déjà validé, dans le
// prochain point ouvert. À la validation, elle est rattachée au point
// (point_id) et ne compte plus jamais ailleurs.
//
// La case du gérant est remplie automatiquement et bloquée.
// Tests : lib/fondTresorerie.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0

// fonds / reprises : [{ id, date, montant (positif), point_id }]
export function fondPourPoint({ pointId, datePoint, fonds = [], reprises = [] }) {
  const pour = l => (!l.point_id || l.point_id === pointId) && l.date && l.date <= datePoint
  const lignes = [
    ...(fonds || []).filter(pour).map(l => ({ id: l.id, type: 'fond', date: l.date, montant: n(l.montant) })),
    ...(reprises || []).filter(pour).map(l => ({ id: l.id, type: 'reprise', date: l.date, montant: -n(l.montant) })),
  ]
  return { montant: lignes.reduce((s, l) => s + l.montant, 0), lignes }
}
