import AsyncStorage from '@react-native-async-storage/async-storage'

const PREFIX = 'samtrackly_cache_'
const TTL_24H = 24 * 60 * 60 * 1000

async function saveCache(key, data) {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }))
  } catch (e) {
    console.error('offlineCache.save error:', e)
  }
}

async function getCache(key, ttl = TTL_24H) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    // On retourne les données même expirées si offline (mieux que rien)
    if (ttl && (Date.now() - entry.savedAt) > ttl * 3) return null // > 72h : trop vieux
    return entry.data
  } catch {
    return null
  }
}

// ─── Données de référence ─────────────────────────────────────────────────

export async function cacheRestaurants(data) { await saveCache('restaurants', data) }
export async function getCachedRestaurants() { return getCache('restaurants') }

export async function cacheUtilisateurs(restaurantId, data) {
  await saveCache(`utilisateurs_${restaurantId || 'global'}`, data)
}
export async function getCachedUtilisateurs(restaurantId) {
  return getCache(`utilisateurs_${restaurantId || 'global'}`)
}

export async function cacheTravailleurs(restaurantId, data) {
  await saveCache(`travailleurs_${restaurantId}`, data)
}
export async function getCachedTravailleurs(restaurantId) {
  return getCache(`travailleurs_${restaurantId}`)
}

export async function cacheFournisseurs(restaurantId, data) {
  await saveCache(`fournisseurs_${restaurantId}`, data)
}
export async function getCachedFournisseurs(restaurantId) {
  return getCache(`fournisseurs_${restaurantId}`)
}

// ─── Données du point actif ───────────────────────────────────────────────
// Pas de TTL fixe — valides jusqu'au prochain reset de journée

export async function cachePointData(pointId, subKey, data) {
  await saveCache(`point_${pointId}_${subKey}`, data)
}
export async function getCachedPointData(pointId, subKey) {
  return getCache(`point_${pointId}_${subKey}`, null) // null = pas de TTL
}

// Cache du point courant (pour login offline)
export async function cachePoint(restaurantId, date, data) {
  await saveCache(`point_${restaurantId}_${date}`, data)
}
export async function getCachedPoint(restaurantId, date) {
  return getCache(`point_${restaurantId}_${date}`, null)
}
