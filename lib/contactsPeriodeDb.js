// ──────────────────────────────────────────────────────────────────────────────
// Écran Contacts : chargement des contacts clients d'une période.
// Supabase tronque en silence à 1000 lignes (un mois de commandes d'avant le
// POS en compte ~4 000) : tout passe par toutesLesPages().
// Calculs : lib/contactsPeriode.js
// ──────────────────────────────────────────────────────────────────────────────
import { contactsParPoint } from './contactsPeriode'
import { supabase } from './supabase'

const PAGE = 1000

async function toutesLesPages(construire) {
  let tout = []
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await construire().range(de, de + PAGE - 1)
    if (error) throw error
    tout = tout.concat(data || [])
    if (!data || data.length < PAGE) return tout
  }
}

/**
 * Contacts de [debut, fin] pour un restaurant (restoId null = tous).
 * → { lignes: une par point (contactsParPoint), commandes: numéros saisis avec date }
 */
export async function chargerContactsPeriode({ debut, fin, restoId }) {
  const [points, shifts, commandes] = await Promise.all([
    toutesLesPages(() => {
      let q = supabase.from('points').select('id, date, restaurant_id, yango_nb_commandes, glovo_nb_commandes')
        .gte('date', debut).lte('date', fin).order('id')
      if (restoId) q = q.eq('restaurant_id', restoId)
      return q
    }),
    toutesLesPages(() => {
      let q = supabase.from('points_shifts').select('id, point_id, pos_nb_contacts, pos_nb_yango, pos_nb_glovo, points!inner(date, restaurant_id)')
        .gte('points.date', debut).lte('points.date', fin).order('id')
      if (restoId) q = q.eq('points.restaurant_id', restoId)
      return q
    }),
    toutesLesPages(() => {
      let q = supabase.from('commandes').select('id, point_id, contact_client, partenaire, points!inner(date, restaurant_id)')
        .not('contact_client', 'is', null).neq('contact_client', '')
        .gte('points.date', debut).lte('points.date', fin).order('id')
      if (restoId) q = q.eq('points.restaurant_id', restoId)
      return q
    }),
  ])
  return {
    lignes: contactsParPoint({ points, shifts, commandes }),
    commandes: commandes.map(({ points: p, ...c }) => ({ ...c, date: p?.date || '', restaurant_id: p?.restaurant_id || null })),
  }
}

/** Dernière date où un numéro client a été saisi dans Samtrackly (avant le POS). */
export async function derniereDateNumero() {
  const { data } = await supabase.from('commandes').select('created_at')
    .not('contact_client', 'is', null).neq('contact_client', '')
    .order('created_at', { ascending: false }).limit(1)
  return data?.[0]?.created_at?.slice(0, 10) || null
}

export async function chargerEquipeEtFournisseurs(restoId) {
  let qt = supabase.from('travailleurs').select('id, nom, poste, contact, restaurant_id').eq('actif', true).not('contact', 'is', null).order('nom')
  let qf = supabase.from('fournisseurs').select('id, nom, type, contact, restaurant_id').eq('actif', true).not('contact', 'is', null).order('nom')
  if (restoId) { qt = qt.eq('restaurant_id', restoId); qf = qf.eq('restaurant_id', restoId) }
  const [t, f] = await Promise.all([qt.range(0, 4999), qf.range(0, 4999)])
  return { travailleurs: t.data || [], fournisseurs: f.data || [] }
}
