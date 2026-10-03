// Tests de lib/demandes.js — compteurs, filtres et recherche des demandes.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ETAPES_EXPLICATION, STATUTS_EXPLICATION, compterDemandes, compterExplications, correspond, enRetard,
  filtrerDemandes, filtrerExplications, fmtDate,
} from './demandes.js'

const demandes = [
  { statut: 'en_attente', travailleur_nom: 'Kouamé Assi', type: 'Congé annuel' },
  { statut: 'validee', travailleur_nom: 'Awa Traoré', type: 'Avance sur salaire' },
  { statut: 'validee', travailleur_nom: 'Koffi', type: 'Maladie', description: 'Paludisme' },
  { statut: 'declinee', travailleur_nom: 'Yao', type: 'Autre' },
]

describe('demandes', () => {
  test('compteurs par statut', () => {
    assert.deepEqual(compterDemandes(demandes), { null: 4, en_attente: 1, validee: 2, declinee: 1, annulee: 0 })
  })
  test('filtre statut + recherche (accents ignorés, description incluse)', () => {
    assert.equal(filtrerDemandes(demandes, { statut: 'validee' }).length, 2)
    assert.equal(filtrerDemandes(demandes, { recherche: 'kouame' }).length, 1)
    assert.equal(filtrerDemandes(demandes, { recherche: 'palu' })[0].travailleur_nom, 'Koffi')
    assert.equal(filtrerDemandes(demandes, { statut: 'declinee', recherche: 'awa' }).length, 0)
  })
})

describe('demandes d\'explication', () => {
  const maintenant = Date.parse('2026-10-03T12:00:00Z')
  const exps = [
    { statut: 'en_attente_acceptation', travailleur_nom: 'A', motif: 'Retard répété' },
    { statut: 'acceptee', travailleur_nom: 'B', motif: 'Caisse' },
    { statut: 'envoyee', travailleur_nom: 'C', envoyee_at: '2026-09-25T10:00:00Z', motif: 'x' },
    { statut: 'envoyee', travailleur_nom: 'D', envoyee_at: '2026-10-02T10:00:00Z', motif: 'x' },
    { statut: 'reponse_recuperee', travailleur_nom: 'E', motif: 'x' },
    { statut: 'relancee', travailleur_nom: 'F', motif: 'x' },
  ]

  test('chaque statut appartient à exactement une étape', () => {
    for (const s of Object.keys(STATUTS_EXPLICATION)) {
      assert.equal(ETAPES_EXPLICATION.filter(e => e.statuts?.includes(s)).length, 1, s)
    }
  })
  test('compteurs par étape et retard (> 3 jours après envoi)', () => {
    assert.deepEqual(compterExplications(exps, maintenant), {
      null: 6, retard: 1, a_accepter: 1, a_envoyer: 1, attente: 2, terminees: 2,
    })
  })
  test('retard seulement pour une demande envoyée', () => {
    assert.equal(enRetard(exps[2], maintenant), true)
    assert.equal(enRetard(exps[3], maintenant), false)
    assert.equal(enRetard({ statut: 'reponse_recuperee', envoyee_at: '2026-01-01' }, maintenant), false)
  })
  test('filtre par étape + recherche sur le motif', () => {
    assert.equal(filtrerExplications(exps, { etape: 'terminees' }).length, 2)
    assert.equal(filtrerExplications(exps, { recherche: 'repete' })[0].travailleur_nom, 'A')
    assert.equal(correspond({ travailleur_nom: 'X' }, ''), true)
  })
  test('dates', () => {
    assert.equal(fmtDate('2026-10-03T09:00:00Z'), '3 oct 2026')
    assert.equal(fmtDate(null), '')
  })
})
