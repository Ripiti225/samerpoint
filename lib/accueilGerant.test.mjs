// Tests de lib/accueilGerant.js — le bandeau du jour de l'accueil gérant.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { etatPointHier, texteDemandes } from './accueilGerant.js'

describe('etatPointHier', () => {
  test('les corrections demandées passent avant tout', () => {
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: true }, nbCorrections: 2 }),
      { cle: 'corrections', texte: '2 corrections demandées par le manager' })
    assert.equal(etatPointHier({ point: null, nbCorrections: 1 }).texte, '1 correction demandée par le manager')
  })
  test('validé, vérifié, en attente, pas saisi', () => {
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: true }, nbCorrections: 0 }), { cle: 'verifie', texte: "Point d'hier validé et vérifié" })
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: false } }), { cle: 'valide', texte: "Point d'hier validé" })
    assert.deepEqual(etatPointHier({ point: { valide: false } }), { cle: 'en_attente', texte: "Point d'hier pas encore validé" })
    assert.deepEqual(etatPointHier({ point: null }), { cle: 'absent', texte: "Point d'hier pas encore saisi" })
  })
})

describe('texteDemandes', () => {
  test('singulier, pluriel, zéro', () => {
    assert.equal(texteDemandes({ demandes: 2, explications: 1 }), '2 demandes en attente · 1 explication en cours')
    assert.equal(texteDemandes({ demandes: 1, explications: 0 }), '1 demande en attente')
    assert.equal(texteDemandes({ demandes: 0, explications: 3 }), '3 explications en cours')
    assert.equal(texteDemandes({ demandes: 0, explications: 0 }), 'Aucune demande en attente')
  })
})
