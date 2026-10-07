// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/dashboardGlobal.js — les agrégats du Dashboard Global.
//
// Ce module existe pour que A et B soient calculés par le même code. Les tests
// gardent surtout deux frontières que l'écran a le droit d'oublier, mais pas
// lui : un taux sur des ventes nulles vaut 0 (pas NaN, qui s'afficherait
// « NaN% » au propriétaire), et un restaurant sans point saisi n'est pas un
// restaurant à zéro — ce serait lire un effondrement là où personne n'a validé.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  vueGlobale,
  tauxRenta,
  part,
  foodCostMontant,
  laborCostMontant,
  chargesFixesMontant,
  courtNom,
  familleResto,
  couleurResto,
  fmtFCFA,
  fondRecuPoint,
  detailFondRecu,
} from './dashboardGlobal.js'

const ANGRE = { id: 'a', nom: 'Angré', couleur: 'orange' }
const RIVIERA = { id: 'r', nom: 'Riviera', couleur: 'bleu' }
const KAYAN = { id: 'k', nom: 'Al Kayan Zone 4', couleur: 'vert' }

const POINTS = {
  a: [
    { date: '2025-10-02', vente_total: 700000, depense_total: 400000, benefice_sc: 300000, yango_cse: 100000, glovo_cse: 50000, wave: 20000 },
    { date: '2025-10-01', vente_total: 500000, depense_total: 300000, benefice_sc: 200000, yango_cse: 50000, glovo_cse: 25000, om: 10000 },
  ],
  r: [
    { date: '2025-10-01', vente_total: 400000, depense_total: 350000, benefice_sc: 50000, yango_cse: 40000 },
  ],
}

describe('tauxRenta et part — aucune division par zéro ne sort d’ici', () => {

  test('un taux normal', () => {
    assert.equal(tauxRenta(1000, 250), 25)
    assert.equal(part(300, 1000), 30)
  })

  test('ventes nulles : 0, ni NaN ni Infinity', () => {
    assert.equal(tauxRenta(0, 250), 0)
    assert.equal(tauxRenta(null, 250), 0)
    assert.equal(part(300, 0), 0)
    assert.ok(Number.isFinite(tauxRenta(0, 250)))
  })

  test('un bénéfice négatif donne un taux négatif, pas zéro', () => {
    assert.equal(tauxRenta(1000, -200), -20)
  })
})

describe('les trois montants de coût', () => {

  test('coût matières : dépenses food + fournisseurs, hors non-food', () => {
    const mt = foodCostMontant({
      depenses: [
        { categorie: 'Marché', montant: 100000 },
        { categorie: 'Légumes', montant: 20000 },
        { categorie: 'Dépenses annexes', montant: 999999 }, // hors food
      ],
      fournisseurs: [
        { nom: 'BOULANGERIE', paye: 50000 },
        { nom: 'LOYER', paye: 400000 },  // non-food : exclu
        { nom: 'CIE', paye: 80000 },     // non-food : exclu
      ],
    })
    assert.equal(mt, 170000)
  })

  test('coût salaire : présences + fournisseurs labor + paies gérant', () => {
    const mt = laborCostMontant({
      presences: [{ paye: 15000 }, { paye: 12000 }],
      fournisseurs: [
        { nom: 'Cotisation salaire', paye: 30000 },
        { nom: 'BOULANGERIE', paye: 50000 }, // ni labor : exclu
      ],
      paiesGerant: 200000,
    })
    assert.equal(mt, 257000)
  })

  test('les montants en chaîne de caractères sont additionnés, pas concaténés', () => {
    assert.equal(foodCostMontant({ depenses: [{ categorie: 'Marché', montant: '1000' }, { categorie: 'Fruits', montant: '500' }] }), 1500)
    assert.equal(laborCostMontant({ presences: [{ paye: '250.5' }] }), 250.5)
  })

  test('entrées absentes ou vides : zéro, jamais NaN', () => {
    assert.equal(foodCostMontant(), 0)
    assert.equal(laborCostMontant(), 0)
    assert.equal(foodCostMontant({ depenses: [{ categorie: 'Marché', montant: null }] }), 0)
    assert.equal(chargesFixesMontant([], 'a'), 0)
  })

  test('charges fixes : seules celles du restaurant demandé', () => {
    const charges = [
      { restaurant_id: 'a', libelle: 'LOYER', montant: 500000, mois: '2025-10' },
      { restaurant_id: 'a', libelle: 'CIE', montant: 120000, mois: '2025-10' },
      { restaurant_id: 'r', libelle: 'LOYER', montant: 300000, mois: '2025-10' },
    ]
    assert.equal(chargesFixesMontant(charges, 'a'), 620000)
    assert.equal(chargesFixesMontant(charges, 'r'), 300000)
  })
})

describe('vueGlobale — agrégats par restaurant et pour le groupe', () => {

  const vue = vueGlobale({ points: POINTS, restaurants: [ANGRE, RIVIERA] })

  test('une ligne par restaurant, ses ventes sommées sur la période', () => {
    const angre = vue.lignes.find(l => l.id === 'a')
    assert.equal(angre.ventes, 1200000)
    assert.equal(angre.depenses, 700000)
    assert.equal(angre.benefice, 500000)
    assert.equal(angre.nbJours, 2)
  })

  test('le total du groupe est la somme des restaurants vus', () => {
    assert.equal(vue.total.ventes, 1600000)
    assert.equal(vue.total.benefice, 550000)
    assert.equal(vue.total.nbJours, 3)
  })

  test('un restaurant hors de la liste des vus ne compte pas dans le total', () => {
    const seulAngre = vueGlobale({ points: POINTS, restaurants: [ANGRE] })
    assert.equal(seulAngre.total.ventes, 1200000)
    assert.equal(seulAngre.lignes.length, 1)
  })

  test('le classement est trié par bénéfice décroissant', () => {
    assert.deepEqual(vue.classement.map(l => l.id), ['a', 'r'])
  })

  test('serieJours trie par date et somme les restaurants vus', () => {
    assert.deepEqual(vue.serieJours.map(j => j.date), ['2025-10-01', '2025-10-02'])
    assert.equal(vue.serieJours[0].vente, 900000) // 500 000 Angré + 400 000 Riviera
    assert.equal(vue.serieJours[1].vente, 700000)
  })

  test('le mix des canaux ne garde que les canaux alimentés', () => {
    assert.deepEqual(vue.mixCanaux.map(c => c.canal), ['Yango', 'Glovo', 'Wave', 'OM'])
    assert.equal(vue.mixCanaux.find(c => c.canal === 'Yango').montant, 190000)
    assert.ok(!vue.mixCanaux.some(c => c.canal === 'Djamo'))
  })

  test('livraison, sur place et part livraison', () => {
    const angre = vue.lignes.find(l => l.id === 'a')
    assert.equal(angre.livraisonMt, 225000)
    assert.equal(angre.surPlaceMt, 975000)
    assert.equal(angre.pctLivraison.toFixed(2), '18.75')
  })

  test('la part sur place ne devient jamais négative', () => {
    const bizarre = vueGlobale({
      points: { a: [{ date: '2025-10-01', vente_total: 1000, yango_cse: 5000 }] },
      restaurants: [ANGRE],
    })
    assert.equal(bizarre.total.surPlaceMt, 0)
  })
})

describe('vueGlobale — « aucun point saisi » n’est pas « zéro »', () => {

  test('un restaurant sans point porte nbJours = 0 et n’est pas compté comme actif', () => {
    const vue = vueGlobale({ points: POINTS, restaurants: [ANGRE, RIVIERA, KAYAN] })
    const kayan = vue.lignes.find(l => l.id === 'k')
    assert.equal(kayan.nbJours, 0)
    assert.equal(kayan.ventes, 0)
    assert.equal(vue.total.nbRestosAvecPoints, 2)
  })

  test('un restaurant qui a saisi une vraie journée à zéro est bien actif', () => {
    const vue = vueGlobale({
      points: { k: [{ date: '2025-10-01', vente_total: 0, depense_total: 0, benefice_sc: 0 }] },
      restaurants: [KAYAN],
    })
    const kayan = vue.lignes[0]
    assert.equal(kayan.nbJours, 1)
    assert.equal(kayan.ventes, 0)
    assert.equal(vue.total.nbRestosAvecPoints, 1)
  })

  test('aucun restaurant du tout : des totaux à zéro, pas une erreur', () => {
    const vue = vueGlobale()
    assert.deepEqual(vue.lignes, [])
    assert.equal(vue.total.ventes, 0)
    assert.equal(vue.total.renta, 0)
    assert.deepEqual(vue.serieJours, [])
    assert.deepEqual(vue.mixCanaux, [])
  })
})

describe('vueGlobale — le pilier Coûts', () => {

  const COUTS = {
    depenses: {
      a: [{ categorie: 'Marché', montant: 300000 }],
      r: [{ categorie: 'Marché', montant: 160000 }],
    },
    presences: { a: [{ paye: 100000 }], r: [{ paye: 60000 }] },
    fournisseurs: {
      a: [{ nom: 'BOULANGERIE', paye: 60000 }, { nom: 'LOYER', paye: 500000 }],
      r: [],
    },
    paiesGerant: { a: 80000, r: 40000 },
    charges: [
      { restaurant_id: 'a', libelle: 'LOYER', montant: 500000, mois: '2025-10' },
    ],
  }

  const vue = vueGlobale({ points: POINTS, restaurants: [ANGRE, RIVIERA], couts: COUTS })

  test('le coût primaire est la somme des deux pourcentages', () => {
    const angre = vue.lignes.find(l => l.id === 'a')
    assert.equal(angre.foodMt, 360000)           // 300 000 marché + 60 000 boulangerie
    assert.equal(angre.laborMt, 180000)          // 100 000 présences + 80 000 gérant
    assert.equal(angre.foodPct, 30)              // sur 1 200 000 de ventes
    assert.equal(angre.laborPct, 15)
    assert.equal(angre.primePct, 45)
  })

  test('le classement des coûts est trié par coût primaire décroissant', () => {
    // Riviera : 160 000 / 400 000 = 40 % + 100 000 / 400 000 = 25 % → 65 %
    assert.deepEqual(vue.classementCouts.map(l => l.id), ['r', 'a'])
  })

  test('les charges fixes suivent le restaurant, et aDesCharges dit si la table répond', () => {
    assert.equal(vue.lignes.find(l => l.id === 'a').chargesFixesMt, 500000)
    assert.equal(vue.lignes.find(l => l.id === 'r').chargesFixesMt, 0)
    assert.equal(vue.total.aDesCharges, true)
    assert.equal(vueGlobale({ points: POINTS, restaurants: [ANGRE] }).total.aDesCharges, false)
  })
})

describe('les libellés repris de l’écran', () => {

  test('un nom long est tronqué, un nom court est laissé intact', () => {
    assert.equal(courtNom('Angré'), 'Angré')
    assert.equal(courtNom('Riviera Palmeraie'), 'Riviera …')
    assert.equal(courtNom(null), '')
  })

  test('la famille se lit dans le nom', () => {
    assert.equal(familleResto('Al Kayan Zone 4'), 'Al Kayan')
    assert.equal(familleResto('AL KAYAN Angré'), 'Al Kayan')
    assert.equal(familleResto('Chez Samer Angré'), 'Samer')
    assert.equal(familleResto(null), 'Samer')
  })

  test('une couleur inconnue retombe sur l’orange de la marque', () => {
    assert.equal(couleurResto('vert'), '#2D7D46')
    assert.equal(couleurResto('n’importe quoi'), '#EF9F27')
  })

  test('un montant s’écrit avec des espaces et son unité', () => {
    assert.equal(fmtFCFA(2600000), '2 600 000 FCFA')
    assert.equal(fmtFCFA(-2600000), '-2 600 000 FCFA')
    assert.equal(fmtFCFA(0), '0 FCFA')
  })
})

describe('le fond de caisse reçu', () => {

  test('fond_recu d’abord, fc_compte à défaut — comme l’écran Vérification', () => {
    assert.equal(fondRecuPoint({ fond_recu: 20000, fc_compte: 5000 }), 20000)
    assert.equal(fondRecuPoint({ fond_recu: 0, fc_compte: 5000 }), 5000)
    assert.equal(fondRecuPoint({ fond_recu: null, fc_compte: null }), 0)
    assert.equal(fondRecuPoint({}), 0)
  })

  test('additionné par restaurant et sur le total, avec le nombre de jours où il y en a eu', () => {
    const points = {
      a: [
        { date: '2025-10-01', vente_total: 1, fond_recu: 20000 },
        { date: '2025-10-02', vente_total: 1, fc_compte: 10000 },
        { date: '2025-10-03', vente_total: 1 },
      ],
      r: [{ date: '2025-10-01', vente_total: 1, fond_recu: '15000' }],
    }
    const v = vueGlobale({ points, restaurants: [ANGRE, RIVIERA, KAYAN] })
    const [a, r, k] = v.lignes
    assert.equal(a.fondRecu, 30000)
    assert.equal(a.joursFondRecu, 2)
    assert.equal(r.fondRecu, 15000)
    assert.equal(k.fondRecu, 0)
    assert.equal(v.total.fondRecu, 45000)
    assert.equal(v.total.joursFondRecu, 3)
  })
})

describe('le détail jour par jour du fond reçu', () => {

  test('seulement les jours où il y a eu du fond, du plus récent au plus ancien', () => {
    const pts = [
      { date: '2025-10-01', fond_recu: 20000 },
      { date: '2025-10-03' },
      { date: '2025-10-02', fc_compte: 10000 },
    ]
    assert.deepEqual(detailFondRecu(pts), [
      { date: '2025-10-02', montant: 10000 },
      { date: '2025-10-01', montant: 20000 },
    ])
    assert.deepEqual(detailFondRecu(undefined), [])
  })
})
