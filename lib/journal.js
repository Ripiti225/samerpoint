/**
 * lib/journal.js
 * Journal d'activité — enregistre les actions importantes dans Supabase
 *
 * SQL requis :
 * create table journal_activite (
 *   id uuid primary key default gen_random_uuid(),
 *   action text not null,
 *   details jsonb default '{}',
 *   restaurant_id uuid references restaurants(id),
 *   point_id uuid references points(id),
 *   user_id text,
 *   user_nom text,
 *   created_at timestamptz default now()
 * );
 * create index on journal_activite (created_at desc);
 * create index on journal_activite (restaurant_id);
 * create index on journal_activite (action);
 * alter table journal_activite enable row level security;
 * create policy "lecture managers" on journal_activite for select using (true);
 * create policy "ecriture" on journal_activite for insert using (true);
 */

import { supabase } from './supabase'

// ──────────────────────────────────────────────
// Actions disponibles
// ──────────────────────────────────────────────
export const ACTIONS = {
  POINT_VALIDE:         'point_valide',
  DEPENSES_SAUVEGARDEES:'depenses_sauvegardees',
  PRESENCES_SAUVEGARDEES:'presences_sauvegardees',
  INVENTAIRE_SAUVEGARDE:'inventaire_sauvegarde',
  LIVRAISONS_SAUVEGARDEES:'livraisons_sauvegardees',
  FOURNISSEURS_SAUVEGARDES:'fournisseurs_sauvegardes',
  SHIFT_SAUVEGARDE:     'shift_sauvegarde',
  PHOTO_UPLOADEE:       'photo_uploadee',
  RAPPORT_GENERE:       'rapport_hebdo_genere',
  ONEDRIVE_BACKUP:      'onedrive_backup',
}

// ──────────────────────────────────────────────
// Enregistrer une entrée (silencieux — ne bloque jamais)
// ──────────────────────────────────────────────
export async function journaliser(action, details = {}, contexte = {}) {
  try {
    await supabase.from('journal_activite').insert({
      action,
      details,
      restaurant_id: contexte.restaurantId || null,
      point_id:      contexte.pointId || null,
      user_id:       contexte.userId || null,
      user_nom:      contexte.userNom || null,
    })
  } catch (_) {
    // Silencieux — le journal ne doit jamais bloquer une action métier
  }
}

// ──────────────────────────────────────────────
// Chargement du journal (pour l'écran journal.js)
// ──────────────────────────────────────────────
export async function chargerJournal({ restaurantId, limite = 50, action = null } = {}) {
  let query = supabase
    .from('journal_activite')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite)

  if (restaurantId) query = query.eq('restaurant_id', restaurantId)
  if (action) query = query.eq('action', action)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ──────────────────────────────────────────────
// Labels lisibles pour l'affichage
// ──────────────────────────────────────────────
export const ACTION_LABELS = {
  point_valide:           { icon: '✅', label: 'Point validé' },
  depenses_sauvegardees:  { icon: '📋', label: 'Dépenses sauvegardées' },
  presences_sauvegardees: { icon: '👥', label: 'Présences sauvegardées' },
  inventaire_sauvegarde:  { icon: '📦', label: 'Inventaire sauvegardé' },
  livraisons_sauvegardees:{ icon: '🛵', label: 'Livraisons sauvegardées' },
  fournisseurs_sauvegardes:{ icon: '🧾', label: 'Fournisseurs sauvegardés' },
  shift_sauvegarde:       { icon: '⏱️', label: 'Shift enregistré' },
  photo_uploadee:         { icon: '📷', label: 'Photo uploadée' },
  rapport_hebdo_genere:   { icon: '📊', label: 'Rapport hebdo généré' },
  onedrive_backup:        { icon: '☁️', label: 'Sauvegarde OneDrive' },
}
