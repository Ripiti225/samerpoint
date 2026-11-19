// Tests de lib/rapportDirection.js — rapport des dépenses direction par période.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { htmlRapportDirection, rapportDepensesDirection } from './rapportDirection.js'

const noms = { z: 'Zabad', k: 'Koumassi' }
const nomResto = id => (id ? noms[id] : 'Groupe')
const deps = [
  { id: 1, categorie: 'fond', restaurant_id: 'z', date: '2026-11-03', montant: 200000 },
  { id: 2, categorie: 'fond', restaurant_id: 'z', date: '2026-11-03', montant: 50000 },
  { id: 3, categorie: 'fond', restaurant_id: 'z', date: '2026-11-10', montant: 150000 },
  { id: 4, categorie: 'fond', restaurant_id: 'z', date: '2026-11-12', montant: -30000, origine_id: 3 },
  { id: 5, categorie: 'reparation', restaurant_id: 'k', date: '2026-11-05', montant: 80000 },
  { id: 6, categorie: 'retrait_perso', restaurant_id: null, date: '2026-11-06', montant: 100000 },
  { id: 7, categorie: 'fond', restaurant_id: 'z', date: '2026-10-31', montant: 999999 },
  { id: 8, categorie: 'fond', restaurant_id: 'z', date: '2026-12-01', montant: 999999 },
]

test('regroupe les dépenses identiques, jours additionnés et triés', () => {
  const r = rapportDepensesDirection(deps, { debut: '2026-11-01', fin: '2026-11-30' }, nomResto)
  assert.equal(r.groupes[0].titre, 'Fond · Zabad')
  assert.equal(r.groupes[0].total, 370000)
  assert.equal(r.groupes[0].nb, 4)
  assert.deepEqual(r.groupes[0].jours, [
    { date: '2026-11-03', montant: 250000 },
    { date: '2026-11-10', montant: 150000 },
    { date: '2026-11-12', montant: -30000 },
  ])
  assert.deepEqual(r.groupes.map(g => g.titre), ['Fond · Zabad', 'Retrait perso · Groupe', 'Réparation · Koumassi'])
  assert.equal(r.total, 550000)
  assert.equal(r.nb, 6)
})

test('bornes incluses, période vide', () => {
  const r = rapportDepensesDirection(deps, { debut: '2026-10-31', fin: '2026-10-31' }, nomResto)
  assert.equal(r.total, 999999)
  const vide = rapportDepensesDirection(deps, { debut: '2025-01-01', fin: '2025-01-31' }, nomResto)
  assert.deepEqual(vide, { groupes: [], total: 0, nb: 0 })
})

test('HTML : titres échappés, total et nom en bas', () => {
  const r = rapportDepensesDirection([{ categorie: 'fond', restaurant_id: 'x', date: '2026-11-03', montant: 1000 }],
    { debut: '2026-11-01', fin: '2026-11-30' }, () => '<b>')
  const html = htmlRapportDirection(r, { debut: '2026-11-01', fin: '2026-11-30', auteur: 'Ali' })
  assert.ok(html.includes('Fond · &lt;b&gt;'))
  assert.ok(html.includes('03/11/2026'))
  assert.ok(html.includes('Tiré par Ali'))
  assert.ok(html.includes('Du 01/11/2026 au 30/11/2026'))
})
