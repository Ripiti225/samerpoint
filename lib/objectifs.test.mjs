// Tests de lib/objectifs.js — objectif mensuel et variations du dashboard.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { progressionObjectif, variation } from './objectifs.js'

test('progressionObjectif : pourcentage atteint et projection au rythme actuel', () => {
  const p = progressionObjectif({ ventes: 1_000_000, objectif: 3_000_000, jour: 10, joursMois: 30 })
  assert.equal(p.pct, 33)
  assert.equal(p.projection, 3_000_000)
  assert.equal(p.enAvance, true)
  const lent = progressionObjectif({ ventes: 500_000, objectif: 3_000_000, jour: 10, joursMois: 30 })
  assert.equal(lent.enAvance, false)
  assert.equal(lent.pctProjete, 50)
})

test('progressionObjectif : null sans objectif, jamais de division par zéro', () => {
  assert.equal(progressionObjectif({ ventes: 10, objectif: null, jour: 3, joursMois: 31 }), null)
  assert.equal(progressionObjectif({ ventes: 10, objectif: 0, jour: 3, joursMois: 31 }), null)
  assert.equal(progressionObjectif({ ventes: 0, objectif: 100, jour: 0, joursMois: 31 }).pct, 0)
})

test('variation', () => {
  assert.equal(variation(110, 100), 10)
  assert.equal(variation(90, 100), -10)
  assert.equal(variation(50, 0), null)
  assert.equal(variation(-50, -100), 50)
})
