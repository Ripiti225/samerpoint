import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregerStatsCaissiers,
  choisirInventaireShift,
  resumerEcartShift,
  resumerInventaire,
} from './statsCaissiers.js'

describe('aggregerStatsCaissiers — détail gérant par shift', () => {
  test('conserve les shifts séparés et les trie du plus récent au plus ancien', () => {
    const [stats] = aggregerStatsCaissiers([
      { id: 'ancien', caissier_id: 'c1', caissier_nom: 'Awa', date: '2026-09-12', heure_fin: '16:00', vente_shift: 10000 },
      { id: 'recent', caissier_id: 'c1', caissier_nom: 'Awa', date: '2026-09-14', heure_fin: '23:00', vente_shift: 15000 },
    ])

    assert.deepEqual(stats.shifts.map(shift => shift.id), ['recent', 'ancien'])
    assert.equal(stats.venteTotal, 25000)
    assert.equal(stats.nbShifts, 2)
  })

  test('additionne les manquants et surplus sans les compenser', () => {
    const [stats] = aggregerStatsCaissiers([
      { id: 's1', caissier_nom: 'Awa', ecart_pos: -5000 },
      { id: 's2', caissier_nom: 'Awa', ecart_pos: 2000 },
      { id: 's3', caissier_nom: 'Awa', ecart_pos: null },
    ])

    assert.equal(stats.manquantTotal, 5000)
    assert.equal(stats.surplusTotal, 2000)
    assert.equal(stats.shiftsAvecManquant, 1)
    assert.equal(stats.shiftsSansMesure, 1)
  })

  test('ne fusionne pas deux caissiers homonymes ayant des identifiants différents', () => {
    const stats = aggregerStatsCaissiers([
      { id: 's1', caissier_id: 'c1', caissier_nom: 'Awa', vente_shift: 10000 },
      { id: 's2', caissier_id: 'c2', caissier_nom: 'Awa', vente_shift: 20000 },
    ])

    assert.equal(stats.length, 2)
  })
})

describe('resumerEcartShift — mesure POS affichée au gérant', () => {
  test('un écart négatif devient un manquant positif avec son explication nettoyée', () => {
    assert.deepEqual(
      resumerEcartShift({ ecart_pos: -3500, explication_ecart: '  erreur de monnaie  ' }),
      { type: 'manquant', montant: 3500, explication: 'erreur de monnaie' },
    )
  })

  test('distingue équilibre, surplus et absence de mesure', () => {
    assert.equal(resumerEcartShift({ ecart_pos: 0 }).type, 'equilibre')
    assert.deepEqual(resumerEcartShift({ ecart_pos: 1200 }), { type: 'surplus', montant: 1200, explication: null })
    assert.deepEqual(resumerEcartShift({ ecart_pos: null }), { type: 'indisponible', montant: null, explication: null })
  })
})

describe('choisirInventaireShift — association sans mélanger deux shifts', () => {
  const shift = { point_id: 'p1', caissier_id: 'c1', type_shift: 'soir', heure_debut: '16:00:00' }

  test('préfère le même service POS même si un inventaire plus récent a le même type', () => {
    const choisi = choisirInventaireShift({ ...shift, pos_service_id: 'service-1' }, [
      { id: 'autre-service', point_id: 'p1', caissier_id: 'c1', pos_service_id: 'service-2', type_shift: 'soir', created_at: '2026-09-15T18:00:00Z' },
      { id: 'bon-service', point_id: 'p1', caissier_id: 'c1', pos_service_id: 'service-1', type_shift: 'soir', created_at: '2026-09-15T16:00:00Z' },
    ])

    assert.equal(choisi.id, 'bon-service')
  })

  test('préfère le même type de shift parmi les inventaires du caissier', () => {
    const choisi = choisirInventaireShift(shift, [
      { id: 'matin', point_id: 'p1', caissier_id: 'c1', type_shift: 'matin', created_at: '2026-09-15T08:00:00Z' },
      { id: 'soir', point_id: 'p1', caissier_id: 'c1', type_shift: 'soir', created_at: '2026-09-15T16:00:00Z' },
    ])

    assert.equal(choisi.id, 'soir')
  })

  test('ignore un inventaire appartenant à un autre caissier ou un autre point', () => {
    assert.equal(choisirInventaireShift(shift, [
      { id: 'autre-caissier', point_id: 'p1', caissier_id: 'c2', type_shift: 'soir' },
      { id: 'autre-point', point_id: 'p2', caissier_id: 'c1', type_shift: 'soir' },
    ]), null)
  })
})

describe('resumerInventaire — seules les anomalies utiles sont détaillées', () => {
  test('conserve les écarts, explications et déductions produit par produit', () => {
    const resume = resumerInventaire({
      montant_a_deduire: 2400,
      inventaire_lignes: [
        { produit_id: 'ok', produit_nom: 'Produit juste', stock_initial: 10, entrees: 2, sorties: 4, stock_reel: 8, ecart: 0 },
        { produit_id: 'poulet', produit_nom: 'Poulet', stock_initial: 10, entrees: 0, sorties: 2, stock_reel: 5, ecart: -3, nombre_explique: 1, explication: 'Deux pertes', montant_deduit: 2400 },
      ],
    })

    assert.equal(resume.nbProduits, 2)
    assert.equal(resume.nbEcarts, 1)
    assert.equal(resume.montantADeduire, 2400)
    assert.deepEqual(resume.lignesEcart, [{
      produitId: 'poulet',
      produitNom: 'Poulet',
      stockAttendu: 8,
      stockReel: 5,
      ecart: -3,
      nombreExplique: 1,
      explication: 'Deux pertes',
      montantDeduit: 2400,
    }])
  })

  test('un produit expliqué avec un écart revenu à zéro reste visible', () => {
    const resume = resumerInventaire({
      inventaire_lignes: [
        { produit_id: 'frites', produit_nom: 'Frites', stock_initial: 4, stock_reel: 4, ecart: 0, explication: 'Correction validée' },
      ],
    })

    assert.equal(resume.nbEcarts, 1)
    assert.equal(resume.lignesEcart[0].explication, 'Correction validée')
  })
})
