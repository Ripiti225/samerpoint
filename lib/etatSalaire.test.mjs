// Tests de lib/etatSalaire.js — qui figure dans l'état et combien il reste à payer.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  bornesMois, joursAttendus, joursPointes, ligneEtat, construireEtat, fusionnerSaisies,
  manquesFichePaie, raisonsRefusSoumission, totauxEtat, saisiesVides, cotisationsBulletin,
} from './etatSalaire.js'

const MOIS = '2026-11-01'
const pres = (travailleur_id, date, paye = 0, point_id = `${date}-p`) => ({ travailleur_id, date, paye, statut: 'Présent', point_id })

describe('bornesMois', () => {
  test('novembre et février', () => {
    assert.deepEqual(bornesMois('2026-11-01'), { debut: '2026-11-01', fin: '2026-11-30', nbJours: 30 })
    assert.deepEqual(bornesMois('2028-02'), { debut: '2028-02-01', fin: '2028-02-29', nbJours: 29 })
  })
})

describe('joursAttendus', () => {
  test('tout le mois sans repos : 30 jours', () => {
    assert.equal(joursAttendus({}, MOIS).length, 30)
  })
  test('repos le dimanche (7) : 30 − 5 dimanches = 25', () => {
    assert.equal(joursAttendus({ jourRepos: 7 }, MOIS).length, 25)
  })
  test('embauché le 16, parti le 25', () => {
    const j = joursAttendus({ dateEmbauche: '2026-11-16', finActivite: '2026-11-25' }, MOIS)
    assert.equal(j[0], '2026-11-16')
    assert.equal(j.at(-1), '2026-11-25')
    assert.equal(j.length, 10)
  })
  test('embauché après le mois : aucun jour', () => {
    assert.deepEqual(joursAttendus({ dateEmbauche: '2026-12-02' }, MOIS), [])
  })
})

describe('joursPointes', () => {
  test('deux shifts le même jour = un jour ; statut autre que Présent ignoré', () => {
    const p = [pres('t1', '2026-11-02'), pres('t1', '2026-11-02', 0, 'autre'), { ...pres('t1', '2026-11-03'), statut: 'Absent' }]
    assert.equal(joursPointes(p, 't1').size, 1)
  })
})

describe('ligneEtat', () => {
  const trav = { id: 't1', nom: 'Awa', type_contrat: 'CDI', salaire_journalier: 3000, jour_repos: 7 }
  test('dû, déjà versé, reste', () => {
    const presences = [pres('t1', '2026-11-02', 3000), pres('t1', '2026-11-03', 0), pres('t1', '2026-11-04', 1000)]
    const paiesGerant = [{ travailleur_id: 't1', montant: 2000 }]
    const l = ligneEtat({ trav, presences, paiesGerant, mois: MOIS })
    assert.equal(l.jours_pointes, 3)
    assert.equal(l.du, 9000)
    assert.equal(l.deja_verse, 6000)
    assert.equal(l.reste_a_payer, 3000)
    assert.equal(l.absences_non_justifiees, 25 - 3)
  })
  test('avance et absence justifiée saisies par la RH', () => {
    const saisies = { ...saisiesVides(), avances: [{ montant: 5000, motif: 'Avance du 10' }], absences_justifiees: [{ date: '2026-11-05', motif: 'Maladie' }] }
    const l = ligneEtat({ trav, presences: [pres('t1', '2026-11-02')], paiesGerant: [], mois: MOIS, saisies })
    assert.equal(l.deja_verse, 5000)
    assert.equal(l.reste_a_payer, 0)
    assert.equal(l.trop_verse, 2000)
    assert.equal(l.absences_non_justifiees, 25 - 1 - 1)
  })
  test('fin de contrat le 10 : jours attendus arrêtés au 10', () => {
    const l = ligneEtat({ trav: { ...trav, jour_repos: null }, presences: [], paiesGerant: [], mois: MOIS, finContrat: '2026-11-10' })
    assert.equal(l.jours_attendus, 10)
  })
})

describe('construireEtat', () => {
  const travailleurs = [
    { id: 'c', nom: 'Contrat', type_contrat: 'CDD', salaire_journalier: 3000 },
    { id: 's1', nom: 'Stagiaire payé', type_contrat: 'Stage', salaire_journalier: 2500 },
    { id: 's2', nom: 'Stagiaire pas payé', type_contrat: 'Journalier', salaire_journalier: 2500 },
  ]
  const presences = [pres('s1', '2026-11-02', 2500), pres('s2', '2026-11-02', 0)]

  test('CDD toujours là ; stagiaire seulement s\'il reste un dû', () => {
    const l = construireEtat({ travailleurs, presences, paiesGerant: [], mois: MOIS })
    assert.deepEqual(l.map(x => x.travailleur_id), ['c', 's2'])
  })
  test('recalcul : les saisies RH sont gardées', () => {
    const anciennes = [{ travailleur_id: 'c', avances: [{ montant: 1000, motif: 'x' }], absences_justifiees: [], elements_variables: [{ code: 300, montant: 56250 }] }]
    const l = construireEtat({ travailleurs, presences, paiesGerant: [], mois: MOIS, anciennes })
    const c = l.find(x => x.travailleur_id === 'c')
    assert.equal(c.total_avances, 1000)
    assert.equal(c.elements_variables[0].montant, 56250)
  })
  test('fusionnerSaisies sans ligne : vide', () => {
    assert.deepEqual(fusionnerSaisies(null), saisiesVides())
  })
  test('totaux', () => {
    const t = totauxEtat([{ du: 10, deja_verse: 4, reste_a_payer: 6, bulletin: { calcul: { brut: 100, net: 90, chargesPatronales: 20 } } }, { du: 5, deja_verse: 5, reste_a_payer: 0 }])
    assert.deepEqual(t, { du: 15, deja_verse: 9, reste_a_payer: 6, brut: 100, net: 90, charges_patronales: 20, cnps: 0, its: 0 })
  })
  // Bulletin Sage Al Kayan de juillet 2026 (cas F de lib/paie.test.mjs).
  const calculAK = {
    retenues: { cmu: 2000, cnps: 5455, its: 0 },
    patronal: [
      { code: 415, montant: 2000 }, { code: 470, montant: 6668 }, { code: 480, montant: 3750 }, { code: 481, montant: 563 },
      { code: 490, montant: 2250 }, { code: 500, montant: 1039 }, { code: 520, montant: 346 }, { code: 530, montant: 520 }, { code: 531, montant: 520 },
    ],
  }
  test('CNPS = retraite 14 % + prestations familiales + maternité + accident du travail', () => {
    assert.deepEqual(cotisationsBulletin(calculAK), { cnps: 5455 + 6668 + 3750 + 563 + 2250, its: 1039 + 346 + 520 + 520 })
    assert.deepEqual(cotisationsBulletin({ ...calculAK, retenues: { ...calculAK.retenues, its: 5608 } }).its, 5608 + 2425)
    assert.deepEqual(cotisationsBulletin(null), { cnps: 0, its: 0 })
  })
  test('totaux CNPS et ITS de l\'état', () => {
    const t = totauxEtat([{ bulletin: { calcul: calculAK } }, { bulletin: { calcul: calculAK } }, { bulletin: null }])
    assert.equal(t.cnps, 2 * 18686)
    assert.equal(t.its, 2 * 2425)
  })
})

describe('soumission', () => {
  const fiche = { matricule: 'T02', categorie: '1', salaire_categoriel: 88007, numero_cnps: '000000000002', parts_fiscales: 3, personnes_cmu: 3, mode_paiement: 'especes' }
  test('fiche complète', () => assert.deepEqual(manquesFichePaie(fiche), []))
  test('fiche absente : tout manque', () => assert.equal(manquesFichePaie(null).length, 7))
  test('refus : mois pas fini et n° CNPS manquant', () => {
    const r = raisonsRefusSoumission({
      lignes: [{ travailleur_id: 't', nom: 'Koné', type_contrat: 'CDI' }, { travailleur_id: 's', nom: 'Stagiaire', type_contrat: 'Stage' }],
      fichesParTrav: { t: { ...fiche, numero_cnps: '' } },
      mois: MOIS, aujourdhui: '2026-11-30',
    })
    assert.deepEqual(r, ['Le mois n\'est pas encore terminé.', 'Il manque le n° CNPS de Koné.'])
  })
  test('accepté le 1er décembre avec fiches complètes', () => {
    const r = raisonsRefusSoumission({ lignes: [{ travailleur_id: 't', nom: 'Koné', type_contrat: 'CDI' }], fichesParTrav: { t: fiche }, mois: MOIS, aujourdhui: '2026-12-01' })
    assert.deepEqual(r, [])
  })
})
