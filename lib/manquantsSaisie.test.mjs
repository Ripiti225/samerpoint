// Tests de lib/manquantsSaisie.js — « Il manque » et barre payé / dû des écrans gérant.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  manquantsDeductions, manquantsVentes, photosManquantesVentes, progressionFournisseur, resumeDeductions,
} from './manquantsSaisie.js'

const PHOTO = 'https://x.supabase.co/storage/v1/object/public/photos/a.jpg'

describe('manquantsDeductions', () => {
  test('facture sans photo → bloquant, avec le nom du fournisseur', () => {
    const r = manquantsDeductions({ f1: { nom: 'SOTRA', montant_facture: '5000' } })
    assert.deepEqual(r, [{ cle: 'photo_f1', texte: 'photo facture SOTRA', bloquant: true }])
  })
  test('facture avec photo, ou simple paiement de dette → rien', () => {
    assert.deepEqual(manquantsDeductions({ f1: { montant_facture: '5000', photoUri: PHOTO }, f2: { paye: '3000' } }), [])
  })
  test('nom repris de la liste quand la saisie ne l’a pas', () => {
    const r = manquantsDeductions({ f1: { montant_facture: '100' } }, id => (id === 'f1' ? 'Boulangerie' : 'Fournisseur'))
    assert.equal(r[0].texte, 'photo facture Boulangerie')
  })
})

describe('progressionFournisseur', () => {
  test('dette partiellement payée', () => {
    assert.deepEqual(
      progressionFournisseur({ creditVeille: 100000, facture: '20000', paye: '45000' }),
      { du: 120000, paye: 45000, reste: 75000, ratio: 0.375, solde: false },
    )
  })
  test('payé au-delà du dû → soldé, ratio plafonné', () => {
    const r = progressionFournisseur({ creditVeille: 8000, facture: 0, paye: '10000' })
    assert.equal(r.ratio, 1)
    assert.equal(r.solde, true)
    assert.equal(r.reste, -2000)
  })
  test('avance de la veille (dû ≤ 0) → soldé', () => {
    const r = progressionFournisseur({ creditVeille: -5000, facture: '', paye: '' })
    assert.equal(r.ratio, 1)
    assert.equal(r.solde, true)
  })
})

describe('resumeDeductions', () => {
  test('compte et additionne chaque onglet', () => {
    const r = resumeDeductions(
      { Marché: [{ montant: '8000' }, { montant: '4000' }], Fruits: [] },
      { f1: { paye: '45000', montant_facture: '0' }, f2: { montant_facture: '1000' }, f3: {} },
      [{ montant: '20000' }],
    )
    assert.deepEqual(r, { fournisseurs: { n: 2, total: 45000 }, depenses: { n: 2, total: 12000 }, paies: { n: 1, total: 20000 } })
  })
})

describe('photosManquantesVentes', () => {
  test('TAB avec montant et sans photo, vente machine saisie à la main', () => {
    assert.deepEqual(
      photosManquantesVentes({ ventesJour: { yangoTab: '85000', glovoTab: '0', venteMachine: '400000' }, voitMachine: true }),
      ['Yango TAB', 'Photo vente machine'],
    )
  })
  test('vente machine venue du POS → pas de photo demandée', () => {
    assert.deepEqual(photosManquantesVentes({ ventesJour: { venteMachine: '400000' }, venteMachineDuSysteme: true, voitMachine: true }), [])
  })
})

describe('manquantsVentes', () => {
  const base = { cumulShifts: { venteTotal: 412500 }, venteMachineRecue: true, voitMachine: true }
  test('écart sans explication ni responsable → deux bloquants, dans l’ordre du contrôle', () => {
    const r = manquantsVentes({ ...base, ventesJour: { venteMachine: '410000', photoVenteMachine: PHOTO } })
    assert.deepEqual(r.map(m => [m.cle, m.bloquant, m.etape]), [['explication', true, 3], ['responsable', true, 3]])
    assert.equal(r[0].alerte.titre, 'Explication requise')
    assert.match(r[1].alerte.message, /surplus/)
  })
  test('responsable à 0 → montant manquant', () => {
    const r = manquantsVentes({ ...base, ventesJour: {
      venteMachine: '415000', photoVenteMachine: PHOTO, explicacionEcartMachine: 'erreur de rendu monnaie',
      ecartResponsables: [{ travailleur_id: 'a', montant: '' }],
    } })
    assert.deepEqual(r.map(m => m.cle), ['montant_responsable'])
  })
  test('répartition incomplète puis complète', () => {
    const vj = { venteMachine: '415000', photoVenteMachine: PHOTO, explicacionEcartMachine: 'erreur de rendu monnaie' }
    const incomplete = manquantsVentes({ ...base, ventesJour: { ...vj, ecartResponsables: [{ travailleur_id: 'a', montant: '1000' }] } })
    assert.deepEqual(incomplete.map(m => m.cle), ['repartition'])
    assert.match(incomplete[0].alerte.message, /manquant/)
    assert.deepEqual(manquantsVentes({ ...base, ventesJour: { ...vj, ecartResponsables: [{ travailleur_id: 'a', montant: '2500' }] } }), [])
  })
  test('site POS : rien n’est redemandé', () => {
    assert.deepEqual(manquantsVentes({ ...base, venteMachineDuSysteme: true, ventesJour: { venteMachine: '410000' } }), [])
  })
  test('manager : jamais bloqué', () => {
    assert.deepEqual(manquantsVentes({ ...base, isManager: true, ventesJour: { venteMachine: '410000', yangoTab: '5000' } }), [])
  })
  test('photo TAB manquante → non bloquante, étape 1', () => {
    const r = manquantsVentes({ ...base, ventesJour: { yangoTab: '5000', venteMachine: '412500', photoVenteMachine: PHOTO } })
    assert.deepEqual(r, [{ cle: 'photo_yango', etape: 1, texte: 'photo Yango TAB', bloquant: false }])
  })
})
