// Tests de lib/grilleCartes.js — cartes Banque qui s'adaptent à l'écran.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { colonnesCartes } from './grilleCartes.js'

describe('colonnesCartes', () => {
  test('deux cartes quand elles tiennent', () => {
    assert.deepEqual(colonnesCartes(358), { colonnes: 2, largeurCarte: 174 })
  })

  test('une seule carte sur un écran étroit', () => {
    assert.deepEqual(colonnesCartes(288), { colonnes: 1, largeurCarte: 288 })
  })

  test('largeur pas encore mesurée : deux colonnes par défaut', () => {
    assert.deepEqual(colonnesCartes(0), { colonnes: 2, largeurCarte: null })
  })
})

