// Tests de lib/alertesStock.js — échéances, hausse réelle, textes, destinataires.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DELAIS_ALERTE, corpsAlerte, datesUtiles, editionPrecedente, elementsAlerte, hausseGroupe, hausseRestaurant, itemsPour,
  joursReference, regrouper, titreAlerte, ventesParRestaurant,
} from './alertesStock.js'

const ferie = (o = {}) => ({
  id: 'e1', titre: 'Tabaski', date_evenement: '2027-05-16', chaque_annee: false, restaurant_id: null,
  ferie_cle: 'tabaski', ferie_annee: 2027, date_estimee: true, alerte_stock: true, ...o,
})

test('elementsAlerte : exactement J-7 et J-2, alerte active seulement', () => {
  const evts = [
    ferie({ id: 'a', date_evenement: '2027-05-16' }),
    ferie({ id: 'b', date_evenement: '2027-05-11' }),
    ferie({ id: 'c', date_evenement: '2027-05-12' }),
    ferie({ id: 'd', date_evenement: '2027-05-16', alerte_stock: false }),
  ]
  const r = elementsAlerte(evts, '2027-05-09', DELAIS_ALERTE)
  assert.deepEqual(r.map(x => [x.evenement.id, x.delai]), [['b', 2], ['a', 7]])
})

test('elementsAlerte : un événement « chaque année » suit sa prochaine date', () => {
  const r = elementsAlerte([ferie({ id: 'n', ferie_cle: null, ferie_annee: null, date_evenement: '2020-12-25', chaque_annee: true })], '2026-12-18', DELAIS_ALERTE)
  assert.deepEqual(r.map(x => [x.date, x.delai]), [['2026-12-25', 7]])
})

test('editionPrecedente : une date lunaire doit être confirmée', () => {
  const t = ferie()
  assert.equal(editionPrecedente(t, '2027-05-16', []), null)
  const estimee = ferie({ id: 'p', ferie_annee: 2026, date_evenement: '2026-05-27', date_estimee: true })
  assert.equal(editionPrecedente(t, '2027-05-16', [estimee]), null)
  const confirmee = { ...estimee, date_estimee: false }
  assert.equal(editionPrecedente(t, '2027-05-16', [confirmee]), '2026-05-27')
})

test('editionPrecedente : fête fixe ou calculée sans ligne en base', () => {
  const noel = ferie({ ferie_cle: 'noel', ferie_annee: 2026, date_evenement: '2026-12-25', date_estimee: false })
  assert.equal(editionPrecedente(noel, '2026-12-25', []), '2025-12-25')
  const paques = ferie({ ferie_cle: 'lundi_paques', ferie_annee: 2027, date_evenement: '2027-03-29', date_estimee: false })
  assert.equal(editionPrecedente(paques, '2027-03-29', []), '2026-04-06')
})

test('editionPrecedente : événement à la main', () => {
  const base = { id: 'm', ferie_cle: null, ferie_annee: null, restaurant_id: null, alerte_stock: true }
  assert.equal(editionPrecedente({ ...base, chaque_annee: true }, '2026-12-31', []), '2025-12-31')
  assert.equal(editionPrecedente({ ...base, chaque_annee: false }, '2026-12-31', []), null)
})

test('joursReference : 4 mêmes jours de semaine, sans les jours fériés', () => {
  assert.deepEqual(joursReference('2026-05-27'), ['2026-05-20', '2026-05-13', '2026-05-06', '2026-04-29'])
  assert.deepEqual(joursReference('2027-01-01'), ['2026-12-18', '2026-12-11', '2026-12-04'])
})

test('ventesParRestaurant : vente machine, sinon théorique', () => {
  const v = ventesParRestaurant([
    { restaurant_id: 'r1', date: '2026-05-27', vente_machine: 500, vente_total: 400 },
    { restaurant_id: 'r1', date: '2026-05-20', vente_machine: 0, vente_total: 300 },
  ])
  assert.deepEqual(v, { r1: { '2026-05-27': 500, '2026-05-20': 300 } })
})

const ventesFete = {
  '2026-05-27': 4500, '2026-05-20': 3000, '2026-05-13': 3000, '2026-05-06': 3000, '2026-04-29': 3000,
}

test('hausseRestaurant : pourcentage réel, ou rien si les données manquent', () => {
  assert.equal(hausseRestaurant(ventesFete, '2026-05-27'), 50)
  assert.equal(hausseRestaurant({ ...ventesFete, '2026-05-27': 0 }, '2026-05-27'), null)
  assert.equal(hausseRestaurant({ '2026-05-27': 4500, '2026-05-20': 3000 }, '2026-05-27'), null)
  assert.equal(hausseRestaurant({ '2026-05-27': 4500, '2026-05-20': 3000, '2026-05-13': 1000 }, '2026-05-27'), 125)
})

test('hausseGroupe : sommes des restaurants qui ont un chiffre, et leur nombre', () => {
  const r = hausseGroupe({
    r1: ventesFete,
    r2: { '2026-05-27': 1500, '2026-05-20': 1000, '2026-05-13': 1000 },
    r3: { '2026-05-27': 9000 },
  }, '2026-05-27')
  assert.deepEqual(r, { pct: 50, nb: 2 })
  assert.deepEqual(hausseGroupe({}, '2026-05-27'), { pct: null, nb: 0 })
})

test('datesUtiles : édition précédente et ses jours de référence, sans doublon', () => {
  const noel = ferie({ ferie_cle: 'noel', ferie_annee: 2026, date_evenement: '2026-12-25', date_estimee: false })
  const dates = datesUtiles([{ evenement: noel, date: '2026-12-25', delai: 7 }, { evenement: noel, date: '2026-12-25', delai: 2 }], [])
  assert.deepEqual(dates, ['2025-11-27', '2025-12-04', '2025-12-11', '2025-12-18', '2025-12-25'])
  assert.deepEqual(datesUtiles([{ evenement: ferie(), date: '2027-05-16', delai: 7 }], []), [])
})

test('titreAlerte : délai en clair et date estimée', () => {
  assert.equal(titreAlerte('Tabaski', 7, true), '📦 Tabaski dans 7 jours (date estimée)')
  assert.equal(titreAlerte('Noël', 2, false), '📦 Noël après-demain')
  assert.equal(titreAlerte('Noël', 1, false), '📦 Noël demain')
  assert.equal(titreAlerte('Noël', 0, false), "📦 Noël aujourd'hui")
})

test('corpsAlerte : quatre cas, jamais de quantité', () => {
  assert.equal(corpsAlerte({ pct: 45 }), "L'an dernier ce jour-là : +45 % de ventes. Pensez à rehausser le stock.")
  assert.equal(corpsAlerte({ pct: 10 }), "L'an dernier ce jour-là : +10 % de ventes. Pensez à rehausser le stock.")
  assert.equal(corpsAlerte({ pct: 9 }), "L'an dernier ce jour-là : ventes proches d'un jour normal. Vérifiez votre stock.")
  assert.equal(corpsAlerte({ pct: -9 }), "L'an dernier ce jour-là : ventes proches d'un jour normal. Vérifiez votre stock.")
  assert.equal(corpsAlerte({ pct: -10 }), "L'an dernier ce jour-là : −10 % de ventes. Vérifiez votre stock avant de commander.")
  assert.equal(corpsAlerte({ pct: null }), 'Pensez à vérifier et rehausser le stock.')
  assert.equal(corpsAlerte({ pct: 45, nb: 7 }), "L'an dernier ce jour-là : +45 % de ventes (7 restaurants). Pensez à rehausser le stock.")
  assert.equal(corpsAlerte({ pct: 45, nb: 1 }), "L'an dernier ce jour-là : +45 % de ventes (1 restaurant). Pensez à rehausser le stock.")
})

const contexte = () => {
  const passe = ferie({ id: 'p', ferie_annee: 2026, date_evenement: '2026-05-27', date_estimee: false })
  return {
    elements: [{ evenement: ferie(), date: '2027-05-16', delai: 7 }],
    evenements: [passe],
    ventes: { r1: ventesFete, r2: { '2026-05-27': 1000, '2026-05-20': 1000, '2026-05-13': 1000 } },
  }
}

test('itemsPour : le gérant a le chiffre de son restaurant', () => {
  const [i] = itemsPour({ id: 'g', role: 'gerant', restaurant_id: 'r1' }, contexte())
  assert.equal(i.cle, 'stock|e1|2027-05-16|7|g')
  assert.equal(i.titre, '📦 Tabaski dans 7 jours (date estimée)')
  assert.equal(i.corps, "L'an dernier ce jour-là : +50 % de ventes. Pensez à rehausser le stock.")
})

test('itemsPour : la direction et la RH ont le chiffre du groupe', () => {
  for (const role of ['manager', 'directeur', 'rh']) {
    const [i] = itemsPour({ id: 'd', role, restaurant_id: null }, contexte())
    assert.match(i.corps, /\+38 % de ventes \(2 restaurants\)/)
  }
})

test('itemsPour : un événement d\'un restaurant n\'alerte pas les autres gérants', () => {
  const c = contexte()
  c.elements = [{ evenement: ferie({ restaurant_id: 'r1' }), date: '2027-05-16', delai: 7 }]
  assert.equal(itemsPour({ id: 'g2', role: 'gerant', restaurant_id: 'r2' }, c).length, 0)
  assert.equal(itemsPour({ id: 'g1', role: 'gerant', restaurant_id: 'r1' }, c).length, 1)
  assert.match(itemsPour({ id: 'd', role: 'manager', restaurant_id: null }, c)[0].corps, /\+50 % de ventes\. /)
})

test('itemsPour : caissier ou gérant sans restaurant ne reçoivent rien', () => {
  assert.equal(itemsPour({ id: 'c', role: 'caissier', restaurant_id: 'r1' }, contexte()).length, 0)
  assert.equal(itemsPour({ id: 'g', role: 'gerant', restaurant_id: null }, contexte()).length, 0)
})

test('regrouper : un message par personne', () => {
  assert.equal(regrouper([]), null)
  assert.deepEqual(regrouper([{ cle: 'a', titre: 'T', corps: 'C' }]), { titre: 'T', corps: 'C' })
  assert.deepEqual(
    regrouper([{ cle: 'a', titre: '📦 Tabaski dans 7 jours', corps: 'C1' }, { cle: 'b', titre: '📦 Noël après-demain', corps: 'C2' }]),
    { titre: '📦 2 fêtes approchent', corps: 'Tabaski dans 7 jours : C1\nNoël après-demain : C2' },
  )
})
