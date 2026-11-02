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

describe('suggestionsOrdre — noms déjà écrits', async () => {
  const { suggestionsOrdre } = await import('./cheques.js')
  const cheques = [
    ch('1', { ordre: 'M. Adou', created_at: '2026-10-10' }),
    ch('2', { ordre: 'M. Adou', created_at: '2026-10-12' }),
    ch('3', { ordre: 'M. Koné', created_at: '2026-10-15' }),
    ch('4', { ordre: 'Ali sable', created_at: '2026-10-01' }),
  ]
  const dus = [{ categorie: 'dette', creancier: 'Marcel électricien' }, { categorie: 'loyer', creancier: 'X' }]

  test('« M. » propose les noms en M., le plus utilisé d\'abord', () => {
    assert.deepEqual(suggestionsOrdre('M.', { cheques, dus }), ['M. Adou', 'M. Koné', 'Marcel électricien'])
  })

  test('sans majuscules, accents ni points, et sur un mot du nom', () => {
    assert.deepEqual(suggestionsOrdre('m adou', { cheques }), [])         // déjà écrit en entier : rien à proposer
    assert.deepEqual(suggestionsOrdre('m ado', { cheques }), ['M. Adou'])
    assert.deepEqual(suggestionsOrdre('kon', { cheques }), ['M. Koné'])
    assert.deepEqual(suggestionsOrdre('electr', { cheques, dus }), ['Marcel électricien'])
  })

  test('rien tapé : rien proposé ; un même nom n\'apparaît qu\'une fois', () => {
    assert.deepEqual(suggestionsOrdre('', { cheques }), [])
    assert.deepEqual(suggestionsOrdre('m', { cheques: [...cheques, ch('5', { ordre: 'm. adou' })] }).filter(n => /adou/i.test(n)).length, 1)
  })
})

test('le chèque reste visible dans la notification, même avec beaucoup d\'autres rappels', () => {
  const dus = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, categorie: 'dette', creancier: `Créancier ${i}`, montant_du: 100_000 }))
  const previsions = dus.map((d, i) => ({ id: `p${i}`, du_id: d.id, montant: 100_000, date_prevue: '2026-10-01', created_at: '2026-09-30' }))
  const el = elementsDuJour({
    moment: 'matin', aujourdhui: AUJ, dus, previsions,
    cheques: [ch('77', { ordre: 'Willy', montant: 1, date_encaissement: AUJ })],
  })
  const msg = messagePour('proprietaire', el, 'matin')
  assert.match(msg.corps.split('\n')[0], /^Chèque n° 77 BACI : 1 F à Willy, encaissement aujourd'hui$/)
  assert.match(msg.titre, /9 à faire/)
})

// ── Plusieurs lignes par chèque (supabase_tresorerie_cheques_lignes.sql) ──
describe('chèque à plusieurs lignes', async () => {
  const { attacherLignes, lignesDuCheque, montantHorsPrevisions, lignesPayables, titreLignePayable } = await import('./cheques.js')
  const lignes = [
    { cheque_id: 'm', du_id: 'loyer-fev', montant: 1_500_000, prevision_id: 'pf' },
    { cheque_id: 'm', du_id: 'loyer-mars', montant: 1_000_000, prevision_id: 'pm' },
    { cheque_id: 'm', fournisseur_id: 'cnps', montant: 250_000, prevision_id: null },
  ]
  const multi = attacherLignes([ch('m', { montant: 2_750_000 }), ch('seul', { du_id: 'd', prevision_id: 'ps' })], lignes)

  test('les lignes sont rattachées ; un ancien chèque garde sa ligne unique', () => {
    assert.equal(lignesDuCheque(multi[0]).length, 3)
    assert.deepEqual(lignesDuCheque(multi[1]), [{ du_id: 'd', fournisseur_id: null, montant: 1_000_000, prevision_id: 'ps' }])
    assert.deepEqual(lignesDuCheque(ch('libre')), [])
  })

  test('seule la part sans prévision vivante compte à part', () => {
    const prev = [{ id: 'pf' }, { id: 'pm' }, { id: 'ps' }]
    assert.equal(montantHorsPrevisions(multi[0], prev), 250_000)
    assert.equal(montantHorsPrevisions(multi[0], [{ id: 'pf' }]), 1_250_000)
    assert.equal(montantHorsPrevisions(multi[1], prev), 0)
    assert.equal(montantHorsPrevisions(ch('libre'), prev), 1_000_000)
    assert.deepEqual(chequesHorsPrevisions(multi, prev).map(c => c.id), ['m'])
    assert.equal(totalChequesHorsPrevisions(multi, prev), 250_000)
  })

  test('la prévision d\'une des lignes renvoie au chèque', () => {
    assert.equal(chequeDePrevision(multi, 'pm')?.id, 'm')
  })

  test('les rappels ne répètent pas la prévision d\'une ligne de chèque', () => {
    const du = { id: 'loyer-mars', categorie: 'loyer', restaurant_id: 'r', mois: '2026-03-01', montant_du: 1_500_000 }
    const previsions = [{ id: 'pm', du_id: 'loyer-mars', montant: 1_000_000, date_prevue: AUJ, created_at: '2026-10-10' }]
    const cheques = attacherLignes([ch('m', { date_encaissement: AUJ })], [{ cheque_id: 'm', du_id: 'loyer-mars', montant: 1_000_000, prevision_id: 'pm' }])
    const el = elementsDuJour({ moment: 'matin', aujourdhui: AUJ, dus: [du], previsions, cheques })
    assert.deepEqual(el.map(x => x.type), ['cheque'])
  })

  test('ce qu\'un chèque peut payer : lignes d\'À payer et administratifs avec un reste, les plus anciennes d\'abord', () => {
    const dus = [
      { id: 'l-mars', categorie: 'loyer', restaurant_id: 'r1', mois: '2026-03-01', montant_du: 1_500_000 },
      { id: 'l-fev', categorie: 'loyer', restaurant_id: 'r1', mois: '2026-02-01', montant_du: 1_500_000 },
      { id: 'l-paye', categorie: 'loyer', restaurant_id: 'r1', mois: '2026-01-01', montant_du: 1_500_000 },
      { id: 'dette', categorie: 'dette', creancier: 'Ali', montant_du: 400_000 },
    ]
    const paiements = [{ du_id: 'l-paye', montant: 1_500_000 }, { du_id: 'l-mars', montant: 500_000 }]
    const fournisseurs = [
      { id: 'cnps', nom: 'CNPS', type: 'administratif', restaurant_id: 'r1', credit_actuel: '300000' },
      { id: 'tee', nom: 'TEE', type: 'administratif', restaurant_id: 'r1', credit_actuel: '0' },
      { id: 'ali', nom: 'Ali sable', type: 'marchandise', restaurant_id: 'r1', credit_actuel: '900000' },
      { id: 'vieux', nom: 'ITS', type: 'administratif', restaurant_id: 'r1', credit_actuel: '5000', actif: false },
    ]
    const l = lignesPayables({ dus, paiements, fournisseurs })
    assert.deepEqual(l.map(x => [x.cle, x.reste]), [['du:l-fev', 1_500_000], ['du:l-mars', 1_000_000], ['du:dette', 400_000], ['fo:cnps', 300_000]])
    assert.deepEqual(l.map(x => x.filtre), ['loyer', 'loyer', 'dette', 'administratif'])
    // En modification, une ligne déjà sur le chèque reste proposée même soldée.
    assert.ok(lignesPayables({ dus, paiements, fournisseurs, garder: ['du:l-paye'] }).some(x => x.cle === 'du:l-paye'))
  })

  test('le mois s\'affiche pour les loyers et les salaires', () => {
    const nomResto = id => (id === 'r1' ? 'Palmeraie' : 'Groupe')
    assert.equal(titreLignePayable({ du: { categorie: 'loyer', restaurant_id: 'r1', mois: '2026-02-01' } }, nomResto), 'Loyer · Palmeraie · février 2026')
    assert.equal(titreLignePayable({ du: { categorie: 'salaire', restaurant_id: 'r1', mois: '2026-10-01' } }, nomResto), 'Salaires · Palmeraie · octobre 2026')
    assert.equal(titreLignePayable({ du: { categorie: 'dette', creancier: 'Ali' } }, nomResto), 'Dette · Ali')
    assert.equal(titreLignePayable({ fournisseur: { nom: 'CNPS', restaurant_id: 'r1' } }, nomResto), 'Administratif · CNPS · Palmeraie')
  })
})
