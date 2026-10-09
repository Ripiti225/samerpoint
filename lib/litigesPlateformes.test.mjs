// Tests de lib/litigesPlateformes.js — litiges Yango/Glovo automatiques.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliserNom, quatreChiffres, compteCommeVendue, jourDe, heureDe, proposerCorrespondance,
} from './litigesPlateformes.js'

describe('normaliserNom', () => {
  test('minuscules, sans accents ni ponctuation', () => {
    assert.equal(normaliserNom('  Chawarma Poulet — XL ! '), 'chawarma poulet xl')
    assert.equal(normaliserNom('Thé glacé'), 'the glace')
    assert.equal(normaliserNom(null), '')
  })
})

describe('quatreChiffres', () => {
  test('garde les 4 derniers chiffres', () => {
    assert.equal(quatreChiffres('101791205516'), '5516')
    assert.equal(quatreChiffres(' 5516 '), '5516')
    assert.equal(quatreChiffres('YG-2510-0042'), '0042')
  })
  test('moins de 4 chiffres ou vide : null', () => {
    assert.equal(quatreChiffres('42'), null)
    assert.equal(quatreChiffres(''), null)
    assert.equal(quatreChiffres(null), null)
  })
})

describe('compteCommeVendue', () => {
  test('livrée : vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'glovo', statut: 'livree' }), true)
  })
  test('Yango annulée mais payée : vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: 4500 }), true)
  })
  test('Yango annulée sans paiement : pas vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: 0 }), false)
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: null }), false)
  })
  test('Glovo annulée : jamais vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'glovo', statut: 'annulee', montant_paye: 4500 }), false)
  })
  test('autre statut : pas vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'autre' }), false)
  })
})

describe('jourDe / heureDe — Abidjan = UTC', () => {
  test('découpe une date ISO', () => {
    assert.equal(jourDe('2026-10-08T23:59:00Z'), '2026-10-08')
    assert.equal(jourDe('2026-10-08T23:59:00.000+00:00'), '2026-10-08')
    assert.equal(heureDe('2026-10-08T14:07:31Z'), '14:07')
  })
})

describe('proposerCorrespondance', () => {
  const nomsPos = ['Chawarma poulet', 'Chawarma viande', 'Pizza reine', 'Coca 33cl']
  test('le nom POS le plus proche', () => {
    assert.equal(proposerCorrespondance('Chawarma Poulet XL', nomsPos), 'Chawarma poulet')
    assert.equal(proposerCorrespondance('PIZZA REINE', nomsPos), 'Pizza reine')
  })
  test('rien de ressemblant : null', () => {
    assert.equal(proposerCorrespondance('Burger double', nomsPos), null)
  })
})

import { comparerJournee } from './litigesPlateformes.js'

const RESTO = 'resto-1'
const JOUR = '2026-10-08'
const SHIFTS = [
  { restaurant_id: RESTO, date: JOUR, caissier_id: 'awa', caissier_nom: 'Awa', heure_debut: '08:00', heure_fin: '16:00' },
  { restaurant_id: RESTO, date: JOUR, caissier_id: 'koffi', caissier_nom: 'Koffi', heure_debut: '16:00', heure_fin: '23:59' },
]
const CORR = new Map([
  ['chawarma poulet xl', { nom_pos: 'Chawarma poulet', ignorer: false }],
  ['coca cola 33cl', { nom_pos: 'Coca', ignorer: false }],
  ['sauce blanche', { nom_pos: null, ignorer: true }],
])
const pf = (numero, heure, lignes, extra = {}) => ({
  plateforme: 'yango', numero, commande_le: `${JOUR}T${heure}:00Z`, statut: 'livree', montant_paye: 5000, lignes, ...extra,
})
const pos = (id, ref, heure, caissier, items) => ({
  id, numero_ticket: Number(id.replace(/\D/g, '')) || 1, ref_partenaire: ref, created_at: `${JOUR}T${heure}:00Z`,
  caissier_id: caissier, caissier_nom: caissier === 'awa' ? 'Awa' : 'Koffi', items,
})
const base = over => ({
  plateforme: 'yango', restaurantId: RESTO, jour: JOUR, posPresent: true,
  commandesPlateforme: [], commandesPos: [], correspondances: CORR, posIgnores: new Set(),
  prixReference: { 'chawarma poulet': 3000, coca: 1000 }, shifts: SHIFTS, ...over,
})

describe('comparerJournee', () => {
  test('mêmes plats des deux côtés : aucun litige, même tapés en retard', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Chawarma Poulet XL', quantite: 2, prix_unitaire: 3500 }])],
      commandesPos: [pos('c1', '1234', '15:30', 'awa', [{ nom: 'Chawarma poulet', quantite: 2, prix_unitaire: 3000 }])],
    }))
    assert.equal(r.statut, 'calculee')
    assert.deepEqual(r.litiges, [])
  })

  test('tapé + : commande POS sans équivalent plateforme → caissier qui l’a tapée', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }])],
      commandesPos: [
        pos('c1', '1234', '12:05', 'awa', [{ nom: 'Chawarma poulet', quantite: 1, prix_unitaire: 3000 }]),
        pos('c2', '7777', '18:00', 'koffi', [{ nom: 'Chawarma poulet', quantite: 2, prix_unitaire: 3000 }]),
      ],
    }))
    assert.equal(r.litiges.length, 1)
    const l = r.litiges[0]
    assert.equal(l.type, 'tape_plus')
    assert.equal(l.montant, 6000)
    assert.equal(l.responsable_id, 'koffi')
    assert.equal(l.cle_auto, `yango|${RESTO}|${JOUR}|tape_plus|id:koffi`)
    assert.equal(l.numero_commande, '7777')
    assert.equal(l.detail.lignes.length, 2)
  })

  test('tapé − : commande plateforme absente du POS → caissier présent à son heure', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [
        pf('900001234', '12:00', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }]),
        pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }]),
      ],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Chawarma poulet', quantite: 1, prix_unitaire: 3000 }])],
    }))
    assert.equal(r.litiges.length, 1)
    assert.equal(r.litiges[0].type, 'tape_moins')
    assert.equal(r.litiges[0].montant, 3000)
    assert.equal(r.litiges[0].responsable_id, 'koffi')
    assert.equal(r.litiges[0].numero_commande, '900005678')
  })

  test('prix du plat manquant : prix POS du jour, sinon prix de référence, sinon prix plateforme', () => {
    const r = comparerJournee(base({
      prixReference: {},
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Coca Cola 33cl', quantite: 1, prix_unitaire: 1500 }])],
      commandesPos: [pos('c9', '0001', '10:00', 'awa', [{ nom: 'Chawarma poulet', quantite: 1, prix_unitaire: 3000 }])],
    }))
    // Coca : aucun prix POS → prix plateforme 1500 ; chawarma POS sans équivalent → tapé + 3000
    const moins = r.litiges.find(l => l.type === 'tape_moins')
    assert.equal(moins.montant, 1500)
  })

  test('sous le seuil de 1 000 F : rien', () => {
    const r = comparerJournee(base({
      prixReference: { coca: 500 },
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Coca Cola 33cl', quantite: 1, prix_unitaire: 500 }])],
    }))
    assert.deepEqual(r.litiges, [])
  })

  test('Yango annulée mais payée : compte comme vendue', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }], { statut: 'annulee', montant_paye: 3000 })],
    }))
    assert.equal(r.litiges[0].type, 'tape_moins')
  })

  test('annulée non payée : ignorée', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }], { statut: 'annulee', montant_paye: 0 })],
    }))
    assert.deepEqual(r.litiges, [])
  })

  test('plat plateforme non relié : journée à relier, aucun litige', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Burger double', quantite: 1, prix_unitaire: 4000 }])],
    }))
    assert.equal(r.statut, 'a_relier')
    assert.deepEqual(r.nomsInconnus, ['Burger double'])
    assert.deepEqual(r.litiges, [])
  })

  test('plat plateforme « ignorer » et plat POS ignoré : hors comparaison', () => {
    const r = comparerJournee(base({
      posIgnores: new Set(['frites']),
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Sauce blanche', quantite: 3, prix_unitaire: 0 }])],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Frites', quantite: 2, prix_unitaire: 1000 }])],
    }))
    assert.deepEqual(r.litiges, [])
  })

  test('POS absent ce jour-là : pos_manquant, aucun litige', () => {
    const r = comparerJournee(base({
      posPresent: false,
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.equal(r.statut, 'pos_manquant')
    assert.deepEqual(r.litiges, [])
  })

  test('heure ambiguë : litige sans responsable', () => {
    const r = comparerJournee(base({
      shifts: [],
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.equal(r.litiges[0].responsable_id, null)
    assert.equal(r.litiges[0].cle_auto, `yango|${RESTO}|${JOUR}|tape_moins|personne`)
  })
})
