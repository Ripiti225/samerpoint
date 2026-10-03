// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/fondTresorerie.js — fond donné par la Trésorerie → « FC reçu »
// du point du restaurant. Un fond compté dans deux points fausserait le fond
// de caisse reporté jour après jour.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { fondPourPoint, garderPrerempli } from './fondTresorerie.js'

const fond = (id, date, montant, point_id = null) => ({ id, date, montant, point_id })

describe('fond de la Trésorerie pour un point', () => {
  test('fonds donnés jusqu\'à la date du point, moins les espèces reprises au restaurant', () => {
    const r = fondPourPoint({
      pointId: 'p3', datePoint: '2026-10-03',
      fonds: [fond('f1', '2026-10-03', 300000), fond('f2', '2026-10-04', 100000)],
      reprises: [fond('e1', '2026-10-03', 50000)],
    })
    assert.equal(r.montant, 250000)
    assert.deepEqual(r.lignes.map(l => [l.id, l.type, l.montant]), [['f1', 'fond', 300000], ['e1', 'reprise', -50000]])
  })

  test('un fond déjà rattaché à un autre point validé ne compte plus', () => {
    const r = fondPourPoint({ pointId: 'p3', datePoint: '2026-10-03', fonds: [fond('f1', '2026-10-02', 300000, 'p2')] })
    assert.equal(r.montant, 0)
  })

  test('point du jour déjà validé : le fond passe sur le prochain point ouvert', () => {
    const r = fondPourPoint({ pointId: 'p4', datePoint: '2026-10-04', fonds: [fond('f1', '2026-10-03', 300000)] })
    assert.equal(r.montant, 300000)
  })

  test('point rouvert puis revalidé : ses propres fonds restent comptés', () => {
    const r = fondPourPoint({ pointId: 'p3', datePoint: '2026-10-03', fonds: [fond('f1', '2026-10-03', 300000, 'p3')] })
    assert.equal(r.montant, 300000)
  })
})

describe('préremplissage de la case du gérant', () => {
  test('case vide ou encore égale au dernier montant automatique : on la met à jour', () => {
    assert.equal(garderPrerempli({ saisi: '', ancienAuto: null, nouveauAuto: 300000 }), '300000')
    assert.equal(garderPrerempli({ saisi: '300000', ancienAuto: 300000, nouveauAuto: 250000 }), '250000')
  })
  test('le gérant a corrigé : on garde sa valeur', () => {
    assert.equal(garderPrerempli({ saisi: '280000', ancienAuto: 300000, nouveauAuto: 250000 }), '280000')
  })
  test('rien à préremplir : la case reste comme elle est', () => {
    assert.equal(garderPrerempli({ saisi: '', ancienAuto: null, nouveauAuto: 0 }), '')
  })
})
