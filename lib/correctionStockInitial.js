import { supabase } from './supabase'
import { messageLitigeStock } from './correctionStockInitial.messages'

// Tant que le script SQL n'est pas passé, les écrans doivent continuer à marcher :
// une lecture en erreur vaut « aucun litige ».
export async function chargerLitigesStock(pointId) {
  const { data, error } = await supabase.rpc('corrections_stock_initial_du_point', { p_point_id: pointId })
  return error ? [] : data || []
}

export async function deciderLitigeStock(id, decision, par) {
  const { error } = await supabase.rpc('decider_correction_stock_initial', {
    p_id: id,
    p_decision: decision,
    p_par: par,
  })
  if (error) throw new Error(messageLitigeStock(error))
}

export async function compterLitigesStockEnAttente(restaurantId) {
  const { count, error } = await supabase
    .from('corrections_stock_initial')
    .select('id', { count: 'exact', head: true })
    .eq('statut', 'en_attente')
    .eq('restaurant_id', restaurantId)
  return error ? 0 : count || 0
}
