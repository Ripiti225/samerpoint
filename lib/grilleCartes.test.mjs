// Tests de lib/grilleCartes.js — cartes Banque qui s'adaptent à l'écran.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { colonnesCartes, tailleQuiTient } from './grilleCartes.js'

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

describe('tailleQuiTient', () => {
  test('petit solde : taille maximale', () => {
    assert.equal(tailleQuiTient('25 000 F', 146, { max: 24, min: 16 }), 24)
  })

  test('grand solde : la police diminue pour tenir', () => {
    assert.equal(tailleQuiTient('-12 345 678 F', 146, { max: 24, min: 16 }), 18)
  })

  test('jamais sous le minimum', () => {
    assert.equal(tailleQuiTient('1 234 567 890 123 F', 100, { max: 24, min: 16 }), 16)
  })
})
