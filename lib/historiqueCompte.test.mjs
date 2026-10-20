// Tests de lib/historiqueCompte.js — l'historique affiché en touchant un
// compte dans Trésorerie → Banque et espèces.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { historiqueCompte, resumeMois } from './historiqueCompte.js'

const MVTS = [
  { id: 'a', date: '2026-10-18', montant: 300000 },
  { id: 'b', date: '2026-10-17', montant: -120000 },
  { id: 'c', date: '2026-10-18', montant: -50000 },
  { id: 'd', date: '2026-09-30', montant: 1000000 },
]

describe('historiqueCompte', () => {
  test('solde après chaque mouvement, du plus récent au plus ancien', () => {
    const jours = historiqueCompte(MVTS)
    assert.deepEqual(jours.map(j => j.date), ['2026-10-18', '2026-10-17', '2026-09-30'])
    const lignes = jours.flatMap(j => j.lignes)
    assert.deepEqual(lignes.map(l => [l.id, l.soldeApres]), [
      ['a', 1130000], ['c', 830000], ['b', 880000], ['d', 1000000],
    ])
  })

  test('le filtre ne fausse pas les soldes', () => {
    const sorties = historiqueCompte(MVTS, 'sorties').flatMap(j => j.lignes)
    assert.deepEqual(sorties.map(l => [l.id, l.soldeApres]), [['c', 830000], ['b', 880000]])
    const entrees = historiqueCompte(MVTS, 'entrees').flatMap(j => j.lignes)
    assert.deepEqual(entrees.map(l => l.id), ['a', 'd'])
  })

  test('compte vide', () => {
    assert.deepEqual(historiqueCompte([]), [])
    assert.deepEqual(historiqueCompte(null), [])
  })
})

test('resumeMois : entrées et sorties du mois seulement', () => {
  assert.deepEqual(resumeMois(MVTS, '2026-10'), { entrees: 300000, sorties: 170000 })
  assert.deepEqual(resumeMois(MVTS, '2026-11'), { entrees: 0, sorties: 0 })
})
