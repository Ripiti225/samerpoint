import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let majPointsApresShifts
let majReportFond
try {
  ({ majPointsApresShifts, majReportFond } = await import('./recalculPointValide.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

// Cas réel : Angré 7E, 18/08/2026. Le shift de Flora est corrigé après la
// validation (+17 250 d'espèces) : seule la vente suivait, les espèces
// n'entraient jamais dans le fond.
const FLORA_AVANT = { id: 'f', vente_shift: 159750, espece: 100000, depenses: 12950, fournisseurs: 0, kdo: 0, retour: 0, yango_cse: 0, glovo_cse: 46800, wave: 0, om: 0, djamo: 0 }
const FLORA_APRES = { ...FLORA_AVANT, vente_shift: 177000, espece: 117250 }

const P18 = { id: 'p18', date: '2026-08-18', valide: true, depense_total: 188100, kdo: 0, retour: 0, yango_cse: 0, glovo_cse: 80000, wave: 0, om: 0, djamo: 0, fc_veille: -283241, reste_especes: 32400, reste_fc: -250841, benefice_sc: 117762.5 }
const P19 = { id: 'p19', date: '2026-08-19', valide: true, fc_veille: -248341, reste_fc: -282186 }
const P20 = { id: 'p20', date: '2026-08-20', valide: true, fc_veille: -282186, reste_fc: -361086 }
const P21 = { id: 'p21', date: '2026-08-21', valide: false, fc_veille: 0, reste_fc: 0 }
const P17 = { id: 'p17', date: '2026-08-17', valide: true, fc_veille: -192841, reste_fc: -283241 }
const POINTS = [P20, P17, P18, P21, P19]

const parId = majs => Object.fromEntries(majs.map(m => [m.id, m.maj]))

describe('Shift corrigé, supprimé ou restauré sur un point validé', () => {
  test('les espèces suivent la vente, et le fond des jours validés suivants aussi', () => {
    assert.equal(typeof majPointsApresShifts, 'function')
    const m = parId(majPointsApresShifts({ pointId: 'p18', changements: [{ avant: FLORA_AVANT, apres: FLORA_APRES }], points: POINTS }))
    assert.equal(m.p18.reste_especes, 32400 + 17250)
    assert.equal(m.p18.reste_fc, -250841 + 17250)
    assert.equal(m.p18.benefice_sc, 117762.5 + 17250)
    assert.equal(m.p18.fc_veille, undefined, 'le fond de la veille du jour corrigé ne bouge pas')
    assert.deepEqual(m.p19, { fc_veille: -248341 + 17250, reste_fc: -282186 + 17250 })
    assert.deepEqual(m.p20, { fc_veille: -282186 + 17250, reste_fc: -361086 + 17250 })
    assert.equal(m.p17, undefined, 'les jours d’avant ne bougent pas')
    assert.equal(m.p21, undefined, 'un jour non validé se recalculera à sa validation')
  })

  test('shift supprimé : tout ce qu’il apportait sort du point', () => {
    const m = parId(majPointsApresShifts({ pointId: 'p18', changements: [{ avant: FLORA_AVANT, apres: null }], points: POINTS }))
    assert.equal(m.p18.reste_especes, 32400 - 100000)
    assert.equal(m.p18.glovo_cse, 80000 - 46800)
    assert.equal(m.p18.depense_total, 188100 - 12950)
    assert.equal(m.p19.fc_veille, -248341 - 100000)
  })

  test('shift restauré depuis la corbeille : il revient avec ses espèces', () => {
    const m = parId(majPointsApresShifts({ pointId: 'p18', changements: [{ avant: null, apres: FLORA_AVANT }], points: POINTS }))
    assert.equal(m.p18.reste_especes, 32400 + 100000)
    assert.equal(m.p20.reste_fc, -361086 + 100000)
  })

  test('point non validé : rien à reporter, la validation recalculera tout', () => {
    const pts = [{ ...P18, valide: false }, P19]
    assert.deepEqual(majPointsApresShifts({ pointId: 'p18', changements: [{ avant: FLORA_AVANT, apres: FLORA_APRES }], points: pts }), [])
  })

  test('changement sans effet d’argent (heures modifiées) → aucune écriture', () => {
    assert.deepEqual(majPointsApresShifts({ pointId: 'p18', changements: [{ avant: FLORA_AVANT, apres: { ...FLORA_AVANT } }], points: POINTS }), [])
  })
})

describe('Fond corrigé sur un point validé (ventes ou déductions gérant)', () => {
  test('l’écart part sur le fond de la veille de chaque jour validé suivant', () => {
    assert.equal(typeof majReportFond, 'function')
    const m = parId(majReportFond({ pointId: 'p18', delta: -91700, points: POINTS }))
    assert.deepEqual(m.p19, { fc_veille: -248341 - 91700, reste_fc: -282186 - 91700 })
    assert.deepEqual(m.p20, { fc_veille: -282186 - 91700, reste_fc: -361086 - 91700 })
    assert.equal(m.p18, undefined)
    assert.equal(m.p21, undefined)
  })

  test('pas d’écart, ou point non validé → rien', () => {
    assert.deepEqual(majReportFond({ pointId: 'p18', delta: 0, points: POINTS }), [])
    assert.deepEqual(majReportFond({ pointId: 'p21', delta: 5000, points: POINTS }), [])
  })
})
