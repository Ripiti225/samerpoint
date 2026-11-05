// Ce qu'on garde d'une mesure de vitesse réelle. Sans dépendance : testable seul.
// L'écriture en base est dans lib/mesuresVitesseDb.js.

// Au-delà, l'app est restée en arrière-plan : ce n'est plus une attente.
const DUREE_MAX_MS = 5 * 60 * 1000

export function dureeValide(ms) {
  return Number.isFinite(ms) && ms >= 0 && ms <= DUREE_MAX_MS
}

export function plateformeMesure(os, userAgent = '') {
  if (os !== 'web') return `app-${os}`
  if (/iPhone|iPad/.test(userAgent)) return 'web-iphone'
  if (/Android/.test(userAgent)) return 'web-android'
  return 'web-autre'
}

// Détail du démarrage web : page, puis code principal. code_octets proche de 0 = servi par le cache.
export function detailsDemarrage(perf) {
  if (!perf?.getEntriesByType) return {}
  const details = {}
  const page = perf.getEntriesByType('navigation')[0]
  if (page) details.document_ms = Math.round(page.responseEnd)
  const code = perf.getEntriesByType('resource').find(r => r.name.includes('/_expo/static/js/web/entry-'))
  if (code) {
    details.code_ms = Math.round(code.duration)
    details.code_octets = code.transferSize
  }
  return details
}
