// ──────────────────────────────────────────────────────────────────────────────
// Miniature d'une photo du stockage Supabase, pour les vignettes des listes.
// Les photos sont stockées en taille réelle (souvent 3060×4080) : en afficher
// une centaine en vignettes saturait la mémoire de l'iPhone et Safari plantait
// en boucle (« Un problème récurrent est survenu », page Contrats, 15/10/2026).
// Supabase redimensionne côté serveur : /object/public/ → /render/image/public/.
// Toute autre adresse (fichier local, blob, autre site) est rendue telle quelle.
// ──────────────────────────────────────────────────────────────────────────────
const OBJET = '/storage/v1/object/public/'
const RENDU = '/storage/v1/render/image/public/'

/** url : adresse de la photo · taille : côté affiché en points (×3 pour les écrans Retina). */
export function miniature(url, taille = 44) {
  if (typeof url !== 'string' || !url.includes(OBJET)) return url
  const cote = Math.min(Math.round(taille * 3), 1000)
  const sep = url.includes('?') ? '&' : '?'
  return `${url.replace(OBJET, RENDU)}${sep}width=${cote}&height=${cote}&resize=cover`
}

// Vignettes de PhotoJustificatif (`compact`) : miniature par défaut. Crédits
// fournisseurs affichait jusqu'à ~730 factures d'un mois en taille réelle et
// Safari plantait (19/10/2026). `repli` : la miniature a échoué, on retente
// avec la photo normale plutôt que d'afficher « indisponible ».
export const TAILLE_VIGNETTE = 80

export function sourceVignette(uri, { compact = false, repli = false } = {}) {
  return compact && !repli ? miniature(uri, TAILLE_VIGNETTE) : uri
}
