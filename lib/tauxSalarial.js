// ──────────────────────────────────────────────────────────────────────────────
// Taux salarial d'un restaurant sur une période (choix du 18/10/2026).
//
//   taux = (salaires payés dans les points + paies du gérant
//           + état de salaires du RH) ÷ vente machine
//
//   • Salaires payés dans les points : `presences.paye` (caissiers au shift,
//     gérant à l'écran Présences).
//   • Paies du gérant : « Déductions gérant » (draft_gerant.paies).
//   • État de salaires du RH : la charge « Salaires » de Trésorerie → À payer
//     (ou l'ancien écran Charges), sur le MOIS TRAVAILLÉ, EN ENTIER : la part
//     cotisée n'est pas retirée. Les versements « Cotisation salaire » des
//     points ne comptent donc pas (ce serait le même salaire deux fois), pas
//     plus que « Salaire ancien » et « Zone 4 ».
//   • L'état est mensuel : il ne compte que pour les mois que la période couvre
//     du 1er au dernier jour. Sur 7 jours ou sur le mois en cours, il est
//     écarté, et l'écran le dit.
//
// Pur : testé par lib/tauxSalarial.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

import { categorieAncienne } from './chargesMois.js'
import { estMoisEntier, moisCouverts } from './periodeComparee.js'

/** Au-delà de ce taux, la jauge passe au rouge et une alerte s'affiche. */
export const SEUIL_TAUX_SALARIAL = 25

const nombre = v => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// Dernier jour (AAAA-MM-JJ) du mois 'AAAA-MM'.
function dernierJour(mois) {
  const [a, m] = mois.split('-').map(Number)
  return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Mois (AAAA-MM) couverts par la période du 1er au dernier jour. */
export function moisComplets(debut, fin) {
  return moisCouverts(debut, fin).filter(m => {
    const d = `${m}-01`
    const f = dernierJour(m)
    return d >= debut && f <= fin && estMoisEntier(d, f)
  })
}

/** Vrai pour une ligne de charges (lib/chargesMois.fusionnerCharges) qui est l'état de salaires. */
export function estLigneSalaires(c) {
  if (!c) return false
  if (c.source === 'tresorerie') return c.categorie === 'salaire'
  return categorieAncienne(c.libelle) === 'salaire'
}

/**
 * @param {object} args
 * @param {object[]} [args.presences]   [{ paye }]
 * @param {number}   [args.paiesGerant] total des paies du gérant
 * @param {object[]} [args.charges]     lignes de chargerChargesMois (tous restaurants possibles)
 * @param {string}   args.restaurantId
 * @param {string}   args.debut         AAAA-MM-JJ
 * @param {string}   args.fin           AAAA-MM-JJ
 * @param {number}   args.ventes        vente machine de la période
 */
export function tauxSalarial({ presences = [], paiesGerant = 0, charges = [], restaurantId, debut, fin, ventes = 0 } = {}) {
  const caissiers = (presences || []).reduce((s, p) => s + nombre(p?.paye), 0)
  const gerant = nombre(paiesGerant)

  const complets = debut && fin ? moisComplets(debut, fin) : []
  const parMois = {}
  for (const c of charges || []) {
    if (c?.restaurant_id !== restaurantId || !estLigneSalaires(c)) continue
    parMois[c.mois] = (parMois[c.mois] || 0) + nombre(c.montant)
  }
  const etat = complets.reduce((s, m) => s + (parMois[m] || 0), 0)
  const moisSansEtat = complets.filter(m => !parMois[m])

  const total = caissiers + gerant + etat
  return {
    caissiers,
    gerant,
    etat,
    total,
    pct: ventes > 0 ? (total / ventes) * 100 : 0,
    moisComplets: complets,
    moisSansEtat,
    // Période sans mois entier : l'état du RH n'entre pas dans le calcul.
    etatHorsPeriode: complets.length === 0,
  }
}

/** Le même calcul pour plusieurs restaurants, additionné. */
export function tauxSalarialTotal(lignes = [], ventes = 0) {
  const somme = cle => lignes.reduce((s, l) => s + nombre(l?.[cle]), 0)
  const total = somme('total')
  return {
    caissiers: somme('caissiers'),
    gerant: somme('gerant'),
    etat: somme('etat'),
    total,
    pct: ventes > 0 ? (total / ventes) * 100 : 0,
    moisComplets: lignes[0]?.moisComplets || [],
    moisSansEtat: [...new Set(lignes.flatMap(l => l?.moisSansEtat || []))].sort(),
    etatHorsPeriode: lignes.length ? lignes.every(l => l?.etatHorsPeriode) : true,
  }
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** 'AAAA-MM' → « septembre 2026 ». */
export function libelleMoisSalaires(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  return MOIS_FR[m - 1] ? `${MOIS_FR[m - 1]} ${a}` : String(mois)
}

/** La phrase sous la jauge, ou null quand tout est compté. */
export function noteTauxSalarial(t) {
  if (!t) return null
  if (t.etatHorsPeriode) return 'État de salaires du RH non compté : la période ne couvre pas un mois entier (choisissez « Mois préc. »).'
  if (t.moisSansEtat.length) return `État de salaires pas encore saisi par le RH : ${t.moisSansEtat.map(libelleMoisSalaires).join(', ')}.`
  return null
}
