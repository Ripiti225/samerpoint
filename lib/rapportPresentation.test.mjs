// Tests de lib/rapportPresentation.js — couleurs et résultat net du rapport mensuel.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PALETTE_RESTAURANTS, couleursRestaurants, eclaircir, resultatNetGroupe, resultatNetResto, rgb } from './rapportPresentation.js'

test('une couleur différente par restaurant, stable selon le nom', () => {
  const restos = [{ id: 'p', nom: 'Samer Palmeraie' }, { id: 'k', nom: 'Al Kayan KMS ' }, { id: 'b', nom: 'À la Braise' }, { id: 'y', nom: 'Al Kayan Yop' }]
  const c = couleursRestaurants(restos)
  assert.equal(new Set(Object.values(c)).size, 4)
  assert.deepEqual(couleursRestaurants([...restos].reverse()), c)    // l'ordre reçu ne change rien
  assert.equal(c.b, PALETTE_RESTAURANTS[0])                          // « À la Braise » d'abord (accent ignoré)
})

test('conversions de couleur', () => {
  assert.deepEqual(rgb('#1971C2'), [25, 113, 194])
  assert.equal(eclaircir('000000', 0.5), '808080')
  assert.equal(eclaircir('FFFFFF'), 'FFFFFF')
})

test('résultat net : celui de Trésorerie (groupe avec arriérés), et par restaurant', () => {
  const rapport = { analyse: { totaux: { net: 5, netGroupe: 3, netGroupePrec: 2, arrieresGroupe: 2 }, lignes: [{ id: 'p', net: -4, netPrec: 1 }, { id: 'k', net: null }] } }
  assert.deepEqual(resultatNetGroupe(rapport), { valeur: 3, prec: 2, arrieres: 2 })
  assert.deepEqual(resultatNetResto(rapport, 'p'), { valeur: -4, prec: 1 })
  assert.equal(resultatNetResto(rapport, 'k'), null)
  assert.equal(resultatNetGroupe({}), null)
})
