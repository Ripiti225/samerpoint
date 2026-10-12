// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/creditFournisseursMois.js — crédit fournisseurs début / fin de mois.
//
// Les pièges : une cotisation (faux fournisseur) comptée en double avec la
// charge ; un fournisseur sans mouvement dans le mois oublié alors que sa dette
// pèse au début ET à la fin ; une écriture hors journée mal placée.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { creditFournisseursParRestoMois, estFournisseurCharge } from './creditFournisseursMois.js'

const fournisseurs = [
  { id: 'albert', restaurant_id: 'kms', nom: 'Albert' },
  { id: 'ibrahim', restaurant_id: 'kms', nom: 'Ibrahim' },
  { id: 'cotis', restaurant_id: 'kms', nom: 'Cotisation salaire' },
  { id: 'coq', restaurant_id: 'yop', nom: 'Coq ivoire' },
]
const tx = (fournisseur_id, date_point, reste, extra = {}) => ({
  fournisseur_id, date_point, reste, point_id: `p-${date_point}`, saisi_par: 'gerant', created_at: `${date_point}T20:00:00Z`, ...extra,
})

describe('faux fournisseurs de charges', () => {
  test('cotisations, CNPS, impôts, ITS, TEE, loyer, bail : écartés', () => {
    for (const nom of ['Cotisation salaire', 'Cotisation journaliere', 'CNPS', 'IMPÔT ET TIMBRE', 'ITS', 'TEE',
      'LOYER', 'CONTRAT DE BAIL', 'Salaire ancien ', 'PALMCI', 'SÉCURITÉ ', 'Boss', ' ANCIEN TRAVAILLEURS']) {
      assert.equal(estFournisseurCharge(nom), true, nom)
    }
  })
  test('vrais fournisseurs gardés', () => {
    for (const nom of ['Albert', 'Coq ivoire', 'CIE', 'SODECI', 'Gaz Orix', 'Teekay', 'Itsy', 'ODP', 'Report', 'Bossa nova']) {
      assert.equal(estFournisseurCharge(nom), false, nom)
    }
  })
})

describe('crédit début / fin de mois', () => {
  test('exemple de M. Zreik : 500 000 le 1er, 1 000 000 en fin de mois → variation 500 000', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [
        tx('albert', '2026-08-28', 500000),
        tx('albert', '2026-09-15', 800000),
        tx('albert', '2026-09-30', 1000000),
        tx('albert', '2026-10-02', 0), // après le mois : ignoré
      ],
    })
    assert.deepEqual(r.kms['2026-09'], { debut: 500000, fin: 1000000, ajustements: 0, variation: 500000 })
  })

  test('dette qui baisse : variation négative (remonte le résultat)', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('coq', '2026-08-31', 1000000), tx('coq', '2026-09-20', 500000)],
    })
    assert.deepEqual(r.yop['2026-09'], { debut: 1000000, fin: 500000, ajustements: 0, variation: -500000 })
  })

  test('fournisseur sans mouvement dans le mois : compté au début et à la fin', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('albert', '2026-06-10', 300000), tx('ibrahim', '2026-09-05', 100000)],
    })
    assert.deepEqual(r.kms['2026-09'], { debut: 300000, fin: 400000, ajustements: 0, variation: 100000 })
  })

  test('crédit négatif compté pour 0 : le rattrapage de factures oubliées n\'est pas un achat', () => {
    // Coq ivoire Palmeraie : −393 600 au 1er (factures oubliées), rattrapé à 0 le 30/09.
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('coq', '2026-08-31', -393600), tx('coq', '2026-09-30', 0)],
    })
    assert.deepEqual(r.yop['2026-09'], { debut: 0, fin: 0, ajustements: 0, variation: 0 })
  })

  test('à partir d\'octobre 2026 : formule normale, le négatif compte', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09', '2026-10'], fournisseurs,
      transactions: [tx('coq', '2026-09-20', -100000), tx('coq', '2026-10-15', 50000)],
    })
    assert.deepEqual(r.yop['2026-09'], { debut: 0, fin: 0, ajustements: 0, variation: 0 })
    assert.deepEqual(r.yop['2026-10'], { debut: -100000, fin: 50000, ajustements: 0, variation: 150000 })
  })

  test('octobre 2026 et après : les corrections du manager ne comptent pas', () => {
    // Lavage, 10/10/2026 : remise à 0 d'une avance oubliée (facture 236 000), puis vraie dette.
    const r = creditFournisseursParRestoMois({
      mois: ['2026-10'], fournisseurs,
      transactions: [
        tx('albert', '2026-09-30', -236000),
        tx('albert', '2026-10-10', 0, { point_id: null, source: 'ajustement_manager', facture: 236000, paye: 0 }),
        tx('albert', '2026-10-12', 10000, { facture: 10000, paye: 0 }),
      ],
    })
    assert.deepEqual(r.kms['2026-10'], { debut: -236000, fin: 10000, ajustements: 236000, variation: 10000 })
  })

  test('avant octobre 2026 : correction déjà neutralisée par les négatifs à 0, pas retirée deux fois', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [
        tx('albert', '2026-08-31', -100000),
        tx('albert', '2026-09-15', 0, { point_id: null, source: 'ajustement_manager', facture: 100000, paye: 0 }),
      ],
    })
    assert.deepEqual(r.kms['2026-09'], { debut: 0, fin: 0, ajustements: 0, variation: 0 })
  })

  test('négatif d\'un fournisseur ne réduit pas la dette d\'un autre (anciens mois)', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('albert', '2026-08-31', 300000), tx('ibrahim', '2026-08-31', -500000)],
    })
    assert.equal(r.kms['2026-09'].debut, 300000)
  })

  test('cotisation écartée', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [tx('cotis', '2026-08-31', -1000000), tx('cotis', '2026-09-30', 0)],
    })
    assert.equal(r.kms, undefined)
  })

  test('même jour : le gérant caissier passe après le caissier, hors journée en tête', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-09'], fournisseurs,
      transactions: [
        tx('albert', '2026-09-30', 900000, { saisi_par: 'gerant_caissier', created_at: '2026-10-01T08:00:00Z' }),
        tx('albert', '2026-09-30', 700000, { saisi_par: 'caissier', created_at: '2026-10-01T09:00:00Z' }),
        tx('albert', '2026-09-30', 650000, { point_id: null, saisi_par: 'tresorerie', created_at: '2026-10-01T10:00:00Z' }),
      ],
    })
    assert.equal(r.kms['2026-09'].fin, 900000)
  })

  test('plusieurs mois : la fin d\'un mois est le début du suivant', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-08', '2026-09'], fournisseurs,
      transactions: [tx('albert', '2026-07-31', 100000), tx('albert', '2026-08-31', 250000), tx('albert', '2026-09-01', 200000)],
    })
    assert.deepEqual(r.kms['2026-08'], { debut: 100000, fin: 250000, ajustements: 0, variation: 150000 })
    assert.deepEqual(r.kms['2026-09'], { debut: 250000, fin: 200000, ajustements: 0, variation: -50000 })
  })

  test('décembre → janvier', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-12'], fournisseurs,
      transactions: [tx('albert', '2026-11-30', -20000), tx('albert', '2026-12-31', 50000), tx('albert', '2027-01-01', 0)],
    })
    assert.deepEqual(r.kms['2026-12'], { debut: -20000, fin: 50000, ajustements: 0, variation: 70000 })
  })
})

describe('fournisseurs administratifs : seul le paiement est une charge', () => {
  const four = [
    { id: 'tee', restaurant_id: 'kms', nom: 'TEE', type: 'administratif', administratif_depuis: '2026-11-01' },
  ]
  test('échéance automatique non payée : pas une charge (écarté, avant comme après la bascule)', () => {
    const transactions = [
      tx('tee', '2026-10-10', 50000),
      { fournisseur_id: 'tee', date_point: '2026-11-01', reste: 75000, facture: 25000, paye: 0, point_id: null,
        saisi_par: 'mensuel', source: 'facture_mensuelle', created_at: '2026-11-01T06:00:00Z' },
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-10', '2026-11'], fournisseurs: four, transactions })
    assert.equal(r.kms, undefined)
  })
  test('montant dû ajouté par le RH, retard de départ : pas une charge', () => {
    const transactions = [
      { fournisseur_id: 'tee', date_point: '2026-11-02', reste: 400000, facture: 400000, paye: 0, point_id: null,
        saisi_par: 'manager', source: 'ajustement_manager', created_at: '2026-11-02T08:00:00Z' },
      { fournisseur_id: 'tee', date_point: '2026-11-05', reste: 430000, facture: 30000, paye: 0, point_id: null,
        saisi_par: 'rh', source: 'montant_du_admin', created_at: '2026-11-05T09:00:00Z' },
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-11'], fournisseurs: four, transactions })
    assert.equal(r.kms, undefined)
  })
  test('payé par le gérant : la baisse du crédit ne remonte pas le résultat (la sortie de caisse suffit)', () => {
    const transactions = [
      tx('tee', '2026-11-03', 400000),
      tx('tee', '2026-11-20', 375000, { facture: 0, paye: 25000 }),
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-11'], fournisseurs: four, transactions })
    assert.equal(r.kms, undefined)
  })
  test('un ODP jusque-là compté le reste pour les mois d’avant sa bascule', () => {
    const odp = [{ id: 'odp', restaurant_id: 'kms', nom: 'ODP', type: 'administratif', administratif_depuis: '2026-11-01' }]
    const transactions = [tx('odp', '2026-10-05', 1000), tx('odp', '2026-11-05', 3000)]
    const r = creditFournisseursParRestoMois({ mois: ['2026-10', '2026-11'], fournisseurs: odp, transactions })
    assert.equal(r.kms['2026-10'].variation, 1000)
    assert.equal(r.kms['2026-11'], undefined)
  })
  test('administratif sans date de bascule : jamais compté', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-10'], fournisseurs: [{ id: 'odp', restaurant_id: 'kms', nom: 'ODP', type: 'administratif' }],
      transactions: [tx('odp', '2026-10-05', 1000)],
    })
    assert.equal(r.kms, undefined)
  })
})

describe('droits des anciens travailleurs', () => {
  const four = [
    { id: 'awa', restaurant_id: 'lav', nom: 'Awa Koné', type: 'administratif', administratif_depuis: '2026-10-01', depart_le: '2026-10-03' },
    { id: 'odp', restaurant_id: 'lav', nom: 'ODP', type: 'fournisseur' },
  ]
  test('ni le montant dû ni ses paiements ne bougent la variation (la sortie de caisse suffit)', () => {
    const transactions = [
      { fournisseur_id: 'awa', date_point: '2026-10-03', reste: 300000, facture: 300000, paye: 0, point_id: null,
        saisi_par: 'manager', source: 'ajustement_manager', created_at: '2026-10-03T08:00:00Z' },
      { fournisseur_id: 'awa', date_point: '2026-10-10', reste: 200000, facture: 0, paye: 100000, point_id: 'p1',
        saisi_par: 'gerant', source: null, created_at: '2026-10-10T20:00:00Z' },
      { fournisseur_id: 'odp', date_point: '2026-10-05', reste: 1000, facture: 1000, paye: 0, point_id: 'p0',
        saisi_par: 'gerant', source: null, created_at: '2026-10-05T20:00:00Z' },
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-10'], fournisseurs: four, transactions })
    assert.deepEqual(r.lav['2026-10'], { debut: 0, fin: 1000, ajustements: 0, variation: 1000 })
  })
})
