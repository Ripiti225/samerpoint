// Tests de lib/accueilGerant.js — le bandeau du jour de l'accueil gérant.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { etatPointHier, lignesCaissiersHier, texteDemandes } from './accueilGerant.js'

describe('etatPointHier', () => {
  test('les corrections demandées passent avant tout', () => {
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: true }, nbCorrections: 2 }),
      { cle: 'corrections', texte: '2 corrections demandées par le manager' })
    assert.equal(etatPointHier({ point: null, nbCorrections: 1 }).texte, '1 correction demandée par le manager')
  })
  test('validé, vérifié, en attente, pas saisi', () => {
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: true }, nbCorrections: 0 }), { cle: 'verifie', texte: "Point d'hier validé et vérifié" })
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: false } }), { cle: 'valide', texte: "Point d'hier validé" })
    assert.deepEqual(etatPointHier({ point: { valide: false } }), { cle: 'en_attente', texte: "Point d'hier pas encore validé" })
    assert.deepEqual(etatPointHier({ point: null }), { cle: 'absent', texte: "Point d'hier pas encore saisi" })
  })
})

describe('texteDemandes', () => {
  test('singulier, pluriel, zéro', () => {
    assert.equal(texteDemandes({ demandes: 2, explications: 1 }), '2 demandes en attente · 1 explication en cours')
    assert.equal(texteDemandes({ demandes: 1, explications: 0 }), '1 demande en attente')
    assert.equal(texteDemandes({ demandes: 0, explications: 3 }), '3 explications en cours')
    assert.equal(texteDemandes({ demandes: 0, explications: 0 }), 'Aucune demande en attente')
  })
})

describe('lignesCaissiersHier — vente, écart et explication de chaque caissier', () => {
  const sh = (caissier_nom, heure_debut, heure_fin, vente_shift, ecart_pos, explication_ecart = '') =>
    ({ id: caissier_nom, caissier_nom, heure_debut, heure_fin, vente_shift, ecart_pos, explication_ecart })

  test('dans l’ordre des shifts, avec le sens de l’écart', () => {
    const r = lignesCaissiersHier([
      sh('Ange Marie ', '16:43', '00:40', '775800', '500', 'espece mal compter'),
      sh('Moise', '00:25', '08:14', '230500', '0'),
      sh('Flora', '08:38', '16:38', '345000', '-7500', ' une table non payer '),
    ])
    assert.deepEqual(r.map(x => [x.nom, x.horaire, x.vente, x.ecart, x.sensEcart, x.explication, x.sansExplication]), [
      ['Moise', '00:25 → 08:14', 230500, 0, 'nul', '', false],
      ['Flora', '08:38 → 16:38', 345000, -7500, 'negatif', 'une table non payer', false],
      ['Ange Marie', '16:43 → 00:40', 775800, 500, 'positif', 'espece mal compter', false],
    ])
  })
  test('un écart sans explication est signalé ; écart inconnu = pas d’écart', () => {
    const r = lignesCaissiersHier([sh('Axel', '17:55', null, '249500', '1000'), sh('Simi', '07:57', '15:41', null, null)])
    assert.equal(r[1].sansExplication, true)
    assert.equal(r[1].horaire, '17:55 → …')
    assert.deepEqual([r[0].vente, r[0].ecart, r[0].sensEcart, r[0].sansExplication], [0, 0, 'nul', false])
  })
})
