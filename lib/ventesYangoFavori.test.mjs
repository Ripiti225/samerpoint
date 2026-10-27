// ──────────────────────────────────────────────────────────────────────────────
// Tests de la partie app du favori « Ventes Yango » : semaines proposées,
// pub par restaurant, messages acceptés.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ORIGINE_YANGO, etatPub, messageValide, pubParCode, semainesProposees } from './ventesYangoFavori.js'

describe('semaines proposées', () => {
  test('mardi 27/10 : la dernière terminée est 16/10 → 22/10, puis les 4 d’avant', () => {
    const s = semainesProposees('2026-10-27')
    assert.equal(s.length, 5)
    assert.deepEqual(s[0], { debut: '2026-10-16', fin: '2026-10-22' })
    assert.deepEqual(s[4], { debut: '2026-09-18', fin: '2026-09-24' })
  })
  test('le jeudi, la semaine en cours n’est pas terminée', () => {
    assert.deepEqual(semainesProposees('2026-10-22')[0], { debut: '2026-10-09', fin: '2026-10-15' })
  })
  test('le vendredi, la semaine finie la veille est proposée', () => {
    assert.deepEqual(semainesProposees('2026-10-23')[0], { debut: '2026-10-16', fin: '2026-10-22' })
  })
})

describe('pub', () => {
  const pubs = [
    { nom: 'Chez Samer (Rond point Riviera Palmraie)', montant: 81265 },
    { nom: 'Chez Samer (Quartier de la Angré, 7e tranche)', montant: 36219 },
    { nom: 'Al Kayan Pizza (La commune Koumassi)', montant: 1088 },
  ]
  const periode = { debut: '2026-09-25', fin: '2026-10-01' }
  const codes = { PALM: 'r-palm', '7E': 'r-7e', KMS: 'r-kms' }

  test('par code restaurant (mêmes règles que les ventes)', () => {
    assert.deepEqual(pubParCode(pubs), { PALM: 81265, '7E': 36219, KMS: 1088 })
  })
  test('à jour : par restaurant, prête à enregistrer', () => {
    const e = etatPub({ pubs, pubAJourAu: '2026-10-05', periode, codes, dejaSaisie: 0 })
    assert.equal(e.statut, 'a_jour')
    assert.equal(e.total, 118572)
    assert.deepEqual(e.parts.find(p => p.restaurant_id === 'r-palm'), { restaurant_id: 'r-palm', montant: 81265 })
  })
  test('Yango n’a pas compté jusqu’au jeudi : pas à jour', () => {
    assert.equal(etatPub({ pubs, pubAJourAu: '2026-09-30', periode, codes, dejaSaisie: 0 }).statut, 'pas_a_jour')
    assert.equal(etatPub({ pubs: [], pubAJourAu: null, periode, codes, dejaSaisie: 0 }).statut, 'pas_a_jour')
  })
  test('déjà saisie : rien n’est ajouté', () => {
    assert.equal(etatPub({ pubs, pubAJourAu: '2026-10-05', periode, codes, dejaSaisie: 5000 }).statut, 'deja_saisie')
  })
  test('à jour mais aucune pub', () => {
    assert.equal(etatPub({ pubs: [], pubAJourAu: '2026-10-05', periode, codes, dejaSaisie: 0 }).statut, 'aucune')
  })
  test('restaurant ignoré ou pas encore associé : pas compté', () => {
    const e = etatPub({ pubs, pubAJourAu: '2026-10-05', periode, codes: { PALM: 'ignorer', '7E': 'r-7e' }, dejaSaisie: 0 })
    assert.equal(e.total, 36219)
  })
})

describe('messages acceptés', () => {
  const opener = {}
  test('seulement du portail Yango, de la fenêtre qui a ouvert Samtrackly', () => {
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: opener, data: { type: 'ventes' } }, opener), true)
    assert.equal(messageValide({ origin: 'https://evil.example', source: opener, data: { type: 'ventes' } }, opener), false)
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: {}, data: { type: 'ventes' } }, opener), false)
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: opener, data: null }, opener), false)
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: null, data: { type: 'x' } }, null), false)
  })
})
