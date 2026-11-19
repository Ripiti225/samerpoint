// Tests de lib/journalCaisse.js — écritures SYSCOHADA d'une journée de restaurant.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPTES } from './comptesSyscohada.js'
import { controleJournal, ecrituresJournee, journalDuMois, nomFichierJournal } from './journalCaisse.js'

const RESTO = { nom: 'Al Kayan KMS', court: 'KMS' }
const somme = (lignes, cle) => lignes.reduce((s, l) => s + l[cle], 0)
const auCompte = (lignes, cle, sens) => lignes
  .filter(l => l.compte === COMPTES[cle].compte)
  .reduce((s, l) => s + l[sens], 0)

// Journée réelle : Al Kayan KMS, 10/10/2026 (lue en lecture seule le 19/11/2026).
const KMS_1010 = {
  point: { id: 'p1', date: '2026-10-10', vente_total: 422000, vente_machine: 429000, yango_tab: 31000, glovo_tab: 37000, samer_delly_tab: null, source: null },
  shifts: [
    { vente_shift: 85000, espece: 52000, om: 0, wave: 3500, djamo: 0, yango_cse: 8000, glovo_cse: 14000, kdo: 2000, points_fidelite: 0, retour: 0, fournisseurs: 0, depenses: 5500 },
    { vente_shift: 337000, espece: 246500, om: 0, wave: 7000, djamo: 0, yango_cse: 18000, glovo_cse: 20000, kdo: 7000, points_fidelite: 0, retour: 0, fournisseurs: 0, depenses: 38500 },
  ],
  depensesCaissier: [
    ...[1000, 1000, 500, 1800, 700, 500, 1000, 1000, 6000, 500, 1500, 1000, 2000, 1500, 17000].map(montant => ({ categorie: 'Marché', montant })),
    { categorie: 'Dépenses annexes', montant: 7000 },
  ],
  deductionsGerant: [
    ...[30000, 21000, 10000, 18000, 40000, 35000, 20000, 50000, 35000, 20000].map(montant => ({ categorie: 'Marché', montant })),
    ...[30800, 90000, 5000, 31500, 114600, 70000, 30000, 10000, 7500, 30500, 25000, 60000, 33500].map(montant => ({ categorie: 'Fournisseur', montant })),
    ...[4000, 4500, 3500, 6000, 6000, 15000, 1000, 1000].map(montant => ({ categorie: 'Paie', montant })),
  ],
  factures: [
    { fournisseur_nom: 'Super marché ', facture: 15800 }, { fournisseur_nom: 'CIE', facture: 25000 },
    { fournisseur_nom: 'Baraka', facture: 5000 }, { fournisseur_nom: 'Coq ivoire ', facture: 42000 },
    { fournisseur_nom: 'Ibrahim', facture: 33500 }, { fournisseur_nom: 'Diakite', facture: 7600 },
  ],
  restaurant: RESTO,
}

test('journée réelle KMS 10/10 : équilibrée, chaque montant à sa place', () => {
  const { lignes, exclue, ecart } = ecrituresJournee(KMS_1010)
  assert.equal(exclue, false)
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
  assert.equal(auCompte(lignes, 'ventesCaisse', 'credit'), 429000)
  assert.equal(auCompte(lignes, 'ventesLivraison', 'credit'), 68000)
  assert.equal(auCompte(lignes, 'yango', 'debit'), 31000)
  assert.equal(auCompte(lignes, 'glovo', 'debit'), 37000)
  assert.equal(auCompte(lignes, 'wave', 'debit'), 10500)
  assert.equal(auCompte(lignes, 'cadeaux', 'debit'), 9000)
  // Caisse : espèces + Yango/Glovo espèces entrent ; la caisse gérant sort.
  assert.equal(auCompte(lignes, 'caisse', 'debit'), 298500 + 26000 + 34000)
  assert.equal(auCompte(lignes, 'caisse', 'credit'), 858400)
  // Machine 429 000, caisse justifiée 422 000 : manque de 7 000 (sens de l'app : négatif).
  assert.equal(ecart, -7000)
  assert.equal(auCompte(lignes, 'ecartManque', 'debit'), 7000)
  // Achats : marché caissier + marché gérant + factures alimentaires.
  assert.equal(auCompte(lignes, 'achats', 'debit'), 37000 + 279000 + 103900)
  // Autres achats : dépenses annexes caissier + facture CIE (non alimentaire).
  assert.equal(auCompte(lignes, 'autresAchats', 'debit'), 7000 + 25000)
  assert.equal(auCompte(lignes, 'personnel', 'debit'), 41000)
  // Fournisseurs : payés par le gérant au débit, factures au crédit.
  assert.equal(auCompte(lignes, 'fournisseurs', 'debit'), 538400)
  assert.equal(auCompte(lignes, 'fournisseurs', 'credit'), 128900)
  // Chaque ligne porte journal, pièce et restaurant.
  for (const l of lignes) {
    assert.equal(l.journal, 'CA')
    assert.equal(l.piece, 'CA-KMS-20261010')
    assert.equal(l.restaurant, 'Al Kayan KMS')
    assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit))
    assert.ok((l.debit > 0) !== (l.credit > 0), 'une ligne est soit au débit soit au crédit')
  }
})

const jour = (pointPlus = {}, shiftPlus = {}) => ({
  point: { id: 'p', date: '2026-10-05', vente_total: 100000, vente_machine: 100000, ...pointPlus },
  shifts: [{ vente_shift: 100000, espece: 100000, ...shiftPlus }],
  depensesCaissier: [], deductionsGerant: [], factures: [], restaurant: RESTO,
})

test('surplus de caisse : vente machine sous la vente théorique', () => {
  const { lignes, ecart } = ecrituresJournee(jour({ vente_machine: 98500 }))
  assert.equal(ecart, 1500)
  assert.equal(auCompte(lignes, 'ecartSurplus', 'credit'), 1500)
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
})

test('sans vente machine : la vente théorique est retenue, pas d’écart', () => {
  const { lignes, ecart } = ecrituresJournee(jour({ vente_machine: null }))
  assert.equal(ecart, 0)
  assert.equal(auCompte(lignes, 'ventesCaisse', 'credit'), 100000)
})

test('salaires du caissier : reste de la vente du shift après encaissements et dépenses détaillées', () => {
  const j = jour({}, { espece: 80000, depenses: 0 })
  j.depensesCaissier = [{ categorie: 'Marché', montant: 5000 }]
  const { lignes } = ecrituresJournee(j)
  assert.equal(auCompte(lignes, 'achats', 'debit'), 5000)
  assert.equal(auCompte(lignes, 'personnel', 'debit'), 15000)
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
})

test('points fidélité et retours en remises, Samer Delly tablette en client plateforme', () => {
  const { lignes } = ecrituresJournee(jour({ samer_delly_tab: 12000 }, { espece: 90000, points_fidelite: 6000, retour: 4000 }))
  assert.equal(auCompte(lignes, 'remises', 'debit'), 10000)
  assert.equal(auCompte(lignes, 'samerDelly', 'debit'), 12000)
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
})

test('montant négatif : la ligne passe de l’autre côté', () => {
  const j = jour()
  j.factures = [{ fournisseur_nom: 'Baraka', facture: -3000 }]
  const { lignes } = ecrituresJournee(j)
  assert.equal(auCompte(lignes, 'achats', 'credit'), 3000)
  assert.equal(auCompte(lignes, 'fournisseurs', 'debit'), 3000)
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
})

test('montants à virgule : arrondis au franc, la pièce reste équilibrée', () => {
  const { lignes } = ecrituresJournee(jour({ vente_total: 100000.4, vente_machine: 100000.6 }, { vente_shift: 100000.4, espece: 99999.7 }))
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
  for (const l of lignes) assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit))
})

test('journée importée des anciens Sheets ou sans shift : exclue', () => {
  assert.equal(ecrituresJournee(jour({ source: 'import_sheets_2026_10' })).exclue, true)
  const sansShift = { ...jour(), shifts: [] }
  assert.deepEqual(ecrituresJournee(sansShift).lignes, [])
  assert.equal(ecrituresJournee(sansShift).exclue, true)
})

test('contrôle : totaux par restaurant et pour le groupe', () => {
  const a = ecrituresJournee(KMS_1010).lignes
  const b = ecrituresJournee({ ...jour(), restaurant: { nom: 'Samer Yop', court: 'Yop' } }).lignes
  const c = controleJournal([...a, ...b])
  assert.equal(c.parRestaurant['Al Kayan KMS'].difference, 0)
  assert.equal(c.parRestaurant['Samer Yop'].debit, 100000)
  assert.equal(c.groupe.debit, c.groupe.credit)
  assert.equal(c.groupe.difference, 0)
})

test('mois entier : journées triées, journée importée exclue et comptée, non vérifiée comptée', () => {
  const restaurants = [{ id: 'k', nom: 'Al Kayan KMS ' }, { id: 'y', nom: 'Samer Yop' }]
  const points = [
    { ...KMS_1010.point, id: 'k10', restaurant_id: 'k', valide: true, verifie: false },
    { id: 'y05', restaurant_id: 'y', date: '2026-10-05', vente_total: 1000, vente_machine: 1000, valide: true, verifie: true },
    { id: 'y01', restaurant_id: 'y', date: '2026-10-01', vente_total: 9, source: 'import_sheets_2026_10', valide: true, verifie: true },
  ]
  const m = (o) => new Map(Object.entries(o))
  const { lignes, parResto } = journalDuMois({
    restaurants, points,
    shifts: m({ k10: KMS_1010.shifts, y05: [{ vente_shift: 1000, espece: 1000 }] }),
    depensesCaissier: m({ k10: KMS_1010.depensesCaissier }),
    deductionsGerant: m({ k10: KMS_1010.deductionsGerant }),
    factures: m({ k10: KMS_1010.factures }),
  })
  assert.deepEqual([...new Set(lignes.map(l => l.piece))], ['CA-Yop-20261005', 'CA-KMS-20261010'])
  assert.equal(lignes.find(l => l.piece === 'CA-KMS-20261010').restaurant, 'Al Kayan KMS')
  assert.deepEqual(parResto['Samer Yop'], { journees: 1, exclues: 1, nonVerifiees: 0, ecarts: 0 })
  assert.deepEqual(parResto['Al Kayan KMS'], { journees: 1, exclues: 0, nonVerifiees: 1, ecarts: -7000 })
  assert.equal(controleJournal(lignes).groupe.difference, 0)
})

test('nom du fichier : mois, restaurant court, PROVISOIRE', () => {
  assert.equal(nomFichierJournal('2026-10', null, false), 'Journal-caisse-2026-10.xlsx')
  assert.equal(nomFichierJournal('2026-11', 'Samer Angré 7E', true), 'Journal-caisse-2026-11-Angré7E-PROVISOIRE.xlsx')
})
