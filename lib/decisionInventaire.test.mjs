import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { calculerDecisionInventaire } from './decisionInventaire.js'

describe('calculerDecisionInventaire', () => {
  test('une validation accepte au maximum la quantité expliquée et l’écart', () => {
    assert.deepEqual(
      calculerDecisionInventaire({ statut: 'validee', ecart: -3, nombreExplique: 1, prix: 8000 }),
      { quantiteAcceptee: 1, montantDeduit: 16000 },
    )
    assert.deepEqual(
      calculerDecisionInventaire({ statut: 'validee', ecart: -3, nombreExplique: 9, prix: 8000 }),
      { quantiteAcceptee: 3, montantDeduit: 0 },
    )
  })

  test('un refus remet la déduction pleine', () => {
    assert.deepEqual(
      calculerDecisionInventaire({ statut: 'refusee', ecart: -3, nombreExplique: 1, prix: 8000 }),
      { quantiteAcceptee: 0, montantDeduit: 24000 },
    )
  })

  test('refuse les statuts et nombres invalides', () => {
    assert.throws(
      () => calculerDecisionInventaire({ statut: 'autre', ecart: -3, nombreExplique: 1, prix: 8000 }),
      /Statut de décision invalide/,
    )
    assert.throws(
      () => calculerDecisionInventaire({ statut: 'validee', ecart: -3, nombreExplique: 1, prix: -1 }),
      /Prix produit invalide/,
    )
  })
})
