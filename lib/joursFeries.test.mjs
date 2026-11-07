// Tests de lib/joursFeries.js — liste des fériés ivoiriens et fichier .ics.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ANNEES_FERIES, anneeParDefaut, ajouterJours, datePaques, fichierIcs, joursFeriesAnnee, lignesFeries, listeDeLAnnee, nomFichierIcs, texteVersBase64,
} from './joursFeries.js'

test('Pâques : dates connues', () => {
  assert.equal(datePaques(2026), '2026-04-05')
  assert.equal(datePaques(2027), '2027-03-28')
  assert.equal(datePaques(2030), '2030-04-21')
})

test('ajouterJours : passage de mois et d\'année', () => {
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01')
  assert.equal(ajouterJours('2027-01-01', -7), '2026-12-25')
})

test('année 2027 : 14 fêtes, triées, dates attendues', () => {
  const l = joursFeriesAnnee(2027)
  assert.equal(l.length, 14)
  assert.deepEqual(l.map(f => f.date), [...l.map(f => f.date)].sort())
  const date = cle => l.find(f => f.cle === cle).date
  assert.equal(date('nuit_destin'), '2027-03-07')
  assert.equal(date('korite'), '2027-03-09')
  assert.equal(date('lundi_paques'), '2027-03-29')
  assert.equal(date('ascension'), '2027-05-06')
  assert.equal(date('tabaski'), '2027-05-16')
  assert.equal(date('lundi_pentecote'), '2027-05-17')
  assert.equal(date('maouloud'), '2027-08-15')
  assert.equal(date('paix'), '2027-11-15')
})

test('seules les fêtes lunaires sont estimées', () => {
  const estimees = joursFeriesAnnee(2027).filter(f => f.estimee).map(f => f.cle).sort()
  assert.deepEqual(estimees, ['korite', 'maouloud', 'nuit_destin', 'tabaski'])
})

test('toutes les années disponibles ont 14 fêtes ; 2025 n\'a pas les lunaires', () => {
  for (const a of ANNEES_FERIES) assert.equal(joursFeriesAnnee(a).length, 14, a)
  const l2025 = joursFeriesAnnee(2025)
  assert.equal(l2025.length, 10)
  assert.equal(l2025.some(f => f.estimee), false)
  assert.ok(l2025.some(f => f.cle === 'noel' && f.date === '2025-12-25'))
})

test('lignesFeries : prêtes à insérer, alerte active', () => {
  const lignes = lignesFeries(2027, 'Awa')
  assert.equal(lignes.length, 14)
  const t = lignes.find(l => l.ferie_cle === 'tabaski')
  assert.deepEqual(t, {
    titre: 'Tabaski', date_evenement: '2027-05-16', note: null, restaurant_id: null, chaque_annee: false,
    ferie_cle: 'tabaski', ferie_annee: 2027, date_estimee: true, alerte_stock: true, cree_par_nom: 'Awa',
  })
})

test('listeDeLAnnee : sans ligne en base, la liste de référence', () => {
  const l = listeDeLAnnee(2027, [{ id: 'x', ferie_cle: 'noel', ferie_annee: 2026, titre: 'Noël', date_evenement: '2026-12-25' }])
  assert.equal(l.length, 14)
  assert.equal(l.find(f => f.cle === 'noel').evenement, null)
})

test('listeDeLAnnee : avec des lignes, seules elles comptent, corrections comprises', () => {
  const tabaski = { id: 't', ferie_cle: 'tabaski', ferie_annee: 2027, titre: 'Tabaski', date_evenement: '2027-05-17', date_estimee: false }
  const noel = { id: 'n', ferie_cle: 'noel', ferie_annee: 2027, titre: 'Noël', date_evenement: '2027-12-25', date_estimee: false }
  const manuel = { id: 'm', ferie_cle: null, ferie_annee: null, titre: 'Réunion', date_evenement: '2027-01-02' }
  const l = listeDeLAnnee(2027, [noel, manuel, tabaski])
  assert.deepEqual(l.map(f => [f.cle, f.date, f.estimee]), [['tabaski', '2027-05-17', false], ['noel', '2027-12-25', false]])
  assert.equal(l[0].evenement, tabaski)
})

test('fichierIcs : journées entières, deux rappels, date estimée signalée, fins de ligne CRLF', () => {
  const ics = fichierIcs([{ cle: 'tabaski', titre: 'Tabaski', date: '2027-05-16', estimee: true }], '2026-11-07T10:20:30.000Z')
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.match(ics, /DTSTART;VALUE=DATE:20270516\r\n/)
  assert.match(ics, /DTEND;VALUE=DATE:20270517\r\n/)
  assert.match(ics, /DTSTAMP:20261107T102030Z\r\n/)
  assert.match(ics, /SUMMARY:Tabaski \(date estimée\)\r\n/)
  assert.match(ics, /UID:ferie-tabaski-2027@samtrackly\r\n/)
  assert.match(ics, new RegExp(`SEQUENCE:${Math.floor(Date.parse('2026-11-07T10:20:30.000Z') / 60000)}\\r\\n`))
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 2)
  assert.match(ics, /TRIGGER:-P6DT15H\r\n/)
  assert.match(ics, /TRIGGER:-P1DT15H\r\n/)
})

test('fichierIcs : caractères spéciaux échappés et longues lignes pliées', () => {
  const ics = fichierIcs([{ cle: 'x', titre: `Fête, avec; ${'a'.repeat(100)}`, date: '2027-01-01', estimee: false }], '2026-11-07T10:20:30.000Z')
  assert.match(ics, /SUMMARY:Fête\\, avec\\; a+/)
  assert.ok(ics.split('\r\n').every(l => l.length <= 61))
})

test('nomFichierIcs', () => {
  assert.equal(nomFichierIcs(2027), 'jours-feries-ci-2027.ics')
})

test('texteVersBase64 : accents et emoji, comme Buffer', () => {
  for (const t of ['a', 'ab', 'abc', 'Fête nationale à Abidjan', 'Noël 🎄']) {
    assert.equal(texteVersBase64(t), Buffer.from(t, 'utf8').toString('base64'))
  }
})

test('fichierIcs : l\'UID ne change pas quand la date est corrigée', () => {
  const uid = d => fichierIcs([{ cle: 'tabaski', titre: 'Tabaski', date: d, estimee: false }], '2026-11-07T10:20:30.000Z').match(/UID:.*\r\n/)[0]
  assert.equal(uid('2027-05-16'), uid('2027-05-17'))
})

test('anneeParDefaut', () => {
  assert.equal(anneeParDefaut('2026-11-07'), 2026)
  assert.equal(anneeParDefaut('2026-12-26'), 2027)
  assert.equal(anneeParDefaut('2031-01-01'), 2030)
})

test('lignesFeries : note sur le Lundi de Pentecôte seulement', () => {
  const l = lignesFeries(2027, 'Awa')
  assert.equal(l.find(x => x.ferie_cle === 'lundi_pentecote').note, 'Présence dans la liste officielle à confirmer.')
  assert.equal(l.filter(x => x.note).length, 1)
})
