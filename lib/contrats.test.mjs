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
  TYPES_CONTRAT, DUREES_MOIS, PALIERS_ALERTE, MOTIFS_RUPTURE,
  calculerDateFin, finEffective, statutContrat, contratEnCours,
  joursRestants, palierAEnvoyer, doitEtreDesactive, validerFormulaireContrat,
  formatFR, ordinalFR, rangParType, contratAffiche, validerCloture, validerDureeLibre,
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

describe('formatFR', () => {
  test('convertit en jour/mois/année', () => {
    assert.equal(formatFR('2026-10-16'), '16/10/2026')
  })
  test('chaîne vide si rien', () => {
    assert.equal(formatFR(null), '')
    assert.equal(formatFR(''), '')
  })
})

describe('ordinalFR', () => {
  test('1 donne 1er', () => {
    assert.equal(ordinalFR(1), '1er')
  })
  test('les autres prennent e', () => {
    assert.equal(ordinalFR(2), '2e')
    assert.equal(ordinalFR(3), '3e')
    assert.equal(ordinalFR(11), '11e')
  })
})

describe('DUREES_MOIS', () => {
  test('propose 1, 2, 3, 6 et 12 mois', () => {
    assert.deepEqual(DUREES_MOIS, [1, 2, 3, 6, 12])
  })
})

describe('MOTIFS_RUPTURE', () => {
  test('les quatre motifs, dans l\'ordre', () => {
    assert.deepEqual(MOTIFS_RUPTURE, ['Démission', 'Renvoi', 'Fin anticipée', 'Autre'])
  })
})

// Un parcours réaliste : 3 stages puis un CDD. C'est le cas décrit par
// l'utilisateur, il sert de fixture à tous les tests de rang et d'affichage.
const S1 = { id: 's1', type: 'Stage', date_debut: '2026-01-16', date_fin: '2026-04-15', cloture_le: null, rappels_envoyes: [] }
const S2 = { id: 's2', type: 'Stage', date_debut: '2026-04-16', date_fin: '2026-08-15', cloture_le: null, rappels_envoyes: [] }
const S3 = { id: 's3', type: 'Stage', date_debut: '2026-08-16', date_fin: '2027-02-15', cloture_le: null, rappels_envoyes: [] }
const D1 = { id: 'd1', type: 'CDD',   date_debut: '2027-02-16', date_fin: '2027-08-15', cloture_le: null, rappels_envoyes: [] }
const PARCOURS = [S1, S2, S3, D1]

describe('rangParType', () => {
  test('les stages se numérotent entre eux', () => {
    assert.equal(rangParType(PARCOURS, S1), 1)
    assert.equal(rangParType(PARCOURS, S2), 2)
    assert.equal(rangParType(PARCOURS, S3), 3)
  })
  test('le passage en CDD repart à 1', () => {
    assert.equal(rangParType(PARCOURS, D1), 1)
  })
  test('l\'ordre de la liste ne change rien, seule la date de début compte', () => {
    assert.equal(rangParType([S3, S1, S2], S2), 2)
  })
  test('0 pour un contrat absent de la liste', () => {
    assert.equal(rangParType(PARCOURS, { id: 'x', type: 'Stage', date_debut: '2025-01-01' }), 0)
  })
  test('0 sans contrat', () => {
    assert.equal(rangParType(PARCOURS, null), 0)
  })
})

describe('contratAffiche', () => {
  test('le contrat en cours prime sur tout', () => {
    assert.equal(contratAffiche(PARCOURS, '2026-09-01')?.id, 's3')
  })
  test('sans contrat, null', () => {
    assert.equal(contratAffiche([], '2026-09-01'), null)
  })
  // La décision explicite de la spec : pendant la période creuse, on montre le
  // contrat fini, pas celui qui n'a pas encore commencé.
  test('contrat fini et suivant pas démarré : on montre le fini', () => {
    const fini = { id: 'f', type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-08-15', cloture_le: null }
    const futur = { id: 'v', type: 'CDD', date_debut: '2026-09-01', date_fin: '2027-03-01', cloture_le: null }
    assert.equal(contratAffiche([fini, futur], '2026-08-20')?.id, 'f')
  })
  test('le plus récemment terminé, pas le plus ancien', () => {
    assert.equal(contratAffiche([S1, S2], '2026-09-01')?.id, 's2')
  })
  test('un contrat rompu compte comme terminé', () => {
    const rompu = { id: 'r', type: 'CDD', date_debut: '2026-01-01', date_fin: '2026-12-31', cloture_le: '2026-06-02' }
    assert.equal(contratAffiche([rompu], '2026-08-20')?.id, 'r')
  })
  test('rien que des contrats à venir : on montre le plus proche', () => {
    const a = { id: 'a', type: 'CDD', date_debut: '2026-09-01', date_fin: '2027-03-01', cloture_le: null }
    const b = { id: 'b', type: 'CDD', date_debut: '2027-04-01', date_fin: '2027-10-01', cloture_le: null }
    assert.equal(contratAffiche([b, a], '2026-08-20')?.id, 'a')
  })
})

describe('validerCloture', () => {
  const CDD_C = { type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-10-16', cloture_le: null }
  test('une date dans les bornes avec motif, accepté', () => {
    assert.equal(validerCloture(CDD_C, '2026-06-02', 'Démission').ok, true)
  })
  test('sans motif, refusé', () => {
    const r = validerCloture(CDD_C, '2026-06-02', '')
    assert.equal(r.ok, false)
    assert.match(r.erreur, /motif/i)
  })
  test('sans date, refusé', () => {
    assert.equal(validerCloture(CDD_C, '', 'Démission').ok, false)
  })
  test('avant le début, refusé et le message cite la date', () => {
    const r = validerCloture(CDD_C, '2026-01-01', 'Démission')
    assert.equal(r.ok, false)
    assert.ok(r.erreur.includes('16/04/2026'))
  })
  test('après la fin, refusé et le message cite les deux bornes', () => {
    const r = validerCloture(CDD_C, '2026-12-01', 'Démission')
    assert.equal(r.ok, false)
    assert.ok(r.erreur.includes('16/04/2026'))
    assert.ok(r.erreur.includes('16/10/2026'))
  })
  test('un contrat déjà rompu, refusé', () => {
    const r = validerCloture({ ...CDD_C, cloture_le: '2026-05-01' }, '2026-06-02', 'Démission')
    assert.equal(r.ok, false)
    assert.match(r.erreur, /déjà rompu/i)
  })
  test('un CDI peut être rompu à n\'importe quelle date après son début', () => {
    const CDI_C = { type: 'CDI', date_debut: '2026-03-01', date_fin: null, cloture_le: null }
    assert.equal(validerCloture(CDI_C, '2030-01-01', 'Démission').ok, true)
  })
})

describe('validerDureeLibre', () => {
  test('4 mois, accepté', () => {
    assert.deepEqual(validerDureeLibre('4'), { ok: true, erreur: null, mois: 4 })
  })
  test('accepte aussi un nombre', () => {
    assert.equal(validerDureeLibre(4).mois, 4)
  })
  test('vide, refusé', () => {
    assert.equal(validerDureeLibre('').ok, false)
  })
  test('du texte, refusé', () => {
    assert.equal(validerDureeLibre('quatre').ok, false)
  })
  test('0 mois, refusé', () => {
    assert.equal(validerDureeLibre('0').ok, false)
  })
  test('61 mois, refusé et le message cite les bornes', () => {
    const r = validerDureeLibre('61')
    assert.equal(r.ok, false)
    assert.ok(r.erreur.includes('1'))
    assert.ok(r.erreur.includes('60'))
  })
  test('60 mois pile, accepté', () => {
    assert.equal(validerDureeLibre('60').ok, true)
  })
})
