// Événements : lectures et écritures Supabase. Logique : lib/evenements.js
// Moins de 1000 travailleurs actifs et d'événements : une seule page de lecture suffit.
import { champsEvenement } from './evenements'
import { ACTIONS, journaliser } from './journal'
import { lignesFeries } from './joursFeries'
import { supabase } from './supabase'

const COLONNES_TRAVAILLEUR = 'id, nom, prenoms, contact, photo_url, date_naissance, date_embauche, restaurant_id, actif, statut, restaurants(nom, couleur)'

/** groupe = true : tout le groupe. Sinon, seulement restaurantId ; sans restaurant, rien. */
export async function chargerDonneesEvenements({ groupe, restaurantId }) {
  if (!groupe && !restaurantId) return { travailleurs: [], evenements: [] }

  let t = supabase.from('travailleurs').select(COLONNES_TRAVAILLEUR).eq('actif', true).order('nom')
  let e = supabase.from('evenements_groupe').select('*, restaurants(nom)').order('date_evenement')
  if (!groupe) {
    t = t.eq('restaurant_id', restaurantId)
    e = e.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
  }
  const [travailleurs, evenements] = await Promise.all([t, e])
  if (travailleurs.error) throw travailleurs.error
  if (evenements.error) throw evenements.error
  return { travailleurs: travailleurs.data || [], evenements: evenements.data || [] }
}

export async function enregistrerEvenement(form, id, ctx) {
  const champs = champsEvenement(form)
  const { error } = id
    ? await supabase.from('evenements_groupe').update(champs).eq('id', id)
    : await supabase.from('evenements_groupe').insert({ ...champs, cree_par_nom: ctx.userNom || null })
  if (error) throw error
  journaliser(id ? ACTIONS.EVENEMENT_MODIFIE : ACTIONS.EVENEMENT_AJOUTE,
    { titre: champs.titre, date: champs.date_evenement },
    { restaurantId: champs.restaurant_id, userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
}

export async function supprimerEvenement(evenement, ctx) {
  const { error } = await supabase.from('evenements_groupe').delete().eq('id', evenement.id)
  if (error) throw error
  journaliser(ACTIONS.EVENEMENT_SUPPRIME,
    { titre: evenement.titre, date: evenement.date_evenement },
    { restaurantId: evenement.restaurant_id, userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
}

/** Ajoute les fériés d'une année. Une fête déjà présente n'est ni dupliquée ni écrasée. */
export async function ajouterJoursFeries(annee, ctx) {
  const { data, error } = await supabase.from('evenements_groupe')
    .upsert(lignesFeries(annee, ctx.userNom), { onConflict: 'ferie_cle,ferie_annee', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  const nombre = data?.length || 0
  if (nombre) {
    journaliser(ACTIONS.EVENEMENT_AJOUTE, { titre: `Jours fériés ${annee}`, nombre },
      { userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
  }
  return nombre
}
