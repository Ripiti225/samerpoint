import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let agregerMouvementsMensuels
let preparerHistoriqueFournisseur
let restaurerPhotosFacturesDepuisPoints
try {
  ({
    agregerMouvementsMensuels,
    preparerHistoriqueFournisseur,
    restaurerPhotosFacturesDepuisPoints,
  } = await import('./creditsFournisseurs.js'))
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

  test('récupère la photo distante du brouillon gérant quand l’ancienne transaction ne la contient pas', () => {
    assert.equal(typeof restaurerPhotosFacturesDepuisPoints, 'function')

    const transactions = [
      {
        id: 'facture-sans-photo', point_id: 'point-1', fournisseur_id: 'f1',
        facture: 12500, photo_url: null, saisi_par: 'gerant',
      },
      {
        id: 'facture-uri-locale', point_id: 'point-1', fournisseur_id: 'f2',
        facture: 8000, photo_url: 'file:///cache/facture.jpg', saisi_par: 'gerant',
      },
      {
        id: 'facture-caissier', point_id: 'point-1', fournisseur_id: 'f1',
        facture: 4000, photo_url: null, saisi_par: 'caissier',
      },
      {
        id: 'ancienne-deduction-gerant', point_id: 'point-1', fournisseur_id: 'f3',
        facture: 6000, photo_url: null, saisi_par: 'gerant_caissier', source: 'deduction_gerant',
      },
    ]
    const points = [{
      id: 'point-1',
      draft_gerant: {
        fournisseurs: {
          f1: { photoUri: 'https://photos.test/facture-f1.jpg' },
          f2: { photoUri: 'https://photos.test/facture-f2.jpg' },
          f3: { photoUri: 'https://photos.test/facture-f3.jpg' },
        },
      },
    }]

    const resultat = restaurerPhotosFacturesDepuisPoints(transactions, points)

    assert.equal(resultat[0].photo_url, 'https://photos.test/facture-f1.jpg')
    assert.equal(resultat[1].photo_url, 'https://photos.test/facture-f2.jpg')
    assert.equal(resultat[2].photo_url, null)
    assert.equal(resultat[3].photo_url, 'https://photos.test/facture-f3.jpg')
  })

  test('prépare l’historique avec la photo visible dans Vérification même si la date est déjà résolue', () => {
    assert.equal(typeof preparerHistoriqueFournisseur, 'function')

    const resultat = preparerHistoriqueFournisseur([{
      id: 'facture-historique',
      point_id: 'point-1',
      fournisseur_id: 'f1',
      facture: 12500,
      photo_url: null,
      saisi_par: 'gerant',
      date_point: '2026-08-25',
      created_at: '2026-08-25T20:00:00Z',
    }], [{
      id: 'point-1',
      date: '2026-08-25',
      draft_gerant: {
        fournisseurs: {
          f1: { photoUri: 'https://photos.test/facture-historique.jpg' },
        },
      },
    }])

    assert.equal(resultat[0].photo_url, 'https://photos.test/facture-historique.jpg')
  })
})
