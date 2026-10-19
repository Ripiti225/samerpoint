import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { miniature, sourceVignette } from './miniature.js'

const PHOTO = 'https://wlwotzxnzowbkbfcpnyi.supabase.co/storage/v1/object/public/photos/travailleurs/a.jpeg'

describe('miniature des photos', () => {
  test('demande à Supabase une image redimensionnée (×3 pour Retina)', () => {
    assert.equal(miniature(PHOTO, 44),
      'https://wlwotzxnzowbkbfcpnyi.supabase.co/storage/v1/render/image/public/photos/travailleurs/a.jpeg?width=132&height=132&resize=cover')
  })
  test('garde les paramètres déjà présents', () => {
    assert.match(miniature(`${PHOTO}?t=1`, 40), /a\.jpeg\?t=1&width=120&height=120&resize=cover$/)
  })
  test('plafonne la taille demandée', () => {
    assert.match(miniature(PHOTO, 900), /width=1000&height=1000/)
  })
  test('laisse passer les autres adresses et les valeurs vides', () => {
    assert.equal(miniature('blob:https://x/1'), 'blob:https://x/1')
    assert.equal(miniature('file:///tmp/a.jpg'), 'file:///tmp/a.jpg')
    assert.equal(miniature(null), null)
    assert.equal(miniature(undefined), undefined)
  })
})

describe('source d\'une vignette justificative', () => {
  test('vignette (compact) : miniature de 80 points', () => {
    assert.match(sourceVignette(PHOTO, { compact: true }), /render\/image\/public\/.*width=240&height=240/)
  })
  test('photo affichée en grand : taille réelle', () => {
    assert.equal(sourceVignette(PHOTO, { compact: false }), PHOTO)
  })
  test('miniature en échec : repli sur la photo normale', () => {
    assert.equal(sourceVignette(PHOTO, { compact: true, repli: true }), PHOTO)
  })
})
