// Tests de lib/inventaireGlobal.js — inventaire du jour (somme des shifts) et
// plats qui ont fait sortir un produit.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cumulerVentes, inventaireGlobal, platsDuProduit } from './inventaireGlobal.js'

const ligne = (produit_id, produit_nom, stock_initial, entrees, sorties, stock_reel, ecart = 0) =>
  ({ produit_id, produit_nom, stock_initial, entrees, sorties, stock_reel, ecart })

describe('inventaireGlobal', () => {
  const matin = { lignes: [ligne('p1', 'Pain chawarma', 100, 20, 30, 89, -1), ligne('f10', 'Total Fromage', 5000, 0, 1490, 3510)] }
  const soir = { lignes: [ligne('p1', 'Pain chawarma', 89, 0, 40, 49), ligne('b6', 'Pot Fresco', 10, 6, 7, 9)] }

  test('additionne les shifts : début du 1er, entrées et sorties cumulées, fin du dernier', () => {
    const g = inventaireGlobal([matin, soir])
    assert.deepEqual(g.find(l => l.produitId === 'p1'), {
      produitId: 'p1', produitNom: 'Pain chawarma', stockInitial: 100, entrees: 20, sorties: 70, stockReel: 49, ecart: -1, nbShifts: 2,
    })
  })
  test('un produit compté dans un seul shift garde ses chiffres', () => {
    const g = inventaireGlobal([matin, soir])
    assert.equal(g.find(l => l.produitId === 'b6').stockInitial, 10)
    assert.equal(g.find(l => l.produitId === 'f10').stockReel, 3510)
    assert.deepEqual(g.map(l => l.produitId), ['p1', 'f10', 'b6'], 'ordre de première apparition')
  })
  test('les lignes non comptées (stock réel vide) sont ignorées', () => {
    const g = inventaireGlobal([{ lignes: [ligne('p2', 'Pain burger', 5, 0, 1, null)] }])
    assert.deepEqual(g, [])
  })
  test('pas de flottants parasites : 0,13 + 0,26 = 0,39', () => {
    const g = inventaireGlobal([{ lignes: [ligne('fr3', 'Frites', 2, 0, 0.13, 1.87)] }, { lignes: [ligne('fr3', 'Frites', 1.87, 0, 0.26, 1.61)] }])
    assert.equal(g[0].sorties, 0.39)
  })
  test('rien à additionner', () => {
    assert.deepEqual(inventaireGlobal([]), [])
    assert.deepEqual(inventaireGlobal(null), [])
  })
})

describe('cumulerVentes', () => {
  test('additionne les plats de plusieurs shifts', () => {
    const v = cumulerVentes({ s1: [{ nom: 'Chawarma Poulet', qte: 5 }], s2: [{ nom: 'Chawarma Poulet', qte: 3 }, { nom: 'Fresco', qte: 2 }] }, ['s1', 's2', 'absent'])
    assert.deepEqual(v, { 'Chawarma Poulet': 8, Fresco: 2 })
  })
  test('les suppléments ne sont pas des plats', () => {
    const v = cumulerVentes({ s1: [{ nom: 'Fromage', qte: 2, supplement: true }, { nom: 'Burger', qte: 1 }] }, ['s1'])
    assert.deepEqual(v, { Burger: 1 })
  })
})

describe('platsDuProduit', () => {
  test('pain chawarma : un pain par chawarma, deux par assiette', () => {
    const r = platsDuProduit('p1', { 'Chawarma Poulet': 13, 'Chawarma Mélange': 58, 'Assiette Chawarma': 2, Fresco: 9 }, 75)
    assert.deepEqual(r.lignes, [
      { plat: 'Chawarma Mélange', nombre: 58, parPlat: 1, consomme: 58 },
      { plat: 'Chawarma Poulet', nombre: 13, parPlat: 1, consomme: 13 },
      { plat: 'Assiette Chawarma', nombre: 2, parPlat: 2, consomme: 4 },
    ])
    assert.equal(r.totalCalcule, 75)
    assert.equal(r.ecart, 0)
    assert.equal(r.aRecette, true)
    assert.equal(r.unite, '')
  })
  test('fromage en grammes, écart avec la sortie du POS', () => {
    const r = platsDuProduit('f10', { 'Pizza Royale (M)': 4, 'Manaich Fromage': 5, 'Tacos Poulet': 2 }, 1250)
    assert.equal(r.totalCalcule, 4 * 160 + 5 * 100 + 2 * 50)
    assert.equal(r.ecart, 10)
    assert.equal(r.unite, 'g')
  })
  test('produit sans recette : rien d\'inventé', () => {
    const r = platsDuProduit('xx', { Burger: 3 }, 2)
    assert.deepEqual(r, { lignes: [], totalCalcule: 0, ecart: 2, aRecette: false, unite: '' })
  })
})
