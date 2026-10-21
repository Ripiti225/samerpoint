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
const { plateformeDOrigine, messageHttp, resumeEnvoi, resumeCommandes, resumeReponses } = new Function(source + '\nreturn moteurRelais')()()

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

describe('resumeCommandes — le résultat des litiges automatiques', () => {
  test('commandes, litiges et journées à relier', () => {
    assert.equal(resumeCommandes('glovo', 69, { litiges: 3, a_relier: 2, a_rattacher: 0 }),
      'Glovo : 69 commandes lues · 3 litiges · 2 journées à relier (Litiges → Correspondances)')
  })
  test('rien à signaler', () => {
    assert.equal(resumeCommandes('yango', 1, { litiges: 0, a_relier: 0, a_rattacher: 0 }),
      'Yango : 1 commande lue · aucun litige')
  })
  test('boutiques non rattachées signalées', () => {
    assert.equal(resumeCommandes('yango', 10, { litiges: 1, a_relier: 0, a_rattacher: 4 }),
      'Yango : 10 commandes lues · 1 litige · 4 commandes d’une boutique non rattachée')
  })
})

describe('resumeReponses — ce que voit le manager après l’envoi', () => {
  test('envoyées et refusées', () => {
    assert.equal(resumeReponses([{ ok: true }, { ok: true }, { ok: false, erreur: 'x' }]), 'Réponses Glovo : 2 envoyées · 1 refusée par Glovo (à corriger dans Samtrackly)')
  })
  test('une seule envoyée', () => {
    assert.equal(resumeReponses([{ ok: true }]), 'Réponses Glovo : 1 envoyée')
  })
  test('rien à envoyer : rien à dire', () => {
    assert.equal(resumeReponses([]), '')
  })
})
