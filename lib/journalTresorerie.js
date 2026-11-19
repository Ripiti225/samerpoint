// ──────────────────────────────────────────────────────────────────────────────
// Journaux BQ (Banque et Trésorerie) et OD (commissions, publicité) — logique pure.
//
// BQ : une pièce par mouvement de Trésorerie ; le compte de trésorerie selon son
// nom, la contrepartie selon ce à quoi le mouvement se rattache (partenaire,
// paiement d'un dû, dépense direction…). Ambigu ou inconnu → 471 Compte
// d'attente, avec le libellé d'origine : rien n'est perdu, le cabinet reclasse.
// OD : par restaurant, en fin de mois, commissions ESTIMÉES (taux de l'app,
// COEFFICIENTS) sur les ventes tablette et le mobile money, et publicité Glovo
// réelle (lignes partenaires « pub »).
// Spec : docs/superpowers/specs/2026-11-19-export-comptable-tresorerie-design.md
// Tests : lib/journalTresorerie.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { joursDuMois } from './clotureMois.js'
import { COEFFICIENTS } from './constants.js'
import { arrondiFranc, ecrivain } from './ecrituresComptables.js'
import { SOURCE_IMPORT_SHEETS } from './journalCaisse.js'
import { clePaie } from './journalPaie.js'

const n = v => parseFloat(v) || 0

const COMPTE_TRESORERIE = {
  'BACI': 'baci', 'SIB': 'sib', 'Espèces': 'especesDirection',
  'Tête de fond OM': 'tdfOm', 'Tête de fond Wave': 'tdfWave', 'Tête de fond Djamo': 'tdfDjamo',
  'Cotisation salaire': 'cotisSalaire', 'Cotisations autres': 'cotisAutres',
}

const CONTREPARTIE_PARTENAIRE = { yango: 'yango', glovo: 'glovo', om: 'om', wave: 'wave', djamo: 'djamo' }

const CONTREPARTIE_DU = {
  loyer: 'locations', bail: 'droitsEnregistrement', impot: 'droitsEnregistrement', tee: 'impotsTaxes',
  its: 'itsRetenu', cnps: 'cnps',
}

const CONTREPARTIE_DIRECTION = {
  fond: 'caisse', fond_nature: 'achats', reparation: 'entretien', materiel: 'petitMateriel',
  equipement: 'materielOutillage', investissement: 'autresImmobilisations', retrait_perso: 'associe',
  divers: 'chargesDiverses', administratif: 'fournisseurs',
}

function contrepartie(m, liens, paieValidee) {
  if (m.type === 'virement') return { cle: 'virementsInternes' }
  if (m.type === 'coffre') return { cle: 'coffre' }
  if (m.type === 'partenaire') {
    const p = liens.partenaires.get(m.id)
    return { cle: CONTREPARTIE_PARTENAIRE[p?.partenaire] || 'attente', restaurantId: p?.restaurant_id }
  }
  if (m.type === 'paiement') {
    const d = liens.paiements.get(m.id)
    // Salaire : solde le dû (422) si l'état de salaire du mois est validé, sinon charge (661).
    const cle = d?.categorie === 'salaire'
      ? (paieValidee.has(clePaie(d.restaurant_id, d.mois)) ? 'salairesDus' : 'personnel')
      : d?.categorie === 'autre'
        ? CONTREPARTIE_DIRECTION[d.categorie_direction]
        : CONTREPARTIE_DU[d?.categorie]
    return { cle: cle || 'attente', restaurantId: d?.restaurant_id }
  }
  if (m.type === 'direction') {
    const d = liens.direction.get(m.id)
    return { cle: CONTREPARTIE_DIRECTION[d?.categorie] || 'attente', restaurantId: d?.restaurant_id }
  }
  return { cle: 'attente' }
}

/**
 * Écritures BQ des mouvements fournis (déjà filtrés sur le mois).
 * comptes : Map compte_id → nom ; restaurants : Map id → { nom, court } ;
 * liens : { paiements, partenaires, direction } — Map mouvement_id → ligne liée ;
 * paieValidee : Set de clés clePaie (états de salaire validés).
 */
export function ecrituresTresorerie({ mouvements = [], comptes, liens, restaurants, paieValidee = new Set() }) {
  const lignes = []
  for (const m of mouvements || []) {
    const date = String(m.date).slice(0, 10)
    const { cle, restaurantId } = contrepartie(m, liens, paieValidee)
    const resto = restaurants.get(m.restaurant_id || restaurantId)
    const ecrire = ecrivain({
      journal: 'BQ', date, piece: `BQ-${date.replace(/-/g, '')}-${String(m.id).slice(0, 8)}`,
      restaurant: resto?.nom || 'Direction', lignes,
    })
    const libelle = String(m.libelle || m.type || 'Mouvement').trim()
    ecrire(COMPTE_TRESORERIE[comptes.get(m.compte_id)] || 'attente', libelle, m.montant, 'debit')
    ecrire(cle, libelle, m.montant, 'credit')
  }
  return lignes
}

/**
 * Bases des commissions du mois, par restaurant : ventes tablette des points,
 * mobile money des shifts, publicité Glovo dont la période commence dans le mois.
 * Journées des anciens Sheets exclues (comme au journal de Caisse).
 */
export function assiettesCommissions({ mois, points = [], shifts, pubs = [], restaurants }) {
  const cle = String(mois).slice(0, 7)
  const parResto = new Map()
  const base = id => {
    if (!parResto.has(id)) {
      parResto.set(id, { restaurant: restaurants.get(id) || { nom: '?', court: '?' }, restaurantId: id,
        yangoTab: 0, glovoTab: 0, om: 0, wave: 0, djamo: 0, pubGlovo: 0 })
    }
    return parResto.get(id)
  }
  for (const p of points || []) {
    if (p.source === SOURCE_IMPORT_SHEETS || String(p.date).slice(0, 7) !== cle) continue
    const a = base(p.restaurant_id)
    a.yangoTab += n(p.yango_tab)
    a.glovoTab += n(p.glovo_tab)
    for (const s of shifts.get(p.id) || []) { a.om += n(s.om); a.wave += n(s.wave); a.djamo += n(s.djamo) }
  }
  for (const pub of pubs || []) {
    if (String(pub.periode_debut).slice(0, 7) === cle) base(pub.restaurant_id).pubGlovo += n(pub.montant)
  }
  return [...parResto.values()]
}

/** Écritures OD du mois : une pièce par restaurant, datée du dernier jour du mois. */
export function ecrituresCommissions({ mois, assiettes = [] }) {
  const jours = joursDuMois(mois)
  const date = jours[jours.length - 1]
  const lignes = []
  const net = (brut, coef) => arrondiFranc(brut) - arrondiFranc(brut * coef)
  for (const a of assiettes) {
    const ecrire = ecrivain({
      journal: 'OD', date, piece: `OD-${String(a.restaurant.court).replace(/\s+/g, '')}-${String(mois).slice(0, 7).replace('-', '')}`,
      restaurant: a.restaurant.nom, lignes,
    })
    const paire = (debit, credit, libelle, montant) => {
      ecrire(debit, libelle, montant, 'debit')
      ecrire(credit, libelle, montant, 'credit')
    }
    paire('commissionsPlateformes', 'yango', 'Commission Yango estimée (23 %)', net(a.yangoTab, COEFFICIENTS.YANGO))
    paire('commissionsPlateformes', 'glovo', 'Commission Glovo estimée (29,5 %)', net(a.glovoTab, COEFFICIENTS.GLOVO))
    paire('fraisMobileMoney', 'om', 'Frais Orange Money estimés (1 %)', net(a.om, COEFFICIENTS.OM))
    paire('fraisMobileMoney', 'wave', 'Frais Wave estimés (1 %)', net(a.wave, COEFFICIENTS.WAVE))
    paire('fraisMobileMoney', 'djamo', 'Frais Djamo estimés (1 %)', net(a.djamo, COEFFICIENTS.DJAMO))
    paire('publicite', 'glovo', 'Publicité Glovo retenue', a.pubGlovo)
  }
  return lignes
}
