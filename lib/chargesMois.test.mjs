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

describe('résultat net : au mois de la date limite', () => {
  const du = (categorie, mois, echeance, montant_du = 1000) => ({ categorie, restaurant_id: 'kms', mois, echeance, montant_du })

  test('le loyer de juin, dû début juillet, pèse sur juillet, payé ou non', () => {
    const r = fusionnerChargesResultat([], [du('loyer', '2026-06-01', '2026-07-05', 1100000)], [])
    assert.deepEqual(r.map(c => [c.mois, c.montant]), [['2026-07', 1100000]])
  })

  test('les catégories en série suivent la même règle', () => {
    const r = fusionnerChargesResultat([], ['salaire', 'cnps', 'impot', 'its', 'tee'].map(c => du(c, '2026-09-01', '2026-10-15')), [])
    assert.equal(r.length, 5)
    assert.ok(r.every(c => c.mois === '2026-10'))
  })

  test('l\'ancien loyer d\'un mois suivi dans la trésorerie n\'est pas compté deux fois', () => {
    const anciennes = [
      { restaurant_id: 'kms', mois: '2026-08', libelle: 'Loyer ', montant: 1100000 },
      { restaurant_id: 'kms', mois: '2026-08', libelle: 'Salaire ', montant: 500000 },
    ]
    const r = fusionnerChargesResultat(anciennes, [du('loyer', '2026-08-01', '2026-09-05', 1100000)], [])
    assert.deepEqual(r.map(c => [c.mois, c.libelle.trim(), c.montant]),
      [['2026-08', 'Salaire', 500000], ['2026-09', 'Loyer (2026-08)', 1100000]])
  })

  test('autre charge payée : au mois du paiement, si sa catégorie compte dans le résultat', () => {
    const paiements = [
      { montant: 300000, date: '2026-10-03', du: { categorie: 'autre', restaurant_id: 'kms', categorie_direction: 'reparation', libelle: 'Compresseur' } },
      { montant: 900000, date: '2026-10-04', du: { categorie: 'autre', restaurant_id: 'kms', categorie_direction: 'investissement', libelle: 'Travaux' } },
      { montant: 50000, date: '2026-10-04', du: { categorie: 'autre', restaurant_id: null, categorie_direction: 'divers', libelle: 'Comptable' } },
      { montant: 70000, date: '2026-10-05', du: { categorie: 'loyer', restaurant_id: 'kms' } },
    ]
    const r = fusionnerChargesResultat([], [], paiements)
    assert.deepEqual(r.map(c => [c.mois, c.libelle, c.montant]), [['2026-10', 'Compresseur', 300000]])
  })

  test('les dettes ne sont jamais des charges', () => {
    assert.deepEqual(fusionnerChargesResultat([], [{ categorie: 'dette', creancier: 'Z', montant_du: 5 }], []), [])
  })
})

describe('tableaux de bord : nouvelles catégories au mois consommé', () => {
  test('impôts, ITS, TEE et bail', () => {
    const dus = ['impot', 'its', 'tee', 'bail'].map(c => ({ categorie: c, restaurant_id: 'kms', mois: '2026-09-01', montant_du: 10 }))
    const r = fusionnerCharges([], dus)
    assert.deepEqual(r.map(c => [c.mois, c.libelle]), [['2026-09', 'Impôts'], ['2026-09', 'ITS'], ['2026-09', 'TEE'], ['2026-09', 'Contrat de bail']])
  })
})
