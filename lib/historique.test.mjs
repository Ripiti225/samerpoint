// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/historique.js — historiques de la Trésorerie (loyers payés,
// dettes remboursées, fiche par restaurant).
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { anneesDisponibles, dansPeriode, dettesRemboursees, historiqueRestaurant, loyersPayes, mouvementsRestaurant } from './historique.js'

const du = (id, categorie, mois, echeance, extra = {}) => ({ id, categorie, restaurant_id: 'kms', mois, echeance, montant_du: 1000, ...extra })
const paie = (du_id, montant, date, source = 'compte') => ({ du_id, montant, date, source })

describe('période', () => {
  test('année seule, mois précis, ou tout', () => {
    assert.equal(dansPeriode('2026-09-01', { an: 2026, mois: null }), true)
    assert.equal(dansPeriode('2026-09-01', { an: 2026, mois: 9 }), true)
    assert.equal(dansPeriode('2026-09-01', { an: 2026, mois: 8 }), false)
    assert.equal(dansPeriode('2025-09-01', { an: 2026, mois: null }), false)
    assert.equal(dansPeriode('2025-09-01', null), true)
  })
  test('années proposées : celles des données et l\'année en cours, la plus récente d\'abord', () => {
    assert.deepEqual(anneesDisponibles(['2025-10-01', '2026-08-01', null], 2026), [2026, 2025])
  })
})

describe('loyers payés', () => {
  const dus = [
    du('jul', 'loyer', '2026-07-01', '2026-08-05'),
    du('aou', 'loyer', '2026-08-01', '2026-09-05'),
    du('sep', 'loyer', '2026-09-01', '2026-10-05'),
    du('sal', 'salaire', '2026-08-01', '2026-09-10'),
  ]
  const paiements = [paie('jul', 1000, '2026-08-04'), paie('aou', 600, '2026-09-04'), paie('aou', 400, '2026-09-20'), paie('sal', 1000, '2026-09-08')]
  test('seulement les loyers soldés, le plus récent d\'abord, avec la date du dernier versement', () => {
    assert.deepEqual(loyersPayes(dus, paiements, null).map(l => [l.du.id, l.soldeLe, l.paiements.length]),
      [['aou', '2026-09-20', 2], ['jul', '2026-08-04', 1]])
  })
  test('filtré sur le mois consommé', () => {
    assert.deepEqual(loyersPayes(dus, paiements, { an: 2026, mois: 7 }).map(l => l.du.id), ['jul'])
  })
})

describe('dettes remboursées', () => {
  const dus = [
    { id: 'zab', categorie: 'dette', creancier: 'Zabad', montant_du: 5000 },
    { id: 'aut', categorie: 'autre', libelle: 'Comptable', montant_du: 300, en_dette_depuis: '2026-09-01' },
    du('tard', 'loyer', '2026-07-01', '2026-08-05'),
    du('atemps', 'loyer', '2026-08-01', '2026-09-05'),
    du('avant', 'salaire', '2026-07-01', '2026-08-10'),
    du('ouverte', 'loyer', '2026-06-01', '2026-07-05'),
  ]
  const paiements = [
    paie('zab', 5000, '2026-09-30'),
    paie('aut', 300, '2026-09-15'),
    paie('tard', 1000, '2026-08-20'),
    paie('atemps', 1000, '2026-09-04'),
    paie('avant', 1000, '2026-08-10', 'avant'),
    paie('ouverte', 500, '2026-08-01'),
  ]
  test('créanciers soldés, dettes à la main soldées, charges payées après leur date limite', () => {
    assert.deepEqual(dettesRemboursees(dus, paiements, null).map(l => [l.du.id, l.soldeLe, l.retard]),
      [['zab', '2026-09-30', 0], ['aut', '2026-09-15', 0], ['tard', '2026-08-20', 15]])
  })
  test('filtré sur la date du remboursement', () => {
    assert.deepEqual(dettesRemboursees(dus, paiements, { an: 2026, mois: 8 }).map(l => l.du.id), ['tard'])
  })
})

describe('fiche par restaurant', () => {
  const dus = [
    du('l8', 'loyer', '2026-08-01', '2026-09-05'),
    du('s8', 'salaire', '2026-08-01', '2026-09-10', { montant_du: 400 }),
    du('l9', 'loyer', '2026-09-01', '2026-10-05'),
    { id: 'a', categorie: 'autre', restaurant_id: 'kms', libelle: 'Compresseur', montant_du: 200, created_at: '2026-09-12T10:00:00Z' },
    { ...du('autreResto', 'loyer', '2026-09-01', '2026-10-05'), restaurant_id: 'yop' },
  ]
  const paiements = [paie('l8', 1000, '2026-09-04'), paie('s8', 100, '2026-09-08')]
  test('par mois, le plus récent d\'abord, avec dû, payé et reste ; autres charges au mois de leur saisie', () => {
    const h = historiqueRestaurant(dus, paiements, 'kms', { periode: null })
    assert.deepEqual(h.map(m => [m.mois, m.du, m.paye, m.reste, m.lignes.length]),
      [['2026-09-01', 1200, 0, 1200, 2], ['2026-08-01', 1400, 1100, 300, 2]])
  })
  test('catégories limitées (ex. RH) et période', () => {
    const h = historiqueRestaurant(dus, paiements, 'kms', { periode: { an: 2026, mois: 8 }, categories: ['salaire'] })
    assert.deepEqual(h.map(m => [m.mois, m.lignes.map(l => l.du.id)]), [['2026-08-01', ['s8']]])
  })
})

describe('mouvements d\'un restaurant', () => {
  const sources = {
    depenses: [
      { id: 'f1', categorie: 'fond', restaurant_id: 'kms', date: '2026-09-28', montant: 50000 },
      { id: 'r1', categorie: 'reparation', restaurant_id: 'kms', date: '2026-10-02', montant: 15000 },
      { id: 'f2', categorie: 'fond', restaurant_id: 'yop', date: '2026-10-02', montant: 30000 },
      { id: 'g1', categorie: 'investissement', restaurant_id: null, date: '2026-10-02', montant: 9000 },
    ],
    mouvements: [
      { id: 'e1', type: 'especes', restaurant_id: 'kms', date: '2026-10-03', montant: 20000 },
      { id: 'p0', type: 'paiement', restaurant_id: 'kms', date: '2026-10-03', montant: -5000 },
    ],
    partenaires: [
      { id: 'g', type: 'recu', restaurant_id: 'kms', date: '2026-10-04', periode_debut: '2026-09-22', montant: 80000 },
      { id: 'pub', type: 'pub', restaurant_id: 'kms', date: null, periode_debut: '2026-09-22', montant: 3000 },
      { id: 'reel', type: 'reel', restaurant_id: 'kms', date: null, periode_debut: '2026-09-22', montant: 90000 },
      { id: 'y', type: 'recu', restaurant_id: null, date: '2026-10-04', periode_debut: '2026-09-26', montant: 70000 },
    ],
    cotisations: [{ id: 'c1', restaurant_id: 'kms', date: '2026-10-05', montant: 10000 }],
  }

  test('ne garde que ce restaurant, rangé au mois de sa date, le plus récent d\'abord', () => {
    const m = mouvementsRestaurant(sources, 'kms')
    assert.deepEqual(m.map(x => x.mois), ['2026-10-01', '2026-09-01'])
    assert.deepEqual(m[0].lignes.map(l => l.id), ['cot-c1', 'par-g', 'esp-e1', 'dep-r1'])
    assert.deepEqual(m[1].lignes.map(l => l.id), ['dep-f1', 'par-pub'])
  })
  test('sens : fond et dépenses sortent, espèces / partenaire / cotisation entrent, pub retenue', () => {
    const [oct, sep] = mouvementsRestaurant(sources, 'kms')
    assert.equal(oct.sorties, 15000)
    assert.equal(oct.entrees, 20000 + 80000 + 10000)
    assert.equal(sep.sorties, 50000)
    assert.equal(sep.lignes.find(l => l.type === 'pub').sens, 'retenue')
  })
  test('période et sources absentes', () => {
    assert.deepEqual(mouvementsRestaurant(sources, 'kms', { periode: { an: 2026, mois: 9 } }).map(x => x.mois), ['2026-09-01'])
    assert.deepEqual(mouvementsRestaurant({ depenses: sources.depenses }, 'yop').map(x => x.lignes.length), [1])
    assert.deepEqual(mouvementsRestaurant(undefined, 'kms'), [])
  })
})
