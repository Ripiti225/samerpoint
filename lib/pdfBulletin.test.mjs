// Tests de lib/pdfBulletin.js — lignes du bulletin et génération du PDF sous Node.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { documentBulletins, lignesTableau, nb, tx, dateCourte } from './pdfBulletin.js'
import { assemblerBulletin } from './bulletin.js'
import { PARAMETRES_DEFAUT } from './paie.js'

const fiche = {
  matricule: 'T01', coefficient: 1.5, categorie: '1', numero_cnps: '000000000001', mode_paiement: 'especes',
  salaire_categoriel: 88007, sursalaire: 15000, prime_transport: 30000, prime_tenue: 3031, parts_fiscales: 3, personnes_cmu: 3,
}
const trav = { nom: 'Cuisinier A', poste: 'CUISINIER', date_embauche: '2018-03-01', lieu_residence: 'COCODY', type_contrat: 'CDI' }
const b = assemblerBulletin({
  ligne: { absences_non_justifiees: 0, elements_variables: [], total_avances: 0 },
  fiche, trav, resto: { nom: 'Angré 7E' }, employeur: { raison_sociale: 'CHEZ SAMER', adresse: '21 BP 915 ABIDJAN 21' },
  mois: '2026-11-01', parametres: PARAMETRES_DEFAUT,
})

describe('formats', () => {
  test('nombres, taux, dates', () => {
    assert.equal(nb(134700), '134 700')
    assert.equal(nb(null), '')
    assert.equal(tx(630), '6,30')
    assert.equal(tx(75), '0,75')
    assert.equal(dateCourte('2026-11-30'), '30/11/26')
  })
})

describe('lignesTableau', () => {
  const lignes = lignesTableau(b)
  const parLib = Object.fromEntries(lignes.map(l => [l[1], l]))
  test('gains, cotisations et arrondi dans l\'ordre du bulletin Sage', () => {
    assert.equal(lignes[0][1], 'SALAIRE DE BASE')
    assert.equal(parLib['Total Brut'][5], nb(b.calcul.brut))
    assert.equal(parLib['C.N.P.S'][6], nb(b.calcul.retenues.cnps))
    assert.equal(parLib['RETRAITE GENERALE'][7], '7,70')
    assert.equal(parLib['PRIME DE TRANSPORT'][5], '30 000')
    assert.ok(parLib['ARRONDI'])
  })
  test('pas de ligne ITS quand l\'ITS vaut 0', () => {
    assert.equal(parLib['ITS'], undefined)
  })
})

describe('documentBulletins', () => {
  test('une page par bulletin', () => {
    const doc = documentBulletins(jsPDF, autoTable, [b, b])
    assert.equal(doc.getNumberOfPages(), 2)
    assert.ok(doc.output('arraybuffer').byteLength > 1000)
  })
})
