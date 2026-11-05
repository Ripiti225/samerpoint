// Enregistre le temps d'attente réel des utilisateurs (table mesures_vitesse).
// Silencieux : une mesure perdue ne doit jamais gêner l'app.
// Ne contient ni nom ni montant : une durée, un écran, le type d'appareil, le rôle et le restaurant.
import { AppState, Platform } from 'react-native'
import { detailsDemarrage, dureeValide, plateformeMesure } from './mesuresVitesse'
import { supabase } from './supabase'

export function enregistrerMesure({ ecran, dureeMs, role, restaurantId, details }) {
  // En arrière-plan, le téléphone met l'app en pause : la durée ne veut plus rien dire.
  if (!dureeValide(dureeMs) || AppState.currentState !== 'active') return
  const nav = typeof navigator !== 'undefined' ? navigator : null
  supabase.from('mesures_vitesse').insert({
    ecran,
    duree_ms: Math.round(dureeMs),
    plateforme: plateformeMesure(Platform.OS, nav?.userAgent),
    connexion: nav?.connection?.effectiveType || null,
    role: role || null,
    restaurant_id: restaurantId || null,
    details: details || null,
  }).then(() => {}, () => {})
}

// Web seulement : temps entre l'ouverture de la page et le premier affichage de l'app.
let demarrageMesure = false
export function mesurerDemarrage({ role, restaurantId }) {
  if (demarrageMesure || Platform.OS !== 'web' || typeof performance === 'undefined') return
  demarrageMesure = true
  enregistrerMesure({
    ecran: 'demarrage', dureeMs: performance.now(), role, restaurantId, details: detailsDemarrage(performance),
  })
}
