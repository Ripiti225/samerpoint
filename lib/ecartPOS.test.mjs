// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/ecartPOS.js — les écarts de caisse mesurés par le POS.
//
// Sur un site basculé, `points.ecart_caisse` (calculé par Samtrackly) vaut
// structurellement 0 : la vente des shifts et la vente machine deviennent deux
// vues du même système. Le vrai écart est celui que la caisse a mesuré au
// comptage à l'aveugle, shift par shift. Si l'écran Ventes continue d'afficher
// l'ancien, le gérant lira « aucun écart » un jour où il manque 20 000 F.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { ecartsParCaissier } from './ecartPOS.js'

// La journée décrite par le boss : un surplus qui compense un manquant.
const JOURNEE = [
  { caissier_nom: 'Marie Paule', ecart_pos: 2500, pos_service_id: 'a' },
  { caissier_nom: 'Hilary', ecart_pos: -2500, pos_service_id: 'b' },
  { caissier_nom: 'Flora', ecart_pos: -2000, pos_service_id: 'c' },
]

describe('ecartsParCaissier — la ventilation affichée au gérant', () => {

  test('une ligne par caissière, dans l’ordre des shifts', () => {
    const { lignes } = ecartsParCaissier(JOURNEE)
    assert.deepEqual(lignes, [
      { nom: 'Marie Paule', ecart: 2500 },
      { nom: 'Hilary', ecart: -2500 },
      { nom: 'Flora', ecart: -2000 },
    ])
  })

  test('une explication renseignée par la caissière accompagne son écart', () => {
    const { lignes } = ecartsParCaissier([
      { caissier_nom: 'Hilary', ecart_pos: -2500, explication_ecart: 'Billet remis en trop au client' },
    ])
    assert.deepEqual(lignes, [
      { nom: 'Hilary', ecart: -2500, explication: 'Billet remis en trop au client' },
    ])
  })

  test('une explication vide n’est pas exposée à l’écran', () => {
    const { lignes } = ecartsParCaissier([
      { caissier_nom: 'Flora', ecart_pos: 0, explication_ecart: '   ' },
    ])
    assert.deepEqual(lignes, [{ nom: 'Flora', ecart: 0 }])
  })

  test('le total est un solde : un surplus compense un manquant', () => {
    assert.equal(ecartsParCaissier(JOURNEE).total, -2000)
  })

  // ── Mesuré à zéro ≠ pas mesuré. Confondre les deux invente ou cache un écart.

  test('un écart mesuré à zéro est une mesure, pas une absence', () => {
    const r = ecartsParCaissier([{ caissier_nom: 'Flora', ecart_pos: 0, pos_service_id: 'a' }])
    assert.equal(r.mesures, 1)
    assert.equal(r.sansMesure, 0)
    assert.deepEqual(r.lignes, [{ nom: 'Flora', ecart: 0 }])
  })

  test('un shift saisi à la main est compté à part et n’entre pas dans le total', () => {
    // Cas réel du jour de bascule : des shifts d'avant le changement.
    const r = ecartsParCaissier([
      { caissier_nom: 'Flora', ecart_pos: -2000, pos_service_id: 'a' },
      { caissier_nom: 'Hilary', ecart_pos: null, pos_service_id: null },
    ])
    assert.equal(r.total, -2000)
    assert.equal(r.mesures, 1)
    assert.equal(r.sansMesure, 1)
    assert.equal(r.lignes.length, 1)
  })

  test('un shift sans nom garde quand même sa ligne', () => {
    // On ne fait jamais disparaître de l'argent parce qu'un nom manque.
    const { lignes, total } = ecartsParCaissier([{ caissier_nom: null, ecart_pos: -5000, pos_service_id: 'a' }])
    assert.equal(total, -5000)
    assert.equal(lignes.length, 1)
    assert.ok(lignes[0].nom.length > 0, 'la ligne doit porter un libellé lisible')
  })

  test('une journée sans aucun shift ne casse rien', () => {
    for (const vide of [[], null, undefined]) {
      const r = ecartsParCaissier(vide)
      assert.equal(r.total, 0)
      assert.deepEqual(r.lignes, [])
      assert.equal(r.mesures, 0)
    }
  })

  test('une journée entièrement saisie à la main n’affiche aucune ligne', () => {
    // Un site non basculé : l'écran doit continuer à montrer l'ancien écart.
    const r = ecartsParCaissier([
      { caissier_nom: 'Flora', ecart_pos: null, pos_service_id: null },
      { caissier_nom: 'Hilary', ecart_pos: null, pos_service_id: null },
    ])
    assert.equal(r.mesures, 0)
    assert.equal(r.sansMesure, 2)
    assert.deepEqual(r.lignes, [])
  })
})
