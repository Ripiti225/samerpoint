// Tests de lib/clotureMois.js — état d'un mois avant sa clôture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etatMois, joursDuMois, libelleMois, listeMois, moisTermine } from './clotureMois.js'

const restaurants = [{ id: 'y', nom: 'Samer Yop' }, { id: 'k', nom: 'Al Kayan KMS' }]
const tousLesJours = (rid, mois, sauf = []) => joursDuMois(mois)
  .filter(d => !sauf.includes(d))
  .map(date => ({ id: `${rid}${date}`, restaurant_id: rid, date, valide: true, verifie: true }))

test('mois terminé : seulement avant le mois en cours', () => {
  assert.equal(moisTermine('2026-10', '2026-11-19'), true)
  assert.equal(moisTermine('2026-11', '2026-11-19'), false)
  assert.equal(moisTermine('2026-12-01', '2026-11-19'), false)
})

test('liste des 3 derniers mois terminés, du plus récent au plus ancien, à cheval sur l’année', () => {
  assert.deepEqual(listeMois('2026-02-10', 3), ['2026-01', '2025-12', '2025-11'])
})

test('jours du mois, février bissextile compris', () => {
  assert.equal(joursDuMois('2026-10').length, 31)
  assert.equal(joursDuMois('2028-02').length, 29)
  assert.equal(joursDuMois('2026-10')[0], '2026-10-01')
})

test('tout validé et vérifié : clôture possible', () => {
  const points = [...tousLesJours('y', '2026-10'), ...tousLesJours('k', '2026-10')]
  const e = etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' })
  assert.deepEqual(e.bloquants, [])
  assert.deepEqual(e.joursVides, [])
  assert.equal(e.peutCloturer, true)
})

test('journée non validée ou non vérifiée : bloquante, triée par date', () => {
  const points = [...tousLesJours('y', '2026-10'), ...tousLesJours('k', '2026-10')].map(p => {
    if (p.restaurant_id === 'k' && p.date === '2026-10-20') return { ...p, valide: false, verifie: false }
    if (p.restaurant_id === 'y' && p.date === '2026-10-05') return { ...p, verifie: null }
    return p
  })
  const e = etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' })
  assert.deepEqual(e.bloquants.map(b => [b.nom, b.date, b.raison]), [
    ['Samer Yop', '2026-10-05', 'non_verifie'],
    ['Al Kayan KMS', '2026-10-20', 'non_valide'],
  ])
  assert.equal(e.bloquants[1].pointId, 'k2026-10-20')
  assert.equal(e.peutCloturer, false)
})

test('jours sans point : listés par restaurant, jamais bloquants', () => {
  const points = [...tousLesJours('y', '2026-10', ['2026-10-12', '2026-10-25']), ...tousLesJours('k', '2026-10')]
  const e = etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' })
  assert.deepEqual(e.joursVides, [{ restaurantId: 'y', nom: 'Samer Yop', dates: ['2026-10-12', '2026-10-25'] }])
  assert.equal(e.peutCloturer, true)
})

test('mois en cours : jamais clôturable', () => {
  const e = etatMois({ mois: '2026-11', points: [], restaurants: [], aujourdhui: '2026-11-19' })
  assert.equal(e.peutCloturer, false)
})

test('points d’un autre mois ignorés', () => {
  const points = [...tousLesJours('y', '2026-10'), ...tousLesJours('k', '2026-10'),
    { id: 'x', restaurant_id: 'y', date: '2026-11-01', valide: false, verifie: false }]
  assert.equal(etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' }).peutCloturer, true)
})

test('libellé du mois', () => {
  assert.equal(libelleMois('2026-10'), 'Octobre 2026')
})
