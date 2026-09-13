/*
 * Litige « contacts manquants » — calcul + corrections manager.
 *
 * Le litige compare le nombre de commandes livraison saisi par le gérant
 * (points.yango_nb_commandes + points.glovo_nb_commandes) au nombre de
 * contacts clients réellement pris.
 * Au-delà de 20 % d'écart, chaque contact manquant coûte 500 FCFA.
 *
 * D'OÙ VIENNENT LES CONTACTS PRIS — une source, jamais deux :
 *   • site SAMTRACKLY : les `commandes.contact_client` non vides (historique) ;
 *   • site POS        : la somme des `points_shifts.pos_nb_contacts`, saisis
 *     par la caissière dans le POS après chaque commande partenaire.
 * Le choix se fait dans lib/contactsPOS.js (module pur, testé) — jamais
 * réécrit écran par écran, sinon Vérification, Litiges et Charges finissent
 * par afficher trois montants différents pour la même journée.
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
import { SOURCE_POS, normaliserSourcePoint } from './sourcePoint'
import { journaliser } from './journal'
import { creerNotification } from './notificationsInterne'

// Règle métier, calcul et choix de la source : lib/contactsPOS.js (module pur,
// testé). Ré-exportés ici pour que les écrans gardent un seul import.
export {
  PRIX_CONTACT_MANQUANT, SEUIL_TOLERANCE_PCT,
  MOTIF_CONTACTS_POS_INDISPONIBLES, MOTIF_CONTACTS_POS_INCOHERENTS,
  compterContactsPOS, compterCommandesPOS, choisirNombreContacts, calculerLitigeContact,
} from './contactsPOS'

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
 *
 * `parPointCaissier` porte les DEUX nombres — contacts pris ET commandes —
 * pour que les écrans puissent afficher « Hilary 5 / 7 » sans relire la table.
 *
 * @param {string[]} pointIds
 * @returns {{ parPoint: object, parPointCaissier: object }}
 *          parPointCaissier = { [pointId]: { [caissierId]: { contacts, commandes } } }
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
      const pris = !!c.contact_client && c.contact_client.trim() !== ''
      if (pris) parPoint[c.point_id] = (parPoint[c.point_id] || 0) + 1
      if (c.caissier_id) {
        if (!parPointCaissier[c.point_id]) parPointCaissier[c.point_id] = {}
        const ligne = parPointCaissier[c.point_id][c.caissier_id]
          || (parPointCaissier[c.point_id][c.caissier_id] = { contacts: 0, commandes: 0 })
        // Le dénominateur compte TOUTES les commandes du caissier, contact pris
        // ou non : c'est ce qui donne le « / 7 » de « Hilary 5 / 7 ».
        ligne.commandes += 1
        if (pris) ligne.contacts += 1
      }
    })

    if (data.length < PAGE_SUPABASE) break   // dernière page
  }

  return { parPoint, parPointCaissier }
}

/**
 * Colonnes des shifts nécessaires au comptage POS d'une période.
 * (La colonne du nom est bien `caissier_nom` — il n'y a pas de `nom_caissier`.)
 */
export const CHAMPS_SHIFT_CONTACT =
  'point_id, caissier_id, caissier_nom, pos_nb_yango, pos_nb_glovo, pos_nb_contacts'

/**
 * Charge les shifts d'une liste de points, groupés par point, avec les
 * compteurs du POS. Une seule requête paginée pour toute la période — pas une
 * par point.
 *
 * Si la migration supabase_pos_bascule.sql n'est pas passée, les colonnes
 * n'existent pas : on renvoie les shifts sans compteurs, ce qui vaut « rien
 * reçu » et suspend le litige au lieu de le facturer à tort.
 */
export async function chargerShiftsContact(pointIds) {
  const parPoint = {}
  if (!pointIds?.length) return { parPoint }

  const req = (champs, debut) => supabase
    .from('points_shifts').select(champs)
    .in('point_id', pointIds)
    .order('id', { ascending: true })
    .range(debut, debut + PAGE_SUPABASE - 1)

  let champs = CHAMPS_SHIFT_CONTACT
  for (let debut = 0; ; debut += PAGE_SUPABASE) {
    let { data, error } = await req(champs, debut)
    if (error && colonneManquante(error)) {
      champs = 'point_id, caissier_id, caissier_nom'
      ;({ data, error } = await req(champs, debut))
    }
    if (error || !data?.length) break

    data.forEach(s => {
      if (!parPoint[s.point_id]) parPoint[s.point_id] = []
      parPoint[s.point_id].push(s)
    })

    if (data.length < PAGE_SUPABASE) break
  }

  return { parPoint }
}

// Liste des restaurants avec leur source de point — même jeu de colonnes dans
// Vérification, Litiges et Charges, pour qu'aucun écran n'oublie source_point.
export const CHAMPS_RESTO_CONTACT = 'id, nom, couleur, photo_url, localisation, source_point'
const CHAMPS_RESTO_LEGACY = 'id, nom, couleur, photo_url, localisation'

export async function chargerRestaurantsContact() {
  const req = (champs) => supabase.from('restaurants').select(champs).order('nom')
  let { data, error } = await req(CHAMPS_RESTO_CONTACT)
  // Sans la migration supabase_pos_bascule.sql : pas de source_point, donc
  // tous les sites se comportent comme des sites Samtrackly (repli historique).
  if (error && colonneManquante(error)) ({ data } = await req(CHAMPS_RESTO_LEGACY))
  return data || []
}

/** `true` si le point de ce restaurant — tel qu'il vient d'être chargé — arrive du POS. */
export function contactsViennentDuPOS(restaurant) {
  return normaliserSourcePoint(restaurant?.source_point) === SOURCE_POS
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
