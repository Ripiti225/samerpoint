// ──────────────────────────────────────────────────────────────────────────────
// Bouton « Retour » qui marche toujours.
//
// Sur le web, après un rechargement de page, SessionGuard (app/_layout.tsx)
// ramène l'utilisateur sur son dernier écran avec un historique VIDE :
// router.back() ne fait alors plus rien et l'utilisateur reste bloqué (signalé
// sur la Trésorerie le 01/10/2026). On revient donc à un écran parent connu
// quand il n'y a pas d'écran précédent.
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'

export function retour(repli = '/accueil') {
  if (router.canGoBack()) router.back()
  else router.replace(repli)
}
