export const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000

export function estInactif(derniereInteraction, maintenant = Date.now()) {
  return maintenant - derniereInteraction >= INACTIVITY_TIMEOUT_MS
}

export function destinationApresDeverrouillage(lastRoute) {
  if (!lastRoute || lastRoute === 'login' || lastRoute === 'index') return null
  return `/${lastRoute}`
}
