// Tests de lib/groupes.js — rattachement d'une fiche à un restaurant ou à un groupe.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cleRattachement, estFicheGroupe, nomRattachement } from './groupes.js'

const restaurants = [{ id: 'r1', nom: 'Samer Maroc ' }]
const groupes = [{ id: 'g1', nom: 'Groupe Samer' }]

describe('cleRattachement', () => {
  test('restaurant d\'abord', () => assert.equal(cleRattachement({ restaurant_id: 'r1', groupe_id: null }), 'r1'))
  test('groupe sinon', () => assert.equal(cleRattachement({ restaurant_id: null, groupe_id: 'g1' }), 'groupe:g1'))
  test('rien', () => assert.equal(cleRattachement({}), null))
})

describe('nomRattachement', () => {
  test('restaurant, sans espace final', () => assert.equal(nomRattachement('r1', restaurants, groupes), 'Samer Maroc'))
  test('groupe', () => assert.equal(nomRattachement('groupe:g1', restaurants, groupes), 'Groupe Samer'))
  test('groupe inconnu', () => assert.equal(nomRattachement('groupe:zz', restaurants, groupes), 'Groupe'))
  test('vide', () => assert.equal(nomRattachement(null, restaurants, groupes), '—'))
  test('restaurant inconnu', () => assert.equal(nomRattachement('zz', restaurants, groupes), '—'))
})

describe('estFicheGroupe', () => {
  test('groupe sans restaurant', () => assert.equal(estFicheGroupe({ groupe_id: 'g1', restaurant_id: null }), true))
  test('restaurant', () => assert.equal(estFicheGroupe({ groupe_id: null, restaurant_id: 'r1' }), false))
})
