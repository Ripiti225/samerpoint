// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/previsions.js — prévisions de paiement de la Trésorerie.
//
// Ce qui justifie ce fichier : le total prévu est soustrait de la trésorerie
// nette réelle. Une prévision comptée deux fois, ou encore comptée après le
// paiement, fausse le chiffre que M. Zreik regarde pour décider de payer.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { etatPrevision, totalPrevu, trierPrevisions } from './previsions.js'

const du = { id: 'loyer', montant_du: 1000000 }
const prev = (id, extra = {}) => ({ id, du_id: 'loyer', montant: 500000, created_at: '2026-10-02T10:00:00Z', ...extra })

describe('état d\'une prévision', () => {
  test('à une date : prévue avant, orange le jour même et après', () => {
    const p = prev('a', { date_prevue: '2026-10-15' })
    assert.equal(etatPrevision(p, { du, paiementsDu: [], receptions: [], aujourdhui: '2026-10-14' }).statut, 'prevue')
    const jour = etatPrevision(p, { du, paiementsDu: [], receptions: [], aujourdhui: '2026-10-15' })
    assert.equal(jour.statut, 'a_payer')
    assert.equal(jour.message, 'Prévu aujourd\'hui : à payer')
    assert.equal(etatPrevision(p, { du, paiementsDu: [], receptions: [], aujourdhui: '2026-10-17' }).message,
      'Prévu le 15/10/2026, pas encore payé')
  })

  test('à la prochaine réception Glovo : seulement une réception marquée après la prévision', () => {
    const p = prev('g', { partenaire: 'glovo' })
    const avant = { partenaire: 'glovo', type: 'recu', created_at: '2026-10-01T08:00:00Z' }
    const apres = { partenaire: 'glovo', type: 'recu', created_at: '2026-10-03T08:00:00Z' }
    const wave = { partenaire: 'wave', type: 'recu', created_at: '2026-10-03T08:00:00Z' }
    assert.equal(etatPrevision(p, { du, paiementsDu: [], receptions: [avant, wave], aujourdhui: '2026-10-04' }).statut, 'prevue')
    const e = etatPrevision(p, { du, paiementsDu: [], receptions: [avant, apres], aujourdhui: '2026-10-04' })
    assert.equal(e.statut, 'a_payer')
    assert.equal(e.message, 'Glovo reçu : à payer')
  })

  test('payée en partie : le reste reste prévu', () => {
    const p = prev('a', { date_prevue: '2026-10-15' })
    const e = etatPrevision(p, { du, paiementsDu: [{ montant: 300000, prevision_id: 'a' }], receptions: [], aujourdhui: '2026-10-15' })
    assert.equal(e.realise, 300000)
    assert.equal(e.reste, 200000)
    assert.equal(e.statut, 'a_payer')
  })

  test('payée en entier, ou ligne soldée autrement : réalisée', () => {
    const p = prev('a', { date_prevue: '2026-10-15' })
    assert.equal(etatPrevision(p, { du, paiementsDu: [{ montant: 500000, prevision_id: 'a' }], receptions: [], aujourdhui: '2026-10-16' }).statut, 'realisee')
    assert.equal(etatPrevision(p, { du, paiementsDu: [{ montant: 1000000 }], receptions: [], aujourdhui: '2026-10-16' }).statut, 'realisee')
  })

  test('montant à payer : jamais plus que le reste de la ligne', () => {
    const p = prev('a', { date_prevue: '2026-10-15', montant: 900000 })
    const e = etatPrevision(p, { du, paiementsDu: [{ montant: 600000 }], receptions: [], aujourdhui: '2026-10-15' })
    assert.equal(e.aPayer, 400000)
  })
})

describe('total prévu', () => {
  test('les prévisions ouvertes, sans dépasser le reste de chaque ligne', () => {
    const previsions = [prev('a', { date_prevue: '2026-10-15', montant: 700000 }), prev('b', { partenaire: 'glovo', montant: 600000 })]
    assert.equal(totalPrevu(previsions, [du], [], [], '2026-10-02'), 1000000)
  })
  test('ce qui est déjà payé ne compte plus', () => {
    const previsions = [prev('a', { date_prevue: '2026-10-15' })]
    assert.equal(totalPrevu(previsions, [du], [{ du_id: 'loyer', montant: 200000, prevision_id: 'a' }], [], '2026-10-02'), 300000)
  })
  test('une prévision sur une ligne disparue ne compte pas', () => {
    assert.equal(totalPrevu([prev('a', { date_prevue: '2026-10-15' })], [], [], [], '2026-10-02'), 0)
  })
})

describe('ordre des prévisions', () => {
  test('orange d\'abord, puis par date (les réceptions à la fin)', () => {
    const lignes = [
      { prevision: prev('r', { partenaire: 'wave' }), etat: { statut: 'prevue' } },
      { prevision: prev('d2', { date_prevue: '2026-10-20' }), etat: { statut: 'prevue' } },
      { prevision: prev('d1', { date_prevue: '2026-10-10' }), etat: { statut: 'prevue' } },
      { prevision: prev('o', { date_prevue: '2026-10-25' }), etat: { statut: 'a_payer' } },
    ]
    assert.deepEqual(trierPrevisions(lignes).map(l => l.prevision.id), ['o', 'd1', 'd2', 'r'])
  })
})
