// Tests de lib/calendrierPeriode.js — choix d'une période au calendrier.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { dernierJourMois, joursEntre, moisDeLaPeriode, moisHorsBornes, periodeMois, toucherJour } from './calendrierPeriode.js'

describe('periodeMois', () => {
  test('mois entier', () => assert.deepEqual(periodeMois('2026-09'), { debut: '2026-09-01', fin: '2026-09-30' }))
  test('février bissextile', () => assert.equal(dernierJourMois('2028-02'), '2028-02-29'))
  test('mois en cours : s\'arrête à aujourd\'hui', () =>
    assert.deepEqual(periodeMois('2026-10', { maxDate: '2026-10-18' }), { debut: '2026-10-01', fin: '2026-10-18' }))
  test('mois futur : hors bornes', () => {
    assert.equal(periodeMois('2026-11', { maxDate: '2026-10-18' }), null)
    assert.equal(moisHorsBornes('2026-11', { maxDate: '2026-10-18' }), true)
  })
  test('minDate rogne le début', () =>
    assert.deepEqual(periodeMois('2026-10', { minDate: '2026-10-05' }), { debut: '2026-10-05', fin: '2026-10-31' }))
})

describe('toucherJour', () => {
  test('début puis fin', () => {
    const a = toucherJour({}, '2026-09-10')
    assert.deepEqual(a, { debut: '2026-09-10', fin: '' })
    assert.deepEqual(toucherJour(a, '2026-09-20'), { debut: '2026-09-10', fin: '2026-09-20' })
  })
  test('un jour avant le début devient le début', () =>
    assert.deepEqual(toucherJour({ debut: '2026-09-10', fin: '' }, '2026-09-02'), { debut: '2026-09-02', fin: '' }))
  test('même jour : période d\'un jour', () =>
    assert.deepEqual(toucherJour({ debut: '2026-09-10', fin: '' }, '2026-09-10'), { debut: '2026-09-10', fin: '2026-09-10' }))
  test('période complète : on repart de zéro', () =>
    assert.deepEqual(toucherJour({ debut: '2026-09-01', fin: '2026-09-30' }, '2026-08-15'), { debut: '2026-08-15', fin: '' }))
})

describe('moisDeLaPeriode', () => {
  test('mois entier reconnu', () => assert.equal(moisDeLaPeriode('2026-09-01', '2026-09-30'), '2026-09'))
  test('mois en cours borné reconnu', () =>
    assert.equal(moisDeLaPeriode('2026-10-01', '2026-10-18', { maxDate: '2026-10-18' }), '2026-10'))
  test('période libre : null', () => assert.equal(moisDeLaPeriode('2026-09-02', '2026-09-30'), null))
})

describe('joursEntre', () => {
  test('bornes comprises', () => assert.deepEqual(joursEntre('2026-09-29', '2026-10-01'), ['2026-09-29', '2026-09-30', '2026-10-01']))
  test('sans fin : le début seul', () => assert.deepEqual(joursEntre('2026-09-29', ''), ['2026-09-29']))
})
