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

export const CATEGORIES_DU = ['loyer', 'salaire', 'cnps', 'admin', 'dette']

export const LIBELLES_CATEGORIE = {
  loyer: 'Loyers',
  salaire: 'Salaires',
  cnps: 'CNPS',
  admin: 'Admin',
  dette: 'Dettes',
}

// Catégories rattachées à un restaurant et à un mois (une ligne par couple).
export const CATEGORIES_MENSUELLES = ['loyer', 'salaire', 'cnps']

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

export function calculerTresorerieNette({
  comptes = [], dus = [], paiements = [], fournisseursDus: fourn = 0,
  partenaires = 0, moisCourant = null,
}) {
  const parDu = paiementsParDu(paiements)
  const restes = { loyer: 0, salaire: 0, cnps: 0, admin: 0, dette: 0 }
  for (const du of dus || []) {
    if (!(du.categorie in restes) || !estExigible(du, moisCourant)) continue
    restes[du.categorie] += resteDu(du, parDu[du.id])
  }
  const banque = (comptes || []).reduce((s, c) => s + soldeCompte(c.mouvements), 0)
  const r = {
    banque,
    partenaires: n(partenaires),
    loyers: restes.loyer,
    salaires: restes.salaire,
    cnps: restes.cnps,
    admin: restes.admin,
    fournisseurs: n(fourn),
    dettes: restes.dette,
  }
  r.nette = r.banque + r.partenaires
    - r.loyers - r.salaires - r.cnps - r.admin - r.fournisseurs - r.dettes
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

// ── Loyers ───────────────────────────────────────────────────────────────────

// 'paye' (vert) · 'en_retard' (rouge, dès le lendemain de l'échéance) · 'a_payer' (orange)
export function statutLoyer(du, paiements, aujourdhui) {
  if (resteDu(du, paiements) === 0) return 'paye'
  if (du.echeance && aujourdhui > du.echeance) return 'en_retard'
  return 'a_payer'
}

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
        echeance: jourDuMois(mois, l.jour_echeance),
      })
    }
  }
  return out
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
  saisie_rh: 'Saisie salaires / CNPS',
}

const PERMISSIONS = {
  proprietaire: [
    'voir_vue', 'voir_banque', 'saisir_banque', 'voir_a_payer', 'voir_dettes',
    'saisir_dus', 'saisir_salaires', 'payer', 'gerer_droits',
    'voir_partenaires', 'recevoir_partenaires', 'regler_partenaires',
    'voir_resultats', 'voir_coffre', 'voir_direction',
  ],
  // Les autres managers voient les partenaires et marquent « reçu » (maquette validée).
  lecture: ['voir_vue', 'voir_banque', 'voir_a_payer', 'voir_partenaires', 'recevoir_partenaires', 'voir_resultats'],
  saisie_rh: ['voir_a_payer', 'saisir_salaires'],
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

// Onglets de « À payer » visibles pour un niveau.
export function categoriesVisibles(niveau) {
  if (niveau === 'saisie_rh') return ['salaire', 'cnps']
  if (!peut(niveau, 'voir_a_payer')) return []
  return CATEGORIES_DU.filter(c => c !== 'dette' || peut(niveau, 'voir_dettes'))
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
