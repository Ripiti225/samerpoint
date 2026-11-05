// ──────────────────────────────────────────────────────────────────────────────
// Tests de la décision d'un litige de stock initial : le gérant doit lire une
// phrase, jamais un code d'erreur SQL. Le calcul d'argent est testé dans
// scripts/test_correction_stock_initial.sql.
// ──────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { messageLitigeStock } from './correctionStockInitial.messages.js'

test('traduit les erreurs SQL en français', () => {
  assert.equal(messageLitigeStock({ message: 'LITIGE_DEJA_TRAITE' }), 'Ce litige a déjà été traité')
  assert.equal(
    messageLitigeStock({ message: 'SHIFT_SORTANT_ABSENT' }),
    'Le shift du caissier sortant n’est pas encore arrivé. Réessayez plus tard.',
  )
  assert.equal(
    messageLitigeStock({ message: 'Could not find the function (PGRST202)' }),
    'Script supabase_correction_stock_initial.sql non passé dans Supabase.',
  )
})

test('laisse passer un message inconnu', () => {
  assert.equal(messageLitigeStock({ message: 'Réseau indisponible' }), 'Réseau indisponible')
  assert.equal(messageLitigeStock(null), 'Décision impossible')
})
