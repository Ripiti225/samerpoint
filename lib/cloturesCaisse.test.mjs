import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let cloturesPOS
let formaterMontantSigneFCFA
let resumerEcartsGlobaux
try {
  ({ cloturesPOS, formaterMontantSigneFCFA, resumerEcartsGlobaux } = await import('./cloturesCaisse.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

describe('affichage des écarts d’une clôture POS', () => {
  test('l’écart global vient de rapport_z.diff même si l’écart espèces vaut zéro', () => {
    assert.equal(typeof cloturesPOS, 'function')
    const [cloture] = cloturesPOS([{
      id: 'shift-1', pos_service_id: 'service-1', valide: true,
      caissier_nom: 'Awa', ecart_pos: 0, ecart_reconciliation: -5000,
    }])

    assert.equal(cloture.ecartGlobal, -5000)
    assert.equal(cloture.ecartGlobalTexte, '-5 000 FCFA')
    assert.equal(cloture.ecartEspeces, 0)
    assert.equal(cloture.ecartEspecesTexte, '0 FCFA')
  })

  test('un diff à zéro reste l’écart global quand le tiroir manque de 2 000 FCFA', () => {
    const [cloture] = cloturesPOS([{
      id: 'shift-2', pos_service_id: 'service-2', valide: true,
      caissier_nom: 'Mariam', ecart_pos: -2000, ecart_reconciliation: 0,
    }])

    assert.equal(cloture.ecartGlobalTexte, '0 FCFA')
    assert.equal(cloture.ecartEspecesTexte, '-2 000 FCFA')
  })

  test('un diff absent est non disponible sans repli sur l’écart espèces', () => {
    const [cloture] = cloturesPOS([{
      id: 'shift-3', pos_service_id: 'service-3', valide: true,
      caissier_nom: 'Fatou', ecart_pos: -3500, ecart_reconciliation: null,
    }])

    assert.equal(cloture.ecartGlobal, null)
    assert.equal(cloture.ecartGlobalTexte, 'Non disponible')
    assert.equal(cloture.ecartEspeces, -3500)
  })

  test('le format FCFA conserve le signe positif, négatif et le zéro', () => {
    assert.equal(typeof formaterMontantSigneFCFA, 'function')
    assert.equal(formaterMontantSigneFCFA(2000), '+2 000 FCFA')
    assert.equal(formaterMontantSigneFCFA(-5000), '-5 000 FCFA')
    assert.equal(formaterMontantSigneFCFA(0), '0 FCFA')
    assert.equal(formaterMontantSigneFCFA(null), 'Non disponible')
  })
})

describe('agrégation des écarts globaux', () => {
  test('somme les diff disponibles des seules clôtures validées sans doublons', () => {
    assert.equal(typeof resumerEcartsGlobaux, 'function')
    const resume = resumerEcartsGlobaux([
      { id: 'a', pos_service_id: 'pos-a', valide: true, ecart_reconciliation: -5000 },
      { id: 'a-copie', pos_service_id: 'pos-a', valide: true, ecart_reconciliation: -5000 },
      { id: 'b', pos_service_id: 'pos-b', valide: true, ecart_reconciliation: 2000 },
      { id: 'c', pos_service_id: 'pos-c', valide: true, ecart_reconciliation: null, ecart_pos: -9000 },
      { id: 'd', pos_service_id: 'pos-d', valide: false, ecart_reconciliation: 7000 },
      { id: 'manuel', pos_service_id: null, valide: true, ecart_reconciliation: null, ecart_pos: -1000 },
    ])

    assert.deepEqual(resume, {
      total: -3000,
      totalTexte: '-3 000 FCFA',
      disponibles: 2,
      indisponibles: 1,
      clotures: 3,
    })
  })

  test('un ensemble sans aucun diff a un total non disponible', () => {
    assert.deepEqual(resumerEcartsGlobaux([
      { id: 'ancien', pos_service_id: 'pos-ancien', valide: true, ecart_reconciliation: null, ecart_pos: 4000 },
    ]), {
      total: null,
      totalTexte: 'Non disponible',
      disponibles: 0,
      indisponibles: 1,
      clotures: 1,
    })
  })
})
