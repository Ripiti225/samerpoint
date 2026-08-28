import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { INACTIVITY_TIMEOUT_MS, estInactif, destinationApresDeverrouillage } from './inactivityLock.js'

describe('verrouillage après inactivité', () => {
  test('verrouille exactement après deux minutes sans interaction', () => {
    const derniereInteraction = 1_000

    assert.equal(estInactif(derniereInteraction, derniereInteraction + INACTIVITY_TIMEOUT_MS - 1), false)
    assert.equal(estInactif(derniereInteraction, derniereInteraction + INACTIVITY_TIMEOUT_MS), true)
  })

  test('revient à la dernière route protégée après déverrouillage', () => {
    assert.equal(destinationApresDeverrouillage('contacts'), '/contacts')
  })

  test('ne restaure jamais la page de connexion comme destination', () => {
    assert.equal(destinationApresDeverrouillage('login'), null)
    assert.equal(destinationApresDeverrouillage(null), null)
  })
})
