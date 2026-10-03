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
      return { erreur: corps?.message || `Erreur ${res.status}` }
    }
    return { stats: corps }
  } catch (e) {
    return { erreur: e?.message || 'POS injoignable' }
  }
}
