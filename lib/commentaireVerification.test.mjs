// Tests de lib/commentaireVerification.js — le message que le gérant lit dans
// sa cloche après une décision de la Vérification.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { messageDecision, messagePointVerifie, nettoyerCommentaire, COMMENTAIRE_MAX } from './commentaireVerification.js'

describe('messageDecision', () => {
  test('écart, explication et commentaire sur des lignes séparées', () => {
    assert.equal(
      messageDecision('Explication refusée.', { ecart: '-3 000 FCFA', explication: 'erreur de monnaie', commentaire: ' Recompter le tiroir ' }),
      'Explication refusée.\nÉcart : -3 000 FCFA\nExplication du caissier : « erreur de monnaie »\nCommentaire de la vérification : Recompter le tiroir'
    )
  })

  test('sans commentaire ni explication : aucune ligne vide', () => {
    assert.equal(messageDecision('Refusé.', { ecart: '500 FCFA', explication: '  ', commentaire: '' }), 'Refusé.\nÉcart : 500 FCFA')
    assert.equal(messageDecision('Refusé.'), 'Refusé.')
  })
})

describe('messagePointVerifie', () => {
  test('rien à envoyer sans appréciation', () => {
    assert.equal(messagePointVerifie({ restaurant: 'Yop', date: '19/10/2026', par: 'Samer', commentaire: '   ' }), null)
  })

  test('appréciation avec restaurant, date et auteur', () => {
    assert.equal(
      messagePointVerifie({ restaurant: 'Yop', date: '19/10/2026', par: 'Samer', commentaire: 'Très propre, bravo' }),
      'Yop — point du 19/10/2026 vérifié par Samer.\nAppréciation : Très propre, bravo'
    )
  })
})

test('commentaire coupé à la longueur maximale', () => {
  assert.equal(nettoyerCommentaire('a'.repeat(COMMENTAIRE_MAX + 50)).length, COMMENTAIRE_MAX)
  assert.equal(nettoyerCommentaire(null), '')
})
