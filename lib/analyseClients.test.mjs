// Tests de lib/analyseClients.js — groupes de clients de l'onglet Analyse.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cleNumero, groupesClients, ilYa, joursEntre, part, profilsClients } from './analyseClients.js'

describe('cleNumero : un client = un numéro', () => {
  test('espaces, +225, 00225 et +225 répété donnent la même clé', () => {
    for (const n of ['0707070707', '07 07 07 07 07', '+225 07 07 07 07 07', '002250707070707', '+225+2250707070707']) {
      assert.equal(cleNumero(n), '0707070707', n)
    }
  })
  test('un numéro étranger garde son indicatif', () => {
    assert.equal(cleNumero('+33 6 03 30 95 40'), '33603309540')
  })
  test('un 225 qui fait partie d’un numéro à 10 chiffres n’est pas retiré', () => {
    assert.equal(cleNumero('2250123456'), '2250123456')
  })
  test('moins de 8 chiffres : ignoré', () => {
    assert.equal(cleNumero('0789'), null)
    assert.equal(cleNumero(''), null)
    assert.equal(cleNumero(null), null)
  })
})

describe('profilsClients', () => {
  const p = profilsClients([
    { contact_client: '0707070707', partenaire: 'Yango', date: '2026-08-01', restaurant_id: 'A' },
    { contact_client: '+225 07 07 07 07 07', partenaire: 'GLOVO', date: '2026-09-10', restaurant_id: 'B' },
    { contact_client: '07 07 07 07 07', partenaire: 'YANGO', date: '2026-07-15', restaurant_id: 'A' },
    { contact_client: '0505050505', partenaire: null, date: '2026-09-01', restaurant_id: 'A' },
    { contact_client: '12', partenaire: 'YANGO', date: '2026-09-01', restaurant_id: 'A' },
  ])
  const c = p.find(x => x.id === '0707070707')

  test('les écritures du même numéro sont regroupées, les incomplets ignorés', () => {
    assert.equal(p.length, 2)
    assert.equal(c.fois, 3)
  })
  test('première et dernière commande, détails de la plus récente', () => {
    assert.deepEqual([c.premiere, c.derniere, c.numero, c.partenaire, c.restaurant_id], ['2026-07-15', '2026-09-10', '+225 07 07 07 07 07', 'Glovo', 'B'])
  })
  test('tous les canaux utilisés', () => {
    assert.deepEqual(c.canaux.sort(), ['glovo', 'yango'])
  })
})

describe('groupesClients', () => {
  const aujourdhui = '2026-10-05'
  const cmd = (num, ...dates) => dates.map(date => ({ contact_client: num, partenaire: 'YANGO', date, restaurant_id: 'A' }))
  const profils = profilsClients([
    ...cmd('0101010101', '2026-09-05'), //                        une fois, perdu, nouveau
    ...cmd('0202020202', '2026-07-01', '2026-08-01', '2026-09-03'), // fidèle perdu
    ...cmd('0303030303', '2026-09-20', '2026-10-04'), //          revenu récemment
    ...cmd('0404040404', '2026-06-01', '2026-09-14'), //          perdu à 21 jours pile
    ...cmd('0505050505', '2026-08-15'), //                        hors période
  ])
  const g = groupesClients(profils, { debut: '2026-09-01', fin: '2026-09-30', aujourdhui })
  const ids = l => l.map(p => p.id)

  test('seuls les clients ayant commandé pendant la période comptent', () => {
    assert.equal(g.total, 4)
  })
  test('perdus : 21 jours ou plus sans commande, meilleurs clients d’abord', () => {
    assert.deepEqual(ids(g.perdus), ['0202020202', '0404040404', '0101010101'])
    assert.equal(g.perdus[1].depuis, 21)
  })
  test('une seule commande dans tout l’historique', () => {
    assert.deepEqual(ids(g.uneFois), ['0101010101'])
  })
  test('fidèles : 3 commandes ou plus, l’historique d’avant la période compte', () => {
    assert.deepEqual(ids(g.fideles), ['0202020202'])
  })
  test('nouveaux : première commande dans la période', () => {
    assert.deepEqual(ids(g.nouveaux).sort(), ['0101010101', '0303030303'])
  })
  test('période trop récente : aucun perdu possible', () => {
    assert.equal(g.perdusPossibles, true)
    const r = groupesClients(profils, { debut: '2026-10-01', fin: '2026-10-05', aujourdhui })
    assert.equal(r.perdusPossibles, false)
    assert.equal(r.perdus.length, 0)
  })
  test('délai et seuil réglables', () => {
    const r = groupesClients(profils, { debut: '2026-09-01', fin: '2026-09-30', aujourdhui, delaiPerdu: 30, seuilFidele: 2 })
    assert.deepEqual(ids(r.perdus), ['0202020202', '0101010101'])
    assert.deepEqual(ids(r.fideles).sort(), ['0202020202', '0303030303', '0404040404'])
  })
})

describe('petits utilitaires', () => {
  test('joursEntre', () => {
    assert.equal(joursEntre('2026-09-30', '2026-10-05'), 5)
  })
  test('part', () => {
    assert.equal(part(1, 3), 33)
    assert.equal(part(0, 0), null)
  })
  test('ilYa', () => {
    assert.deepEqual([ilYa(0), ilYa(1), ilYa(12)], ["aujourd'hui", 'hier', 'il y a 12 jours'])
  })
})
