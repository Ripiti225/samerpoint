// Tests de lib/groupesAccueil.js — regroupement des tuiles de l'accueil manager.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  FAVORIS_ADMIN, GROUPES_ADMIN, ICONES_TUILES, etatPointsDuJour, nbAVerifier, nomCourtResto, organiserAccueilAdmin,
} from './groupesAccueil.js'

// Les id admin du catalogue, lus dans lib/menus.js (qui ne se charge pas sous node).
const idsAdmin = [...fs.readFileSync(new URL('./menus.js', import.meta.url), 'utf8')
  .matchAll(/\{ id: '([^']+)'[^\n]*admin: true/g)].map(m => m[1])

describe('accueil manager', () => {
  test('chaque tuile admin du catalogue est rangée dans exactement un groupe', () => {
    assert.ok(idsAdmin.length >= 20)
    for (const id of idsAdmin) {
      assert.equal(GROUPES_ADMIN.filter(g => g.tuiles.includes(id)).length, 1, id)
    }
  })
  test('les favoris existent dans le catalogue', () => {
    for (const id of FAVORIS_ADMIN) assert.ok(idsAdmin.includes(id), id)
  })
  test('favoris d\'abord, groupes vides retirés, tuile inconnue dans « Autres »', () => {
    const r = organiserAccueilAdmin([{ id: 'journal' }, { id: 'tresorerie' }, { id: 'nouvelle' }])
    assert.deepEqual(r.favoris.map(t => t.id), ['tresorerie'])
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(t => t.id)]), [['tresorerie', ['tresorerie']], ['administration', ['journal']]])
    assert.deepEqual(r.autres.map(t => t.id), ['nouvelle'])
  })
})

describe('icônes et points du jour', () => {
  test('chaque tuile admin a son icône vectorielle', () => {
    for (const id of idsAdmin) assert.ok(ICONES_TUILES[id], id)
  })
  test('noms courts des restaurants', () => {
    assert.deepEqual(['Samer Palmeraie', 'Al Kayan KMS', 'À la Braise', 'Samer Angré 7E'].map(nomCourtResto),
      ['Palmeraie', 'KMS', 'Braise', 'Angré 7E'])
  })
  test('état des points d\'une journée : vérifié, à vérifier, en attente', () => {
    const restaurants = [{ id: 'k', nom: 'Al Kayan KMS' }, { id: 'p', nom: 'Samer Palmeraie' }, { id: 'b', nom: 'À la Braise' }]
    const points = [
      { restaurant_id: 'k', date: '2026-10-02', valide: true, verifie: true },
      { restaurant_id: 'p', date: '2026-10-02', valide: true, verifie: false },
      { restaurant_id: 'b', date: '2026-10-01', valide: true, verifie: true },
    ]
    const e = etatPointsDuJour({ points, restaurants, date: '2026-10-02' })
    assert.deepEqual(e.lignes.map(l => [l.nom, l.statut]), [['Braise', 'en_attente'], ['KMS', 'verifie'], ['Palmeraie', 'a_verifier']])
    assert.deepEqual([e.valides, e.total], [2, 3])
    assert.equal(nbAVerifier(points), 1)
  })
})
