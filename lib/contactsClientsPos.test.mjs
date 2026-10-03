// Tests de lib/contactsClientsPos.js — import des numéros clients du POS.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { dateDepart, numeroValide, versContactClient } from './contactsClientsPos.js'

const corr = { 'pos-7e': 'st-7e' }
const cmd = { id: 'c1', restaurant_id: 'pos-7e', statut: 'PAYEE', contact_client: ' 07 07 07 07 07 ', partenaire: 'YANGO', created_at: '2026-09-20T13:05:00Z', service_id: 's1' }

describe('import des numéros POS', () => {
  test('une commande payée avec numéro devient un contact du bon restaurant', () => {
    assert.deepEqual(versContactClient(cmd, corr), {
      pos_commande_id: 'c1', numero: '07 07 07 07 07', restaurant_id: 'st-7e', date: '2026-09-20',
      commande_at: '2026-09-20T13:05:00Z', partenaire: 'YANGO', pos_service_id: 's1',
    })
  })
  test('ignorées : annulée, numéro trop court, restaurant non relié', () => {
    assert.equal(versContactClient({ ...cmd, statut: 'ANNULEE' }, corr), null)
    assert.equal(versContactClient({ ...cmd, contact_client: '0707' }, corr), null)
    assert.equal(versContactClient({ ...cmd, restaurant_id: 'inconnu' }, corr), null)
    assert.equal(numeroValide('+225 07 00 00 00 00'), true)
  })
  test('reprise : 2 jours avant le dernier import, ou la date demandée', () => {
    assert.equal(dateDepart('2026-10-03T22:15:00Z', null), '2026-10-01')
    assert.equal(dateDepart(null, null), '2026-08-01')
    assert.equal(dateDepart('2026-10-03', '2026-08-15'), '2026-08-15')
  })
})
