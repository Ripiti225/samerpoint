// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/partenairesImport.js — le calcul des skills Yango et Glovo,
// refait dans l'app. Un écart ici et le « réel » importé ne correspond plus à
// ce que le partenaire verse.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  analyserYango, analyserGlovo, codeYango, codeGlovo, lireNombre, lireDateHeure,
  seuilYango, trouverEntetes, COLONNES_YANGO,
} from './partenairesImport.js'

describe('codes restaurant', () => {
  test('Yango : enseigne Al Kayan à part', () => {
    assert.equal(codeYango("Al Kayan Pizza (Abidjan, Rue S95, La commune Yopougon, Abidjan, Côte d'Ivoire, )"), 'ALK1')
    assert.equal(codeYango('Al Kayan (Quartier de la Angré, Quartier de la Angré, Quartier de la Angré)'), 'PALM')
    assert.equal(codeYango("Al Kayan (Abidjan, Côte d'Ivoire, )"), 'KMS')
  })
  test('Yango : autres enseignes', () => {
    assert.equal(codeYango('Chez Samer (Абиджан, Côte d\'Ivoire, Abidjan, Rond point Riviera Palmraie)'), 'PALM')
    assert.equal(codeYango('Chez Samer (Quartier de la Angré, Abidjan)'), '7E')
    assert.equal(codeYango('S Burger By Samer Zone 4 (Abidjan, Rue du 7 Décembre, )'), 'KMS')
    assert.equal(codeYango('Chez Samer Yopougon St André (Abidjan, Rue P239, )'), 'LVG')
    assert.equal(codeYango("S Pizza Yopougon Maroc (Abidjan, Côte d'Ivoire, )"), 'MRC')
    assert.equal(codeYango('Chez Samer Ananeraie (Абиджан, коммуна Йопугон, улица С584)'), 'OASIS')
    assert.equal(codeYango('Restaurant inconnu'), null)
  })
  test('Glovo : Zone 4 et Remblais = KMS, AK1 = ALK1', () => {
    assert.equal(codeGlovo('Chez Samer - ABN - C323+24J'), 'KMS')
    assert.equal(codeGlovo('Al Kayan - ABN - Remblais'), 'KMS')
    assert.equal(codeGlovo('Al Kayan (Annaneraie) [YOP]'), 'ALK1')
    assert.equal(codeGlovo('Chez Samer - ABN - Riviéra Palmeraie Abidjan CI'), 'PALM')
    assert.equal(codeGlovo('Chez Samer - YOP - S CI'), 'MRC')
    assert.equal(codeGlovo('Chez Samer (S 584) [YOP]'), 'OASIS')
  })
})

describe('cellules', () => {
  test('nombres', () => {
    assert.equal(lireNombre('1 234,5'), 1234.5)
    assert.equal(lireNombre('1,234.50'), 1234.5)
    assert.equal(lireNombre(''), 0)
    assert.equal(lireNombre(42), 42)
  })
  test('dates', () => {
    assert.deepEqual(lireDateHeure('2026-09-18 22:15:00'), { jour: '2026-09-18', minutes: 22 * 60 + 15 })
    assert.deepEqual(lireDateHeure('18/09/2026 08:05'), { jour: '2026-09-18', minutes: 485 })
    assert.deepEqual(lireDateHeure(46283.5), { jour: '2026-09-18', minutes: 720 })
    assert.equal(lireDateHeure(''), null)
  })
  test('seuil : 22h en été, 21h en hiver', () => {
    assert.equal(seuilYango('2026-09-18'), 22)
    assert.equal(seuilYango('2026-10-25'), 21) // dernier dimanche d'octobre 2026
    assert.equal(seuilYango('2026-01-10'), 21)
    assert.equal(seuilYango('2026-03-29'), 22) // dernier dimanche de mars 2026
  })
  test('colonnes manquantes : message clair', () => {
    assert.throws(() => trouverEntetes([['Nom du restaurant', 'Montant']], COLONNES_YANGO), /Colonnes introuvables.*Statut/)
  })
})

describe('Yango', () => {
  const entetes = ['Nom du restaurant', 'Numéro de la commande', 'Montant', 'Statut', 'La commande sera payée', 'Commande confirmée par le restaurant']
  const kms = 'Chez Samer (Quartier de la Zone 4, Abidjan)'
  const lignes = [
    entetes,
    [kms, 'A1', 10000, 'Livré', 'Oui', '2026-09-18 21:59:00'], // bord début (< 22h) : écartée
    [kms, 'A2', 10000, 'Livré', 'Oui', '2026-09-18 22:00:00'], // gardée
    [kms, 'A3', 20000, 'Livré', 'Oui', '2026-09-21 13:00:00'],
    [kms, 'A4', 5000, 'Annulé', 'Oui', '2026-09-21 14:00:00'], // annulée
    [kms, 'A5', 5000, 'Livré', 'Non', '2026-09-22 14:00:00'],  // non payable
    [kms, 'A6', 3000, 'Livré', '', ''],                          // payée vide : écartée
    [kms, 'A7', 7000, 'Livré', 'Oui', '2026-09-26 21:00:00'],  // dernier jour < 22h : gardée
    [kms, 'A8', 9000, 'Livré', 'Oui', '2026-09-26 22:30:00'],  // bord fin : écartée
    [],
  ]

  test('cadrage 22h, filtres et Montant × 0,77', () => {
    const r = analyserYango(lignes)
    assert.equal(r.j1, '2026-09-18')
    assert.equal(r.jn, '2026-09-26')
    assert.equal(r.seuil, 22)
    assert.deepEqual(r.ecarte, { bordDebut: 1, bordFin: 1, nonPayables: 2, annulees: 1 })
    assert.equal(r.nbCommandes, 3)
    assert.deepEqual(r.parCode.KMS, { nb: 3, montant: 37000, paye: 28490 })
  })

  test('seuil choisi à la main (21h)', () => {
    const r = analyserYango(lignes, { seuil: 21 })
    assert.equal(r.ecarte.bordDebut, 0)
    assert.equal(r.ecarte.bordFin, 2)
  })

  test('nom inconnu signalé, pas inventé', () => {
    const r = analyserYango([
      entetes,
      [kms, 'B0', 1000, 'Livré', 'Oui', '2026-09-19 23:00:00'],
      ['Snack X', 'B1', 1000, 'Livré', 'Oui', '2026-09-20 12:00:00'],
      [kms, 'B2', 1000, 'Livré', 'Oui', '2026-09-21 10:00:00'],
    ])
    assert.deepEqual(r.nomsInconnus, ['Snack X'])
    assert.ok(r.parCode['?'])
  })
})

describe('Glovo', () => {
  const lignes = [
    ['Métadonnées de la commande', null, null, 'Revenus'],
    ['Nom du restaurant', 'Numéro de commande', 'Acceptée à', 'Sous-total', 'Remise financée par vous',
      'Commission', 'Frais opérationnels', "Frais d'annonces", "Frais de temps d'attente", 'est payable'],
    ['Chez Samer - ABN - C323+24J', 'G1', '2026-09-22 12:00', 10000, 1000, 999, 200, 999, 100, 'Oui'],
    ['Al Kayan - ABN - Remblais', 'G2', '2026-09-28 12:00', 5000, 0, 0, 0, 0, 0, 'Oui'],
    ['Chez Samer - ABN - C323+24J', 'G3', '2026-09-23 12:00', 8000, 0, 0, 0, 0, 0, 'Non'],
  ]

  test('VENTE, commission 29,5 %, annonces = attente × 18 %, PAYE', () => {
    const r = analyserGlovo(lignes)
    assert.equal(r.ecarte.nonPayables, 1)
    assert.equal(r.j1, '2026-09-22')
    assert.equal(r.jn, '2026-09-28')
    // G1 : vente 9000 ; commission 2655 ; annonces 18 ; paye 9000−2655−200−18−100 = 6027
    // G2 : vente 5000 ; commission 1475 ; paye 3525
    assert.deepEqual(r.parCode.KMS, { nb: 2, montant: 14000, remise: 1000, commission: 4130, paye: 9552 })
  })
})
