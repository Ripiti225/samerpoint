// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/hierAccueil.js — les lignes « Avis clients » et « Contacts » de
// l'accueil : le chiffre d'hier et son évolution.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { evolutionsHier, evolutionsHierDetail, pctEvolution, texteHier, totalParJour } from './hierAccueil.js'

describe('pctEvolution', () => {
  test('évolution en % arrondie ; pas de base de comparaison → null', () => {
    assert.equal(pctEvolution(42, 37), 14)
    assert.equal(pctEvolution(42, 44), -5)
    assert.equal(pctEvolution(3, 0), null)
    assert.equal(pctEvolution(0, 0), 0)
  })
})

describe('texteHier', () => {
  test('hier comparé à avant-hier et au même jour de la semaine d’avant', () => {
    // 03/10/2026 est un samedi.
    assert.equal(texteHier({ hier: 42, avantHier: 37, semainePrec: 44 }, '2026-10-03'),
      'Hier : 42 avis · ↑ 14 % vs avant-hier · ↓ 5 % vs sam. dernier')
  })
  test('rien à comparer : seulement le nombre ; égalité : stable', () => {
    assert.equal(texteHier({ hier: 3, avantHier: 0, semainePrec: 0 }, '2026-10-03'), 'Hier : 3 avis')
    assert.equal(texteHier({ hier: 5, avantHier: 5, semainePrec: 0 }, '2026-10-03'), 'Hier : 5 avis · = stable vs avant-hier')
  })
  test('contacts : singulier et pluriel', () => {
    assert.equal(texteHier({ hier: 1, avantHier: 0, semainePrec: 0 }, '2026-10-03', ['contact', 'contacts']), 'Hier : 1 contact')
    assert.equal(texteHier({ hier: 120, avantHier: 100, semainePrec: 0 }, '2026-10-03', ['contact', 'contacts']),
      'Hier : 120 contacts · ↑ 20 % vs avant-hier')
  })
})

describe('totalParJour', () => {
  test('additionne une valeur par date', () => {
    const lignes = [{ date: '2026-10-03', contacts: 10 }, { date: '2026-10-03', contacts: 5 }, { date: '2026-10-02', contacts: 7 }]
    assert.deepEqual(totalParJour(lignes, 'contacts'), { '2026-10-03': 15, '2026-10-02': 7 })
  })
})

describe('evolutionsHier — les flèches seules (ventes du gérant)', () => {
  test('détail : le sens de chaque comparaison, pour la couleur', () => {
    assert.deepEqual(evolutionsHierDetail({ hier: 108, avantHier: 100, semainePrec: 120 }, '2026-10-03'), [
      { texte: '↑ 8 % vs avant-hier', sens: 'hausse' },
      { texte: '↓ 10 % vs sam. dernier', sens: 'baisse' },
    ])
  })
  test('deux comparaisons', () => {
    assert.equal(evolutionsHier({ hier: 108, avantHier: 100, semainePrec: 120 }, '2026-10-03'),
      '↑ 8 % vs avant-hier · ↓ 10 % vs sam. dernier')
  })
  test('rien à comparer : vide', () => {
    assert.equal(evolutionsHier({ hier: 50, avantHier: 0, semainePrec: 0 }, '2026-10-03'), '')
  })
})
