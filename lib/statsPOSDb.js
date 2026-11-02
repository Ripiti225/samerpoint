// ──────────────────────────────────────────────────────────────────────────────
// Lecture des statistiques du POS (projet Supabase « pos-samer-cloud », séparé
// de Samtrackly) via la fonction `stats_dashboard` (pos_cloud_stats_dashboard.sql).
//
// Seuls des totaux transitent : la fonction ne renvoie ni commande, ni client.
// La clé est la clé PUBLIQUE du POS (la même que dans l'application de caisse).
// Mise en forme : lib/statsPOS.js
// ──────────────────────────────────────────────────────────────────────────────

const POS_URL = process.env.EXPO_PUBLIC_POS_SUPABASE_URL || 'https://vbsmxwlxlcgkodwkbhfa.supabase.co'
const POS_CLE = process.env.EXPO_PUBLIC_POS_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZic214d2x4bGNna29kd2tiaGZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNDY0NDMsImV4cCI6MjA5ODgyMjQ0M30.fVh70nuAYEOUABDqvs6xPlAmdsB5v8zqSLEuBVJNlxc'

// La fonction n'est pas encore installée dans le cloud POS.
export const POS_NON_INSTALLE = 'non_installe'

async function appelerPOS(fonction, corps) {
  const res = await fetch(`${POS_URL}/rest/v1/rpc/${fonction}`, {
    method: 'POST',
    headers: { apikey: POS_CLE, Authorization: `Bearer ${POS_CLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  })
  if (res.status === 404) return { erreur: POS_NON_INSTALLE }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    if (json?.code === 'PGRST202') return { erreur: POS_NON_INSTALLE }
    if (json?.code === '57014') {
      return { erreur: 'Le POS met trop de temps à calculer. Repassez la dernière version de pos_cloud_stats_dashboard.sql dans le projet pos-samer-cloud.' }
    }
    return { erreur: json?.message || `Erreur ${res.status}` }
  }
  return { donnees: json }
}

/**
 * Commandes payées et montant par service de caisse (shift d'un caissier) :
 * { [serviceId]: { nb, ca } }. Sert au ticket moyen de la note des caissiers.
 * Renvoie {} si la fonction n'est pas encore installée (le bonus reste neutre).
 */
export async function chargerVentesParService({ debut, fin }) {
  try {
    const r = await appelerPOS('stats_services', { p_debut: debut, p_fin: fin })
    if (r.erreur) return { parService: {}, erreur: r.erreur }
    return { parService: Object.fromEntries((r.donnees || []).map(x => [x.s, { nb: Number(x.nb) || 0, ca: Number(x.ca) || 0, caissierPos: x.u || null }])) }
  } catch (e) {
    return { parService: {}, erreur: e?.message || 'POS injoignable' }
  }
}

/**
 * Commandes offertes (KDO) de plusieurs services de caisse, avec produits et
 * motif (pos_cloud_kdo_services.sql). Mise en forme : lib/kdoPOS.js.
 * Renvoie { lignes } ou { lignes: [], erreur } (POS_NON_INSTALLE si absente).
 */
export async function chargerKdoServices(serviceIds) {
  const ids = [...new Set((serviceIds || []).filter(Boolean))]
  if (ids.length === 0) return { lignes: [] }
  try {
    const r = await appelerPOS('kdo_services', { p_services: ids })
    if (r.erreur) return { lignes: [], erreur: r.erreur }
    return { lignes: r.donnees || [] }
  } catch (e) {
    return { lignes: [], erreur: e?.message || 'POS injoignable' }
  }
}

/**
 * Tous les plats actifs de la carte avec leurs ventes de la période (0 si
 * rien), les moins vendus d'abord (pos_cloud_stats_plats.sql) :
 * { plats: [{ nom, categorie, prix, qte, ca }] } ou { plats: null, erreur }.
 */
export async function chargerPlatsPOS({ debut, fin, restaurantId = null }) {
  try {
    const r = await appelerPOS('stats_plats', { p_debut: debut, p_fin: fin, p_restaurant: restaurantId })
    if (r.erreur) return { plats: null, erreur: r.erreur }
    return { plats: (r.donnees || []).map(x => ({ nom: x.nom, categorie: x.categorie || '', prix: Number(x.prix) || 0, qte: Number(x.qte) || 0, ca: Number(x.ca) || 0 })) }
  } catch (e) {
    return { plats: null, erreur: e?.message || 'POS injoignable' }
  }
}

/**
 * Statistiques du POS sur une période (dates AAAA-MM-JJ, journées de 6 h à 6 h).
 * restaurantId : id Samtrackly, ou null pour tous les restaurants.
 * Renvoie { stats } ou { erreur } (POS_NON_INSTALLE si la fonction manque).
 */
export async function chargerStatsPOS({ debut, fin, restaurantId = null }) {
  try {
    const res = await fetch(`${POS_URL}/rest/v1/rpc/stats_dashboard`, {
      method: 'POST',
      headers: { apikey: POS_CLE, Authorization: `Bearer ${POS_CLE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_debut: debut, p_fin: fin, p_restaurant: restaurantId }),
    })
    if (res.status === 404) return { erreur: POS_NON_INSTALLE }
    const corps = await res.json().catch(() => null)
    if (!res.ok) {
      if (corps?.code === 'PGRST202') return { erreur: POS_NON_INSTALLE }
      // 57014 : la requête a dépassé le temps permis (3 s avec la clé publique).
      if (corps?.code === '57014') {
        return { erreur: 'Le POS met trop de temps à calculer. Repassez la dernière version de pos_cloud_stats_dashboard.sql dans le projet pos-samer-cloud.' }
      }
      return { erreur: corps?.message || `Erreur ${res.status}` }
    }
    return { stats: corps }
  } catch (e) {
    return { erreur: e?.message || 'POS injoignable' }
  }
}
