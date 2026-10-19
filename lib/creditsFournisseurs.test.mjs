import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let agregerMouvementsMensuels
let preparerHistoriqueFournisseur
let restaurerPhotosFacturesDepuisPoints
let facturesGerantSansPhoto
let ecritureAjustementCredit
let ecrituresFicheFournisseur
let compteDansChaineCredit
try {
  ({
    agregerMouvementsMensuels,
    preparerHistoriqueFournisseur,
    restaurerPhotosFacturesDepuisPoints,
    facturesGerantSansPhoto,
    ecritureAjustementCredit,
    ecrituresFicheFournisseur,
    compteDansChaineCredit,
  } = await import('./creditsFournisseurs.js'))
} catch {
  // Le premier passage TDD doit échouer proprement tant que le module n'existe pas.
}

describe('photos obligatoires des factures en déductions gérant', () => {
  test('signale toutes les factures sans justificatif, même impayées ou marquées avec photo', () => {
    assert.equal(typeof facturesGerantSansPhoto, 'function')
    assert.deepEqual(facturesGerantSansPhoto({
      f1: { nom: 'Boucherie', montant_facture: '15000', paye: '5000', photoUri: null },
      f2: { nom: 'Primeur', montant_facture: '2000', paye: '0', hasPhoto: true },
      f3: { montant_facture: '1000', photoUri: '' },
    }), ['f1', 'f2', 'f3'])
  })

  test('refuse les anciennes URI locales qui ne sont pas des justificatifs conservés', () => {
    assert.equal(typeof facturesGerantSansPhoto, 'function')
    for (const photoUri of ['file:///cache/photo.jpg', 'blob:photo', 'data:image/jpeg;base64,abc', 'content://photo', '   ']) {
      assert.deepEqual(facturesGerantSansPhoto({ f1: { montant_facture: 1000, photoUri } }), ['f1'])
    }
  })

  test('accepte une photo distante ou conservée dans la file hors ligne', () => {
    assert.equal(typeof facturesGerantSansPhoto, 'function')
    assert.deepEqual(facturesGerantSansPhoto({
      f1: { montant_facture: '15000', photoUri: 'https://photos.test/facture.jpg' },
      f2: { montant_facture: '2000', photoUri: 'pending-photo://photo-123' },
    }), [])
  })

  test('ne réclame pas de photo pour un règlement de dette sans nouvelle facture', () => {
    assert.equal(typeof facturesGerantSansPhoto, 'function')
    assert.deepEqual(facturesGerantSansPhoto({
      f1: { montant_facture: '0', paye: '5000', credit_veille: 10000 },
      f2: { montant_facture: '', paye: '2000' },
      f3: {}, f4: null,
    }), [])
    assert.deepEqual(facturesGerantSansPhoto({}), [])
    assert.deepEqual(facturesGerantSansPhoto(null), [])
  })
})

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

describe('correction manuelle du crédit (bouton Modifier)', () => {
  test('une hausse devient une facture, une baisse un paiement', () => {
    assert.equal(typeof ecritureAjustementCredit, 'function')
    assert.deepEqual(ecritureAjustementCredit(50000), { facture: 50000, paye: 0 })
    assert.deepEqual(ecritureAjustementCredit(-156140), { facture: 0, paye: 156140 })
  })

  test('refuse un écart nul ou illisible', () => {
    assert.equal(ecritureAjustementCredit(0), null)
    assert.equal(ecritureAjustementCredit(NaN), null)
    assert.equal(ecritureAjustementCredit(undefined), null)
  })
})

describe('fiche fournisseur de Paramètres : crédit et montant cotisé', () => {
  test('nouveau crédit = écart avec le reste de la dernière transaction', () => {
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 136500, nouveauCredit: '351000' }), [214500])
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: -64000, nouveauCredit: 0 }), [64000])
  })
  test('crédit inchangé ou vide : aucune écriture', () => {
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 5000, nouveauCredit: '5000' }), [])
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 5000, nouveauCredit: '' }), [])
  })
  test('montant cotisé = un seul paiement (avance), après le crédit', () => {
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 0, avance: '200000' }), [-200000])
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 0, nouveauCredit: '50000', avance: 20000 }), [50000, -20000])
  })
  test('avance nulle ou négative ignorée', () => {
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 0, avance: '0' }), [])
    assert.deepEqual(ecrituresFicheFournisseur({ resteChaine: 0, avance: -5 }), [])
  })
})

describe('historique Google Sheets importé : affiché, jamais compté', () => {
  test('les lignes importées sont écartées de la chaîne de crédit, les autres gardées', () => {
    assert.equal(typeof compteDansChaineCredit, 'function')
    assert.equal(compteDansChaineCredit({ source: 'import_sheets_2026_10' }), false)
    assert.equal(compteDansChaineCredit({ source: null }), true)
    assert.equal(compteDansChaineCredit({ source: 'ajustement_manager' }), true)
    assert.equal(compteDansChaineCredit({}), true)
  })
})
