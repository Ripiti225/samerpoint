// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — logique pure (aucun appel réseau ici).
//
// La trésorerie nette réelle = banque + partenaires à recevoir − tout ce qu'on
// doit encore (loyers, salaires, CNPS, charges admin, fournisseurs, dettes).
// Chaque « dû » peut être payé en plusieurs fois ; seul son reste compte.
//
// Spéc : docs/superpowers/specs/2026-10-01-tresorerie-socle-design.md
// Tests : lib/tresorerie.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

// Charges à échéance, en série : une ligne par restaurant et par mois consommé
// (par an pour le bail), payée après coup (voir echeancePostPayee).
export const CATEGORIES_SERIE = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail']

// Jour limite commun à tous les restaurants (réglé dans tresorerie_echeances).
export const CATEGORIES_JOUR_COMMUN = ['salaire', 'cnps', 'impot', 'its', 'tee']

// Montant fixe sur l'année, par restaurant (tresorerie_charges_fixes).
export const CATEGORIES_MONTANT_FIXE = ['impot', 'its', 'tee']

export const JOURS_ECHEANCE_DEFAUT = { salaire: 10, cnps: 15, impot: 15, its: 15, tee: 15 }

// « autre » = autre charge notée avant d'être payée (dépenses direction) ;
// « admin » n'est plus proposé (aucune ligne en base au 02/10/2026).
export const CATEGORIES_DU = [...CATEGORIES_SERIE, 'autre', 'admin', 'dette']

export const LIBELLES_CATEGORIE = {
  loyer: 'Loyers',
  salaire: 'Salaires',
  cnps: 'CNPS',
  impot: 'Impôts',
  its: 'ITS',
  tee: 'TEE',
  bail: 'Contrats de bail',
  autre: 'Autres charges',
  admin: 'Admin',
  dette: 'Dettes',
}

// Catégories rattachées à un restaurant et à un mois (une ligne par couple).
export const CATEGORIES_MENSUELLES = CATEGORIES_SERIE

export const LIBELLES_ADMIN = ['ODP', 'Mairie', 'Impôts', 'Autre']

const MOIS_NOMS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const n = v => Number(v) || 0

// ── Restes ───────────────────────────────────────────────────────────────────

export function totalPaye(paiements = []) {
  return (paiements || []).reduce((s, p) => s + n(p?.montant), 0)
}

export function resteDu(du, paiements = []) {
  return Math.max(0, n(du?.montant_du) - totalPaye(paiements))
}

// Regroupe les paiements par dû : { [du_id]: [paiements] }.
export function paiementsParDu(paiements = []) {
  const map = {}
  for (const p of paiements || []) {
    if (!map[p.du_id]) map[p.du_id] = []
    map[p.du_id].push(p)
  }
  return map
}

// ── Banque ───────────────────────────────────────────────────────────────────

export function soldeCompte(mouvements = []) {
  return (mouvements || []).reduce((s, m) => s + n(m?.montant), 0)
}

// Montant du mouvement qui aligne le solde de l'app sur le relevé.
export function montantRecalage(soldeReleve, soldeActuel) {
  return n(soldeReleve) - n(soldeActuel)
}

// ── Fournisseurs ─────────────────────────────────────────────────────────────

// Un crédit négatif est une avance (cotisation), pas une dette.
export function fournisseursDus(fournisseurs = []) {
  return (fournisseurs || [])
    .filter(f => f.actif !== false && n(f.credit_actuel) > 0)
    .reduce((s, f) => s + n(f.credit_actuel), 0)
}

// ── Formule ──────────────────────────────────────────────────────────────────

// Un dû mensuel ne compte qu'à partir de son mois (un loyer de novembre n'est
// pas encore dû en octobre).
function estExigible(du, moisCourant) {
  if (!du.mois || !moisCourant) return true
  return du.mois <= moisCourant
}

// Charges admin payées par les restaurants eux-mêmes : affichées pour
// information, jamais soustraites de la trésorerie du groupe.
export const ADMIN_PAYES_PAR_RESTAURANT = ['ODP', 'Mairie']

export function adminPayeParRestaurant(du) {
  return du?.categorie === 'admin' && ADMIN_PAYES_PAR_RESTAURANT.includes(du.libelle)
}

// Fournisseurs dus, ODP et mairie : affichés (« pour information ») mais pas
// soustraits — ils sont payés par les restaurants, pas par la trésorerie.
export function calculerTresorerieNette({
  comptes = [], dus = [], paiements = [], fournisseursDus: fourn = 0,
  partenaires = 0, moisCourant = null,
}) {
  const parDu = paiementsParDu(paiements)
  const restes = { loyer: 0, salaire: 0, cnps: 0, admin: 0, dette: 0 }
  let adminRestaurants = 0
  for (const du of dus || []) {
    // Impôts, ITS, TEE, bail et autres charges : sur la ligne des charges admin
    // en attendant le nouvel accueil (étape 3).
    const cle = du.categorie in restes ? du.categorie
      : ['impot', 'its', 'tee', 'bail', 'autre'].includes(du.categorie) ? 'admin' : null
    if (!cle || !estExigible(du, moisCourant)) continue
    const reste = resteDu(du, parDu[du.id])
    if (adminPayeParRestaurant(du)) adminRestaurants += reste
    else restes[cle] += reste
  }
  const banque = (comptes || []).reduce((s, c) => s + soldeCompte(c.mouvements), 0)
  const r = {
    banque,
    partenaires: n(partenaires),
    loyers: restes.loyer,
    salaires: restes.salaire,
    cnps: restes.cnps,
    admin: restes.admin,
    dettes: restes.dette,
    // Pour information seulement :
    fournisseurs: n(fourn),
    adminRestaurants,
  }
  r.nette = r.banque + r.partenaires
    - r.loyers - r.salaires - r.cnps - r.admin - r.dettes
  return r
}

// ── Dates (chaînes ISO AAAA-MM-JJ, sans fuseau) ──────────────────────────────

export function aujourdhuiISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function premierDuMois(iso) {
  return `${iso.slice(0, 7)}-01`
}

function decalerMois(moisIso, k) {
  const a = Number(moisIso.slice(0, 4))
  const m = Number(moisIso.slice(5, 7)) - 1 + k
  const an = a + Math.floor(m / 12)
  const mo = ((m % 12) + 12) % 12
  return `${an}-${String(mo + 1).padStart(2, '0')}-01`
}

export function moisEntre(debut, fin) {
  const out = []
  let m = premierDuMois(debut)
  const f = premierDuMois(fin)
  while (m <= f && out.length < 600) {
    out.push(m)
    m = decalerMois(m, 1)
  }
  return out
}

function joursDansMois(moisIso) {
  const a = Number(moisIso.slice(0, 4))
  const m = Number(moisIso.slice(5, 7))
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

// Échéance d'un mois donné ; un jour 31 devient le dernier jour d'un mois court.
export function echeanceDansMois(moisIso, jour) {
  return jourDuMois(moisIso, jour)
}

// Post-payé : la charge du mois M est due au jour limite du mois M+1 (loyer de
// septembre, échéance au 5 → avant le 5 octobre).
export function echeancePostPayee(moisIso, jour) {
  return jourDuMois(decalerMois(premierDuMois(moisIso), 1), jour)
}

export function jourCommun(echeances = [], categorie) {
  const l = (echeances || []).find(e => e.categorie === categorie)
  return l ? n(l.jour) : JOURS_ECHEANCE_DEFAUT[categorie]
}

function jourDuMois(moisIso, jour) {
  const j = Math.min(Math.max(1, n(jour) || 1), joursDansMois(moisIso))
  return `${moisIso.slice(0, 8)}${String(j).padStart(2, '0')}`
}

export function libelleMois(moisIso) {
  if (!moisIso) return ''
  return `${MOIS_NOMS[Number(moisIso.slice(5, 7)) - 1]} ${moisIso.slice(0, 4)}`
}

export function libelleMoisCourt(moisIso) {
  if (!moisIso) return ''
  return MOIS_NOMS[Number(moisIso.slice(5, 7)) - 1]
}

export function formatDateFR(iso) {
  if (!iso) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function joursEntre(a, b) {
  const t = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((t(b) - t(a)) / 86400000)
}

export function joursDeRetard(echeance, aujourdhui) {
  if (!echeance || !aujourdhui) return 0
  return Math.max(0, joursEntre(echeance, aujourdhui))
}

export function echeanceCnpsParDefaut(moisIso) {
  return jourDuMois(decalerMois(premierDuMois(moisIso), 1), 15)
}

// ── Classement : à payer, dette récente, dette ──────────────────────────────

// Jamais stocké, recalculé à chaque affichage :
//  - payé : plus de reste ;
//  - dette : passée à la main (en_dette_depuis), créancier, ou charge en série
//    en retard qu'une charge plus récente de la même série (catégorie +
//    restaurant), elle aussi en retard avec un reste, a rejointe ;
//  - dette récente : charge en série en retard, la plus récente de sa série ;
//  - à payer : le reste (date limite pas passée, autres charges).
export function classerDu(du, dus = [], parDu = {}, aujourdhui) {
  if (resteDu(du, parDu[du.id]) === 0) return 'paye'
  if (du.en_dette_depuis || du.categorie === 'dette') return 'dette'
  if (!CATEGORIES_SERIE.includes(du.categorie)) return 'a_payer'
  if (!du.echeance || aujourdhui <= du.echeance) return 'a_payer'
  const rejointe = (dus || []).some(x => x.id !== du.id
    && x.categorie === du.categorie && x.restaurant_id === du.restaurant_id
    && x.echeance && x.echeance > du.echeance && aujourdhui > x.echeance
    && resteDu(x, parDu[x.id]) > 0)
  return rejointe ? 'dette' : 'dette_recente'
}

export function classerTous(dus = [], paiements = [], aujourdhui) {
  const parDu = paiementsParDu(paiements)
  return Object.fromEntries((dus || []).map(d => [d.id, classerDu(d, dus, parDu, aujourdhui)]))
}

// Lignes qui suivent un nouveau réglage (montant fixe, jour limite, date de
// bail) : non payées et dont la date limite n'est pas passée. Ne rend que les
// lignes qui changent.
export function dusAMettreAJour({
  categorie, restaurantId = null, montant = null, jour = null, bail = null, dus = [], paiements = [], aujourdhui,
}) {
  const parDu = paiementsParDu(paiements)
  const out = []
  for (const d of dus || []) {
    if (d.categorie !== categorie || (restaurantId && d.restaurant_id !== restaurantId)) continue
    if (parDu[d.id]?.length || (d.echeance && d.echeance < aujourdhui)) continue
    const maj = { ...d }
    if (montant !== null) maj.montant_du = n(montant)
    if (jour !== null && d.mois) maj.echeance = echeancePostPayee(d.mois, jour)
    if (bail && d.mois) {
      maj.mois = `${d.mois.slice(0, 4)}-${String(bail.mois).padStart(2, '0')}-01`
      maj.echeance = jourDuMois(maj.mois, bail.jour)
    }
    if (maj.montant_du !== d.montant_du || maj.echeance !== d.echeance || maj.mois !== d.mois) out.push(maj)
  }
  return out
}

// ── Loyers ───────────────────────────────────────────────────────────────────

// Dus de loyer à insérer : un par restaurant et par mois, du mois de départ au
// mois courant, sauf ceux qui existent déjà.
export function moisLoyersACreer(loyers = [], dusExistants = [], moisCourant) {
  const existe = new Set(
    (dusExistants || [])
      .filter(d => d.categorie === 'loyer')
      .map(d => `${d.restaurant_id}|${d.mois}`)
  )
  const out = []
  for (const l of loyers || []) {
    if (!l.actif || !l.mois_depart) continue
    for (const mois of moisEntre(l.mois_depart, moisCourant)) {
      if (existe.has(`${l.restaurant_id}|${mois}`)) continue
      out.push({
        categorie: 'loyer',
        restaurant_id: l.restaurant_id,
        mois,
        montant_du: n(l.montant),
        echeance: echeancePostPayee(mois, l.jour_echeance),
      })
    }
  }
  return out
}

// ── Montants fixes et baux ───────────────────────────────────────────────────

// Contrat de bail : une ligne par an, créée dès le 1er du mois qui précède sa
// date limite. Les années dont la date tombe avant le mois de départ sont ignorées.
export function bailsACreer(f, moisCourant) {
  if (!f?.actif || !f.mois_depart || !f.bail_mois || !f.bail_jour) return []
  const out = []
  const depart = premierDuMois(f.mois_depart)
  for (let an = Number(depart.slice(0, 4)); an <= Number(moisCourant.slice(0, 4)) + 1; an++) {
    const moisEch = `${an}-${String(f.bail_mois).padStart(2, '0')}-01`
    if (moisEch < depart || decalerMois(moisEch, -1) > moisCourant) continue
    out.push({
      categorie: 'bail', restaurant_id: f.restaurant_id, mois: moisEch,
      montant_du: n(f.montant), echeance: jourDuMois(moisEch, f.bail_jour),
    })
  }
  return out
}

// Impôts, ITS, TEE (montant fixe, une ligne par mois consommé) et baux : les
// lignes manquantes jusqu'au mois courant.
export function chargesFixesACreer(fixes = [], echeances = [], dusExistants = [], moisCourant) {
  const existe = new Set((dusExistants || []).map(d => `${d.categorie}|${d.restaurant_id}|${d.mois}`))
  const out = []
  for (const f of fixes || []) {
    if (!f.actif || !f.mois_depart || !(n(f.montant) > 0)) continue
    const lignes = f.categorie === 'bail'
      ? bailsACreer(f, moisCourant)
      : CATEGORIES_MONTANT_FIXE.includes(f.categorie)
        ? moisEntre(f.mois_depart, moisCourant).map(mois => ({
          categorie: f.categorie, restaurant_id: f.restaurant_id, mois, montant_du: n(f.montant),
          echeance: echeancePostPayee(mois, jourCommun(echeances, f.categorie)),
        }))
        : []
    for (const l of lignes) if (!existe.has(`${l.categorie}|${l.restaurant_id}|${l.mois}`)) out.push(l)
  }
  return out
}

// Réglage d'un loyer : chaque mois coché devient un dû au montant réglé ; un
// mois décoché sans paiement disparaît. Un mois déjà entamé par un paiement ne
// bouge pas (ni montant, ni suppression). Seuls les mois proposés à l'écran
// sont touchés : un dû plus ancien, hors liste, reste tel quel.
export function planReglageLoyer({
  restaurantId, montant, jourEcheance, moisCoches = [], moisProposes = [], dusExistants = [], paiements = [],
}) {
  const parDu = paiementsParDu(paiements)
  const dus = (dusExistants || []).filter(d => d.categorie === 'loyer' && d.restaurant_id === restaurantId)
  const coches = new Set(moisCoches)
  const aCreer = []
  const aModifier = []
  const aSupprimer = []
  for (const mois of [...coches].sort()) {
    const echeance = echeancePostPayee(mois, jourEcheance)
    const du = dus.find(d => d.mois === mois)
    if (!du) {
      aCreer.push({ categorie: 'loyer', restaurant_id: restaurantId, mois, montant_du: n(montant), echeance })
    } else if (!parDu[du.id]?.length && (n(du.montant_du) !== n(montant) || du.echeance !== echeance)) {
      aModifier.push({ ...du, montant_du: n(montant), echeance })
    }
  }
  for (const du of dus) {
    if (moisProposes.includes(du.mois) && !coches.has(du.mois) && !parDu[du.id]?.length) aSupprimer.push(du)
  }
  return { aCreer, aModifier, aSupprimer }
}

// Une ligne par restaurant : ce qu'il reste à payer (mois consommés terminés
// seulement : le loyer du mois en cours n'est dû que le mois prochain) et les
// mois encore ouverts, du plus ancien au plus récent.
export function resumeLoyersParRestaurant(dus = [], paiements = [], moisCourant) {
  const parDu = paiementsParDu(paiements)
  const parResto = {}
  for (const du of dus || []) {
    if (du.categorie !== 'loyer') continue
    const r = (parResto[du.restaurant_id] ||= { restaurant_id: du.restaurant_id, reste: 0, ouverts: [] })
    const reste = resteDu(du, parDu[du.id])
    if (reste <= 0) continue
    r.ouverts.push(du)
    if (!du.mois || du.mois < moisCourant) r.reste += reste
  }
  for (const r of Object.values(parResto)) r.ouverts.sort((a, b) => (a.mois || '').localeCompare(b.mois || ''))
  return parResto
}

// Répartit un versement sur plusieurs mois choisis : du plus ancien au plus
// récent, chacun jusqu'à son reste ; l'excédent éventuel va sur le dernier.
export function repartirPaiement(montant, dusChoisis = [], paiementsExistants = []) {
  let restant = n(montant)
  if (restant <= 0 || !dusChoisis?.length) return []
  const parDu = paiementsParDu(paiementsExistants)
  const tries = [...dusChoisis].sort((a, b) => (a.mois || '').localeCompare(b.mois || ''))
  const out = []
  tries.forEach((du, i) => {
    if (restant <= 0) return
    const dernier = i === tries.length - 1
    const part = dernier ? restant : Math.min(restant, resteDu(du, parDu[du.id]))
    if (part > 0) {
      out.push({ du_id: du.id, montant: part })
      restant -= part
    }
  })
  return out
}

// ── Droits ───────────────────────────────────────────────────────────────────

export const NIVEAUX = {
  proprietaire: 'Propriétaire (tout)',
  lecture: 'Lecture',
  saisie_rh: 'Saisie des charges (RH)',
}

const PERMISSIONS = {
  proprietaire: [
    'voir_vue', 'voir_banque', 'saisir_banque', 'voir_a_payer', 'voir_dettes',
    'saisir_dus', 'saisir_salaires', 'saisir_charges', 'payer', 'gerer_droits',
    'voir_partenaires', 'recevoir_partenaires', 'regler_partenaires',
    'voir_resultats', 'voir_coffre', 'voir_direction',
  ],
  // Les autres managers voient les partenaires et marquent « reçu » (maquette validée).
  lecture: ['voir_vue', 'voir_banque', 'voir_a_payer', 'voir_partenaires', 'recevoir_partenaires', 'voir_resultats'],
  // Le RH saisit les sept charges en série (loyers compris) et leurs réglages.
  saisie_rh: ['voir_a_payer', 'saisir_salaires', 'saisir_charges'],
}

export function niveauTresorerie(role, userId, droits = []) {
  const ligne = (droits || []).find(d => d.user_id && d.user_id === userId)
  if (ligne && PERMISSIONS[ligne.niveau]) return ligne.niveau
  if (role === 'manager' || role === 'directeur') {
    const proprietaireDesigne = (droits || []).some(d => d.niveau === 'proprietaire')
    return proprietaireDesigne ? 'lecture' : 'proprietaire'
  }
  if (role === 'rh') return 'saisie_rh'
  return null
}

export function peut(niveau, action) {
  return !!(niveau && PERMISSIONS[niveau]?.includes(action))
}

// Onglets de « À payer » : les sept charges, puis la dette récente et les
// dettes (toutes catégories confondues).
export const ONGLETS_A_PAYER = [...CATEGORIES_SERIE, 'dette_recente', 'dette']
export const LIBELLES_ONGLET = { ...LIBELLES_CATEGORIE, bail: 'Bail', dette_recente: 'Dette récente' }

export function categoriesVisibles(niveau) {
  if (niveau === 'saisie_rh') return [...CATEGORIES_SERIE]
  if (!peut(niveau, 'voir_a_payer')) return []
  return ONGLETS_A_PAYER.filter(c => c !== 'dette' || peut(niveau, 'voir_dettes'))
}

// ── Affichage ────────────────────────────────────────────────────────────────

export function fmt(v) {
  return Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')
}

// Saisie d'un montant FCFA : chiffres seulement, entier.
export function lireMontant(texte) {
  const s = String(texte ?? '').replace(/[^\d-]/g, '')
  if (!s || s === '-') return null
  const v = parseInt(s, 10)
  return Number.isFinite(v) ? v : null
}
