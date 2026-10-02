// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/rappelsTresorerie.js — rappels de 9 h et relances de 14 h.
//
// Ce qui justifie ce fichier : une relance envoyée pour une charge déjà payée,
// ou un rappel oublié le dernier jour, fait perdre confiance dans les alertes.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { destinatairesRappels, elementsDuJour, messagePour } from './rappelsTresorerie.js'

const nomResto = id => ({ lav: 'Samer Lavage', kms: 'Al Kayan KMS', pal: 'Samer Palmeraie' }[id] || 'Groupe')
const AUJ = '2026-10-05'
const loyerLav = { id: 'l1', categorie: 'loyer', restaurant_id: 'lav', mois: '2026-09-01', echeance: AUJ, montant_du: 500000 }
const salKms = { id: 's1', categorie: 'salaire', restaurant_id: 'kms', mois: '2026-09-01', echeance: '2026-10-10', montant_du: 1700000 }
const base = { aujourdhui: AUJ, dus: [loyerLav, salKms], paiements: [], previsions: [], receptions: [], emprunts: [], nomResto }

describe('éléments du jour', () => {
  test('9 h : les charges dont c\'est le dernier jour et qui ne sont pas soldées', () => {
    const e = elementsDuJour({ ...base, moment: 'matin' })
    assert.deepEqual(e.map(x => x.type), ['echeance'])
    assert.equal(e[0].texte, 'Loyer Samer Lavage (sept.) : 500 000 F, dernier jour')
  })

  test('une charge soldée n\'est pas signalée', () => {
    const e = elementsDuJour({ ...base, moment: 'matin', paiements: [{ du_id: 'l1', montant: 500000, date: '2026-10-03' }] })
    assert.deepEqual(e, [])
  })

  test('9 h : signalée même si une prévision existe ; 14 h : plus relancée', () => {
    const previsions = [{ id: 'p', du_id: 'l1', montant: 500000, date_prevue: '2026-10-20', created_at: '2026-10-04T10:00:00Z' }]
    assert.equal(elementsDuJour({ ...base, moment: 'matin', previsions }).length, 1)
    assert.equal(elementsDuJour({ ...base, moment: 'apres_midi', previsions }).length, 0)
  })

  test('14 h : plus relancée si un paiement a été fait aujourd\'hui, même partiel', () => {
    const paiements = [{ du_id: 'l1', montant: 100000, date: AUJ }]
    assert.equal(elementsDuJour({ ...base, moment: 'apres_midi', paiements }).length, 0)
  })

  test('14 h : relancée si rien n\'a bougé', () => {
    assert.equal(elementsDuJour({ ...base, moment: 'apres_midi' }).length, 1)
  })

  test('prévision passée « à payer » (réception Glovo marquée)', () => {
    const previsions = [{ id: 'p', du_id: 's1', montant: 1000000, partenaire: 'glovo', created_at: '2026-10-04T10:00:00Z' }]
    const receptions = [{ partenaire: 'glovo', type: 'recu', created_at: '2026-10-05T08:00:00Z' }]
    const e = elementsDuJour({ ...base, moment: 'matin', previsions, receptions })
    const p = e.find(x => x.type === 'prevision')
    assert.equal(p.texte, 'Glovo reçu : Salaires Al Kayan KMS (sept.) 1 000 000 F')
  })

  test('emprunt au coffre à rembourser', () => {
    const emprunts = [{ id: 'e', montant: 300000, rembourser_le: AUJ, created_at: '2026-10-01T10:00:00Z' }]
    const e = elementsDuJour({ ...base, dus: [], moment: 'matin', emprunts })
    assert.deepEqual(e.map(x => [x.type, x.texte]), [['emprunt', 'Rembourser 300 000 F au coffre']])
  })
})

describe('destinataires et messages', () => {
  const utilisateurs = [
    { id: 'zreik', nom: 'M. Zreik', role: 'manager', actif: true },
    { id: 'autre', nom: 'Autre manager', role: 'manager', actif: true },
    { id: 'adou', nom: 'RH', role: 'rh', actif: true },
    { id: 'parti', nom: 'Ancien', role: 'manager', actif: false },
    { id: 'g', nom: 'Gérant', role: 'gerant', actif: true },
  ]
  const droits = [{ user_id: 'zreik', niveau: 'proprietaire' }]

  test('comptes actifs ayant un niveau de trésorerie', () => {
    assert.deepEqual(destinatairesRappels({ utilisateurs, droits }).map(d => [d.id, d.niveau]),
      [['zreik', 'proprietaire'], ['autre', 'lecture'], ['adou', 'saisie_rh']])
  })

  const elements = [
    { type: 'echeance', texte: 'Loyer A' },
    { type: 'prevision', texte: 'Glovo reçu : B' },
    { type: 'emprunt', texte: 'Rembourser C au coffre' },
  ]
  test('propriétaire : tout ; lecture : sans le coffre ; RH : ses charges seulement', () => {
    assert.equal(messagePour('proprietaire', elements, 'matin').corps.split('\n').length, 3)
    assert.equal(messagePour('lecture', elements, 'matin').corps.split('\n').length, 2)
    assert.equal(messagePour('saisie_rh', elements, 'matin').corps, 'Loyer A')
    assert.equal(messagePour('saisie_rh', [elements[2]], 'matin'), null)
  })

  test('titres du matin et de la relance', () => {
    assert.equal(messagePour('proprietaire', elements, 'matin').titre, 'Trésorerie · 3 à faire aujourd\'hui')
    assert.equal(messagePour('proprietaire', elements.slice(0, 1), 'apres_midi').titre, 'Rappel · 1 pas encore fait')
  })

  test('au-delà de 4 lignes : « … et N autres »', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ type: 'echeance', texte: `L${i}` }))
    const m = messagePour('proprietaire', six, 'matin')
    assert.equal(m.corps.split('\n').length, 5)
    assert.equal(m.corps.split('\n')[4], '… et 2 autres')
  })
})
