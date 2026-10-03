// Tests de lib/cotisations.js — cotisations des restaurants remises au RH.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chargeApresCotisation, cotisationPourCategorie, cotiseParDu, ecrituresCotisation } from './cotisations.js'

const fournisseurs = [
  { id: 'cs', restaurant_id: 'kms', nom: 'Cotisation salaire' },
  { id: 'cn', restaurant_id: 'kms', nom: 'CNPS' },
  { id: 'im', restaurant_id: 'kms', nom: 'IMPÔT ET TIMBRE' },
  { id: 'it', restaurant_id: 'kms', nom: 'ITS' },
  { id: 'te', restaurant_id: 'kms', nom: 'TEE' },
  { id: 'ba', restaurant_id: 'kms', nom: 'CONTRAT DE BAIL' },
  { id: 'lo', restaurant_id: 'oasis', nom: 'LOYER' },
  { id: 'x', restaurant_id: 'kms', nom: 'Ibrahim' },
]

test('chaque charge trouve sa cotisation dans le bon restaurant', () => {
  assert.equal(cotisationPourCategorie('salaire', fournisseurs, 'kms').id, 'cs')
  assert.equal(cotisationPourCategorie('cnps', fournisseurs, 'kms').id, 'cn')
  assert.equal(cotisationPourCategorie('impot', fournisseurs, 'kms').id, 'im')
  assert.equal(cotisationPourCategorie('its', fournisseurs, 'kms').id, 'it')   // pas « IMPÔT ET TIMBRE »
  assert.equal(cotisationPourCategorie('tee', fournisseurs, 'kms').id, 'te')
  assert.equal(cotisationPourCategorie('bail', fournisseurs, 'kms').id, 'ba')
  assert.equal(cotisationPourCategorie('loyer', fournisseurs, 'oasis').id, 'lo')
  assert.equal(cotisationPourCategorie('loyer', fournisseurs, 'kms'), null)     // KMS n'a pas de cotisation loyer
  assert.equal(cotisationPourCategorie('dette', fournisseurs, 'kms'), null)
})

test('exemple KMS : 600 000 cotisés sur 1 000 000 de salaires', () => {
  const e = ecrituresCotisation({ montant: 600_000, creditActuel: -1_855_000 })
  assert.equal(e.mouvement, 600_000)                 // entre en Espèces
  assert.equal(e.nouveauCredit, -1_255_000)          // la cotisation baisse
  assert.equal(e.transaction.facture, 600_000)
  assert.equal(chargeApresCotisation(1_000_000, 600_000), 400_000) // le résultat ne déduit que le reste
  assert.equal(chargeApresCotisation(1_000_000, 1_500_000), 0)
})

test('cotiseParDu additionne plusieurs remises', () => {
  assert.deepEqual(cotiseParDu([{ du_id: 'a', montant: 100 }, { du_id: 'a', montant: 50 }, { du_id: 'b', montant: 7 }]), { a: 150, b: 7 })
})
