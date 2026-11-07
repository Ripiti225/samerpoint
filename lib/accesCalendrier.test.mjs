// Tests de lib/accesCalendrier.js — qui voit quoi dans le calendrier.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACCES_CALENDRIER_DEFAUT, TYPES_CALENDRIER, basculerType, estVerrouille, typesAutorises } from './accesCalendrier.js'

const TOUS = TYPES_CALENDRIER.map(t => t.cle)

test('par défaut : le RH sans chèques, coffre ni dettes ; le gérant sans Trésorerie ni contrats', () => {
  const rh = typesAutorises('rh')
  for (const k of ['cheques', 'coffre', 'echeances_retard']) assert.equal(rh.includes(k), false, k)
  for (const k of ['echeances', 'previsions', 'charges', 'contrats', 'conges', 'taches']) assert.equal(rh.includes(k), true, k)
  const g = typesAutorises('gerant')
  for (const k of ['cheques', 'coffre', 'echeances_retard', 'echeances', 'previsions', 'charges', 'contrats', 'age']) assert.equal(g.includes(k), false, k)
  for (const k of ['anniversaires', 'anciennete', 'evenements', 'conges', 'taches']) assert.equal(g.includes(k), true, k)
})

test('le réglage remplace le défaut du rôle, les types inconnus sont ignorés', () => {
  assert.deepEqual(typesAutorises('rh', { config: { rh: ['cheques', 'inconnu'] } }), ['cheques'])
  assert.deepEqual(typesAutorises('rh', { config: { rh: [] } }), [])
  assert.deepEqual(typesAutorises('rh', { config: { gerant: [] } }), ACCES_CALENDRIER_DEFAUT.rh)
})

test('garde-fou : jamais de chèques, coffre ni dettes pour le gérant, même cochés', () => {
  const g = typesAutorises('gerant', { config: { gerant: ['cheques', 'coffre', 'echeances_retard', 'echeances'] } })
  assert.deepEqual(g, ['echeances'])
  for (const k of ['cheques', 'coffre', 'echeances_retard']) assert.equal(estVerrouille('gerant', k), true, k)
  assert.equal(estVerrouille('gerant', 'echeances'), false)
  assert.equal(estVerrouille('rh', 'cheques'), false)
})

test('le propriétaire voit toujours tout, quels que soient les réglages', () => {
  assert.deepEqual(typesAutorises('manager', { proprietaire: true, config: { manager: [] } }), TOUS)
})

test('garde-fou même pour le propriétaire : jamais de chèques, coffre ni dettes pour le gérant', () => {
  const g = typesAutorises('gerant', { proprietaire: true })
  for (const k of ['cheques', 'coffre', 'echeances_retard']) assert.equal(g.includes(k), false, k)
  assert.equal(g.includes('echeances'), true)
})

test('un rôle hors liste ne voit rien', () => {
  assert.deepEqual(typesAutorises('caissier'), [])
  assert.deepEqual(typesAutorises('caissier', { config: { caissier: ['cheques'] } }), [])
})

test('basculerType : ajoute ou retire', () => {
  assert.deepEqual(basculerType(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(basculerType(['a', 'b'], 'a'), ['b'])
})

test('les fins de contrat ne sont jamais pour le gérant', () => {
  assert.equal(estVerrouille('gerant', 'contrats'), true)
  assert.equal(estVerrouille('rh', 'contrats'), false)
  assert.equal(typesAutorises('gerant', { config: { gerant: ['contrats', 'conges'] } }).includes('contrats'), false)
  assert.equal(typesAutorises('gerant', { proprietaire: true }).includes('contrats'), false)
})
