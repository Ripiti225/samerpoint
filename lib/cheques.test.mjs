// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/cheques.js — chèques émis sur BACI et SIB.
//
// Ce qui justifie ce fichier : un chèque émis pas encore débité doit sortir
// de la trésorerie nette réelle UNE fois — ni zéro (on croit avoir l'argent),
// ni deux (relié à une dette, sa prévision le compte déjà).
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  chequeDePrevision, chequeDuPaiement, chequesHorsPrevisions, elementsCheques, lendemain, montantEnCirculation,
  statutCheque, totalChequesHorsPrevisions, trierCheques,
} from './cheques.js'
import { elementsDuJour, messagePour } from './rappelsTresorerie.js'

const AUJ = '2026-10-19'
const ch = (id, extra = {}) => ({
  id, compte_id: 'baci', numero: id, banque: 'BACI', ordre: 'Ali sable', montant: 1_000_000,
  date_emission: '2026-10-10', date_encaissement: '2026-10-30', statut: 'emis', ...extra,
})

describe('statutCheque', () => {
  test('retard, aujourd\'hui, demain, plus tard, encaissé, annulé', () => {
    assert.equal(statutCheque(ch('a', { date_encaissement: '2026-10-18' }), AUJ).cle, 'en_retard')
    assert.equal(statutCheque(ch('a', { date_encaissement: AUJ }), AUJ).cle, 'aujourdhui')
    assert.equal(statutCheque(ch('a', { date_encaissement: '2026-10-20' }), AUJ).cle, 'demain')
    assert.equal(statutCheque(ch('a'), AUJ).cle, 'emis')
    assert.equal(statutCheque(ch('a', { statut: 'encaisse', encaisse_le: '2026-10-18' }), AUJ).cle, 'encaisse')
    assert.equal(statutCheque(ch('a', { statut: 'annule', motif_annulation: 'perdu' }), AUJ).cle, 'annule')
  })

  test('lendemain passe le mois et l\'année', () => {
    assert.equal(lendemain('2026-10-31'), '2026-11-01')
    assert.equal(lendemain('2026-12-31'), '2027-01-01')
  })
})

describe('montants en circulation', () => {
  const cheques = [
    ch('libre'),
    ch('relie', { prevision_id: 'p1', montant: 2_000_000 }),
    ch('prevision-retiree', { prevision_id: 'p-disparue', montant: 300_000 }),
    ch('encaisse', { statut: 'encaisse', montant: 9_000_000 }),
    ch('annule', { statut: 'annule', montant: 9_000_000 }),
    ch('sib', { compte_id: 'sib', montant: 500_000 }),
  ]
  const previsions = [{ id: 'p1' }]

  test('seuls les chèques émis comptent, par compte ou en tout', () => {
    assert.equal(montantEnCirculation(cheques), 3_800_000)
    assert.equal(montantEnCirculation(cheques, 'sib'), 500_000)
  })

  test('un chèque relié n\'est pas compté une deuxième fois', () => {
    assert.deepEqual(chequesHorsPrevisions(cheques, previsions).map(c => c.id), ['libre', 'prevision-retiree', 'sib'])
    assert.equal(totalChequesHorsPrevisions(cheques, previsions), 1_800_000)
  })

  test('retrouve le chèque d\'une prévision et d\'un versement', () => {
    assert.equal(chequeDePrevision(cheques, 'p1')?.id, 'relie')
    assert.equal(chequeDePrevision(cheques, null), null)
    assert.equal(chequeDuPaiement([ch('x', { paiement_groupe: 'g1' })], 'g1')?.id, 'x')
    assert.equal(chequeDuPaiement(cheques, undefined), null)
  })
})

test('trierCheques : urgents d\'abord, puis par date ; encaissés à la fin', () => {
  const t = trierCheques([
    ch('plus-tard', { date_encaissement: '2026-11-05' }),
    ch('encaisse', { statut: 'encaisse', encaisse_le: '2026-10-01' }),
    ch('retard', { date_encaissement: '2026-10-15' }),
    ch('demain', { date_encaissement: '2026-10-20' }),
    ch('bientot', { date_encaissement: '2026-10-25' }),
  ], AUJ)
  assert.deepEqual(t.map(x => x.cheque.id), ['retard', 'demain', 'bientot', 'plus-tard', 'encaisse'])
})

describe('rappels des chèques', () => {
  const cheques = [
    ch('demain', { date_encaissement: '2026-10-20' }),
    ch('jour', { date_encaissement: AUJ }),
    ch('retard', { date_encaissement: '2026-10-17' }),
    ch('loin'),
    ch('fait', { statut: 'encaisse', date_encaissement: AUJ }),
  ]

  test('9 h : veille, jour même, retard', () => {
    const e = elementsCheques({ moment: 'matin', aujourdhui: AUJ, cheques })
    assert.equal(e.length, 3)
    assert.match(e[0].texte, /Chèque n° retard BACI : 1\s000\s000 F à Ali sable, prévu le/)
    assert.match(e[1].texte, /encaissement aujourd'hui$/)
    assert.match(e[2].texte, /encaissement demain$/)
  })

  test('14 h : relance du jour et des retards seulement', () => {
    const e = elementsCheques({ moment: 'apres_midi', aujourdhui: AUJ, cheques })
    assert.equal(e.length, 2)
  })

  test('la prévision d\'un chèque n\'est pas rappelée en double ; la lecture voit les chèques, pas le RH', () => {
    const du = { id: 'd1', categorie: 'dette', creancier: 'Ali sable', montant_du: 5_000_000 }
    const previsions = [{ id: 'p1', du_id: 'd1', montant: 1_000_000, date_prevue: AUJ, created_at: '2026-10-10' }]
    const el = elementsDuJour({
      moment: 'matin', aujourdhui: AUJ, dus: [du], previsions,
      cheques: [ch('c1', { prevision_id: 'p1', date_encaissement: AUJ })],
    })
    assert.deepEqual(el.map(x => x.type), ['cheque'])
    assert.ok(messagePour('lecture', el, 'matin'))
    assert.equal(messagePour('saisie_rh', el, 'matin'), null)
  })
})
