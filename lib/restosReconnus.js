// ─────────────────────────────────────────────────────────────────────────
//  TÉLÉPHONE RECONNU — le code restaurant n'est demandé qu'une fois
//
//  Après un code restaurant juste, l'appareil mémorise { restaurantId,
//  signature } ; ce restaurant s'ouvre ensuite directement sur « Qui
//  êtes-vous ? ». La signature (FNV-1a de « id|pin ») change avec le code :
//  un code modifié redemande le code sur tous les téléphones.
//  Le PIN restaurant est déjà en clair dans le cache hors ligne : cette
//  empreinte n'abaisse pas le niveau de sécurité. Stockage :
//  lib/restosReconnusStockage.js.
// ─────────────────────────────────────────────────────────────────────────

export function signatureResto(restaurant) {
  const texte = `${restaurant?.id ?? ''}|${String(restaurant?.pin ?? '')}`
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function normaliserReconnus(brut) {
  if (!Array.isArray(brut)) return []
  return brut.filter(r => r && typeof r === 'object' && r.restaurantId && r.signature)
}

export function estReconnu(liste, restaurant) {
  if (!restaurant) return false
  const sig = signatureResto(restaurant)
  return liste.some(r => r.restaurantId === restaurant.id && r.signature === sig)
}

export function ajouterReconnu(liste, restaurant) {
  return [
    ...liste.filter(r => r.restaurantId !== restaurant.id),
    { restaurantId: restaurant.id, signature: signatureResto(restaurant) },
  ]
}

// Un restaurant absent de la liste chargée (hors ligne, cache vide) est
// gardé : on n'oublie que ceux dont on VOIT que le code a changé.
export function nettoyerReconnus(liste, restaurants) {
  return liste.filter(r => {
    const resto = restaurants.find(x => x.id === r.restaurantId)
    return !resto || r.signature === signatureResto(resto)
  })
}

export function trierRestaurants(restaurants, liste) {
  const oui = restaurants.filter(r => estReconnu(liste, r))
  const non = restaurants.filter(r => !estReconnu(liste, r))
  return [...oui, ...non]
}

// Ouverture directe seulement si elle ne cache rien : un seul restaurant
// reconnu, et aucun compte Face ID ailleurs (ex. Administration).
export function ecranDeDepart({ valides, enrolements, verrouille }) {
  if (verrouille || valides.length !== 1) return { ecran: 'accueil' }
  const restaurant = valides[0]
  const ailleurs = enrolements.some(e => (e.restaurantId ?? null) !== restaurant.id)
  return ailleurs ? { ecran: 'accueil' } : { ecran: 'quiEtesVous', restaurant }
}
