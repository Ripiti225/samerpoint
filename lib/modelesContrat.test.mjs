// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/modelesContrat.js — les trois contrats (CDD, CDI, Stage).
//
// Un contrat est un document juridique remis au travailleur : un « undefined »,
// une date en chiffres anglais ou un montant mal écrit le rend inutilisable.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARQUES_CONTRAT, marqueContrat, nombreEnLettres, dureeEnLettres, dateEnLettres, montantFCFA,
  champsManquantsContrat, construireContrat, texteContrat, pieceIdentite, donneesDepuisFiche,
} from './modelesContrat.js'

const TANGUY = {
  type: 'CDD', marque: 'alkayan', civilite: 'M.', nom_famille: 'Gbadie', prenoms: 'Gogre Tanguy Wenceslas',
  date_naissance: '1991-03-11', lieu_naissance: 'Yopougon', nationalite: 'Ivoirienne', situation_famille: '',
  cni_numero: 'CI007879705', nni_numero: '11919240401', lieu_residence: 'Yopougon', telephone: '01 01 35 48 69',
  poste: 'Caissier', categorie: '1', date_debut: '2026-05-01', date_fin: '2026-07-31', duree_mois: 3,
  salaire_categoriel: 75000, prime_tenue: 3031, indemnite_transport: 30000, date_signature: '2026-04-30',
}

describe('marques', () => {
  test('Chez Samer : siège Riviera Palmeraie', () => {
    assert.equal(MARQUES_CONTRAT.samer.siege, 'COCODY RIVIERA PALMERAIE SODECI')
  })
  test('Al Kayan : siège Yopougon Maroc', () => {
    assert.equal(MARQUES_CONTRAT.alkayan.siege, 'YOPOUGON MAROC')
  })
  test('représentant identique : M. ZREIK SAMER, Gérant', () => {
    for (const m of Object.values(MARQUES_CONTRAT)) {
      assert.equal(m.representant, 'M. ZREIK SAMER')
      assert.equal(m.qualite, 'Gérant')
    }
  })
  test('À la Braise : pas de modèle', () => {
    assert.equal(marqueContrat('alabraise'), null)
    assert.equal(marqueContrat('samer')?.etablissement, 'CHEZ SAMER')
  })
})

describe('nombreEnLettres', () => {
  const cas = [
    [0, 'zéro'], [1, 'un'], [3, 'trois'], [12, 'douze'], [16, 'seize'], [17, 'dix-sept'], [21, 'vingt et un'],
    [22, 'vingt-deux'], [60, 'soixante'], [71, 'soixante et onze'], [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'], [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'], [101, 'cent un'], [200, 'deux cents'], [250, 'deux cent cinquante'], [1000, 'mille'],
    [2000, 'deux mille'], [80000, 'quatre-vingt mille'], [200000, 'deux cent mille'], [75000, 'soixante-quinze mille'],
    [3031, 'trois mille trente et un'],
  ]
  for (const [n, txt] of cas) test(`${n}`, () => assert.equal(nombreEnLettres(n), txt))
})

describe('dureeEnLettres', () => {
  test('3 mois', () => assert.equal(dureeEnLettres(3), 'trois mois (03 mois)'))
  test('1 mois', () => assert.equal(dureeEnLettres(1), 'un mois (01 mois)'))
  test('12 mois', () => assert.equal(dureeEnLettres(12), 'douze mois (12 mois)'))
  test('24 mois', () => assert.equal(dureeEnLettres(24), 'vingt-quatre mois (24 mois)'))
})

describe('dateEnLettres', () => {
  test('premier du mois', () => assert.equal(dateEnLettres('2026-05-01'), '1er mai 2026'))
  test('autre jour', () => assert.equal(dateEnLettres('2026-07-31'), '31 juillet 2026'))
  test('vide', () => assert.equal(dateEnLettres(''), ''))
})

describe('montantFCFA', () => {
  test('milliers séparés par une espace simple', () => assert.equal(montantFCFA(75000), '75 000 F CFA'))
  test('3031', () => assert.equal(montantFCFA(3031), '3 031 F CFA'))
  test('texte', () => assert.equal(montantFCFA('30000'), '30 000 F CFA'))
})

describe('pieceIdentite', () => {
  test('CNI et NNI', () => assert.equal(pieceIdentite(TANGUY), 'CNI N° CI007879705 ; NNI 11919240401'))
  test('CNI seule', () => assert.equal(pieceIdentite({ cni_numero: 'C1' }), 'CNI N° C1'))
})

describe('champsManquantsContrat', () => {
  test('CDD complet', () => assert.deepEqual(champsManquantsContrat('CDD', TANGUY), []))
  test('lieu de naissance absent', () => {
    assert.ok(champsManquantsContrat('CDD', { ...TANGUY, lieu_naissance: '' }).includes('Lieu de naissance'))
  })
  test('pièce : CNI ou NNI suffit', () => {
    assert.deepEqual(champsManquantsContrat('CDD', { ...TANGUY, cni_numero: '' }), [])
    assert.ok(champsManquantsContrat('CDD', { ...TANGUY, cni_numero: '', nni_numero: '' }).includes("Pièce d'identité"))
  })
  test('prime de tenue à 0 acceptée', () => {
    assert.deepEqual(champsManquantsContrat('CDD', { ...TANGUY, prime_tenue: 0 }), [])
  })
  test('CDI : pas de date de fin ni de durée', () => {
    assert.deepEqual(champsManquantsContrat('CDI', { ...TANGUY, type: 'CDI', date_fin: null, duree_mois: null }), [])
  })
  test('stage sans salaire catégoriel : rien ne manque', () => {
    const stage = { ...TANGUY, type: 'Stage', salaire_categoriel: null, prime_tenue: null, indemnite_transport: null, categorie: '', prime_journaliere: 3000 }
    assert.deepEqual(champsManquantsContrat('Stage', stage), [])
  })
  test('stage sans prime journalière', () => {
    assert.ok(champsManquantsContrat('Stage', { ...TANGUY, type: 'Stage' }).includes('Prime journalière'))
  })
  test('marque sans modèle', () => {
    assert.ok(champsManquantsContrat('CDD', { ...TANGUY, marque: 'alabraise' }).includes('Modèle du restaurant'))
  })
})

describe('construireContrat — CDD Al Kayan', () => {
  const c = construireContrat(TANGUY)
  const txt = texteContrat(c)
  test('titre', () => assert.equal(c.titre, 'CONTRAT DE TRAVAIL A DUREE DETERMINEE'))
  for (const attendu of [
    'AL KAYAN', 'YOPOUGON MAROC', '01 51 11 11 91', 'M. ZREIK SAMER', 'Gérant', 'GBADIE', 'GOGRE TANGUY WENCESLAS',
    '11 mars 1991 à YOPOUGON', 'IVOIRIENNE', 'CNI N° CI007879705 ; NNI 11919240401', '01 01 35 48 69',
    'CAISSIER', 'catégorie 1', 'trois mois (03 mois)', '1er mai 2026', '31 juillet 2026', '75 000 F CFA',
    '3 031 F CFA', '30 000 F CFA', '3 %', 'confidentialité', 'Caisse Nationale de Prévoyance Sociale',
    'Fait en double exemplaire à Abidjan le 30 avril 2026', 'Monsieur GBADIE GOGRE TANGUY WENCESLAS',
  ]) {
    test(`contient « ${attendu} »`, () => assert.ok(txt.includes(attendu), attendu))
  }
  test('dix articles', () => assert.equal(c.blocs.filter(b => b.t === 'article').length, 10))
  test('aucun trou', () => {
    for (const mot of ['undefined', 'null', 'NaN', '[', ']']) assert.ok(!txt.includes(mot), mot)
  })
  test('commence par l\'en-tête, finit par les signatures', () => {
    assert.equal(c.blocs[0].t, 'entete')
    assert.equal(c.blocs.at(-1).t, 'signatures')
  })
})

describe('construireContrat — avant signature', () => {
  test('date de signature laissée en blanc', () => {
    const txt = texteContrat(construireContrat({ ...TANGUY, date_signature: null }))
    assert.ok(txt.includes('Fait en double exemplaire à Abidjan le ____'))
  })
})

describe('construireContrat — CDI', () => {
  const c = construireContrat({ ...TANGUY, type: 'CDI', date_fin: null, duree_mois: null })
  const txt = texteContrat(c)
  test('titre', () => assert.equal(c.titre, 'CONTRAT DE TRAVAIL A DUREE INDETERMINEE'))
  test('durée indéterminée', () => assert.ok(txt.includes('durée indéterminée')))
  test('ni indemnité de fin, ni renouvellement', () => {
    assert.ok(!txt.includes('3 %'))
    assert.ok(!txt.includes('renouvelable'))
  })
  test('neuf articles', () => assert.equal(c.blocs.filter(b => b.t === 'article').length, 9))
})

describe('construireContrat — Stage Chez Samer, Madame', () => {
  const stage = {
    ...TANGUY, type: 'Stage', marque: 'samer', civilite: 'Mme', nom_famille: 'Kone', prenoms: 'Awa',
    duree_mois: 6, date_debut: '2026-11-05', date_fin: '2027-05-04', prime_journaliere: 3000,
    salaire_categoriel: null, prime_tenue: null, indemnite_transport: null, categorie: '',
  }
  const c = construireContrat(stage)
  const txt = texteContrat(c)
  test('titre', () => assert.equal(c.titre, 'CONTRAT DE STAGE DE QUALIFICATION'))
  for (const attendu of [
    'CHEZ SAMER', 'COCODY RIVIERA PALMERAIE SODECI', 'STAGIAIRE', 'prime journalière de stage de 3 000 F CFA',
    'six mois (06 mois)', '5 novembre 2026', '4 mai 2027', 'douze (12) mois', 'Madame KONE AWA', 'Désignée',
    'engagée', 'Lu et approuvé',
  ]) {
    test(`contient « ${attendu} »`, () => assert.ok(txt.includes(attendu), attendu))
  }
  test('neuf articles', () => assert.equal(c.blocs.filter(b => b.t === 'article').length, 9))
  test('aucun trou', () => {
    for (const mot of ['undefined', 'null', 'NaN']) assert.ok(!txt.includes(mot), mot)
  })
})

describe('donneesDepuisFiche', () => {
  const fiche = {
    id: 't1', nom: 'GBADIE Gogre', civilite: 'M.', nom_famille: 'Gbadie', prenoms: 'Gogre', date_naissance: '1991-03-11',
    lieu_naissance: 'Yopougon', nationalite: 'Ivoirienne', situation_famille: null, cni_numero: 'CI1', nni_numero: null,
    lieu_residence: 'Yopougon', contact: '0101354869', poste: 'Caissier',
  }
  const montants = { categorie: '1', salaire_categoriel: '75000', prime_tenue: 3031, indemnite_transport: '30000', prime_journaliere: 3000 }
  test('CDD : identité, contact → téléphone, montants en nombres, sans prime de stage', () => {
    const d = donneesDepuisFiche(fiche, 'alkayan', { type: 'CDD', duree_mois: 3, date_debut: '2026-05-01', date_fin: '2026-07-31', montants })
    assert.equal(d.telephone, '0101354869')
    assert.equal(d.marque, 'alkayan')
    assert.equal(d.salaire_categoriel, 75000)
    assert.equal(d.indemnite_transport, 30000)
    assert.equal(d.prime_journaliere, undefined)
    assert.equal(d.date_signature, null)
    assert.deepEqual(champsManquantsContrat('CDD', d), [])
  })
  test('CDI : ni fin ni durée', () => {
    const d = donneesDepuisFiche(fiche, 'samer', { type: 'CDI', duree_mois: 6, date_debut: '2026-05-01', date_fin: '2026-11-01', montants })
    assert.equal(d.date_fin, null)
    assert.equal(d.duree_mois, null)
  })
  test('Stage : seulement la prime journalière', () => {
    const d = donneesDepuisFiche(fiche, 'samer', { type: 'Stage', duree_mois: 6, date_debut: '2026-05-01', date_fin: '2026-11-01', montants })
    assert.equal(d.prime_journaliere, 3000)
    assert.equal(d.salaire_categoriel, undefined)
  })
  test('montant vide → null', () => {
    const d = donneesDepuisFiche(fiche, 'samer', { type: 'CDD', duree_mois: 3, date_debut: '2026-05-01', date_fin: '2026-07-31', montants: { ...montants, prime_tenue: '' } })
    assert.equal(d.prime_tenue, null)
    assert.ok(champsManquantsContrat('CDD', d).includes('Prime de tenue'))
  })
})
