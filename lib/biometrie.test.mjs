import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const {
  texteSignature, peutProposerActivation, controlerEnrolement,
  versBase64Url, depuisBase64Url,
  normaliserEnrolements, ajouterEnrolement, retirerEnrolement,
} = await import('./biometrie.js')

const gerant = { id: 'u1', nom: 'Awa', role: 'gerant', actif: true, pin: '4821', restaurant_id: 'r1' }
const resto = { id: 'r1', nom: 'Angré 7E', pin: '9073' }

describe('signature des codes', () => {
  test('change dès qu’un des deux codes change', () => {
    const base = texteSignature(gerant, resto)
    assert.notEqual(texteSignature({ ...gerant, pin: '4822' }, resto), base)
    assert.notEqual(texteSignature(gerant, { ...resto, pin: '9074' }), base)
    assert.equal(texteSignature({ ...gerant }, { ...resto }), base)
  })

  test('un PIN numérique ou texte donne la même signature', () => {
    assert.equal(texteSignature({ ...gerant, pin: 4821 }, resto), texteSignature(gerant, resto))
  })
})

describe('proposer l’activation', () => {
  const ok = { estWeb: true, supporte: true, role: 'gerant', dejaActive: false, refuse: false }

  test('gérant sur le web, appareil compatible : oui', () => {
    assert.equal(peutProposerActivation(ok), true)
  })

  test('application installée, appareil sans Face ID, refus ou déjà actif : non', () => {
    assert.equal(peutProposerActivation({ ...ok, estWeb: false }), false)
    assert.equal(peutProposerActivation({ ...ok, supporte: false }), false)
    assert.equal(peutProposerActivation({ ...ok, refuse: true }), false)
    assert.equal(peutProposerActivation({ ...ok, dejaActive: true }), false)
  })

  test('gérants et administration (manager, directeur, RH) : oui', () => {
    for (const role of ['gerant', 'manager', 'directeur', 'rh']) {
      assert.equal(peutProposerActivation({ ...ok, role }), true, role)
    }
  })

  test('caissiers et vérificateurs : non', () => {
    for (const role of ['caissier', 'verificateur']) {
      assert.equal(peutProposerActivation({ ...ok, role }), false, role)
    }
  })
})

describe('contrôle d’un enrôlement au moment de la connexion', () => {
  const enrolement = { credentialId: 'abc', userId: 'u1', restaurantId: 'r1', signature: 'S' }

  test('tout concorde : connexion autorisée', () => {
    const r = controlerEnrolement(enrolement, { utilisateur: gerant, restaurant: resto, signature: 'S' })
    assert.equal(r.ok, true)
  })

  test('compte désactivé ou absent : refus', () => {
    assert.equal(controlerEnrolement(enrolement, { utilisateur: null, restaurant: resto, signature: 'S' }).ok, false)
    const inactif = controlerEnrolement(enrolement, { utilisateur: { ...gerant, actif: false }, restaurant: resto, signature: 'S' })
    assert.equal(inactif.ok, false)
    assert.match(inactif.message, /code/i)
  })

  test('restaurant introuvable : refus', () => {
    assert.equal(controlerEnrolement(enrolement, { utilisateur: gerant, restaurant: null, signature: 'S' }).ok, false)
  })

  test('code changé depuis l’activation : refus et nouvel enrôlement exigé', () => {
    const r = controlerEnrolement(enrolement, { utilisateur: gerant, restaurant: resto, signature: 'AUTRE' })
    assert.equal(r.ok, false)
    assert.equal(r.oublier, true)
    assert.match(r.message, /code/i)
  })

  test('passé caissier : refus', () => {
    const r = controlerEnrolement(enrolement, { utilisateur: { ...gerant, role: 'caissier' }, restaurant: resto, signature: 'S' })
    assert.equal(r.ok, false)
    assert.equal(r.oublier, true)
  })
})

describe('compte administration (sans restaurant)', () => {
  const manager = { id: 'm1', nom: 'Samer', role: 'manager', actif: true, pin: '7391', restaurant_id: null }
  const enrolement = { credentialId: 'abc', userId: 'm1', restaurantId: null, signature: 'S' }

  test('la signature tient sans restaurant', () => {
    assert.notEqual(texteSignature(manager, null), texteSignature({ ...manager, pin: '7392' }, null))
  })

  test('connexion autorisée sans restaurant', () => {
    const r = controlerEnrolement(enrolement, { utilisateur: manager, restaurant: null, signature: 'S' })
    assert.equal(r.ok, true)
  })

  test('devenu gérant d’un restaurant : refus (il faut un restaurant)', () => {
    const r = controlerEnrolement(enrolement, { utilisateur: { ...manager, role: 'gerant' }, restaurant: null, signature: 'S' })
    assert.equal(r.ok, false)
    assert.equal(r.oublier, true)
  })

  test('un gérant enrôlé passé manager : refus', () => {
    const e = { credentialId: 'abc', userId: 'u1', restaurantId: 'r1', signature: 'S' }
    const r = controlerEnrolement(e, { utilisateur: { ...gerant, role: 'manager' }, restaurant: resto, signature: 'S' })
    assert.equal(r.ok, false)
  })
})

describe('plusieurs comptes sur un même téléphone', () => {
  const eManager = { credentialId: 'A', userId: 'm1', restaurantId: null, signature: 'S1' }
  const eGerant = { credentialId: 'B', userId: 'u1', restaurantId: 'r1', signature: 'S2' }

  test('l’ancien format (un seul compte) devient une liste', () => {
    assert.deepEqual(normaliserEnrolements(eGerant), [eGerant])
    assert.deepEqual(normaliserEnrolements([eManager, eGerant]), [eManager, eGerant])
    assert.deepEqual(normaliserEnrolements(null), [])
    assert.deepEqual(normaliserEnrolements([{ userId: 'x' }, 'n’importe quoi']), [])
  })

  test('activer un 2e compte n’efface pas le 1er', () => {
    assert.deepEqual(ajouterEnrolement([eManager], eGerant), [eManager, eGerant])
  })

  test('réactiver le même compte au même endroit remplace l’ancien', () => {
    const neuf = { ...eGerant, credentialId: 'C', signature: 'S3' }
    assert.deepEqual(ajouterEnrolement([eManager, eGerant], neuf), [eManager, neuf])
  })

  test('retirer un compte garde les autres', () => {
    assert.deepEqual(retirerEnrolement([eManager, eGerant], 'A'), [eGerant])
  })
})

describe('base64url', () => {
  test('aller-retour sans perte', () => {
    const octets = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
    const texte = versBase64Url(octets)
    assert.doesNotMatch(texte, /[+/=]/)
    assert.deepEqual([...depuisBase64Url(texte)], [...octets])
  })
})
