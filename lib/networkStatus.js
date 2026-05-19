// État réseau partagé — module-level pour éviter les dépendances circulaires
// NetworkContext écrit ici, lib/api.js lit ici
let _isOnline = true

export function setOnlineStatus(online) {
  _isOnline = online
}

export function isOnlineNow() {
  return _isOnline
}
