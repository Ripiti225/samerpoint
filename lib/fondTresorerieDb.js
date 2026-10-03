// ──────────────────────────────────────────────────────────────────────────────
// Fond donné par la Trésorerie → « FC reçu » du point : lecture et rattachement.
// Logique : lib/fondTresorerie.js · Migration : supabase_tresorerie_fond_points.sql
// ──────────────────────────────────────────────────────────────────────────────
import { fondPourPoint } from './fondTresorerie'
import { supabase } from './supabase'

// { montant, lignes } pour ce point ; null si indisponible (hors ligne,
// migration pas passée) : la case reste alors en saisie manuelle.
export async function chargerFondTresorerie({ restaurantId, datePoint, pointId }) {
  if (!restaurantId || !datePoint || !pointId) return null
  try {
    const libre = `point_id.is.null,point_id.eq.${pointId}`
    const [f, e] = await Promise.all([
      supabase.from('tresorerie_depenses_direction').select('id, date, montant, point_id')
        .eq('categorie', 'fond').eq('restaurant_id', restaurantId).lte('date', datePoint).or(libre)
        .order('date').range(0, 999),
      supabase.from('tresorerie_mouvements').select('id, date, montant, point_id')
        .eq('type', 'especes').eq('restaurant_id', restaurantId).lte('date', datePoint).or(libre)
        .order('date').range(0, 999),
    ])
    if (f.error || e.error) return null
    return fondPourPoint({ pointId, datePoint, fonds: f.data, reprises: e.data })
  } catch (_) {
    return null
  }
}

// À la validation : les lignes comptées dans ce point lui sont rattachées et ne
// compteront plus dans un autre point.
export async function rattacherFondAuPoint({ restaurantId, datePoint, pointId }) {
  const r = await chargerFondTresorerie({ restaurantId, datePoint, pointId })
  if (!r?.lignes.length) return
  const ids = type => r.lignes.filter(l => l.type === type).map(l => l.id)
  if (ids('fond').length) {
    await supabase.from('tresorerie_depenses_direction').update({ point_id: pointId }).in('id', ids('fond'))
  }
  if (ids('reprise').length) {
    await supabase.from('tresorerie_mouvements').update({ point_id: pointId }).in('id', ids('reprise'))
  }
}
