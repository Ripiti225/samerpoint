// Chargement du détail d'un shift caissier : dépenses, fournisseurs,
// présences et inventaire.
//
// Sorti de app/point-shift.js sans rien changer aux filtres, pour que
// « Point caissier » et « Point / Shift » lisent exactement la même chose.

import { supabase } from './supabase'

export async function chargerDetailShift(shift) {
  let depQ = supabase.from('depenses')
    .select('*')
    .eq('point_id', shift.point_id)
    .eq('saisi_par', 'caissier')
    .order('created_at')
  if (shift.caissier_nom) depQ = depQ.eq('caissier_nom', shift.caissier_nom)

  // caissier_id n'est jamais sauvegardé dans transactions_fournisseurs → filtrer par caissier_nom
  let txQ = supabase.from('transactions_fournisseurs')
    .select('*, fournisseurs(nom)')
    .eq('point_id', shift.point_id)
    .eq('saisi_par', 'caissier')
  if (shift.caissier_nom) txQ = txQ.eq('caissier_nom', shift.caissier_nom)

  const [depRes, txRes, invRes] = await Promise.all([
    depQ,
    txQ,
    shift.caissier_id
      ? supabase.from('inventaires_shifts')
          .select(`
            id, caissier_id, type_shift, montant_a_deduire, valide,
            inventaire_lignes(
              produit_id, produit_nom, stock_initial, entrees, sorties,
              stock_reel, ecart, nombre_explique, explication, montant_deduit
            )
          `)
          .eq('point_id', shift.point_id)
          .eq('caissier_id', shift.caissier_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Présences : select('*') sans jointure FK (travailleur_nom est dénormalisé dans la table)
  // Essayer d'abord par caissier_id, sinon par point_id seul
  let presData = []
  if (shift.caissier_id) {
    const presById = await supabase.from('presences')
      .select('*')
      .eq('point_id', shift.point_id)
      .eq('caissier_id', shift.caissier_id)
    presData = presById.data || []
  }
  if (presData.length === 0) {
    const presByPoint = await supabase.from('presences')
      .select('*')
      .eq('point_id', shift.point_id)
    presData = presByPoint.data || []
  }

  return {
    depenses: depRes.data || [],
    fournisseurs: txRes.data || [],
    presences: presData,
    inventaire: invRes.data || null,
  }
}
