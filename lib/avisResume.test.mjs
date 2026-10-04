// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/avisResume.js — l'onglet Résumé de l'écran Avis clients et
// l'attribution d'un avis au caissier. Une période mal découpée fausse
// l'évolution affichée ; un avis attribué au mauvais caissier fausse sa note.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  PERIODES_AVIS, plagePeriode, periodePrecedente, evolution, resumeChiffres,
  caissierDeLAvis, classementCaissiers, topMotifs, bonsAvisAttribues, pctEvolution, texteAvisHier,
} from './avisResume.js'

describe('périodes', () => {
  const AUJ = '2026-10-04'
  test('les 7 choix, dans l’ordre', () => {
    assert.deepEqual(PERIODES_AVIS.map(p => p.cle), ['jour', 'hier', 'semaine', 'mois', 'mois_calendaire', 'mois_dernier', 'perso'])
  })
  test('aujourd’hui, hier, 7 jours, 30 jours, ce mois', () => {
    assert.deepEqual(plagePeriode('jour', AUJ), { debut: AUJ, fin: AUJ })
    assert.deepEqual(plagePeriode('hier', AUJ), { debut: '2026-10-03', fin: '2026-10-03' })
    assert.deepEqual(plagePeriode('semaine', AUJ), { debut: '2026-09-28', fin: AUJ })
    assert.deepEqual(plagePeriode('mois', AUJ), { debut: '2026-09-05', fin: AUJ })
    assert.deepEqual(plagePeriode('mois_calendaire', AUJ), { debut: '2026-10-01', fin: AUJ })
  })
  test('mois dernier, y compris février', () => {
    assert.deepEqual(plagePeriode('mois_dernier', AUJ), { debut: '2026-09-01', fin: '2026-09-30' })
    assert.deepEqual(plagePeriode('mois_dernier', '2026-03-15'), { debut: '2026-02-01', fin: '2026-02-28' })
  })
  test('dates au choix : remises dans l’ordre, incomplètes → rien', () => {
    assert.deepEqual(plagePeriode('perso', AUJ, { debut: '2026-09-10', fin: '2026-09-01' }), { debut: '2026-09-01', fin: '2026-09-10' })
    assert.equal(plagePeriode('perso', AUJ, { debut: '2026-09-10' }), null)
  })
  test('période précédente : même durée, juste avant', () => {
    assert.deepEqual(periodePrecedente({ debut: '2026-10-01', fin: '2026-10-07' }), { debut: '2026-09-24', fin: '2026-09-30' })
    assert.deepEqual(periodePrecedente({ debut: '2026-10-04', fin: '2026-10-04' }), { debut: '2026-10-03', fin: '2026-10-03' })
  })
})

describe('evolution', () => {
  test('hausse d’une note : mieux ; hausse des négatifs : pire', () => {
    assert.deepEqual(evolution(4.2, 4, true), { delta: 0.2, sens: 'hausse', mieux: true })
    assert.deepEqual(evolution(18, 12, false), { delta: 6, sens: 'hausse', mieux: false })
  })
  test('égal, ou rien à comparer', () => {
    assert.deepEqual(evolution(5, 5), { delta: 0, sens: 'egal', mieux: null })
    assert.equal(evolution(5, null), null)
  })
})

const av = (id, classification, extra = {}) => ({ id, platform: 'glovo', classification, restaurant_id: 'palm', ...extra })

describe('resumeChiffres', () => {
  test('litiges liés aux avis de la période, avec leur montant', () => {
    const avis = [av('a', 'negatif'), av('b', 'bon')]
    const r = resumeChiffres(avis, [{ review_id: 'a', montant: 1000 }, { review_id: 'zz', montant: 1000 }])
    assert.equal(r.nb, 2)
    assert.equal(r.nbLitiges, 1)
    assert.equal(r.montantLitiges, 1000)
  })
})

const shifts = [
  { restaurant_id: 'palm', date: '2026-10-03', caissier_id: 'b', caissier_nom: 'Bazie', heure_debut: '06:00:00', heure_fin: '15:00:00' },
  { restaurant_id: 'palm', date: '2026-10-03', caissier_id: 'm', caissier_nom: 'Moise', heure_debut: '15:00:00', heure_fin: '02:30:00' },
]

describe('caissierDeLAvis', () => {
  test('heure de commande → caissier du shift', () => {
    assert.deepEqual(caissierDeLAvis(av('a', 'bon', { commande_le: '2026-10-03T09:12:00Z' }), { shifts }),
      { caissier_id: 'b', caissier_nom: 'Bazie', source: 'shift' })
  })
  test('commande après minuit : service de soirée de la veille', () => {
    assert.equal(caissierDeLAvis(av('a', 'bon', { commande_le: '2026-10-04T01:10:00Z' }), { shifts }).caissier_nom, 'Moise')
  })
  test('le responsable du litige prime (correction du manager)', () => {
    const r = caissierDeLAvis(av('a', 'negatif', { commande_le: '2026-10-03T09:12:00Z' }),
      { shifts, litigeParReview: { a: { responsable_id: 'x', responsable_nom: 'Xavier' } } })
    assert.deepEqual(r, { caissier_id: 'x', caissier_nom: 'Xavier', source: 'litige' })
  })
  test('sans heure, ou aucun shift : personne', () => {
    assert.equal(caissierDeLAvis(av('a', 'bon'), { shifts }), null)
    assert.equal(caissierDeLAvis(av('a', 'bon', { commande_le: '2026-10-10T09:00:00Z' }), { shifts }), null)
  })
})

describe('classementCaissiers', () => {
  test('du plus de mauvais avis au moins, « Sans caissier » en dernier', () => {
    const avis = [av('1', 'negatif'), av('2', 'negatif'), av('3', 'bon'), av('4', 'negatif'), av('5', 'bon'), av('6', 'negatif')]
    const par = {
      1: { caissier_id: 'b', caissier_nom: 'Bazie' }, 2: { caissier_id: 'b', caissier_nom: 'Bazie' }, 3: { caissier_id: 'b', caissier_nom: 'Bazie' },
      4: { caissier_id: 'm', caissier_nom: 'Moise' }, 5: { caissier_id: 'm', caissier_nom: 'Moise' }, 6: null,
    }
    const r = classementCaissiers(avis, par)
    assert.deepEqual(r.map(x => [x.nom, x.bons, x.mauvais, x.pctNegatifs]), [
      ['Bazie', 1, 2, 66.7], ['Moise', 1, 1, 50], ['Sans caissier', 0, 1, 100],
    ])
  })
})

describe('topMotifs', () => {
  test('thèmes Glovo et tags Yango des négatifs ; commentaire seul → « Commentaire sans motif »', () => {
    const avis = [
      av('1', 'negatif', { raw: { raw: { theme: ['Mauvais goût', 'Cher'] } } }),
      av('2', 'negatif', { raw: { raw: { tag: ['Mauvais goût'] } } }),
      av('3', 'negatif', { comment: 'Froid', raw: { raw: {} } }),
      av('4', 'negatif', { raw: { raw: {} } }),
      av('5', 'bon', { raw: { raw: { tag: ['Délicieux'] } } }),
    ]
    assert.deepEqual(topMotifs(avis), [
      { motif: 'Mauvais goût', nb: 2 }, { motif: 'Cher', nb: 1 }, { motif: 'Commentaire sans motif', nb: 1 },
    ])
  })
})

describe('bonsAvisAttribues — pour la note des caissiers', () => {
  test('seuls les bons avis attribués comptent, datés du jour de la commande', () => {
    const avis = [
      av('1', 'bon', { commande_le: '2026-10-03T09:12:00Z' }),
      av('2', 'negatif', { commande_le: '2026-10-03T09:12:00Z' }),
      av('3', 'bon'),
    ]
    assert.deepEqual(bonsAvisAttribues(avis, shifts), [
      { responsable_id: 'b', responsable_nom: 'Bazie', date: '2026-10-03', bon: true, nature: 'bon avis' },
    ])
  })
})

describe('texteAvisHier — la ligne « Avis clients » de l’accueil', () => {
  test('évolution en % arrondie ; pas de base de comparaison → null', () => {
    assert.equal(pctEvolution(42, 37), 14)
    assert.equal(pctEvolution(42, 44), -5)
    assert.equal(pctEvolution(3, 0), null)
    assert.equal(pctEvolution(0, 0), 0)
  })
  test('hier comparé à avant-hier et au même jour de la semaine d’avant', () => {
    // 03/10/2026 est un samedi.
    assert.equal(texteAvisHier({ hier: 42, avantHier: 37, semainePrec: 44 }, '2026-10-03'),
      'Hier : 42 avis · ↑ 14 % vs avant-hier · ↓ 5 % vs sam. dernier')
  })
  test('rien à comparer : seulement le nombre ; égalité : stable', () => {
    assert.equal(texteAvisHier({ hier: 3, avantHier: 0, semainePrec: 0 }, '2026-10-03'), 'Hier : 3 avis')
    assert.equal(texteAvisHier({ hier: 5, avantHier: 5, semainePrec: 0 }, '2026-10-03'), 'Hier : 5 avis · = stable vs avant-hier')
  })
})
