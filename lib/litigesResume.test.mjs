// Tests de lib/litigesResume.js — résumé des litiges pour le Dashboard global.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resumeLitiges, restoSansLitige } from './litigesResume.js'

const vide = nom => ({
  restaurant: { id: nom, nom }, ecartTotal: 0, invTotal: 0, invEnriched: [], responsables: [],
  avis: [], avisTotal: 0, yango: [], yangoTotal: 0, glovo: [], glovoTotal: 0,
  contacts: [], contactTotal: 0, contactsEnAttente: 0, pasFait: [], pasFaitTotal: 0,
  verifLignes: [], verifRetenu: 0, total: 0,
})

test('restoSansLitige', () => {
  assert.equal(restoSansLitige(vide('A')), true)
  assert.equal(restoSansLitige({ ...vide('A'), ecartTotal: 500 }), false)
  // Un bon avis (montant négatif) reste un litige à montrer.
  assert.equal(restoSansLitige({ ...vide('A'), avis: [{ montant: -500 }] }), false)
})

test('resumeLitiges : totaux, catégories, restaurants et personnes', () => {
  const a = {
    ...vide('Maroc'), ecartTotal: 10000, responsables: [{ responsable_nom: 'Awa', montant: 10000 }],
    avis: [{ responsable_nom: 'Awa', montant: 1000 }, { responsable_nom: 'Koffi', montant: -500 }], avisTotal: 500,
    total: 10500, contactsEnAttente: 2,
  }
  const b = { ...vide('Lavage'), pasFait: [{ responsable_nom: 'Koffi', montant: 5000 }], pasFaitTotal: 5000, total: 5000 }
  const r = resumeLitiges([a, b, vide('Oasis')])
  assert.equal(r.total, 15500)
  assert.deepEqual(r.categories.map(c => c.cle), ['ecart', 'pasFait', 'avis'])
  assert.equal(r.nbConcernes, 2)
  assert.equal(r.parResto[0].nom, 'Maroc')
  assert.equal(r.parResto[0].principale.cle, 'ecart')
  assert.equal(r.personnes[0].nom, 'Awa')
  assert.equal(r.personnes[0].montant, 11000)
  assert.equal(r.personnes[1].montant, 4500) // 5000 − 500 du bon avis
  assert.equal(r.contactsEnAttente, 2)
})

test('resumeLitiges : rien à résumer', () => {
  const r = resumeLitiges([])
  assert.equal(r.total, 0)
  assert.deepEqual(r.categories, [])
  assert.deepEqual(r.personnes, [])
})

test('totauxParCaissier : un restaurant, tous les noms, contacts et non attribué', async () => {
  const { totauxParCaissier } = await import('./litigesResume.js')
  const d = {
    ...vide('Maroc'),
    ecartTotal: 12000,
    responsables: [{ responsable_nom: 'Awa', montant: 10000 }],          // 2 000 d'écart sans nom
    avis: [{ responsable_nom: 'Awa', montant: 1000 }, { responsable_nom: ' Koffi ', montant: -500 }], avisTotal: 500,
    contacts: [{ litige: 300 }], contactTotal: 300,
    contactsTotaux: { parCaissier: [{ nom: 'Koffi', montant: 300 }], nonAttribue: 0 },
    total: 12800,
  }
  const r = totauxParCaissier(d)
  assert.deepEqual(r.personnes.map(p => [p.nom, p.montant, p.nb]), [['Awa', 11000, 2], ['Koffi', -200, 2]])
  assert.deepEqual(r.personnes[0].categories.map(c => [c.cle, c.montant]), [['ecart', 10000], ['avis', 1000]])
  assert.deepEqual(r.personnes[1].categories.map(c => [c.cle, c.montant]), [['avis', -500], ['contacts', 300]])
  assert.equal(r.attribue, 10800)
  assert.equal(r.nonAttribue, 2000)
  assert.equal(r.total, 12800)
})

test('totauxParCaissier : restaurant sans litige', async () => {
  const { totauxParCaissier } = await import('./litigesResume.js')
  const r = totauxParCaissier(vide('Oasis'))
  assert.deepEqual(r.personnes, [])
  assert.equal(r.nonAttribue, 0)
})
