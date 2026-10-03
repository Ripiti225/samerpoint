// Tests de lib/groupesAccueil.js — regroupement des tuiles de l'accueil manager.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { FAVORIS_ADMIN, GROUPES_ADMIN, organiserAccueilAdmin } from './groupesAccueil.js'

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
