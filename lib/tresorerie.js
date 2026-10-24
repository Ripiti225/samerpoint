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

// Passées en fournisseurs administratifs le 12/10/2026 (lib/fournisseursAdmin.js) :
// plus créées, plus affichées ni rappelées. Les lignes déjà en base restent pour
// le résultat net des mois passés (lib/chargesMois.js les lit directement).
export const CATEGORIES_ADMINISTRATIVES = ['cnps', 'impot', 'its', 'tee', 'bail']
export const CATEGORIES_TRESORERIE = CATEGORIES_SERIE.filter(c => !CATEGORIES_ADMINISTRATIVES.includes(c))

export function sansChargesAdministratives(dus = []) {
  return (dus || []).filter(d => !CATEGORIES_ADMINISTRATIVES.includes(d.categorie))
}

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
  impot: 'Timbre',
  its: 'ITS',
  tee: 'TEE',
  bail: 'Contrats de bail',
  autre: 'Autres charges',
  admin: 'Admin',
  dette: 'Dettes',
  // Pas une catégorie de dû : les prévisions sur un droit (lib/droitsAnciensTravailleurs.js).
  anciens_travailleurs: 'Ancien travailleur',
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

// La retenue sur litiges (salaires) diminue ce qu'il reste à payer.
export function resteDu(du, paiements = []) {
  return Math.max(0, n(du?.montant_du) - n(du?.retenue_litiges) - totalPaye(paiements))
}

// Dette augmentée par des ajouts (supabase_tresorerie_dettes_ajouts.sql) :
// montant_du porte déjà le total ; le départ est ce qui reste sans les ajouts.
// Ajouts du plus ancien au plus récent.
export function historiqueDette(du, ajouts = []) {
  const siens = (ajouts || []).filter(a => a.du_id === du?.id)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''))
  const totalAjouts = siens.reduce((s, a) => s + n(a.montant), 0)
  return { depart: Math.max(0, n(du?.montant_du) - totalAjouts), ajouts: siens, totalAjouts, total: n(du?.montant_du) }
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

// ── Accueil ──────────────────────────────────────────────────────────────────

// Trésorerie nette réelle = banque + espèces + têtes de fond − prévisions ;
// trésorerie = la même chose + partenaires à recevoir. « Espèces » et les
// comptes « Tête de fond … » (OM, Wave, Djamo) sont détaillés à part.
export function syntheseTresorerie({ comptes = [], partenaires = 0, prevu = 0 }) {
  let banque = 0
  let especes = 0
  let tetes = 0
  let cotisations = 0
  for (const c of comptes || []) {
    const solde = soldeCompte(c.mouvements)
    if (c.nom === 'Espèces') especes += solde
    else if (estTeteDeFond(c)) tetes += solde
    else if (estCompteCotisation(c)) cotisations += solde
    else banque += solde
  }
  const dispo = banque + especes + tetes + cotisations
  return {
    banque, especes, tetes, cotisations, partenaires: n(partenaires), prevu: n(prevu),
    tresorerie: dispo + n(partenaires),
    nette: dispo - n(prevu),
  }
}

// Comptes « Cotisation salaire » et « Cotisations autres » (lib/cotisations.js).
export function estCompteCotisation(compte) {
  return compte?.nom === 'Cotisation salaire' || compte?.nom === 'Cotisations autres'
}

export function estTeteDeFond(compte) {
  return String(compte?.nom || '').startsWith('Tête de fond')
}

// Dépenses du mois : pour chaque série (catégorie + restaurant), la plus
// ancienne charge non payée dont la date limite n'est pas passée. Charges à
// échéance seulement ; triées par date limite.
export function depensesDuMois(dus = [], paiements = [], aujourdhui) {
  const parDu = paiementsParDu(paiements)
  const parSerie = {}
  for (const d of dus || []) {
    if (!CATEGORIES_SERIE.includes(d.categorie) || !d.echeance || d.echeance < aujourdhui) continue
    if (resteDu(d, parDu[d.id]) <= 0) continue
    const cle = `${d.categorie}|${d.restaurant_id}`
    if (!parSerie[cle] || d.echeance < parSerie[cle].echeance) parSerie[cle] = d
  }
  return Object.values(parSerie).sort((a, b) => a.echeance.localeCompare(b.echeance))
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
//  - dette : passée à la main (en_dette_depuis), créancier (sauf prêt en
//    espèces : dette récente jusqu'au passage à la main), ou charge en série
//    en retard qu'une charge plus récente de la même série (catégorie +
//    restaurant), elle aussi en retard avec un reste, a rejointe ;
//  - dette récente : charge en série en retard, la plus récente de sa série ;
//  - à payer : le reste (date limite pas passée, autres charges).
export function classerDu(du, dus = [], parDu = {}, aujourdhui) {
  if (resteDu(du, parDu[du.id]) === 0) return 'paye'
  if (du.en_dette_depuis) return 'dette'
  // Un prêt en espèces arrive en dette récente ; il passe en Dette à la main.
  if (du.categorie === 'dette') return du.est_pret ? 'dette_recente' : 'dette'
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

// Timbre, ITS, TEE (montant fixe, une ligne par mois consommé) et baux : les
// lignes manquantes jusqu'au mois courant.
export function chargesFixesACreer(fixes = [], echeances = [], dusExistants = [], moisCourant) {
  const existe = new Set((dusExistants || []).map(d => `${d.categorie}|${d.restaurant_id}|${d.mois}`))
  // Un bail par an : une ligne déjà saisie pour l'année compte, quelle que soit sa date.
  const bailAn = new Set((dusExistants || []).filter(d => d.categorie === 'bail' && d.mois)
    .map(d => `${d.restaurant_id}|${d.mois.slice(0, 4)}`))
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
    for (const l of lignes) {
      if (existe.has(`${l.categorie}|${l.restaurant_id}|${l.mois}`)) continue
      if (l.categorie === 'bail' && bailAn.has(`${l.restaurant_id}|${l.mois.slice(0, 4)}`)) continue
      out.push(l)
    }
  }
  return out
}

// ── Saisie groupée (un montant par restaurant, en une fois) ─────────────────

// Un mois de salaires, CNPS, timbre, ITS ou TEE. montants : { [restaurant_id]:
// nombre | null } (null = champ vide). Ligne absente + montant → créée ; ligne
// sans paiement + montant différent → corrigée ; ligne sans paiement + champ
// vide → supprimée, ou mise à 0 pour les montants fixes (sinon la création
// automatique la referait) ; ligne déjà payée en partie → jamais touchée.
export function planSaisieGroupee({ categorie, mois, montants = {}, jour, dus = [], paiements = [] }) {
  const parDu = paiementsParDu(paiements)
  const echeance = echeancePostPayee(mois, jour)
  const aCreer = []
  const aModifier = []
  const aSupprimer = []
  for (const [restaurantId, valeur] of Object.entries(montants)) {
    const du = (dus || []).find(d => d.categorie === categorie && d.restaurant_id === restaurantId && d.mois === mois)
    const v = valeur === null || valeur === undefined ? 0 : n(valeur)
    if (du && parDu[du.id]?.length) continue
    if (!du) {
      if (v > 0) aCreer.push({ categorie, restaurant_id: restaurantId, mois, montant_du: v, echeance })
    } else if (v <= 0) {
      if (!CATEGORIES_MONTANT_FIXE.includes(categorie)) aSupprimer.push(du)
      else if (n(du.montant_du) !== 0) aModifier.push({ ...du, montant_du: 0 })
    } else if (v !== n(du.montant_du) || du.echeance !== echeance) {
      aModifier.push({ ...du, montant_du: v, echeance })
    }
  }
  return { aCreer, aModifier, aSupprimer }
}

// Baux d'une année : montant + date limite (jour, mois) par restaurant.
// saisies : { [restaurant_id]: { montant, jour, mois } | null }. Rend les
// réglages à enregistrer (les années suivantes se créent seules avec ces
// valeurs) et les lignes de l'année. Champ vidé = plus de bail pour ce
// restaurant : réglage arrêté, ligne de l'année retirée si rien n'est payé.
export function planSaisieBaux({ an, saisies = {}, dus = [], paiements = [], fixes = [], moisCourant }) {
  const parDu = paiementsParDu(paiements)
  const reglages = []
  const aCreer = []
  const aModifier = []
  const aSupprimer = []
  for (const [restaurantId, s] of Object.entries(saisies)) {
    const du = (dus || []).find(d => d.categorie === 'bail' && d.restaurant_id === restaurantId && d.mois?.startsWith(`${an}-`))
    const fixe = (fixes || []).find(f => f.categorie === 'bail' && f.restaurant_id === restaurantId)
    if (du && parDu[du.id]?.length) continue
    if (!s || !(n(s.montant) > 0)) {
      if (du) aSupprimer.push(du)
      if (fixe?.actif) {
        reglages.push({
          restaurantId, montant: n(fixe.montant), bailMois: fixe.bail_mois, bailJour: fixe.bail_jour,
          moisDepart: fixe.mois_depart, actif: false,
        })
      }
      continue
    }
    const montant = n(s.montant)
    const moisEch = `${an}-${String(s.mois).padStart(2, '0')}-01`
    const echeance = jourDuMois(moisEch, s.jour)
    const regle = fixe?.actif && n(fixe.montant) === montant && fixe.bail_mois === n(s.mois) && fixe.bail_jour === n(s.jour)
    if (!regle) {
      reglages.push({
        restaurantId, montant, bailMois: n(s.mois), bailJour: n(s.jour),
        moisDepart: fixe?.mois_depart || moisCourant, actif: true,
      })
    }
    if (!du) {
      aCreer.push({ categorie: 'bail', restaurant_id: restaurantId, mois: moisEch, montant_du: montant, echeance })
    } else if (du.mois !== moisEch || n(du.montant_du) !== montant || du.echeance !== echeance) {
      aModifier.push({ ...du, mois: moisEch, montant_du: montant, echeance })
    }
  }
  return { reglages, aCreer, aModifier, aSupprimer }
}

// Réglage d'un loyer. moisCoches : mois passés encore dus ; moisPayes : mois
// passés déjà payés AVANT la trésorerie (ils comptent dans le résultat net,
// sans dette ni mouvement en banque : paiement « avant »).
//  - chaque mois voulu devient un dû au montant réglé ; un mois déjà payé est
//    soldé par un paiement « avant » (payesAvant) ; un mois repassé de « payé »
//    à « dû » perd ses paiements « avant » (annulerAvant) ;
//  - un mois retiré disparaît s'il n'a aucun vrai paiement ;
//  - un mois entamé par un vrai paiement ne bouge pas ; seuls les mois
//    proposés à l'écran sont touchés.
export function planReglageLoyer(reglage) {
  return planReglageMois({ ...reglage, categorie: 'loyer' })
}

// Même réglage pour toute charge en série d'un restaurant (TEE, ITS, timbre,
// CNPS…). montantsParMois : montant propre à un mois (CNPS) ; à défaut, montant.
export function planReglageMois({
  categorie, restaurantId, montant = 0, montantsParMois = {}, jourEcheance,
  moisCoches = [], moisPayes = [], moisProposes = [], dusExistants = [], paiements = [],
}) {
  const parDu = paiementsParDu(paiements)
  const montantDe = mois => n(montantsParMois?.[mois] ?? montant)
  const dus = (dusExistants || []).filter(d => d.categorie === categorie && d.restaurant_id === restaurantId)
  const payes = new Set(moisPayes)
  const voulus = new Set([...moisCoches, ...moisPayes])
  const vrais = id => (parDu[id] || []).filter(p => p.source !== 'avant')
  const avant = id => (parDu[id] || []).filter(p => p.source === 'avant')
  const aCreer = []
  const aModifier = []
  const aSupprimer = []
  const payesAvant = []
  const annulerAvant = []
  for (const mois of [...voulus].sort()) {
    const echeance = echeancePostPayee(mois, jourEcheance)
    const du = dus.find(d => d.mois === mois)
    if (du && vrais(du.id).length) continue
    if (!du) {
      aCreer.push({ categorie, restaurant_id: restaurantId, mois, montant_du: montantDe(mois), echeance })
    } else if (!parDu[du.id]?.length && (n(du.montant_du) !== montantDe(mois) || du.echeance !== echeance)) {
      aModifier.push({ ...du, montant_du: montantDe(mois), echeance })
    }
    if (payes.has(mois)) {
      if (!du || resteDu(du, parDu[du.id]) > 0) payesAvant.push(mois)
    } else if (du && avant(du.id).length) {
      annulerAvant.push(du.id)
    }
  }
  for (const du of dus) {
    if (moisProposes.includes(du.mois) && !voulus.has(du.mois) && !vrais(du.id).length) aSupprimer.push(du)
  }
  return { aCreer, aModifier, aSupprimer, payesAvant, annulerAvant }
}

// Une ligne par restaurant : ce qu'il reste à payer (mois consommés terminés
// seulement : le loyer du mois en cours n'est dû que le mois prochain) et les
// mois encore ouverts, du plus ancien au plus récent.
export function resumeLoyersParRestaurant(dus = [], paiements = [], moisCourant, categorie = 'loyer') {
  const parDu = paiementsParDu(paiements)
  const parResto = {}
  for (const du of dus || []) {
    if (du.categorie !== categorie) continue
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
    'voir_resultats', 'voir_coffre', 'voir_direction', 'saisir_anciens',
  ],
  // Les autres managers voient les partenaires et marquent « reçu » (maquette validée).
  // Ils déclarent aussi les droits des anciens travailleurs (sans les payer).
  lecture: ['voir_vue', 'voir_banque', 'voir_a_payer', 'voir_partenaires', 'recevoir_partenaires', 'voir_resultats', 'saisir_anciens'],
  // Le RH saisit les sept charges en série (loyers compris) et leurs réglages
  // et, comme les managers, déclare les droits des anciens travailleurs.
  saisie_rh: ['voir_a_payer', 'saisir_salaires', 'saisir_charges', 'saisir_anciens'],
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

// Onglets de « À payer » : loyers, salaires, anciens travailleurs, puis la
// dette récente et les dettes (toutes catégories confondues).
// Anciens travailleurs : fournisseurs administratifs à part (lib/droitsAnciensTravailleurs.js).
export const ONGLETS_A_PAYER = [...CATEGORIES_TRESORERIE, 'anciens_travailleurs', 'dette_recente', 'dette']
export const LIBELLES_ONGLET = { ...LIBELLES_CATEGORIE, bail: 'Bail', dette_recente: 'Dette récente', anciens_travailleurs: 'Anciens travailleurs' }

export function categoriesVisibles(niveau) {
  if (niveau === 'saisie_rh') return [...CATEGORIES_TRESORERIE, 'anciens_travailleurs']
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
