// Tests de lib/presencesPaie.js — présence affichée avant de payer un travailleur.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { dateIlYA, indexerPresences } from './presencesPaie.js'

const JOUR = '2026-11-05'
const ligne = (travailleur_id, date, extra = {}) => ({
  travailleur_id, date, statut: 'Présent', heure_debut: '08:26', heure_fin: '16:16', ...extra,
})

describe('indexerPresences', () => {
  test('présent ce jour : étiquette verte et horaires', () => {
    const r = indexerPresences([ligne('a', JOUR)], JOUR)('a')
    assert.deepEqual(r, { etiquette: 'Présent', ton: 'ok', detail: '08:26–16:16' })
  })

  test('deux services le même jour : les deux horaires, sans doublon', () => {
    const r = indexerPresences([
      ligne('a', JOUR),
      ligne('a', JOUR),
      ligne('a', JOUR, { heure_debut: '16:21', heure_fin: '00:35' }),
    ], JOUR)('a')
    assert.equal(r.detail, '08:26–16:16, 16:21–00:35')
  })

  test('shift en cours sans heure de fin', () => {
    const r = indexerPresences([ligne('a', JOUR, { heure_fin: '' })], JOUR)('a')
    assert.equal(r.detail, 'depuis 08:26')
  })

  test('autre statut saisi ce jour : affiché tel quel', () => {
    const lignes = [ligne('a', JOUR, { statut: 'Absent' }), ligne('b', JOUR, { statut: 'Repos' })]
    const presence = indexerPresences(lignes, JOUR)
    assert.deepEqual(presence('a'), { etiquette: 'Absent', ton: 'erreur', detail: '' })
    assert.deepEqual(presence('b'), { etiquette: 'Repos', ton: 'alerte', detail: '' })
  })

  test('collègues pointés mais pas lui : pas pointé, avec sa dernière présence', () => {
    const r = indexerPresences([
      ligne('b', JOUR),
      ligne('a', '2026-11-01'),
      ligne('a', '2026-11-03'),
      ligne('a', '2026-11-04', { statut: 'Repos' }),
    ], JOUR)('a')
    assert.deepEqual(r, { etiquette: 'Pas pointé', ton: 'alerte', detail: 'Dernière présence 03/11' })
  })

  test('personne de pointé ce jour : pointage non reçu, jamais présenté comme un manque', () => {
    const r = indexerPresences([ligne('a', '2026-11-01')], JOUR)('a')
    assert.deepEqual(r, { etiquette: 'Pointage non reçu', ton: 'neutre', detail: 'Dernière présence 01/11' })
  })

  test('aucune présence sur la période', () => {
    const r = indexerPresences([ligne('b', JOUR)], JOUR)('a')
    assert.equal(r.detail, 'Aucune présence sur 14 jours')
  })

  test('une présence postérieure à la journée saisie est ignorée', () => {
    const r = indexerPresences([ligne('b', JOUR), ligne('a', '2026-11-06')], JOUR)('a')
    assert.equal(r.detail, 'Aucune présence sur 14 jours')
  })
})

test('dateIlYA passe le changement de mois', () => {
  assert.equal(dateIlYA('2026-11-05', 14), '2026-10-22')
})
