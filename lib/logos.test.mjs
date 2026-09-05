import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as logos from './logos.js'

describe('identité des restaurants', () => {
  it('reconnaît À la Braise comme une marque indépendante', () => {
    assert.equal(logos.marquePourResto('À la Braise').id, 'alabraise')
    assert.equal(logos.marquePourResto({
      code: 'ALA_BRAISE',
      nom: 'À la Braise',
      marque: 'À la Braise',
    }).id, 'alabraise')
  })

  it('conserve les classements historiques Samer et Al Kayan', () => {
    assert.equal(logos.marquePourResto('Samer Maroc').id, 'samer')
    assert.equal(logos.marquePourResto('Al Kayan Yop').id, 'alkayan')
  })

  it('expose une couleur propre à chaque restaurant', () => {
    assert.equal(typeof logos.couleurPourResto, 'function')
    assert.equal(logos.couleurPourResto({
      code: 'ALA_BRAISE',
      couleur_principale: '#D99A2B',
    }), '#D99A2B')
    assert.equal(logos.couleurPourResto({ nom: 'Al Kayan KMS', couleur: 'vert' }), '#2D7D46')
    assert.equal(logos.couleurPourResto({ nom: 'Samer Maroc', couleur: 'orange' }), '#EF9F27')
  })
})
