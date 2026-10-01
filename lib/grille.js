// ──────────────────────────────────────────────────────────────────────────────
// Grilles de boutons qui remplissent toute la largeur, sur téléphone comme sur
// ordinateur.
//
// Avant : chaque case faisait 47 % de large + un espace fixe en pixels. Sur un
// écran large, il restait une bande vide à droite, et l'accueil gardait deux
// colonnes géantes sur ordinateur. Ici, le nombre de colonnes suit la largeur
// de la fenêtre et la case = (100 % − les espaces) ÷ colonnes.
// ──────────────────────────────────────────────────────────────────────────────
import { Platform, useWindowDimensions } from 'react-native'

export function colonnesPour(largeurFenetre) {
  if (largeurFenetre >= 1100) return 4
  if (largeurFenetre >= 700) return 3
  return 2
}

// Style de largeur d'une case, pour une grille en `flexWrap` avec `gap` donné.
export function useLargeurCase(gap, { maxColonnes = 4 } = {}) {
  const { width } = useWindowDimensions()
  const colonnes = Math.min(maxColonnes, colonnesPour(width))
  if (Platform.OS === 'web') {
    const retrait = (gap * (colonnes - 1)) / colonnes
    return { width: `calc(${100 / colonnes}% - ${retrait}px)` }
  }
  // Mobile natif : deux colonnes, la seconde absorbe l'arrondi.
  return { flexBasis: '45%', flexGrow: 1, maxWidth: `${100 / colonnes}%` }
}
