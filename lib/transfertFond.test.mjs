// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/transfertFond.js — remettre un fond de caisse négatif à 0.
// Le montant ne doit jamais dépasser le trou : le fond ne doit pas devenir
// positif par erreur (la fonction SQL refait la même vérification).
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { DESTINATIONS, fondApres, fondsNegatifs, montantMaxTransfert, validerTransfert } from './transfertFond.js'

describe('montant maximum', () => {
  test('tout le négatif', () => assert.equal(montantMaxTransfert(-315612), 315612))
  test('centimes : arrondi au franc supérieur', () => assert.equal(montantMaxTransfert(-134764.25), 134765))
  test('fond positif ou nul : rien à transférer', () => {
    assert.equal(montantMaxTransfert(0), 0)
    assert.equal(montantMaxTransfert(20450), 0)
  })
})

describe('validation', () => {
  const ok = { fond: -407006, destination: 'dette_admin' }
  test('montant partiel accepté', () => assert.equal(validerTransfert({ ...ok, montant: 100000 }), null))
  test('tout accepté', () => assert.equal(validerTransfert({ ...ok, montant: 407006 }), null))
  test('report caisse accepté', () => assert.equal(validerTransfert({ ...ok, destination: 'report_caisse', montant: 1 }), null))
  test('au-delà du négatif refusé', () => assert.match(validerTransfert({ ...ok, montant: 407007 }), /dépasse le fond négatif \(407 006 F maximum\)/))
  test('zéro refusé', () => assert.match(validerTransfert({ ...ok, montant: 0 }), /supérieur à 0/))
  test('décimal refusé', () => assert.match(validerTransfert({ ...ok, montant: 10.5 }), /supérieur à 0/))
  test('destination inconnue refusée', () => assert.match(validerTransfert({ ...ok, destination: 'banque', montant: 10 }), /Choisissez/))
  test('fond positif refusé', () => assert.match(validerTransfert({ fond: 5000, destination: 'dette_admin', montant: 10 }), /pas négatif/))
  test('deux destinations', () => assert.deepEqual(Object.keys(DESTINATIONS), ['dette_admin', 'report_caisse']))
})

test('fond après transfert', () => {
  assert.equal(fondApres(-430212, 430212), 0)
  assert.equal(fondApres(-430212, 30212), -400000)
})

describe('fonds négatifs', () => {
  const noms = id => ({ pal: 'Palmeraie', yop: 'Yop', oas: 'Oasis' }[id])
  const points = [
    { restaurant_id: 'pal', date: '2026-10-10', valide: true, reste_fc: -100, ajustement_fond: 0 },
    { restaurant_id: 'pal', date: '2026-10-11', valide: true, reste_fc: -3167467, ajustement_fond: 0 },
    { restaurant_id: 'pal', date: '2026-10-12', valide: false, reste_fc: 0 },
    { restaurant_id: 'yop', date: '2026-10-11', valide: true, reste_fc: -407006, ajustement_fond: 7006 },
    { restaurant_id: 'oas', date: '2026-10-11', valide: true, reste_fc: 20450 },
  ]
  test('dernier point validé, du plus creusé au moins creusé, positifs exclus', () => {
    assert.deepEqual(fondsNegatifs(points, noms), [
      { restaurant_id: 'pal', nom: 'Palmeraie', fond: -3167467, date: '2026-10-11' },
      { restaurant_id: 'yop', nom: 'Yop', fond: -400000, date: '2026-10-11' },
    ])
  })
})
