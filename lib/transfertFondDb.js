// ──────────────────────────────────────────────────────────────────────────────
// Fond négatif remis à 0 — lectures et appels des fonctions SQL
// (supabase_fond_transferts.sql). Logique pure : lib/transfertFond.js.
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { aujourdhuiISO } from './tresorerie'
import { fondsNegatifs } from './transfertFond'

const MIGRATION = 'Migration à passer : supabase_fond_transferts.sql (SQL Editor de Supabase).'

// Fonction ou table absente → message clair au lieu d'une erreur technique.
function migrationManquante(error) {
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)
}

function erreur(error) {
  if (migrationManquante(error)) return new Error(MIGRATION)
  return new Error(error?.message || 'Réessayez.')
}

function ilYa(iso, jours) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - jours)
  return d.toISOString().slice(0, 10)
}

// Dernier point validé du restaurant : c'est lui qui porte le fond laissé.
export async function chargerFondRestaurant(restaurantId) {
  const { data, error } = await supabase.from('points')
    .select('id, date, reste_fc, ajustement_fond')
    .eq('restaurant_id', restaurantId).eq('valide', true)
    .order('date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw erreur(error)
  return data || null
}

export async function chargerTransferts(restaurantId) {
  const { data, error } = await supabase.from('transferts_fond').select('*')
    .eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(20)
  if (error) {
    if (migrationManquante(error)) return { lignes: [], migration: true }
    throw erreur(error)
  }
  return { lignes: data || [], migration: false }
}

// Fonds négatifs de tous les restaurants (dernier point validé des 30 derniers jours).
export async function chargerFondsNegatifs(nomResto) {
  const { data, error } = await supabase.from('points')
    .select('restaurant_id, date, valide, reste_fc, ajustement_fond')
    .eq('valide', true).gte('date', ilYa(aujourdhuiISO(), 30)).range(0, 4999)
  if (error) throw erreur(error)
  return fondsNegatifs(data || [], nomResto)
}

export async function transfererFond({ restaurantId, montant, destination, note }, user) {
  const { data, error } = await supabase.rpc('transferer_fond_negatif', {
    p_restaurant: restaurantId, p_montant: montant, p_destination: destination, p_note: note || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw erreur(error)
  return data
}

export async function annulerTransfert(id, user) {
  const { error } = await supabase.rpc('annuler_transfert_fond', {
    p_transfert: id, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw erreur(error)
}
