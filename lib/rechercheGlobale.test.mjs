// Tests de lib/rechercheGlobale.js — recherche globale (loupe de l'accueil).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  LONGUEUR_MIN, cheminEcran, dateCourte, extrait, grouperParSource, normaliser, peutOuvrir, routePour, texteLisible,
} from './rechercheGlobale.js'
import { rechercheCourante } from './rechercheCourante.js'

describe('normaliser', () => {
  test('minuscules et accents retirés', () => {
    assert.equal(normaliser('PAIÉ Été'), 'paie ete')
    assert.equal(normaliser(null), '')
  })
})

describe('extrait', () => {
  test('mot trouvé sans tenir compte des accents ni des majuscules, casse d’origine gardée', () => {
    assert.deepEqual(extrait('Avance sur Paié Konan', 'paie'), { avant: 'Avance sur ', trouve: 'Paié', apres: ' Konan' })
  })
  test('coupe autour du mot avec des points de suspension', () => {
    const texte = 'a'.repeat(60) + ' paie ' + 'b'.repeat(60)
    const e = extrait(texte, 'paie', 10)
    assert.equal(e.trouve, 'paie')
    assert.equal(e.avant, '…' + 'a'.repeat(9) + ' ')
    assert.equal(e.apres, ' ' + 'b'.repeat(9) + '…')
  })
  test('mot absent : début du texte, rien de surligné', () => {
    assert.deepEqual(extrait('Bonjour', 'paie'), { avant: 'Bonjour', trouve: '', apres: '' })
  })
  test('espaces et retours à la ligne aplatis', () => {
    assert.equal(extrait('ligne 1\n\n  paie', 'paie').avant, 'ligne 1 ')
  })
})

describe('texteLisible', () => {
  test('un JSON devient « clé : valeur »', () => {
    assert.equal(texteLisible('{"note": "Paie client", "montant": 3}'), 'note : Paie client · montant : 3')
  })
  test('un texte normal ne bouge pas', () => {
    assert.equal(texteLisible('{pas du json'), '{pas du json')
    assert.equal(texteLisible('Solde paie'), 'Solde paie')
  })
})

describe('grouperParSource', () => {
  test('garde l’ordre de première apparition', () => {
    const g = grouperParSource([{ source: 'B', id: 1 }, { source: 'A', id: 2 }, { source: 'B', id: 3 }])
    assert.deepEqual(g.map(x => x.source), ['B', 'A'])
    assert.deepEqual(g[0].resultats.map(r => r.id), [1, 3])
  })
})

describe('cheminEcran', () => {
  test('écran seul', () => assert.equal(cheminEcran({ ecran: 'litiges' }), 'Litiges'))
  test('écran + onglet de trésorerie', () => {
    assert.equal(cheminEcran({ ecran: 'tresorerie-a-payer', onglet: 'anciens_travailleurs' }),
      'Trésorerie › À payer › Anciens travailleurs')
  })
  test('écran inconnu : son identifiant', () => assert.equal(cheminEcran({ ecran: 'bidule' }), 'bidule'))
})

describe('routePour', () => {
  test('pathname + params', () => {
    assert.deepEqual(routePour({ ecran: 'equipe', params: { restaurant_id: 'x' } }),
      { pathname: '/equipe', params: { restaurant_id: 'x' } })
    assert.deepEqual(routePour({ ecran: 'litiges', params: null }), { pathname: '/litiges', params: {} })
  })
})

describe('peutOuvrir', () => {
  test('le manager ouvre tout', () => assert.equal(peutOuvrir({ ecran: 'journal' }, [], true), true))
  test('le gérant ouvre seulement ses tuiles', () => {
    assert.equal(peutOuvrir({ ecran: 'deductions-gerant' }, ['deductions-gerant'], false), true)
    assert.equal(peutOuvrir({ ecran: 'litiges' }, ['deductions-gerant'], false), false)
  })
})

describe('dateCourte', () => {
  test('JJ/MM/AA', () => {
    assert.equal(dateCourte('2026-10-12'), '12/10/26')
    assert.equal(dateCourte(null), '')
  })
})

describe('rechercheCourante', () => {
  test('définir, lire, abonner, se désabonner', () => {
    const vus = []
    const stop = rechercheCourante.abonner(r => vus.push(r))
    rechercheCourante.definir({ id: 1 })
    assert.deepEqual(rechercheCourante.lire(), { id: 1 })
    stop()
    rechercheCourante.definir(null)
    assert.equal(rechercheCourante.lire(), null)
    assert.deepEqual(vus, [{ id: 1 }])
  })
})

test('3 lettres minimum', () => assert.equal(LONGUEUR_MIN, 3))
