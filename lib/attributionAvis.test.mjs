// Tests de lib/attributionAvis.js — l'avis va au caissier présent à l'heure de la commande.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { caissierAuMoment, normaliserHeure, phraseAttribution } from './attributionAvis.js'

const s = (caissier_id, caissier_nom, date, heure_debut, heure_fin, restaurant_id = 'palm') =>
  ({ caissier_id, caissier_nom, date, heure_debut, heure_fin, restaurant_id })

const shifts = [
  s('b', 'Bazie', '2026-09-04', '06:00:00', '15:00:00'),
  s('m', 'Moise', '2026-09-04', '15:00:00', '02:30:00'),   // service de soirée qui finit après minuit
  s('x', 'Autre resto', '2026-09-04', '06:00:00', '23:00:00', 'yop'),
]

test('normaliserHeure', () => {
  assert.equal(normaliserHeure('9h'), '09:00')
  assert.equal(normaliserHeure('21h30'), '21:30')
  assert.equal(normaliserHeure('09:05'), '09:05')
  assert.equal(normaliserHeure('25h'), null)
  assert.equal(normaliserHeure(''), null)
})

test('commande de 9 h à la Palmeraie : le caissier du matin', () => {
  const r = caissierAuMoment(shifts, { restaurantId: 'palm', date: '2026-09-04', heure: '9h' })
  assert.equal(r.caissier_id, 'b')
  assert.equal(r.raison, 'heure')
  assert.ok(phraseAttribution(r, '9h').includes('Bazie'))
})

test('commande de 1 h du matin : le service de la veille au soir', () => {
  const r = caissierAuMoment(shifts, { restaurantId: 'palm', date: '2026-09-05', heure: '01:00' })
  assert.equal(r.caissier_id, 'm')
})

test('à l’heure de la relève, le nouveau caissier', () => {
  assert.equal(caissierAuMoment(shifts, { restaurantId: 'palm', date: '2026-09-04', heure: '15:00' }).caissier_id, 'm')
})

test('deux caissiers en même temps : personne', () => {
  const r = caissierAuMoment([...shifts, s('c', 'Ange', '2026-09-04', '08:00', '12:00')], { restaurantId: 'palm', date: '2026-09-04', heure: '10:00' })
  assert.equal(r.caissier_id, null)
  assert.equal(r.raison, 'plusieurs')
})

test('sans heure : seulement s’il n’y avait qu’un caissier ce jour-là', () => {
  assert.equal(caissierAuMoment(shifts, { restaurantId: 'yop', date: '2026-09-04' }).caissier_id, 'x')
  const r = caissierAuMoment(shifts, { restaurantId: 'palm', date: '2026-09-04' })
  assert.equal(r.caissier_id, null)
  assert.equal(r.raison, 'sans_heure_plusieurs')
})

test('shift POS sans compte relié : attribué au nom', () => {
  const r = caissierAuMoment([s(null, 'ZAN LOU MARLENE FLORA', '2026-09-04', '06:00', '15:00')], { restaurantId: 'palm', date: '2026-09-04', heure: '9h' })
  assert.equal(r.caissier_id, null)
  assert.equal(r.caissier_nom, 'ZAN LOU MARLENE FLORA')
  assert.equal(r.raison, 'heure')
})

import { readFileSync } from 'node:fs'

test('la fonction ingest-reviews utilise une copie EXACTE de la règle', () => {
  const original = readFileSync(new URL('./attributionAvis.js', import.meta.url), 'utf8')
  const copie = readFileSync(new URL('../supabase/functions/ingest-reviews/attributionAvis.js', import.meta.url), 'utf8')
  assert.equal(copie, original, 'Recopier lib/attributionAvis.js dans supabase/functions/ingest-reviews/')
})
