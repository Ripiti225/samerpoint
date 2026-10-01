// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/tresorerie.js — le socle de l'onglet Trésorerie.
//
// Ce qui justifie ce fichier : la trésorerie nette est le chiffre que M. Zreik
// regarde pour décider de payer ou non. Un reste compté deux fois, un loyer
// marqué payé pour le mauvais mois ou un recalage de signe inversé faussent
// directement cette décision.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATEGORIES_DU, resteDu, totalPaye, soldeCompte, montantRecalage,
  calculerTresorerieNette, statutLoyer, moisEntre, moisLoyersACreer,
  repartirPaiement, echeanceCnpsParDefaut, joursDeRetard, niveauTresorerie,
  peut, premierDuMois, libelleMois, fournisseursDus,
} from './tresorerie.js'

describe('restes', () => {
  test('reste = dû − payé', () => {
    assert.equal(resteDu({ montant_du: 1950000 }, [{ montant: 1000000 }]), 950000)
  })
  test('jamais négatif en cas de trop-payé', () => {
    assert.equal(resteDu({ montant_du: 100 }, [{ montant: 150 }]), 0)
  })
  test('sans paiement, reste = dû', () => {
    assert.equal(resteDu({ montant_du: 412000 }, []), 412000)
    assert.equal(resteDu({ montant_du: 412000 }), 412000)
  })
  test('totalPaye ignore les montants vides', () => {
    assert.equal(totalPaye([{ montant: 10 }, { montant: null }, {}]), 10)
  })
})

describe('banque', () => {
  test('solde = somme des mouvements signés', () => {
    assert.equal(soldeCompte([{ montant: 1000 }, { montant: -300 }, { montant: 50 }]), 750)
  })
  test('recalage = relevé − solde courant', () => {
    assert.equal(montantRecalage(18450000, 18462500), -12500)
    assert.equal(montantRecalage(500, 0), 500)
  })
})

describe('trésorerie nette', () => {
  const comptes = [
    { id: 'baci', mouvements: [{ montant: 18450000 }] },
    { id: 'sib', mouvements: [{ montant: 6200000 }] },
  ]
  const dus = [
    { id: 'l1', categorie: 'loyer', montant_du: 900000, mois: '2026-09-01' },
    { id: 's1', categorie: 'salaire', montant_du: 1950000, mois: '2026-09-01' },
    { id: 'c1', categorie: 'cnps', montant_du: 412000, mois: '2026-07-01' },
    { id: 'a1', categorie: 'admin', montant_du: 300000 },
    { id: 'd1', categorie: 'dette', montant_du: 6000000 },
    { id: 'l2', categorie: 'loyer', montant_du: 800000, mois: '2026-11-01' },
  ]
  const paiements = [
    { du_id: 'l1', montant: 900000 },
    { du_id: 's1', montant: 1000000 },
  ]

  test('formule complète', () => {
    const r = calculerTresorerieNette({
      comptes, dus, paiements, fournisseursDus: 5400000, partenaires: 0, moisCourant: '2026-10-01',
    })
    assert.equal(r.banque, 24650000)
    assert.equal(r.loyers, 0)            // l1 soldé, l2 dans le futur
    assert.equal(r.salaires, 950000)
    assert.equal(r.cnps, 412000)
    assert.equal(r.admin, 300000)
    assert.equal(r.dettes, 6000000)
    assert.equal(r.fournisseurs, 5400000)
    assert.equal(r.partenaires, 0)
    assert.equal(r.nette, 24650000 - 950000 - 412000 - 300000 - 6000000 - 5400000)
  })

  test('un loyer d\'un mois futur ne compte pas encore', () => {
    const r = calculerTresorerieNette({
      comptes: [], dus: [dus[5]], paiements: [], fournisseursDus: 0, moisCourant: '2026-10-01',
    })
    assert.equal(r.loyers, 0)
  })

  test('les partenaires s\'ajoutent', () => {
    const r = calculerTresorerieNette({ comptes: [], dus: [], paiements: [], fournisseursDus: 0, partenaires: 1000 })
    assert.equal(r.nette, 1000)
  })
})

describe('fournisseurs dus', () => {
  test('somme des crédits positifs des fournisseurs actifs', () => {
    assert.equal(fournisseursDus([
      { credit_actuel: 1000, actif: true },
      { credit_actuel: -500, actif: true },   // avance (cotisation) : pas une dette
      { credit_actuel: 2000, actif: false },  // fournisseur archivé
      { credit_actuel: 300 },                 // actif non renseigné = actif
    ]), 1300)
  })
})

describe('statut des loyers', () => {
  const du = { montant_du: 1100000, echeance: '2026-09-05' }
  test('soldé → payé (vert)', () => {
    assert.equal(statutLoyer(du, [{ montant: 1100000 }], '2026-09-30'), 'paye')
  })
  test('le jour de l\'échéance → encore à payer (orange)', () => {
    assert.equal(statutLoyer(du, [], '2026-09-05'), 'a_payer')
  })
  test('dès le lendemain → en retard (rouge)', () => {
    assert.equal(statutLoyer(du, [], '2026-09-06'), 'en_retard')
  })
  test('un paiement partiel reste en retard', () => {
    assert.equal(statutLoyer(du, [{ montant: 500000 }], '2026-09-30'), 'en_retard')
  })
})

describe('mois', () => {
  test('premierDuMois', () => {
    assert.equal(premierDuMois('2026-09-28'), '2026-09-01')
  })
  test('moisEntre inclut les bornes et passe l\'année', () => {
    assert.deepEqual(moisEntre('2026-11-01', '2027-02-01'),
      ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'])
  })
  test('moisEntre vide si départ après la fin', () => {
    assert.deepEqual(moisEntre('2026-11-01', '2026-10-01'), [])
  })
  test('libelleMois', () => {
    assert.equal(libelleMois('2026-09-01'), 'Septembre 2026')
  })
})

describe('création des loyers', () => {
  test('crée les mois manquants, avec l\'échéance au jour réglé', () => {
    const loyers = [{ restaurant_id: 'kms', montant: 1100000, jour_echeance: 5, mois_depart: '2026-08-01', actif: true }]
    const existants = [{ categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01' }]
    assert.deepEqual(moisLoyersACreer(loyers, existants, '2026-10-01'), [
      { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 1100000, echeance: '2026-09-05' },
      { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-10-01', montant_du: 1100000, echeance: '2026-10-05' },
    ])
  })
  test('jour 31 ramené au dernier jour d\'un mois court', () => {
    const loyers = [{ restaurant_id: 'r', montant: 1, jour_echeance: 31, mois_depart: '2026-02-01', actif: true }]
    assert.equal(moisLoyersACreer(loyers, [], '2026-02-01')[0].echeance, '2026-02-28')
  })
  test('loyer inactif : rien', () => {
    const loyers = [{ restaurant_id: 'r', montant: 1, jour_echeance: 5, mois_depart: '2026-02-01', actif: false }]
    assert.deepEqual(moisLoyersACreer(loyers, [], '2026-04-01'), [])
  })
})

describe('répartition d\'un paiement sur plusieurs mois', () => {
  const dus = [
    { id: 'oct', mois: '2026-10-01', montant_du: 1000 },
    { id: 'sep', mois: '2026-09-01', montant_du: 1000 },
  ]
  test('du plus ancien au plus récent, chaque mois jusqu\'à son reste', () => {
    assert.deepEqual(repartirPaiement(1500, dus, [{ du_id: 'sep', montant: 200 }]), [
      { du_id: 'sep', montant: 800 },
      { du_id: 'oct', montant: 700 },
    ])
  })
  test('l\'excédent va sur le dernier mois choisi', () => {
    assert.deepEqual(repartirPaiement(2500, dus, []), [
      { du_id: 'sep', montant: 1000 },
      { du_id: 'oct', montant: 1500 },
    ])
  })
  test('montant nul ou négatif : rien', () => {
    assert.deepEqual(repartirPaiement(0, dus, []), [])
  })
})

describe('CNPS', () => {
  test('échéance par défaut : le 15 du mois suivant', () => {
    assert.equal(echeanceCnpsParDefaut('2026-12-01'), '2027-01-15')
  })
  test('jours de retard après l\'échéance, 0 avant', () => {
    assert.equal(joursDeRetard('2026-08-15', '2026-10-21'), 67)
    assert.equal(joursDeRetard('2026-10-15', '2026-10-01'), 0)
    assert.equal(joursDeRetard(null, '2026-10-01'), 0)
  })
})

describe('droits', () => {
  const proprio = [{ user_id: 'zreik', niveau: 'proprietaire' }]
  test('une ligne de droits l\'emporte', () => {
    assert.equal(niveauTresorerie('rh', 'adou', [{ user_id: 'adou', niveau: 'lecture' }]), 'lecture')
  })
  test('manager sans ligne = lecture quand un propriétaire existe', () => {
    assert.equal(niveauTresorerie('manager', 'autre', proprio), 'lecture')
    assert.equal(niveauTresorerie('directeur', 'autre', proprio), 'lecture')
  })
  test('tant qu\'aucun propriétaire n\'est désigné, un manager est propriétaire', () => {
    assert.equal(niveauTresorerie('manager', 'x', []), 'proprietaire')
    assert.equal(niveauTresorerie('manager', 'x', [{ user_id: 'y', niveau: 'lecture' }]), 'proprietaire')
  })
  test('RH sans ligne = saisie_rh ; les autres rôles : aucun accès', () => {
    assert.equal(niveauTresorerie('rh', 'adou', proprio), 'saisie_rh')
    assert.equal(niveauTresorerie('gerant', 'g', proprio), null)
    assert.equal(niveauTresorerie('caissier', 'c', []), null)
  })
  test('ce que chaque niveau peut faire', () => {
    assert.equal(peut('proprietaire', 'payer'), true)
    assert.equal(peut('proprietaire', 'voir_dettes'), true)
    assert.equal(peut('lecture', 'voir_vue'), true)
    assert.equal(peut('lecture', 'voir_dettes'), false)
    assert.equal(peut('lecture', 'payer'), false)
    assert.equal(peut('saisie_rh', 'saisir_salaires'), true)
    assert.equal(peut('saisie_rh', 'voir_vue'), false)
    assert.equal(peut('saisie_rh', 'payer'), false)
    assert.equal(peut(null, 'voir_vue'), false)
    assert.equal(peut('lecture', 'recevoir_partenaires'), true)
    assert.equal(peut('lecture', 'regler_partenaires'), false)
    assert.equal(peut('proprietaire', 'regler_partenaires'), true)
    assert.equal(peut('saisie_rh', 'voir_partenaires'), false)
  })
  test('les catégories', () => {
    assert.deepEqual(CATEGORIES_DU, ['loyer', 'salaire', 'cnps', 'admin', 'dette'])
  })
})
