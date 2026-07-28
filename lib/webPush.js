import { Platform } from 'react-native'
import { supabase } from './supabase'

// =====================================================================
//  Web Push (PWA Safari iOS ≥ 16.4 / Android / desktop).
//
//  Remplace le circuit Expo (`lib/notifications.js`) qui ne marche QUE
//  dans un build natif. Ici l'abonnement se fait dans le navigateur et
//  fonctionne dès que la PWA est épinglée à l'écran d'accueil.
//
//  Clé de routage (cf. topologie « 1 tel par resto ») :
//    • gérant / caissier → l'abonnement porte `restaurant_id` (le tel du resto)
//    • manager / directeur / rh → l'abonnement porte `user_id` (leur tel perso)
//
//  L'Edge Function `send-web-push` fait le ciblage côté serveur en lisant
//  ces deux colonnes ; la clé privée VAPID ne quitte jamais le serveur.
// =====================================================================

// Clé PUBLIQUE VAPID (sans danger côté client). À renseigner dans .env :
//   EXPO_PUBLIC_VAPID_PUBLIC_KEY=BText…
// Générée en même temps que la clé privée (voir doc/web-push-setup.md).
const VAPID_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY || 'BHUS-1mOAVEjaVucRUYo8wynevm2h-5whuwa23FEPOOU5LxoGY9Lmu8PMs97TVClHdX3xP_0lExE1-1aXBcgnjc'

function estWeb() {
  return Platform.OS === 'web' && typeof window !== 'undefined'
}

// Le navigateur peut-il recevoir des push ? (sur iOS : seulement en mode
// « écran d'accueil » — display-mode standalone.)
export function pushSupporte() {
  if (!estWeb()) return false
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// 'default' (jamais demandé) | 'granted' | 'denied' | 'unsupported'
export function etatPermissionPush() {
  if (!pushSupporte()) return 'unsupported'
  return Notification.permission
}

// Sur iOS, l'abonnement n'est possible que si l'app est lancée depuis
// l'écran d'accueil (standalone), pas dans l'onglet Safari.
export function estStandalonePWA() {
  if (!estWeb()) return false
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  )
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function enregistrerServiceWorker() {
  const existante = await navigator.serviceWorker.getRegistration('/')
  if (existante) return existante
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

// Enregistre/actualise l'abonnement en base, clé = endpoint (1 par appareil).
async function sauvegarderAbonnement(sub, { userId, restaurantId, role }) {
  const json = sub.toJSON()
  const keys = json.keys || {}
  const row = {
    endpoint: json.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_id: userId || null,
    restaurant_id: restaurantId || null,
    role: role || null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    updated_at: new Date().toISOString(),
  }
  await supabase.from('web_push_subscriptions').upsert(row, { onConflict: 'endpoint' })
}

// ── Action DÉCLENCHÉE PAR UN BOUTON (geste utilisateur obligatoire iOS) ──
// Demande la permission puis crée l'abonnement. Retourne un statut lisible.
export async function activerNotificationsPush({ userId, restaurantId, role }) {
  if (!pushSupporte()) return 'unsupported'
  if (Platform.OS === 'web' && !estStandalonePWA() && /iP(hone|ad|od)/.test(navigator.userAgent)) {
    // iOS refuse l'abonnement hors écran d'accueil.
    return 'ios-standalone-requis'
  }
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return permission // 'denied' | 'default'

    const reg = await enregistrerServiceWorker()
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    await sauvegarderAbonnement(sub, { userId, restaurantId, role })
    return 'granted'
  } catch (err) {
    console.error('Erreur activation web push:', err)
    return 'erreur'
  }
}

// ── Appelé à CHAQUE connexion (accueil) ────────────────────────────────
// Si la permission est déjà accordée : ré-abonne (idempotent) et surtout
// MET À JOUR le mapping user_id/restaurant_id de cet appareil — crucial sur
// le tel du resto où gérant et caissier alternent sur le même endpoint.
export async function synchroniserWebPush({ userId, restaurantId, role }) {
  if (!pushSupporte()) return
  if (Notification.permission !== 'granted') return
  try {
    const reg = await enregistrerServiceWorker()
    await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    await sauvegarderAbonnement(sub, { userId, restaurantId, role })
  } catch (err) {
    console.error('Erreur sync web push:', err)
  }
}

// Optionnel : désabonner cet appareil (ex. bouton « Désactiver »).
export async function desactiverNotificationsPush() {
  if (!pushSupporte()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg && (await reg.pushManager.getSubscription())
    if (sub) {
      await supabase.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch (_) {}
}
