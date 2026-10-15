// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/supervision.js — note des visites, note du restaurant (60/40),
// tâches faites à temps, contrôles avant de terminer une visite, notes terrain.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  dureeVisite, etatTache, explicationNote, joursEntre, manquesVisite, moyenneCaissiers, noteRestaurant,
  noteRetenueVisite, noteVisite, notesTravailleurs, partTachesATemps,
} from './supervision.js'

const AUJ = '2026-10-15'

describe('noteVisite', () => {
  test('5 étoiles partout = 20, 1 étoile partout = 0', () => {
    assert.equal(noteVisite([{ poids: 3, note: 5 }, { poids: 2, note: 5 }]), 20)
    assert.equal(noteVisite([{ poids: 3, note: 1 }, { poids: 2, note: 1 }]), 0)
  })
  test('pondérée par le poids, arrondie au demi-point', () => {
    // propreté poids 3 à 5★ (plein), documents poids 1 à 1★ (zéro) → 3/4 × 20 = 15
    assert.equal(noteVisite([{ poids: 3, note: 5 }, { poids: 1, note: 1 }]), 15)
    // 3★ = moitié → 10
    assert.equal(noteVisite([{ poids: 2, note: 3 }]), 10)
  })
  test('rien de noté = pas de note', () => {
    assert.equal(noteVisite([]), null)
    assert.equal(noteVisite([{ poids: 2, note: 0 }]), null)
  })
})

describe('noteRetenueVisite', () => {
  test('la note corrigée remplace la note si la contestation est acceptée', () => {
    assert.equal(noteRetenueVisite({ note: 8, decision: 'corrigee', note_corrigee: 12 }), 12)
    assert.equal(noteRetenueVisite({ note: 8, decision: 'maintenue', note_corrigee: 12 }), 8)
    assert.equal(noteRetenueVisite({ note: null }), null)
  })
})

describe('manquesVisite', () => {
  const criteres = [{ id: 'a', libelle: 'Propreté' }, { id: 'b', libelle: 'Documents' }]
  test('chaque point doit être noté', () => {
    assert.deepEqual(manquesVisite({ criteres, notes: { a: { note: 4 } } }), ['Noter « Documents »'])
  })
  test('note basse sans photo et point grave sans explication', () => {
    const m = manquesVisite({ criteres, notes: { a: { note: 2 }, b: { note: 4, grave: true } } })
    assert.deepEqual(m, ['Photo obligatoire : « Propreté » (note basse)', 'Expliquer le point grave : « Documents »'])
  })
  test('tâche importante : photo du constat, et photo pour la confirmer si le gérant n\'en a pas mis', () => {
    const m = manquesVisite({
      criteres: [],
      nouvelles: [{ titre: 'Hotte', importante: true }, { titre: '' }],
      confirmees: [{ titre: 'Frigo', importante: true }, { titre: 'Sol', importante: true, signalee_photo_url: 'x' }],
    })
    assert.deepEqual(m, [
      'Photo obligatoire : tâche importante « Hotte »',
      'Une nouvelle tâche n\'a pas de titre',
      'Photo obligatoire pour confirmer « Frigo »',
    ])
  })
  test('tout est bon = aucun manque', () => {
    assert.deepEqual(manquesVisite({ criteres, notes: { a: { note: 2, photo_url: 'p' }, b: { note: 5 } } }), [])
  })
})

describe('tâches', () => {
  test('état : signalée = à confirmer, échéance passée = en retard', () => {
    assert.equal(etatTache({ statut: 'signalee', echeance: '2026-10-01' }, AUJ), 'a_confirmer')
    assert.equal(etatTache({ statut: 'a_faire', echeance: '2026-10-14' }, AUJ), 'en_retard')
    assert.equal(etatTache({ statut: 'a_faire', echeance: '2026-10-15' }, AUJ), 'a_faire')
    assert.equal(etatTache({ statut: 'faite', echeance: '2026-10-01' }, AUJ), 'faite')
  })
  test('à temps = signalée ou confirmée au plus tard le jour de l\'échéance', () => {
    const taches = [
      { statut: 'faite', echeance: '2026-10-10', signalee_at: '2026-10-09T10:00:00Z', faite_at: '2026-10-12T10:00:00Z' },
      { statut: 'faite', echeance: '2026-10-10', faite_at: '2026-10-11T10:00:00Z' },
      { statut: 'a_faire', echeance: '2026-10-12' },
      { statut: 'annulee', echeance: '2026-10-12' },
      { statut: 'a_faire', echeance: '2026-10-20' }, // pas encore échue
    ]
    assert.deepEqual(partTachesATemps(taches, '2026-09-16', AUJ), { applicable: true, ratio: 1 / 3, nbEchues: 3, nbATemps: 1 })
  })
  test('aucune tâche échue = critère neutre', () => {
    assert.equal(partTachesATemps([{ statut: 'a_faire', echeance: '2026-11-01' }], '2026-09-16', AUJ).applicable, false)
  })
})

describe('moyenneCaissiers', () => {
  test('pondérée par les shifts, seulement les caissiers notés du restaurant', () => {
    const notes = [
      { restaurantId: 'r1', note: 16, nbShifts: 30 },
      { restaurantId: 'r1', note: 10, nbShifts: 10 },
      { restaurantId: 'r1', note: null, nbShifts: 3 },
      { restaurantId: 'r2', note: 2, nbShifts: 30 },
    ]
    assert.deepEqual(moyenneCaissiers(notes, 'r1'), { note: 14.5, nb: 2 })
    assert.deepEqual(moyenneCaissiers(notes, 'r9'), { note: null, nb: 0 })
  })
})

describe('noteRestaurant', () => {
  const visite = o => ({ restaurant_id: 'r1', statut: 'terminee', debut_at: '2026-10-10T09:00:00Z', fin_at: '2026-10-10T10:00:00Z', note: 15, ...o })
  test('60 % visites + 40 % données', () => {
    const r = noteRestaurant({
      restaurantId: 'r1', aujourdhui: AUJ,
      visites: [visite({ note: 15 }), visite({ note: 17, fin_at: '2026-10-01T10:00:00Z' })],
      notesCaissiers: [{ restaurantId: 'r1', note: 12, nbShifts: 20 }],
    })
    assert.equal(r.visites.note, 16)
    assert.equal(r.donnees.note, 12)
    assert.equal(r.note, 14.5) // 0,6 × 16 + 0,4 × 12 = 14,4 → 14,5
    assert.equal(r.derniereVisite, '2026-10-10')
    assert.equal(r.joursSansVisite, 5)
    assert.equal(r.sansVisite, false)
  })
  test('les tâches à temps pèsent un quart des données', () => {
    const r = noteRestaurant({
      restaurantId: 'r1', aujourdhui: AUJ, visites: [],
      notesCaissiers: [{ restaurantId: 'r1', note: 16, nbShifts: 20 }],
      taches: [{ restaurant_id: 'r1', statut: 'a_faire', echeance: '2026-10-10' }],
    })
    assert.equal(r.donnees.note, 12) // 0,75 × 16 + 0,25 × 0
    assert.equal(r.note, 12)         // pas de visite : données seules
    assert.equal(r.sansVisite, true)
  })
  test('visite trop ancienne, en cours ou d\'un autre restaurant ignorée', () => {
    const r = noteRestaurant({
      restaurantId: 'r1', aujourdhui: AUJ,
      visites: [
        visite({ fin_at: '2026-09-01T10:00:00Z', note: 4 }),
        visite({ statut: 'en_cours', note: null, fin_at: null }),
        visite({ restaurant_id: 'r2', note: 2 }),
      ],
    })
    assert.equal(r.visites.nb, 0)
    assert.equal(r.note, null)
    assert.equal(r.derniereVisite, '2026-09-01')
    assert.equal(r.sansVisite, true) // 44 jours
  })
  test('note corrigée par le manager prise en compte', () => {
    const r = noteRestaurant({ restaurantId: 'r1', aujourdhui: AUJ, visites: [visite({ note: 6, decision: 'corrigee', note_corrigee: 14 })] })
    assert.equal(r.note, 14)
  })
  test('explication lisible', () => {
    const r = noteRestaurant({ restaurantId: 'r1', aujourdhui: AUJ, visites: [visite({ note: 15 })], notesCaissiers: [{ restaurantId: 'r1', note: 12.5, nbShifts: 9 }] })
    assert.equal(explicationNote(r), 'visites 15 (1) × 60 % + données 12,5 × 40 %')
  })
})

describe('notesTravailleurs', () => {
  test('moyenne des étoiles, retards et absences, dernier commentaire', () => {
    const res = notesTravailleurs([
      { travailleur_id: 't1', travailleur_nom: 'Awa', restaurant_id: 'r1', note: 4, en_retard: true, created_at: '2026-10-01T09:00:00Z', commentaire: 'ok' },
      { travailleur_id: 't1', travailleur_nom: 'Awa', restaurant_id: 'r1', note: 3, created_at: '2026-10-10T09:00:00Z', commentaire: 'tenue sale' },
      { travailleur_id: 't1', travailleur_nom: 'Awa', restaurant_id: 'r1', absent: true, created_at: '2026-10-05T09:00:00Z' },
      { travailleur_id: 't2', travailleur_nom: 'Koffi', restaurant_id: 'r1', note: 5, created_at: '2026-10-10T09:00:00Z' },
    ])
    assert.equal(res[0].nom, 'Awa')
    assert.equal(res[0].moyenne, 3.5)
    assert.equal(res[0].retards, 1)
    assert.equal(res[0].absences, 1)
    assert.equal(res[0].nbVisites, 3)
    assert.equal(res[0].dernierCommentaire, 'tenue sale')
    assert.equal(res[1].moyenne, 5)
  })
})

describe('utilitaires', () => {
  test('durée et jours', () => {
    assert.equal(dureeVisite('2026-10-10T09:00:00Z', '2026-10-10T09:45:00Z'), '45 min')
    assert.equal(dureeVisite('2026-10-10T09:00:00Z', '2026-10-10T10:20:00Z'), '1 h 20')
    assert.equal(dureeVisite('2026-10-10T09:00:00Z', null), null)
    assert.equal(joursEntre('2026-10-10', '2026-10-15T08:00:00Z'), 5)
  })
})
