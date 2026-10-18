// Tests de lib/tauxSalarial.js — le taux salarial des tableaux de bord.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { fusionnerCharges } from './chargesMois.js'
import {
  estLigneSalaires, moisComplets, noteTauxSalarial, tauxSalarial, tauxSalarialTotal,
} from './tauxSalarial.js'

const R = 'yop'
// État de septembre saisi au RH (1 700 000) + loyer, et un autre restaurant.
const charges = fusionnerCharges([], [
  { categorie: 'salaire', restaurant_id: R, mois: '2026-09-01', montant_du: 1700000 },
  { categorie: 'loyer', restaurant_id: R, mois: '2026-09-01', montant_du: 1100000 },
  { categorie: 'cnps', restaurant_id: R, mois: '2026-09-01', montant_du: 300000 },
  { categorie: 'salaire', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 900000 },
])

describe('moisComplets', () => {
  test('un mois entier', () => assert.deepEqual(moisComplets('2026-09-01', '2026-09-30'), ['2026-09']))
  test('le mois en cours, pas fini', () => assert.deepEqual(moisComplets('2026-10-01', '2026-10-18'), []))
  test('7 jours', () => assert.deepEqual(moisComplets('2026-09-10', '2026-09-16'), []))
  test('à cheval : seul le mois entier compte', () =>
    assert.deepEqual(moisComplets('2026-08-15', '2026-10-05'), ['2026-09']))
  test('février bissextile', () => assert.deepEqual(moisComplets('2028-02-01', '2028-02-29'), ['2028-02']))
})

describe('tauxSalarial', () => {
  const presences = [{ paye: 5000 }, { paye: '3000' }, { paye: null }]

  test('mois entier : caissiers + gérant + état du RH, en entier', () => {
    const t = tauxSalarial({ presences, paiesGerant: 12000, charges, restaurantId: R, debut: '2026-09-01', fin: '2026-09-30', ventes: 10000000 })
    assert.equal(t.caissiers, 8000)
    assert.equal(t.gerant, 12000)
    assert.equal(t.etat, 1700000) // ni loyer, ni CNPS, ni l'autre restaurant
    assert.equal(t.total, 1720000)
    assert.equal(t.pct, 17.2)
    assert.deepEqual(t.moisSansEtat, [])
    assert.equal(t.etatHorsPeriode, false)
    assert.equal(noteTauxSalarial(t), null)
  })

  test('période partielle : l\'état est écarté, et on le dit', () => {
    const t = tauxSalarial({ presences, paiesGerant: 0, charges, restaurantId: R, debut: '2026-09-10', fin: '2026-09-16', ventes: 100000 })
    assert.equal(t.etat, 0)
    assert.equal(t.total, 8000)
    assert.equal(t.etatHorsPeriode, true)
    assert.match(noteTauxSalarial(t), /mois entier/)
  })

  test('mois entier sans état saisi : signalé', () => {
    const t = tauxSalarial({ charges, restaurantId: R, debut: '2026-08-01', fin: '2026-08-31', ventes: 100 })
    assert.deepEqual(t.moisSansEtat, ['2026-08'])
    assert.match(noteTauxSalarial(t), /août 2026/)
  })

  test('ventes nulles → 0, jamais NaN', () => {
    const t = tauxSalarial({ presences, charges, restaurantId: R, debut: '2026-09-01', fin: '2026-09-30', ventes: 0 })
    assert.equal(t.pct, 0)
  })

  test('ancien écran Charges : la ligne « Salaires » compte aussi', () => {
    const anciennes = fusionnerCharges([{ restaurant_id: R, mois: '2026-07', libelle: 'Salaires juillet', montant: 1500000 }], [])
    const t = tauxSalarial({ charges: anciennes, restaurantId: R, debut: '2026-07-01', fin: '2026-07-31', ventes: 10000000 })
    assert.equal(t.etat, 1500000)
  })
})

describe('estLigneSalaires', () => {
  test('une charge admin nommée « salaire » n\'est pas l\'état', () =>
    assert.equal(estLigneSalaires({ source: 'tresorerie', categorie: 'admin', libelle: 'Avance salaire' }), false))
})

describe('tauxSalarialTotal', () => {
  test('additionne les restaurants', () => {
    const a = tauxSalarial({ presences: [{ paye: 1000 }], charges, restaurantId: R, debut: '2026-09-01', fin: '2026-09-30', ventes: 1 })
    const b = tauxSalarial({ charges, restaurantId: 'kms', debut: '2026-09-01', fin: '2026-09-30', ventes: 1 })
    const t = tauxSalarialTotal([a, b], 26010000)
    assert.equal(t.total, 2601000)
    assert.equal(t.pct, 10)
    assert.equal(t.etatHorsPeriode, false)
  })
})
