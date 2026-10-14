// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/baremes.js — montants du contrat mémorisés par poste.
//
// Les postes sont saisis librement depuis des années (« Caissière »,
// « Caissier/re », espaces en trop). Sans normalisation, la RH retaperait les
// mêmes montants pour chaque variante.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { clePoste, familleDe, baremePour, montantsDepuisBareme, differeDuBareme } from './baremes.js'

describe('clePoste', () => {
  const cas = [
    ['Caissier/re', 'caissier'],
    ['Caissière  ', 'caissier'],
    ['Caissier', 'caissier'],
    ['Aide cuisinière  ', 'aide cuisinier'],
    ['Aide cuisinier', 'aide cuisinier'],
    ['Serveur/se', 'serveur'],
    ['Serveuse', 'serveur'],
    ['Plongeuse  ', 'plongeur'],
    ['Plonge ', 'plonge'],
    ['Gérant  ', 'gerant'],
    ['Pizzaïo', 'pizzaio'],
    ['Technicien de surface ', 'technicien de surface'],
    ['Serveur(se)', 'serveur'],
  ]
  for (const [poste, cle] of cas) {
    test(`« ${poste} » → ${cle}`, () => assert.equal(clePoste(poste), cle))
  }
  test('vide', () => assert.equal(clePoste(null), ''))
})

describe('familleDe', () => {
  test('stage', () => assert.equal(familleDe('Stage'), 'stage'))
  test('CDD et CDI partagent le barème', () => {
    assert.equal(familleDe('CDD'), 'contrat')
    assert.equal(familleDe('CDI'), 'contrat')
  })
})

const BAREMES = [
  { cle_poste: 'caissier', famille: 'contrat', categorie: '1', salaire_categoriel: 75000, prime_tenue: 3031, indemnite_transport: 30000 },
  { cle_poste: 'caissier', famille: 'stage', prime_journaliere: 3000 },
]

describe('baremePour', () => {
  test('CDD de « Caissière »', () => {
    assert.equal(baremePour(BAREMES, 'Caissière', 'CDD')?.salaire_categoriel, 75000)
  })
  test('stage de caissier', () => {
    assert.equal(baremePour(BAREMES, 'Caissier/re', 'Stage')?.prime_journaliere, 3000)
  })
  test('poste inconnu', () => assert.equal(baremePour(BAREMES, 'Plonge', 'CDD'), null))
})

describe('montantsDepuisBareme', () => {
  test('contrat', () => {
    assert.deepEqual(montantsDepuisBareme(BAREMES[0], 'CDI'),
      { categorie: '1', salaire_categoriel: 75000, prime_tenue: 3031, indemnite_transport: 30000 })
  })
  test('stage', () => {
    assert.deepEqual(montantsDepuisBareme(BAREMES[1], 'Stage'), { prime_journaliere: 3000 })
  })
  test('sans barème : champs vides', () => {
    assert.deepEqual(montantsDepuisBareme(null, 'CDD'),
      { categorie: '', salaire_categoriel: null, prime_tenue: null, indemnite_transport: null })
    assert.deepEqual(montantsDepuisBareme(null, 'Stage'), { prime_journaliere: null })
  })
})

describe('differeDuBareme', () => {
  const m = { categorie: '1', salaire_categoriel: 75000, prime_tenue: 3031, indemnite_transport: 30000 }
  test('identique', () => assert.equal(differeDuBareme(BAREMES[0], m, 'CDD'), false))
  test('prime de tenue changée', () => {
    assert.equal(differeDuBareme(BAREMES[0], { ...m, prime_tenue: 2422 }, 'CDD'), true)
  })
  test('montant saisi en texte', () => {
    assert.equal(differeDuBareme(BAREMES[0], { ...m, salaire_categoriel: '75000' }, 'CDD'), false)
  })
  test('aucun barème : toujours différent (à retenir)', () => {
    assert.equal(differeDuBareme(null, m, 'CDD'), true)
  })
  test('stage', () => {
    assert.equal(differeDuBareme(BAREMES[1], { prime_journaliere: 3500 }, 'Stage'), true)
  })
})
