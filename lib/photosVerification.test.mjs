import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let photosCanalDisponibles
try {
  ({ photosCanalDisponibles } = await import('./photosVerification.js'))
} catch {
  // Premier passage TDD : le filtre n'existe pas encore.
}

describe('photos affichées dans les ventes par canal', () => {
  test('ne propose que les photos réellement disponibles', () => {
    assert.equal(typeof photosCanalDisponibles, 'function')

    const photos = photosCanalDisponibles([
      { yango_cse: 15000, photo_yango_cse: null },
      { yango_cse: 22000, photo_yango_cse: 'https://photos.test/yango.jpg' },
      { yango_cse: 0, photo_yango_cse: 'https://photos.test/sans-montant.jpg' },
    ], {
      montantChamp: 'yango_cse',
      photoChamp: 'photo_yango_cse',
      label: 'Yango CSE',
    })

    assert.deepEqual(photos, [{
      uri: 'https://photos.test/yango.jpg',
      label: 'Yango CSE S2',
      montant: 22000,
    }])
  })

  test('renvoie une liste vide au lieu d’un état « aucune photo »', () => {
    assert.deepEqual(photosCanalDisponibles([
      { glovo_cse: 18000, photo_glovo_cse: '' },
    ], {
      montantChamp: 'glovo_cse',
      photoChamp: 'photo_glovo_cse',
      label: 'Glovo CSE',
    }), [])
  })
})
