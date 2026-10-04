// ──────────────────────────────────────────────────────────────────────────────
//  AVIS CLIENTS DES PLATEFORMES — accès base
//
//  Lecture de `platform_reviews` / `ingest_runs` et rattachement d'une boutique
//  à un restaurant. La logique de calcul vit dans lib/avisPlateformes.js (pure,
//  testée) ; ce module ne fait que parler à Supabase.
//
//  ⚠️ L'app n'écrit JAMAIS dans platform_reviews : aucune politique RLS ne le
//  permet. Seule l'Edge Function `ingest-reviews` (service_role) insère des
//  avis, et le rattachement passe par la fonction SQL rattacher_avis().
// ──────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { MONTANT_AVIS_MAUVAIS, PLATEFORMES } from './avisPlateformes'

const TAILLE_PAGE = 1000
const MAX_PAGES = 50

/**
 * Charge les avis d'une période. Lecture paginée obligatoire : Supabase
 * plafonne silencieusement à 1000 lignes, et un mois d'avis sur 7 restaurants
 * dépasse ce seuil — une troncature donnerait des KPI faux.
 */
export async function chargerAvis({ debut, fin, restaurantId = null, platform = null, classification = null } = {}) {
  const lignes = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase
      .from('platform_reviews')
      .select('id, platform, restaurant_id, external_store_label, external_ref, rating_raw, rating_scale, rating_normalized, classification, comment, author, review_date, ingested_at')
    if (debut) q = q.gte('review_date', debut)
    if (fin) q = q.lte('review_date', fin)
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    if (platform) q = q.eq('platform', platform)
    if (classification) q = q.eq('classification', classification)
    const debutPage = page * TAILLE_PAGE
    const { data, error } = await q
      .order('review_date', { ascending: false })
      .order('id', { ascending: true })
      .range(debutPage, debutPage + TAILLE_PAGE - 1)
    if (error) throw error
    const lot = data || []
    lignes.push(...lot)
    if (lot.length < TAILLE_PAGE) break
  }
  return lignes
}

/**
 * Avis orphelins (restaurant_id NULL), toutes périodes confondues : tant
 * qu'une boutique n'est pas rattachée, ses avis n'apparaissent nulle part
 * ailleurs — les limiter à la période affichée les ferait disparaître.
 */
export async function chargerAvisNonRattaches() {
  const lignes = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const debutPage = page * TAILLE_PAGE
    const { data, error } = await supabase
      .from('platform_reviews')
      .select('id, platform, external_store_label, classification, rating_raw, rating_scale, review_date, restaurant_id')
      .is('restaurant_id', null)
      .order('id', { ascending: true })
      .range(debutPage, debutPage + TAILLE_PAGE - 1)
    if (error) throw error
    const lot = data || []
    lignes.push(...lot)
    if (lot.length < TAILLE_PAGE) break
  }
  return lignes
}

/**
 * Rattache une boutique plateforme à un restaurant : enregistre la
 * correspondance, reprend les avis orphelins et crée les litiges manquants.
 * Tout se passe côté serveur (fonction SQL rattacher_avis, SECURITY DEFINER) —
 * l'app n'écrit jamais directement dans platform_reviews.
 */
export async function rattacherBoutique({ platform, label, restaurantId }) {
  const { data, error } = await supabase.rpc('rattacher_avis', {
    p_platform: platform,
    p_label: label,
    p_restaurant_id: restaurantId,
    p_montant: MONTANT_AVIS_MAUVAIS,
  })
  if (error) throw error
  return data || 0
}

/** Dernière extraction enregistrée (table ingest_runs) — état du jour. */
export async function dernierRun() {
  const { data, error } = await supabase
    .from('ingest_runs')
    .select('run_date, status, received, inserted, duplicates, unmapped, litiges_crees, finished_at')
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}

/**
 * Date du dernier envoi d'avis par plateforme (`ingested_at` le plus récent).
 * Une ligne lue par plateforme — jamais toute la table. Sert au rappel
 * « pense à cliquer sur le bouton avis ».
 */
export async function dernierAvisRecu() {
  const out = {}
  await Promise.all(PLATEFORMES.map(async p => {
    const { data, error } = await supabase
      .from('platform_reviews')
      .select('ingested_at')
      .eq('platform', p.key)
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    out[p.key] = data?.ingested_at || null
  }))
  return out
}
