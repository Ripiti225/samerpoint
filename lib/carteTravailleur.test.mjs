// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/carteTravailleur.js — Carte PDF de la fiche travailleur.
//
// Les pièges : le salaire ne doit plus jamais apparaître (la carte se montre) ;
// chaque restaurant prend le logo et la couleur de SA marque ; un champ vide
// ne doit pas laisser une ligne « undefined ».
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { age, htmlCarteTravailleur, telEspace } from './carteTravailleur.js'
import { LOGO_KAYAN, LOGO_SAMER } from './logos.js'

const trav = {
  nom: 'Kouassi Jean', poste: 'Cuisinier', type_contrat: 'CDI', actif: true, statut: 'actif',
  salaire_journalier: 5000, contact: '0707070707', civilite: 'M.',
  nom_famille: 'KOUASSI', prenoms: 'Jean', date_naissance: '1995-03-12', lieu_naissance: 'Bouaké',
  nationalite: 'Ivoirienne', situation_famille: 'Marié', lieu_residence: 'Yopougon',
  cni_numero: 'CI001234567', nni_numero: '12345678901',
}

describe('htmlCarteTravailleur', () => {
  test('aucun salaire sur la carte', () => {
    const h = htmlCarteTravailleur(trav, { nom: 'Samer Angré 7E', couleur: 'orange' }, '2026-10-29')
    assert.ok(!/salaire/i.test(h))
    assert.ok(!h.includes('5 000') && !h.includes('5000'))
  })

  test('état civil et pièce d’identité affichés', () => {
    const h = htmlCarteTravailleur(trav, { nom: 'Samer Angré 7E', couleur: 'orange' }, '2026-10-29')
    for (const v of ['CI001234567', '12345678901', 'Bouaké', 'Ivoirienne', 'Marié', 'Yopougon', '12 mars 1995 · 31 ans']) {
      assert.ok(h.includes(v), v)
    }
  })

  test('logo et couleur de la marque du restaurant', () => {
    const samer = htmlCarteTravailleur(trav, { nom: 'Samer Angré 7E', couleur: 'orange' }, '2026-10-29')
    assert.ok(samer.includes(LOGO_SAMER) && !samer.includes(LOGO_KAYAN))
    assert.ok(samer.includes('#EF9F27'))

    // Chez Samer : logo en blanc sur le bandeau, sans plaque.
    assert.ok(samer.includes('class="ct-logo ct-logo-blanc"') && !samer.includes('class="ct-logo-box"'))

    const kayan = htmlCarteTravailleur(trav, { nom: 'Al Kayan Yop', couleur: 'vert' }, '2026-10-29')
    assert.ok(kayan.includes(LOGO_KAYAN) && !kayan.includes(LOGO_SAMER))
    assert.ok(kayan.includes('#2D7D46'))
    // Al Kayan : logo en couleurs sur sa plaque blanche (inchangé).
    assert.ok(kayan.includes('class="ct-logo-box"') && !kayan.includes('class="ct-logo ct-logo-blanc"'))

    // À la Braise : pas de logo image, son nom à la place, sa teinte propre.
    const braise = htmlCarteTravailleur(trav, { nom: 'À la Braise', couleur: '#D99A2B' }, '2026-10-29')
    assert.ok(!braise.includes(LOGO_SAMER) && braise.includes('À LA BRAISE'))
    assert.ok(braise.includes('#D99A2B'))
  })

  test('nom et prénoms pas répétés dans les infos (format carte)', () => {
    const h = htmlCarteTravailleur(trav, { nom: 'Samer Angré 7E', couleur: 'orange' }, '2026-10-29')
    assert.ok(!h.includes('Nom de famille') && !h.includes('Prénoms'))
    assert.ok(h.includes('size: 54mm 85.6mm'))
  })

  test('fiche vide : groupes omis, jamais « undefined »', () => {
    const h = htmlCarteTravailleur({ nom: 'Awa', actif: true }, null, '2026-10-29')
    assert.ok(!h.includes('class="ct-bloc"'))
    assert.ok(!h.includes('Non renseigné'))
    assert.ok(!h.includes('undefined') && !h.includes('null'))
  })

  test('une ligne vide est omise, pas affichée sans valeur', () => {
    const h = htmlCarteTravailleur({ nom: 'Awa', actif: true, cni_numero: 'CI9', nni_numero: '' }, null, '2026-10-29')
    assert.ok(h.includes('N° CNI') && h.includes('CI9'))
    assert.ok(!h.includes('N° NNI'))
  })

  test('numéros à joindre en pied de carte', () => {
    const h = htmlCarteTravailleur(trav, { nom: 'Al Kayan Yop', couleur: 'vert' }, '2026-10-29')
    assert.ok(h.includes('01 43 11 11 18') && h.includes('07 79 69 63 70'))
    assert.ok(h.includes('tel:0143111118') && h.includes('tel:0779696370'))
  })

  test('nom échappé', () => {
    const h = htmlCarteTravailleur({ nom: '<b>X</b>', actif: true }, null, '2026-10-29')
    assert.ok(h.includes('&lt;b&gt;X&lt;/b&gt;') && !h.includes('<b>X</b>'))
  })
})

describe('telEspace', () => {
  test('10 chiffres groupés par deux', () => assert.equal(telEspace('0779696370'), '07 79 69 63 70'))
  test('autre format laissé tel quel', () => assert.equal(telEspace('+225 07'), '+225 07'))
})

describe('age', () => {
  test('anniversaire pas encore passé', () => assert.equal(age('1995-12-01', '2026-10-29'), 30))
  test('anniversaire le jour même', () => assert.equal(age('1995-10-29', '2026-10-29'), 31))
  test('date absente', () => assert.equal(age(null, '2026-10-29'), null))
})
