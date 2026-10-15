import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let shiftsOntChange
try {
  ({ shiftsOntChange } = await import('./shiftsAJour.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

const s1 = { id: 'a', vente_shift: 58000, vente_systeme_pos: 58000, espece: 46500, depenses: 0 }
const s2 = { id: 'b', vente_shift: 51500, vente_systeme_pos: 50500, espece: 10500, depenses: 6000 }
const s3 = { id: 'c', vente_shift: 158300, vente_systeme_pos: 156800, espece: 99350, depenses: 23150 }

describe('Shifts du point : la liste affichée est-elle encore celle de la base ?', () => {
  test('même liste → rien n’a changé', () => {
    assert.equal(typeof shiftsOntChange, 'function')
    assert.equal(shiftsOntChange([s1, s2], [s1, s2]), false)
  })

  test('Maroc 14/10 : le shift du soir arrive 10 s avant la validation', () => {
    assert.equal(shiftsOntChange([s1, s2], [s1, s2, s3]), true)
  })

  test('un shift supprimé ou déplacé entre-temps', () => {
    assert.equal(shiftsOntChange([s1, s2, s3], [s1, s3]), true)
  })

  test('un shift corrigé entre-temps (montant modifié)', () => {
    assert.equal(shiftsOntChange([s1, s2], [s1, { ...s2, espece: 11500, vente_shift: 52500 }]), true)
  })

  test('l’ordre de lecture ne compte pas', () => {
    assert.equal(shiftsOntChange([s1, s2], [s2, s1]), false)
  })

  test('listes vides ou absentes', () => {
    assert.equal(shiftsOntChange([], null), false)
    assert.equal(shiftsOntChange(undefined, [s1]), true)
  })
})
