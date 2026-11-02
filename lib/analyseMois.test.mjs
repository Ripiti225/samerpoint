// Tests de lib/analyseMois.js — l'analyse mensuelle de l'écran Rapports.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { faitsDuMois, phraseObjectifs, joursDuMois, lignesRestaurants, moisPrecedentDe, serieParJourDuMois, totauxMois, variationPct } from './analyseMois.js'

test('outils de dates et variations', () => {
  assert.equal(joursDuMois('2026-02'), 28)
  assert.equal(joursDuMois('2026-09'), 30)
  assert.equal(moisPrecedentDe('2026-01'), '2025-12')
  assert.equal(variationPct(110, 100), 10)
  assert.equal(variationPct(5, 0), null)
})

const base = {
  mois: '2026-09', moisPrec: '2026-08',
  restaurants: [{ id: 'a', nom: 'Maroc', objectif_mensuel: 1000 }, { id: 'b', nom: 'Lavage' }, { id: 'c', nom: 'Fermé' }],
  points: [
    { restaurant_id: 'a', date: '2026-09-01', vente_total: 600, benefice_sc: 120, depense_total: 50 },
    { restaurant_id: 'a', date: '2026-09-02', vente_total: 600, benefice_sc: 120, depense_total: 50 },
    { restaurant_id: 'b', date: '2026-09-01', vente_total: 400, benefice_sc: -10, depense_total: 90 },
  ],
  pointsPrec: [
    { restaurant_id: 'a', date: '2026-08-01', vente_total: 1000 },
    { restaurant_id: 'b', date: '2026-08-01', vente_total: 500 },
  ],
  resultats: { a: { '2026-09': { net: 300 }, '2026-08': { net: 200 } }, b: { '2026-09': { net: -50 } } },
  litiges: [{ restaurant: { id: 'a' }, total: 5000 }],
  pos: { par_resto: [{ id: 'a', nb: 10, ca: 50000, pic: 20 }], par_heure: [{ h: 20, nb: 9 }, { h: 13, nb: 3 }], top: [{ nom: 'Chawarma', qte: 40 }] },
  notes: [{ restaurantId: 'a', note: 15, nom: 'Awa' }, { restaurantId: 'a', note: 9, nom: 'Ben' }, { restaurantId: 'b', note: null, nom: 'Kady' }],
}

test('lignesRestaurants : une ligne par restaurant actif, sans faux zéro', () => {
  const l = lignesRestaurants(base)
  assert.deepEqual(l.map(x => x.id), ['a', 'b'])          // « Fermé » n'a rien : retiré
  const a = l[0]
  assert.equal(a.ca, 1200)
  assert.equal(a.varCa, 20)
  assert.equal(a.marge, 20)
  assert.equal(a.net, 300)
  assert.equal(a.pctObjectif, 120)
  assert.equal(a.ticket, 5000)
  assert.equal(a.noteCaissiers, 12)
  const b = l[1]
  assert.equal(b.litiges, null)                            // aucune donnée : « — », pas 0
  assert.equal(b.pctObjectif, null)
  assert.equal(b.noteCaissiers, null)
})

test('mois en cours : l’objectif se juge sur la projection', () => {
  const l = lignesRestaurants({ ...base, jourCourant: 2 })
  assert.equal(l[0].projection, 18000)                     // 1 200 sur 2 jours → 30 jours
  assert.equal(l[0].pctObjectif, 1800)
})

test('totauxMois et faits marquants', () => {
  const l = lignesRestaurants(base)
  const t = totauxMois(l)
  assert.equal(t.ca, 1600)
  assert.equal(t.varCa, 7)
  assert.equal(t.net, 250)
  const faits = faitsDuMois({ lignes: l, totaux: t, pos: base.pos, litiges: { total: 5000, categories: [{ nom: 'Écarts de caisse' }] }, notes: base.notes })
  const textes = faits.map(f => f.texte).join(' | ')
  assert.ok(textes.includes('Maroc progresse le plus'))
  assert.ok(textes.includes('Lavage recule le plus'))
  assert.ok(textes.includes('Lavage est en perte'))
  assert.ok(textes.includes('20 h – 21 h'))
  assert.ok(textes.includes('Ben'))                        // caissier sous 10/20
})

test('serieParJourDuMois', () => {
  const s = serieParJourDuMois(base.points, '2026-09')
  assert.equal(s.length, 30)
  assert.equal(s[0], 1000)
  assert.equal(s[1], 600)
})

test('phraseObjectifs : accords', () => {
  assert.equal(phraseObjectifs(0, 8), 'Aucun restaurant sur 8 n’a atteint son objectif.')
  assert.equal(phraseObjectifs(1, 8), '1 restaurant sur 8 a atteint son objectif.')
  assert.equal(phraseObjectifs(3, 8), '3 restaurants sur 8 ont atteint leur objectif.')
  assert.equal(phraseObjectifs(2, 8, true), '2 restaurants sur 8 sont en route pour atteindre leur objectif.')
})

test('résultat net du groupe = restaurants − arriérés du groupe (comme Trésorerie → Résultat net)', async () => {
  const { avecArrieresGroupe } = await import('./analyseMois.js')
  const t = avecArrieresGroupe({ net: 5_000_000, netPrec: 4_000_000 }, 1_200_000, 300_000)
  assert.equal(t.netGroupe, 3_800_000)
  assert.equal(t.netGroupePrec, 3_700_000)
  assert.equal(t.arrieresGroupe, 1_200_000)
  const sans = avecArrieresGroupe({ net: null, netPrec: null }, 500, 0)
  assert.equal(sans.netGroupe, null)
  assert.equal(sans.netGroupePrec, null)
  assert.equal(avecArrieresGroupe({ net: 10, netPrec: null }).netGroupe, 10)
})
