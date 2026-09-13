// ──────────────────────────────────────────────────────────────────────────────
// Détail « contacts pris » caissier par caissier — « Hilary 5 / 7 ».
//
// Le litige contacts (lib/contactsPOS.js) répond à « combien de contacts
// manquent sur la journée ». Il ne dit pas QUI ne les a pas pris. Ce module
// ventile le même comptage par caissier, pour que Vérification et Litiges
// affichent la même chose.
//
// ⚠ MÊME SOURCE UNIQUE QUE LE LITIGE : compteurs du POS sur un site basculé,
// lignes `commandes` sinon. Jamais les deux additionnées (voir contactsPOS.js).
//
// ⚠ ABSENT ≠ ZÉRO. `contacts: null` veut dire « le POS n'a rien transmis pour
// ce caissier » ; `contacts: 0` veut dire « il n'a pris aucun contact ». Les
// écrans doivent afficher « — » dans le premier cas, jamais « 0 / 7 » : c'est
// la confusion qui fabrique de faux reproches.
//
// ⚠ TOTAL INDICATIF. Le dénominateur du litige est le nombre de commandes
// SAISI PAR LE GÉRANT (yango_nb_commandes + glovo_nb_commandes). Ici on compte
// les commandes réellement enregistrées : les deux ne tombent pas toujours
// juste. `sommeCommandes` est fourni pour que l'écran puisse le signaler.
//
// SITES SANS POS — CE QU'ON NE SAURA JAMAIS. Sur un site Samtrackly, une
// commande qui n'a pas été saisie par le caissier ne laisse aucune trace : le
// « / 7 » ne compte que ce qu'il a bien voulu enregistrer. Le seul comptage
// exhaustif est celui du gérant, et il est journalier, sans répartition par
// caissier. On ne peut donc pas SAVOIR combien chacun devait prendre — on peut
// seulement ESTIMER, à partir de l'argent livraison encaissé sur son shift
// (`yango_cse` + `glovo_cse`, appuyé par des photos) divisé par le panier moyen
// du restaurant. C'est une ALERTE, jamais une base de retenue : le panier moyen
// se calcule avec les comptages du gérant, donc il hérite de leurs défauts.
//
// Module PUR (aucun accès réseau) : lib/contactsParCaissier.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

import { SOURCE_POS, normaliserSourcePoint } from './sourcePoint.js'

export const NOM_INCONNU = 'Caissier non identifié'

// Sous ce nombre de journées exploitables, le panier moyen ne veut rien dire :
// on n'affiche aucune estimation plutôt qu'un chiffre inventé.
export const MIN_JOURS_PANIER = 5

// En dessous de cet écart, on se tait : deux commandes d'écart, c'est le bruit
// normal d'une estimation par l'argent, pas un reproche à faire à quelqu'un.
export const ECART_ALERTE_COMMANDES = 3

function estRenseigne(valeur) {
  return valeur !== null && valeur !== undefined
}

function entierPositif(valeur) {
  return Math.max(0, Number(valeur) || 0)
}

function contactPris(valeur) {
  return typeof valeur === 'string' && valeur.trim() !== ''
}

/**
 * Panier moyen d'une commande livraison, en FCFA — argent encaissé ÷ nombre de
 * commandes déclaré par le gérant, sur toutes les journées exploitables.
 *
 * Ne sert QU'À estimer (voir l'en-tête) : le dénominateur vient des comptages
 * du gérant, donc un gérant qui sous-déclare gonfle le panier, ce qui fait
 * SOUS-estimer les commandes attendues. L'erreur va dans le sens prudent —
 * l'alerte se tait plutôt que d'accuser à tort.
 *
 * @param {object[]} points lignes `points` (yango_cse, glovo_cse, *_nb_commandes)
 * @returns {{ panier: number|null, jours: number }}
 */
export function panierMoyenLivraison(points = []) {
  let argent = 0
  let commandes = 0
  let jours = 0
  ;(points || []).forEach(p => {
    const nb = entierPositif(p?.yango_nb_commandes) + entierPositif(p?.glovo_nb_commandes)
    const cse = entierPositif(p?.yango_cse) + entierPositif(p?.glovo_cse)
    if (nb <= 0 || cse <= 0) return   // journée sans livraison ou sans comptage
    argent += cse
    commandes += nb
    jours += 1
  })
  if (jours < MIN_JOURS_PANIER || commandes <= 0) return { panier: null, jours }
  return { panier: Math.round(argent / commandes), jours }
}

/**
 * Combien de commandes l'argent d'un shift laisse-t-il supposer ?
 * @returns {number|null} null si on ne peut rien dire (pas de panier, pas d'argent)
 */
export function estimerCommandesShift(montantLivraison, panier) {
  if (!panier || panier <= 0) return null
  const montant = entierPositif(montantLivraison)
  if (montant <= 0) return null
  return Math.round(montant / panier)
}

/**
 * Ventile les contacts pris par caissier pour UNE journée.
 *
 * @param {object}   arg
 * @param {string}   arg.sourcePoint  'POS' ou 'SAMTRACKLY' (source du restaurant)
 * @param {object[]} arg.commandes    lignes `commandes` du point (caissier_id, contact_client)
 * @param {object[]} arg.shifts       lignes `points_shifts` du point (compteurs POS + argent livraison)
 * @param {object}   arg.noms         { [caissier_id]: nom } pour l'affichage
 * @param {number|null} arg.panier    panier moyen livraison, pour l'estimation (sites sans POS)
 * @returns {{ source: string, lignes: object[], sommeContacts: number, sommeCommandes: number }}
 *          lignes = [{ cle, nom, contacts, commandes, disponible, montantLivraison,
 *          attendu, alerte }] triées du plus gros volume au plus petit.
 *          `contacts`/`commandes` valent null quand la donnée n'a pas été transmise ;
 *          `attendu` est une ESTIMATION (null quand on ne peut rien dire).
 */
export function detailContactsParCaissier({
  sourcePoint, commandes = [], shifts = [], noms = {}, panier = null,
} = {}) {
  const source = normaliserSourcePoint(sourcePoint)
  const lignes = source === SOURCE_POS
    ? depuisShiftsPOS(shifts, noms)
    : depuisCommandes(commandes, shifts, noms, panier)

  lignes.sort((a, b) =>
    (b.commandes || 0) - (a.commandes || 0) ||
    (b.contacts || 0) - (a.contacts || 0) ||
    String(a.nom).localeCompare(String(b.nom))
  )

  return {
    source,
    lignes,
    sommeContacts: lignes.reduce((s, l) => s + (l.contacts || 0), 0),
    sommeCommandes: lignes.reduce((s, l) => s + (l.commandes || 0), 0),
  }
}

// Site basculé : un shift = une caissière, avec ses compteurs POS. Une caissière
// qui a fait deux shifts dans la journée est regroupée sur une seule ligne.
function depuisShiftsPOS(shifts, noms) {
  const par = new Map()
  ;(shifts || []).forEach(s => {
    const cle = s?.caissier_id || s?.caissier_nom || '—'
    if (!par.has(cle)) {
      par.set(cle, {
        cle,
        nom: noms[s?.caissier_id] || s?.caissier_nom || NOM_INCONNU,
        contacts: null,
        commandes: null,
        disponible: false,
      })
    }
    const l = par.get(cle)
    if (estRenseigne(s?.pos_nb_contacts)) {
      l.contacts = (l.contacts || 0) + entierPositif(s.pos_nb_contacts)
      l.disponible = true
    }
    if (estRenseigne(s?.pos_nb_yango) || estRenseigne(s?.pos_nb_glovo)) {
      l.commandes = (l.commandes || 0)
        + entierPositif(s?.pos_nb_yango) + entierPositif(s?.pos_nb_glovo)
    }
  })
  return [...par.values()]
}

// Site Samtrackly : chaque ligne de `commandes` est une commande partenaire,
// avec ou sans contact client. Le caissier vient de la commande elle-même.
//
// Les shifts servent uniquement à l'estimation : l'argent livraison encaissé
// (`yango_cse` + `glovo_cse`) dit ce que le caissier a manipulé, y compris les
// commandes qu'il n'a jamais saisies. Un caissier qui n'a RIEN enregistré mais
// dont le shift a encaissé de la livraison apparaît donc quand même — c'est
// précisément l'angle mort qu'on veut éclairer.
function depuisCommandes(commandes, shifts, noms, panier) {
  const par = new Map()
  const ligne = (cle, nom) => {
    if (!par.has(cle)) {
      par.set(cle, {
        cle,
        nom,
        contacts: 0,
        commandes: 0,
        disponible: true,
        montantLivraison: 0,
        attendu: null,
        alerte: false,
      })
    }
    return par.get(cle)
  }

  ;(commandes || []).forEach(c => {
    const cle = c?.caissier_id || '—'
    const l = ligne(cle, noms[c?.caissier_id] || (c?.caissier_id ? 'Caissier' : NOM_INCONNU))
    l.commandes += 1
    if (contactPris(c?.contact_client)) l.contacts += 1
  })

  ;(shifts || []).forEach(sh => {
    const argent = entierPositif(sh?.yango_cse) + entierPositif(sh?.glovo_cse)
    const cle = sh?.caissier_id || '—'
    // Pas d'argent livraison et aucune commande enregistrée : rien à dire sur ce
    // shift, on ne l'ajoute pas à la liste pour ne pas la noyer.
    if (argent <= 0 && !par.has(cle)) return
    const l = ligne(cle, noms[sh?.caissier_id] || sh?.caissier_nom || NOM_INCONNU)
    l.montantLivraison += argent
  })

  par.forEach(l => {
    l.attendu = estimerCommandesShift(l.montantLivraison, panier)
    l.alerte = l.attendu != null && (l.attendu - l.commandes) >= ECART_ALERTE_COMMANDES
  })

  return [...par.values()]
}
