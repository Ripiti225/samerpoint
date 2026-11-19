// ──────────────────────────────────────────────────────────────────────────────
// Journal de Caisse SYSCOHADA : écritures d'une journée de restaurant (pur).
//
// Une pièce par restaurant et par date (« CA-KMS-20261010 »), toujours équilibrée :
//   A. vente retenue (machine, sinon théorique) au crédit ; au débit ce que la
//      caisse en a fait, shift par shift (espèces, OM/Wave/Djamo, KDO, remises,
//      fournisseurs payés, dépenses détaillées, salaires) ; l'écart de caisse
//      (vente théorique − vente retenue : + surplus, − manque) porte la différence ;
//   B. ventes tablette Yango / Glovo / Samer Delly (hors vente du jour) ;
//   C. caisse gérant (depenses_gerant_caisse), sortie de la caisse ;
//   D. factures fournisseurs (achat au débit, fournisseur au crédit).
// Montants arrondis au franc ; l'écart est calculé APRÈS arrondi, donc la pièce
// tombe juste au franc près.
// Spec : docs/superpowers/specs/2026-11-19-export-comptable-caisse-design.md
// Tests : lib/journalCaisse.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { COMPTES } from './comptesSyscohada.js'
import { FOURNISSEURS_NON_FOOD } from './constants.js'
import { depensesSalairesShift } from './depensesShift.js'
import { nomCourtResto } from './groupesAccueil.js'
import { venteRetenue } from './venteMachine.js'

export const SOURCE_IMPORT_SHEETS = 'import_sheets_2026_10'

const n = v => parseFloat(v) || 0
const arrondi = v => Math.round(n(v))
const sommeShifts = (shifts, ...cles) => shifts.reduce((s, sh) => s + cles.reduce((t, c) => t + n(sh[c]), 0), 0)

const NON_FOOD = new Set([...FOURNISSEURS_NON_FOOD].map(x => x.trim().toLowerCase()))
const estNonAlimentaire = nom => NON_FOOD.has(String(nom || '').trim().toLowerCase())

// Catégorie de dépense → clé de compte.
const COMPTE_CATEGORIE = {
  'Marché': 'achats', 'Légumes': 'achats', 'Fruits': 'achats',
  'Dépenses annexes': 'autresAchats', 'Paie': 'personnel', 'Fournisseur': 'fournisseurs',
}
const compteCategorie = cat => COMPTE_CATEGORIE[cat] || 'autresAchats'

function totalParCategorie(lignes = []) {
  const parCat = new Map()
  for (const l of lignes || []) {
    const cat = l.categorie || 'Autre'
    parCat.set(cat, (parCat.get(cat) || 0) + n(l.montant))
  }
  return parCat
}

export function ecrituresJournee({ point, shifts = [], depensesCaissier = [], deductionsGerant = [], factures = [], restaurant }) {
  if (!point || point.source === SOURCE_IMPORT_SHEETS || !(shifts || []).length) {
    return { lignes: [], exclue: true, ecart: 0 }
  }
  const date = String(point.date).slice(0, 10)
  const piece = `CA-${String(restaurant.court || restaurant.nom).replace(/\s+/g, '')}-${date.replace(/-/g, '')}`
  const lignes = []

  // Montant positif au sens demandé ; négatif → l'autre sens. Zéro → rien.
  function ecrire(cle, libelle, montant, sens) {
    const m = arrondi(montant)
    if (m === 0) return 0
    const auDebit = (sens === 'debit') === (m > 0)
    lignes.push({
      journal: 'CA', date, piece, compte: COMPTES[cle].compte, intitule: COMPTES[cle].intitule,
      libelle, debit: auDebit ? Math.abs(m) : 0, credit: auDebit ? 0 : Math.abs(m), restaurant: restaurant.nom,
    })
    return sens === 'debit' ? m : -m
  }

  // ── A. Ventes et ce que la caisse en a fait ────────────────────────────────
  const vente = arrondi(venteRetenue(point))
  ecrire('ventesCaisse', 'Ventes du jour', vente, 'credit')
  let justifie = 0
  justifie += ecrire('caisse', 'Espèces remises (y compris Yango et Glovo espèces)', sommeShifts(shifts, 'espece', 'yango_cse', 'glovo_cse'), 'debit')
  justifie += ecrire('om', 'Encaissements Orange Money', sommeShifts(shifts, 'om'), 'debit')
  justifie += ecrire('wave', 'Encaissements Wave', sommeShifts(shifts, 'wave'), 'debit')
  justifie += ecrire('djamo', 'Encaissements Djamo', sommeShifts(shifts, 'djamo'), 'debit')
  justifie += ecrire('cadeaux', 'KDO (produits offerts)', sommeShifts(shifts, 'kdo'), 'debit')
  justifie += ecrire('remises', 'Points fidélité et retours', sommeShifts(shifts, 'points_fidelite', 'retour'), 'debit')
  justifie += ecrire('fournisseurs', 'Fournisseurs payés par la caisse', sommeShifts(shifts, 'fournisseurs'), 'debit')

  let detailCaissier = 0
  for (const [cat, montant] of totalParCategorie(depensesCaissier)) {
    justifie += ecrire(compteCategorie(cat), `Dépenses caisse : ${cat}`, montant, 'debit')
    detailCaissier += arrondi(montant)
  }
  const depensesEtSalaires = arrondi(shifts.reduce((s, sh) => s + depensesSalairesShift(sh), 0))
  justifie += ecrire('personnel', 'Salaires payés par la caisse', Math.max(0, depensesEtSalaires - detailCaissier), 'debit')

  // Même sens que l'app (ecart_pos) : positif = surplus (la caisse justifie plus
  // que la machine n'a vendu), négatif = manque.
  const ecart = justifie - vente
  if (ecart > 0) ecrire('ecartSurplus', 'Écart de caisse (surplus)', ecart, 'credit')
  if (ecart < 0) ecrire('ecartManque', 'Écart de caisse (manque)', -ecart, 'debit')

  // ── B. Ventes tablette (hors vente du jour) ────────────────────────────────
  for (const [cle, champ, nom] of [['yango', 'yango_tab', 'Yango'], ['glovo', 'glovo_tab', 'Glovo'], ['samerDelly', 'samer_delly_tab', 'Samer Delly']]) {
    ecrire(cle, `Ventes ${nom} tablette`, point[champ], 'debit')
    ecrire('ventesLivraison', `Ventes ${nom} tablette`, point[champ], 'credit')
  }

  // ── C. Caisse gérant ───────────────────────────────────────────────────────
  for (const [cat, montant] of totalParCategorie(deductionsGerant)) {
    const libelle = `Caisse gérant : ${cat}`
    ecrire(compteCategorie(cat), libelle, montant, 'debit')
    ecrire('caisse', libelle, montant, 'credit')
  }

  // ── D. Factures fournisseurs ───────────────────────────────────────────────
  for (const f of factures || []) {
    const nom = String(f.fournisseur_nom || 'Fournisseur').trim()
    const libelle = `Facture ${nom}`
    ecrire(estNonAlimentaire(nom) ? 'autresAchats' : 'achats', libelle, f.facture, 'debit')
    ecrire('fournisseurs', libelle, f.facture, 'credit')
  }

  return { lignes, exclue: false, ecart }
}

export function controleJournal(lignes = []) {
  const parRestaurant = {}
  const groupe = { debit: 0, credit: 0, difference: 0 }
  for (const l of lignes || []) {
    const r = parRestaurant[l.restaurant] || (parRestaurant[l.restaurant] = { debit: 0, credit: 0, difference: 0 })
    r.debit += l.debit; r.credit += l.credit
    groupe.debit += l.debit; groupe.credit += l.credit
  }
  for (const r of Object.values(parRestaurant)) r.difference = r.debit - r.credit
  groupe.difference = groupe.debit - groupe.credit
  return { parRestaurant, groupe }
}

// Calcule toutes les écritures du mois, journée par journée.
// donnees : { restaurants, points, shifts, depensesCaissier, deductionsGerant, factures }
// (les quatre dernières : Map point_id → lignes).
export function journalDuMois(donnees) {
  const restos = new Map(donnees.restaurants.map(r => [r.id, { nom: r.nom.trim(), court: nomCourtResto(r.nom) }]))
  const tries = [...donnees.points].sort((a, b) => String(a.date).localeCompare(String(b.date))
    || (restos.get(a.restaurant_id)?.nom || '').localeCompare(restos.get(b.restaurant_id)?.nom || ''))
  const lignes = []
  const parResto = {}
  for (const point of tries) {
    const restaurant = restos.get(point.restaurant_id) || { nom: '?', court: '?' }
    const r = parResto[restaurant.nom] || (parResto[restaurant.nom] = { journees: 0, exclues: 0, nonVerifiees: 0, ecarts: 0 })
    const res = ecrituresJournee({
      point, restaurant,
      shifts: donnees.shifts.get(point.id) || [],
      depensesCaissier: donnees.depensesCaissier.get(point.id) || [],
      deductionsGerant: donnees.deductionsGerant.get(point.id) || [],
      factures: donnees.factures.get(point.id) || [],
    })
    if (res.exclue) { r.exclues += 1; continue }
    r.journees += 1
    r.ecarts += res.ecart
    if (!point.valide || !point.verifie) r.nonVerifiees += 1
    lignes.push(...res.lignes)
  }
  return { lignes, parResto }
}

export function nomFichierJournal(mois, nomResto, provisoire) {
  const resto = nomResto ? `-${nomCourtResto(nomResto).replace(/\s+/g, '')}` : ''
  return `Journal-caisse-${mois}${resto}${provisoire ? '-PROVISOIRE' : ''}.xlsx`
}
