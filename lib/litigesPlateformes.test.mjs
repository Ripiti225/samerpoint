// Tests de lib/litigesPlateformes.js — litiges Yango/Glovo automatiques.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliserNom, quatreChiffres, compteCommeVendue, jourDe, heureDe, proposerCorrespondance,
  comparerJournee, retenuesJournee, planEcriture, sansTaille, cleComparaison, memeCommande,
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

describe('retenuesJournee', () => {
  test('un remboursement et une pénalité → deux litiges au caissier de l’heure', () => {
    const r = retenuesJournee({
      plateforme: 'glovo', restaurantId: RESTO, jour: JOUR, shifts: SHIFTS,
      commandesPlateforme: [
        { plateforme: 'glovo', numero: '101791205516', commande_le: `${JOUR}T13:00:00Z`, statut: 'livree', rembourse: 2500, penalite_attente: 0, lignes: [] },
        { plateforme: 'glovo', numero: '101791209999', commande_le: `${JOUR}T19:00:00Z`, statut: 'livree', rembourse: 0, penalite_attente: 700, lignes: [] },
      ],
    })
    assert.deepEqual(r.map(l => [l.type, l.montant, l.responsable_id, l.numero_commande]), [
      ['remboursement', 2500, 'awa', '101791205516'],
      ['temps_attente', 700, 'koffi', '101791209999'],
    ])
    assert.equal(r[0].cle_auto, `glovo|${RESTO}|${JOUR}|remboursement|101791205516`)
  })
})

describe('planEcriture', () => {
  const calcule = { type: 'tape_plus', montant: 6000, responsable_id: 'koffi', responsable_nom: 'Koffi', cle_auto: 'k1', numero_commande: '7777', notes: '2 × Chawarma poulet', detail: { lignes: [] } }

  test('nouveau litige : inséré', () => {
    const p = planEcriture({ calcules: [calcule], existants: [], annules: new Set(), typesCouverts: ['tape_plus', 'tape_moins'] })
    assert.deepEqual(p.aInserer.map(l => l.cle_auto), ['k1'])
    assert.deepEqual(p.aSupprimer, [])
  })
  test('litige annulé par le manager : jamais recréé', () => {
    const p = planEcriture({ calcules: [calcule], existants: [], annules: new Set(['k1']), typesCouverts: ['tape_plus'] })
    assert.deepEqual(p.aInserer, [])
  })
  test('déjà là, montant changé : mis à jour', () => {
    const p = planEcriture({
      calcules: [calcule], annules: new Set(), typesCouverts: ['tape_plus'],
      existants: [{ id: 'x', type: 'tape_plus', origine: 'auto', cle_auto: 'k1', montant: 3000, responsable_id: 'koffi', responsable_nom: 'Koffi', notes: '1 × Chawarma poulet', numero_commande: '7777' }],
    })
    assert.deepEqual(p.aMettreAJour.map(l => [l.id, l.montant]), [['x', 6000]])
    assert.deepEqual(p.aInserer, [])
  })
  test('auto qui n’a plus lieu d’être : supprimé', () => {
    const p = planEcriture({
      calcules: [], annules: new Set(), typesCouverts: ['tape_plus'],
      existants: [{ id: 'x', type: 'tape_plus', origine: 'auto', cle_auto: 'k1', montant: 3000 }],
    })
    assert.deepEqual(p.aSupprimer, ['x'])
  })
  test('l’auto remplace la saisie manuelle du même type, pas des autres types', () => {
    const p = planEcriture({
      calcules: [calcule], annules: new Set(), typesCouverts: ['tape_plus', 'tape_moins'],
      existants: [
        { id: 'm1', type: 'tape_plus', origine: 'manuel', cle_auto: null, montant: 5000 },
        { id: 'm2', type: 'temps_attente', origine: 'manuel', cle_auto: null, montant: 500 },
      ],
    })
    assert.deepEqual(p.aSupprimer, ['m1'])
  })
})

describe('retenuesJournee — Yango', () => {
  test('Yango ne donne ni remboursement ni attente : aucun litige de retenue', () => {
    const r = retenuesJournee({
      plateforme: 'yango', restaurantId: RESTO, jour: JOUR, shifts: SHIFTS,
      commandesPlateforme: [{ plateforme: 'yango', numero: '261008-CI0870074', commande_le: `${JOUR}T13:00:00Z`, statut: 'livree', rembourse: 2500, penalite_attente: 700, lignes: [] }],
    })
    assert.deepEqual(r, [])
  })
})

describe('la taille ne compte pas (les portails ne la donnent jamais)', () => {
  const corr = new Map([
    ['bolognaise', { nom_pos: 'Pizza Bolognaise (M)', ignorer: false }],
    ['reine', { nom_pos: 'Pizza Reine (G)', ignorer: false }],
  ])

  test('sansTaille / cleComparaison : seulement la taille entre parenthèses à la fin', () => {
    assert.equal(sansTaille('Pizza Bolognaise (G)'), 'Pizza Bolognaise')
    assert.equal(sansTaille('Eau Céleste (Grande)'), 'Eau Céleste')
    assert.equal(sansTaille('Steak petit pois'), 'Steak petit pois')
    assert.equal(sansTaille('Chawarma (poulet)'), 'Chawarma (poulet)')
    assert.equal(cleComparaison('Pizza Bolognaise (M)'), cleComparaison('pizza bolognaise (g)'))
  })

  test('relié à la (M), tapé (G) dans le POS : aucun litige', () => {
    const r = comparerJournee(base({
      correspondances: corr,
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Bolognaise', quantite: 1, prix_unitaire: 7500 }])],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Pizza Bolognaise (G)', quantite: 1, prix_unitaire: 8000 }])],
    }))
    assert.equal(r.statut, 'calculee')
    assert.deepEqual(r.litiges, [])
  })

  test('une vraie pizza en trop reste un tapé +, quelle que soit la taille', () => {
    const r = comparerJournee(base({
      correspondances: corr,
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Reine', quantite: 1, prix_unitaire: 7500 }])],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [
        { nom: 'Pizza Reine (M)', quantite: 1, prix_unitaire: 7000 },
        { nom: 'Pizza Reine (G)', quantite: 1, prix_unitaire: 8000 },
      ])],
    }))
    assert.equal(r.litiges.length, 1)
    assert.equal(r.litiges[0].type, 'tape_plus')
    assert.equal(r.litiges[0].montant, 7500)          // moyenne des pizzas Reine tapées ce jour-là
  })

  test('pizza oubliée : tapé − sans taille, au prix de référence du plat relié', () => {
    const r = comparerJournee(base({
      correspondances: corr,
      prixReference: { 'pizza bolognaise m': 7000 },
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Bolognaise', quantite: 1, prix_unitaire: 7500 }])],
      commandesPos: [pos('c9', '0001', '10:00', 'awa', [])],
    }))
    assert.equal(r.litiges.length, 1)
    assert.equal(r.litiges[0].type, 'tape_moins')
    assert.equal(r.litiges[0].montant, 7000)
    assert.equal(r.litiges[0].notes, '1 × Pizza Bolognaise')
  })
})

describe('erreur de saisie : mauvais plat tapé sur la même commande', () => {
  const corr = new Map([
    ['tacos poulet', { nom_pos: 'Tacos poulet', ignorer: false }],
    ['chawarma viande', { nom_pos: 'Chawarma Viande', ignorer: false }],
  ])

  test('memeCommande : 4 derniers chiffres, numéro entier, une faute de frappe', () => {
    assert.equal(memeCommande('101796987941', '7941'), true)
    assert.equal(memeCommande('101796987941', '101796987941'), true)
    assert.equal(memeCommande('101796987941', '1017969879414'), true)   // chiffre en trop (Samer Oasis, 08/10)
    assert.equal(memeCommande('101796987941', '7942'), true)            // un chiffre faux
    assert.equal(memeCommande('101796987941', '794'), false)            // moins de 4 chiffres : trop vague
    assert.equal(memeCommande('101796987941', '5516'), false)
    assert.equal(memeCommande('101796987941', '41'), false)
    assert.equal(memeCommande('101796987941', null), false)
  })

  test('même prix : aucun litige, erreur signalée au caissier qui a tapé', () => {
    const r = comparerJournee(base({
      plateforme: 'glovo', correspondances: corr,
      commandesPlateforme: [pf('101796987941', '20:36', [{ nom: 'Chawarma Viande', quantite: 1, prix_unitaire: 2500 }])],
      commandesPos: [pos('c1', '1017969879414', '21:16', 'koffi', [{ nom: 'Chawarma Mélange', quantite: 1, prix_unitaire: 2500 }])],
    }))
    assert.deepEqual(r.litiges, [])
    assert.equal(r.erreursSaisie.length, 1)
    assert.deepEqual(
      [r.erreursSaisie[0].vendu, r.erreursSaisie[0].tape, r.erreursSaisie[0].prix_tape, r.erreursSaisie[0].caissier_id],
      ['Chawarma Viande', 'Chawarma Mélange', 2500, 'koffi'],
    )
  })

  test('autre prix : toujours aucun litige, les deux prix sont notés', () => {
    const r = comparerJournee(base({
      correspondances: corr, prixReference: { 'tacos poulet': 3000 },
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Tacos poulet', quantite: 1, prix_unitaire: 3500 }])],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Tacos viande', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.deepEqual(r.litiges, [])
    assert.deepEqual([r.erreursSaisie[0].prix_vendu, r.erreursSaisie[0].prix_tape], [3000, 3500])
  })

  test('numéros différents : pas une erreur de saisie, les deux litiges restent', () => {
    const r = comparerJournee(base({
      correspondances: corr, prixReference: { 'tacos poulet': 3000 },
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Tacos poulet', quantite: 1, prix_unitaire: 3500 }])],
      commandesPos: [pos('c1', '5678', '12:05', 'awa', [{ nom: 'Tacos viande', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.deepEqual(r.erreursSaisie, [])
    assert.deepEqual(r.litiges.map(l => l.type).sort(), ['tape_moins', 'tape_plus'])
  })

  test('sans numéro tapé dans le POS : pas de rapprochement', () => {
    const r = comparerJournee(base({
      correspondances: corr, prixReference: { 'tacos poulet': 3000 },
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Tacos poulet', quantite: 1, prix_unitaire: 3500 }])],
      commandesPos: [pos('c1', null, '12:05', 'awa', [{ nom: 'Tacos viande', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.deepEqual(r.erreursSaisie, [])
    assert.equal(r.litiges.length, 2)
  })

  test('un plat de plus sur la même commande reste un tapé + (une erreur ne couvre qu’un plat)', () => {
    const r = comparerJournee(base({
      correspondances: corr, prixReference: { 'tacos poulet': 3000 },
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Tacos poulet', quantite: 1, prix_unitaire: 3500 }])],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Tacos viande', quantite: 2, prix_unitaire: 3500 }])],
    }))
    assert.equal(r.erreursSaisie.length, 1)
    assert.deepEqual(r.litiges.map(l => [l.type, l.montant]), [['tape_plus', 3500]])
  })
})
