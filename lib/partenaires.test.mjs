// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/partenaires.js — l'argent que Yango, Glovo, Wave, OM et Djamo
// nous doivent.
//
// Les pièges : une période mal découpée fait payer deux fois la même semaine ;
// un export qui s'ADDITIONNE à l'estimé au lieu de le remplacer gonfle la
// trésorerie ; une période en cours comptée trop tôt aussi.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  periodeDe, periodesSuivies, estimerPeriode, situationPeriode, totalPartenaires,
  libellePeriode, ajouterJours, MODE_PAR_DEFAUT, COMPTE_TETE_DE_FOND,
} from './partenaires.js'

describe('périodes', () => {
  test('Yango : vendredi → jeudi', () => {
    // 01/10/2026 est un jeudi
    assert.deepEqual(periodeDe('yango', '2026-10-01'), { debut: '2026-09-25', fin: '2026-10-01' })
    assert.deepEqual(periodeDe('yango', '2026-10-02'), { debut: '2026-10-02', fin: '2026-10-08' })
  })
  test('Wave et Djamo : lundi → dimanche', () => {
    assert.deepEqual(periodeDe('wave', '2026-10-01'), { debut: '2026-09-28', fin: '2026-10-04' })
    assert.deepEqual(periodeDe('djamo', '2026-10-04'), { debut: '2026-09-28', fin: '2026-10-04' })
  })
  test('Glovo : tranches de 7 jours puis la fin du mois', () => {
    assert.deepEqual(periodeDe('glovo', '2026-09-07'), { debut: '2026-09-01', fin: '2026-09-07' })
    assert.deepEqual(periodeDe('glovo', '2026-09-22'), { debut: '2026-09-22', fin: '2026-09-28' })
    assert.deepEqual(periodeDe('glovo', '2026-09-30'), { debut: '2026-09-29', fin: '2026-09-30' })
    assert.deepEqual(periodeDe('glovo', '2026-10-31'), { debut: '2026-10-29', fin: '2026-10-31' })
  })
  test('Glovo en février : 29 → fin n\'existe que les années bissextiles', () => {
    assert.deepEqual(periodeDe('glovo', '2028-02-29'), { debut: '2028-02-29', fin: '2028-02-29' })
    assert.deepEqual(periodeDe('glovo', '2027-02-28'), { debut: '2027-02-22', fin: '2027-02-28' })
  })
  test('OM : le mois', () => {
    assert.deepEqual(periodeDe('om', '2026-09-15'), { debut: '2026-09-01', fin: '2026-09-30' })
  })
  test('périodes suivies depuis la date de départ, plus récente d\'abord', () => {
    const p = periodesSuivies('yango', '2026-09-18', '2026-10-01')
    assert.deepEqual(p.map(x => x.debut), ['2026-09-25', '2026-09-18'])
  })
  test('une date de départ en milieu de période commence à la suivante', () => {
    const p = periodesSuivies('wave', '2026-09-23', '2026-10-01')
    assert.deepEqual(p.map(x => x.debut), ['2026-09-28'])
  })
  test('sans date de départ : rien', () => {
    assert.deepEqual(periodesSuivies('om', null, '2026-10-01'), [])
  })
  test('passage de mois pour Glovo', () => {
    const p = periodesSuivies('glovo', '2026-09-22', '2026-10-03')
    assert.deepEqual(p.map(x => x.debut), ['2026-10-01', '2026-09-29', '2026-09-22'])
  })
  test('libellé', () => {
    assert.equal(libellePeriode({ debut: '2026-09-19', fin: '2026-09-25' }), '19/09 → 25/09')
    assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01')
  })
  test('modes par défaut : seul Glovo verse par restaurant', () => {
    assert.deepEqual(MODE_PAR_DEFAUT, { yango: 'groupe', glovo: 'restaurant', wave: 'tete_de_fond', om: 'tete_de_fond', djamo: 'tete_de_fond' })
    assert.equal(COMPTE_TETE_DE_FOND.om, 'Tête de fond OM')
  })
})

describe('estimé', () => {
  const points = [
    { restaurant_id: 'kms', date: '2026-09-19', yango_tab: 100000, wave: 50000 },
    { restaurant_id: 'kms', date: '2026-09-25', yango_tab: 200000 },
    { restaurant_id: 'palm', date: '2026-09-20', yango_tab: '10000' },
    { restaurant_id: 'palm', date: '2026-09-26', yango_tab: 999999 }, // hors période
  ]
  test('somme des points × coefficient, par restaurant', () => {
    assert.deepEqual(estimerPeriode(points, 'yango', { debut: '2026-09-19', fin: '2026-09-25' }), {
      kms: 231000, palm: 7700,
    })
  })
  test('Wave × 0,99', () => {
    assert.deepEqual(estimerPeriode(points, 'wave', { debut: '2026-09-14', fin: '2026-09-20' }), { kms: 49500 })
  })
})

describe('situation d\'une période', () => {
  const periode = { debut: '2026-09-19', fin: '2026-09-25' }
  const estimes = { kms: 1000, palm: 2000 }

  test('sans export : l\'estimé, compté seulement une fois la période terminée', () => {
    const en = situationPeriode({ periode, estimes, aujourdhui: '2026-09-25' })
    assert.equal(en.terminee, false)
    assert.equal(en.attendu, 3000)
    assert.equal(en.aRecevoir, 0)
    const fini = situationPeriode({ periode, estimes, aujourdhui: '2026-09-26' })
    assert.equal(fini.aRecevoir, 3000)
  })

  test('l\'export REMPLACE l\'estimé, et un resto absent de l\'export vaut 0', () => {
    const s = situationPeriode({
      periode, estimes, aujourdhui: '2026-10-01',
      lignes: [{ type: 'reel', restaurant_id: 'kms', montant: 900 }],
    })
    assert.equal(s.exportImporte, true)
    assert.equal(s.attendu, 900)
    const palm = s.parResto.find(x => x.restaurant_id === 'palm')
    assert.equal(palm.reel, 0)
    assert.equal(palm.estime, 2000)
  })

  test('la pub est déduite du réel, par restaurant', () => {
    const s = situationPeriode({
      periode, estimes, aujourdhui: '2026-10-01',
      lignes: [
        { type: 'reel', restaurant_id: 'kms', montant: 900 },
        { type: 'reel', restaurant_id: 'palm', montant: 2100 },
        { type: 'pub', restaurant_id: 'palm', montant: 100 },
      ],
    })
    assert.equal(s.parResto.find(x => x.restaurant_id === 'palm').attendu, 2000)
    assert.equal(s.attendu, 2900)
  })

  test('versement par restaurant : seuls les restos non reçus restent dus', () => {
    const s = situationPeriode({
      periode, estimes, aujourdhui: '2026-10-01', mode: 'restaurant',
      lignes: [{ type: 'recu', restaurant_id: 'kms', montant: 990 }],
    })
    assert.equal(s.aRecevoir, 2000)
    assert.equal(s.recuFait, false)
    assert.equal(s.parResto.find(x => x.restaurant_id === 'kms').ecart, -10)
  })

  test('versement groupé (Yango) : une réception solde toute la période', () => {
    const s = situationPeriode({
      periode, estimes, aujourdhui: '2026-10-01', mode: 'groupe',
      lignes: [{ type: 'recu', restaurant_id: null, montant: 2950 }],
    })
    assert.equal(s.aRecevoir, 0)
    assert.equal(s.recuFait, true)
    assert.equal(s.ecartGroupe, -50)
  })

  test('groupé non reçu : tout l\'attendu', () => {
    const s = situationPeriode({ periode, estimes, aujourdhui: '2026-10-01', mode: 'groupe' })
    assert.equal(s.aRecevoir, 3000)
  })
})

describe('réception sur la tête de fond (OM, Wave, Djamo)', () => {
  const periode = { debut: '2026-09-01', fin: '2026-09-30' }
  const estimes = { kms: 1000, palm: 2000 }
  test('reçu par restaurant, plus que l\'attendu possible : écart par restaurant, plus rien à recevoir', () => {
    const lignes = [
      { type: 'recu', restaurant_id: 'kms', montant: 1200, mouvement_id: 'm' },
      { type: 'recu', restaurant_id: 'palm', montant: 2000, mouvement_id: 'm' },
    ]
    const s = situationPeriode({ periode, estimes, lignes, mode: 'tete_de_fond', aujourdhui: '2026-10-02' })
    assert.equal(s.recuFait, true)
    assert.equal(s.aRecevoir, 0)
    assert.deepEqual(s.parResto.map(r => [r.restaurant_id, r.recu, r.ecart]), [['kms', 1200, 200], ['palm', 2000, 0]])
  })
  test('OM : un restaurant reçu seul d\'abord, les autres plus tard, d\'un coup', () => {
    const seul = [{ type: 'recu', restaurant_id: 'kms', montant: 1000, mouvement_id: 'm1' }]
    const s1 = situationPeriode({ periode, estimes, lignes: seul, mode: 'tete_de_fond', aujourdhui: '2026-10-02' })
    assert.equal(s1.recuFait, false)
    assert.equal(s1.aRecevoir, 2000)
    const tous = [...seul, { type: 'recu', restaurant_id: 'palm', montant: 2100, mouvement_id: 'm2' }]
    const s2 = situationPeriode({ periode, estimes, lignes: tous, mode: 'tete_de_fond', aujourdhui: '2026-10-05' })
    assert.equal(s2.recuFait, true)
    assert.equal(s2.aRecevoir, 0)
  })
  test('pas encore reçu : tout l\'attendu reste à recevoir', () => {
    const s = situationPeriode({ periode, estimes, lignes: [], mode: 'tete_de_fond', aujourdhui: '2026-10-02' })
    assert.equal(s.aRecevoir, 3000)
  })
})

describe('total des partenaires', () => {
  test('somme des périodes terminées depuis la date de départ, chaque partenaire à part', () => {
    const points = [
      { restaurant_id: 'kms', date: '2026-09-21', yango_tab: 100000, wave: 100000 },
      { restaurant_id: 'kms', date: '2026-09-29', yango_tab: 100000, wave: 100000 }, // périodes en cours
    ]
    const r = totalPartenaires({
      reglages: {
        yango: { date_depart: '2026-09-18', mode_versement: 'groupe' },
        wave: { date_depart: '2026-09-21', mode_versement: 'restaurant' },
      },
      points,
      lignes: [{ partenaire: 'wave', periode_debut: '2026-09-21', type: 'recu', restaurant_id: 'kms', montant: 99000 }],
      aujourdhui: '2026-10-01',
    })
    assert.equal(r.parPartenaire.yango, 77000)   // 18→24/09 terminée ; 25/09→01/10 en cours
    assert.equal(r.parPartenaire.wave, 0)        // 21→27/09 reçue
    assert.equal(r.parPartenaire.glovo, 0)       // pas de date de départ
    assert.equal(r.total, 77000)
  })
})
