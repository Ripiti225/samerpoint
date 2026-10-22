// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — coffre de sécurité, dépenses direction et résultat net par
// restaurant et par mois. Logique pure.
//
// Règles (validées avec M. Zreik, 01/10/2026) :
//  - Le coffre est de l'argent réel mis à part : il ne compte pas dans la
//    trésorerie nette. Dépôt / retrait depuis ou vers BACI, SIB ou espèces.
//  - Dépenses direction : réparation, matériel, équipement comptent dans le
//    résultat du restaurant ; fond (simple transfert), investissement et
//    retraits personnels non.
//  - Résultat net = encaissé net des points validés (calcul de l'écran Charges,
//    SANS les litiges) − charges du mois − dépenses direction comptées − pubs
//    − hausse du crédit fournisseurs dans le mois (10/10/2026 : une marchandise
//    reçue à crédit est une dépense du mois ; une dette qui baisse remonte le
//    résultat — lib/creditFournisseursMois.js).
//
// Tests : lib/direction.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { COEFFICIENTS } from './constants.js'

export const CATEGORIES_DIRECTION = [
  { id: 'fond', label: 'Fond', compteDansResultat: false, aide: 'Rechargement du fond de caisse : simple transfert' },
  // Marchandise donnée au restaurant : ne passe pas par son point, donc déduite
  // de son résultat comme une charge (choisie sous « Fond », voir FeuilleDepense).
  { id: 'fond_nature', label: 'Fond en nature', compteDansResultat: true, aide: 'Marchandise donnée au restaurant (sucreries…)' },
  { id: 'reparation', label: 'Réparation', compteDansResultat: true },
  { id: 'materiel', label: 'Matériel', compteDansResultat: true, aide: 'Assiettes, fourchettes…' },
  { id: 'equipement', label: 'Équipement', compteDansResultat: true, aide: 'Machine à viande, friteuse…' },
  { id: 'investissement', label: 'Investissement', compteDansResultat: false, aide: 'Travaux, mobilier, réfrigérateur…' },
  { id: 'retrait_perso', label: 'Retrait perso', compteDansResultat: false },
  // Payé depuis Crédits fournisseurs (« Payé par la direction ») : charge du
  // restaurant ; le crédit du fournisseur baisse d'autant (lib/fournisseursAdmin.js).
  { id: 'administratif', label: 'Fournisseur administratif', compteDansResultat: true, manuel: false },
]

const n = v => Number(v) || 0

// Catégories proposées pour une « autre charge » notée avant d'être payée.
export const CATEGORIES_CHARGE_A_PAYER = [
  ...CATEGORIES_DIRECTION.filter(c => ['reparation', 'materiel', 'equipement', 'investissement'].includes(c.id)),
  { id: 'divers', label: 'Autre', compteDansResultat: true, aide: 'Électricité, entretien, prestataire…' },
]

export function categorieDirection(id) {
  return CATEGORIES_DIRECTION.find(c => c.id === id) || CATEGORIES_CHARGE_A_PAYER.find(c => c.id === id) || null
}

export function compteDansResultat(depense) {
  return !!(depense?.restaurant_id && categorieDirection(depense.categorie)?.compteDansResultat)
}

// ── Corriger un fond (Modifier / Répartir) ──────────────────────────────────
// Règle M. Zreik (12/10/2026) : des espèces ajoutées par une correction vont
// dans le FC reçu du point du jour de la modification, et le gérant est prévenu.
// Le serveur fait le travail (supabase_tresorerie_direction_modifier.sql) ;
// ici, l'aperçu et les variations à annoncer.

// Espèces données à un restaurant par cette ligne (passent par son point).
export function especesDonnees(dep) {
  return dep?.categorie === 'fond' && dep?.restaurant_id ? n(dep.montant) : 0
}

// Variation des espèces de chaque restaurant entre deux versions d'une dépense.
// Rend [{ restaurant_id, delta }] sans les variations nulles.
export function variationsFond(avant, apres) {
  const parResto = {}
  if (avant?.restaurant_id) parResto[avant.restaurant_id] = -especesDonnees(avant)
  if (apres?.restaurant_id) parResto[apres.restaurant_id] = (parResto[apres.restaurant_id] || 0) + especesDonnees(apres)
  return Object.entries(parResto).filter(([, d]) => d !== 0).map(([restaurant_id, delta]) => ({ restaurant_id, delta }))
}

// Peut-on répartir cette ligne ? Un fond donné à un restaurant, pas une
// ligne de correction, pas déjà réparti (enfants = lignes qui la corrigent).
export function repartissable(dep, enfants = []) {
  return !!(dep && ['fond', 'fond_nature'].includes(dep.categorie) && dep.restaurant_id
    && !dep.origine_id && !(enfants || []).length)
}

// Aperçu d'une répartition : part espèces saisie → { nature, delta, erreur }.
// delta = espèces ajoutées (+) ou retirées (−) du FC reçu du point du jour.
export function planRepartition(dep, especes) {
  const total = n(dep?.montant)
  const e = n(especes)
  if (e < 0 || e > total) return { nature: null, delta: 0, erreur: `La part en espèces doit être entre 0 et ${total}.` }
  const delta = e - especesDonnees(dep)
  if (delta === 0) return { nature: total - e, delta, erreur: 'C\'est déjà la bonne répartition.' }
  return { nature: total - e, delta, erreur: null }
}

// ── Coffre ──────────────────────────────────────────────────────────────────

export function soldeCoffre(mouvements = []) {
  return (mouvements || []).reduce((s, m) => s + n(m.montant), 0)
}

// Emprunt au coffre : « rembourse » une fois rendu ; « a_rembourser » dès la
// date choisie, ou dès qu'une réception du partenaire choisi est marquée
// « reçu » APRÈS l'emprunt (la prochaine réception Glovo, Wave…) ; sinon
// « en_cours ». Simple rappel : la trésorerie ne bouge pas.
export function statutEmprunt(emprunt, receptions = [], aujourdhui) {
  if (emprunt.rembourse_le) return 'rembourse'
  if (emprunt.rembourser_le && aujourdhui >= emprunt.rembourser_le) return 'a_rembourser'
  if (emprunt.rembourser_partenaire && (receptions || []).some(r => r.type === 'recu'
    && r.partenaire === emprunt.rembourser_partenaire && r.created_at > emprunt.created_at)) return 'a_rembourser'
  return 'en_cours'
}

export function resteARembourser(emprunts = []) {
  return (emprunts || []).filter(e => !e.rembourse_le).reduce((s, e) => s + n(e.montant), 0)
}

// Objectif du mois ; sans objectif fixé, celui du mois précédent le plus proche.
export function objectifDuMois(objectifs = [], mois) {
  const avant = (objectifs || []).filter(o => o.mois <= mois).sort((a, b) => b.mois.localeCompare(a.mois))
  return avant.length ? n(avant[0].montant) : 0
}

export function progression(solde, objectif) {
  if (!objectif || objectif <= 0) return null
  return Math.max(0, Math.round((n(solde) / objectif) * 100))
}

// ── Résultat net ────────────────────────────────────────────────────────────

// Encaissé net d'un point validé — formule du bénéfice sans charges (BSC).
// Sans aucun shift (historique Google Sheets importé, nov. 2025 → 10 mai 2026),
// les espèces et Wave/OM/Djamo manqueraient : on prend le BSC enregistré sur la
// journée. Toute vraie journée validée a des shifts (vérifié le 19/10/2026).
export function encaisseNetPoint(point, shifts = []) {
  if (!shifts?.length) return n(point.benefice_sc)
  const s = (shifts || []).reduce((acc, sh) => ({
    om: acc.om + n(sh.om), wave: acc.wave + n(sh.wave), djamo: acc.djamo + n(sh.djamo), espece: acc.espece + n(sh.espece),
  }), { om: 0, wave: 0, djamo: 0, espece: 0 })
  return n(point.yango_tab) * COEFFICIENTS.YANGO
    + n(point.glovo_tab) * COEFFICIENTS.GLOVO
    + s.om * COEFFICIENTS.OM + s.wave * COEFFICIENTS.WAVE + s.djamo * COEFFICIENTS.DJAMO
    + s.espece - n(point.depenses_gerant_caisse_total)
}

const moisDe = iso => (iso ? iso.slice(0, 7) : '')

// Rend { [restaurant_id]: { [AAAA-MM]: { encaisse, charges, direction, pubs,
//   glovoRemboursements, glovoTempsAttente, creditDebut, creditFin, creditAjustements,
//   variationCredit, net, nbPoints } } }.
// points : points VALIDÉS (id, restaurant_id, date, yango_tab, glovo_tab, depenses_gerant_caisse_total, benefice_sc)
// shifts : points_shifts (point_id, om, wave, djamo, espece)
// charges : table charges (restaurant_id, mois 'AAAA-MM', montant)
// depenses : dépenses direction ; pubs : lignes partenaires de type 'pub'
// creditFournisseurs : { [restaurant_id]: { [AAAA-MM]: { debut, fin, ajustements, variation } } }
// litigesGlovo : litiges_glovo (restaurant_id, date, type, montant). Seuls `remboursement`
//   et `temps_attente` sont retirés : argent que Glovo garde vraiment. Les autres litiges
//   (écart, tapé ±, inventaire…) sont déjà dans l'encaissé (décidé le 19/10/2026).
export function resultatsParRestoMois({ points = [], shifts = [], charges = [], depenses = [], pubs = [], creditFournisseurs = {}, litigesGlovo = [], mois = [] }) {
  const voulu = new Set(mois)
  const out = {}
  const cell = (r, m) => {
    if (!out[r]) out[r] = {}
    if (!out[r][m]) {
      out[r][m] = {
        encaisse: 0, litigesRetenus: 0, charges: 0, direction: 0, pubs: 0,
        glovoRemboursements: 0, glovoTempsAttente: 0,
        creditDebut: null, creditFin: null, creditAjustements: 0, variationCredit: 0, net: 0, nbPoints: 0,
      }
    }
    return out[r][m]
  }

  const shiftsParPoint = {}
  for (const s of shifts) (shiftsParPoint[s.point_id] ||= []).push(s)

  for (const p of points) {
    const m = moisDe(p.date)
    if (!voulu.has(m) || !p.restaurant_id) continue
    const c = cell(p.restaurant_id, m)
    c.encaisse += encaisseNetPoint(p, shiftsParPoint[p.id])
    c.nbPoints += 1
  }
  for (const ch of charges) {
    if (!voulu.has(ch.mois) || !ch.restaurant_id) continue
    // Une « recette » (litiges retenus sur salaires) s'ajoute au revenu.
    if (ch.recette) cell(ch.restaurant_id, ch.mois).litigesRetenus += n(ch.montant)
    else cell(ch.restaurant_id, ch.mois).charges += n(ch.montant)
  }
  for (const d of depenses) {
    const m = moisDe(d.date)
    if (!voulu.has(m) || !compteDansResultat(d)) continue
    cell(d.restaurant_id, m).direction += n(d.montant)
  }
  for (const l of pubs) {
    const m = moisDe(l.periode_debut)
    if (l.type !== 'pub' || !voulu.has(m) || !l.restaurant_id) continue
    cell(l.restaurant_id, m).pubs += n(l.montant)
  }
  for (const l of litigesGlovo) {
    const m = moisDe(l.date)
    if (!voulu.has(m) || !l.restaurant_id) continue
    if (l.type === 'remboursement') cell(l.restaurant_id, m).glovoRemboursements += n(l.montant)
    else if (l.type === 'temps_attente') cell(l.restaurant_id, m).glovoTempsAttente += n(l.montant)
  }

  // Seulement sur un mois déjà présent : un crédit seul ne fait pas un résultat.
  for (const [r, parMois] of Object.entries(out)) {
    for (const [m, c] of Object.entries(parMois)) {
      const cr = creditFournisseurs?.[r]?.[m]
      if (!cr) continue
      c.creditDebut = cr.debut
      c.creditFin = cr.fin
      c.creditAjustements = cr.ajustements || 0
      c.variationCredit = cr.variation
    }
  }

  for (const r of Object.values(out)) {
    for (const c of Object.values(r)) {
      c.encaisse = Math.round(c.encaisse)
      c.net = c.encaisse + c.litigesRetenus - c.charges - c.direction - c.pubs - c.variationCredit
        - c.glovoRemboursements - c.glovoTempsAttente
    }
  }
  return out
}

// Paiements direction d'une fiche de GROUPE (arriérés CNPS, anciens travailleurs
// sans restaurant) : comptent au résultat « tous restaurants » seulement, jamais
// dans un restaurant pris seul (choix du 22/10/2026). Rend { [AAAA-MM]: montant }.
export function depensesGroupeParMois(depenses = [], mois = []) {
  const voulu = new Set(mois)
  const out = {}
  for (const d of depenses) {
    const m = moisDe(d.date)
    if (!voulu.has(m) || d.restaurant_id || !d.groupe_id) continue
    if (!categorieDirection(d.categorie)?.compteDansResultat) continue
    out[m] = (out[m] || 0) + n(d.montant)
  }
  return out
}

// Les k derniers mois (AAAA-MM), le plus ancien d'abord, mois courant inclus.
export function derniersMois(aujourdhui, k = 4) {
  const a = Number(aujourdhui.slice(0, 4))
  const m = Number(aujourdhui.slice(5, 7)) - 1
  const out = []
  for (let i = k - 1; i >= 0; i--) {
    const t = a * 12 + m - i
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`)
  }
  return out
}

export function bornesMois(moisAAAAMM) {
  const [a, m] = moisAAAAMM.split('-').map(Number)
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { debut: `${moisAAAAMM}-01`, fin: `${moisAAAAMM}-${String(dernier).padStart(2, '0')}` }
}
