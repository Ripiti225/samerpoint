// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/graphiques.js — la géométrie des graphiques du dashboard.
// ──────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { arcsAnneau, bornesJolies, cheminAire, cheminLisse, etiquettesEspacees, fmtCourt, melangerCouleurs } from './graphiques.js'

test('bornesJolies : graduations rondes, 0 inclus', () => {
  const b = bornesJolies(0, 3_400_000)
  assert.equal(b.min, 0)
  assert.ok(b.max >= 3_400_000)
  assert.deepEqual(b.ticks.slice(0, 2), [0, 1_000_000])
  const neg = bornesJolies(-120, 480)
  assert.ok(neg.min <= -120 && neg.ticks.includes(0))
  assert.deepEqual(bornesJolies(0, 0).ticks.slice(0, 1), [0])
})

test('cheminLisse : commence au premier point, une courbe par segment', () => {
  const d = cheminLisse([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 5 }])
  assert.ok(d.startsWith('M0,10'))
  assert.equal((d.match(/C/g) || []).length, 2)
  assert.equal(cheminLisse([]), '')
  assert.equal(cheminLisse([{ x: 1, y: 2 }]), 'M1,2')
})

test('cheminLisse : un segment plat reste plat (pas de bosse inventée)', () => {
  const d = cheminLisse([{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }])
  const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => Number(m[2]))
  assert.ok(ys.length > 3)
  assert.ok(ys.every(y => y === 5))
})

test('cheminAire : fermé sur la ligne de base', () => {
  const d = cheminAire([{ x: 0, y: 1 }, { x: 10, y: 2 }], 50)
  assert.ok(d.endsWith('L10,50 L0,50 Z'))
  assert.equal(cheminAire([{ x: 0, y: 1 }], 50), '')
})

test('melangerCouleurs', () => {
  assert.equal(melangerCouleurs('#000000', '#ffffff', 0), '#000000')
  assert.equal(melangerCouleurs('#000000', '#ffffff', 1), '#ffffff')
  assert.equal(melangerCouleurs('#000000', '#ffffff', 0.5), '#808080')
})

test('etiquettesEspacees : garde la première et la dernière', () => {
  assert.deepEqual(etiquettesEspacees(5, 7), [0, 1, 2, 3, 4])
  const e = etiquettesEspacees(31, 7)
  assert.equal(e[0], 0)
  assert.equal(e[e.length - 1], 30)
  assert.ok(e.length <= 8)
})

test('fmtCourt', () => {
  assert.equal(fmtCourt(950), '950')
  assert.equal(fmtCourt(850_000), '850 k')
  assert.equal(fmtCourt(1_250_000), '1,3 M')
  assert.equal(fmtCourt(80_322_775), '80 M')
})

test('arcsAnneau : les parts font un tour complet', () => {
  const a = arcsAnneau([1, 1, 2])
  assert.equal(a[2].fin, 1)
  assert.equal(a[0].part, 0.25)
  assert.deepEqual(arcsAnneau([0, 0]).map(x => x.part), [0, 0])
})
