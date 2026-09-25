import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { estInactif, destinationApresDeverrouillage } from './inactivityLock.js'

describe('verrouillage après inactivité', () => {
  test('verrouille exactement après cinq minutes sans interaction', () => {
    const derniereInteraction = 1_000

    assert.equal(estInactif(derniereInteraction, derniereInteraction + 120_000), false)
    assert.equal(estInactif(derniereInteraction, derniereInteraction + 299_999), false)
    assert.equal(estInactif(derniereInteraction, derniereInteraction + 300_000), true)
  })

  test('revient à la dernière route protégée après déverrouillage', () => {
    assert.equal(destinationApresDeverrouillage('contacts'), '/contacts')
  })

  test('ne restaure jamais la page de connexion comme destination', () => {
    assert.equal(destinationApresDeverrouillage('login'), null)
    assert.equal(destinationApresDeverrouillage(null), null)
  })
})
