// Groupes de restaurants — accès Supabase (logique pure : lib/groupes.js).
import { supabase } from './supabase'

// Vide tant que supabase_groupes_restaurants.sql n'est pas passée.
export async function chargerGroupes() {
  const { data, error } = await supabase.from('groupes').select('id, nom').order('nom')
  return error ? [] : data || []
}
