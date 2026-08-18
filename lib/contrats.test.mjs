// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/contrats.js — les contrats de travail du personnel.
//
// Deux pièges justifient ce fichier. D'abord l'arithmétique des mois : 3 mois
// après le 31 janvier n'existe pas le 31 avril. Ensuite la désactivation
// automatique, qui archive un travailleur : une erreur ici sort quelqu'un des
// effectifs sans que personne l'ait demandé.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  TYPES_CONTRAT, DUREES_MOIS, PALIERS_ALERTE,
  calculerDateFin, finEffective, statutContrat, contratEnCours,
  joursRestants, palierAEnvoyer, doitEtreDesactive, validerFormulaireContrat,
} from './contrats.js'

const CDD = {
  type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-10-16',
  duree_mois: 6, cloture_le: null, rappels_envoyes: [],
}
const CDI = {
  type: 'CDI', date_debut: '2026-01-05', date_fin: null,
  duree_mois: null, cloture_le: null, rappels_envoyes: [],
}

describe('constantes', () => {
  test('les trois types et rien d\'autre', () => {
    assert.deepEqual(TYPES_CONTRAT, ['Stage', 'CDD', 'CDI'])
  })
  test('les durées proposées', () => {
    assert.deepEqual(DUREES_MOIS, [3, 6, 12])
  })
  test('les paliers, du plus lointain au plus proche', () => {
    assert.deepEqual(PALIERS_ALERTE, [15, 7, 3])
  })
})

describe('calculerDateFin', () => {
  test('6 mois après le 16/04/2026', () => {
    assert.equal(calculerDateFin('2026-04-16', 6), '2026-10-16')
  })
  test('12 mois franchissent l\'année', () => {
    assert.equal(calculerDateFin('2026-08-18', 12), '2027-08-18')
  })
  test('3 mois après le 20/11 franchissent l\'année', () => {
    assert.equal(calculerDateFin('2026-11-20', 3), '2027-02-20')
  })
  // Le 31 avril n'existe pas : on retombe sur le dernier jour du mois.
  test('un 31 qui tombe sur un mois de 30 jours est ramené au 30', () => {
    assert.equal(calculerDateFin('2026-01-31', 3), '2026-04-30')
  })
  test('un 30 qui tombe sur février bissextile est ramené au 29', () => {
    assert.equal(calculerDateFin('2027-11-30', 3), '2028-02-29')
  })
  test('sans durée, pas de date', () => {
    assert.equal(calculerDateFin('2026-04-16', null), '')
    assert.equal(calculerDateFin('', 6), '')
  })
})

describe('finEffective', () => {
  test('un CDD non clôturé finit à sa date de fin', () => {
    assert.equal(finEffective(CDD), '2026-10-16')
  })
  test('une clôture anticipée prime sur la date de fin', () => {
    assert.equal(finEffective({ ...CDD, cloture_le: '2026-06-02' }), '2026-06-02')
  })
  test('un CDI n\'a pas de fin', () => {
    assert.equal(finEffective(CDI), null)
  })
})

describe('statutContrat', () => {
  test('en cours pendant la période', () => {
    assert.equal(statutContrat(CDD, '2026-08-18'), 'en_cours')
  })
  test('en cours le jour même de la fin — le dernier jour est travaillé', () => {
    assert.equal(statutContrat(CDD, '2026-10-16'), 'en_cours')
  })
  // Le premier jour d'un contrat est un jour travaillé, au même titre que le
  // dernier. C'est cette symétrie qu'un `<=` casse silencieusement.
  test('en cours le jour même du début', () => {
    assert.equal(statutContrat(CDD, '2026-04-16'), 'en_cours')
  })
  test('expiré le lendemain de la fin', () => {
    assert.equal(statutContrat(CDD, '2026-10-17'), 'expire')
  })
  test('à venir avant le début', () => {
    assert.equal(statutContrat(CDD, '2026-04-15'), 'a_venir')
  })
  test('rompu après une clôture anticipée', () => {
    assert.equal(statutContrat({ ...CDD, cloture_le: '2026-06-02' }, '2026-08-18'), 'rompu')
  })
  test('un CDI reste en cours indéfiniment', () => {
    assert.equal(statutContrat(CDI, '2030-01-01'), 'en_cours')
  })
})

describe('contratEnCours', () => {
  const historique = [
    { type: 'Stage', date_debut: '2026-01-15', date_fin: '2026-04-14', duree_mois: 3, cloture_le: null, rappels_envoyes: [] },
    CDD,
  ]
  test('retourne celui qui couvre la date', () => {
    assert.equal(contratEnCours(historique, '2026-08-18').type, 'CDD')
    assert.equal(contratEnCours(historique, '2026-02-01').type, 'Stage')
  })
  test('rien entre deux contrats', () => {
    assert.equal(contratEnCours(historique, '2026-04-15'), null)
  })
  test('rien sur une liste vide', () => {
    assert.equal(contratEnCours([], '2026-08-18'), null)
  })
})

describe('joursRestants', () => {
  test('compte les jours jusqu\'à la fin', () => {
    assert.equal(joursRestants(CDD, '2026-10-09'), 7)
  })
  test('zéro le dernier jour', () => {
    assert.equal(joursRestants(CDD, '2026-10-16'), 0)
  })
  test('négatif après la fin', () => {
    assert.equal(joursRestants(CDD, '2026-10-20'), -4)
  })
  test('un CDI n\'a pas d\'échéance', () => {
    assert.equal(joursRestants(CDI, '2026-10-09'), null)
  })
})

describe('palierAEnvoyer', () => {
  test('J-15 pile', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-10-01'), 15)
  })
  test('J-7 pile, si J-15 est déjà parti', () => {
    assert.equal(palierAEnvoyer({ ...CDD, rappels_envoyes: [15] }, '2026-10-09'), 7)
  })
  test('rien si le palier est déjà parti', () => {
    assert.equal(palierAEnvoyer({ ...CDD, rappels_envoyes: [15] }, '2026-10-01'), null)
  })
  // Contrat saisi tardivement : on ne rate pas le coche, on envoie le palier
  // applicable le plus haut plutôt que d'attendre bêtement J-3.
  test('contrat saisi à 5 jours de la fin : envoie J-7, pas J-3', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-10-11'), 7)
  })
  test('rien à J-20, c\'est trop tôt', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-09-26'), null)
  })
  test('rien après la date de fin', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-10-17'), null)
  })
  test('rien pour un contrat clôturé', () => {
    assert.equal(palierAEnvoyer({ ...CDD, cloture_le: '2026-06-02' }, '2026-10-09'), null)
  })
  test('rien pour un CDI', () => {
    assert.equal(palierAEnvoyer(CDI, '2026-10-09'), null)
  })
})

describe('doitEtreDesactive', () => {
  test('contrat expiré et rien derrière', () => {
    assert.equal(doitEtreDesactive([CDD], '2026-10-17'), true)
  })
  test('pas le dernier jour du contrat', () => {
    assert.equal(doitEtreDesactive([CDD], '2026-10-16'), false)
  })
  // Sans cette règle, le premier passage du cron archivait 130 personnes.
  test('aucun contrat enregistré : on ne touche à rien', () => {
    assert.equal(doitEtreDesactive([], '2026-10-17'), false)
  })
  test('un CDI ne s\'éteint jamais', () => {
    assert.equal(doitEtreDesactive([CDI], '2030-01-01'), false)
  })
  test('le contrat suivant en continuité protège', () => {
    const suivant = { type: 'CDD', date_debut: '2026-10-17', date_fin: '2027-04-17', duree_mois: 6, cloture_le: null, rappels_envoyes: [] }
    assert.equal(doitEtreDesactive([CDD, suivant], '2026-10-17'), false)
  })
  // Le RH a signalé la continuité : l'app n'a pas à archiver puis à lui faire
  // cliquer « Réactiver » trois jours plus tard.
  test('un contrat futur avec trois jours de battement protège aussi', () => {
    const suivant = { type: 'CDD', date_debut: '2026-10-20', date_fin: '2027-04-20', duree_mois: 6, cloture_le: null, rappels_envoyes: [] }
    assert.equal(doitEtreDesactive([CDD, suivant], '2026-10-17'), false)
  })
  test('un contrat rompu et rien derrière : désactivation', () => {
    assert.equal(doitEtreDesactive([{ ...CDD, cloture_le: '2026-06-02' }], '2026-06-03'), true)
  })
})

describe('validerFormulaireContrat', () => {
  const base = { type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-10-16', duree_mois: 6, photo_url: 'https://x/c.jpg' }

  test('un formulaire complet passe', () => {
    assert.deepEqual(validerFormulaireContrat(base), { ok: true, erreur: null })
  })
  test('sans photo, refusé', () => {
    const r = validerFormulaireContrat({ ...base, photo_url: null })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /photo du contrat/i)
  })
  test('sans type, refusé', () => {
    assert.equal(validerFormulaireContrat({ ...base, type: null }).ok, false)
  })
  test('sans date de début, refusé', () => {
    assert.equal(validerFormulaireContrat({ ...base, date_debut: '' }).ok, false)
  })
  test('un CDD sans date de fin, refusé', () => {
    const r = validerFormulaireContrat({ ...base, date_fin: '', duree_mois: null })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /date de fin/i)
  })
  test('un CDI n\'a besoin ni de fin ni de durée', () => {
    const r = validerFormulaireContrat({ type: 'CDI', date_debut: '2026-04-16', date_fin: '', duree_mois: null, photo_url: 'https://x/c.jpg' })
    assert.deepEqual(r, { ok: true, erreur: null })
  })
  test('un CDI avec une date de fin, refusé', () => {
    const r = validerFormulaireContrat({ type: 'CDI', date_debut: '2026-04-16', date_fin: '2026-10-16', duree_mois: null, photo_url: 'https://x/c.jpg' })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /CDI/i)
  })
  test('une fin avant le début, refusé', () => {
    const r = validerFormulaireContrat({ ...base, date_fin: '2026-01-01' })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /après/i)
  })
})
