// ──────────────────────────────────────────────────────────────────────────────
// Grille de cartes qui s'adapte à l'écran (Trésorerie → Banque et espèces).
//
// Deux cartes par ligne quand elles tiennent, une seule sinon. (La taille des
// montants, elle, est ajustée par components/ui/TexteAjuste.js.)
// Tests : lib/grilleCartes.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

/** Nombre de colonnes et largeur d'une carte pour une grille de `largeur` px. */
export function colonnesCartes(largeur, { min = 170, ecart = 10, max = 2 } = {}) {
  const l = Number(largeur) || 0
  if (l <= 0) return { colonnes: max, largeurCarte: null }
  let colonnes = max
  while (colonnes > 1 && (l - ecart * (colonnes - 1)) / colonnes < min) colonnes--
  return { colonnes, largeurCarte: (l - ecart * (colonnes - 1)) / colonnes }
}

