import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let agregerMouvementsMensuels
try {
  ({ agregerMouvementsMensuels } = await import('./creditsFournisseurs.js'))
} catch {
  // Le premier passage TDD doit échouer proprement tant que le module n'existe pas.
}

describe('mouvements mensuels des fournisseurs', () => {
  test('conserve chaque facture et sa photo lors du regroupement par fournisseur', () => {
    assert.equal(typeof agregerMouvementsMensuels, 'function')

    const resultat = agregerMouvementsMensuels([
      {
        id: 'facture-1', fournisseur_id: 'f1', fournisseur_nom: 'Marché central',
        facture: 12500, paye: 0, photo_url: 'https://photos.test/facture-1.jpg',
        date_point: '2026-08-14', created_at: '2026-08-15T08:00:00Z',
      },
      {
        id: 'paiement-1', fournisseur_id: 'f1', fournisseur_nom: 'Marché central',
        facture: 0, paye: 5000, photo_url: null,
        date_point: '2026-08-16', created_at: '2026-08-16T08:00:00Z',
      },
      {
        id: 'facture-2', fournisseur_id: 'f1', fournisseur_nom: 'Marché central',
        facture: 7500, paye: 0, photo_url: 'https://photos.test/facture-2.jpg',
        date_point: '2026-08-18', created_at: '2026-08-18T08:00:00Z',
      },
    ], { f1: 'Marché central' })

    assert.equal(resultat.totalFacture, 20000)
    assert.equal(resultat.totalPaye, 5000)
    assert.deepEqual(resultat.parFourn[0].factures, [
      {
        id: 'facture-2', montant: 7500,
        photo_url: 'https://photos.test/facture-2.jpg', date: '2026-08-18',
      },
      {
        id: 'facture-1', montant: 12500,
        photo_url: 'https://photos.test/facture-1.jpg', date: '2026-08-14',
      },
    ])
  })
})
