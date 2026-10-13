// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/statsPOS.js — mise en forme des statistiques du POS.
// Les frontières gardées : la journée commence à 6 h (la nuit suit la soirée),
// un total vide ne donne jamais NaN, et les livraisons payées par le partenaire
// apparaissent dans les modes de paiement (sinon le total ne tombe pas).
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ORDRE_HEURES, canauxParHeure, creneauxForts, faitsMarquants, grilleSemaine, heurePic, heuresDuService, joursForts,
  mixCanaux, mixPaiements, partEntre, ticketMoyen,
} from './statsPOS.js'

describe('heures', () => {
  test('la journée commence à 6 h et finit à 5 h', () => {
    assert.equal(ORDRE_HEURES[0], 6)
    assert.equal(ORDRE_HEURES[23], 5)
    assert.equal(new Set(ORDRE_HEURES).size, 24)
  })

  test('heuresDuService complète les heures vides à 0, dans l’ordre du service', () => {
    const h = heuresDuService([{ h: 20, nb: 10, ca: 1000 }, { h: 1, nb: 2, ca: 300 }])
    assert.equal(h.length, 24)
    assert.deepEqual(h[0], { h: 6, nb: 0, ca: 0 })
    assert.equal(h.find(x => x.h === 20).nb, 10)
    assert.ok(h.findIndex(x => x.h === 1) > h.findIndex(x => x.h === 20))
  })

  test('heurePic : la plus forte, null sans commande', () => {
    assert.equal(heurePic([{ h: 13, nb: 5 }, { h: 20, nb: 9 }, { h: 21, nb: 7 }]).h, 20)
    assert.equal(heurePic([]), null)
    assert.equal(heurePic([{ h: 3, nb: 0 }]), null)
  })

  test('creneauxForts : les 3 plus chargés', () => {
    const c = creneauxForts([{ h: 1, nb: 1 }, { h: 20, nb: 9 }, { h: 21, nb: 7 }, { h: 19, nb: 8 }])
    assert.deepEqual(c.map(x => x.h), [20, 19, 21])
  })

  test('partEntre gère un créneau qui passe minuit', () => {
    const ph = [{ h: 22, nb: 5 }, { h: 1, nb: 5 }, { h: 12, nb: 10 }]
    assert.equal(partEntre(ph, 22, 2), 50)
    assert.equal(partEntre(ph, 18, 24), 25)
    assert.equal(partEntre([], 18, 24), 0)
  })
})

test('ticketMoyen : 0 sans commande, jamais NaN', () => {
  assert.equal(ticketMoyen({ nb: 0, ca: 0 }), 0)
  assert.equal(ticketMoyen(null), 0)
  assert.equal(ticketMoyen({ nb: 4, ca: 10000 }), 2500)
})

test('grilleSemaine : lundi en ligne 0, 6 h en colonne 0', () => {
  const { grille, max } = grilleSemaine([{ j: 1, h: 6, nb: 3 }, { j: 7, h: 5, nb: 9 }])
  assert.equal(grille.length, 7)
  assert.equal(grille[0][0], 3)
  assert.equal(grille[6][23], 9)
  assert.equal(max, 9)
})

test('joursForts : le jour le plus chargé', () => {
  const { parJour, meilleur } = joursForts([{ j: 5, h: 20, nb: 10 }, { j: 5, h: 21, nb: 5 }, { j: 2, h: 13, nb: 12 }])
  assert.equal(parJour[4].nb, 15)
  assert.equal(meilleur.long, 'vendredi')
})

describe('canaux et paiements', () => {
  const parType = [
    { type: 'SUR_PLACE', partenaire: null, origine: 'CAISSE', nb: 10, ca: 50000 },
    { type: 'SUR_PLACE', partenaire: null, origine: 'CLIENT_QR', nb: 2, ca: 10000 },
    { type: 'LIVRAISON', partenaire: 'GLOVO', origine: 'CAISSE', nb: 5, ca: 30000 },
    { type: 'LIVRAISON', partenaire: 'YANGO', origine: 'CAISSE', nb: 2, ca: 10000 },
  ]

  test('mixCanaux range par montant et calcule les parts', () => {
    const m = mixCanaux(parType)
    assert.deepEqual(m.map(c => c.cle), ['sur_place', 'glovo', 'yango', 'qr']) // égalité : ordre des canaux
    assert.equal(m[0].part, 50)
    assert.equal(m.reduce((s, c) => s + c.ca, 0), 100000)
  })

  test('mixPaiements ajoute les livraisons payées par le partenaire', () => {
    const p = mixPaiements([{ mode: 'ESPECES', nb: 10, montant: 55000 }, { mode: 'WAVE', nb: 2, montant: 5000 }], parType)
    const part = p.find(x => x.cle === 'PARTENAIRES')
    assert.equal(part.montant, 40000)
    assert.equal(p.reduce((s, x) => s + x.montant, 0), 100000)
    assert.equal(p[0].cle, 'ESPECES')
  })
})

test('faitsMarquants : rien sur des stats vides', () => {
  assert.deepEqual(faitsMarquants(null), [])
  assert.deepEqual(faitsMarquants({ totaux: { nb: 0 } }), [])
  const f = faitsMarquants({
    totaux: { nb: 3, ca: 9000 }, par_heure: [{ h: 20, nb: 3, ca: 9000 }], semaine: [{ j: 6, h: 20, nb: 3 }],
    top: [{ nom: 'Chawarma', qte: 3 }], par_type: [{ type: 'SUR_PLACE', nb: 3, ca: 9000 }],
  })
  assert.ok(f.some(x => x.texte.includes('20h')))
  assert.ok(f.some(x => x.texte.includes('samedi')))
})

describe('canauxParHeure', () => {
  test('regroupe les canaux heure par heure, du plus gros au plus petit', () => {
    const r = canauxParHeure([
      { h: 20, type: 'SUR_PLACE', nb: 3, ca: 15000 },
      { h: 20, type: 'LIVRAISON', partenaire: 'GLOVO', nb: 5, ca: 30000 },
      { h: 13, type: 'EMPORTER', nb: 2, ca: 8000 },
    ])
    assert.deepEqual(r[20].map(c => [c.cle, c.nb, c.ca]), [['glovo', 5, 30000], ['sur_place', 3, 15000]])
    assert.deepEqual(r[13].map(c => c.cle), ['emporter'])
    assert.equal(r[21], undefined)
  })

  test('SQL du POS pas encore repassé → objet vide', () => {
    assert.deepEqual(canauxParHeure(undefined), {})
  })
})
