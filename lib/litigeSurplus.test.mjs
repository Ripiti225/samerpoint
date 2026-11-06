// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/litigeSurplus.js — litige manuel sur un surplus de stock.
//
// Le piège : un comptage mal tapé (331 748 frites pour 33 180) donnerait une
// retenue absurde si le montant partait tout seul. La suggestion n'est donc
// qu'une proposition, et un montant illisible n'est jamais enregistré.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  SEUIL_ALERTE_LITIGE, actionSurplus, estSurplus, lireMontantLitige, messageLitige, suggestionLitige,
} from './litigeSurplus.js'

describe('estSurplus', () => {
  test('écart positif seulement', () => {
    assert.equal(estSurplus({ ecart: 3 }), true)
    assert.equal(estSurplus({ ecart: -3 }), false)
    assert.equal(estSurplus({ ecart: 0.005 }), false)
    assert.equal(estSurplus({}), false)
  })
})

describe('suggestionLitige', () => {
  test('surplus × prix, arrondi', () => {
    assert.equal(suggestionLitige({ ecart: 2.5, prix: 1001 }), 2503)
  })
  test('sans prix : aucune suggestion', () => {
    assert.equal(suggestionLitige({ ecart: 2, prix: 0 }), 0)
    assert.equal(suggestionLitige({ ecart: 2 }), 0)
  })
})

describe('lireMontantLitige', () => {
  test('entier en francs, espaces acceptés', () => {
    assert.equal(lireMontantLitige('12 500'), 12500)
    assert.equal(lireMontantLitige('0'), 0)
  })
  test('vide ou illisible : null, jamais 0', () => {
    assert.equal(lireMontantLitige(''), null)
    assert.equal(lireMontantLitige('   '), null)
    assert.equal(lireMontantLitige('abc'), null)
    assert.equal(lireMontantLitige('12,5'), null)
    assert.equal(lireMontantLitige('-100'), null)
  })
  test('le seuil d’alerte vaut 50 000 F', () => assert.equal(SEUIL_ALERTE_LITIGE, 50000))
})

describe('actionSurplus', () => {
  const ligne = { id: 'l1', ecart: 5, explication_statut: null, montantDeduit: 0 }
  test('sans explication : bouton Litige', () => assert.equal(actionSurplus(ligne), 'litige'))
  test('en attente : ✅ et ❌', () => assert.equal(actionSurplus({ ...ligne, explication_statut: 'en_attente' }), 'decider'))
  test('litige posé : modifiable', () => {
    assert.equal(actionSurplus({ ...ligne, explication_statut: 'refusee', montantDeduit: 500 }), 'modifier')
  })
  test('explication validée : modifiable', () => {
    assert.equal(actionSurplus({ ...ligne, explication_statut: 'validee' }), 'modifier')
  })
  test('déduction annulée, ancien format ou manquant : aucune action', () => {
    assert.equal(actionSurplus({ ...ligne, deduction_annulee: true }), null)
    assert.equal(actionSurplus({ ...ligne, id: undefined }), null)
    assert.equal(actionSurplus({ ...ligne, ecart: -5 }), null)
  })
})

describe('messageLitige', () => {
  test('nomme le produit, le montant et le caissier, et demande de rentrer les produits', () => {
    const m = messageLitige({ produit: 'Total Fromage', montant: 12500, caissier: 'Awa' })
    assert.match(m, /Total Fromage/)
    assert.match(m, /12\s?500/)
    assert.match(m, /Awa/)
    assert.match(m, /Rentrez vos produits/)
  })
  test('caissier inconnu : le message reste lisible', () => {
    assert.match(messageLitige({ produit: 'Eau', montant: 500, caissier: null }), /caissier du shift/)
  })
  test('montant à 0 : litige retiré', () => {
    assert.match(messageLitige({ produit: 'Eau', montant: 0, caissier: 'Awa' }), /retiré/)
  })
})
