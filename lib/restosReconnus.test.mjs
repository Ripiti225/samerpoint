import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const {
  signatureResto, normaliserReconnus, estReconnu, ajouterReconnu,
  nettoyerReconnus, trierRestaurants, ecranDeDepart,
} = await import('./restosReconnus.js')

const angre = { id: 'r1', nom: 'Angré 7E', pin: '9073' }
const palm = { id: 'r2', nom: 'Palmeraie', pin: '1188' }

describe('signature du code restaurant', () => {
  test('stable, et change avec le code', () => {
    assert.equal(signatureResto(angre), signatureResto({ ...angre }))
    assert.equal(signatureResto({ ...angre, pin: 9073 }), signatureResto(angre))
    assert.notEqual(signatureResto({ ...angre, pin: '9074' }), signatureResto(angre))
    assert.match(signatureResto(angre), /^[0-9a-f]{8}$/)
  })
})

describe('liste des restaurants reconnus', () => {
  test('format illisible → liste vide', () => {
    assert.deepEqual(normaliserReconnus(null), [])
    assert.deepEqual(normaliserReconnus('x'), [])
    assert.deepEqual(normaliserReconnus([{ restaurantId: 'r1' }, null]), [])
  })

  test('reconnu après ajout, plus reconnu si le code change', () => {
    const liste = ajouterReconnu([], angre)
    assert.equal(estReconnu(liste, angre), true)
    assert.equal(estReconnu(liste, palm), false)
    assert.equal(estReconnu(liste, { ...angre, pin: '0000' }), false)
    assert.equal(estReconnu(liste, null), false)
  })

  test('ré-ajouter remplace sans doublon', () => {
    const liste = ajouterReconnu(ajouterReconnu([], angre), { ...angre, pin: '5555' })
    assert.equal(liste.length, 1)
    assert.equal(estReconnu(liste, { ...angre, pin: '5555' }), true)
  })

  test('nettoyer oublie un code changé, garde un restaurant absent (hors ligne)', () => {
    const liste = ajouterReconnu(ajouterReconnu([], angre), palm)
    const net = nettoyerReconnus(liste, [{ ...angre, pin: '0000' }])
    assert.deepEqual(net.map(r => r.restaurantId), ['r2'])
  })

  test('les restaurants reconnus passent en premier, ordre conservé sinon', () => {
    const c = { id: 'r3', nom: 'Cocody', pin: '1' }
    const liste = ajouterReconnu([], c)
    assert.deepEqual(trierRestaurants([angre, palm, c], liste).map(r => r.id), ['r3', 'r1', 'r2'])
  })
})

describe('écran de départ', () => {
  test('un seul restaurant reconnu, pas de Face ID ailleurs → ouverture directe', () => {
    const r = ecranDeDepart({ valides: [angre], enrolements: [{ userId: 'u1', restaurantId: 'r1' }], verrouille: false })
    assert.deepEqual(r, { ecran: 'quiEtesVous', restaurant: angre })
  })

  test('Face ID administration présent → accueil', () => {
    const r = ecranDeDepart({ valides: [angre], enrolements: [{ userId: 'm1', restaurantId: null }], verrouille: false })
    assert.equal(r.ecran, 'accueil')
  })

  test('zéro ou plusieurs restaurants reconnus → accueil', () => {
    assert.equal(ecranDeDepart({ valides: [], enrolements: [], verrouille: false }).ecran, 'accueil')
    assert.equal(ecranDeDepart({ valides: [angre, palm], enrolements: [], verrouille: false }).ecran, 'accueil')
  })

  test('session verrouillée → le flux de verrouillage garde la main', () => {
    assert.equal(ecranDeDepart({ valides: [angre], enrolements: [], verrouille: true }).ecran, 'accueil')
  })
})
