// Tests de lib/beneficeCorrige.js — un écart annulé corrige le BSC du jour de l'erreur.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { correctionAnnulations, beneficeSC, avecBeneficeCorrige } from './beneficeCorrige.js'

test('espèces tapées 12 020 au lieu de 120 200 : le manquant annulé remonte le BSC', () => {
  const p = { benefice_sc: 300000, ecart_regularisations: [{ sens: 'manquant', montant: 108180, fond_point_id: 'x' }] }
  assert.equal(beneficeSC(p), 408180)
})

test('un surplus annulé baisse le BSC, comme le fond', () => {
  assert.equal(beneficeSC({ benefice_sc: 300000, ecart_regularisations: [{ sens: 'surplus', montant: 5000 }] }), 295000)
})

test('« Justifier » (sans fond) ne touche pas au BSC', () => {
  assert.equal(correctionAnnulations([{ sens: 'manquant', montant: 20000, sans_fond: true }]), 0)
})

test('plusieurs régularisations, montants texte, anciennes sans fond_point_id', () => {
  assert.equal(correctionAnnulations([
    { sens: 'manquant', montant: '8000' },
    { sens: 'manquant', montant: 2000, source: 'verification', sans_fond: false },
    { sens: 'surplus', montant: 500 },
  ]), 9500)
})

test('sans régularisation : le BSC enregistré tel quel', () => {
  assert.equal(beneficeSC({ benefice_sc: 120000 }), 120000)
  assert.equal(beneficeSC({ benefice_sc: 120000, ecart_regularisations: null }), 120000)
  assert.equal(beneficeSC(null), 0)
  assert.equal(correctionAnnulations([null, { montant: 100 }]), 0)
})

test('avecBeneficeCorrige ne modifie pas les points reçus', () => {
  const pts = [{ id: 1, benefice_sc: 1000, ecart_regularisations: [{ sens: 'manquant', montant: 500 }] }]
  const out = avecBeneficeCorrige(pts)
  assert.equal(out[0].benefice_sc, 1500)
  assert.equal(pts[0].benefice_sc, 1000)
})
