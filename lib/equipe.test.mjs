// Tests de lib/equipe.js — Équipe globale (fusion avec l'ex-écran RH).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  correspondRecherche, dedupPresences, feuillesExcel, friseJours, lignesPaiesGerant, migrerIdsTuiles,
  plageDates, rattacherPaiesGerant, statsGlobales, statsParTravailleur, statsTravailleur, tauxParRestaurant, titrePeriode,
} from './equipe.js'

const A = 'resto-a'
const B = 'resto-b'
const pres = (travailleur_id, point_id, date, statut, paye = 0, restaurant_id = A, travailleur_nom = travailleur_id) =>
  ({ travailleur_id, point_id, date, statut, paye, restaurant_id, travailleur_nom })

describe('accès : tuile RH fusionnée', () => {
  test('rh devient equipe, sans doublon et en gardant l\'ordre', () => {
    assert.deepEqual(migrerIdsTuiles(['tresorerie', 'rh', 'contrats']), ['tresorerie', 'equipe', 'contrats', 'embauches'])
    assert.deepEqual(migrerIdsTuiles(['tresorerie', 'equipe', 'rh', 'contrats']), ['tresorerie', 'equipe', 'contrats', 'embauches'])
    // Nouveaux travailleurs : suit Contrats, sans doublon s'il est déjà là.
    assert.deepEqual(migrerIdsTuiles(['embauches', 'contrats']), ['embauches', 'contrats'])
    assert.deepEqual(migrerIdsTuiles(['equipe']), ['equipe'])
    assert.deepEqual(migrerIdsTuiles(undefined), [])
  })
})

describe('périodes', () => {
  const jour = new Date('2026-10-03T12:00:00Z')
  test('7 jours, ce mois, mois précédent', () => {
    assert.deepEqual(plageDates('7days', {}, jour), { debut: '2026-09-27', fin: '2026-10-03' })
    assert.deepEqual(plageDates('month', {}, jour), { debut: '2026-10-01', fin: '2026-10-03' })
    assert.deepEqual(plageDates('lastmonth', {}, jour), { debut: '2026-09-01', fin: '2026-09-30' })
  })
  test('période perso incomplète = null', () => {
    assert.equal(plageDates('custom', { debut: '2026-09-01' }, jour), null)
    assert.deepEqual(plageDates('custom', { debut: '2026-09-01', fin: '2026-09-10' }, jour), { debut: '2026-09-01', fin: '2026-09-10' })
    assert.equal(titrePeriode('custom', { debut: '2026-09-01', fin: '2026-09-10' }), '1 sep 2026 → 10 sep 2026')
  })
})

describe('présences', () => {
  test('deux shifts le même jour = un jour, présent l\'emporte, paies additionnées', () => {
    const d = dedupPresences([pres('t1', 'p1', '2026-09-01', 'Absent', 0), pres('t1', 'p1', '2026-09-01', 'Présent', '3000')])
    assert.equal(d.length, 1)
    assert.equal(d[0].statut, 'Présent')
    assert.equal(d[0].paye, 3000)
  })

  test('stats par travailleur : taux, paie, travailleur parti gardé sous son nom', () => {
    const travailleurs = [{ id: 't1', nom: 'Awa', poste: 'Serveuse', restaurant_id: A }]
    const p = [
      pres('t1', 'p1', '2026-09-01', 'Présent', 3000),
      pres('t1', 'p2', '2026-09-02', 'Absent'),
      pres('t9', 'p1', '2026-09-01', 'Présent', 2000, B, 'Koffi'),
    ]
    const s = statsParTravailleur(travailleurs, p)
    const awa = s.find(x => x.id === 't1')
    assert.equal(awa.present, 1)
    assert.equal(awa.absent, 1)
    assert.equal(awa.taux, 50)
    assert.equal(awa.totalPaye, 3000)
    const koffi = s.find(x => x.id === 't9')
    assert.equal(koffi.nom, 'Koffi')
    assert.equal(koffi.restaurant_id, B)
  })

  test('un travailleur sans aucun jour n\'apparaît pas', () => {
    assert.equal(statsParTravailleur([{ id: 't1', nom: 'Awa' }], []).length, 0)
  })

  test('stats globales additionnent paies présences et paies gérant', () => {
    const g = statsGlobales(
      [{ id: 't1', nom: 'Awa' }],
      [pres('t1', 'p1', '2026-09-01', 'Présent', 3000), pres('t1', 'p2', '2026-09-02', 'Repos')],
      [{ montant: 7000 }, { montant: '500' }],
    )
    assert.equal(g.totalPresences, 1)
    assert.equal(g.totalAutres, 1)
    assert.equal(g.totalPayePresences, 3000)
    assert.equal(g.totalPayeGerant, 7500)
    assert.equal(g.totalPaye, 10500)
    assert.equal(g.nbJours, 2)
  })

  test('« Non pointé » est compté à part, hors du taux', () => {
    const s = statsTravailleur([
      pres('t1', 'p1', '2026-09-01', 'Présent', 3000),
      pres('t1', 'p2', '2026-09-02', 'Non pointé'),
      pres('t1', 'p3', '2026-09-03', 'Absent'),
    ])
    assert.equal(s.nonPointe, 1)
    assert.equal(s.total, 2)
    assert.equal(s.taux, 50)
    const g = statsGlobales([{ id: 't1', nom: 'Awa' }], [pres('t1', 'p2', '2026-09-02', 'Non pointé')], [])
    assert.equal(g.totalNonPointe, 1)
    assert.equal(g.taux, 0)
  })

  test('fiche d\'un travailleur', () => {
    const s = statsTravailleur([pres('t1', 'p1', '2026-09-01', 'Présent', 3000), pres('t1', 'p2', '2026-09-02', 'Malade')])
    assert.equal(s.total, 2)
    assert.equal(s.taux, 50)
    assert.equal(s.malade, 1)
  })
})

describe('vue « Tous »', () => {
  test('taux par restaurant, du meilleur au moins bon, restaurants sans donnée exclus', () => {
    const restos = [{ id: A, nom: 'Alpha' }, { id: B, nom: 'Bravo' }, { id: 'c', nom: 'Charlie' }]
    const p = [
      pres('t1', 'p1', '2026-09-01', 'Absent', 0, A),
      pres('t2', 'p2', '2026-09-01', 'Présent', 0, B),
      pres('t3', 'p2', '2026-09-01', 'Présent', 0, B),
      pres('t4', 'p1', '2026-09-01', 'Présent', 0, A),
    ]
    const t = tauxParRestaurant(restos, p)
    assert.deepEqual(t.map(x => [x.nom, x.taux]), [['Bravo', 100], ['Alpha', 50]])
  })

  test('paies gérant : deux homonymes de restaurants différents restent séparés', () => {
    const noms = { [A]: 'Alpha', [B]: 'Bravo' }
    const l = lignesPaiesGerant(
      [{ libelle: 'Yao', montant: 1000, restaurant_id: A }, { libelle: 'Yao', montant: 2000, restaurant_id: B }, { libelle: 'Yao', montant: 500, restaurant_id: A }],
      id => noms[id],
    )
    assert.deepEqual(l, [{ nom: 'Yao', restaurant: 'Bravo', montant: 2000 }, { nom: 'Yao', restaurant: 'Alpha', montant: 1500 }])
  })

  test('export Excel : colonne Restaurant seulement en vue « Tous »', () => {
    const base = {
      travailleurs: [{ id: 't1', nom: 'Awa', poste: 'Serveuse', restaurant_id: A }],
      presences: [pres('t1', 'p1', '2026-09-01', 'Présent', 3000)],
      paiesGerant: [],
      nomResto: () => 'Alpha',
    }
    const un = feuillesExcel({ ...base, tous: false })
    assert.equal(un.resume[0][1], 'Poste')
    const tous = feuillesExcel({ ...base, tous: true })
    assert.equal(tous.resume[0][1], 'Restaurant')
    assert.equal(tous.resume[1][1], 'Alpha')
    assert.equal(tous.detail[1][1], 'Alpha')
    const deduit = feuillesExcel({ ...base, presences: [{ ...base.presences[0], statut: 'Absent', deduit: true }], tous: false })
    assert.equal(deduit.detail[1][2], 'Absent (déduit)')
    assert.equal(tous.salaires[1][4], 3000)
    // Les lignes TOTAL gardent le même nombre de colonnes que l'en-tête.
    assert.equal(tous.resume.at(-1).length, tous.resume[0].length)
    assert.equal(tous.salaires.at(-1).length, tous.salaires[0].length)
  })
})

describe('recherche et frise', () => {
  test('recherche sans tenir compte des accents ni de la casse', () => {
    assert.equal(correspondRecherche('kouame', 'Kouamé Assi', 'Serveur'), true)
    assert.equal(correspondRecherche('CUISIN', 'Awa', 'Cuisinière'), true)
    assert.equal(correspondRecherche('zz', 'Awa', 'Serveuse'), false)
    assert.equal(correspondRecherche('  ', 'Awa'), true)
  })

  test('frise : une case par jour, jours sans pointage à null', () => {
    const f = friseJours([pres('t1', 'p1', '2026-09-30', 'Présent'), pres('t1', 'p2', '2026-09-28', 'Absent')], '2026-09-30', 3)
    assert.deepEqual(f, [
      { date: '2026-09-28', statut: 'Absent' },
      { date: '2026-09-29', statut: null },
      { date: '2026-09-30', statut: 'Présent' },
    ])
  })
})

describe('salaires payés par le gérant (Déductions gérant)', () => {
  const travailleurs = [
    { id: 't1', nom: 'Awa Koné', restaurant_id: A },
    { id: 't2', nom: 'Ibrahim', restaurant_id: B },
  ]
  const paie = (id, libelle, montant, restaurant_id = A, travailleur_id = null) =>
    ({ id, libelle, montant, restaurant_id, travailleur_id, date: '2026-10-01' })

  test('rattache par fiche, puis par nom (accents, casse, espaces ignorés)', () => {
    const r = rattacherPaiesGerant([
      paie('d1', 'Awa Koné', 3000, A, 't1'),
      paie('d2', '  AWA KONE ', 2000),
      paie('d3', 'Ibrahim', 1500, A),          // fiche dans un autre resto : nom unique → rattaché
      paie('d4', 'Inconnu', 1000),
    ], travailleurs)
    assert.deepEqual(r.map(d => d.travailleur_id), ['t1', 't1', 't2', null])
  })

  test('un homonyme dans deux restaurants n\'est rattaché que dans le bon', () => {
    const homonymes = [{ id: 'x1', nom: 'Moussa', restaurant_id: A }, { id: 'x2', nom: 'Moussa', restaurant_id: B }]
    const r = rattacherPaiesGerant([paie('d1', 'Moussa', 1000, B), paie('d2', 'Moussa', 1000, 'resto-c')], homonymes)
    assert.deepEqual(r.map(d => d.travailleur_id), ['x2', null])
  })

  test('un homonyme archivé dans un autre restaurant empêche de deviner ailleurs', () => {
    const fiches = [{ id: 'a1', nom: 'Moussa', restaurant_id: A }, { id: 'a2', nom: 'Moussa', restaurant_id: B, statut: 'archive' }]
    const r = rattacherPaiesGerant([paie('d1', 'Moussa', 1000, 'resto-c'), paie('d2', 'Moussa', 1000, A)], fiches)
    assert.deepEqual(r.map(d => d.travailleur_id), [null, 'a1'])
  })

  test('le total d\'un travailleur additionne présences et paies du gérant', () => {
    const paies = rattacherPaiesGerant([paie('d1', 'Awa Koné', 3000), paie('d2', 'Ibrahim', 2500, B)], travailleurs)
    const s = statsParTravailleur(travailleurs, [pres('t1', 'p1', '2026-10-01', 'Présent', 4000)], paies)
    const awa = s.find(t => t.id === 't1')
    assert.equal(awa.totalPayePresences, 4000)
    assert.equal(awa.totalPayeGerant, 3000)
    assert.equal(awa.totalPaye, 7000)
    // Payé par le gérant sans aucun jour pointé : il apparaît quand même.
    const ibrahim = s.find(t => t.id === 't2')
    assert.equal(ibrahim.totalPaye, 2500)
    assert.equal(ibrahim.jours, 0)
  })

  test('les totaux globaux ne comptent pas deux fois les paies du gérant', () => {
    const paies = rattacherPaiesGerant([paie('d1', 'Awa Koné', 3000), paie('d2', 'Inconnu', 1000)], travailleurs)
    const g = statsGlobales(travailleurs, [pres('t1', 'p1', '2026-10-01', 'Présent', 4000)], paies)
    assert.equal(g.totalPayePresences, 4000)
    assert.equal(g.totalPayeGerant, 4000)
    assert.equal(g.totalPaye, 8000)
  })
})
