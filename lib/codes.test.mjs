// Tests de lib/codes.js — règles des nouveaux codes personnels.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { codeTropSimple, empreinteHorsLigne, libelleAttente, longueurCode, problemeNouveauCode } from './codes.js'

test('codes trop simples refusés', () => {
  for (const c of ['111111', '000000', '123456', '234567', '890123', '654321', '210987', '121212', '123123', '12345', '1234567', 'abcdef', '']) {
    assert.equal(codeTropSimple(c), true, c)
  }
  for (const c of ['482913', '730516', '118204', '905371']) assert.equal(codeTropSimple(c), false, c)
})

test('message du nouveau code', () => {
  assert.match(problemeNouveauCode('1234'), /6 chiffres/)
  assert.match(problemeNouveauCode('482913', '482913'), /différent/)
  assert.match(problemeNouveauCode('123456', '0000'), /trop facile/)
  assert.equal(problemeNouveauCode('482913', '0000'), null)
})

test('longueur du code, empreinte hors ligne, attente', () => {
  assert.equal(longueurCode({ pin_longueur: 6 }), 6)
  assert.equal(longueurCode({}), 4)
  assert.equal(empreinteHorsLigne('u1', '482913'), empreinteHorsLigne('u1', '482913'))
  assert.notEqual(empreinteHorsLigne('u1', '482913'), empreinteHorsLigne('u2', '482913'))
  assert.equal(libelleAttente(45), '45 s')
  assert.equal(libelleAttente(900), '15 min')
})
