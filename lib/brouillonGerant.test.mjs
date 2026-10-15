import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let totalBrouillonGerant
let brouillonAReprendre
try {
  ({ totalBrouillonGerant, brouillonAReprendre } = await import('./brouillonGerant.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

// Brouillon réel de Samer Maroc, 14/08/2026 (abrégé) : enregistré à 00:23,
// point validé à 10:32 avec 0 F de déductions.
const maroc1408 = {
  paies: [],
  depenses: { Fruits: [], 'Marché': [], 'Légumes': [], 'Dépenses annexes': [{ montant: '5000', description: 'Mairie' }] },
  fournisseurs: {
    a: { nom: 'Ibrahim', paye: '90000' },
    b: { nom: 'Cotisation salaire', paye: '37000' },
    c: { nom: 'Surcrerie', paye: '24500' },
    d: { nom: 'Anicet viande', paye: '48000,' },
    e: { nom: 'Alassane fruit', paye: '25000' },
    f: { nom: 'Gaz Orix', paye: '24000' },
  },
}

describe('Déductions gérant enregistrées en base (draft_gerant)', () => {
  test('total = dépenses + fournisseurs payés + paies, même formule que le contexte', () => {
    assert.equal(typeof totalBrouillonGerant, 'function')
    assert.equal(totalBrouillonGerant(maroc1408), 253500)
    assert.equal(totalBrouillonGerant({ paies: [{ montant: '3500' }, { montant: '15000' }] }), 18500)
  })

  test('brouillon absent ou vide → 0', () => {
    assert.equal(totalBrouillonGerant(null), 0)
    assert.equal(totalBrouillonGerant({}), 0)
    assert.equal(totalBrouillonGerant('{"paies":[{"montant":"1000"}]}'), 1000)
  })

  test('mémoire du téléphone vidée (session expirée) → reprendre le brouillon', () => {
    assert.equal(typeof brouillonAReprendre, 'function')
    assert.equal(brouillonAReprendre({ totalContexte: 0, draft: maroc1408, pointValide: false }), true)
  })

  test('le gérant a déjà ses déductions à l’écran → ne pas écraser ce qu’il saisit', () => {
    assert.equal(brouillonAReprendre({ totalContexte: 12000, draft: maroc1408, pointValide: false }), false)
  })

  test('rien en base, ou point déjà validé → rien à reprendre', () => {
    assert.equal(brouillonAReprendre({ totalContexte: 0, draft: null, pointValide: false }), false)
    assert.equal(brouillonAReprendre({ totalContexte: 0, draft: maroc1408, pointValide: true }), false)
  })
})
