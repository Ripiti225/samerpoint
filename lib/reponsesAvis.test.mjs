// Tests de lib/reponsesAvis.js — réponses proposées aux avis Glovo.
// Glovo annule une réponse avec un chiffre ou un nom de restaurant, et coupe à 250 caractères.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MODELES, MAX_REPONSE, detecterMotif, proposerReponse, verifierReponse, avisARepondre } from './reponsesAvis.js'

const neg = (comment, theme) => ({ classification: 'negatif', comment, raw: { raw: theme ? { theme } : {} } })
const bon = comment => ({ classification: 'bon', comment, raw: { raw: {} } })

describe('MODELES', () => {
  test('chaque modèle est envoyable tel quel', () => {
    for (const [motif, texte] of Object.entries(MODELES)) {
      assert.deepEqual(verifierReponse(texte), [], motif)
      assert.ok(texte.length <= MAX_REPONSE, motif)
    }
  })
})

describe('detecterMotif', () => {
  test('les mots du client passent avant l’étiquette Glovo', () => {
    assert.equal(detecterMotif(neg('Vielles Frittes froides', ['Mauvais goût'])), 'froid_sec')
    assert.equal(detecterMotif(neg('Repas froid', ['Mauvais goût'])), 'froid_sec')
  })
  test('sans mot reconnu : l’étiquette Glovo', () => {
    assert.equal(detecterMotif(neg('bof', ['Produits manquants ou incorrects', 'Mauvais goût'])), 'manquant_erreur')
    assert.equal(detecterMotif(neg('bof', 'Mauvais goût')), 'gout')
    assert.equal(detecterMotif(neg('bof', ['Portion trop petite'])), 'photo_portion')
    assert.equal(detecterMotif(neg('bof', ["Qualité de l'emballage"])), 'emballage')
  })
  test('mots du client (avis du 14 au 19/10/2026)', () => {
    assert.equal(detecterMotif(neg('je n\'ai pas reçu ma boisson')), 'manquant_erreur')
    assert.equal(detecterMotif(neg('La pizza commandé n’est pas celle qu’on a reçu.')), 'manquant_erreur')
    assert.equal(detecterMotif(neg('Vielles Frittes froides')), 'froid_sec')
    assert.equal(detecterMotif(neg('les frites st sèches et sans goût')), 'froid_sec')
    assert.equal(detecterMotif(neg('la pizza était trop salée')), 'gout')
    assert.equal(detecterMotif(neg('Pas de goût, fade j’ai pas aimé')), 'gout')
    assert.equal(detecterMotif(neg('J’ai reçu une nourriture différente de la photo')), 'photo_portion')
    assert.equal(detecterMotif(neg('un sauce s’est renversée')), 'emballage')
    assert.equal(detecterMotif(neg('Vous jouez avec les Gens!!!')), 'negatif_autre')
  })
  test('autres avis réels (septembre-octobre 2026)', () => {
    assert.equal(detecterMotif(neg('parce que j ai demandé un Sprite et j ai reçu miranda')), 'manquant_erreur')
    assert.equal(detecterMotif(neg('Il n’y avait pas mon coca dans la commande')), 'manquant_erreur')
    assert.equal(detecterMotif(neg('Le jus c’est renversé lors de la commande et a tout mouillé c’est immangeable')), 'emballage')
    assert.equal(detecterMotif(neg('Ma nourriture est venue dans un mauvais état je suis déçu')), 'emballage')
  })
  test('positif, avec ou sans réserve', () => {
    assert.equal(detecterMotif(bon('excellent')), 'positif')
    assert.equal(detecterMotif(bon('trop bon 🤤 , mais j\'ai pas eu de piment à l\'intérieur')), 'positif_mais')
    assert.equal(detecterMotif(bon('samer peut faire mieux')), 'positif_mais')
    assert.equal(detecterMotif(bon('LIVREUR TRES IMPOLI')), 'positif_mais')
  })
})

describe('proposerReponse', () => {
  test('le texte du modèle du motif', () => {
    assert.deepEqual(proposerReponse(neg('la pizza était trop salée')), { motif: 'gout', texte: MODELES.gout })
  })
})

describe('verifierReponse', () => {
  test('texte correct : rien à signaler', () => {
    assert.deepEqual(verifierReponse('Bonjour, merci pour votre retour.'), [])
  })
  test('vide', () => {
    assert.deepEqual(verifierReponse('   '), ['Écrivez une réponse.'])
  })
  test('trop long', () => {
    assert.deepEqual(verifierReponse('a'.repeat(263)), ['Trop long : 263 / 250 caractères.'])
  })
  test('un chiffre', () => {
    assert.deepEqual(verifierReponse('Merci, à dans 2 jours'), ['Retirez les chiffres : Glovo refuse les réponses qui en contiennent.'])
  })
  test('un nom de restaurant ou de marque', () => {
    assert.deepEqual(verifierReponse('Merci de la part de Chez Samer'), ['Retirez « Samer » : pas de nom de restaurant ni de marque.'])
    assert.deepEqual(verifierReponse('Toute l’équipe Al Kayan vous remercie'), ['Retirez « Kayan » : pas de nom de restaurant ni de marque.'])
  })
})

describe('avisARepondre', () => {
  const a1 = { id: 'a1', platform: 'glovo', comment: 'trop salé' }
  const a2 = { id: 'a2', platform: 'glovo', comment: '' }
  const a3 = { id: 'a3', platform: 'yango', comment: 'bof' }
  const a4 = { id: 'a4', platform: 'glovo', comment: 'froid' }
  const a5 = { id: 'a5', platform: 'glovo', comment: 'pas reçu' }
  test('Glovo, avec texte, sans réponse ou réponse refusée', () => {
    const rep = new Map([['a4', { statut: 'validee' }], ['a5', { statut: 'refusee' }]])
    assert.deepEqual(avisARepondre([a1, a2, a3, a4, a5], rep).map(a => a.id), ['a1', 'a5'])
  })
})
