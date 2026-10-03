// Tests de lib/joursRepos.js — déduction du jour de repos et jours non pointés.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { analyserEquipe, analyserJourRepos, completerPresences, fenetreAnalyse, jourIso, nomJour } from './joursRepos.js'

// 12 semaines complètes à partir du lundi 6 juillet 2026.
function jours(n = 84, depuis = '2026-07-06') {
  const out = []
  const d = new Date(`${depuis}T00:00:00Z`)
  for (let i = 0; i < n; i++) { out.push(d.toISOString().split('T')[0]); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}
const ouverts = jours()

// Présent tous les jours sauf `repos` (jour ISO), avec quelques absences en plus.
function presentsSauf(repos, { manquesRepos = 0, absencesAilleurs = [] } = {}) {
  let manques = 0
  return new Set(ouverts.filter(d => {
    if (absencesAilleurs.includes(d)) return false
    if (jourIso(d) !== repos) return true
    if (manques < manquesRepos) { manques++; return true }
    return false
  }))
}

describe('jours de la semaine', () => {
  test('lundi = 1, dimanche = 7', () => {
    assert.equal(jourIso('2026-07-06'), 1)
    assert.equal(jourIso('2026-07-12'), 7)
    assert.equal(nomJour(2), 'Mardi')
  })
  test('fenêtre : 12 semaines finissant hier', () => {
    assert.deepEqual(fenetreAnalyse(new Date('2026-10-03T10:00:00Z')), { debut: '2026-07-11', fin: '2026-10-02' })
  })
})

describe('analyse d\'un travailleur', () => {
  test('toujours absent le mardi → repos le mardi', () => {
    const r = analyserJourRepos({ joursOuverts: ouverts, presents: presentsSauf(2), debutSuivi: ouverts[0] })
    assert.equal(r.jour, 2)
    assert.equal(r.taux, 1)
    assert.equal(r.semaines, 12)
  })

  test('3 mardis sur 4 suffisent (venu 3 mardis sur 12)', () => {
    const r = analyserJourRepos({ joursOuverts: ouverts, presents: presentsSauf(2, { manquesRepos: 3 }), debutSuivi: ouverts[0] })
    assert.equal(r.jour, 2)
  })

  test('venu 4 mardis sur 12 (67 %) → pas de jour net', () => {
    const r = analyserJourRepos({ joursOuverts: ouverts, presents: presentsSauf(2, { manquesRepos: 4 }), debutSuivi: ouverts[0] })
    assert.equal(r.jour, null)
    assert.equal(r.raison, 'pas_de_jour_net')
  })

  test('arrivé depuis moins de 6 semaines → pas assez de données', () => {
    const debut = ouverts[ouverts.length - 35]
    const r = analyserJourRepos({ joursOuverts: ouverts, presents: presentsSauf(2), debutSuivi: debut })
    assert.equal(r.jour, null)
    assert.equal(r.raison, 'pas_assez')
  })

  test('presque jamais pointé → aucun jour', () => {
    const r = analyserJourRepos({ joursOuverts: ouverts, presents: new Set(ouverts.slice(0, 3)), debutSuivi: ouverts[0] })
    assert.equal(r.jour, null)
    assert.equal(r.raison, 'rarement_pointe')
  })

  test('jamais vu dans les présences', () => {
    assert.equal(analyserJourRepos({ joursOuverts: ouverts, presents: new Set(), debutSuivi: null }).raison, 'jamais_pointe')
  })
})

describe('analyse de l\'équipe', () => {
  const points = ouverts.map(date => ({ date, restaurant_id: 'A' }))
  const presences = [...presentsSauf(3)].map(date => ({ travailleur_id: 't1', statut: 'Présent', date, restaurant_id: 'A' }))

  test('nouveau, confirmé, changé, et un choix manuel jamais touché', () => {
    const base = { id: 't1', restaurant_id: 'A' }
    const actions = [
      { ...base },
      { ...base, jour_repos: 3, jour_repos_source: 'auto' },
      { ...base, jour_repos: 5, jour_repos_source: 'auto' },
      { ...base, jour_repos: 5, jour_repos_source: 'manuel' },
    ].map(t => analyserEquipe({ travailleurs: [t], points, presences })[0].action)
    assert.deepEqual(actions, ['nouveau', 'confirme', 'change', 'manuel'])
  })

  test('les présences dans un autre restaurant ne comptent pas (transfert)', () => {
    const ailleurs = presences.map(p => ({ ...p, restaurant_id: 'B' }))
    const [r] = analyserEquipe({ travailleurs: [{ id: 't1', restaurant_id: 'A' }], points, presences: ailleurs })
    assert.equal(r.resultat.raison, 'jamais_pointe')
  })
})

describe('jours non pointés à l\'affichage', () => {
  // Semaine du lundi 28 septembre au dimanche 4 octobre 2026 ; aujourd'hui = samedi 3.
  const points = jours(7, '2026-09-28').map((date, i) => ({ id: `p${i}`, date, restaurant_id: 'A' }))
  const presences = [{ travailleur_id: 't1', point_id: 'p0', date: '2026-09-28', statut: 'Présent', paye: 3000 }]
  const t1 = { id: 't1', nom: 'Awa', restaurant_id: 'A', actif: true, statut: 'actif', jour_repos: 2, created_at: '2026-01-01T00:00:00Z' }

  test('jour de repos → Repos, autre jour → Absent, aujourd\'hui et après exclus', () => {
    const tout = completerPresences({ presences, travailleurs: [t1], points, aujourdhui: '2026-10-03' })
    const parDate = Object.fromEntries(tout.map(p => [p.date, p.statut]))
    assert.deepEqual(parDate, {
      '2026-09-28': 'Présent',
      '2026-09-29': 'Repos',
      '2026-09-30': 'Absent',
      '2026-10-01': 'Absent',
      '2026-10-02': 'Absent',
    })
    assert.ok(tout.filter(p => p.deduit).every(p => p.paye === 0))
  })

  test('jour de repos inconnu → Non pointé', () => {
    const tout = completerPresences({ presences: [], travailleurs: [{ ...t1, jour_repos: null }], points, aujourdhui: '2026-09-30' })
    assert.deepEqual(tout.map(p => p.statut), ['Non pointé', 'Non pointé'])
  })

  test('avant l\'embauche, inactif ou archivé : rien n\'est ajouté', () => {
    assert.equal(completerPresences({ presences: [], travailleurs: [{ ...t1, date_embauche: '2026-10-02' }], points, aujourdhui: '2026-10-03' }).length, 1)
    assert.equal(completerPresences({ presences: [], travailleurs: [{ ...t1, actif: false }], points, aujourdhui: '2026-10-03' }).length, 0)
    assert.equal(completerPresences({ presences: [], travailleurs: [{ ...t1, statut: 'archive' }], points, aujourdhui: '2026-10-03' }).length, 0)
  })

  test('pointé dans un autre restaurant ce jour-là (renfort) : pas absent', () => {
    const renfort = [{ travailleur_id: 't1', point_id: 'x', date: '2026-09-30', statut: 'Présent', restaurant_id: 'B' }]
    const tout = completerPresences({ presences: renfort, travailleurs: [t1], points, aujourdhui: '2026-10-01' })
    assert.equal(tout.find(p => p.date === '2026-09-30').restaurant_id, 'B')
    assert.equal(tout.filter(p => p.date === '2026-09-30').length, 1)
  })
})
