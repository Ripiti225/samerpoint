// Tests de lib/fournisseursAdmin.js — fournisseurs administratifs (impôts, CNPS, bail…).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  TYPE_ADMIN, champsEcheance, choixMoisDepart, estAdministratif, libelleEcheance,
  prochaineEcheance, separerFournisseurs, totalDu,
} from './fournisseursAdmin.js'

describe('découpage', () => {
  test('administratif reconnu par le type seulement, pas par le nom', () => {
    assert.equal(estAdministratif({ type: TYPE_ADMIN, nom: 'Albert' }), true)
    assert.equal(estAdministratif({ type: 'cotisation', nom: 'CNPS' }), false)
    assert.equal(estAdministratif({ nom: 'TEE' }), false)
    assert.equal(estAdministratif(null), false)
  })
  test('separerFournisseurs garde l’ordre', () => {
    const l = [{ id: 'a', type: 'fournisseur' }, { id: 'b', type: TYPE_ADMIN }, { id: 'c' }, { id: 'd', type: TYPE_ADMIN }]
    const r = separerFournisseurs(l)
    assert.deepEqual(r.marchandise.map(f => f.id), ['a', 'c'])
    assert.deepEqual(r.administratifs.map(f => f.id), ['b', 'd'])
  })
  test('totalDu : dettes seulement, fiches actives seulement', () => {
    assert.equal(totalDu([
      { credit_actuel: 1000 }, { credit_actuel: -500 }, { credit_actuel: 300, actif: false }, { credit_actuel: '200' },
    ]), 1200)
    assert.equal(totalDu(), 0)
  })
})

describe('échéances', () => {
  const tee = { facture_mensuelle: 25000, facture_periodicite: 'mensuel', facture_mensuelle_depuis: '2026-11-01' }
  test('mensuel pas encore commencé : prochaine = mois de départ', () => {
    assert.equal(prochaineEcheance(tee, '2026-10-12'), '2026-11-01')
  })
  test('mensuel commencé : prochaine = mois suivant', () => {
    assert.equal(prochaineEcheance({ ...tee, facture_mensuelle_depuis: '2026-09-01' }, '2026-10-12'), '2026-11-01')
    assert.equal(prochaineEcheance({ ...tee, facture_mensuelle_depuis: '2026-09-01' }, '2026-12-31'), '2027-01-01')
  })
  test('annuel : même mois chaque année', () => {
    const bail = { facture_mensuelle: 1200000, facture_periodicite: 'annuel', facture_mensuelle_depuis: '2026-03-01' }
    assert.equal(prochaineEcheance(bail, '2026-10-12'), '2027-03-01')
    assert.equal(prochaineEcheance(bail, '2027-02-28'), '2027-03-01')
    assert.equal(prochaineEcheance({ ...bail, facture_mensuelle_depuis: '2027-01-01' }, '2026-10-12'), '2027-01-01')
  })
  test('sans périodicité = mensuel ; sans montant = aucune échéance', () => {
    assert.equal(prochaineEcheance({ facture_mensuelle: 10, facture_mensuelle_depuis: '2026-10-01' }, '2026-10-12'), '2026-11-01')
    assert.equal(prochaineEcheance({ facture_mensuelle: 0, facture_mensuelle_depuis: '2026-10-01' }, '2026-10-12'), null)
  })
  test('libellés', () => {
    assert.equal(libelleEcheance(tee, '2026-10-12'), '25 000 F / mois · prochaine : novembre 2026')
    assert.equal(libelleEcheance({ facture_mensuelle: 120000, facture_periodicite: 'annuel', facture_mensuelle_depuis: '2027-03-01' }, '2026-10-12'),
      '120 000 F / an · prochaine : mars 2027')
    assert.equal(libelleEcheance({ facture_mensuelle: 0 }, '2026-10-12'), 'Aucune échéance automatique')
  })
})

describe('formulaire', () => {
  test('choix du mois de départ', () => {
    assert.deepEqual(choixMoisDepart('mensuel', '2026-10-12'), ['2026-10-01', '2026-11-01'])
    assert.deepEqual(choixMoisDepart('mensuel', '2026-10-12', '2026-08-01'), ['2026-08-01', '2026-10-01', '2026-11-01'])
    const an = choixMoisDepart('annuel', '2026-10-12')
    assert.equal(an.length, 12)
    assert.equal(an[0], '2026-10-01')
    assert.equal(an[11], '2027-09-01')
  })
  test('champsEcheance', () => {
    assert.deepEqual(champsEcheance({ montant: '25 000', periodicite: 'mensuel', depuis: '2026-11-01' }, '2026-10-12'),
      { facture_mensuelle: 25000, facture_periodicite: 'mensuel', facture_mensuelle_depuis: '2026-11-01' })
    assert.deepEqual(champsEcheance({ montant: '', periodicite: 'annuel' }, '2026-10-12'),
      { facture_mensuelle: 0, facture_periodicite: 'annuel', facture_mensuelle_depuis: null })
    assert.deepEqual(champsEcheance({ montant: '5000' }, '2026-10-12'),
      { facture_mensuelle: 5000, facture_periodicite: 'mensuel', facture_mensuelle_depuis: '2026-10-01' })
  })
})
