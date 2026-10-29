// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/carteTravailleur.js — Carte PDF de la fiche travailleur.
//
// Les pièges : le salaire ne doit plus jamais apparaître (la carte se montre) ;
// chaque restaurant prend le logo et la couleur de SA marque ; un champ vide
// ne doit pas laisser une ligne « undefined ».
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { age, htmlCarteTravailleur } from './carteTravailleur.js'
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
    for (const v of ['CI001234567', '12345678901', 'Bouaké', 'Ivoirienne', 'Marié', 'Yopougon', '12 mars 1995 (31 ans)']) {
      assert.ok(h.includes(v), v)
    }
  })

  test('logo et couleur de la marque du restaurant', () => {
    const samer = htmlCarteTravailleur(trav, { nom: 'Samer Angré 7E', couleur: 'orange' }, '2026-10-29')
    assert.ok(samer.includes(LOGO_SAMER) && !samer.includes(LOGO_KAYAN))
    assert.ok(samer.includes('#EF9F27'))

    const kayan = htmlCarteTravailleur(trav, { nom: 'Al Kayan Yop', couleur: 'vert' }, '2026-10-29')
    assert.ok(kayan.includes(LOGO_KAYAN) && !kayan.includes(LOGO_SAMER))
    assert.ok(kayan.includes('#2D7D46'))

    // À la Braise : pas de logo image, son nom à la place, sa teinte propre.
    const braise = htmlCarteTravailleur(trav, { nom: 'À la Braise', couleur: '#D99A2B' }, '2026-10-29')
    assert.ok(!braise.includes(LOGO_SAMER) && braise.includes('À LA BRAISE'))
    assert.ok(braise.includes('#D99A2B'))
  })

  test('fiche vide : « Non renseigné », jamais « undefined »', () => {
    const h = htmlCarteTravailleur({ nom: 'Awa', actif: true }, null, '2026-10-29')
    assert.ok(h.includes('Non renseigné'))
    assert.ok(!h.includes('undefined') && !h.includes('null'))
  })

  test('nom échappé', () => {
    const h = htmlCarteTravailleur({ nom: '<b>X</b>', actif: true }, null, '2026-10-29')
    assert.ok(h.includes('&lt;b&gt;X&lt;/b&gt;') && !h.includes('<b>X</b>'))
  })
})

describe('age', () => {
  test('anniversaire pas encore passé', () => assert.equal(age('1995-12-01', '2026-10-29'), 30))
  test('anniversaire le jour même', () => assert.equal(age('1995-10-29', '2026-10-29'), 31))
  test('date absente', () => assert.equal(age(null, '2026-10-29'), null))
})
