// ──────────────────────────────────────────────────────────────────────────────
// Tests de la page relais du bouton avis (public/envoi-avis.js).
//
// Le relais tient le secret le temps d'un envoi : il ne doit écouter que les
// deux portails, et parler à l'utilisateur en français sans code technique.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../public/envoi-avis.js', import.meta.url), 'utf8')
const { plateformeDOrigine, messageHttp, resumeEnvoi } = new Function(source + '\nreturn moteurRelais')()()

describe('plateformeDOrigine — seuls les deux portails sont écoutés', () => {
  test('origines exactes', () => {
    assert.equal(plateformeDOrigine('https://portal.glovoapp.com'), 'glovo')
    assert.equal(plateformeDOrigine('https://vendor.yango.com'), 'yango')
  })
  test('tout le reste est refusé, y compris les imitations', () => {
    assert.equal(plateformeDOrigine('https://portal.glovoapp.com.evil.test'), null)
    assert.equal(plateformeDOrigine('http://vendor.yango.com'), null)
    assert.equal(plateformeDOrigine('https://samtrackly.vercel.app'), null)
  })
})

describe('messageHttp — erreurs en français', () => {
  test('secret refusé : le bouton est à réinstaller', () => {
    assert.equal(messageHttp(401), "Le bouton n'est plus à jour : demande au manager de le réinstaller.")
  })
  test('autre erreur : rien n’est perdu', () => {
    assert.equal(messageHttp(500), "L'envoi n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes.")
  })
})

describe('resumeEnvoi — le résultat affiché', () => {
  test('nouveaux avis, litiges, boutiques à rattacher', () => {
    assert.equal(resumeEnvoi('glovo', { inserted: 37, litiges_crees: 4, unmapped: 2 }),
      'Glovo : 37 nouveaux avis · 4 litiges créés · 2 à rattacher')
  })
  test('singulier', () => {
    assert.equal(resumeEnvoi('yango', { inserted: 1, litiges_crees: 1, unmapped: 0 }),
      'Yango : 1 nouvel avis · 1 litige créé')
  })
  test('litiges attribués à un caissier', () => {
    assert.equal(resumeEnvoi('glovo', { inserted: 5, litiges_crees: 2, unmapped: 0, litiges_attribues: 2 }),
      'Glovo : 5 nouveaux avis · 2 litiges créés · 2 attribués à un caissier')
  })
  test('rien de nouveau', () => {
    assert.equal(resumeEnvoi('glovo', { inserted: 0, litiges_crees: 0, unmapped: 0 }),
      'Glovo : aucun nouvel avis depuis le dernier envoi.')
  })
})
