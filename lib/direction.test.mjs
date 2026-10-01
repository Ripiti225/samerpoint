// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/direction.js — coffre, dépenses direction, résultat net.
//
// Les pièges : un rechargement de fond compté comme une dépense rend un
// restaurant déficitaire à tort ; un investissement de groupe imputé à un
// restaurant aussi ; et le résultat doit reprendre exactement la formule de
// l'écran Charges, sinon deux écrans donnent deux chiffres.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATEGORIES_DIRECTION, compteDansResultat, soldeCoffre, objectifDuMois, progression,
  encaisseNetPoint, resultatsParRestoMois, derniersMois, bornesMois,
} from './direction.js'

describe('dépenses direction', () => {
  test('les six catégories de la feuille', () => {
    assert.deepEqual(CATEGORIES_DIRECTION.map(c => c.id),
      ['fond', 'reparation', 'materiel', 'equipement', 'investissement', 'retrait_perso'])
  })
  test('réparation, matériel, équipement d\'un restaurant comptent', () => {
    assert.equal(compteDansResultat({ categorie: 'reparation', restaurant_id: 'kms' }), true)
    assert.equal(compteDansResultat({ categorie: 'equipement', restaurant_id: 'kms' }), true)
  })
  test('fond, investissement, retrait perso ne comptent pas', () => {
    assert.equal(compteDansResultat({ categorie: 'fond', restaurant_id: 'kms' }), false)
    assert.equal(compteDansResultat({ categorie: 'investissement', restaurant_id: 'kms' }), false)
    assert.equal(compteDansResultat({ categorie: 'retrait_perso', restaurant_id: null }), false)
  })
  test('une dépense de groupe ne touche aucun restaurant', () => {
    assert.equal(compteDansResultat({ categorie: 'materiel', restaurant_id: null }), false)
  })
})

describe('coffre', () => {
  test('solde = dépôts − retraits', () => {
    assert.equal(soldeCoffre([{ montant: 1800000 }, { montant: 700000 }, { montant: -300000 }]), 2200000)
  })
  test('objectif : celui du mois, sinon le dernier fixé avant', () => {
    const o = [{ mois: '2026-08-01', montant: 4000000 }, { mois: '2026-09-01', montant: 5000000 }]
    assert.equal(objectifDuMois(o, '2026-09-01'), 5000000)
    assert.equal(objectifDuMois(o, '2026-11-01'), 5000000)
    assert.equal(objectifDuMois(o, '2026-07-01'), 0)
  })
  test('progression en %', () => {
    assert.equal(progression(3200000, 5000000), 64)
    assert.equal(progression(100, 0), null)
    assert.equal(progression(-5, 100), 0)
  })
})

describe('résultat net', () => {
  test('encaissé net d\'un point = formule de l\'écran Charges', () => {
    const v = encaisseNetPoint(
      { yango_tab: 100000, glovo_tab: 100000, depenses_gerant_caisse_total: 20000 },
      [{ om: 10000, wave: 20000, djamo: 0, espece: 300000 }, { espece: 50000 }],
    )
    // 77 000 + 70 500 + 9 900 + 19 800 + 350 000 − 20 000
    assert.equal(Math.round(v), 507200)
  })

  test('encaissé − charges − dépenses direction comptées − pubs, par mois', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-08', '2026-09'],
      points: [
        { id: 'p1', restaurant_id: 'kms', date: '2026-08-10', yango_tab: 0, glovo_tab: 0, depenses_gerant_caisse_total: 0 },
        { id: 'p2', restaurant_id: 'kms', date: '2026-07-31', yango_tab: 999999 }, // hors période
      ],
      shifts: [{ point_id: 'p1', espece: 5000000 }],
      charges: [{ restaurant_id: 'kms', mois: '2026-08', montant: 3000000 }],
      depenses: [
        { restaurant_id: 'kms', date: '2026-08-12', categorie: 'equipement', montant: 650000 },
        { restaurant_id: 'kms', date: '2026-08-15', categorie: 'fond', montant: 62000 },          // transfert
        { restaurant_id: null, date: '2026-08-20', categorie: 'investissement', montant: 2000000 }, // groupe
      ],
      pubs: [{ type: 'pub', restaurant_id: 'kms', periode_debut: '2026-08-22', montant: 50000 }],
    })
    assert.deepEqual(r.kms['2026-08'], {
      encaisse: 5000000, charges: 3000000, direction: 650000, pubs: 50000, net: 1300000, nbPoints: 1,
    })
    assert.equal(r.kms['2026-09'], undefined)
  })
})

describe('mois', () => {
  test('quatre derniers mois, passage d\'année', () => {
    assert.deepEqual(derniersMois('2027-01-15', 4), ['2026-10', '2026-11', '2026-12', '2027-01'])
  })
  test('bornes d\'un mois', () => {
    assert.deepEqual(bornesMois('2026-02'), { debut: '2026-02-01', fin: '2026-02-28' })
  })
})
