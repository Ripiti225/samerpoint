// Tests de lib/cotisations.js — cotisations des restaurants remises au RH.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATEGORIES_COTISATIONS_AUTRES, chargeApresCotisation, categoriesDuCompte, cotisationPourCategorie, cotiseParDu, ecrituresCotisation,
  lignesResultatCotisations, recuDuMois,
} from './cotisations.js'

const fournisseurs = [
  { id: 'cs', restaurant_id: 'kms', nom: 'Cotisation salaire' },
  { id: 'cn', restaurant_id: 'kms', nom: 'CNPS' },
  { id: 'im', restaurant_id: 'kms', nom: 'IMPÔT ET TIMBRE' },
  { id: 'it', restaurant_id: 'kms', nom: 'ITS' },
  { id: 'te', restaurant_id: 'kms', nom: 'TEE' },
  { id: 'ba', restaurant_id: 'kms', nom: 'CONTRAT DE BAIL' },
  { id: 'lo', restaurant_id: 'oasis', nom: 'LOYER' },
  { id: 'x', restaurant_id: 'kms', nom: 'Ibrahim' },
]

test('chaque charge trouve sa cotisation dans le bon restaurant', () => {
  assert.equal(cotisationPourCategorie('salaire', fournisseurs, 'kms').id, 'cs')
  assert.equal(cotisationPourCategorie('cnps', fournisseurs, 'kms').id, 'cn')
  assert.equal(cotisationPourCategorie('impot', fournisseurs, 'kms').id, 'im')
  assert.equal(cotisationPourCategorie('its', fournisseurs, 'kms').id, 'it')   // pas « IMPÔT ET TIMBRE »
  assert.equal(cotisationPourCategorie('tee', fournisseurs, 'kms').id, 'te')
  assert.equal(cotisationPourCategorie('bail', fournisseurs, 'kms').id, 'ba')
  assert.equal(cotisationPourCategorie('loyer', fournisseurs, 'oasis').id, 'lo')
  assert.equal(cotisationPourCategorie('loyer', fournisseurs, 'kms'), null)     // KMS n'a pas de cotisation loyer
  assert.equal(cotisationPourCategorie('dette', fournisseurs, 'kms'), null)
})

test('exemple KMS : 600 000 cotisés sur 1 000 000 de salaires', () => {
  const e = ecrituresCotisation({ montant: 600_000, creditActuel: -1_855_000 })
  assert.equal(e.mouvement, 600_000)                 // entre en Espèces
  assert.equal(e.nouveauCredit, -1_255_000)          // la cotisation baisse
  assert.equal(e.transaction.facture, 600_000)
  assert.equal(chargeApresCotisation(1_000_000, 600_000), 400_000) // le résultat ne déduit que le reste
  assert.equal(chargeApresCotisation(1_000_000, 1_500_000), 0)
})

test('cotiseParDu additionne plusieurs remises', () => {
  assert.deepEqual(cotiseParDu([{ du_id: 'a', montant: 100 }, { du_id: 'a', montant: 50 }, { du_id: 'b', montant: 7 }]), { a: 150, b: 7 })
})

test('cotiseParDu ignore les remises de Banque (sans charge)', () => {
  assert.deepEqual(cotiseParDu([{ du_id: 'a', montant: 100 }, { du_id: null, categorie: 'salaire', montant: 50 }]), { a: 100 })
})

// ── Remises notées dans Banque (supabase_cotisations_banque.sql) ─────────────

test('chaque compte de cotisation dit ce qu\'il reçoit', () => {
  assert.deepEqual(categoriesDuCompte({ nom: 'Cotisation salaire' }), ['salaire'])
  assert.deepEqual(categoriesDuCompte({ nom: 'Cotisations autres' }), CATEGORIES_COTISATIONS_AUTRES)
  assert.ok(!CATEGORIES_COTISATIONS_AUTRES.includes('salaire'))
  assert.equal(categoriesDuCompte({ nom: 'Espèces' }), null)
  assert.equal(categoriesDuCompte(null), null)
})

const banque = [
  { id: 1, du_id: null, restaurant_id: 'kms', categorie: 'salaire', montant: 200_000, date: '2026-10-03' },
  { id: 2, du_id: null, restaurant_id: 'kms', categorie: 'salaire', montant: 150_000, date: '2026-10-21' },
  { id: 3, du_id: null, restaurant_id: 'kms', categorie: 'cnps', montant: 40_000, date: '2026-10-21' },
  { id: 4, du_id: null, restaurant_id: 'yop', categorie: 'salaire', montant: 90_000, date: '2026-10-30' },
  { id: 5, du_id: null, restaurant_id: 'kms', categorie: 'salaire', montant: 70_000, date: '2026-11-02' },
  { id: 6, du_id: 'ancienne', restaurant_id: 'kms', categorie: null, montant: 999, date: '2026-10-05' },
]

test('le résultat déduit les remises au mois de leur date, par restaurant et cotisation', () => {
  const l = lignesResultatCotisations(banque)
  const de = (r, m, c) => l.find(x => x.restaurant_id === r && x.mois === m && x.categorie === c)
  assert.equal(l.length, 4)                                   // l'ancienne (avec charge) n'y est pas
  assert.equal(de('kms', '2026-10', 'salaire').montant, -350_000) // deux remises d'octobre additionnées
  assert.equal(de('kms', '2026-10', 'cnps').montant, -40_000)
  assert.equal(de('yop', '2026-10', 'salaire').montant, -90_000)
  assert.equal(de('kms', '2026-11', 'salaire').montant, -70_000)
  assert.equal(de('kms', '2026-10', 'salaire').source, 'tresorerie')
  assert.match(de('kms', '2026-10', 'salaire').libelle, /Cotisation salaire reçue/)
})

test('remises sans restaurant, sans date ou à 0 : ignorées', () => {
  assert.deepEqual(lignesResultatCotisations([
    { du_id: null, restaurant_id: null, categorie: 'salaire', montant: 10, date: '2026-10-01' },
    { du_id: null, restaurant_id: 'kms', categorie: 'salaire', montant: 10, date: null },
    { du_id: null, restaurant_id: 'kms', categorie: 'salaire', montant: 0, date: '2026-10-01' },
  ]), [])
  assert.deepEqual(lignesResultatCotisations(null), [])
})

test('reçu du mois : total d\'un restaurant pour une cotisation', () => {
  assert.equal(recuDuMois(banque, { restaurantId: 'kms', categorie: 'salaire', mois: '2026-10-01' }), 350_000)
  assert.equal(recuDuMois(banque, { restaurantId: 'kms', categorie: 'salaire', mois: '2026-10' }), 350_000)
  assert.equal(recuDuMois(banque, { restaurantId: 'kms', categorie: 'cnps', mois: '2026-10' }), 40_000)
  assert.equal(recuDuMois(banque, { restaurantId: 'kms', categorie: 'salaire', mois: '2026-09' }), 0)
})
