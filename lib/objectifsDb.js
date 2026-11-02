// Objectifs de vente par mois (supabase_objectifs_mensuels.sql). La règle de
// lecture est dans lib/objectifs.js (objectifPour, appliquerObjectifsMois).
import { journaliser } from './journal'
import { supabase } from './supabase'

/** Toutes les lignes (peu nombreuses). Table absente avant la migration : []. */
export async function chargerObjectifsMois() {
  const { data, error } = await supabase.from('objectifs_restaurants')
    .select('restaurant_id, mois, montant').order('mois').range(0, 4999)
  if (error) return []
  return data || []
}

/** changes : [{ restaurant_id, montant (null = retiré) }] pour le mois 'AAAA-MM-01'. */
export async function enregistrerObjectifsMois(mois, changes, user) {
  if (!changes.length) return
  const { error } = await supabase.from('objectifs_restaurants').upsert(
    changes.map(c => ({ restaurant_id: c.restaurant_id, mois, montant: c.montant, modifie_par: user?.userNom || null, updated_at: new Date().toISOString() })),
    { onConflict: 'restaurant_id,mois' })
  if (error) {
    if (/objectifs_restaurants/.test(error.message || '')) {
      throw new Error('Les objectifs par mois ont besoin de supabase_objectifs_mensuels.sql : il faut passer ce fichier dans Supabase.')
    }
    throw error
  }
  journaliser('objectifs_mois_modifies', { mois, changes }, { userId: user?.userId || null, userNom: user?.userNom || null })
}
