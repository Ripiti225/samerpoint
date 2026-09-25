import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let troisDerniersJours
let grouperShiftsParJour
let aBesoinExplication
try {
  ({ troisDerniersJours, grouperShiftsParJour, aBesoinExplication } = await import('./pointCaissier.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

const clotureValide = (extra) => ({
  pos_service_id: `service-${extra.id}`, valide: true, ecart_reconciliation: 0, ...extra,
})

describe('les trois journées affichées', () => {
  test('renvoie aujourd’hui puis les deux jours précédents', () => {
    assert.equal(typeof troisDerniersJours, 'function')
    assert.deepEqual(
      troisDerniersJours(new Date('2026-09-25T10:00:00')),
      ['2026-09-25', '2026-09-24', '2026-09-23'],
    )
  })

  test('franchit un changement de mois', () => {
    assert.deepEqual(
      troisDerniersJours(new Date('2026-03-01T08:00:00')),
      ['2026-03-01', '2026-02-28', '2026-02-27'],
    )
  })

  test('franchit un changement d’année', () => {
    assert.deepEqual(
      troisDerniersJours(new Date('2026-01-01T23:30:00')),
      ['2026-01-01', '2025-12-31', '2025-12-30'],
    )
  })
})

describe('regroupement des clôtures par journée', () => {
  test('rend toujours trois journées, même sans aucun shift', () => {
    assert.equal(typeof grouperShiftsParJour, 'function')
    const groupes = grouperShiftsParJour([], new Date('2026-09-25T10:00:00'))
    assert.equal(groupes.length, 3)
    assert.deepEqual(groupes.map(g => g.date), ['2026-09-25', '2026-09-24', '2026-09-23'])
    assert.deepEqual(groupes.map(g => g.shifts.length), [0, 0, 0])
  })

  test('garde une journée vide entre deux journées remplies', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'a', date: '2026-09-25', heure_debut: '08:00' }),
      clotureValide({ id: 'b', date: '2026-09-23', heure_debut: '08:00' }),
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes.map(g => g.shifts.length), [1, 0, 1])
  })

  test('écarte les shifts non validés et ceux qui ne viennent pas du POS', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'ok', date: '2026-09-25', heure_debut: '08:00' }),
      { id: 'ouvert', date: '2026-09-25', heure_debut: '09:00', pos_service_id: 'service-ouvert', valide: false },
      { id: 'manuel', date: '2026-09-25', heure_debut: '10:00', valide: true, pos_service_id: null, ecart_reconciliation: null },
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes[0].shifts.map(s => s.id), ['ok'])
  })

  test('dédoublonne deux remontées du même service POS', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'un', date: '2026-09-25', heure_debut: '08:00', pos_service_id: 'service-x' }),
      clotureValide({ id: 'deux', date: '2026-09-25', heure_debut: '08:00', pos_service_id: 'service-x' }),
    ], new Date('2026-09-25T10:00:00'))

    assert.equal(groupes[0].shifts.length, 1)
  })

  test('trie les shifts d’une journée par heure de début', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'soir', date: '2026-09-25', heure_debut: '16:00' }),
      clotureValide({ id: 'matin', date: '2026-09-25', heure_debut: '08:00' }),
      clotureValide({ id: 'sans-heure', date: '2026-09-25', heure_debut: null }),
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes[0].shifts.map(s => s.id), ['matin', 'soir', 'sans-heure'])
  })

  test('ignore une clôture hors des trois journées', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'vieux', date: '2026-09-20', heure_debut: '08:00' }),
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes.map(g => g.shifts.length), [0, 0, 0])
  })

  test('conserve l’écart global calculé par cloturesPOS', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'a', date: '2026-09-25', heure_debut: '08:00', ecart_reconciliation: -2500, ecart_pos: 0 }),
    ], new Date('2026-09-25T10:00:00'))

    assert.equal(groupes[0].shifts[0].ecartGlobal, -2500)
    assert.equal(groupes[0].shifts[0].ecartGlobalTexte, '-2 500 FCFA')
  })
})

describe('badge « sans explication »', () => {
  test('l’écart qui appelle une explication est celui du comptage de caisse', () => {
    assert.equal(typeof aBesoinExplication, 'function')
    assert.equal(aBesoinExplication({ ecartEspeces: -2500, explication_ecart: null }), true)
    assert.equal(aBesoinExplication({ ecartEspeces: -2500, explication_ecart: '   ' }), true)
    assert.equal(aBesoinExplication({ ecartEspeces: 3350, explication_ecart: null }), true)
  })

  test('un écart expliqué, nul ou indisponible ne demande rien', () => {
    assert.equal(aBesoinExplication({ ecartEspeces: -2500, explication_ecart: 'erreur compter' }), false)
    assert.equal(aBesoinExplication({ ecartEspeces: 0, explication_ecart: null }), false)
    assert.equal(aBesoinExplication({ ecartEspeces: null, explication_ecart: null }), false)
  })

  test('l’écart du rapport Z, toujours nul en base, ne déclenche pas le badge', () => {
    assert.equal(aBesoinExplication({ ecartGlobal: -2500, ecartEspeces: 0, explication_ecart: null }), false)
  })
})
