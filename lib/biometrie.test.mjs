import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const {
  texteSignature, peutProposerActivation, controlerEnrolement,
  versBase64Url, depuisBase64Url,
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

  test('seuls les gérants se voient proposer l’empreinte', () => {
    for (const role of ['caissier', 'manager', 'directeur', 'rh', 'verificateur']) {
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

  test('n’est plus gérant : refus', () => {
    const r = controlerEnrolement(enrolement, { utilisateur: { ...gerant, role: 'caissier' }, restaurant: resto, signature: 'S' })
    assert.equal(r.ok, false)
    assert.equal(r.oublier, true)
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
