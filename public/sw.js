/* =====================================================================
 *  SamerPoint — Service Worker (Web Push uniquement)
 *
 *  Rôle : recevoir les notifications push et les afficher, MÊME quand
 *  l'app (PWA épinglée à l'écran d'accueil) est fermée. Aucune gestion
 *  de cache/fetch ici — on ne veut PAS interférer avec la SPA Expo.
 *
 *  Servi à la racine (dist/sw.js) : le dossier public/ est copié tel
 *  quel dans dist/ au build web. La portée (scope) est donc « / ».
 * ===================================================================== */

// Prend le contrôle immédiatement (pas d'attente de fermeture d'onglet).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// ── Réception d'un push ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_) {
    // Corps non-JSON : on tombe en texte brut.
    payload = { title: 'SamerPoint', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'SamerPoint'
  const options = {
    body: payload.body || '',
    icon: '/notif-icon.png',
    badge: '/notif-icon.png',
    // tag : regroupe/écrase les notifs d'un même sujet plutôt que d'empiler.
    tag: payload.tag || undefined,
    // renotify : re-sonne même si une notif du même tag existe déjà.
    renotify: !!payload.tag,
    data: payload.data || {},
    // vibration légère (Android ; ignoré sur iOS).
    vibrate: [80, 40, 80],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Clic sur la notification → focus/ouvre l'app au bon écran ──────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  // url absolue à ouvrir. On construit depuis `screen` + `params` si fourni,
  // sinon on ouvre la racine (le SessionGuard restaurera la dernière route).
  let target = '/'
  if (data.url) {
    target = data.url
  } else if (data.screen) {
    const qs = data.params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(data.params).filter(([, v]) => v != null)
          )
        ).toString()
      : ''
    target = '/' + data.screen + qs
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      // Si une fenêtre de l'app est déjà ouverte : on la focus et on navigue.
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client && target !== '/') {
            client.navigate(target).catch(() => {})
          }
          return
        }
      }
      // Sinon on ouvre une nouvelle fenêtre.
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
