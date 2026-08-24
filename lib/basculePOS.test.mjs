// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/basculePOS.js — le feu vert avant de basculer un site.
//
// Ce que ces tests protègent, en une phrase : le 2026-08-17, Angré 7E est passé
// sur le POS le matin alors que la remontée n'existait pas. Mettre ce site en
// 'POS' ce jour-là aurait fait disparaître ses trois caissières de l'écran de
// connexion sans que rien ne les remplace — trois shifts de recette perdus par
// jour, sans message d'erreur. La règle est donc : on ne bascule pas un site
// parce que la caisse est installée, mais parce qu'on a VU un shift en arriver.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { diagnosticBascule, ETAT_BASCULE, compterShiftsParRestaurant } from './basculePOS.js'

const SAMTRACKLY = { nom: 'Samer Angré 7E', source_point: 'SAMTRACKLY' }
const SUR_POS = { nom: 'Samer Angré 7E', source_point: 'POS' }

describe('diagnosticBascule — peut-on basculer ce site ?', () => {

  test('un site dont la remontée n’a jamais marché ne peut pas basculer', () => {
    // L'état réel d'Angré 7E le 2026-08-17 : POS installé, 0 shift remonté.
    const d = diagnosticBascule(SAMTRACKLY, { pos: 0, main: 21 })
    assert.equal(d.etat, ETAT_BASCULE.PAS_PRET)
    assert.equal(d.peutBasculer, false)
  })

  test('un site sans aucun shift du tout ne peut pas basculer', () => {
    // Site neuf, ou requête revenue vide : on ne bascule pas sur une absence.
    const d = diagnosticBascule(SAMTRACKLY, { pos: 0, main: 0 })
    assert.equal(d.etat, ETAT_BASCULE.PAS_PRET)
    assert.equal(d.peutBasculer, false)
  })

  test('un shift arrivé du POS ouvre le feu vert', () => {
    const d = diagnosticBascule(SAMTRACKLY, { pos: 1, main: 20 })
    assert.equal(d.etat, ETAT_BASCULE.PRET)
    assert.equal(d.peutBasculer, true)
  })

  test('un site déjà basculé et propre est signalé comme tel', () => {
    const d = diagnosticBascule(SUR_POS, { pos: 21, main: 0 })
    assert.equal(d.etat, ETAT_BASCULE.BASCULE)
    assert.equal(d.peutBasculer, false)  // déjà fait
  })

  test('un site basculé où l’on saisit encore à la main est signalé incohérent', () => {
    // Symptôme du double comptage : une journée peut être comptée deux fois.
    const d = diagnosticBascule(SUR_POS, { pos: 14, main: 7 })
    assert.equal(d.etat, ETAT_BASCULE.INCOHERENT)
  })

  // ── La sortie de secours ne se ferme JAMAIS ──
  // Le mini-PC d'un site est déjà tombé plusieurs fois. Le soir où ça arrive,
  // le manager doit pouvoir rendre la saisie à ses caissières sans condition.

  test('le retour vers Samtrackly est toujours possible sur un site basculé', () => {
    for (const comptes of [{ pos: 21, main: 0 }, { pos: 14, main: 7 }, { pos: 0, main: 0 }]) {
      assert.equal(diagnosticBascule(SUR_POS, comptes).peutRevenir, true)
    }
  })

  test('un site déjà sur Samtrackly n’a rien à quoi revenir', () => {
    assert.equal(diagnosticBascule(SAMTRACKLY, { pos: 3, main: 0 }).peutRevenir, false)
  })

  // ── Robustesse : ces compteurs viennent d'une requête réseau ──

  test('des compteurs absents interdisent la bascule sans faire tomber l’écran', () => {
    for (const comptes of [null, undefined, {}, { pos: null, main: null }]) {
      const d = diagnosticBascule(SAMTRACKLY, comptes)
      assert.equal(d.peutBasculer, false)
      assert.equal(d.etat, ETAT_BASCULE.PAS_PRET)
    }
  })

  test('le diagnostic est cohérent avec l’état réel du 2026-08-17', () => {
    // Ce jour-là : 7 sites, tous en SAMTRACKLY, aucun shift remonté du POS.
    // Aucun ne doit pouvoir basculer, y compris Angré 7E qui a la caisse.
    const shifts = Array.from({ length: 22 }, () => ({ restaurant_id: 'r7', pos_service_id: null }))
    const comptes = compterShiftsParRestaurant(shifts)
    const d = diagnosticBascule({ nom: 'Samer Angré 7E', source_point: 'SAMTRACKLY' }, comptes.r7)
    assert.equal(d.peutBasculer, false)
    assert.equal(d.etat, ETAT_BASCULE.PAS_PRET)
  })

  test('chaque diagnostic porte une explication en français', () => {
    const cas = [
      [SAMTRACKLY, { pos: 0, main: 21 }],
      [SAMTRACKLY, { pos: 1, main: 20 }],
      [SUR_POS, { pos: 21, main: 0 }],
      [SUR_POS, { pos: 14, main: 7 }],
    ]
    for (const [resto, comptes] of cas) {
      const { message } = diagnosticBascule(resto, comptes)
      assert.ok(message.length > 20, `message trop court : « ${message} »`)
    }
  })
})

describe('compterShiftsParRestaurant — d’où viennent les shifts', () => {

  test('sépare les shifts venus du POS de ceux saisis à la main', () => {
    const comptes = compterShiftsParRestaurant([
      { restaurant_id: 'r7', pos_service_id: 'svc-1' },
      { restaurant_id: 'r7', pos_service_id: 'svc-2' },
      { restaurant_id: 'r7', pos_service_id: null },
      { restaurant_id: 'palm', pos_service_id: null },
    ])
    assert.deepEqual(comptes.r7, { pos: 2, main: 1 })
    assert.deepEqual(comptes.palm, { pos: 0, main: 1 })
  })

  test('une chaîne vide compte comme saisi à la main', () => {
    // Ce que renverrait une colonne remplie par erreur avec ''.
    const comptes = compterShiftsParRestaurant([{ restaurant_id: 'r7', pos_service_id: '' }])
    assert.deepEqual(comptes.r7, { pos: 0, main: 1 })
  })

  test('un restaurant sans shift n’a pas d’entrée', () => {
    const comptes = compterShiftsParRestaurant([{ restaurant_id: 'r7', pos_service_id: null }])
    assert.equal(comptes.palm, undefined)
  })

  test('une liste absente ou vide ne fait pas tomber l’écran', () => {
    assert.deepEqual(compterShiftsParRestaurant([]), {})
    assert.deepEqual(compterShiftsParRestaurant(null), {})
    assert.deepEqual(compterShiftsParRestaurant(undefined), {})
  })

  test('un shift sans restaurant_id est ignoré', () => {
    // Régression connue : des shifts sans restaurant_id ont déjà cassé le report
    // de stock (migration supabase_shift_restaurant_obligatoire.sql).
    const comptes = compterShiftsParRestaurant([
      { restaurant_id: null, pos_service_id: 'svc-1' },
      { restaurant_id: 'r7', pos_service_id: 'svc-2' },
    ])
    assert.deepEqual(comptes.r7, { pos: 1, main: 0 })
    assert.equal(Object.keys(comptes).length, 1)
  })
})
