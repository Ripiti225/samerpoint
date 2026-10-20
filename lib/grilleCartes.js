// ──────────────────────────────────────────────────────────────────────────────
// Grille de cartes qui s'adapte à l'écran (Trésorerie → Banque et espèces).
//
// Deux cartes par ligne quand elles tiennent, une seule sinon. La taille du
// texte est calculée ici : sur le web (iPhone épinglé), `adjustsFontSizeToFit`
// ne fait rien et un grand solde serait coupé par des « … ».
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

/** Taille de police pour que `texte` tienne sur `largeurDispo` px (≈ 0,6 em par caractère en gras). */
export function tailleQuiTient(texte, largeurDispo, { max, min }) {
  const nb = String(texte || '').length
  if (!largeurDispo || !nb) return max
  return Math.max(min, Math.min(max, Math.floor(largeurDispo / (nb * 0.6))))
}
