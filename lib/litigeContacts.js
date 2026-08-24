/*
 * Litige « contacts manquants » — calcul + corrections manager.
 *
 * Le litige compare le nombre de commandes livraison saisi par le gérant
 * (points.yango_nb_commandes + points.glovo_nb_commandes) au nombre de
 * contacts clients réellement pris (commandes.contact_client rempli).
 * Au-delà de 20 % d'écart, chaque contact manquant coûte 500 FCFA.
 *
 * Deux corrections sont possibles, réservées au manager / directeur :
 *   • corriger le nombre de commandes  → le gérant s'est trompé en saisissant
 *     (le litige est alors recalculé automatiquement partout) ;
 *   • forcer le montant du litige      → l'écart est réel mais pas imputable
 *     au restaurant (ex. tablette en panne : contacts impossibles à prendre).
 *
 * Le calcul est partagé par app/litiges.js, app/charges.js et app/verification.js :
 * toute évolution de la règle doit se faire ICI, sinon les écrans divergent.
 *
 * Voir supabase_litige_contacts_correction.sql.
 */

import { supabase } from './supabase'
import { journaliser } from './journal'
import { creerNotification } from './notificationsInterne'

// Règle métier
export const PRIX_CONTACT_MANQUANT = 500   // FCFA par contact non pris
export const SEUIL_TOLERANCE_PCT = 20      // en dessous, aucun litige

// Colonnes lues sur `points` pour calculer/afficher le litige contacts.
export const CHAMPS_CONTACT = `id, date, restaurant_id, yango_nb_commandes, glovo_nb_commandes,
  yango_nb_commandes_original, glovo_nb_commandes_original,
  nb_commandes_corrige_par_nom, nb_commandes_corrige_at, nb_commandes_correction_motif,
  contact_litige_override, contact_litige_motif, contact_litige_par_nom, contact_litige_at`
  .replace(/\s+/g, ' ')

// Tant que la migration n'est pas passée, les colonnes de correction n'existent
// pas : on retombe sur le jeu de colonnes historique plutôt que de tout casser.
const CHAMPS_CONTACT_LEGACY = 'id, date, restaurant_id, yango_nb_commandes, glovo_nb_commandes'

// PostgREST : « column ... does not exist » en lecture, « ... in the schema
// cache » en écriture. On couvre les deux formulations.
function colonneManquante(error) {
  return /does not exist|schema cache/i.test(error?.message || '')
}

/**
 * Charge les points d'un restaurant sur une plage, avec les colonnes de
 * correction si la migration est passée (sinon sans, silencieusement).
 */
export async function chargerPointsContact(restaurantId, debut, fin) {
  const req = (champs) => supabase
    .from('points').select(champs)
    .eq('restaurant_id', restaurantId)
    .gte('date', debut).lte('date', fin)
    .order('date', { ascending: false })

  let { data, error } = await req(CHAMPS_CONTACT)
  if (error && colonneManquante(error)) ({ data, error } = await req(CHAMPS_CONTACT_LEGACY))
  return data || []
}

// Supabase/PostgREST plafonne toute réponse à 1000 lignes, sans erreur ni
// avertissement. Un simple .in('point_id', ids) sur un mois de commandes
// renvoyait donc des journées entières à 0 contact → faux litige à 100 %.
// On pagine jusqu'à épuisement. Voir aussi la note dans le README des litiges.
const PAGE_SUPABASE = 1000

/**
 * Compte les contacts clients pris, par point et par caissier.
 * @param {string[]} pointIds
 * @returns {{ parPoint: object, parPointCaissier: object }}
 */
export async function compterContacts(pointIds) {
  const parPoint = {}
  const parPointCaissier = {}
  if (!pointIds?.length) return { parPoint, parPointCaissier }

  for (let debut = 0; ; debut += PAGE_SUPABASE) {
    const { data, error } = await supabase
      .from('commandes')
      .select('point_id, contact_client, caissier_id')
      .in('point_id', pointIds)
      .order('id', { ascending: true })   // ordre stable : sans ça, la pagination saute des lignes
      .range(debut, debut + PAGE_SUPABASE - 1)

    if (error || !data?.length) break

    data.forEach(c => {
      if (!c.contact_client || c.contact_client.trim() === '') return
      parPoint[c.point_id] = (parPoint[c.point_id] || 0) + 1
      if (c.caissier_id) {
        if (!parPointCaissier[c.point_id]) parPointCaissier[c.point_id] = {}
        parPointCaissier[c.point_id][c.caissier_id] =
          (parPointCaissier[c.point_id][c.caissier_id] || 0) + 1
      }
    })

    if (data.length < PAGE_SUPABASE) break   // dernière page
  }

  return { parPoint, parPointCaissier }
}

/**
 * Litige contacts d'un point.
 * @param {object} point   ligne `points` (au moins les nb de commandes)
 * @param {number} nbContacts  contacts pris sur ce point
 */
export function calculerLitigeContact(point, nbContacts = 0) {
  const nbYango = point?.yango_nb_commandes || 0
  const nbGlovo = point?.glovo_nb_commandes || 0
  const nbCommandes = nbYango + nbGlovo
  const ecart = nbCommandes - nbContacts
  const taux = nbCommandes > 0 ? Math.round((ecart / nbCommandes) * 1000) / 10 : 0
  // Seuls les MANQUANTS font litige. Plus de contacts que de commandes
  // (écart négatif) = surplus : jamais de litige, comme dans le volet Écarts.
  const litigeCalcule = (ecart > 0 && taux > SEUIL_TOLERANCE_PCT)
    ? ecart * PRIX_CONTACT_MANQUANT
    : 0

  const override = point?.contact_litige_override
  const forceParManager = override !== null && override !== undefined && override !== ''
  const litige = forceParManager
    ? Math.max(0, Math.round(Number(override) || 0))
    : litigeCalcule

  const nbCorrige = !!point?.nb_commandes_corrige_at

  return {
    nbYango, nbGlovo, nbCommandes, nbContacts, ecart, taux,
    litigeCalcule,           // ce que dit la règle
    litige,                  // ce qui est réellement retenu
    forceParManager,
    motif:      point?.contact_litige_motif || null,
    forcePar:   point?.contact_litige_par_nom || null,
    forceAt:    point?.contact_litige_at || null,
    nbCorrige,
    nbYangoOriginal: point?.yango_nb_commandes_original ?? null,
    nbGlovoOriginal: point?.glovo_nb_commandes_original ?? null,
    nbCorrigePar:    point?.nb_commandes_corrige_par_nom || null,
    nbCorrigeAt:     point?.nb_commandes_corrige_at || null,
    nbCorrigeMotif:  point?.nb_commandes_correction_motif || null,
  }
}

const ERR_MIGRATION =
  'Migration non passée en base : exécutez supabase_litige_contacts_correction.sql dans Supabase.'

/**
 * Corrige le nombre de commandes Yango/Glovo d'un point (manager/directeur).
 * Le litige contacts, les charges et le récap sont recalculés automatiquement
 * puisqu'ils lisent tous ces deux colonnes.
 *
 * @returns {{ ok: boolean, error?: string, point?: object }}
 */
export async function corrigerNbCommandes({
  point, yango, glovo, motif = '', userId, userNom,
}) {
  if (!point?.id) return { ok: false, error: 'Point introuvable.' }

  const nouveauYango = Math.max(0, Math.round(Number(yango) || 0))
  const nouveauGlovo = Math.max(0, Math.round(Number(glovo) || 0))
  const ancienYango = point.yango_nb_commandes || 0
  const ancienGlovo = point.glovo_nb_commandes || 0

  if (nouveauYango === ancienYango && nouveauGlovo === ancienGlovo) {
    return { ok: false, error: 'Les nombres sont identiques à ceux déjà enregistrés.' }
  }

  // On garde la TOUTE PREMIÈRE saisie du gérant (ré-correction possible).
  const origYango = point.yango_nb_commandes_original ?? ancienYango
  const origGlovo = point.glovo_nb_commandes_original ?? ancienGlovo
  const nowIso = new Date().toISOString()

  const patch = {
    yango_nb_commandes: nouveauYango,
    glovo_nb_commandes: nouveauGlovo,
    yango_nb_commandes_original: origYango,
    glovo_nb_commandes_original: origGlovo,
    nb_commandes_corrige_par: userId || null,
    nb_commandes_corrige_par_nom: userNom || null,
    nb_commandes_corrige_at: nowIso,
    nb_commandes_correction_motif: motif.trim() || null,
  }

  const { error } = await supabase.from('points').update(patch).eq('id', point.id)
  if (error) return { ok: false, error: colonneManquante(error) ? ERR_MIGRATION : error.message }

  creerNotification({
    type: 'nb_commandes_corrige',
    titre: '✏️ Nombre de commandes corrigé',
    message: `Livraisons du ${point.date} : Yango ${ancienYango} → ${nouveauYango}, `
      + `Glovo ${ancienGlovo} → ${nouveauGlovo}.`
      + (motif.trim() ? ` Motif : ${motif.trim()}` : ''),
    restaurant_id: point.restaurant_id || null,
    cible_role: ['gerant'],
    created_by: userId || null,
    screen: null,
  }).catch(() => {})

  journaliser('correction_nb_commandes', {
    point_id: point.id,
    date: point.date,
    ancien_yango: ancienYango, nouveau_yango: nouveauYango,
    ancien_glovo: ancienGlovo, nouveau_glovo: nouveauGlovo,
    motif: motif.trim() || null,
  }, { restaurantId: point.restaurant_id, pointId: point.id, userId, userNom }).catch(() => {})

  return { ok: true, point: { ...point, ...patch } }
}

/**
 * Force le montant du litige contacts d'un point (manager/directeur).
 * Motif obligatoire — c'est la seule trace de « pourquoi ce n'est pas de leur
 * faute » (ex. tablette hors service).
 *
 * @param {number|null} montant  montant retenu ; null = revenir au calcul
 */
export async function forcerLitigeContact({
  point, montant, motif = '', litigeCalcule = null, userId, userNom,
}) {
  if (!point?.id) return { ok: false, error: 'Point introuvable.' }

  const annule = montant === null || montant === undefined || montant === ''
  const valeur = annule ? null : Math.max(0, Math.round(Number(montant) || 0))
  if (!annule && !motif.trim()) return { ok: false, error: 'Le motif est obligatoire.' }

  const nowIso = new Date().toISOString()
  const patch = annule
    ? {
        contact_litige_override: null,
        contact_litige_calcule: null,
        contact_litige_motif: null,
        contact_litige_par: null,
        contact_litige_par_nom: null,
        contact_litige_at: null,
      }
    : {
        contact_litige_override: valeur,
        contact_litige_calcule: litigeCalcule == null ? null : Math.round(litigeCalcule),
        contact_litige_motif: motif.trim(),
        contact_litige_par: userId || null,
        contact_litige_par_nom: userNom || null,
        contact_litige_at: nowIso,
      }

  const { error } = await supabase.from('points').update(patch).eq('id', point.id)
  if (error) return { ok: false, error: colonneManquante(error) ? ERR_MIGRATION : error.message }

  const fmtF = (n) => Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA'
  creerNotification({
    type: 'litige_contact_corrige',
    titre: annule ? '↩️ Litige contacts rétabli' : '✏️ Litige contacts corrigé',
    message: annule
      ? `Le litige contacts du ${point.date} revient au montant calculé.`
      : `Litige contacts du ${point.date} : ${litigeCalcule != null ? `${fmtF(litigeCalcule)} → ` : ''}`
        + `${fmtF(valeur)}. Motif : ${motif.trim()}`,
    restaurant_id: point.restaurant_id || null,
    cible_role: ['gerant'],
    created_by: userId || null,
    screen: null,
  }).catch(() => {})

  journaliser('correction_litige_contacts', {
    point_id: point.id,
    date: point.date,
    montant_calcule: litigeCalcule,
    montant_retenu: valeur,
    annulation_correction: annule,
    motif: motif.trim() || null,
  }, { restaurantId: point.restaurant_id, pointId: point.id, userId, userNom }).catch(() => {})

  return { ok: true, point: { ...point, ...patch } }
}
