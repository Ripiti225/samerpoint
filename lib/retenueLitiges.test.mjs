// Tests de lib/retenueLitiges.js — retenue sur litiges dans les salaires.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lireRegleRetenue, phraseRetenue } from './retenueLitiges.js'

test('un pourcentage du total : 30 % de 200 000', () => {
  const r = lireRegleRetenue('30%', 200_000)
  assert.equal(r.retenu, 60_000)
  assert.equal(r.annule, 140_000)
  assert.equal(lireRegleRetenue('12,5 %', 200_000).retenu, 25_000)
})

test('un montant : 40 000 retenus sur 200 000', () => {
  const r = lireRegleRetenue('40 000', 200_000)
  assert.equal(r.retenu, 40_000)
  assert.equal(r.annule, 160_000)
})

test('garde-fous', () => {
  assert.ok(lireRegleRetenue('120%', 200_000).erreur)
  assert.ok(lireRegleRetenue('250000', 200_000).erreur)
  assert.ok(lireRegleRetenue('abc', 200_000).erreur)
  assert.equal(lireRegleRetenue('', 200_000).vide, true)
})

test('phraseRetenue', () => {
  assert.equal(phraseRetenue({ litiges_total: 200_000, retenue_litiges: 60_000, retenue_regle: '30%' }).replace(/[\u202f\u00a0]/g, ' '),
    'Litiges 200 000 F · retenu 60 000 F (30 %) · annulé 140 000 F')
})
