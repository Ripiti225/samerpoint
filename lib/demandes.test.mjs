// Tests de lib/demandes.js — compteurs, filtres et recherche des demandes.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ETAPES_EXPLICATION, STATUTS_EXPLICATION, compterDemandes, compterExplications, correspond, enRetard,
  explicationsSansReponse, filtrerDemandes, filtrerExplications, fmtDate, seuilRetard,
  decisionProposition, descriptionPour, regrouperPropositions, visiblePourGerant,
} from './demandes.js'

const demandes = [
  { statut: 'en_attente', travailleur_nom: 'Kouamé Assi', type: 'Congé annuel' },
  { statut: 'validee', travailleur_nom: 'Awa Traoré', type: 'Avance sur salaire' },
  { statut: 'validee', travailleur_nom: 'Koffi', type: 'Maladie', description: 'Paludisme' },
  { statut: 'declinee', travailleur_nom: 'Yao', type: 'Autre' },
]

describe('demandes', () => {
  test('compteurs par statut', () => {
    assert.deepEqual(compterDemandes(demandes), { null: 4, en_attente: 1, validee: 2, declinee: 1, annulee: 0 })
  })
  test('filtre statut + recherche (accents ignorés, description incluse)', () => {
    assert.equal(filtrerDemandes(demandes, { statut: 'validee' }).length, 2)
    assert.equal(filtrerDemandes(demandes, { recherche: 'kouame' }).length, 1)
    assert.equal(filtrerDemandes(demandes, { recherche: 'palu' })[0].travailleur_nom, 'Koffi')
    assert.equal(filtrerDemandes(demandes, { statut: 'declinee', recherche: 'awa' }).length, 0)
  })
})

describe('demandes d\'explication', () => {
  const maintenant = Date.parse('2026-10-03T12:00:00Z')
  const exps = [
    { statut: 'en_attente_acceptation', travailleur_nom: 'A', motif: 'Retard répété' },
    { statut: 'acceptee', travailleur_nom: 'B', motif: 'Caisse' },
    { statut: 'envoyee', travailleur_nom: 'C', envoyee_at: '2026-09-25T10:00:00Z', motif: 'x' },
    { statut: 'envoyee', travailleur_nom: 'D', envoyee_at: '2026-10-02T10:00:00Z', motif: 'x' },
    { statut: 'reponse_recuperee', travailleur_nom: 'E', motif: 'x' },
    { statut: 'relancee', travailleur_nom: 'F', motif: 'x' },
  ]

  test('chaque statut appartient à exactement une étape', () => {
    for (const s of Object.keys(STATUTS_EXPLICATION)) {
      assert.equal(ETAPES_EXPLICATION.filter(e => e.statuts?.includes(s)).length, 1, s)
    }
  })
  test('compteurs par étape et retard (> 3 jours après envoi)', () => {
    assert.deepEqual(compterExplications(exps, maintenant), {
      null: 6, retard: 1, a_accepter: 1, a_envoyer: 1, attente: 2, terminees: 2,
    })
  })
  test('retard seulement pour une demande envoyée', () => {
    assert.equal(enRetard(exps[2], maintenant), true)
    assert.equal(enRetard(exps[3], maintenant), false)
    assert.equal(enRetard({ statut: 'reponse_recuperee', envoyee_at: '2026-01-01' }, maintenant), false)
  })
  test('filtre par étape + recherche sur le motif', () => {
    assert.equal(filtrerExplications(exps, { etape: 'terminees' }).length, 2)
    assert.equal(filtrerExplications(exps, { recherche: 'repete' })[0].travailleur_nom, 'A')
    assert.equal(correspond({ travailleur_nom: 'X' }, ''), true)
  })
  test('dates', () => {
    assert.equal(fmtDate('2026-10-03T09:00:00Z'), '3 oct 2026')
    assert.equal(fmtDate(null), '')
  })
})

describe('explications sans réponse (panneau notifications)', () => {
  const maintenant = Date.parse('2026-10-03T12:00:00Z')
  const exps = [
    { id: 'recente', statut: 'envoyee', envoyee_at: '2026-10-01T12:00:00Z' },
    { id: 'j5', statut: 'envoyee', envoyee_at: '2026-09-28T09:00:00Z' },
    { id: 'j9', statut: 'envoyee', envoyee_at: '2026-09-24T09:00:00Z' },
    { id: 'repondue', statut: 'reponse_recuperee', envoyee_at: '2026-09-20T09:00:00Z' },
    { id: 'relancee', statut: 'relancee', envoyee_at: '2026-09-20T09:00:00Z' },
  ]

  test('garde seulement les envoyées dont J+3 est passé, la plus ancienne en tête', () => {
    const r = explicationsSansReponse(exps, maintenant)
    assert.deepEqual(r.map(d => d.id), ['j9', 'j5'])
    assert.deepEqual(r.map(d => d.joursDepuisEnvoi), [9, 5])
  })

  test('liste vide ou absente', () => {
    assert.deepEqual(explicationsSansReponse(null, maintenant), [])
  })

  test('le seuil serveur correspond à enRetard', () => {
    assert.equal(seuilRetard(maintenant), '2026-09-30T12:00:00.000Z')
  })
})

describe('proposition du vérificateur (la direction décide)', () => {
  const desc = r => `Comptage du vérificateur (Paul) le 2026-10-17 : 4/10 produits comptés présentent un écart (40%).\n\n`
    + `Vous êtes concerné en tant que ${r}.\n\nProduits concernés :\n• Coca : réel 10, compté 8 (écart -2)\n\nMerci de justifier ces écarts.`
  const base = { restaurant_id: 'R1', created_at: '2026-10-17T08:00:00.123Z', cree_par_role: 'verificateur', cree_par_nom: 'Paul', statut: 'en_attente_acceptation' }
  const lot = [
    { ...base, id: 'a', travailleur_id: 't1', travailleur_nom: 'Awa', motif: 'Écarts de stock au comptage (40%) — caissier en poste', description: desc('caissier en poste') },
    { ...base, id: 'b', travailleur_id: null, travailleur_nom: 'Koffi', motif: 'Écarts de stock au comptage (40%) — gérant', description: desc('gérant') },
  ]
  const autre = { id: 'c', restaurant_id: 'R1', statut: 'en_attente_acceptation', cree_par_role: 'gerant', travailleur_nom: 'Yao', motif: 'Retard' }

  test('un comptage = une seule proposition, les autres demandes inchangées', () => {
    const r = regrouperPropositions([lot[0], autre, lot[1]])
    assert.equal(r.length, 2)
    assert.equal(r[0].proposition, true)
    assert.deepEqual(r[0].lignes.map(l => l.id), ['a', 'b'])
    assert.equal(r[0].motif, 'Écarts de stock au comptage (40%)')
    assert.deepEqual(r[0].lignes.map(l => l.role), ['caissier en poste', 'gérant'])
    assert.ok(!r[0].description.includes('Vous êtes concerné'))
    assert.ok(r[0].description.includes('Coca'))
    assert.equal(r[1], autre)
  })
  test('deux comptages distincts ne se mélangent pas ; une fois décidée, plus de regroupement', () => {
    const second = { ...lot[0], id: 'd', created_at: '2026-10-17T15:00:00Z' }
    assert.equal(regrouperPropositions([...lot, second]).length, 2)
    const acceptee = { ...lot[0], statut: 'acceptee', accepte_at: 'x' }
    assert.equal(regrouperPropositions([acceptee])[0], acceptee)
  })
  test('compteurs et recherche : la proposition compte pour une', () => {
    const r = regrouperPropositions([...lot, autre])
    assert.equal(compterExplications(r).a_accepter, 2)
    assert.equal(filtrerExplications(r, { recherche: 'koffi' })[0].proposition, true)
  })
  test('le gérant ne voit que ce que la direction a décidé d\'envoyer', () => {
    assert.equal(visiblePourGerant(lot[0]), false)
    assert.equal(visiblePourGerant({ ...lot[0], statut: 'annulee' }), false)
    assert.equal(visiblePourGerant({ ...lot[0], statut: 'refusee' }), false)
    assert.equal(visiblePourGerant({ ...lot[0], statut: 'acceptee', accepte_at: '2026-10-17' }), true)
    assert.equal(visiblePourGerant(autre), true)
  })
  test('décision : cochés acceptés, décochés écartés, ajouts sans doublon', () => {
    const [p] = regrouperPropositions(lot)
    const d = decisionProposition(p, ['a'], [{ id: 't1', nom: 'Awa' }, { id: 't9', nom: 'Moussa' }])
    assert.deepEqual(d.accepter, ['a'])
    assert.deepEqual(d.ecarter, ['b'])
    assert.deepEqual(d.ajouter.map(t => t.nom), ['Moussa'])
    assert.equal(d.nb, 2)
    assert.equal(decisionProposition(p, [], []).nb, 0)
  })
  test('ligne sans personne identifiée : jamais acceptée', () => {
    const vide = { ...lot[0], id: 'z', travailleur_nom: null, motif: 'Écarts de stock au comptage (40%) — à désigner' }
    const [p] = regrouperPropositions([vide])
    const d = decisionProposition(p, ['z'], [{ id: 't9', nom: 'Moussa' }])
    assert.deepEqual(d.accepter, [])
    assert.deepEqual(d.ecarter, ['z'])
  })
  test('description d\'une personne ajoutée par la direction', () => {
    const t = descriptionPour(lot[0].description, 'désigné par la direction')
    assert.ok(t.includes('Vous êtes concerné en tant que désigné par la direction.') === false)
    assert.ok(t.includes('Vous êtes concerné (désigné par la direction).'))
    assert.ok(t.includes('Coca'))
  })
})
