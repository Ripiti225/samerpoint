import { supabase } from './supabase'

export async function creerNotification({
  type, titre, message,
  restaurant_id = null,
  cible_role = [],
  cible_user_id = null,
  created_by = null,
  screen = null,
  params = null,
}) {
  const base = { type, titre, message, restaurant_id, cible_role, cible_user_id, lu_par: [], created_by }
  try {
    await supabase.from('notifications').insert({ ...base, screen, params })
  } catch (_) {
    // Colonnes screen/params pas encore en DB — retente sans elles
    try { await supabase.from('notifications').insert(base) } catch (_) {}
  }
}

export async function chargerNotifications(userId, role, restaurantId) {
  if (!userId) return []
  try {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60)
    if (!data) return []
    return data.filter(n => {
      if (n.cible_user_id && n.cible_user_id === userId) return true
      if (n.cible_role?.length > 0 && n.cible_role.includes(role)) {
        if (restaurantId && n.restaurant_id && n.restaurant_id !== restaurantId) return false
        return true
      }
      if (!n.cible_user_id && (!n.cible_role || n.cible_role.length === 0)) return true
      return false
    })
  } catch (_) {
    return []
  }
}

export async function marquerToutLu(notifIds, userId) {
  if (!notifIds.length || !userId) return
  try {
    await supabase.rpc('marquer_notifs_lues', {
      notif_ids: notifIds,
      user_uuid: userId,
    })
  } catch (_) {}
}

export async function supprimerNotification(notifId) {
  try {
    await supabase.from('notifications').delete().eq('id', notifId)
  } catch (_) {}
}

export async function supprimerToutesNotifications(notifIds) {
  if (!notifIds.length) return
  try {
    await supabase.from('notifications').delete().in('id', notifIds)
  } catch (_) {}
}
