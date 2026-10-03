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
 * → { lignes: une par point (contactsParPoint), commandes: numéros avec date }
 *
 * Les numéros viennent de deux tables qui ne se recouvrent pas : les
 * `commandes` saisies dans Samtrackly avant la bascule POS, et
 * `contacts_clients`, copie des numéros saisis au POS (import-contacts-pos).
 * Le COMPTE de contacts, lui, reste celui de contactsParPoint (compteurs POS).
 */
export async function chargerContactsPeriode({ debut, fin, restoId }) {
  const [points, shifts, commandes, contactsPOS] = await Promise.all([
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
    toutesLesPages(() => {
      let q = supabase.from('contacts_clients').select('id, numero, partenaire, date, restaurant_id')
        .gte('date', debut).lte('date', fin).order('id')
      if (restoId) q = q.eq('restaurant_id', restoId)
      return q
    }),
  ])
  return {
    lignes: contactsParPoint({ points, shifts, commandes }),
    commandes: [
      ...commandes.map(({ points: p, ...c }) => ({ ...c, date: p?.date || '', restaurant_id: p?.restaurant_id || null })),
      ...contactsPOS.map(c => ({ contact_client: c.numero, partenaire: c.partenaire, date: c.date, restaurant_id: c.restaurant_id })),
    ],
  }
}

/** Heure du dernier numéro arrivé du POS (affichée sous la liste). */
export async function dernierNumeroPOS() {
  const { data } = await supabase.from('contacts_clients').select('commande_at')
    .order('commande_at', { ascending: false }).limit(1)
  return data?.[0]?.commande_at || null
}

export async function chargerEquipeEtFournisseurs(restoId) {
  let qt = supabase.from('travailleurs').select('id, nom, poste, contact, restaurant_id').eq('actif', true).not('contact', 'is', null).order('nom')
  let qf = supabase.from('fournisseurs').select('id, nom, type, contact, restaurant_id').eq('actif', true).not('contact', 'is', null).order('nom')
  if (restoId) { qt = qt.eq('restaurant_id', restoId); qf = qf.eq('restaurant_id', restoId) }
  const [t, f] = await Promise.all([qt.range(0, 4999), qf.range(0, 4999)])
  return { travailleurs: t.data || [], fournisseurs: f.data || [] }
}
