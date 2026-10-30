// Tests de lib/bulletin.js — en-tête, congés et cumuls de l'année.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { assemblerBulletin, cumulsAnnee, congesBulletin } from './bulletin.js'
import { PARAMETRES_DEFAUT } from './paie.js'

const fiche = {
  matricule: 'T01', coefficient: 1.5, categorie: '1', numero_cnps: '000000000001', mode_paiement: 'especes',
  salaire_categoriel: 75000, sursalaire: 0, prime_transport: 30000, prime_tenue: 3031, parts_fiscales: 2, personnes_cmu: 2,
}
const trav = { nom: 'Serveur D', poste: 'SERVEUR', date_embauche: '2023-03-01', lieu_residence: 'COCODY', type_contrat: 'CDI' }
const ligne = { absences_non_justifiees: 0, elements_variables: [], total_avances: 0 }
const base = { ligne, fiche, trav, resto: { nom: 'Angré 7E' }, employeur: { raison_sociale: 'CHEZ SAMER' }, parametres: PARAMETRES_DEFAUT }

describe('assemblerBulletin', () => {
  test('novembre 2026 sans reprise : cumuls = la période', () => {
    const b = assemblerBulletin({ ...base, mois: '2026-11-01' })
    assert.equal(b.periode.debut, '2026-11-01')
    assert.equal(b.periode.fin, '2026-11-30')
    assert.equal(b.salarie.matricule, 'T01')
    assert.equal(b.salarie.affectation, 'Angré 7E')
    assert.equal(b.calcul.net, 104500)
    assert.deepEqual(b.cumuls.annee, b.cumuls.periode)
    assert.equal(b.cumuls.periode.brut, 107250)
  })

  test('congés payés : les jours saisis comptent en « pris »', () => {
    const l = { ...ligne, elements_variables: [{ code: 310, libelle: 'CONGES PAYES', montant: 10000, jours: 3 }] }
    const b = assemblerBulletin({ ...base, ligne: l, mois: '2026-11-01' })
    assert.equal(b.conges.pris_ce_mois, 3)
    assert.equal(b.calcul.brut, 77250 + 10000)
  })
})

describe('cumulsAnnee', () => {
  const calcul = { salaireBrutCumul: 107250, brut: 77250, chargesSalariales: 5867, chargesPatronales: 14925, heures: 173 }
  test('reprise Sage au 31/10 + novembre validé + décembre', () => {
    const f = { ...fiche, cumuls_reprise_au: '2026-10-31', cumuls_reprise: { brut: 1000000, net_imposable: 700000, charges_salariales: 50000, charges_patronales: 140000, heures: 1730 } }
    const precedents = [{ periode: { debut: '2026-11-01' }, calcul }]
    const c = cumulsAnnee({ calcul, fiche: f, mois: '2026-12-01', precedents })
    assert.equal(c.annee.brut, 1000000 + 107250 * 2)
    assert.equal(c.annee.heures, 1730 + 173 * 2)
  })
  test('janvier 2027 : la reprise 2026 ne compte plus', () => {
    const f = { ...fiche, cumuls_reprise_au: '2026-10-31', cumuls_reprise: { brut: 1000000 } }
    const precedents = [{ periode: { debut: '2026-12-01' }, calcul }]
    const c = cumulsAnnee({ calcul, fiche: f, mois: '2027-01-01', precedents })
    assert.equal(c.annee.brut, 107250)
  })
})

describe('congesBulletin', () => {
  test('sans reprise en novembre : 11 mois depuis janvier ne sont pas connus → 1 mois compté', () => {
    const c = congesBulletin({ fiche, mois: '2026-11-01' })
    assert.deepEqual(c, { acquis: 2.2, pris: 0, pris_ce_mois: 0, reste: 2.2 })
  })
  test('reprise au 31/10 (acquis 22, reste 11) puis novembre et décembre, 3 jours pris en décembre', () => {
    const f = { ...fiche, cumuls_reprise_au: '2026-10-31', conges_acquis_reprise: 22, conges_reste_reprise: 11 }
    const precedents = [{ periode: { debut: '2026-11-01' }, conges: { pris_ce_mois: 0 } }]
    const c = congesBulletin({ fiche: f, mois: '2026-12-01', precedents, joursPrisCeMois: 3 })
    assert.deepEqual(c, { acquis: 26.4, pris: 3, pris_ce_mois: 3, reste: 12.4 })
  })
})
