import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let impactShift
let majPointsDeplacement
try {
  ({ impactShift, majPointsDeplacement } = await import('./deplacementShift.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

// Cas réel : Al Kayan Yop, shift de nuit d'AMARA ouvert le 09/10 à 23h49,
// déplacé du 09/10 vers le 10/10 (pont POS : `depenses` = achats seuls,
// les 5 000 de salaires sont dans la vente).
const AMARA = {
  vente_shift: 129500, espece: 119500, depenses: 0, fournisseurs: 0,
  kdo: 0, retour: 0, yango_cse: 0, glovo_cse: 0, wave: 2500, om: 2500, djamo: 0,
}

const P09 = {
  id: 'p09', date: '2026-10-09', valide: true,
  vente_total: 671200, depense_total: 462490, kdo: 7500, retour: 0,
  yango_cse: 40000, glovo_cse: 55000, wave: 12500, om: 9500, djamo: 0,
  fc_veille: -617277, reste_especes: 84210, reste_fc: -533067, benefice_sc: 184219.5,
}
const P10 = {
  id: 'p10', date: '2026-10-10', valide: true,
  vente_total: 783300, depense_total: 584114, kdo: 5000, retour: 0,
  yango_cse: 20000, glovo_cse: 115800, wave: 19500, om: 5000, djamo: 0,
  fc_veille: -533067, reste_especes: 33886, reste_fc: -499181, benefice_sc: 146649.5,
}
const P11 = {
  id: 'p11', date: '2026-10-11', valide: true,
  vente_total: 878800, depense_total: 598825, kdo: 2500, retour: 0,
  yango_cse: 0, glovo_cse: 134300, wave: 25000, om: 26000, djamo: 0,
  fc_veille: -499181, reste_especes: 92175, reste_fc: -407006, benefice_sc: 252746.5,
}

const parId = majs => Object.fromEntries(majs.map(m => [m.id, m.maj]))

describe('Déplacer un shift d’un jour à l’autre', () => {
  test('le shift emporte vente, encaissements, dépenses + salaires et espèces', () => {
    assert.equal(typeof impactShift, 'function')
    const i = impactShift(AMARA)
    assert.equal(i.vente_total, 129500)
    assert.equal(i.wave, 2500)
    assert.equal(i.om, 2500)
    assert.equal(i.depense_total, 5000)
    assert.equal(i.reste_especes, 119500)
  })

  test('les deux points validés sont recalculés en entier (cas Yop 09 → 10/10)', () => {
    const majs = parId(majPointsDeplacement({
      shift: AMARA, sourceId: 'p09', cibleId: 'p10', points: [P09, P10, P11],
    }))
    assert.deepEqual(majs.p09, {
      vente_total: 541700, depense_total: 457490, kdo: 7500, points_fidelite: 0, retour: 0,
      yango_cse: 40000, glovo_cse: 55000, wave: 10000, om: 7000, djamo: 0,
      reste_especes: -35290, reste_fc: -652567, benefice_sc: 59769.5,
    })
    assert.deepEqual(majs.p10, {
      vente_total: 912800, depense_total: 589114, kdo: 5000, points_fidelite: 0, retour: 0,
      yango_cse: 20000, glovo_cse: 115800, wave: 22000, om: 7500, djamo: 0,
      fc_veille: -652567, reste_especes: 153386, reste_fc: -499181, benefice_sc: 271099.5,
    })
  })

  test('le fond de fin ne bouge pas : les jours suivants ne sont pas touchés', () => {
    const majs = parId(majPointsDeplacement({
      shift: AMARA, sourceId: 'p09', cibleId: 'p10', points: [P09, P10, P11],
    }))
    assert.equal(majs.p11, undefined)
  })

  test('vers un jour plus ancien : les jours intermédiaires validés reportent le fond', () => {
    const P08 = { ...P09, id: 'p08', date: '2026-10-08' }
    const majs = parId(majPointsDeplacement({
      shift: AMARA, sourceId: 'p10', cibleId: 'p08', points: [P08, P09, P10, P11],
    }))
    assert.equal(majs.p08.reste_fc, P08.reste_fc + 119500)
    assert.deepEqual(majs.p09, { fc_veille: P09.fc_veille + 119500, reste_fc: P09.reste_fc + 119500 })
    assert.equal(majs.p10.fc_veille, P10.fc_veille + 119500)
    assert.equal(majs.p10.reste_fc, P10.reste_fc)
    assert.equal(majs.p11, undefined)
  })

  test('un point non validé n’est pas touché : sa validation recalculera tout', () => {
    const P10brouillon = { ...P10, valide: false }
    const majs = parId(majPointsDeplacement({
      shift: AMARA, sourceId: 'p09', cibleId: 'p10', points: [P09, P10brouillon, P11],
    }))
    assert.equal(majs.p09.reste_especes, -35290)
    assert.equal(majs.p10, undefined)
  })

  test('payé en points (POS) : dans la vente, hors espèces et hors bénéfice, comme le KDO', () => {
    const avecPoints = { ...AMARA, vente_shift: AMARA.vente_shift + 6000, points_fidelite: 6000 }
    const i = impactShift(avecPoints)
    assert.equal(i.vente_total, 135500)
    assert.equal(i.points_fidelite, 6000)
    assert.equal(i.reste_especes, 119500)
    assert.equal(i.depense_total, 5000)
    assert.equal(i.benefice_sc, impactShift(AMARA).benefice_sc)
    const majs = parId(majPointsDeplacement({
      shift: avecPoints, sourceId: 'p09', cibleId: 'p10', points: [P09, P10, P11],
    }))
    assert.equal(majs.p09.points_fidelite, -6000)
    assert.equal(majs.p10.points_fidelite, 6000)
    assert.equal(majs.p10.reste_especes, 153386)
  })

  test('les montants arrivés en texte depuis la base sont bien additionnés', () => {
    const texte = Object.fromEntries(Object.entries(P10).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]))
    const majs = parId(majPointsDeplacement({
      shift: AMARA, sourceId: 'p09', cibleId: 'p10', points: [P09, texte],
    }))
    assert.equal(majs.p10.reste_especes, 153386)
  })
})
