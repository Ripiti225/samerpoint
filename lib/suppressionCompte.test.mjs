import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let expliquerEchecSuppression
try {
  ({ expliquerEchecSuppression } = await import('./suppressionCompte.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

describe('échec de suppression expliqué en français', () => {
  test('un compte avec de l’historique propose la désactivation', () => {
    assert.equal(typeof expliquerEchecSuppression, 'function')
    const info = expliquerEchecSuppression('utilisateurs', {
      code: '23503',
      message: 'update or delete on table "utilisateurs" violates foreign key constraint "points_shifts_caissier_id_fkey" on table "points_shifts"',
    })

    assert.equal(info.proposerDesactivation, true)
    assert.match(info.texte, /historique/i)
    assert.match(info.texte, /désactiv/i)
  })

  test('reconnaît la contrainte même sans code, d’après le message seul', () => {
    const info = expliquerEchecSuppression('utilisateurs', {
      message: 'violates foreign key constraint',
    })
    assert.equal(info.proposerDesactivation, true)
  })

  test('nomme l’élément selon la table', () => {
    const contrainte = { code: '23503', message: 'violates foreign key constraint' }
    assert.match(expliquerEchecSuppression('utilisateurs', contrainte).texte, /compte/i)
    assert.match(expliquerEchecSuppression('restaurants', contrainte).texte, /restaurant/i)
    assert.match(expliquerEchecSuppression('fournisseurs', contrainte).texte, /fournisseur/i)
  })

  test('un refus de droits ne propose pas la désactivation', () => {
    const info = expliquerEchecSuppression('utilisateurs', {
      code: '42501',
      message: 'new row violates row-level security policy',
    })
    assert.equal(info.proposerDesactivation, false)
    assert.match(info.texte, /droits/i)
  })

  test('une coupure réseau est annoncée comme telle', () => {
    const info = expliquerEchecSuppression('utilisateurs', { message: 'TypeError: Network request failed' })
    assert.equal(info.proposerDesactivation, false)
    assert.match(info.texte, /connexion/i)
  })

  test('une erreur inconnue reste lisible et garde le détail technique', () => {
    const info = expliquerEchecSuppression('utilisateurs', { message: 'quelque chose d’imprévu' })
    assert.equal(info.proposerDesactivation, false)
    assert.match(info.texte, /quelque chose d’imprévu/)
  })

  test('sans erreur, rien à expliquer', () => {
    assert.equal(expliquerEchecSuppression('utilisateurs', null), null)
  })
})
