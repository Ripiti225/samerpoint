// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/pdfContrat.js — le PDF remis au travailleur.
//
// jsPDF tourne aussi sous Node : on vérifie qu'un vrai PDF sort, qu'il contient
// le texte du contrat et qu'il tient sur plusieurs pages.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { jsPDF } from 'jspdf'

import { genererPdfContrat, nomFichierContrat } from './pdfContrat.js'

const TANGUY = {
  type: 'CDD', marque: 'alkayan', civilite: 'M.', nom_famille: 'Gbadié', prenoms: 'Gogre Tanguy',
  date_naissance: '1991-03-11', lieu_naissance: 'Yopougon', nationalite: 'Ivoirienne',
  cni_numero: 'CI007879705', nni_numero: '', lieu_residence: 'Yopougon', telephone: '0101354869',
  poste: 'Caissier', categorie: '1', date_debut: '2026-05-01', date_fin: '2026-07-31', duree_mois: 3,
  salaire_categoriel: 75000, prime_tenue: 3031, indemnite_transport: 30000, date_signature: '2026-04-30',
}

const SIGNATURE = { traits: [[[0.1, 0.5], [0.3, 0.2], [0.6, 0.8], [0.9, 0.4]]], ratio: 2.5 }

describe('nomFichierContrat', () => {
  test('sans accents ni espaces', () => {
    assert.equal(nomFichierContrat(TANGUY), 'Contrat_CDD_GBADIE_Gogre_2026-05-01.pdf')
  })
})

describe('genererPdfContrat', () => {
  test('CDD signé : un vrai PDF de plusieurs pages, avec le texte', async () => {
    const r = await genererPdfContrat({ donnees: TANGUY, signature: SIGNATURE, jsPDF, compress: false })
    const brut = Buffer.from(r.base64, 'base64').toString('latin1')
    assert.ok(brut.startsWith('%PDF'))
    assert.ok(r.pages >= 2, `${r.pages} page(s)`)
    assert.ok(brut.includes('CONTRAT DE TRAVAIL A DUREE DETERMINEE'))
    assert.ok(brut.includes('/Subtype /Image'), 'logo et cachet présents')
    assert.equal(r.nomFichier, 'Contrat_CDD_GBADIE_Gogre_2026-05-01.pdf')
  })
  test('stage non signé, Chez Samer', async () => {
    const r = await genererPdfContrat({
      donnees: { ...TANGUY, type: 'Stage', marque: 'samer', prime_journaliere: 3000, date_signature: null },
      jsPDF, compress: false,
    })
    const brut = Buffer.from(r.base64, 'base64').toString('latin1')
    assert.ok(brut.includes('CONTRAT DE STAGE DE QUALIFICATION'))
  })
})
