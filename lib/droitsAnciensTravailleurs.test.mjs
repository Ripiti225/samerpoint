// Tests de lib/droitsAnciensTravailleurs.js — droits des anciens travailleurs.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ONGLET_ANCIENS, droitAAfficherGerant, estAncienneFicheGlobale, estDroitAncienTravailleur, paiementsDroit,
  proposerDroits, resumeDroit, resumeDroitsParResto, sousTitreDepart,
} from './droitsAnciensTravailleurs.js'

const tx = (fid, date, facture, paye, source = null, id = `${fid}-${date}-${facture}-${paye}`) =>
  ({ id, fournisseur_id: fid, date_point: date, facture, paye, source, created_at: `${date}T10:00:00Z` })

describe('reconnaître une fiche', () => {
  test('droit = depart_le rempli', () => {
    assert.equal(estDroitAncienTravailleur({ type: 'administratif', depart_le: '2026-09-12' }), true)
    assert.equal(estDroitAncienTravailleur({ type: 'administratif', depart_le: null }), false)
    assert.equal(estDroitAncienTravailleur(null), false)
  })
  test('onglet', () => assert.equal(ONGLET_ANCIENS, 'anciens_travailleurs'))
  test('proposer les droits aux CDI seulement', () => {
    assert.equal(proposerDroits({ type_contrat: 'CDI' }), true)
    for (const c of ['CDD', 'Stage', 'Journalier', null]) assert.equal(proposerDroits({ type_contrat: c }), false)
    assert.equal(proposerDroits(null), false)
  })
  test('anciennes fiches globales « ANCIEN TRAVAILLEURS » et « Salaire ancien »', () => {
    assert.equal(estAncienneFicheGlobale({ nom: ' ANCIEN TRAVAILLEURS', actif: true }), true)
    assert.equal(estAncienneFicheGlobale({ nom: 'Salaire ancien ', actif: true }), true)
    assert.equal(estAncienneFicheGlobale({ nom: ' ANCIEN TRAVAILLEURS', actif: false }), false)
    assert.equal(estAncienneFicheGlobale({ nom: 'Ancien travailleur', depart_le: '2026-09-01', actif: true }), false)
    assert.equal(estAncienneFicheGlobale({ nom: 'PALMCI', actif: true }), false)
  })
})

describe('libellés', () => {
  test('sous-titre avec et sans motif', () => {
    assert.equal(sousTitreDepart({ depart_le: '2026-09-12', depart_motif: 'Démission' }), 'parti le 12/09/2026 · Démission')
    assert.equal(sousTitreDepart({ depart_le: '2026-09-12', depart_motif: '' }), 'parti le 12/09/2026')
  })
})

describe('dû, payé, reste', () => {
  test('montant dû + paiement gérant + paiement direction', () => {
    const t = [
      tx('a', '2026-09-15', 300000, 0, 'ajustement_manager'),
      tx('a', '2026-09-20', 0, 100000, null),
      tx('a', '2026-10-01', 0, 50000, 'paiement_direction'),
    ]
    assert.deepEqual(resumeDroit(t), { du: 300000, paye: 150000, reste: 150000 })
  })
  test('payé en plusieurs fois jusqu\'au solde', () => {
    const t = [
      tx('a', '2026-09-15', 300000, 0, 'ajustement_manager'),
      tx('a', '2026-09-20', 0, 50000, null),
      tx('a', '2026-09-27', 0, 50000, null),
      tx('a', '2026-10-01', 0, 100000, 'paiement_direction'),
    ]
    assert.deepEqual(resumeDroit(t), { du: 300000, paye: 200000, reste: 100000 })
    assert.equal(paiementsDroit(t).length, 3)
    t.push(tx('a', '2026-10-15', 0, 100000, null))
    assert.deepEqual(resumeDroit(t), { du: 300000, paye: 300000, reste: 0 })
  })
  test('correction à la baisse du montant dû : pas un paiement', () => {
    const t = [tx('a', '2026-09-15', 300000, 0, 'ajustement_manager'), tx('a', '2026-09-16', 0, 50000, 'ajustement_manager')]
    assert.deepEqual(resumeDroit(t), { du: 250000, paye: 0, reste: 250000 })
  })
  test('paiements : qui a payé, plus récent d\'abord, sans les corrections', () => {
    const t = [
      tx('a', '2026-09-15', 300000, 0, 'ajustement_manager', 't1'),
      tx('a', '2026-09-20', 0, 100000, null, 't2'),
      tx('a', '2026-10-01', 0, 50000, 'paiement_direction', 't3'),
    ]
    assert.deepEqual(paiementsDroit(t), [
      { id: 't3', date: '2026-10-01', montant: 50000, par: 'Direction' },
      { id: 't2', date: '2026-09-20', montant: 100000, par: 'Gérant' },
    ])
  })
  test('regroupement par restaurant, soldé à 0, plus récent départ d\'abord', () => {
    const fiches = [
      { id: 'a', restaurant_id: 'lav', nom: 'Awa', depart_le: '2026-08-01' },
      { id: 'b', restaurant_id: 'lav', nom: 'Koné', depart_le: '2026-09-01' },
      { id: 'c', restaurant_id: 'kms', nom: 'Yao', depart_le: '2026-09-05' },
    ]
    const t = [
      tx('a', '2026-08-02', 100000, 0, 'ajustement_manager'), tx('a', '2026-08-10', 0, 100000, null),
      tx('b', '2026-09-02', 200000, 0, 'ajustement_manager'),
      tx('c', '2026-09-06', 80000, 0, 'ajustement_manager'), tx('c', '2026-09-07', 0, 30000, null),
    ]
    const r = resumeDroitsParResto(fiches, t)
    assert.deepEqual(r.lav.fiches.map(f => [f.id, f.reste, f.nbPaiements, f.solde]), [['b', 200000, 0, false], ['a', 0, 1, true]])
    assert.deepEqual([r.lav.du, r.lav.paye, r.lav.reste], [300000, 100000, 200000])
    assert.deepEqual([r.kms.du, r.kms.paye, r.kms.reste], [80000, 30000, 50000])
  })
})

describe('Déductions gérant', () => {
  test('un fournisseur normal est toujours affiché', () => {
    assert.equal(droitAAfficherGerant({ type: 'administratif' }, 0, false), true)
  })
  test('un droit soldé disparaît, sauf s\'il est déjà saisi ce jour', () => {
    const d = { type: 'administratif', depart_le: '2026-09-01' }
    assert.equal(droitAAfficherGerant(d, 50000, false), true)
    assert.equal(droitAAfficherGerant(d, 0, false), false)
    assert.equal(droitAAfficherGerant(d, 0, true), true)
  })
})
