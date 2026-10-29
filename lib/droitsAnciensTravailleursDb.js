// Droits des anciens travailleurs — accès Supabase (logique pure :
// lib/droitsAnciensTravailleurs.js). Une fiche = un fournisseur administratif
// sans échéance, avec depart_le ; le montant dû est une écriture
// « ajustement_manager » (même chemin que « Modifier » dans Crédits).
import { estAncienneFicheGlobale, estDroitAncienTravailleur } from './droitsAnciensTravailleurs'
import { ecritureAjustementCredit } from './creditsFournisseurs'
import { chargerDerniersRestes } from './derniersRestesFournisseurs'
import { journaliser } from './journal'
import { supabase } from './supabase'
import { aujourdhuiISO } from './tresorerie'

const MIGRATION = 'Il faut d\'abord passer supabase_droits_anciens_travailleurs.sql dans Supabase.'
const traduire = e => (/depart_le|depart_motif|travailleur_id/.test(e?.message || '') ? new Error(MIGRATION) : e)
const ctx = (user, restaurantId) => ({ restaurantId, userId: user?.userId || null, userNom: user?.userNom || null })

// '*' : depart_le n'existe pas avant la migration (la liste reste alors vide).
export async function chargerDroitsAnciens() {
  const [admin, anciens, archives] = await Promise.all([
    supabase.from('fournisseurs').select('*').eq('type', 'administratif').order('nom'),
    supabase.from('fournisseurs').select('*').ilike('nom', '%ancien%').eq('actif', true),
    // '*' : badge_rendu n'existe qu'après supabase_cartes_travailleurs.sql.
    supabase.from('travailleurs').select('*')
      .eq('statut', 'archive').order('archived_at', { ascending: false }),
  ])
  if (admin.error) throw admin.error
  const fiches = (admin.data || []).filter(estDroitAncienTravailleur)
  const ids = fiches.map(f => f.id)
  let transactions = []
  if (ids.length) {
    const { data, error } = await supabase.from('transactions_fournisseurs')
      .select('id, fournisseur_id, facture, paye, source, date_point, created_at')
      .in('fournisseur_id', ids).order('created_at')
    if (error) throw error
    transactions = data || []
  }
  return {
    fiches,
    transactions,
    anciennes: (anciens.data || []).filter(estAncienneFicheGlobale),
    archives: archives.data || [],
  }
}

async function ajuster(fournisseurId, delta, raison, user) {
  const e = ecritureAjustementCredit(delta)
  if (!e) return
  const { data: txId, error } = await supabase.rpc('inserer_transaction_hors_point', {
    p_fournisseur: fournisseurId, p_date: aujourdhuiISO(), p_facture: e.facture, p_paye: e.paye,
    p_saisi_par: 'manager', p_source: 'ajustement_manager', p_caissier_nom: user?.userNom || null,
  })
  if (error) throw error
  if (txId && raison) {
    await supabase.from('transactions_fournisseurs').update({ facture_correction_raison: raison }).eq('id', txId)
  }
}

export async function creerDroitAncien({ restaurantId, nom, travailleurId, departLe, motif, montant }, user) {
  const { data, error } = await supabase.from('fournisseurs').insert({
    nom: nom.trim(), type: 'administratif', restaurant_id: restaurantId, actif: true, facture_mensuelle: 0,
    depart_le: departLe, depart_motif: (motif || '').trim() || null, travailleur_id: travailleurId || null,
  }).select('id').single()
  if (error) throw traduire(error)
  await supabase.from('fournisseurs_restaurants').upsert(
    { fournisseur_id: data.id, restaurant_id: restaurantId, credit_actuel: 0 },
    { onConflict: 'fournisseur_id,restaurant_id' })
  await ajuster(data.id, Math.round(Number(montant) || 0), 'Droits à la sortie', user)
  journaliser('droit_ancien_travailleur_cree', { nom: nom.trim(), depart_le: departLe, motif, montant },
    ctx(user, restaurantId)).catch(() => {})
  return data.id
}

export async function modifierDroitAncien(fiche, { nom, departLe, motif, montantDu }, user) {
  const { error } = await supabase.from('fournisseurs').update({
    nom: nom.trim(), depart_le: departLe, depart_motif: (motif || '').trim() || null,
  }).eq('id', fiche.id)
  if (error) throw traduire(error)
  const delta = Math.round(Number(montantDu) || 0) - Math.round(Number(fiche.du) || 0)
  await ajuster(fiche.id, delta, 'Montant dû corrigé', user)
  journaliser('droit_ancien_travailleur_modifie', { nom: nom.trim(), depart_le: departLe, motif, ancien_du: fiche.du, nouveau_du: montantDu },
    ctx(user, fiche.restaurant_id)).catch(() => {})
}

// Ancienne fiche globale « ANCIEN TRAVAILLEURS » : remise à 0 (écriture, pas
// d'écrasement) puis désactivée. Son historique reste.
export async function remplacerAncienneFiche(fiche, user) {
  const derniers = await chargerDerniersRestes(supabase, [fiche.id])
  const reste = derniers[fiche.id] ? Number(derniers[fiche.id].reste) || 0 : Number(fiche.credit_actuel) || 0
  await ajuster(fiche.id, -reste, 'Remplacée par une fiche par ancien travailleur', user)
  const { error } = await supabase.from('fournisseurs').update({ actif: false }).eq('id', fiche.id)
  if (error) throw error
  journaliser('ancienne_fiche_travailleurs_remplacee', { nom: fiche.nom, reste }, ctx(user, fiche.restaurant_id)).catch(() => {})
}
