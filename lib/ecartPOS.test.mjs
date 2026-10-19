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

import {
  SOURCE_DECISION_POS,
  decisionEcartShiftPOS,
  ecartJourPOS,
  ecartsParCaissier,
  responsablesEcartPOS,
  fusionnerResponsablesEcart,
} from './ecartPOS.js'

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

  test('conserve séparément les explications de plusieurs caissiers', () => {
    const { lignes } = ecartsParCaissier([
      { caissier_nom: 'Flora', ecart_pos: -2500, explication_ecart: 'Fond incomplet', pos_service_id: 'a' },
      { caissier_nom: 'Hilary', ecart_pos: 1500, explication_ecart: null, pos_service_id: 'b' },
    ])
    assert.deepEqual(lignes, [
      { nom: 'Flora', ecart: -2500, explication: 'Fond incomplet' },
      { nom: 'Hilary', ecart: 1500 },
    ])
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

// ──────────────────────────────────────────────────────────────────────────────
// responsablesEcartPOS — la caisse désigne déjà sa responsable.
//
// Ces lignes remplacent une saisie du gérant qui portait sur de l'argent réel.
// Une erreur de signe accuse quelqu'un d'un manquant quand il y avait un
// surplus ; un doublon lui facture deux fois la même journée.
// ──────────────────────────────────────────────────────────────────────────────
describe('responsablesEcartPOS — imputation déduite des shifts', () => {
  const shift = (o) => ({
    id: 's1', point_id: 'p1', restaurant_id: 'r1', date: '2026-08-24',
    caissier_id: 'c1', caissier_nom: 'Michael', ...o,
  })

  test('écart négatif = manquant, montant toujours positif', () => {
    const [l] = responsablesEcartPOS([shift({ ecart_pos: -28300 })])
    assert.equal(l.type, 'manquant')
    assert.equal(l.montant, 28300)
    assert.equal(l.responsable_nom, 'Michael')
    assert.equal(l.role, 'caissier')
    assert.equal(l.source, 'POS')
  })

  test('écart positif = surplus, jamais un manquant', () => {
    const [l] = responsablesEcartPOS([shift({ ecart_pos: 1000 })])
    assert.equal(l.type, 'surplus')
    assert.equal(l.montant, 1000)
  })

  test('écart mesuré à zéro : personne n\'est responsable de rien', () => {
    assert.deepEqual(responsablesEcartPOS([shift({ ecart_pos: 0 })]), [])
  })

  test('shift sans mesure : jamais compté pour 0', () => {
    assert.deepEqual(responsablesEcartPOS([shift({ ecart_pos: null })]), [])
    assert.deepEqual(responsablesEcartPOS([shift({})]), [])
    assert.deepEqual(responsablesEcartPOS([shift({ ecart_pos: '' })]), [])
    assert.deepEqual(responsablesEcartPOS([shift({ ecart_pos: 'nawak' })]), [])
  })

  test('caissière sans nom : un montant ne disparaît jamais faute de nom', () => {
    const [l] = responsablesEcartPOS([shift({ caissier_nom: '  ', ecart_pos: -500 })])
    assert.equal(l.responsable_nom, 'Caissier non identifié')
    assert.equal(l.montant, 500)
  })

  test('l\'explication du POS suit la ligne', () => {
    const [l] = responsablesEcartPOS([shift({ ecart_pos: -500, explication_ecart: '  rendu monnaie  ' })])
    assert.equal(l.explication, 'rendu monnaie')
    const [sans] = responsablesEcartPOS([shift({ ecart_pos: -500, explication_ecart: '   ' })])
    assert.equal(sans.explication, null)
  })

  test('une ligne par shift, avec un id stable pour l\'affichage', () => {
    const lignes = responsablesEcartPOS([
      shift({ id: 'a', caissier_nom: 'Flora', ecart_pos: -7500 }),
      shift({ id: 'b', caissier_nom: 'Marie-Paule', ecart_pos: 0 }),
      shift({ id: 'c', caissier_nom: 'Hilary', ecart_pos: 1200 }),
    ])
    assert.equal(lignes.length, 2)
    assert.deepEqual(lignes.map(l => l.id), ['pos:a', 'pos:c'])
  })

  test('journée vide : rien à imputer', () => {
    assert.deepEqual(responsablesEcartPOS([]), [])
    assert.deepEqual(responsablesEcartPOS(null), [])
  })

  test('une justification soldée retire uniquement le shift concerné', () => {
    const shifts = [
      shift({ id: 's1', caissier_nom: 'Michael', ecart_pos: -4000 }),
      shift({ id: 's2', caissier_nom: 'Flora', ecart_pos: -1500 }),
    ]
    const regularisations = [{
      source: SOURCE_DECISION_POS,
      shift_id: 's1',
      point_id: 'p1',
      decision: 'justifiee',
      montant: 4000,
    }]

    const lignes = responsablesEcartPOS(shifts, regularisations)
    assert.deepEqual(lignes.map(l => [l.id, l.montant]), [['pos:s2', 1500]])
  })

  test('une régularisation partielle laisse seulement le montant restant', () => {
    const regularisations = [{
      source: SOURCE_DECISION_POS,
      shift_id: 's1',
      point_id: 'p1',
      decision: 'annulee',
      montant: 1500,
    }]

    const [ligne] = responsablesEcartPOS([shift({ ecart_pos: -4000 })], regularisations)
    assert.equal(ligne.montant, 2500)
  })

  test('un refus conserve le montant intégral dans les litiges', () => {
    const regularisations = [{
      source: SOURCE_DECISION_POS,
      shift_id: 's1',
      point_id: 'p1',
      decision: 'refusee',
      montant: 0,
    }]

    const [ligne] = responsablesEcartPOS([shift({ ecart_pos: -4000 })], regularisations)
    assert.equal(ligne.montant, 4000)
  })
})

describe('decisionEcartShiftPOS — décision indépendante par rapport Z', () => {
  const shift = { id: 's1', point_id: 'p1', pos_service_id: 'pos-1', ecart_pos: -4000 }

  test('ignore les décisions des autres shifts du même point', () => {
    const decision = decisionEcartShiftPOS(shift, [{
      source: SOURCE_DECISION_POS,
      shift_id: 's2',
      point_id: 'p1',
      decision: 'justifiee',
      montant: 4000,
    }])

    assert.equal(decision.statut, null)
    assert.equal(decision.restant, 4000)
    assert.deepEqual(decision.regularisations, [])
  })

  test('retrouve aussi une décision par identifiant de service POS', () => {
    const decision = decisionEcartShiftPOS(shift, [{
      source: SOURCE_DECISION_POS,
      pos_service_id: 'pos-1',
      point_id: 'p1',
      decision: 'annulee',
      montant: 4000,
    }])

    assert.equal(decision.statut, 'annulee')
    assert.equal(decision.restant, 0)
    assert.equal(decision.solde, true)
  })

  test('les anciennes régularisations journalières ne modifient pas un shift POS', () => {
    const decision = decisionEcartShiftPOS(shift, [{
      source: 'verification',
      point_id: 'p1',
      montant: 4000,
    }])

    assert.equal(decision.restant, 4000)
    assert.equal(decision.statut, null)
  })

  const d = (decision, montant) => ({ source: SOURCE_DECISION_POS, shift_id: 's1', point_id: 'p1', decision, montant })

  test('sans décision : tout reste à traiter', () => {
    const decision = decisionEcartShiftPOS(shift, [])
    assert.equal(decision.aTraiter, true)
    assert.deepEqual([decision.annule, decision.justifie], [0, 0])
  })

  test('une partie annulée : le reste se traite encore (justifier, annuler, refuser)', () => {
    const decision = decisionEcartShiftPOS(shift, [d('annulee', 1500)])
    assert.equal(decision.restant, 2500)
    assert.equal(decision.aTraiter, true)
    assert.equal(decision.annule, 1500)
  })

  test('annulé + justifié : les deux montants sont gardés, le reste se traite encore', () => {
    const decision = decisionEcartShiftPOS(shift, [d('annulee', 1500), d('justifiee', 1000)])
    assert.deepEqual([decision.annule, decision.justifie, decision.restant], [1500, 1000, 1500])
    assert.equal(decision.aTraiter, true)
  })

  test('reste refusé : il demeure dû, plus rien à décider', () => {
    const decision = decisionEcartShiftPOS(shift, [d('annulee', 1500), d('refusee', 0)])
    assert.equal(decision.restant, 2500)
    assert.equal(decision.refuse, true)
    assert.equal(decision.aTraiter, false)
  })

  test('tout soldé : plus rien à décider', () => {
    const decision = decisionEcartShiftPOS(shift, [d('annulee', 1500), d('justifiee', 2500)])
    assert.equal(decision.solde, true)
    assert.equal(decision.aTraiter, false)
  })
})

describe('fusionnerResponsablesEcart — la main du gérant gagne', () => {
  const manuel = { id: 'm1', point_id: 'p1', restaurant_id: 'r1', date: '2026-08-20', responsable_nom: 'Flora', montant: 5000, type: 'manquant' }
  const posP1 = { id: 'pos:s1', point_id: 'p1', restaurant_id: 'r1', date: '2026-08-20', responsable_nom: 'Flora', montant: 5000, type: 'manquant', source: 'POS' }
  const posP2 = { id: 'pos:s2', point_id: 'p2', restaurant_id: 'r1', date: '2026-08-24', responsable_nom: 'Michael', montant: 28300, type: 'manquant', source: 'POS' }

  test('journée déjà imputée à la main : le POS ne la double pas', () => {
    const r = fusionnerResponsablesEcart([manuel], [posP1, posP2])
    assert.equal(r.length, 2)
    assert.equal(r.reduce((s, x) => s + x.montant, 0), 33300)
    assert.ok(r.some(x => x.id === 'm1'))
    assert.ok(r.some(x => x.id === 'pos:s2'))
    assert.ok(!r.some(x => x.id === 'pos:s1'))
  })

  test('vieille ligne sans point_id : appariée sur restaurant + date', () => {
    const vieille = { ...manuel, point_id: null }
    const r = fusionnerResponsablesEcart([vieille], [posP1])
    assert.equal(r.length, 1)
    assert.equal(r[0].id, 'm1')
  })

  test('aucune imputation manuelle : la mesure du POS passe entière', () => {
    const r = fusionnerResponsablesEcart([], [posP1, posP2])
    assert.equal(r.length, 2)
  })

  test('site sans POS : la liste manuelle ressort intacte', () => {
    const r = fusionnerResponsablesEcart([manuel], [])
    assert.deepEqual(r, [manuel])
  })

  test('tri par date décroissante, toutes sources confondues', () => {
    const r = fusionnerResponsablesEcart([manuel], [posP2])
    assert.deepEqual(r.map(x => x.date), ['2026-08-24', '2026-08-20'])
  })

  test('deux listes vides : pas de plantage', () => {
    assert.deepEqual(fusionnerResponsablesEcart(null, null), [])
  })
})

describe('écart d’une journée POS dans Litiges (après les décisions de Vérification)', () => {
  const sh = (id, ecart_pos, extra = {}) => ({ id, point_id: 'p1', pos_service_id: `svc-${id}`, ecart_pos, ...extra })
  const decision = (shift_id, montant, decision = 'annulee') =>
    ({ source: SOURCE_DECISION_POS, point_id: 'p1', shift_id, montant, decision })

  test('somme des manquants restants, shift par shift', () => {
    assert.equal(ecartJourPOS([sh('a', -5000), sh('b', -3000)], []), 8000)
  })

  test('un manquant annulé ou justifié dans Vérification ne compte plus', () => {
    assert.equal(ecartJourPOS([sh('a', -5000), sh('b', -3000)], [decision('a', 5000)]), 3000)
    assert.equal(ecartJourPOS([sh('a', -5000)], [decision('a', 5000, 'justifiee')]), 0)
  })

  test('une décision refusée laisse l’écart entier', () => {
    assert.equal(ecartJourPOS([sh('a', -5000)], [decision('a', 5000, 'refusee')]), 5000)
  })

  test('annulation partielle : seul le reste compte', () => {
    assert.equal(ecartJourPOS([sh('a', -10000)], [decision('a', 8000)]), 2000)
  })

  test('un surplus n’est pas un litige et n’efface pas le manquant d’un autre shift', () => {
    assert.equal(ecartJourPOS([sh('a', -4000), sh('b', 6000)], []), 4000)
  })

  test('journée sans mesure POS (ou mesure incomplète) : null, l’ancien calcul s’applique', () => {
    assert.equal(ecartJourPOS([{ id: 'a', point_id: 'p1', ecart_pos: null }], []), null)
    assert.equal(ecartJourPOS([sh('a', -4000), { id: 'b', point_id: 'p1', ecart_pos: null }], []), null)
    assert.equal(ecartJourPOS([], []), null)
  })
})
