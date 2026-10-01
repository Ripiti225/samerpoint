// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/chargesMois.js — la bascule des charges de l'écran Charges vers
// Trésorerie → À payer. Le piège : compter deux fois le loyer d'un mois (ancien
// tableau + À payer), ou perdre les charges des mois passés.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { fusionnerCharges, fusionnerChargesResultat, moisDuDu } from './chargesMois.js'

describe('fusion des charges', () => {
  const anciennes = [
    { restaurant_id: 'kms', mois: '2026-09', libelle: 'Loyer', montant: 1100000 },
    { restaurant_id: 'kms', mois: '2026-09', libelle: 'Électricité', montant: 200000 },
    { restaurant_id: 'kms', mois: '2026-08', libelle: 'Loyer', montant: 1100000 },
    { restaurant_id: null, mois: '2026-08', libelle: 'Comptable', montant: 150000 },
  ]
  const dus = [
    { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 1100000 },
    { categorie: 'salaire', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 1700000 },
    { categorie: 'dette', creancier: 'Zabad', montant_du: 6000000 },
  ]

  test('un mois saisi dans À payer remplace l\'ancien tableau pour ce restaurant', () => {
    const r = fusionnerCharges(anciennes, dus)
    const sept = r.filter(c => c.restaurant_id === 'kms' && c.mois === '2026-09')
    assert.deepEqual(sept.map(c => [c.libelle, c.montant]), [['Loyer', 1100000], ['Salaires', 1700000]])
  })

  test('les mois sans saisie dans À payer gardent l\'ancien tableau', () => {
    const r = fusionnerCharges(anciennes, dus)
    assert.equal(r.filter(c => c.mois === '2026-08').length, 2)
  })

  test('les dettes ne sont pas des charges', () => {
    assert.ok(!fusionnerCharges([], dus).some(c => c.libelle === undefined || /Zabad/.test(c.libelle)))
    assert.equal(fusionnerCharges([], dus).length, 2)
  })

  test('charge admin rattachée à son mois, ou à défaut à son échéance', () => {
    assert.equal(moisDuDu({ categorie: 'admin', mois: '2026-09-01' }), '2026-09')
    assert.equal(moisDuDu({ categorie: 'admin', mois: null, echeance: '2026-10-15' }), '2026-10')
    assert.equal(moisDuDu({ categorie: 'admin', mois: null, echeance: null }), null)
    const r = fusionnerCharges([], [{ categorie: 'admin', restaurant_id: 'kms', libelle: 'Électricité', mois: '2026-09-01', montant_du: 180000 }])
    assert.deepEqual(r.map(c => [c.restaurant_id, c.mois, c.libelle, c.montant]), [['kms', '2026-09', 'Électricité', 180000]])
  })
})

describe('résultat net : loyer, salaires, CNPS au mois du paiement', () => {
  const du = (categorie, mois) => ({ categorie, restaurant_id: 'kms', mois })

  test('le loyer de juillet payé en octobre compte en octobre', () => {
    const r = fusionnerChargesResultat([], [], [
      { montant: 1100000, date: '2026-10-03', du: du('loyer', '2026-07-01') },
    ])
    assert.deepEqual(r.map(c => [c.mois, c.montant]), [['2026-10', 1100000]])
  })

  test('un mois dû mais pas encore payé ne pèse sur aucun mois', () => {
    const r = fusionnerChargesResultat([], [{ ...du('salaire', '2026-09-01'), montant_du: 1700000 }], [])
    assert.deepEqual(r, [])
  })

  test('l\'ancien loyer de juillet n\'est pas compté une 2e fois quand juillet est payé dans À payer', () => {
    const anciennes = [
      { restaurant_id: 'kms', mois: '2026-07', libelle: 'Loyer ', montant: 1100000 },
      { restaurant_id: 'kms', mois: '2026-07', libelle: 'Salaire ', montant: 500000 },
    ]
    const r = fusionnerChargesResultat(anciennes, [], [
      { montant: 1100000, date: '2026-10-03', du: du('loyer', '2026-07-01') },
    ])
    assert.deepEqual(r.map(c => [c.mois, c.libelle.trim(), c.montant]),
      [['2026-07', 'Salaire', 500000], ['2026-10', 'Loyer (2026-07)', 1100000]])
  })

  test('les charges admin restent au mois rattaché et masquent les « autres » anciennes', () => {
    const anciennes = [
      { restaurant_id: 'kms', mois: '2026-09', libelle: 'Électricité', montant: 200000 },
      { restaurant_id: 'kms', mois: '2026-09', libelle: 'LOYER', montant: 1100000 },
    ]
    const r = fusionnerChargesResultat(anciennes, [
      { categorie: 'admin', restaurant_id: 'kms', mois: null, echeance: '2026-09-20', libelle: 'Impôts', montant_du: 300000 },
    ], [])
    assert.deepEqual(r.map(c => [c.libelle, c.montant]), [['LOYER', 1100000], ['Impôts', 300000]])
  })

  test('les dettes ne sont jamais des charges', () => {
    const r = fusionnerChargesResultat([], [], [{ montant: 5000, date: '2026-10-01', du: { categorie: 'dette' } }])
    assert.deepEqual(r, [])
  })
})
