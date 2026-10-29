// ──────────────────────────────────────────────────────────────────────────────
// Bénéfice sans charges (BSC) corrigé des écarts annulés (décision du 29/10/2026).
//
// Le BSC enregistré (points.benefice_sc) est calculé à la validation avec les
// espèces TAPÉES. Un caissier qui tape 12 020 au lieu de 120 200 fait perdre
// 108 180 au BSC. Quand le manager annule l'écart (« 🚫 Annuler » dans
// Vérification ou Litiges), le fond reçoit +108 180 : le BSC doit suivre.
//
// La correction se lit dans points.ecart_regularisations, rangées sur le JOUR
// DE L'ERREUR (le fond, lui, est corrigé sur la dernière journée validée).
// Même sens que le fond : manquant annulé → +montant ; surplus → −montant.
// « ✔️ Justifier » (sans_fond) : aucun argent n'a bougé → rien.
//
// On ne réécrit JAMAIS benefice_sc : « Modifier le point » le recalcule et
// effacerait la correction, et supprimer une régularisation dans Litiges
// doit la retirer d'elle-même. benefice_sc reste la valeur brute, à lire telle
// quelle quand on la réécrit (modifier-point, correction-point, corbeille…).
// Tests : lib/beneficeCorrige.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0

/** Somme signée des écarts annulés avec correction du fond. */
export function correctionAnnulations(regularisations) {
  if (!Array.isArray(regularisations)) return 0
  return regularisations.reduce((s, r) => {
    if (!r || r.sans_fond) return s
    const montant = Math.round(n(r.montant))
    return s + (r.sens === 'manquant' ? montant : r.sens === 'surplus' ? -montant : 0)
  }, 0)
}

/** BSC d'un point, écarts annulés compris. */
export function beneficeSC(p) {
  if (!p) return 0
  return n(p.benefice_sc) + correctionAnnulations(p.ecart_regularisations)
}

/** Copie des points avec benefice_sc corrigé — pour les écrans qui ne font que lire. */
export function avecBeneficeCorrige(points) {
  return (points || []).map(p => (p ? { ...p, benefice_sc: beneficeSC(p) } : p))
}

/** Champ à ajouter aux lectures de `points` pour ces calculs. */
export const CHAMP_REGULARISATIONS = 'ecart_regularisations'
