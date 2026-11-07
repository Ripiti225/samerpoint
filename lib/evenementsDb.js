// Événements : lectures et écritures Supabase. Logique : lib/evenements.js
// Moins de 1000 travailleurs actifs et d'événements : une seule page de lecture suffit.
import { DELAIS_ACCUEIL, datesUtiles, elementsAlerte, itemsPour, ventesParRestaurant } from './alertesStock'
import { SANS_TRESORERIE, droitsDates } from './calendrierDates'
import { attacherLignes } from './cheques'
import { aujourdhuiISO } from './contrats'
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

/** Alertes de stock de l'accueil : ne lit que les ventes des dates nécessaires. */
export async function chargerAlertesAccueil({ role, restaurantId, aujourdhui }) {
  const groupe = ['manager', 'directeur', 'rh'].includes(role)
  if (!groupe && !restaurantId) return []
  let e = supabase.from('evenements_groupe').select('*')
  if (!groupe) e = e.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
  const { data: evenements, error } = await e
  if (error) throw error
  const elements = elementsAlerte(evenements || [], aujourdhui, DELAIS_ACCUEIL)
  if (!elements.length) return []
  const dates = datesUtiles(elements, evenements)
  let points = []
  if (dates.length) {
    let q = supabase.from('points').select('restaurant_id, date, vente_machine, vente_total').eq('valide', true).in('date', dates)
    if (!groupe) q = q.eq('restaurant_id', restaurantId)
    const r = await q
    if (r.error) throw r.error
    points = r.data || []
  }
  return itemsPour({ id: 'accueil', role, restaurant_id: restaurantId }, { elements, evenements, ventes: ventesParRestaurant(points) })
}

const DONNEES_VIDES = {
  restaurants: [], cheques: [], dus: [], paiements: [], previsions: [], emprunts: [],
  fournisseurs: [], contrats: [], demandes: [], permissions: [], taches: [],
}

async function toutesLesPages(construire) {
  let tout = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await construire().range(de, de + 999)
    if (error) throw error
    tout = tout.concat(data || [])
    if (!data || data.length < 1000) return tout
  }
}

/**
 * Dates du calendrier selon les droits : ce qu'un compte ne peut pas voir n'est
 * pas lu. Chaque source peut échouer seule : le reste s'affiche, `manque` le signale.
 */
export async function chargerDatesCalendrier({ role, userId, restaurantId }) {
  const groupe = ['manager', 'directeur', 'rh'].includes(role)
  if (!groupe && !restaurantId) return { donnees: DONNEES_VIDES, droits: droitsDates(role, userId, []), manque: false }

  let manque = false
  let droits
  if (groupe) {
    const r = await supabase.from('tresorerie_droits').select('user_id, niveau')
    droits = droitsDates(role, userId, r.data || [])
    if (r.error) { manque = true; droits = { ...droits, ...SANS_TRESORERIE } }
  } else {
    droits = droitsDates(role, userId, [])
  }

  const aujourdhui = aujourdhuiISO()
  const lire = async construire => {
    const { data, error } = await construire()
    if (error) throw error
    return data || []
  }
  const parResto = q => (groupe ? q : q.eq('restaurant_id', restaurantId))
  const sources = {
    restaurants: () => lire(() => supabase.from('restaurants').select('id, nom')),
    cheques: droits.cheques ? () => lire(() => supabase.from('tresorerie_cheques').select('*').eq('statut', 'emis')) : null,
    lignesCheques: droits.cheques ? () => lire(() => supabase.from('tresorerie_cheques_lignes').select('*')) : null,
    dus: droits.categories.length ? () => toutesLesPages(() => supabase.from('tresorerie_dus').select('*').order('id')) : null,
    paiements: droits.categories.length ? () => toutesLesPages(() => supabase.from('tresorerie_paiements').select('id, du_id, montant, prevision_id, date').order('id')) : null,
    previsions: droits.categories.length ? () => lire(() => supabase.from('tresorerie_previsions').select('*')) : null,
    emprunts: droits.coffre ? () => lire(() => supabase.from('tresorerie_coffre_emprunts').select('*').is('rembourse_le', null)) : null,
    fournisseurs: droits.charges ? () => lire(() => supabase.from('fournisseurs').select('id, nom, type, actif, restaurant_id, facture_mensuelle, facture_periodicite, facture_mensuelle_depuis').eq('type', 'administratif')) : null,
    contrats: droits.contrats ? () => lire(() => supabase.from('contrats_travailleurs').select('id, statut, type, date_fin, cloture_le, restaurant_id, travailleurs(nom)').is('cloture_le', null).gte('date_fin', aujourdhui)) : null,
    demandes: droits.conges ? () => lire(() => parResto(supabase.from('demandes').select('id, type, statut, travailleur_nom, restaurant_id, date_debut, date_fin').eq('statut', 'validee').gte('date_fin', aujourdhui))) : null,
    permissions: droits.conges ? () => lire(() => parResto(supabase.from('permissions_conges').select('id, type, travailleur_nom, restaurant_id, date_debut, date_fin').gte('date_fin', aujourdhui))) : null,
    taches: droits.taches ? () => lire(() => parResto(supabase.from('supervision_taches').select('id, titre, statut, echeance, restaurant_id, responsable_nom').in('statut', ['a_faire', 'signalee']).not('echeance', 'is', null))) : null,
  }

  const cles = Object.keys(sources).filter(k => sources[k])
  const resultats = await Promise.allSettled(cles.map(k => sources[k]()))
  const valeurs = {}
  const echecs = new Set()
  cles.forEach((k, i) => {
    if (resultats[i].status === 'fulfilled') valeurs[k] = resultats[i].value
    else { valeurs[k] = []; echecs.add(k); manque = true }
  })

  // Sans les paiements, tout paraîtrait impayé : échéances et prévisions sont retirées.
  const paiementsManquants = echecs.has('paiements')
  // Sans leurs lignes, une prévision portée par un chèque paraîtrait à part : les prévisions sont retirées.
  const lignesManquantes = echecs.has('lignesCheques')
  return {
    droits,
    manque,
    donnees: {
      ...DONNEES_VIDES,
      ...valeurs,
      cheques: attacherLignes(valeurs.cheques || [], valeurs.lignesCheques || []),
      dus: paiementsManquants ? [] : (valeurs.dus || []),
      previsions: paiementsManquants || lignesManquantes ? [] : (valeurs.previsions || []),
    },
  }
}
