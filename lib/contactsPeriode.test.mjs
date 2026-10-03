// Tests de lib/contactsPeriode.js — contacts clients pris sur une période.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { contactsParPoint, evolution, numerosUniques, parJour, parRestaurant, taux, totaux } from './contactsPeriode.js'

const A = 'resto-a'
const B = 'resto-b'

describe('source choisie jour par jour', () => {
  const points = [
    { id: 'p1', date: '2026-08-20', restaurant_id: A, yango_nb_commandes: 6, glovo_nb_commandes: 4 }, // avant POS
    { id: 'p2', date: '2026-09-20', restaurant_id: A, yango_nb_commandes: 99, glovo_nb_commandes: 99 }, // POS
    { id: 'p3', date: '2026-09-21', restaurant_id: A }, // transition : les deux sources
  ]
  const shifts = [
    { point_id: 'p2', pos_nb_contacts: 7, pos_nb_yango: 5, pos_nb_glovo: 5 },
    { point_id: 'p2', pos_nb_contacts: 3, pos_nb_yango: 2, pos_nb_glovo: 0 },
    { point_id: 'p3', pos_nb_contacts: 4, pos_nb_yango: 4, pos_nb_glovo: 1 },
  ]
  const commandes = [
    { point_id: 'p1', contact_client: '0707070707' },
    { point_id: 'p1', contact_client: ' ' },
    { point_id: 'p1', contact_client: '0505050505' },
    { point_id: 'p3', contact_client: '0101010101' },
  ]
  const l = contactsParPoint({ points, shifts, commandes })

  test('avant le POS : les numéros saisis, et les commandes du gérant', () => {
    assert.deepEqual([l[0].source, l[0].contacts, l[0].commandes], ['samtrackly', 2, 10])
  })
  test('au POS : ses compteurs, et ses commandes plutôt que celles du gérant', () => {
    assert.deepEqual([l[1].source, l[1].contacts, l[1].commandes], ['pos', 10, 12])
  })
  test('jour de transition : le POS seul, jamais la somme', () => {
    assert.deepEqual([l[2].source, l[2].contacts], ['pos', 4])
  })
})

describe('totaux, évolution, taux', () => {
  test('taux de prise et évolution', () => {
    const t = totaux([{ date: 'd1', contacts: 30, commandes: 40 }, { date: 'd2', contacts: 15, commandes: 20 }])
    assert.deepEqual(t, { contacts: 45, commandes: 60, taux: 75, jours: 2 })
    assert.equal(evolution(120, 100), 20)
    assert.equal(evolution(80, 100), -20)
    assert.equal(evolution(5, 0), null)
    assert.equal(taux(3, 0), null)
  })
})

describe('par restaurant et par jour', () => {
  const restos = [{ id: A, nom: 'Alpha' }, { id: B, nom: 'Bravo' }, { id: 'c', nom: 'Charlie' }]
  test('classement, évolution, restaurants sans activité exclus', () => {
    const lignesA = [{ restaurant_id: A, date: 'x', contacts: 10, commandes: 20 }, { restaurant_id: B, date: 'x', contacts: 30, commandes: 30 }]
    const lignesB = [{ restaurant_id: A, date: 'y', contacts: 20, commandes: 20 }]
    const r = parRestaurant(lignesA, lignesB, restos)
    assert.deepEqual(r.map(x => [x.nom, x.contacts, x.evolution, x.taux]), [['Bravo', 30, null, 100], ['Alpha', 10, -50, 50]])
  })
  test('une valeur par jour, 0 les jours vides', () => {
    const j = parJour([{ date: '2026-09-29', contacts: 4 }, { date: '2026-09-29', contacts: 1 }, { date: '2026-10-01', contacts: 2 }], '2026-09-29', '2026-10-01')
    assert.deepEqual(j, [{ date: '2026-09-29', contacts: 5 }, { date: '2026-09-30', contacts: 0 }, { date: '2026-10-01', contacts: 2 }])
  })
})

describe('numéros uniques', () => {
  test('dédoublonnés, plus récent d\'abord, numéros incomplets ignorés', () => {
    const n = numerosUniques([
      { contact_client: '0707070707', partenaire: 'Yango', date: '2026-08-01' },
      { contact_client: '0707070707', partenaire: 'Glovo', date: '2026-08-15' },
      { contact_client: '0505050505', partenaire: 'Yango', date: '2026-08-10' },
      { contact_client: '0712', date: '2026-08-20' },
    ])
    assert.deepEqual(n.map(x => [x.numero, x.fois, x.partenaire]), [['0707070707', 2, 'Glovo'], ['0505050505', 1, 'Yango']])
  })
})
