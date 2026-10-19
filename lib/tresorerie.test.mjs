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
  syntheseTresorerie, depensesDuMois, moisEntre, moisLoyersACreer,
  planReglageLoyer, planReglageMois, resumeLoyersParRestaurant,
  repartirPaiement, echeanceCnpsParDefaut, joursDeRetard, niveauTresorerie,
  peut, premierDuMois, libelleMois, fournisseursDus,
  echeancePostPayee, jourCommun, chargesFixesACreer, bailsACreer,
  classerDu, classerTous, dusAMettreAJour, categoriesVisibles, CATEGORIES_TRESORERIE, sansChargesAdministratives,
  planSaisieGroupee, planSaisieBaux,
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

describe('accueil : synthèse de la trésorerie', () => {
  const comptes = [
    { id: 'baci', nom: 'BACI', mouvements: [{ montant: 18400000 }] },
    { id: 'sib', nom: 'SIB', mouvements: [{ montant: 0 }] },
    { id: 'esp', nom: 'Espèces', mouvements: [{ montant: 2500000 }, { montant: -350000 }] },
    { id: 'tom', nom: 'Tête de fond OM', mouvements: [{ montant: 400000 }] },
  ]
  test('nette réelle = banque + espèces + têtes de fond − prévisions ; trésorerie = + partenaires', () => {
    assert.deepEqual(syntheseTresorerie({ comptes, partenaires: 7800000, prevu: 6300000 }), {
      banque: 18400000, especes: 2150000, tetes: 400000, partenaires: 7800000, prevu: 6300000,
      tresorerie: 28750000, nette: 14650000,
    })
  })
  test('sans compte Espèces ni prévision', () => {
    const r = syntheseTresorerie({ comptes: comptes.slice(0, 2) })
    assert.equal(r.especes, 0)
    assert.equal(r.nette, 18400000)
  })
})

describe('accueil : dépenses du mois', () => {
  const du = (id, categorie, resto, mois, echeance, extra = {}) => ({ id, categorie, restaurant_id: resto, mois, echeance, montant_du: 1000, ...extra })
  const sept = du('sep', 'loyer', 'lav', '2026-09-01', '2026-10-05')
  const oct = du('oct', 'loyer', 'lav', '2026-10-01', '2026-11-05')
  const sal = du('sal', 'salaire', 'kms', '2026-09-01', '2026-10-10')
  test('pour chaque série, la plus ancienne non payée dont la date limite n\'est pas passée', () => {
    assert.deepEqual(depensesDuMois([oct, sept, sal], [], '2026-10-02').map(d => d.id), ['sep', 'sal'])
  })
  test('après la date limite, la suivante prend sa place', () => {
    assert.deepEqual(depensesDuMois([oct, sept, sal], [], '2026-10-06').map(d => d.id), ['sal', 'oct'])
  })
  test('payée à temps : la suivante apparaît tout de suite', () => {
    assert.deepEqual(depensesDuMois([oct, sept], [{ du_id: 'sep', montant: 1000 }], '2026-10-02').map(d => d.id), ['oct'])
  })
  test('ni autres charges, ni dettes', () => {
    const autres = [{ id: 'a', categorie: 'autre', montant_du: 5 }, { id: 'd', categorie: 'dette', creancier: 'Z', montant_du: 5 }]
    assert.deepEqual(depensesDuMois(autres, [], '2026-10-02'), [])
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

describe('classement : à payer, dette récente, dette', () => {
  const du = (id, mois, echeance, extra = {}) => ({ id, categorie: 'loyer', restaurant_id: 'lav', mois, echeance, montant_du: 1000, ...extra })
  const sept = du('sep', '2026-09-01', '2026-10-05')
  const oct = du('oct', '2026-10-01', '2026-11-05')
  test('jusqu\'au jour de la date limite inclus : à payer', () => {
    assert.equal(classerDu(sept, [sept, oct], {}, '2026-10-05'), 'a_payer')
  })
  test('le lendemain : dette récente', () => {
    assert.equal(classerDu(sept, [sept, oct], {}, '2026-10-06'), 'dette_recente')
  })
  test('quand octobre est en retard à son tour : septembre en dette, octobre en dette récente', () => {
    assert.equal(classerDu(sept, [sept, oct], {}, '2026-11-06'), 'dette')
    assert.equal(classerDu(oct, [sept, oct], {}, '2026-11-06'), 'dette_recente')
  })
  test('octobre payé à temps ne pousse pas septembre', () => {
    assert.equal(classerDu(sept, [sept, oct], { oct: [{ montant: 1000 }] }, '2026-11-06'), 'dette_recente')
  })
  test('une autre série (autre restaurant) ne pousse pas', () => {
    const autre = { ...oct, id: 'x', restaurant_id: 'kms' }
    assert.equal(classerDu(sept, [sept, autre], {}, '2026-11-06'), 'dette_recente')
  })
  test('payé : payé, même en retard', () => {
    assert.equal(classerDu(sept, [sept], { sep: [{ montant: 1000 }] }, '2026-12-01'), 'paye')
  })
  test('un paiement partiel ne sort pas de la dette récente', () => {
    assert.equal(classerDu(sept, [sept], { sep: [{ montant: 400 }] }, '2026-10-20'), 'dette_recente')
  })
  test('autre charge : à payer sans limite, dette seulement à la main', () => {
    const a = { id: 'a', categorie: 'autre', montant_du: 500 }
    assert.equal(classerDu(a, [a], {}, '2027-01-01'), 'a_payer')
    assert.equal(classerDu({ ...a, en_dette_depuis: '2026-10-02' }, [a], {}, '2026-10-02'), 'dette')
  })
  test('prêt en espèces : dette récente, puis dette à la main', () => {
    const p = { id: 'p', categorie: 'dette', creancier: 'Ibrahim', est_pret: true, montant_du: 500000 }
    assert.equal(classerDu(p, [p], {}, '2026-10-02'), 'dette_recente')
    assert.equal(classerDu({ ...p, en_dette_depuis: '2026-10-05' }, [p], {}, '2026-10-05'), 'dette')
  })
  test('créancier : dette', () => {
    const c = { id: 'c', categorie: 'dette', creancier: 'Zabad', montant_du: 6000000 }
    assert.equal(classerDu(c, [c], {}, '2026-10-02'), 'dette')
  })
  test('classerTous', () => {
    assert.deepEqual(classerTous([sept, oct], [], '2026-10-06'), { sep: 'dette_recente', oct: 'a_payer' })
  })
})

describe('saisie groupée d\'un mois', () => {
  const dus = [
    { id: 'a', categorie: 'salaire', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 1700000, echeance: '2026-10-10' },
    { id: 'b', categorie: 'salaire', restaurant_id: 'yop', mois: '2026-09-01', montant_du: 900000, echeance: '2026-10-10' },
    { id: 'c', categorie: 'salaire', restaurant_id: 'lav', mois: '2026-09-01', montant_du: 500000, echeance: '2026-10-10' },
  ]
  test('crée les restaurants sans ligne, corrige ceux qui changent, garde les autres', () => {
    const plan = planSaisieGroupee({
      categorie: 'salaire', mois: '2026-09-01', jour: 10, dus, paiements: [],
      montants: { kms: 1700000, yop: 950000, pal: 2100000, mar: null },
    })
    assert.deepEqual(plan.aCreer, [
      { categorie: 'salaire', restaurant_id: 'pal', mois: '2026-09-01', montant_du: 2100000, echeance: '2026-10-10' },
    ])
    assert.deepEqual(plan.aModifier.map(d => [d.id, d.montant_du]), [['b', 950000]])
    assert.deepEqual(plan.aSupprimer, [])
  })
  test('champ vidé : la ligne disparaît ; ligne déjà payée en partie : jamais touchée', () => {
    const plan = planSaisieGroupee({
      categorie: 'salaire', mois: '2026-09-01', jour: 10, dus, paiements: [{ du_id: 'c', montant: 100 }],
      montants: { yop: null, lav: null },
    })
    assert.deepEqual(plan.aSupprimer.map(d => d.id), ['b'])
    assert.deepEqual(plan.aModifier, [])
  })
  test('impôts (créés tout seuls) : champ vidé = 0 F, sinon la ligne reviendrait', () => {
    const impots = [{ id: 'i', categorie: 'impot', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 80000, echeance: '2026-10-15' }]
    const plan = planSaisieGroupee({ categorie: 'impot', mois: '2026-09-01', jour: 15, dus: impots, paiements: [], montants: { kms: null } })
    assert.deepEqual(plan.aSupprimer, [])
    assert.deepEqual(plan.aModifier.map(d => [d.id, d.montant_du]), [['i', 0]])
  })
})

describe('saisie groupée des baux d\'une année', () => {
  const fixes = [{ categorie: 'bail', restaurant_id: 'kms', montant: 2400000, mois_depart: '2026-10-01', bail_mois: 11, bail_jour: 20, actif: true }]
  test('montant + date par restaurant : réglage et ligne de l\'année', () => {
    const plan = planSaisieBaux({
      an: 2026, moisCourant: '2026-10-01', fixes, dus: [], paiements: [],
      saisies: { kms: { montant: 2400000, jour: 20, mois: 11 }, yop: { montant: 1800000, jour: 15, mois: 3 } },
    })
    assert.deepEqual(plan.reglages, [
      { restaurantId: 'yop', montant: 1800000, bailMois: 3, bailJour: 15, moisDepart: '2026-10-01', actif: true },
    ])
    assert.deepEqual(plan.aCreer, [
      { categorie: 'bail', restaurant_id: 'kms', mois: '2026-11-01', montant_du: 2400000, echeance: '2026-11-20' },
      { categorie: 'bail', restaurant_id: 'yop', mois: '2026-03-01', montant_du: 1800000, echeance: '2026-03-15' },
    ])
  })
  test('nouvelle date pour l\'année : la ligne existante suit', () => {
    const dus = [{ id: 'z', categorie: 'bail', restaurant_id: 'kms', mois: '2026-11-01', montant_du: 2400000, echeance: '2026-11-20' }]
    const plan = planSaisieBaux({
      an: 2026, moisCourant: '2026-10-01', fixes, dus, paiements: [],
      saisies: { kms: { montant: 2500000, jour: 5, mois: 12 } },
    })
    assert.deepEqual(plan.aModifier.map(d => [d.mois, d.montant_du, d.echeance]), [['2026-12-01', 2500000, '2026-12-05']])
    assert.deepEqual(plan.reglages.map(r => [r.montant, r.bailMois, r.bailJour]), [[2500000, 12, 5]])
  })
  test('champ vidé : plus de bail pour ce restaurant (réglage arrêté, ligne non payée retirée)', () => {
    const dus = [{ id: 'z', categorie: 'bail', restaurant_id: 'kms', mois: '2026-11-01', montant_du: 2400000, echeance: '2026-11-20' }]
    const plan = planSaisieBaux({ an: 2026, moisCourant: '2026-10-01', fixes, dus, paiements: [], saisies: { kms: null } })
    assert.deepEqual(plan.aSupprimer.map(d => d.id), ['z'])
    assert.deepEqual(plan.reglages.map(r => r.actif), [false])
  })
  test('le bail d\'une année déjà saisi n\'est pas recréé, même à une autre date', () => {
    const existants = [{ categorie: 'bail', restaurant_id: 'kms', mois: '2026-12-01' }]
    assert.deepEqual(chargesFixesACreer(fixes, [], existants, '2026-10-01'), [])
  })
})

describe('mise à jour des lignes non échues', () => {
  const dus = [
    { id: 'a', categorie: 'its', restaurant_id: 'r', mois: '2026-09-01', echeance: '2026-10-15', montant_du: 100 },
    { id: 'b', categorie: 'its', restaurant_id: 'r', mois: '2026-08-01', echeance: '2026-09-15', montant_du: 100 },
    { id: 'c', categorie: 'its', restaurant_id: 'r', mois: '2026-10-01', echeance: '2026-11-15', montant_du: 100 },
  ]
  test('nouveau jour : lignes non payées dont la date limite n\'est pas passée', () => {
    const r = dusAMettreAJour({ categorie: 'its', jour: 20, dus, paiements: [{ du_id: 'c', montant: 10 }], aujourdhui: '2026-10-02' })
    assert.deepEqual(r.map(d => [d.id, d.echeance]), [['a', '2026-10-20']])
  })
  test('nouveau montant pour un restaurant', () => {
    const r = dusAMettreAJour({ categorie: 'its', restaurantId: 'r', montant: 150, dus, paiements: [], aujourdhui: '2026-10-02' })
    assert.deepEqual(r.map(d => [d.id, d.montant_du]), [['a', 150], ['c', 150]])
  })
  test('nouvelle date de bail : mois et échéance suivent', () => {
    const bail = [{ id: 'z', categorie: 'bail', restaurant_id: 'r', mois: '2026-11-01', echeance: '2026-11-20', montant_du: 9 }]
    const r = dusAMettreAJour({ categorie: 'bail', restaurantId: 'r', bail: { mois: 12, jour: 5 }, dus: bail, paiements: [], aujourdhui: '2026-10-02' })
    assert.deepEqual(r.map(d => [d.mois, d.echeance]), [['2026-12-01', '2026-12-05']])
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
  test('crée les mois manquants, dus au jour réglé du mois suivant (post-payé)', () => {
    const loyers = [{ restaurant_id: 'kms', montant: 1100000, jour_echeance: 5, mois_depart: '2026-08-01', actif: true }]
    const existants = [{ categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01' }]
    assert.deepEqual(moisLoyersACreer(loyers, existants, '2026-10-01'), [
      { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 1100000, echeance: '2026-10-05' },
      { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-10-01', montant_du: 1100000, echeance: '2026-11-05' },
    ])
  })
  test('jour 31 ramené au dernier jour d\'un mois court', () => {
    const loyers = [{ restaurant_id: 'r', montant: 1, jour_echeance: 31, mois_depart: '2026-01-01', actif: true }]
    assert.equal(moisLoyersACreer(loyers, [], '2026-01-01')[0].echeance, '2026-02-28')
  })
  test('loyer inactif : rien', () => {
    const loyers = [{ restaurant_id: 'r', montant: 1, jour_echeance: 5, mois_depart: '2026-02-01', actif: false }]
    assert.deepEqual(moisLoyersACreer(loyers, [], '2026-04-01'), [])
  })
})

describe('échéances post-payées', () => {
  test('la charge de septembre est due au jour limite d\'octobre', () => {
    assert.equal(echeancePostPayee('2026-09-01', 5), '2026-10-05')
  })
  test('un jour 31 devient le dernier jour d\'un mois court', () => {
    assert.equal(echeancePostPayee('2026-01-01', 31), '2026-02-28')
  })
  test('décembre → janvier de l\'année suivante', () => {
    assert.equal(echeancePostPayee('2026-12-01', 10), '2027-01-10')
  })
  test('jour commun : réglage en base, sinon valeur par défaut', () => {
    assert.equal(jourCommun([{ categorie: 'cnps', jour: 20 }], 'cnps'), 20)
    assert.equal(jourCommun([], 'salaire'), 10)
  })
})

describe('création des montants fixes et des baux', () => {
  const fixes = [
    { categorie: 'its', restaurant_id: 'r', montant: 180000, mois_depart: '2026-09-01', actif: true },
    { categorie: 'tee', restaurant_id: 'r', montant: 90000, mois_depart: '2026-10-01', actif: false },
  ]
  test('ITS : un mois par ligne, échéance au jour commun du mois suivant, mois existants écartés', () => {
    const existants = [{ categorie: 'its', restaurant_id: 'r', mois: '2026-09-01' }]
    assert.deepEqual(chargesFixesACreer(fixes, [{ categorie: 'its', jour: 15 }], existants, '2026-10-01'), [
      { categorie: 'its', restaurant_id: 'r', mois: '2026-10-01', montant_du: 180000, echeance: '2026-11-15' },
    ])
  })
  test('bail : créé à partir du 1er du mois qui précède sa date limite', () => {
    const bail = { categorie: 'bail', restaurant_id: 'r', montant: 2400000, mois_depart: '2026-10-01', bail_mois: 11, bail_jour: 20, actif: true }
    assert.deepEqual(bailsACreer(bail, '2026-09-01'), [])
    assert.deepEqual(bailsACreer(bail, '2026-10-01'), [
      { categorie: 'bail', restaurant_id: 'r', mois: '2026-11-01', montant_du: 2400000, echeance: '2026-11-20' },
    ])
  })
  test('bail dont la date de l\'année est déjà passée au réglage : l\'année suivante', () => {
    const bail = { categorie: 'bail', restaurant_id: 'r', montant: 1, mois_depart: '2026-10-01', bail_mois: 3, bail_jour: 15, actif: true }
    assert.deepEqual(bailsACreer(bail, '2027-01-01'), [])
    assert.equal(bailsACreer(bail, '2027-02-01')[0].echeance, '2027-03-15')
  })
  test('bail passé par chargesFixesACreer, sans doublon', () => {
    const bail = { categorie: 'bail', restaurant_id: 'r', montant: 5, mois_depart: '2026-10-01', bail_mois: 11, bail_jour: 20, actif: true }
    assert.equal(chargesFixesACreer([bail], [], [], '2026-10-01').length, 1)
    assert.equal(chargesFixesACreer([bail], [], [{ categorie: 'bail', restaurant_id: 'r', mois: '2026-11-01' }], '2026-10-01').length, 0)
  })
})

describe('réglage d\'un loyer : mois dus cochés', () => {
  const base = { restaurantId: 'kms', montant: 1000, jourEcheance: 5 }
  const proposes = ['2026-08-01', '2026-09-01', '2026-10-01']
  test('crée les mois cochés absents, au montant et au jour réglés', () => {
    const plan = planReglageLoyer({ ...base, moisCoches: ['2026-10-01', '2026-08-01'], moisProposes: proposes })
    assert.deepEqual(plan.aCreer, [
      { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01', montant_du: 1000, echeance: '2026-09-05' },
      { categorie: 'loyer', restaurant_id: 'kms', mois: '2026-10-01', montant_du: 1000, echeance: '2026-11-05' },
    ])
  })
  test('un mois décoché sans paiement disparaît ; entamé, il reste', () => {
    const dusExistants = [
      { id: 'a', categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01', montant_du: 1000, echeance: '2026-08-05' },
      { id: 'b', categorie: 'loyer', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 1000, echeance: '2026-09-05' },
    ]
    const plan = planReglageLoyer({
      ...base, moisCoches: [], moisProposes: proposes, dusExistants, paiements: [{ du_id: 'b', montant: 300 }],
    })
    assert.deepEqual(plan.aSupprimer.map(d => d.id), ['a'])
  })
  test('mois déjà payé avant la trésorerie : créé puis marqué payé (sans banque)', () => {
    const plan = planReglageLoyer({ ...base, moisCoches: [], moisPayes: ['2026-08-01'], moisProposes: proposes })
    assert.deepEqual(plan.aCreer.map(d => d.mois), ['2026-08-01'])
    assert.deepEqual(plan.payesAvant, ['2026-08-01'])
  })
  test('mois dû passé en « déjà payé » : la ligne existante est soldée, pas recréée', () => {
    const dusExistants = [{ id: 'a', categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01', montant_du: 1000, echeance: '2026-09-05' }]
    const plan = planReglageLoyer({ ...base, moisPayes: ['2026-08-01'], moisProposes: proposes, dusExistants })
    assert.deepEqual(plan.aCreer, [])
    assert.deepEqual(plan.payesAvant, ['2026-08-01'])
  })
  test('un mois « déjà payé » décoché disparaît (ses paiements « avant » partent avec)', () => {
    const dusExistants = [{ id: 'a', categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01', montant_du: 1000, echeance: '2026-09-05' }]
    const plan = planReglageLoyer({
      ...base, moisProposes: proposes, dusExistants, paiements: [{ du_id: 'a', montant: 1000, source: 'avant' }],
    })
    assert.deepEqual(plan.aSupprimer.map(d => d.id), ['a'])
  })
  test('un dû hors des mois proposés n\'est jamais supprimé', () => {
    const dusExistants = [{ id: 'vieux', categorie: 'loyer', restaurant_id: 'kms', mois: '2025-01-01', montant_du: 1000 }]
    assert.deepEqual(planReglageLoyer({ ...base, moisProposes: proposes, dusExistants }).aSupprimer, [])
  })
  test('nouveau montant : appliqué aux mois sans paiement, pas aux mois entamés', () => {
    const dusExistants = [
      { id: 'a', categorie: 'loyer', restaurant_id: 'kms', mois: '2026-08-01', montant_du: 800, echeance: '2026-09-05' },
      { id: 'b', categorie: 'loyer', restaurant_id: 'kms', mois: '2026-09-01', montant_du: 800, echeance: '2026-10-05' },
    ]
    const plan = planReglageLoyer({
      ...base, moisCoches: ['2026-08-01', '2026-09-01'], moisProposes: proposes, dusExistants,
      paiements: [{ du_id: 'b', montant: 100 }],
    })
    assert.deepEqual(plan.aModifier.map(d => [d.id, d.montant_du]), [['a', 1000]])
    assert.deepEqual(plan.aCreer, [])
  })
})

describe('TEE, ITS, timbre, CNPS : mois dus par restaurant', () => {
  const proposes = ['2026-07-01', '2026-08-01', '2026-09-01']
  test('montant fixe : chaque mois coché au montant réglé, dû au jour commun du mois suivant', () => {
    const plan = planReglageMois({
      categorie: 'tee', restaurantId: 'yop', montant: 28835, jourEcheance: 15,
      moisCoches: ['2026-08-01'], moisPayes: ['2026-07-01'], moisProposes: proposes,
    })
    assert.deepEqual(plan.aCreer, [
      { categorie: 'tee', restaurant_id: 'yop', mois: '2026-07-01', montant_du: 28835, echeance: '2026-08-15' },
      { categorie: 'tee', restaurant_id: 'yop', mois: '2026-08-01', montant_du: 28835, echeance: '2026-09-15' },
    ])
    assert.deepEqual(plan.payesAvant, ['2026-07-01'])
  })
  test('CNPS : un montant propre à chaque mois', () => {
    const dusExistants = [{ id: 's', categorie: 'cnps', restaurant_id: 'yop', mois: '2026-09-01', montant_du: 200000, echeance: '2026-10-15' }]
    const plan = planReglageMois({
      categorie: 'cnps', restaurantId: 'yop', jourEcheance: 15, montantsParMois: { '2026-08-01': 190000, '2026-09-01': 204225 },
      moisCoches: ['2026-08-01', '2026-09-01'], moisProposes: proposes, dusExistants,
    })
    assert.deepEqual(plan.aCreer.map(d => [d.mois, d.montant_du]), [['2026-08-01', 190000]])
    assert.deepEqual(plan.aModifier.map(d => [d.id, d.montant_du]), [['s', 204225]])
  })
  test('ne touche qu\'à sa catégorie et à son restaurant', () => {
    const dusExistants = [
      { id: 'l', categorie: 'loyer', restaurant_id: 'yop', mois: '2026-08-01', montant_du: 1000 },
      { id: 'k', categorie: 'tee', restaurant_id: 'kms', mois: '2026-08-01', montant_du: 1000 },
    ]
    const plan = planReglageMois({ categorie: 'tee', restaurantId: 'yop', montant: 5, jourEcheance: 15, moisProposes: proposes, dusExistants })
    assert.deepEqual(plan, { aCreer: [], aModifier: [], aSupprimer: [], payesAvant: [], annulerAvant: [] })
  })
  test('le total « doit » se calcule par catégorie', () => {
    const dus = [
      { id: 'a', categorie: 'tee', restaurant_id: 'r', mois: '2026-08-01', montant_du: 100 },
      { id: 'b', categorie: 'loyer', restaurant_id: 'r', mois: '2026-08-01', montant_du: 999 },
    ]
    assert.equal(resumeLoyersParRestaurant(dus, [], '2026-10-01', 'tee').r.reste, 100)
  })
})

describe('loyers : total par restaurant', () => {
  test('ne compte que les mois consommés terminés, liste les mois ouverts du plus ancien au plus récent', () => {
    const dus = [
      { id: 'n', categorie: 'loyer', restaurant_id: 'r', mois: '2026-11-01', montant_du: 1000 },
      { id: 'o', categorie: 'loyer', restaurant_id: 'r', mois: '2026-10-01', montant_du: 1000 },
      { id: 's', categorie: 'loyer', restaurant_id: 'r', mois: '2026-09-01', montant_du: 1000 },
      { id: 'a', categorie: 'loyer', restaurant_id: 'r', mois: '2026-08-01', montant_du: 1000 },
    ]
    const r = resumeLoyersParRestaurant(dus, [{ du_id: 's', montant: 400 }, { du_id: 'a', montant: 1000 }], '2026-10-01').r
    assert.equal(r.reste, 600)
    assert.deepEqual(r.ouverts.map(d => d.id), ['s', 'o', 'n'])
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
    // Coffre et dépenses direction : M. Zreik seul ; résultats : managers aussi.
    assert.equal(peut('lecture', 'voir_resultats'), true)
    assert.equal(peut('lecture', 'voir_coffre'), false)
    assert.equal(peut('lecture', 'voir_direction'), false)
    assert.equal(peut('proprietaire', 'voir_direction'), true)
  })
  test('le RH saisit les sept charges, ne paie pas, ne voit pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('saisie_rh'), ['loyer', 'salaire', 'anciens_travailleurs'])
    assert.equal(peut('saisie_rh', 'saisir_charges'), true)
    assert.equal(peut('proprietaire', 'saisir_charges'), true)
    assert.equal(peut('lecture', 'saisir_charges'), false)
    assert.equal(peut('saisie_rh', 'payer'), false)
  })
  test('lecture : loyers, salaires, anciens travailleurs et la dette récente, pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('lecture'), ['loyer', 'salaire', 'anciens_travailleurs', 'dette_recente'])
    assert.deepEqual(categoriesVisibles('proprietaire').slice(-2), ['dette_recente', 'dette'])
  })
  test('anciens travailleurs : RH et managers saisissent, seule la direction paie', () => {
    for (const niv of ['saisie_rh', 'lecture', 'proprietaire']) assert.equal(peut(niv, 'saisir_anciens'), true)
    assert.equal(peut('lecture', 'payer'), false)
    assert.equal(peut('proprietaire', 'payer'), true)
  })
  test('les catégories', () => {
    assert.deepEqual(CATEGORIES_DU, ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail', 'autre', 'admin', 'dette'])
  })
})

describe('charges passées en fournisseurs administratifs', () => {
  test('seuls loyers et salaires restent', () => {
    assert.deepEqual(CATEGORIES_TRESORERIE, ['loyer', 'salaire'])
  })
  test('sansChargesAdministratives garde loyers, salaires, dettes, autres', () => {
    const dus = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail', 'dette', 'autre'].map(categorie => ({ categorie }))
    assert.deepEqual(sansChargesAdministratives(dus).map(d => d.categorie), ['loyer', 'salaire', 'dette', 'autre'])
  })
})

describe('historiqueDette — dette augmentée par des ajouts', () => {
  test('départ = montant dû − ajouts, ajouts du plus ancien au plus récent', async () => {
    const { historiqueDette } = await import('./tresorerie.js')
    const du = { id: 'ali', montant_du: 5_500_000 }
    const ajouts = [
      { id: 'b', du_id: 'ali', montant: 300_000, date: '2026-10-19', created_at: '2026-10-19T10:00:00Z' },
      { id: 'a', du_id: 'ali', montant: 200_000, date: '2026-10-12', created_at: '2026-10-12T10:00:00Z' },
      { id: 'x', du_id: 'autre', montant: 999_999, date: '2026-10-01' },
    ]
    const h = historiqueDette(du, ajouts)
    assert.equal(h.depart, 5_000_000)
    assert.equal(h.totalAjouts, 500_000)
    assert.equal(h.total, 5_500_000)
    assert.deepEqual(h.ajouts.map(a => a.id), ['a', 'b'])
  })

  test('sans ajout : le départ est le montant dû', async () => {
    const { historiqueDette } = await import('./tresorerie.js')
    const h = historiqueDette({ id: 'd', montant_du: 1_000_000 }, undefined)
    assert.equal(h.depart, 1_000_000)
    assert.equal(h.ajouts.length, 0)
  })
})
