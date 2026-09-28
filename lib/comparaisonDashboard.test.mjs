// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/comparaisonDashboard.js — les écarts A / B.
//
// Une comparaison fausse est pire qu'une absence de comparaison : le gérant la
// croit. Les tests d'ici gardent les quatre endroits où elle peut mentir sans
// que rien ne casse à l'écran — une division par zéro qui devient « Infinity »,
// un « −100 % » sur un point non saisi, un taux comparé en pourcentage de
// pourcentage, et le loyer d'un mois entier imputé à sept jours.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  POLARITE,
  UNITE,
  ecart,
  ecarts,
  formaterEcart,
  formaterDelta,
  synthese,
} from './comparaisonDashboard.js'

const ANGRE_RIVIERA = { libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 25, nbJoursB: 25 }

describe('ecart — un montant se compare en pourcentage', () => {

  const e = ecart({ cle: 'ventes', libelle: 'Ventes', a: 12400000, b: 9800000, ...ANGRE_RIVIERA })

  test('l’écart absolu et le pourcentage', () => {
    assert.equal(e.delta, -2600000)
    assert.equal(e.pct.toFixed(1), '-21.0')
    assert.equal(e.points, null)
  })

  test('le sens et la flèche redisent l’information que la couleur porte', () => {
    assert.equal(e.sens, 'baisse')
    assert.equal(e.fleche, '▼')
    assert.equal(e.couleur, 'mauvais') // des ventes qui baissent
  })

  test('deux valeurs identiques : aucune couleur, aucune flèche directionnelle', () => {
    const egal = ecart({ cle: 'ventes', a: 500000, b: 500000, ...ANGRE_RIVIERA })
    assert.equal(egal.sens, 'egal')
    assert.equal(egal.fleche, '=')
    assert.equal(egal.couleur, null)
    assert.equal(formaterEcart(egal), '= identique')
  })
})

describe('ecart — la polarité ne décide que de la couleur', () => {

  test('des ventes en hausse : bonne nouvelle', () => {
    const e = ecart({ cle: 'ventes', a: 1000, b: 1200, polarite: POLARITE.BON, ...ANGRE_RIVIERA })
    assert.equal(e.couleur, 'bon')
    assert.equal(e.fleche, '▲')
  })

  test('un coût matières en hausse : mauvaise nouvelle, même flèche', () => {
    const e = ecart({ cle: 'foodPct', a: 31, b: 37.2, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA })
    assert.equal(e.couleur, 'mauvais')
    assert.equal(e.fleche, '▲')
  })

  test('un coût matières en baisse : bonne nouvelle', () => {
    const e = ecart({ cle: 'foodPct', a: 37, b: 31, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA })
    assert.equal(e.couleur, 'bon')
  })

  test('la part livraison est un mix : jamais de couleur, dans les deux sens', () => {
    const hausse = ecart({ cle: 'pctLivraison', a: 22, b: 33, unite: UNITE.POURCENT, polarite: POLARITE.NEUTRE, ...ANGRE_RIVIERA })
    const baisse = ecart({ cle: 'pctLivraison', a: 33, b: 22, unite: UNITE.POURCENT, polarite: POLARITE.NEUTRE, ...ANGRE_RIVIERA })
    assert.equal(hausse.couleur, null)
    assert.equal(baisse.couleur, null)
    assert.equal(hausse.fleche, '▲') // la flèche reste : l'information passe sans couleur
    assert.equal(baisse.fleche, '▼')
  })
})

describe('ecart — un pourcentage se compare en POINTS', () => {

  const e = ecart({ cle: 'foodPct', libelle: 'Coût matières', a: 31, b: 37.2, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA })

  test('l’écart est en points, et aucun pourcentage n’est produit', () => {
    assert.equal(e.points.toFixed(1), '6.2')
    assert.equal(e.pct, null, 'un pourcentage de pourcentage serait incompréhensible')
  })

  test('l’affichage écrit « pts », jamais « % »', () => {
    assert.equal(formaterEcart(e), '▲ 6,2 pts')
    assert.ok(!formaterEcart(e).includes('%'))
  })

  test('un taux qui double ne vaut pas « +100 % » mais son écart en points', () => {
    const double = ecart({ cle: 'laborPct', a: 15, b: 30, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA })
    assert.equal(double.points, 15)
    assert.equal(formaterEcart(double), '▲ 15,0 pts')
  })

  test('un taux à zéro côté A reste comparable : 0 % → 12 % fait 12 points', () => {
    const e0 = ecart({ cle: 'foodPct', a: 0, b: 12, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA })
    assert.equal(e0.points, 12)
    assert.equal(e0.comparable, true)
    assert.equal(e0.message, null)
  })
})

describe('ecart — A à zéro ne produit jamais de pourcentage (§ 6.3)', () => {

  const e = ecart({
    cle: 'ventes', libelle: 'Ventes', a: 0, b: 900000, ...ANGRE_RIVIERA,
    phraseZeroA: 'Angré n’a rien vendu sur cette période',
  })

  test('aucun pourcentage, mais l’écart absolu est gardé', () => {
    assert.equal(e.pct, null)
    assert.equal(e.delta, 900000)
    assert.ok(Number.isFinite(e.delta))
  })

  test('la phrase remplace le pourcentage', () => {
    assert.equal(e.message, 'Angré n’a rien vendu sur cette période')
  })

  test('faute de pourcentage, l’écart ne peut pas être classé dans la synthèse', () => {
    assert.equal(e.ampleur, null)
  })

  test('sans phrase fournie, une formulation neutre est écrite quand même', () => {
    const brut = ecart({ cle: 'depenses', a: 0, b: 5000, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 3, nbJoursB: 3 })
    assert.equal(brut.message, 'Angré est à zéro sur cette période')
  })

  test('B à zéro, lui, donne un « −100 % » légitime et affiché', () => {
    const b0 = ecart({ cle: 'ventes', a: 900000, b: 0, ...ANGRE_RIVIERA })
    assert.equal(b0.pct, -100)
    assert.equal(b0.comparable, true)
    assert.equal(formaterEcart(b0), '▼ −100 %')
  })
})

describe('ecart — aucun point saisi n’est pas zéro (§ 6.4)', () => {

  test('A sans point : aucun pourcentage, la mention nomme le terme', () => {
    const e = ecart({ cle: 'ventes', a: 0, b: 900000, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 0, nbJoursB: 25 })
    assert.equal(e.comparable, false)
    assert.equal(e.pct, null)
    assert.equal(e.delta, null, 'un écart calculé donnerait l’illusion d’une mesure')
    assert.equal(e.message, 'Angré : aucun point saisi sur cette période')
    assert.ok(!formaterEcart(e).includes('%'))
    assert.equal(formaterEcart(e), '')
  })

  test('B sans point : la mention nomme B', () => {
    const e = ecart({ cle: 'ventes', a: 900000, b: 0, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 25, nbJoursB: 0 })
    assert.equal(e.comparable, false)
    assert.equal(e.message, 'Riviera : aucun point saisi sur cette période')
    assert.notEqual(e.pct, -100, 'ce serait lire un effondrement là où personne n’a validé')
  })

  test('les deux sans point : une seule mention', () => {
    const e = ecart({ cle: 'ventes', a: 0, b: 0, nbJoursA: 0, nbJoursB: 0 })
    assert.equal(e.message, 'aucun point saisi de part et d’autre sur cette période')
  })

  test('nbJours non renseigné ne bloque pas la comparaison', () => {
    const e = ecart({ cle: 'ventes', a: 1000, b: 1200, libelleA: 'A', libelleB: 'B' })
    assert.equal(e.comparable, true)
    assert.equal(e.pct, 20)
  })

  test('un vrai zéro de vente avec des points saisis reste comparable', () => {
    const e = ecart({ cle: 'ventes', a: 900000, b: 0, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 25, nbJoursB: 25 })
    assert.equal(e.comparable, true)
    assert.equal(e.pct, -100)
  })
})

describe('ecart — un refus explicite : les charges fixes (§ 6.2)', () => {

  const RAISON = 'charges du mois entier — non comparable sur une période partielle'
  const e = ecart({
    cle: 'chargesFixesPct', libelle: 'Charges fixes',
    a: 18.4, b: 21.1, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS,
    comparable: false, raison: RAISON, ...ANGRE_RIVIERA,
  })

  test('aucun écart n’est produit, la raison est écrite', () => {
    assert.equal(e.comparable, false)
    assert.equal(e.points, null)
    assert.equal(e.delta, null)
    assert.equal(e.message, RAISON)
  })

  test('la valeur de A reste disponible : la ligne s’affiche pour A seul', () => {
    assert.equal(e.a, 18.4)
  })

  test('aucune couleur : rien n’est jugé', () => {
    assert.equal(e.couleur, null)
  })

  test('sans raison fournie, un repli lisible est écrit', () => {
    const muet = ecart({ cle: 'x', a: 1, b: 2, comparable: false })
    assert.equal(muet.message, 'non comparable sur cette période')
  })
})

describe('formaterDelta — l’écart en valeur', () => {

  test('un montant porte son signe et son unité', () => {
    const e = ecart({ cle: 'ventes', a: 12400000, b: 9800000, ...ANGRE_RIVIERA })
    assert.equal(formaterDelta(e), '−2 600 000 FCFA')
  })

  test('une hausse porte un plus', () => {
    const e = ecart({ cle: 'ventes', a: 9800000, b: 12400000, ...ANGRE_RIVIERA })
    assert.equal(formaterDelta(e), '+2 600 000 FCFA')
  })

  test('un taux porte ses points', () => {
    const e = ecart({ cle: 'foodPct', a: 31, b: 37.2, unite: UNITE.POURCENT, ...ANGRE_RIVIERA })
    assert.equal(formaterDelta(e), '+6,2 pts')
  })

  test('une comparaison refusée n’affiche aucun écart', () => {
    const e = ecart({ cle: 'x', a: 1, b: 2, comparable: false })
    assert.equal(formaterDelta(e), '')
  })
})

describe('synthese — la bande de tête du pilier', () => {

  const LISTE = () => ecarts([
    { cle: 'ventes', libelle: 'Ventes', a: 12400000, b: 9800000, ...ANGRE_RIVIERA },
    { cle: 'benefice', libelle: 'Bénéfice SC', a: 2000000, b: 1000000, ...ANGRE_RIVIERA },
    { cle: 'foodPct', libelle: 'Coût matières', a: 31, b: 37.2, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA },
    { cle: 'pctLivraison', libelle: 'Part livraison', a: 22, b: 33, unite: UNITE.POURCENT, polarite: POLARITE.NEUTRE, ...ANGRE_RIVIERA },
    { cle: 'depenses', libelle: 'Dépenses', a: 5000000, b: 5050000, polarite: POLARITE.MAUVAIS, ...ANGRE_RIVIERA },
  ])

  test('la phrase porte sur les ventes, avec le montant, la durée et le pourcentage', () => {
    const { phrase } = synthese(LISTE(), { nbJours: 25 })
    assert.equal(phrase, 'Riviera fait 2 600 000 FCFA de moins qu’Angré sur 25 jours (−21 %).')
  })

  test('une hausse se dit « de plus »', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 9800000, b: 12400000, ...ANGRE_RIVIERA },
    ]), { nbJours: 25 })
    assert.match(phrase, /de plus/)
  })

  test('trois lignes au plus, les plus gros écarts relatifs', () => {
    const { lignes } = synthese(LISTE(), { nbJours: 25 })
    assert.equal(lignes.length, 3)
    // bénéfice −50 %, part livraison +11 pts, coût matières +6,2 pts → dépenses (+1 %) sort.
    assert.deepEqual(lignes.map(l => l.cle), ['benefice', 'pctLivraison', 'foodPct'])
  })

  test('le classement est relatif, pas absolu', () => {
    // 50 000 F d'écart sur 100 000 (50 %) passe devant 400 000 F sur 40 000 000 (1 %).
    const { lignes } = synthese(ecarts([
      { cle: 'ventes', a: 1000, b: 1000, ...ANGRE_RIVIERA },
      { cle: 'petit', libelle: 'Petit poste', a: 100000, b: 150000, ...ANGRE_RIVIERA },
      { cle: 'gros', libelle: 'Gros poste', a: 40000000, b: 40400000, ...ANGRE_RIVIERA },
    ]), { nbJours: 25 })
    assert.deepEqual(lignes.map(l => l.cle), ['petit', 'gros'])
  })

  test('les ventes ne se répètent pas dans les lignes : elles sont déjà dans la phrase', () => {
    const { lignes } = synthese(LISTE(), { nbJours: 25 })
    assert.ok(!lignes.some(l => l.cle === 'ventes'))
  })

  test('une ligne non comparable n’entre pas dans la synthèse', () => {
    const { lignes } = synthese(ecarts([
      { cle: 'ventes', a: 1000, b: 900, ...ANGRE_RIVIERA },
      { cle: 'chargesFixesPct', a: 18, b: 21, unite: UNITE.POURCENT, comparable: false, raison: 'mois partiel', ...ANGRE_RIVIERA },
      { cle: 'mort', a: 0, b: 500, nbJoursA: 0, nbJoursB: 25, libelleA: 'Angré', libelleB: 'Riviera' },
    ]), { nbJours: 25 })
    assert.deepEqual(lignes, [])
  })

  test('ventes non comparables : la phrase devient la mention, pas un pourcentage', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 0, b: 900000, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 0, nbJoursB: 25 },
    ]), { nbJours: 25 })
    assert.equal(phrase, 'Angré : aucun point saisi sur cette période')
    assert.ok(!phrase.includes('%'))
  })

  test('A à zéro : la phrase garde le montant et ajoute l’explication, sans pourcentage', () => {
    const { phrase } = synthese(ecarts([
      {
        cle: 'ventes', a: 0, b: 900000, ...ANGRE_RIVIERA,
        phraseZeroA: 'Angré n’a rien vendu sur cette période',
      },
    ]), { nbJours: 25 })
    assert.match(phrase, /900 000 FCFA de plus/)
    assert.match(phrase, /rien vendu/)
    assert.ok(!phrase.includes('%'))
  })

  test('deux termes à égalité se disent, ils ne s’effacent pas', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 900000, b: 900000, ...ANGRE_RIVIERA },
    ]), { nbJours: 25 })
    assert.equal(phrase, 'Riviera fait exactement autant qu’Angré sur 25 jours.')
  })

  test('une seule journée se dit au singulier', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 900000, b: 800000, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 1, nbJoursB: 1 },
    ]), { nbJours: 1 })
    assert.match(phrase, /sur la journée/)
  })

  test('liste vide : aucune phrase, aucune ligne, aucune erreur', () => {
    assert.deepEqual(synthese(), { phrase: '', lignes: [] })
  })
})

describe('l’élision de la phrase de synthèse', () => {

  test('devant une voyelle, « que » s’élide', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 1000, b: 900, libelleA: 'Angré', libelleB: 'Riviera', nbJoursA: 7, nbJoursB: 7 },
    ]), { nbJours: 7 })
    assert.match(phrase, /qu’Angré/)
    assert.ok(!phrase.includes('que Angré'))
  })

  test('devant une consonne, « que » reste entier', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 1000, b: 900, libelleA: 'Riviera', libelleB: 'Angré', nbJoursA: 7, nbJoursB: 7 },
    ]), { nbJours: 7 })
    assert.match(phrase, /que Riviera/)
  })

  test('les deux modes : un nom de période s’élide aussi', () => {
    const { phrase } = synthese(ecarts([
      { cle: 'ventes', a: 1000, b: 1200, libelleA: 'Ce mois', libelleB: 'les 25 jours précédents', nbJoursA: 25, nbJoursB: 25 },
    ]), { nbJours: 25 })
    assert.match(phrase, /que Ce mois/)
  })
})

describe('synthese — un indicateur à zéro des deux côtés n’occupe pas une place', () => {

  test('les données d’un pilier non chargé ne poussent pas un vrai écart dehors', () => {
    const { lignes } = synthese(ecarts([
      { cle: 'ventes', a: 1000, b: 900, ...ANGRE_RIVIERA },
      { cle: 'foodPct', a: 0, b: 0, unite: UNITE.POURCENT, ...ANGRE_RIVIERA },
      { cle: 'laborPct', a: 0, b: 0, unite: UNITE.POURCENT, ...ANGRE_RIVIERA },
      { cle: 'benefice', a: 200, b: 100, ...ANGRE_RIVIERA },
    ]), { nbJours: 7 })
    assert.deepEqual(lignes.map(l => l.cle), ['benefice'])
  })
})
