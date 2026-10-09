// Tests de lib/litigesPlateformes.js — litiges Yango/Glovo automatiques.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliserNom, quatreChiffres, compteCommeVendue, jourDe, heureDe, proposerCorrespondance,
} from './litigesPlateformes.js'

describe('normaliserNom', () => {
  test('minuscules, sans accents ni ponctuation', () => {
    assert.equal(normaliserNom('  Chawarma Poulet — XL ! '), 'chawarma poulet xl')
    assert.equal(normaliserNom('Thé glacé'), 'the glace')
    assert.equal(normaliserNom(null), '')
  })
})

describe('quatreChiffres', () => {
  test('garde les 4 derniers chiffres', () => {
    assert.equal(quatreChiffres('101791205516'), '5516')
    assert.equal(quatreChiffres(' 5516 '), '5516')
    assert.equal(quatreChiffres('YG-2510-0042'), '0042')
  })
  test('moins de 4 chiffres ou vide : null', () => {
    assert.equal(quatreChiffres('42'), null)
    assert.equal(quatreChiffres(''), null)
    assert.equal(quatreChiffres(null), null)
  })
})

describe('compteCommeVendue', () => {
  test('livrée : vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'glovo', statut: 'livree' }), true)
  })
  test('Yango annulée mais payée : vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: 4500 }), true)
  })
  test('Yango annulée sans paiement : pas vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: 0 }), false)
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: null }), false)
  })
  test('Glovo annulée : jamais vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'glovo', statut: 'annulee', montant_paye: 4500 }), false)
  })
  test('autre statut : pas vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'autre' }), false)
  })
})

describe('jourDe / heureDe — Abidjan = UTC', () => {
  test('découpe une date ISO', () => {
    assert.equal(jourDe('2026-10-08T23:59:00Z'), '2026-10-08')
    assert.equal(jourDe('2026-10-08T23:59:00.000+00:00'), '2026-10-08')
    assert.equal(heureDe('2026-10-08T14:07:31Z'), '14:07')
  })
})

describe('proposerCorrespondance', () => {
  const nomsPos = ['Chawarma poulet', 'Chawarma viande', 'Pizza reine', 'Coca 33cl']
  test('le nom POS le plus proche', () => {
    assert.equal(proposerCorrespondance('Chawarma Poulet XL', nomsPos), 'Chawarma poulet')
    assert.equal(proposerCorrespondance('PIZZA REINE', nomsPos), 'Pizza reine')
  })
  test('rien de ressemblant : null', () => {
    assert.equal(proposerCorrespondance('Burger double', nomsPos), null)
  })
})
