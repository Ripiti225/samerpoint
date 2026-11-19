// Tests de lib/journalPaie.js — journal de Paie (PA) depuis les bulletins d'un état validé.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPTES } from './comptesSyscohada.js'
import { clePaie, ecrituresPaie } from './journalPaie.js'
import { calculerBulletin } from './paie.js'

const somme = (lignes, cle) => lignes.reduce((s, l) => s + l[cle], 0)
const auCompte = (lignes, cle, sens) => lignes.filter(l => l.compte === COMPTES[cle].compte).reduce((s, l) => s + l[sens], 0)
const RESTO = { nom: 'Samer Oasis', court: 'Oasis' }

const fiche = (plus = {}) => ({ salaire_categoriel: 90000, sursalaire: 20000, prime_transport: 30000, prime_tenue: 5000, personnes_cmu: 2, parts_fiscales: 1, ...plus })
const bulletin = (plus = {}, opts = {}) => ({
  bulletin: { calcul: calculerBulletin({ fiche: fiche(plus), dateEmbauche: '2020-03-01', finPeriode: '2026-10-31', ...opts }) },
})

test('clé de la règle paie : restaurant et mois', () => {
  assert.equal(clePaie('r1', '2026-10-01'), 'r1|2026-10')
  assert.equal(clePaie('r1', '2026-10'), 'r1|2026-10')
})

test('un bulletin : pièce équilibrée, chaque montant à son compte', () => {
  const b = bulletin()
  const c = b.bulletin.calcul
  const lignes = ecrituresPaie({ mois: '2026-10', restaurant: RESTO, lignes: [b] })
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
  const cnpsPatronal = c.patronal.filter(l => [415, 470, 480, 481, 490].includes(l.code)).reduce((s, l) => s + l.montant, 0)
  const taxesPatronales = c.patronal.filter(l => [500, 520, 530, 531].includes(l.code)).reduce((s, l) => s + l.montant, 0)
  assert.equal(auCompte(lignes, 'personnel', 'debit'), c.brut + c.arrondi)
  assert.equal(auCompte(lignes, 'indemnites', 'debit'), c.transport + c.tenue)
  assert.equal(auCompte(lignes, 'chargesSociales', 'debit'), cnpsPatronal)
  assert.equal(auCompte(lignes, 'taxesSalaires', 'debit'), taxesPatronales)
  assert.equal(auCompte(lignes, 'cnps', 'credit'), c.retenues.cnps + c.retenues.cmu + cnpsPatronal)
  assert.equal(auCompte(lignes, 'itsRetenu', 'credit'), c.retenues.its + taxesPatronales)
  // Dû au personnel = net + avance déjà versée (soldé par les versements).
  assert.equal(auCompte(lignes, 'salairesDus', 'credit'), c.net + c.avance)
  for (const l of lignes) {
    assert.equal(l.journal, 'PA')
    assert.equal(l.piece, 'PA-Oasis-202610')
    assert.equal(l.date, '2026-10-31')
    assert.equal(l.restaurant, 'Samer Oasis')
  }
})

test('avance retenue : le dû au personnel la garde (déjà versée, soldée en 422)', () => {
  const b = bulletin({}, { avances: 40000 })
  const lignes = ecrituresPaie({ mois: '2026-10', restaurant: RESTO, lignes: [b] })
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
  assert.equal(auCompte(lignes, 'salairesDus', 'credit'), b.bulletin.calcul.net + 40000)
})

test('plusieurs salariés additionnés ; ligne sans bulletin calculé ignorée', () => {
  const a = bulletin()
  const b = bulletin({ salaire_categoriel: 150000, sursalaire: 0, parts_fiscales: 2 })
  const lignes = ecrituresPaie({ mois: '2026-10', restaurant: RESTO, lignes: [a, b, { bulletin: null }, {}] })
  assert.equal(somme(lignes, 'debit'), somme(lignes, 'credit'))
  assert.equal(auCompte(lignes, 'personnel', 'debit'),
    a.bulletin.calcul.brut + a.bulletin.calcul.arrondi + b.bulletin.calcul.brut + b.bulletin.calcul.arrondi)
})

test('aucun bulletin : aucune écriture', () => {
  assert.deepEqual(ecrituresPaie({ mois: '2026-10', restaurant: RESTO, lignes: [] }), [])
})
