import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PIN_SANS_CONNEXION, estCompteTechnique, comptesConnectables } from './comptesTechniques.js'

describe('comptes techniques (caissiers sans compte Samtrackly)', () => {
  test('un compte technique est reconnu à son PIN réservé', () => {
    assert.equal(estCompteTechnique({ pin: PIN_SANS_CONNEXION }), true)
    assert.equal(estCompteTechnique({ pin: '1234' }), false)
    assert.equal(estCompteTechnique(null), false)
  })

  test('aucun PIN tapé ne peut égaler le PIN réservé', () => {
    assert.match(PIN_SANS_CONNEXION, /\D/)
  })

  test('l’écran de connexion ne montre que les vrais comptes', () => {
    const liste = [
      { id: 'a', nom: 'Awa', pin: '4821' },
      { id: 'b', nom: 'KAZEM ALI', pin: PIN_SANS_CONNEXION },
    ]
    assert.deepEqual(comptesConnectables(liste).map(u => u.id), ['a'])
    assert.deepEqual(comptesConnectables(undefined), [])
  })
})
