import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let incoherencesPoint
try {
  ({ incoherencesPoint } = await import('./coherencePoint.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

const sh = (vente_shift, vente_systeme_pos = null) => ({ vente_shift, vente_systeme_pos })

describe('Contrôle d’un point validé dans Vérification', () => {
  test('Maroc 14/10 : vente théorique 109 500 pour 267 800 de shifts', () => {
    assert.equal(typeof incoherencesPoint, 'function')
    const p = { valide: true, vente_total: 109500, vente_machine: 108500 }
    const shifts = [sh(58000, 58000), sh(51500, 50500), sh(158300, 156800)]
    const r = incoherencesPoint(p, shifts)
    assert.deepEqual(r.map(x => x.code), ['vente_shifts', 'machine_pos'])
    assert.equal(r[0].ecart, 109500 - 267800)
    assert.equal(r[1].ecart, 108500 - 265300)
  })

  test('point cohérent → aucune alerte', () => {
    const p = { valide: true, vente_total: 267800, vente_machine: 265300 }
    assert.deepEqual(incoherencesPoint(p, [sh(58000, 58000), sh(51500, 50500), sh(158300, 156800)]), [])
  })

  test('site sans POS : la vente machine est saisie à la main, pas comparée', () => {
    const p = { valide: true, vente_total: 100000, vente_machine: 98000 }
    assert.deepEqual(incoherencesPoint(p, [sh(60000), sh(40000)]), [])
  })

  test('déductions du gérant enregistrées mais 0 F déduit (7E 06/08)', () => {
    const p = { valide: true, date: '2026-10-20', vente_total: 351800, depenses_gerant_caisse_total: null,
      draft_gerant: { fournisseurs: { a: { paye: '71800' } }, depenses: { 'Marché': [{ montant: '19900' }] } } }
    const r = incoherencesPoint(p, [sh(351800)], { deductionsEnregistrees: 0 })
    assert.deepEqual(r.map(x => x.code), ['deductions_gerant'])
    assert.equal(r[0].ecart, 91700)
  })

  test('journées revues le 15/10 et laissées par choix → plus signalées', () => {
    const p = { valide: true, date: '2026-09-13', vente_total: 1, draft_gerant: { paies: [{ montant: '30500' }] } }
    assert.deepEqual(incoherencesPoint(p, [sh(1)]), [])
  })

  test('déductions bien comptées (colonne ou lignes) → aucune alerte', () => {
    const draft = { fournisseurs: { a: { paye: '71800' } } }
    assert.deepEqual(incoherencesPoint({ valide: true, date: '2026-10-20', vente_total: 1, depenses_gerant_caisse_total: 71800, draft_gerant: draft }, [sh(1)]), [])
    assert.deepEqual(incoherencesPoint({ valide: true, date: '2026-10-20', vente_total: 1, draft_gerant: draft }, [sh(1)], { deductionsEnregistrees: 71800 }), [])
  })

  test('point non validé, ou sans shift → rien à contrôler', () => {
    assert.deepEqual(incoherencesPoint({ valide: false, vente_total: 0 }, [sh(5000)]), [])
    assert.deepEqual(incoherencesPoint({ valide: true, vente_total: 5000 }, []), [])
  })
})
