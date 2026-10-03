// Tests de lib/verificationListe.js — liste des points à vérifier, par mois.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { alertesPoint, bornesDuMois, libelleMoisLong, moisVoisin, organiserPoints, ventesParCanal } from './verificationListe.js'

describe('mois', () => {
  test('bornes, mois voisins, libellé', () => {
    assert.deepEqual(bornesDuMois('2026-12'), { debut: '2026-12-01', finExclue: '2027-01-01' })
    assert.equal(moisVoisin('2026-01', -1), '2025-12')
    assert.equal(moisVoisin('2026-12', 1), '2027-01')
    assert.equal(libelleMoisLong('2026-10'), 'Octobre 2026')
  })
})

describe('organisation de la liste', () => {
  const pts = [
    { id: 'r', date: '2026-09-27', valide: true, verifie: false },   // en retard
    { id: 'v9', date: '2026-09-28', valide: true, verifie: true },    // autre mois, vérifié : absent
    { id: 'a1', date: '2026-10-01', valide: true, verifie: false },
    { id: 'a2', date: '2026-10-02', valide: true, verifie: false },
    { id: 'ok', date: '2026-10-03', valide: true, verifie: true },
    { id: 'c', date: '2026-10-04', valide: false, verifie: false },
  ]
  test('les retards d\'abord, puis les points du mois à vérifier (le plus récent d\'abord)', () => {
    const o = organiserPoints(pts, '2026-10')
    assert.deepEqual(o.aVerifier.map(x => [x.point.id, x.enRetard]), [['r', true], ['a2', false], ['a1', false]])
  })
  test('historique et compteurs : le mois seulement', () => {
    const o = organiserPoints(pts, '2026-10')
    assert.deepEqual(o.historique.map(p => p.id), ['c', 'ok'])
    assert.deepEqual(o.compteurs, { aVerifier: 2, verifies: 1, enCours: 1 })
  })
})

describe('carte d\'un point', () => {
  test('alertes : écart, caisse juste, photos manquantes', () => {
    assert.deepEqual(alertesPoint({ ecart_caisse: -2500 }, ['Wave', 'OM']).map(a => [a.texte, a.ton]),
      [['Écart − 2 500', 'rouge'], ['2 photos manquantes', 'orange']])
    assert.deepEqual(alertesPoint({ ecart_caisse: 0 }).map(a => a.texte), ['Caisse juste'])
    assert.deepEqual(alertesPoint({ ecart_caisse: null }), [])
  })
  test('ventes par canal triées, canaux vides retirés', () => {
    assert.deepEqual(ventesParCanal({ wave: 108500, glovo_tab: 58000, om: 0 }, 198000).map(c => c.canal), ['Espèces', 'Wave', 'Glovo'])
  })
})
