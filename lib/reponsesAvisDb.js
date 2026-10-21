// ──────────────────────────────────────────────────────────────────────────────
//  RÉPONSES AUX AVIS GLOVO — accès base (table reponses_avis)
//  La logique vit dans lib/reponsesAvis.js ; ici on ne parle qu'à Supabase.
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'

const COLONNES_AVIS = 'id, platform, restaurant_id, external_store_label, external_ref, classification, comment, review_date, commande_le, raw'

/** Avis Glovo avec texte depuis une date (paginé : Supabase coupe à 1000). */
export async function chargerAvisGlovoEcrits({ depuis }) {
  const lignes = []
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase.from('platform_reviews').select(COLONNES_AVIS)
      .eq('platform', 'glovo').gte('review_date', depuis).neq('comment', '')
      .order('review_date', { ascending: false }).order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    lignes.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return lignes.filter(a => String(a.comment || '').trim())
}

export async function chargerReponses(reviewIds) {
  const parAvis = new Map()
  for (let i = 0; i < reviewIds.length; i += 200) {
    const { data, error } = await supabase.from('reponses_avis').select('*').in('review_id', reviewIds.slice(i, i + 200))
    if (error) throw error
    for (const r of data || []) parAvis.set(r.review_id, r)
  }
  return parAvis
}

export async function enregistrerReponse({ reviewId, texte, modele, statut, par }) {
  const { error } = await supabase.from('reponses_avis').upsert({
    review_id: reviewId, texte: String(texte).trim(), modele, statut,
    erreur: null, valide_par: par || null, valide_le: new Date().toISOString(), envoye_le: null,
  }, { onConflict: 'review_id' })
  if (error) throw error
}
