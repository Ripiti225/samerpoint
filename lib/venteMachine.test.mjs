// Tests de lib/venteMachine.js — la vente machine est la vraie vente.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { venteRetenue, venteTheorique, ventesDouble } from './venteMachine.js'

test('la vente machine compte, pas la théorique', () => {
  assert.equal(venteRetenue({ vente_machine: 521000, vente_total: 501700 }), 521000)
})

test('sans vente machine, la théorique de ce jour', () => {
  assert.equal(venteRetenue({ vente_machine: null, vente_total: 300000 }), 300000)
  assert.equal(venteRetenue({ vente_machine: 0, vente_total: 300000 }), 300000)
  assert.equal(venteRetenue({ vente_machine: '410000', vente_total: '400000' }), 410000)
})

test('point absent', () => {
  assert.equal(venteRetenue(null), 0)
  assert.equal(venteTheorique(undefined), 0)
})

test('somme des deux ventes et écart théorique − machine', () => {
  const r = ventesDouble([
    { vente_machine: 521000, vente_total: 501700 },
    { vente_machine: null, vente_total: 100000 },
  ])
  assert.deepEqual(r, { machine: 621000, theorique: 601700, ecart: -19300 })
})
