import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let depensesSalairesShift
let totalDepensesShifts
try {
  ({ depensesSalairesShift, totalDepensesShifts } = await import('./depensesShift.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

const encaissements = { kdo: 1000, retour: 0, yango_cse: 5000, glovo_cse: 0, wave: 8000, djamo: 0, om: 2000, espece: 40000 }

describe('« Dépenses + Salaires » d’un shift', () => {
  test('shift du pont POS : `depenses` ne porte que les achats, la paie est dans la vente', () => {
    assert.equal(typeof depensesSalairesShift, 'function')
    const achats = 3500
    const paies = 17500
    const shift = { ...encaissements, depenses: achats, fournisseurs: 0, vente_shift: achats + paies + 56000 }
    assert.equal(depensesSalairesShift(shift), 21000)
  })

  test('shift POS avec des achats payés en points : ils ne passent pas pour des dépenses', () => {
    const shift = { ...encaissements, points_fidelite: 6000, depenses: 3500, fournisseurs: 0, vente_shift: 3500 + 17500 + 56000 + 6000 }
    assert.equal(depensesSalairesShift(shift), 21000)
  })

  test('shift saisi par le caissier : `depenses` contient déjà paies et fournisseurs', () => {
    const cats = 9500
    const paies = 9000
    const fournisseurs = 12000
    const depenses = cats + paies + fournisseurs
    const shift = { ...encaissements, depenses, fournisseurs, vente_shift: depenses + 56000 }
    assert.equal(depensesSalairesShift(shift), 18500)
  })

  test('shift corrigé par un manager : `depenses` = catégories seules, paies et fournisseurs par-dessus', () => {
    const cats = 9500
    const paies = 9000
    const fournisseurs = 12000
    const shift = { ...encaissements, depenses: cats, fournisseurs, vente_shift: cats + fournisseurs + paies + 56000 }
    assert.equal(depensesSalairesShift(shift), 18500)
  })

  test('les montants arrivent en texte depuis Supabase (numeric)', () => {
    const shift = { kdo: '0', espece: '28000', depenses: '500', fournisseurs: '0', vente_shift: '38500' }
    assert.equal(depensesSalairesShift(shift), 10500)
  })

  test('sans vente enregistrée, retombe sur la colonne `depenses`', () => {
    assert.equal(depensesSalairesShift({ depenses: 4000, vente_shift: null }), 4000)
  })
})

describe('total des dépenses de plusieurs shifts', () => {
  test('additionne dépenses + salaires + fournisseurs, sans compter deux fois les fournisseurs', () => {
    assert.equal(typeof totalDepensesShifts, 'function')
    const pos = { ...encaissements, depenses: 3500, fournisseurs: 0, vente_shift: 3500 + 17500 + 56000 }
    const manuel = { ...encaissements, depenses: 30500, fournisseurs: 12000, vente_shift: 30500 + 56000 }
    assert.deepEqual(totalDepensesShifts([pos, manuel]), {
      depensesSalaires: 21000 + 18500,
      fournisseurs: 12000,
      total: 21000 + 18500 + 12000,
    })
  })

  test('liste vide ou absente', () => {
    assert.deepEqual(totalDepensesShifts(null), { depensesSalaires: 0, fournisseurs: 0, total: 0 })
  })
})
