// Tests de lib/objectifs.js — objectif mensuel et variations du dashboard.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { progressionObjectif, variation } from './objectifs.js'

test('progressionObjectif : pourcentage atteint et projection au rythme actuel', () => {
  const p = progressionObjectif({ ventes: 1_000_000, objectif: 3_000_000, jour: 10, joursMois: 30 })
  assert.equal(p.pct, 33)
  assert.equal(p.projection, 3_000_000)
  assert.equal(p.enAvance, true)
  const lent = progressionObjectif({ ventes: 500_000, objectif: 3_000_000, jour: 10, joursMois: 30 })
  assert.equal(lent.enAvance, false)
  assert.equal(lent.pctProjete, 50)
})

test('progressionObjectif : null sans objectif, jamais de division par zéro', () => {
  assert.equal(progressionObjectif({ ventes: 10, objectif: null, jour: 3, joursMois: 31 }), null)
  assert.equal(progressionObjectif({ ventes: 10, objectif: 0, jour: 3, joursMois: 31 }), null)
  assert.equal(progressionObjectif({ ventes: 0, objectif: 100, jour: 0, joursMois: 31 }).pct, 0)
})

test('variation', () => {
  assert.equal(variation(110, 100), 10)
  assert.equal(variation(90, 100), -10)
  assert.equal(variation(50, 0), null)
  assert.equal(variation(-50, -100), 50)
})

test('objectifDuMois : rythme sur les jours terminés et montant à faire par jour', async () => {
  const { objectifDuMois } = await import('./objectifs.js')
  assert.equal(typeof objectifDuMois, 'function')
  // 5 octobre : 4 jours terminés, 27 jours restants (aujourd'hui compris).
  const o = objectifDuMois({ ventes: 1_482_573, objectif: 10_000_000, joursEcoules: 4, joursMois: 31 })
  assert.equal(o.pct, 15)
  assert.equal(o.pctProjete, 115)
  assert.equal(o.enAvance, true)
  assert.equal(o.reste, 8_517_427)
  assert.equal(o.joursRestants, 27)
  assert.equal(o.parJour, 315_461)
  assert.equal(o.atteint, false)
})

test('objectifDuMois : le 1er du mois, pas encore de rythme', async () => {
  const { objectifDuMois } = await import('./objectifs.js')
  const o = objectifDuMois({ ventes: 0, objectif: 3_100_000, joursEcoules: 0, joursMois: 31 })
  assert.equal(o.pct, 0)
  assert.equal(o.pctProjete, null)
  assert.equal(o.parJour, 100_000)
})

test('objectifDuMois : objectif atteint, plus rien à faire par jour', async () => {
  const { objectifDuMois } = await import('./objectifs.js')
  const o = objectifDuMois({ ventes: 3_600_000, objectif: 3_500_000, joursEcoules: 29, joursMois: 31 })
  assert.equal(o.atteint, true)
  assert.equal(o.reste, 0)
  assert.equal(o.parJour, 0)
  assert.equal(o.pct, 103)
})

test('objectifDuMois : null sans objectif', async () => {
  const { objectifDuMois } = await import('./objectifs.js')
  assert.equal(objectifDuMois({ ventes: 10, objectif: 0, joursEcoules: 3, joursMois: 30 }), null)
})

test('niveauRythme : vert dès 100 %, orange de 90 à 99 %, rouge en dessous', async () => {
  const { niveauRythme } = await import('./objectifs.js')
  assert.equal(typeof niveauRythme, 'function')
  assert.equal(niveauRythme(115), 'bon')
  assert.equal(niveauRythme(100), 'bon')
  assert.equal(niveauRythme(99), 'presque')
  assert.equal(niveauRythme(90), 'presque')
  assert.equal(niveauRythme(89), 'retard')
  assert.equal(niveauRythme(null), null)
})

test('moisObjectif : le mois suit la période choisie, jusqu\'à hier pour le mois en cours', async () => {
  const { moisObjectif } = await import('./objectifs.js')
  const AUJ = '2026-11-02'
  assert.deepEqual(moisObjectif({ periodeKey: '7days', aujourdhui: AUJ }),
    { debut: '2026-11-01', fin: '2026-11-01', joursMois: 30, joursEcoules: 1, termine: false, nom: 'novembre' })
  assert.deepEqual(moisObjectif({ periodeKey: 'month', aujourdhui: '2026-11-01' }),
    { debut: '2026-11-01', fin: '2026-10-31', joursMois: 30, joursEcoules: 0, termine: false, nom: 'novembre' })
  assert.deepEqual(moisObjectif({ periodeKey: 'lastmonth', aujourdhui: AUJ }),
    { debut: '2026-10-01', fin: '2026-10-31', joursMois: 31, joursEcoules: 31, termine: true, nom: 'octobre' })
  assert.deepEqual(moisObjectif({ periodeKey: 'lastmonth', aujourdhui: '2027-01-15' }).nom, 'décembre')
  assert.deepEqual(moisObjectif({ periodeKey: 'custom', dateFin: '2026-09-14', aujourdhui: AUJ }),
    { debut: '2026-09-01', fin: '2026-09-30', joursMois: 30, joursEcoules: 30, termine: true, nom: 'septembre' })
  assert.equal(moisObjectif({ periodeKey: 'custom', dateFin: '', aujourdhui: AUJ }).nom, 'novembre')
  assert.equal(moisObjectif({ periodeKey: 'custom', dateFin: '2026-11-20', aujourdhui: AUJ }).fin, '2026-11-01')
})
