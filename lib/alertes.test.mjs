// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/alertes.js — les alertes envoyées à M. Zreik.
// Une alerte fausse use la confiance ; une alerte répétée à chaque validation
// de point aussi. D'où les clés stables et le filtre des alertes déjà envoyées.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { calculerAlertes, alertesNouvelles, moisTerminePrecedent, derniersPoints, fondLaisse } from './alertes.js'

const nomResto = id => ({ kms: 'KMS', lvg: 'LVG', oasis: 'OASIS' }[id] || id)

describe('déficit', () => {
  test('seulement le dernier mois terminé', () => {
    const a = calculerAlertes({
      aujourdhui: '2026-10-01', nomResto,
      resultats: {
        oasis: { '2026-09': { net: -215000 }, '2026-10': { net: -40000 } },
        kms: { '2026-09': { net: 860000 } },
      },
    })
    assert.equal(a.length, 1)
    assert.equal(a[0].cle, 'deficit:oasis:2026-09')
    assert.match(a[0].message, /OASIS est déficitaire en septembre 2026 : -215 000 F/)
  })
  test('mois terminé précédent, passage d\'année', () => {
    assert.equal(moisTerminePrecedent('2027-01-03'), '2026-12')
  })
})

describe('CNPS', () => {
  const du = { id: 'c1', categorie: 'cnps', restaurant_id: 'kms', mois: '2026-07-01', montant_du: 412000, echeance: '2026-08-15' }
  test('plus de 60 jours de retard et pas soldée → alerte', () => {
    const a = calculerAlertes({ aujourdhui: '2026-10-21', cnps: [du], nomResto })
    assert.equal(a.length, 1)
    assert.equal(a[0].cle, 'cnps:c1')
    assert.match(a[0].message, /impayée depuis 67 jours \(412 000 F\)/)
  })
  test('60 jours pile : pas encore', () => {
    assert.equal(calculerAlertes({ aujourdhui: '2026-10-14', cnps: [du] }).length, 0)
  })
  test('soldée : rien', () => {
    assert.equal(calculerAlertes({ aujourdhui: '2026-12-01', cnps: [du], paiements: [{ du_id: 'c1', montant: 412000 }] }).length, 0)
  })
  test('un paiement partiel laisse l\'alerte, avec le reste', () => {
    const a = calculerAlertes({ aujourdhui: '2026-10-21', cnps: [du], paiements: [{ du_id: 'c1', montant: 12000 }], nomResto })
    assert.match(a[0].message, /400 000 F/)
  })
})

describe('fond', () => {
  const points = [
    { restaurant_id: 'lvg', date: '2026-09-29', valide: true, reste_fc: 150000, ajustement_fond: 0 },
    { restaurant_id: 'lvg', date: '2026-09-30', valide: true, reste_fc: 30000, ajustement_fond: 8000 },
    { restaurant_id: 'kms', date: '2026-09-30', valide: true, reste_fc: 120000, ajustement_fond: 0 },
    // Point du jour ouvert mais pas encore validé : tout à 0, ne doit jamais compter.
    { restaurant_id: 'lvg', date: '2026-10-01', valide: false, reste_fc: 0, ajustement_fond: 0 },
    { restaurant_id: 'kms', date: '2026-10-01', valide: false, reste_fc: 0, ajustement_fond: 0 },
  ]
  test('dernier point sous le plafond → rajouter la différence', () => {
    const a = calculerAlertes({
      aujourdhui: '2026-10-01', points, nomResto,
      plafonds: [{ restaurant_id: 'lvg', plafond: 100000 }, { restaurant_id: 'kms', plafond: 100000 }],
    })
    assert.equal(a.length, 1)
    assert.equal(a[0].cle, 'fond:lvg:2026-09-30')
    assert.match(a[0].message, /fond de la veille 38 000 F, plafond 100 000 F → rajouter 62 000 F/)
  })
  test('fond de la veille négatif : affiché tel quel, on rajoute jusqu\'au plafond', () => {
    const a = calculerAlertes({
      aujourdhui: '2026-10-05', nomResto, plafonds: [{ restaurant_id: 'pal', plafond: 500000 }],
      points: [{ restaurant_id: 'pal', date: '2026-10-04', valide: true, reste_fc: -3082867, ajustement_fond: 0 }],
    })
    assert.match(a[0].message, /fond de la veille -3 082 867 F, plafond 500 000 F → rajouter 3 582 867 F/)
  })
  test('l\'alerte porte la valeur du fond (bouton « Remettre à 0 »)', () => {
    const a = calculerAlertes({
      aujourdhui: '2026-10-12', nomResto, plafonds: [{ restaurant_id: 'kms', plafond: 300000 }],
      points: [{ restaurant_id: 'kms', date: '2026-10-11', valide: true, reste_fc: -1248460, ajustement_fond: 0 }],
    })
    assert.equal(a[0].type, 'fond')
    assert.equal(a[0].fond, -1248460)
  })
  test('sans plafond réglé : pas d\'alerte', () => {
    assert.equal(calculerAlertes({ aujourdhui: '2026-10-01', points, plafonds: [] }).length, 0)
  })
  test('dernier point VALIDÉ par restaurant : le point du jour encore vide est ignoré', () => {
    assert.equal(derniersPoints(points).lvg.date, '2026-09-30')
    assert.equal(derniersPoints(points).kms.date, '2026-09-30')
  })
  test('fond laissé = reste FC + ajustement du fond (le FC de la veille du lendemain)', () => {
    assert.equal(fondLaisse({ reste_fc: 30000, ajustement_fond: 8000 }), 38000)
    assert.equal(fondLaisse({ reste_fc: '77693', ajustement_fond: '13300' }), 90993)
  })
})

describe('envoi unique', () => {
  test('les clés déjà envoyées sont filtrées', () => {
    const a = [{ cle: 'a' }, { cle: 'b' }]
    assert.deepEqual(alertesNouvelles(a, ['a']), [{ cle: 'b' }])
  })
})
