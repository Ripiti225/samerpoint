// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/direction.js — coffre, dépenses direction, résultat net.
//
// Les pièges : un rechargement de fond compté comme une dépense rend un
// restaurant déficitaire à tort ; un investissement de groupe imputé à un
// restaurant aussi ; et le résultat doit reprendre exactement la formule de
// l'écran Charges, sinon deux écrans donnent deux chiffres.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATEGORIES_DIRECTION, compteDansResultat, soldeCoffre, objectifDuMois, progression,
  encaisseNetPoint, resultatsParRestoMois, derniersMois, bornesMois, depensesGroupeParMois,
  statutEmprunt, resteARembourser,
} from './direction.js'

describe('dépenses direction', () => {
  test('les six catégories de la feuille', () => {
    assert.deepEqual(CATEGORIES_DIRECTION.map(c => c.id),
      ['fond', 'fond_nature', 'reparation', 'materiel', 'equipement', 'investissement', 'retrait_perso', 'administratif'])
  })
  test('fournisseur administratif payé par la direction : charge du restaurant', () => {
    assert.equal(compteDansResultat({ categorie: 'administratif', restaurant_id: 'kms' }), true)
  })
  test('réparation, matériel, équipement d\'un restaurant comptent', () => {
    assert.equal(compteDansResultat({ categorie: 'reparation', restaurant_id: 'kms' }), true)
    assert.equal(compteDansResultat({ categorie: 'equipement', restaurant_id: 'kms' }), true)
  })
  test('fond, investissement, retrait perso ne comptent pas', () => {
    assert.equal(compteDansResultat({ categorie: 'fond', restaurant_id: 'kms' }), false)
    // Fond en nature : ne passe pas par le point, donc charge du restaurant.
    assert.equal(compteDansResultat({ categorie: 'fond_nature', restaurant_id: 'kms' }), true)
    assert.equal(compteDansResultat({ categorie: 'investissement', restaurant_id: 'kms' }), false)
    assert.equal(compteDansResultat({ categorie: 'retrait_perso', restaurant_id: null }), false)
  })
  test('une dépense de groupe ne touche aucun restaurant', () => {
    assert.equal(compteDansResultat({ categorie: 'materiel', restaurant_id: null }), false)
  })
})

describe('coffre', () => {
  test('solde = dépôts − retraits', () => {
    assert.equal(soldeCoffre([{ montant: 1800000 }, { montant: 700000 }, { montant: -300000 }]), 2200000)
  })
  test('objectif : celui du mois, sinon le dernier fixé avant', () => {
    const o = [{ mois: '2026-08-01', montant: 4000000 }, { mois: '2026-09-01', montant: 5000000 }]
    assert.equal(objectifDuMois(o, '2026-09-01'), 5000000)
    assert.equal(objectifDuMois(o, '2026-11-01'), 5000000)
    assert.equal(objectifDuMois(o, '2026-07-01'), 0)
  })
  test('progression en %', () => {
    assert.equal(progression(3200000, 5000000), 64)
    assert.equal(progression(100, 0), null)
    assert.equal(progression(-5, 100), 0)
  })
})

describe('résultat net', () => {
  test('encaissé net d\'un point = formule de l\'écran Charges', () => {
    const v = encaisseNetPoint(
      { yango_tab: 100000, glovo_tab: 100000, depenses_gerant_caisse_total: 20000 },
      [{ om: 10000, wave: 20000, djamo: 0, espece: 300000 }, { espece: 50000 }],
    )
    // 77 000 + 70 500 + 9 900 + 19 800 + 350 000 − 20 000
    assert.equal(Math.round(v), 507200)
  })

  test('encaissé − charges − dépenses direction comptées − pubs, par mois', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-08', '2026-09'],
      points: [
        { id: 'p1', restaurant_id: 'kms', date: '2026-08-10', yango_tab: 0, glovo_tab: 0, depenses_gerant_caisse_total: 0 },
        { id: 'p2', restaurant_id: 'kms', date: '2026-07-31', yango_tab: 999999 }, // hors période
      ],
      shifts: [{ point_id: 'p1', espece: 5000000 }],
      charges: [{ restaurant_id: 'kms', mois: '2026-08', montant: 3000000 }],
      depenses: [
        { restaurant_id: 'kms', date: '2026-08-12', categorie: 'equipement', montant: 650000 },
        { restaurant_id: 'kms', date: '2026-08-15', categorie: 'fond', montant: 62000 },          // transfert
        { restaurant_id: null, date: '2026-08-20', categorie: 'investissement', montant: 2000000 }, // groupe
      ],
      pubs: [{ type: 'pub', restaurant_id: 'kms', periode_debut: '2026-08-22', montant: 50000 }],
    })
    assert.deepEqual(r.kms['2026-08'], {
      encaisse: 5000000, litigesRetenus: 0, charges: 3000000, direction: 650000, pubs: 50000,
      glovoRemboursements: 0, glovoTempsAttente: 0,
      creditDebut: null, creditFin: null, creditAjustements: 0, variationCredit: 0, net: 1300000, nbPoints: 1,
    })
    assert.equal(r.kms['2026-09'], undefined)
  })

  test('litiges retenus sur salaires : comptés en revenu, la charge reste entière', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-10'],
      charges: [
        { restaurant_id: 'kms', mois: '2026-10', montant: 1000000 },
        { restaurant_id: 'kms', mois: '2026-10', montant: 60000, recette: true },
      ],
    })
    assert.equal(r.kms['2026-10'].charges, 1000000)
    assert.equal(r.kms['2026-10'].litigesRetenus, 60000)
    assert.equal(r.kms['2026-10'].net, -940000)
  })
})

describe('résultat net — journées sans shift (historique Sheets importé)', () => {
  test('sans shift : on prend le bénéfice enregistré sur la journée', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-01'],
      points: [{ id: 'p1', restaurant_id: 'kms', date: '2026-01-10', yango_tab: 100000, glovo_tab: 0, benefice_sc: 450000 }],
      shifts: [],
    })
    assert.equal(r.kms['2026-01'].encaisse, 450000)
  })
  test('avec shifts : calcul habituel, le bénéfice enregistré est ignoré', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-01'],
      points: [{ id: 'p1', restaurant_id: 'kms', date: '2026-01-10', yango_tab: 0, glovo_tab: 0, benefice_sc: 999999 }],
      shifts: [{ point_id: 'p1', espece: 200000 }],
    })
    assert.equal(r.kms['2026-01'].encaisse, 200000)
  })
})

describe('résultat net — retenues Glovo', () => {
  test('seuls remboursements et temps d\'attente sont retirés, au mois de leur date', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-10'],
      points: [{ id: 'p1', restaurant_id: 'kms', date: '2026-10-05', yango_tab: 0, glovo_tab: 0, depenses_gerant_caisse_total: 0 }],
      shifts: [{ point_id: 'p1', espece: 500000 }],
      litigesGlovo: [
        { restaurant_id: 'kms', date: '2026-10-06', type: 'remboursement', montant: 7000 },
        { restaurant_id: 'kms', date: '2026-10-07', type: 'temps_attente', montant: 3000 },
        { restaurant_id: 'kms', date: '2026-10-07', type: 'tape_moins', montant: 50000 }, // déjà dans l'encaissé
        { restaurant_id: 'kms', date: '2026-09-30', type: 'remboursement', montant: 99000 }, // hors période
      ],
    })
    assert.equal(r.kms['2026-10'].glovoRemboursements, 7000)
    assert.equal(r.kms['2026-10'].glovoTempsAttente, 3000)
    assert.equal(r.kms['2026-10'].net, 490000)
  })
})

describe('résultat net — crédit fournisseurs', () => {
  const base = {
    points: [{ id: 'p1', restaurant_id: 'kms', date: '2026-09-10', yango_tab: 0, glovo_tab: 0, depenses_gerant_caisse_total: 0 }],
    shifts: [{ point_id: 'p1', espece: 500000 }],
  }
  test('dette 500 000 → 1 000 000 et résultat 500 000 : le vrai résultat est 0', () => {
    const r = resultatsParRestoMois({
      ...base, mois: ['2026-09'],
      creditFournisseurs: { kms: { '2026-09': { debut: 500000, fin: 1000000, variation: 500000 } } },
    })
    assert.equal(r.kms['2026-09'].net, 0)
    assert.equal(r.kms['2026-09'].creditDebut, 500000)
    assert.equal(r.kms['2026-09'].creditFin, 1000000)
  })
  test('dette qui baisse : le résultat remonte', () => {
    const r = resultatsParRestoMois({
      ...base, mois: ['2026-09'],
      creditFournisseurs: { kms: { '2026-09': { debut: 1000000, fin: 500000, variation: -500000 } } },
    })
    assert.equal(r.kms['2026-09'].net, 1000000)
  })
  test('un crédit seul (aucun point, aucune charge) ne crée pas de résultat', () => {
    const r = resultatsParRestoMois({
      mois: ['2026-09'],
      creditFournisseurs: { yop: { '2026-09': { debut: 0, fin: 100000, variation: 100000 } } },
    })
    assert.equal(r.yop, undefined)
  })
})

describe('mois', () => {
  test('quatre derniers mois, passage d\'année', () => {
    assert.deepEqual(derniersMois('2027-01-15', 4), ['2026-10', '2026-11', '2026-12', '2027-01'])
  })
  test('bornes d\'un mois', () => {
    assert.deepEqual(bornesMois('2026-02'), { debut: '2026-02-01', fin: '2026-02-28' })
  })
})

describe('emprunts au coffre', () => {
  const e = { id: 'e', montant: 300000, created_at: '2026-10-02T10:00:00Z', rembourser_le: '2026-10-15' }
  test('avant la date : en cours ; le jour même : à rembourser', () => {
    assert.equal(statutEmprunt(e, [], '2026-10-14'), 'en_cours')
    assert.equal(statutEmprunt(e, [], '2026-10-15'), 'a_rembourser')
  })
  test('prochaine réception Glovo : seulement une réception marquée après l\'emprunt', () => {
    const g = { ...e, rembourser_le: null, rembourser_partenaire: 'glovo' }
    const avant = { partenaire: 'glovo', type: 'recu', created_at: '2026-10-01T09:00:00Z' }
    const apres = { partenaire: 'glovo', type: 'recu', created_at: '2026-10-03T09:00:00Z' }
    const wave = { partenaire: 'wave', type: 'recu', created_at: '2026-10-03T09:00:00Z' }
    assert.equal(statutEmprunt(g, [avant, wave], '2026-10-04'), 'en_cours')
    assert.equal(statutEmprunt(g, [avant, apres], '2026-10-04'), 'a_rembourser')
  })
  test('remboursé', () => {
    assert.equal(statutEmprunt({ ...e, rembourse_le: '2026-10-10' }, [], '2026-10-20'), 'rembourse')
  })
  test('reste à rembourser', () => {
    assert.equal(resteARembourser([e, { ...e, id: 'f', montant: 100000, rembourse_le: '2026-10-10' }]), 300000)
  })
})

describe('corriger un fond (Modifier / Répartir)', async () => {
  const { especesDonnees, variationsFond, repartissable, planRepartition } = await import('./direction.js')
  const nature = { id: 'a', categorie: 'fond_nature', restaurant_id: 'r7e', montant: 100000 }
  const especes = { id: 'b', categorie: 'fond', restaurant_id: 'r7e', montant: 100000 }

  test('seul un fond en espèces donné à un restaurant passe par le point', () => {
    assert.equal(especesDonnees(especes), 100000)
    assert.equal(especesDonnees(nature), 0)
    assert.equal(especesDonnees({ ...especes, restaurant_id: null }), 0)
    assert.equal(especesDonnees({ ...especes, categorie: 'materiel' }), 0)
  })

  test('100 000 en nature → 60 000 nature + 40 000 espèces : +40 000 au FC reçu', () => {
    assert.deepEqual(planRepartition(nature, 40000), { nature: 60000, delta: 40000, erreur: null })
  })

  test('100 000 en espèces déjà compté → 40 000 espèces : 60 000 retirés du FC reçu', () => {
    assert.deepEqual(planRepartition(especes, 40000), { nature: 60000, delta: -60000, erreur: null })
  })

  test('répartition impossible ou inutile', () => {
    assert.ok(planRepartition(nature, 120000).erreur)
    assert.ok(planRepartition(nature, 0).erreur)
    assert.ok(planRepartition(especes, 100000).erreur)
  })

  test('répartissable : fond d\'un restaurant, pas une correction, pas déjà réparti', () => {
    assert.equal(repartissable(nature), true)
    assert.equal(repartissable(especes), true)
    assert.equal(repartissable({ ...nature, restaurant_id: null }), false)
    assert.equal(repartissable({ ...nature, origine_id: 'x' }), false)
    assert.equal(repartissable(especes, [{ id: 'c' }]), false)
    assert.equal(repartissable({ ...nature, categorie: 'reparation' }), false)
  })

  test('variations à annoncer aux gérants', () => {
    assert.deepEqual(variationsFond(nature, { ...nature, categorie: 'fond' }), [{ restaurant_id: 'r7e', delta: 100000 }])
    assert.deepEqual(variationsFond(especes, { ...especes, montant: 80000 }), [{ restaurant_id: 'r7e', delta: -20000 }])
    assert.deepEqual(variationsFond(nature, { ...nature, montant: 90000 }), [])
    assert.deepEqual(variationsFond(especes, { ...especes, restaurant_id: 'kms' }),
      [{ restaurant_id: 'r7e', delta: -100000 }, { restaurant_id: 'kms', delta: 100000 }])
  })
})

describe('depensesGroupeParMois', () => {
  const mois = ['2026-10', '2026-11']
  test('paiement direction d\'une fiche de groupe compté au mois', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: null, groupe_id: 'g1', montant: 500000 }]
    assert.deepEqual(depensesGroupeParMois(d, mois), { '2026-10': 500000 })
  })
  test('ignore les dépenses d\'un restaurant', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: 'r1', groupe_id: 'g1', montant: 1 }]
    assert.deepEqual(depensesGroupeParMois(d, mois), {})
  })
  test('ignore une dépense sans restaurant ni groupe', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: null, groupe_id: null, montant: 1 }]
    assert.deepEqual(depensesGroupeParMois(d, mois), {})
  })
  test('ignore une catégorie hors résultat et un mois non demandé', () => {
    const d = [
      { date: '2026-10-25', categorie: 'retrait_perso', restaurant_id: null, groupe_id: 'g1', montant: 1 },
      { date: '2026-09-25', categorie: 'administratif', restaurant_id: null, groupe_id: 'g1', montant: 1 },
    ]
    assert.deepEqual(depensesGroupeParMois(d, mois), {})
  })
  test('resultatsParRestoMois ne voit pas la dépense de groupe', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: null, groupe_id: 'g1', montant: 500000 }]
    assert.deepEqual(resultatsParRestoMois({ depenses: d, mois }), {})
  })
})
