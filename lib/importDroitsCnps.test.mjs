// Tests de lib/importDroitsCnps.js — import des anciens travailleurs et des arriérés CNPS (22/10/2026).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { csvControle, dateIso, lireCnps, lireDroits, nomImport, sqlImport } from './importDroitsCnps.js'

const ENTETE = ['N°', 'NOM ET PRENOM', 'DATE de cessation', 'RESTAURANT', 'MONTANT', 'montant réglé', 'MOTIF de Départ', 'OBSERVATION']
const PALM = 'b862dfee-007f-413a-9de0-2c6e83b572ce'
const MAROC = 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'
const YOP = '268695fe-972e-468e-b2b7-4e7f268dec4f'

describe('nomImport', () => {
  test('majuscules, accents gardés, apostrophe droite, espaces simples', () => {
    assert.equal(nomImport(' N’GAZA Oi  N’gaza Noel '), "N'GAZA OI N'GAZA NOEL")
    assert.equal(nomImport('ACHI Amemou Cédric'), 'ACHI AMEMOU CÉDRIC')
  })
})

describe('dateIso', () => {
  test('numéro de série Excel (lecture en flux sans formats)', () => {
    assert.equal(dateIso(45658), '2025-01-01')
    assert.equal(dateIso(44651), '2022-03-31')
  })
  test('texte AAAA-MM-JJ gardé, vide → null', () => {
    assert.equal(dateIso('2024-07-31'), '2024-07-31')
    assert.equal(dateIso(null), null)
  })
})

describe('lireDroits', () => {
  const feuilles = {
    maroc: [ENTETE,
      [4, 'DOH SEBASTIEN', '2024-07-31', 'MAROC', 167770, 100000, 'Démission', 'reclame le reste'],
      [],
      [null, null, 'TOTAL', null, 1219922, 0, 'RESTE à PAYER', 1219922]],
    autres: [ENTETE, [1, 'OGOUDIKPE', '2024-09-30', 'ZONE 4', 17647, null, 'Fin de contrat', 'pas reclamer']],
    Feuil1: [['N°', 'NOM ET PRENOM', 'DATE de cessation', 'RESTAURANT', 'MONTANT', 'montant réglé', 'MOTIF de Départ', 'CONTACT', 'reste'],
      [64, 'TAPE BARRY BATESTI', '2025-06-30', 'PALMERAIE', 328971, 50000, 'licenciement', null, 278971],
      [69, "ETTIEN N'DA", '2025-04-10', 'MAROC', 1000000],
      [73, 'LAGO AUDREY', 45850, 'AL KAYAN', 129345, null, 'Démission'],
      [1, 'ACHI Amemou Cédric', '2022-03-31', 'MAROC', 65975, 0, 'Démission']],
  }
  const d = lireDroits(feuilles)
  test('réglé lu ligne par ligne, ligne TOTAL ignorée', () => {
    const doh = d.find(x => x.nom === 'DOH SEBASTIEN')
    assert.equal(doh.regle, 100000)
    assert.equal(doh.reste, 67770)
    assert.deepEqual(doh.rattachement, { restaurant_id: MAROC })
    assert.equal(d.filter(x => x.feuille === 'maroc').length, 1)
  })
  test('Zone 4 sur le Groupe Samer', () => {
    assert.deepEqual(d.find(x => x.nom === 'OGOUDIKPE').rattachement, { groupe: 'Groupe Samer' })
  })
  test('Feuil1 : seulement les trois ajouts, avec leur rattachement', () => {
    assert.deepEqual(d.filter(x => x.feuille === 'Feuil1').map(x => x.nom).sort(), ["ETTIEN N'DA", 'LAGO AUDREY', 'TAPE BARRY BATESTI'])
    const tape = d.find(x => x.nom === 'TAPE BARRY BATESTI')
    assert.deepEqual(tape.rattachement, { restaurant_id: PALM })
    assert.equal(tape.reste, 278971)
    assert.equal(tape.observation, 'réclame toujours')
    assert.deepEqual(d.find(x => x.nom === 'LAGO AUDREY').rattachement, { restaurant_id: YOP })
    assert.equal(d.find(x => x.nom === 'LAGO AUDREY').depart_le, '2025-07-12')
  })
  test('motif mis en forme', () => {
    assert.equal(d.find(x => x.nom === 'TAPE BARRY BATESTI').motif, 'Licenciement')
    assert.equal(d.find(x => x.nom === "ETTIEN N'DA").motif, '')
  })
})

describe('lireCnps', () => {
  const lignes = [['PERIODE', 'COTISATION'],
    ['REDRESSEMENT 2015', 250845], ['2020-06-03', 385864], [45962, 570563.5], ['DISA 2024', 232493], ['DISA 2025', null]]
  const c = lireCnps(lignes)
  test('libellés, dates, montants arrondis, ligne vide ignorée', () => {
    assert.deepEqual(c, [
      { libelle: 'Redressement 2015', date: '2015-12-31', montant: 250845 },
      { libelle: 'CNPS juin 2020', date: '2020-06-01', montant: 385864 },
      { libelle: 'CNPS novembre 2025', date: '2025-11-01', montant: 570564 },
      { libelle: 'DISA 2024', date: '2024-12-31', montant: 232493 },
    ])
  })
})

describe('csvControle / sqlImport', () => {
  const droits = [{ nom: "N'GAZA OI", rattachement: { groupe: 'Groupe Samer' }, feuille: 'autres', depart_le: '2023-04-30',
    motif: 'Démission', observation: 'pas de trace', montant: 100, regle: 40, reste: 60 }]
  test('CSV : séparateur ; et apostrophes gardées', () => {
    const csv = csvControle(droits)
    assert.match(csv.split('\n')[0], /^Rattachement;Nom;/)
    assert.match(csv, /Groupe Samer;N'GAZA OI;30\/04\/2023;Démission — pas de trace;100;40;60/)
  })
  test('SQL : transaction, apostrophes doublées, marqueur d\'import', () => {
    const sql = sqlImport(droits, [{ libelle: 'CNPS juin 2020', date: '2020-06-01', montant: 385864 }])
    assert.match(sql, /^BEGIN;/)
    assert.match(sql, /COMMIT;\s*$/)
    assert.match(sql, /'N''GAZA OI'/)
    assert.match(sql, /\[import 22\/10\]/)
    assert.match(sql, /'CNPS juin 2020/)
  })
})
