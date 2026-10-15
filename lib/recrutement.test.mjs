// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/recrutement.js — la demande de nouveau travailleur du gérant.
//
// Deux pièges : laisser partir une demande sans photo (la RH ne peut pas
// identifier la personne), et créer une seconde fiche pour un ancien employé
// qui revient — son historique serait coupé en deux.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  CIVILITES, SITUATIONS_FAMILLE, STATUTS_DEMANDE_TRAV,
  manquantsDemande, normaliserTelephone, normaliserPiece, trouverDoublon, nomComplet, peutRenvoyer, estPdf,
  traitsVersPath,
} from './recrutement.js'

const COMPLET = {
  photo_url: 'https://x/photo.jpg', civilite: 'M.', nom_famille: 'Gbadie', prenoms: 'Gogre Tanguy',
  date_naissance: '1991-03-11', lieu_naissance: 'Yopougon', nationalite: 'Ivoirienne',
  situation_famille: 'Célibataire', cni_numero: 'CI007879705', nni_numero: '', lieu_residence: 'Yopougon',
  contact: '0101354869', poste: 'Caissier', date_embauche: '2026-05-01', salaire_journalier: '3000',
}

describe('constantes', () => {
  test('civilités', () => assert.deepEqual(CIVILITES, ['M.', 'Mme']))
  test('situations de famille', () => assert.ok(SITUATIONS_FAMILLE.includes('Célibataire')))
  test('trois statuts de demande', () => {
    assert.deepEqual(Object.keys(STATUTS_DEMANDE_TRAV), ['envoyee', 'acceptee', 'refusee'])
  })
})

describe('manquantsDemande', () => {
  test('demande complète : rien ne manque', () => {
    assert.deepEqual(manquantsDemande(COMPLET), { bloquants: [], incomplets: [] })
  })
  test('sans photo : bloquant', () => {
    assert.deepEqual(manquantsDemande({ ...COMPLET, photo_url: null }).bloquants, ['Photo du travailleur'])
  })
  test('nom, prénoms et poste sont bloquants', () => {
    const r = manquantsDemande({ ...COMPLET, nom_famille: ' ', prenoms: '', poste: '' })
    assert.deepEqual(r.bloquants, ['Nom', 'Prénoms', 'Poste'])
  })
  test('lieu de naissance absent : incomplet seulement', () => {
    const r = manquantsDemande({ ...COMPLET, lieu_naissance: '' })
    assert.deepEqual(r, { bloquants: [], incomplets: ['Lieu de naissance'] })
  })
  test('CNI ou NNI : un des deux suffit', () => {
    assert.deepEqual(manquantsDemande({ ...COMPLET, cni_numero: '', nni_numero: '11919240401' }).incomplets, [])
    assert.deepEqual(manquantsDemande({ ...COMPLET, cni_numero: '', nni_numero: '' }).incomplets, ["Pièce d'identité (CNI ou NNI)"])
  })
  test('salaire journalier à zéro : incomplet', () => {
    assert.deepEqual(manquantsDemande({ ...COMPLET, salaire_journalier: '0' }).incomplets, ['Salaire journalier'])
  })
  test('formulaire vide : tout manque, sans planter', () => {
    const r = manquantsDemande({})
    assert.equal(r.bloquants.length, 4)
    assert.equal(r.incomplets.length, 10)
  })
})

describe('normaliserTelephone', () => {
  test('indicatif et espaces retirés', () => {
    assert.equal(normaliserTelephone('+225 07 08 11 11 18'), '0708111118')
  })
  test('00225', () => assert.equal(normaliserTelephone('00225 0708111118'), '0708111118'))
  test('déjà propre', () => assert.equal(normaliserTelephone('01 01 35 48 69'), '0101354869'))
  test('vide', () => assert.equal(normaliserTelephone(null), ''))
})

describe('normaliserPiece', () => {
  test('majuscules, sans espaces ni séparateurs', () => {
    assert.equal(normaliserPiece('ci 0078 797-05'), 'CI007879705')
  })
  test('vide', () => assert.equal(normaliserPiece(undefined), ''))
})

describe('trouverDoublon', () => {
  const travailleurs = [
    { id: 't1', nom: 'KONE Awa', contact: '07 08 11 11 18', cni_numero: null },
    { id: 't2', nom: 'GBADIE Gogre', contact: '', cni_numero: 'CI007879705', statut: 'archive' },
    { id: 't3', nom: 'Sans contact', contact: '', cni_numero: '' },
  ]
  test('même CNI, écrite autrement', () => {
    assert.equal(trouverDoublon({ cni_numero: 'ci 0078 79705' }, travailleurs)?.id, 't2')
  })
  test('même téléphone, avec indicatif', () => {
    assert.equal(trouverDoublon({ contact: '+225 0708111118' }, travailleurs)?.id, 't1')
  })
  test('deux téléphones vides ne sont pas un doublon', () => {
    assert.equal(trouverDoublon({ contact: '', cni_numero: '' }, travailleurs), null)
  })
  test('même NNI', () => {
    assert.equal(trouverDoublon({ nni_numero: '119 19240401' }, [{ id: 'n', nni_numero: '11919240401' }])?.id, 'n')
  })
  test('personne de connu', () => {
    assert.equal(trouverDoublon({ contact: '0500000000' }, travailleurs), null)
  })
})

describe('nomComplet', () => {
  test('nom en majuscules, prénoms tels quels', () => {
    assert.equal(nomComplet({ nom_famille: ' Gbadie ', prenoms: 'Gogre Tanguy ' }), 'GBADIE Gogre Tanguy')
  })
  test('sans prénoms', () => assert.equal(nomComplet({ nom_famille: 'Kone' }), 'KONE'))
})

describe('peutRenvoyer', () => {
  test('seulement une demande refusée', () => {
    assert.equal(peutRenvoyer({ statut: 'refusee' }), true)
    assert.equal(peutRenvoyer({ statut: 'envoyee' }), false)
    assert.equal(peutRenvoyer({ statut: 'acceptee' }), false)
  })
})

describe('traitsVersPath', () => {
  test('un trait = un M puis des L, mis à l\'échelle', () => {
    const traits = [[[0, 0], [0.5, 0.5], [1, 0]]]
    assert.equal(traitsVersPath(traits, 200, 100), 'M0 0 L100 50 L200 0')
  })
  test('plusieurs traits', () => {
    assert.equal(traitsVersPath([[[0, 0], [1, 1]], [[0, 1], [1, 0]]], 10, 10), 'M0 0 L10 10 M0 10 L10 0')
  })
  test('rien à dessiner', () => assert.equal(traitsVersPath(null, 10, 10), ''))
})

describe('estPdf — CNI et papiers en photo ou en PDF', () => {
  test('reconnaît un PDF, même avec des paramètres', () => {
    assert.equal(estPdf('https://x/photos/recrutement/cni/1_ab.pdf'), true)
    assert.equal(estPdf('https://x/photos/recrutement/cni/1_ab.PDF?t=2'), true)
  })
  test('une photo, une adresse vide ou absente ne sont pas des PDF', () => {
    assert.equal(estPdf('https://x/photos/recrutement/cni/1_ab.jpg'), false)
    assert.equal(estPdf('https://x/pdf/photo.jpg'), false)
    assert.equal(estPdf(''), false)
    assert.equal(estPdf(null), false)
  })
})
