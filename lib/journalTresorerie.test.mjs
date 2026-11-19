// Tests de lib/journalTresorerie.js — journaux BQ (mouvements) et OD (commissions, publicité).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPTES } from './comptesSyscohada.js'
import { assiettesCommissions, ecrituresCommissions, ecrituresTresorerie } from './journalTresorerie.js'

const somme = (lignes, cle) => lignes.reduce((s, l) => s + l[cle], 0)
const no = cle => COMPTES[cle].compte
const ligneDe = (lignes, cle) => lignes.filter(l => l.compte === no(cle))

const comptes = new Map([['baci', 'BACI'], ['sib', 'SIB'], ['esp', 'Espèces'], ['tdfw', 'Tête de fond Wave'], ['cs', 'Cotisation salaire'], ['x', 'Compte mystère']])
const restaurants = new Map([['k', { nom: 'Al Kayan KMS', court: 'KMS' }]])
const vide = { paiements: new Map(), partenaires: new Map(), direction: new Map() }
const mvt = (id, compte_id, montant, type, plus = {}) => ({ id, compte_id, montant, type, date: '2026-10-12', libelle: `Mvt ${id}`, ...plus })

function un(m, liens = vide) {
  const lignes = ecrituresTresorerie({ mouvements: [m], comptes, liens, restaurants })
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'), 'pièce équilibrée')
  return lignes
}

test('virement Yango reçu sur SIB : banque au débit, client Yango au crédit', () => {
  const liens = { ...vide, partenaires: new Map([['m1', { partenaire: 'yango', restaurant_id: 'k' }]]) }
  const l = un(mvt('m1', 'sib', 1500000, 'partenaire'), liens)
  assert.equal(ligneDe(l, 'sib')[0].debit, 1500000)
  assert.equal(ligneDe(l, 'yango')[0].credit, 1500000)
  assert.equal(l[0].journal, 'BQ')
  assert.equal(l[0].piece, 'BQ-20261012-m1')
  assert.equal(l[0].restaurant, 'Al Kayan KMS')
})

test('Wave reçu sur la tête de fond : passe du téléphone du restaurant à la tête de fond', () => {
  const liens = { ...vide, partenaires: new Map([['m', { partenaire: 'wave' }]]) }
  const l = un(mvt('m', 'tdfw', 80000, 'partenaire'), liens)
  assert.equal(ligneDe(l, 'tdfWave')[0].debit, 80000)
  assert.equal(ligneDe(l, 'wave')[0].credit, 80000)
  assert.equal(l[0].restaurant, 'Direction')
})

test('paiements : chaque catégorie de dû vers son compte', () => {
  const attendu = { loyer: 'locations', bail: 'droitsEnregistrement', impot: 'droitsEnregistrement', tee: 'impotsTaxes',
    its: 'itsRetenu', cnps: 'cnps', salaire: 'salairesDus', dette: 'attente', admin: 'attente', bizarre: 'attente' }
  for (const [categorie, cle] of Object.entries(attendu)) {
    const liens = { ...vide, paiements: new Map([['p', { categorie, restaurant_id: 'k' }]]) }
    const l = un(mvt('p', 'baci', -200000, 'paiement'), liens)
    assert.equal(ligneDe(l, 'baci')[0].credit, 200000, categorie)
    assert.equal(ligneDe(l, cle)[0].debit, 200000, categorie)
  }
})

test('paiement d’une « autre » charge : suit sa catégorie direction', () => {
  const liens = { ...vide, paiements: new Map([['p', { categorie: 'autre', categorie_direction: 'reparation' }]]) }
  assert.equal(ligneDe(un(mvt('p', 'esp', -50000, 'paiement'), liens), 'entretien')[0].debit, 50000)
})

test('dépenses direction : chaque catégorie vers son compte', () => {
  const attendu = { fond: 'caisse', fond_nature: 'achats', reparation: 'entretien', materiel: 'petitMateriel',
    equipement: 'materielOutillage', investissement: 'autresImmobilisations', retrait_perso: 'associe',
    divers: 'chargesDiverses', administratif: 'fournisseurs', inconnue: 'attente' }
  for (const [categorie, cle] of Object.entries(attendu)) {
    const liens = { ...vide, direction: new Map([['d', { categorie, restaurant_id: 'k' }]]) }
    const l = un(mvt('d', 'esp', -30000, 'direction'), liens)
    assert.equal(ligneDe(l, 'especesDirection')[0].credit, 30000, categorie)
    assert.equal(ligneDe(l, cle)[0].debit, 30000, categorie)
  }
})

test('virements : une paire s’annule sur 585 ; coffre sur le compte Coffre', () => {
  const lignes = ecrituresTresorerie({
    mouvements: [mvt('a', 'sib', -700000, 'virement'), mvt('b', 'esp', 700000, 'virement'), mvt('c', 'baci', -100000, 'coffre')],
    comptes, liens: vide, restaurants,
  })
  const v585 = ligneDe(lignes, 'virementsInternes')
  assert.equal(somme(v585, 'debit') - somme(v585, 'credit'), 0)
  assert.equal(ligneDe(lignes, 'coffre')[0].debit, 100000)
})

test('cotisation, prêt, recalage, reçu banque, autre, compte inconnu : en attente, rien de perdu', () => {
  for (const type of ['cotisation', 'pret', 'recalage', 'recu_banque', 'autre']) {
    const l = un(mvt('z', 'cs', 90000, type))
    assert.equal(ligneDe(l, 'cotisSalaire')[0].debit, 90000, type)
    assert.equal(ligneDe(l, 'attente')[0].credit, 90000, type)
    assert.equal(ligneDe(l, 'attente')[0].libelle, 'Mvt z', type)
  }
  const l = un(mvt('y', 'x', -5000, 'virement'))
  assert.equal(ligneDe(l, 'attente')[0].credit, 5000)
})

test('montant nul : aucune ligne', () => {
  assert.deepEqual(ecrituresTresorerie({ mouvements: [mvt('n', 'sib', 0, 'virement')], comptes, liens: vide, restaurants }), [])
})

test('assiettes des commissions : tablettes, mobile money des shifts, publicité du mois', () => {
  const points = [
    { id: 'p1', restaurant_id: 'k', date: '2026-10-01', yango_tab: 100000, glovo_tab: 200000 },
    { id: 'p2', restaurant_id: 'k', date: '2026-10-02', yango_tab: 50000, glovo_tab: null, source: 'import_sheets_2026_10' },
  ]
  const shifts = new Map([['p1', [{ om: 10000, wave: 20000, djamo: 0 }, { om: 0, wave: 5000, djamo: 3000 }]]])
  const pubs = [{ restaurant_id: 'k', montant: 12000, periode_debut: '2026-10-08' }, { restaurant_id: 'k', montant: 999, periode_debut: '2026-09-29' }]
  const a = assiettesCommissions({ mois: '2026-10', points, shifts, pubs, restaurants })
  assert.deepEqual(a, [{ restaurant: { nom: 'Al Kayan KMS', court: 'KMS' }, restaurantId: 'k',
    yangoTab: 100000, glovoTab: 200000, om: 10000, wave: 25000, djamo: 3000, pubGlovo: 12000 }])
})

test('écritures OD : commissions aux taux de l’app, frais 1 %, publicité réelle, équilibrées', () => {
  const lignes = ecrituresCommissions({ mois: '2026-10', assiettes: [{
    restaurant: { nom: 'Al Kayan KMS', court: 'KMS' }, restaurantId: 'k',
    yangoTab: 100000, glovoTab: 200000, om: 10000, wave: 25000, djamo: 3000, pubGlovo: 12000,
  }] })
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
  assert.equal(somme(ligneDe(lignes, 'commissionsPlateformes'), 'debit'), 23000 + 59000)
  assert.equal(ligneDe(lignes, 'yango')[0].credit, 23000)
  assert.equal(somme(ligneDe(lignes, 'glovo'), 'credit'), 59000 + 12000)
  assert.equal(somme(ligneDe(lignes, 'fraisMobileMoney'), 'debit'), 100 + 250 + 30)
  assert.equal(ligneDe(lignes, 'publicite')[0].debit, 12000)
  for (const l of lignes) {
    assert.equal(l.journal, 'OD')
    assert.equal(l.date, '2026-10-31')
    assert.equal(l.piece, 'OD-KMS-202610')
  }
})
