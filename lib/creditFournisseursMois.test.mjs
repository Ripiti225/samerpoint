// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/creditFournisseursMois.js — crédit fournisseurs début / fin de mois.
//
// Les pièges : une cotisation (faux fournisseur) comptée en double avec la
// charge ; un fournisseur sans mouvement dans le mois oublié alors que sa dette
// pèse au début ET à la fin ; une écriture hors journée mal placée.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { creditFournisseursParRestoMois, estFournisseurCharge } from './creditFournisseursMois.js'

const fournisseurs = [
  { id: 'albert', restaurant_id: 'kms', nom: 'Albert' },
  { id: 'ibrahim', restaurant_id: 'kms', nom: 'Ibrahim' },
  { id: 'cotis', restaurant_id: 'kms', nom: 'Cotisation salaire' },
  { id: 'coq', restaurant_id: 'yop', nom: 'Coq ivoire' },
]
const tx = (fournisseur_id, date_point, reste, extra = {}) => ({
  fournisseur_id, date_point, reste, point_id: `p-${date_point}`, saisi_par: 'gerant', created_at: `${date_point}T20:00:00Z`, ...extra,
})

describe('faux fournisseurs de charges', () => {
  test('cotisations, CNPS, impôts, ITS, TEE, loyer, bail : écartés', () => {
    for (const nom of ['Cotisation salaire', 'Cotisation journaliere', 'CNPS', 'IMPÔT ET TIMBRE', 'ITS', 'TEE',
      'LOYER', 'CONTRAT DE BAIL', 'Salaire ancien ', 'PALMCI', 'SÉCURITÉ ', 'Boss', ' ANCIEN TRAVAILLEURS']) {
      assert.equal(estFournisseurCharge(nom), true, nom)
    }
  })
  test('vrais fournisseurs gardés', () => {
    for (const nom of ['Albert', 'Coq ivoire', 'CIE', 'SODECI', 'Gaz Orix', 'Teekay', 'Itsy', 'ODP', 'Report', 'Bossa nova']) {
      assert.equal(estFournisseurCharge(nom), false, nom)
    }
  })
})

describe('crédit début / fin de mois', () => {
  test('exemple de M. Zreik : 500 000 le 1er, 1 000 000 en fin de mois → variation 500 000', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [
        tx('albert', '2026-08-28', 500000),
        tx('albert', '2026-09-15', 800000),
        tx('albert', '2026-09-30', 1000000),
        tx('albert', '2026-10-02', 0), // après le mois : ignoré
      ],
    })
    assert.deepEqual(r.kms['2026-09'], { debut: 500000, fin: 1000000, variation: 500000 })
  })

  test('dette qui baisse : variation négative (remonte le résultat)', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('coq', '2026-08-31', 1000000), tx('coq', '2026-09-20', 500000)],
    })
    assert.deepEqual(r.yop['2026-09'], { debut: 1000000, fin: 500000, variation: -500000 })
  })

  test('fournisseur sans mouvement dans le mois : compté au début et à la fin', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('albert', '2026-06-10', 300000), tx('ibrahim', '2026-09-05', 100000)],
    })
    assert.deepEqual(r.kms['2026-09'], { debut: 300000, fin: 400000, variation: 100000 })
  })

  test('crédit négatif compté pour 0 : le rattrapage de factures oubliées n\'est pas un achat', () => {
    // Coq ivoire Palmeraie : −393 600 au 1er (factures oubliées), rattrapé à 0 le 30/09.
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('coq', '2026-08-31', -393600), tx('coq', '2026-09-30', 0)],
    })
    assert.deepEqual(r.yop['2026-09'], { debut: 0, fin: 0, variation: 0 })
  })

  test('à partir d\'octobre 2026 : formule normale, le négatif compte', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09', '2026-10'], fournisseurs,
      transactions: [tx('coq', '2026-09-20', -100000), tx('coq', '2026-10-15', 50000)],
    })
    assert.deepEqual(r.yop['2026-09'], { debut: 0, fin: 0, variation: 0 })
    assert.deepEqual(r.yop['2026-10'], { debut: -100000, fin: 50000, variation: 150000 })
  })

  test('négatif d\'un fournisseur ne réduit pas la dette d\'un autre (anciens mois)', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('albert', '2026-08-31', 300000), tx('ibrahim', '2026-08-31', -500000)],
    })
    assert.equal(r.kms['2026-09'].debut, 300000)
  })

  test('cotisation écartée', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('cotis', '2026-08-31', -1000000), tx('cotis', '2026-09-30', 0)],
    })
    assert.equal(r.kms, undefined)
  })

  test('même jour : le gérant caissier passe après le caissier, hors journée en tête', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [
        tx('albert', '2026-09-30', 900000, { saisi_par: 'gerant_caissier', created_at: '2026-10-01T08:00:00Z' }),
        tx('albert', '2026-09-30', 700000, { saisi_par: 'caissier', created_at: '2026-10-01T09:00:00Z' }),
        tx('albert', '2026-09-30', 650000, { point_id: null, saisi_par: 'tresorerie', created_at: '2026-10-01T10:00:00Z' }),
      ],
    })
    assert.equal(r.kms['2026-09'].fin, 900000)
  })

  test('plusieurs mois : la fin d\'un mois est le début du suivant', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-08', '2026-09'], fournisseurs,
      transactions: [tx('albert', '2026-07-31', 100000), tx('albert', '2026-08-31', 250000), tx('albert', '2026-09-01', 200000)],
    })
    assert.deepEqual(r.kms['2026-08'], { debut: 100000, fin: 250000, variation: 150000 })
    assert.deepEqual(r.kms['2026-09'], { debut: 250000, fin: 200000, variation: -50000 })
  })

  test('décembre → janvier', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-12'], fournisseurs,
      transactions: [tx('albert', '2026-11-30', -20000), tx('albert', '2026-12-31', 50000), tx('albert', '2027-01-01', 0)],
    })
    assert.deepEqual(r.kms['2026-12'], { debut: -20000, fin: 50000, variation: 70000 })
  })
})
