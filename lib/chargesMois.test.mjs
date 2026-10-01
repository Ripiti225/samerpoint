// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/chargesMois.js — la bascule des charges de l'écran Charges vers
// Trésorerie → À payer. Le piège : compter deux fois le loyer d'un mois (ancien
// tableau + À payer), ou perdre les charges des mois passés.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { fusionnerCharges, moisDuDu } from './chargesMois.js'

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
