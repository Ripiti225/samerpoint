// ──────────────────────────────────────────────────────────────────────────────
// Contacts clients « pris » : d'où vient le compte, et quand peut-on en tirer
// un litige ?
//
// Depuis la bascule POS, les caissières d'un site basculé n'ouvrent plus
// Samtrackly : elles saisissent le contact du client dans le POS, après chaque
// commande partenaire. Le compte remonte alors dans
// `points_shifts.pos_nb_contacts`, et la table `commandes` de Samtrackly reste
// vide pour ce site.
//
// ⚠ UNE SEULE SOURCE À LA FOIS, JAMAIS LA SOMME DES DEUX.
// Additionner `commandes.contact_client` et `pos_nb_contacts` compterait deux
// fois les jours de transition, où les deux systèmes ont tourné ensemble.
//
// ⚠ ABSENT ≠ ZÉRO. Un `null` veut dire « le POS n'a pas transmis » ; un `0`
// veut dire « le POS a compté, et il n'y a eu aucun contact ». Confondre les
// deux, c'est facturer 500 FCFA par commande à des caissières dont l'info
// n'est simplement pas encore arrivée — le faux litige à 100 % que ce module
// existe pour empêcher.
//
// Module PUR (aucun accès réseau) pour être testable : lib/contactsPOS.test.mjs.
// Les chargements Supabase sont dans lib/litigeContacts.js, qui ré-exporte tout
// ce fichier pour que les écrans n'aient qu'un seul import à connaître.
// ──────────────────────────────────────────────────────────────────────────────

import { SOURCE_POS, SOURCE_SAMTRACKLY, normaliserSourcePoint } from './sourcePoint.js'

// Règle métier (inchangée depuis 2026-06) — appliquée seulement quand le
// comptage est complet, quelle que soit sa source.
export const PRIX_CONTACT_MANQUANT = 500   // FCFA par contact non pris
export const SEUIL_TOLERANCE_PCT = 20      // en dessous, aucun litige

// Depuis cette journée, les compteurs contacts sont déployés de façon fiable
// dans le POS. Une valeur absente sur un point plus récent signifie donc que
// le contact n'a pas été pris ; les journées antérieures restent protégées.
export const DATE_DEBLOCAGE_CONTACTS_POS = '2026-08-27'

export const MOTIF_CONTACTS_POS_INDISPONIBLES =
  'Calcul suspendu : données contacts POS incomplètes'

export const MOTIF_CONTACTS_POS_INCOHERENTS =
  'Calcul suspendu : le POS ne rapporte aucune commande partenaire ce jour-là'

function estRenseigne(valeur) {
  return valeur !== null && valeur !== undefined
}

function entierPositif(valeur) {
  return Math.max(0, Number(valeur) || 0)
}

/**
 * Somme les contacts pris remontés par le POS, shift par shift.
 *
 * `disponible` est faux tant qu'AUCUN shift ne porte de compteur : le POS n'a
 * rien transmis, on ne sait pas, et on ne facture pas.
 * `shiftsSansDonnee > 0` avec `disponible` vrai = comptage partiel : une
 * caissière a synchronisé, l'autre pas encore.
 */
export function compterContactsPOS(shifts = []) {
  const lignes = (shifts || []).filter(s => estRenseigne(s?.pos_nb_contacts))
  return {
    disponible: lignes.length > 0,
    nombre: lignes.reduce((total, s) => total + entierPositif(s.pos_nb_contacts), 0),
    shiftsRecus: lignes.length,
    shiftsSansDonnee: (shifts || []).length - lignes.length,
  }
}

/**
 * Commandes partenaires comptées par le POS (Yango + Glovo).
 * Sert de référence à la place du nombre saisi par le gérant quand le POS l'a
 * transmis — le gérant garde sa saisie, l'écart entre les deux est un contrôle
 * croisé voulu (cf. CHAMPS_REMPLIS_PAR_LE_POS dans lib/sourcePoint.js).
 */
export function compterCommandesPOS(shifts = []) {
  const lignes = (shifts || []).filter(
    s => estRenseigne(s?.pos_nb_yango) || estRenseigne(s?.pos_nb_glovo)
  )
  const yango = lignes.reduce((t, s) => t + entierPositif(s.pos_nb_yango), 0)
  const glovo = lignes.reduce((t, s) => t + entierPositif(s.pos_nb_glovo), 0)
  return {
    disponible: lignes.length > 0,
    yango,
    glovo,
    nombre: yango + glovo,
    shiftsSansDonnee: (shifts || []).length - lignes.length,
  }
}

/**
 * LE point de décision : quelle source fait foi pour ce restaurant ?
 *
 * Site POS  → uniquement les compteurs des shifts.
 * Site Samtrackly → uniquement les `commandes.contact_client` (comportement
 * historique, strictement inchangé).
 *
 * Sur un site POS on ne retombe JAMAIS en silence sur les commandes
 * Samtrackly : elles sont vides depuis la bascule, le litige serait de 100 %.
 */
export function choisirNombreContacts({ sourcePoint, shifts, contactsSamtrackly }) {
  if (normaliserSourcePoint(sourcePoint) === SOURCE_POS) {
    const pos = compterContactsPOS(shifts)
    return {
      nombre: pos.nombre,
      source: SOURCE_POS,
      disponible: pos.disponible,
      incomplet: pos.disponible && pos.shiftsSansDonnee > 0,
      shiftsSansDonnee: pos.shiftsSansDonnee,
      // Commandes partenaires vues par le POS : sert de contrôle de cohérence
      // au moment de décider si un « 0 contact » veut dire quelque chose.
      commandesPOS: compterCommandesPOS(shifts),
    }
  }

  return {
    nombre: entierPositif(contactsSamtrackly),
    source: SOURCE_SAMTRACKLY,
    disponible: true,
    incomplet: false,
    shiftsSansDonnee: 0,
    commandesPOS: null,
  }
}

/**
 * Litige contacts d'un point.
 *
 * @param {object} point   ligne `points` (au moins les nb de commandes)
 * @param {number} nbContacts  contacts pris sur ce point
 * @param {object|null} infoContacts  sortie de choisirNombreContacts() ; absent
 *   = source Samtrackly disponible (compatibilité avec les appels historiques)
 */
export function calculerLitigeContact(point, nbContacts = 0, infoContacts = null) {
  const nbYango = point?.yango_nb_commandes || 0
  const nbGlovo = point?.glovo_nb_commandes || 0
  const nbCommandes = nbYango + nbGlovo
  const ecart = nbCommandes - nbContacts
  const taux = nbCommandes > 0 ? Math.round((ecart / nbCommandes) * 1000) / 10 : 0

  const contactsSource = infoContacts?.source || SOURCE_SAMTRACKLY
  const contactsDisponibles = infoContacts ? infoContacts.disponible !== false : true
  const contactsIncomplets = infoContacts?.incomplet === true
  const contactsPOSDebloques = contactsSource === SOURCE_POS
    && typeof point?.date === 'string'
    && point.date.slice(0, 10) >= DATE_DEBLOCAGE_CONTACTS_POS

  // Contrôle de cohérence, pour les rapports Z antérieurs au champ « contact »
  // du POS. Le pont convertit un rapport sans bloc `partenaires` en zéros
  // (`n(undefined) === 0`) : sans ce garde-fou, une journée où le POS ne
  // rapporte AUCUNE commande partenaire, alors que le gérant en a déclaré
  // vingt, se lirait « le POS a compté, zéro contact pris » et facturerait
  // 500 FCFA par commande à des caissières qui n'avaient pas encore le champ
  // dans leur caisse. Les deux sources se contredisent : on ne tranche pas.
  const cmdPOS = infoContacts?.commandesPOS
  const posSansPartenaire = contactsSource === SOURCE_POS
    && contactsDisponibles
    && nbContacts === 0
    && !!cmdPOS
    && cmdPOS.nombre === 0
    && nbCommandes > 0

  // Avant la date de déploiement fiable, une donnée POS absente reste inconnue
  // et ne produit aucune retenue. À partir de cette date, elle vaut zéro contact
  // réellement pris, y compris pour un shift non renseigné dans un total partiel.
  const calculSuspendu = !contactsPOSDebloques
    && (!contactsDisponibles || contactsIncomplets || posSansPartenaire)

  // Seuls les MANQUANTS font litige. Plus de contacts que de commandes
  // (écart négatif) = surplus : jamais de litige, comme dans le volet Écarts.
  const litigeCalcule = (!calculSuspendu && ecart > 0 && taux > SEUIL_TOLERANCE_PCT)
    ? ecart * PRIX_CONTACT_MANQUANT
    : 0

  const override = point?.contact_litige_override
  const forceParManager = override !== null && override !== undefined && override !== ''
  // Un montant forcé par un manager reste une décision humaine explicite : il
  // survit à la suspension du calcul automatique.
  const litige = forceParManager
    ? Math.max(0, Math.round(Number(override) || 0))
    : litigeCalcule

  const nbCorrige = !!point?.nb_commandes_corrige_at

  return {
    nbYango, nbGlovo, nbCommandes, nbContacts, ecart, taux,
    litigeCalcule,           // ce que dit la règle
    litige,                  // ce qui est réellement retenu
    forceParManager,
    contactsSource,
    contactsDisponibles,
    contactsIncomplets,
    shiftsSansContact: infoContacts?.shiftsSansDonnee || 0,
    calculSuspendu,
    posSansPartenaire,
    motifSuspension: !calculSuspendu
      ? null
      : (posSansPartenaire ? MOTIF_CONTACTS_POS_INCOHERENTS : MOTIF_CONTACTS_POS_INDISPONIBLES),
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
