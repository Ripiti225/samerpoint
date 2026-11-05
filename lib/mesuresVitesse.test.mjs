// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/mesuresVitesse.js — ce qu'on garde d'une mesure de vitesse réelle.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { detailsDemarrage, dureeValide, plateformeMesure } from './mesuresVitesse.js'

describe('dureeValide', () => {
  test('garde une attente normale, y compris très courte', () => {
    assert.equal(dureeValide(0), true)
    assert.equal(dureeValide(1500), true)
  })
  test('écarte une durée impossible ou gonflée par une app restée en arrière-plan', () => {
    assert.equal(dureeValide(-1), false)
    assert.equal(dureeValide(NaN), false)
    assert.equal(dureeValide(undefined), false)
    assert.equal(dureeValide(5 * 60 * 1000 + 1), false)
  })
})

describe('plateformeMesure', () => {
  test("distingue l'app installée du web, et l'iPhone de l'Android sur le web", () => {
    assert.equal(plateformeMesure('ios'), 'app-ios')
    assert.equal(plateformeMesure('android'), 'app-android')
    assert.equal(plateformeMesure('web', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'web-iphone')
    assert.equal(plateformeMesure('web', 'Mozilla/5.0 (Linux; Android 14; SM-A15)'), 'web-android')
    assert.equal(plateformeMesure('web', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'web-autre')
    assert.equal(plateformeMesure('web'), 'web-autre')
  })
})

describe('detailsDemarrage', () => {
  const perf = entrees => ({ getEntriesByType: type => entrees[type] || [] })

  test('retient le temps et le poids du code principal', () => {
    const d = detailsDemarrage(perf({
      navigation: [{ responseEnd: 312.4 }],
      resource: [
        { name: 'https://samtrackly.vercel.app/favicon.ico', duration: 5, transferSize: 10 },
        { name: 'https://samtrackly.vercel.app/_expo/static/js/web/entry-abc.js', duration: 1820.6, transferSize: 2063237 },
      ],
    }))
    assert.deepEqual(d, { document_ms: 312, code_ms: 1821, code_octets: 2063237 })
  })

  test('reste vide si le navigateur ne donne rien', () => {
    assert.deepEqual(detailsDemarrage(perf({})), {})
    assert.deepEqual(detailsDemarrage(null), {})
  })
})
