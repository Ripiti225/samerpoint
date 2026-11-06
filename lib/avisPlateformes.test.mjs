// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/avisPlateformes.js — les avis Yango & Glovo.
//
// Deux plateformes qui ne notent pas de la même façon : Yango donne des
// étoiles (1-5), Glovo un simple pouce. Traiter un pouce vert comme un 5/5
// ferait remonter la note moyenne d'un restaurant sans qu'aucun client ne
// l'ait notée — et un pouce rouge doit rester un avis négatif même sans note.
// C'est la confusion que ces tests empêchent.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifierAvis, noteSur5, kpisAvis, kpisParPlateforme,
  kpisParRestaurant, boutiquesARattacher, aUnMotif, aUnCommentaire, SEUIL_NEGATIF,
  plateformesEnRetard, texteRetard, SEUIL_RAPPEL_JOURS,
} from './avisPlateformes.js'

const RESTO_A = 'b862dfee-007f-413a-9de0-2c6e83b572ce'
const RESTO_B = 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'

describe('classifierAvis — négatif ou non', () => {

  test('Yango : en dessous de 3 étoiles, l’avis est négatif', () => {
    assert.equal(classifierAvis({ platform: 'yango', rating_raw: 2, rating_scale: 5 }), 'negatif')
    assert.equal(classifierAvis({ platform: 'yango', rating_raw: 1, rating_scale: 5 }), 'negatif')
  })

  test('3 étoiles pile n’est pas négatif — le seuil est strict', () => {
    assert.equal(SEUIL_NEGATIF, 3)
    assert.equal(classifierAvis({ platform: 'yango', rating_raw: 3, rating_scale: 5 }), 'bon')
  })

  test('Glovo : sans note, c’est le pouce transmis par l’extraction qui tranche', () => {
    assert.equal(classifierAvis({ platform: 'glovo', classification: 'negatif' }), 'negatif')
    assert.equal(classifierAvis({ platform: 'glovo', classification: 'bon' }), 'bon')
  })

  test('la classification transmise prime sur la note', () => {
    // Yango affiche parfois le tag « Pas très bon » sur une note de 3 :
    // l’extraction tranche, l’app ne recalcule pas par-dessus.
    assert.equal(classifierAvis({ rating_raw: 3, rating_scale: 5, classification: 'negatif' }), 'negatif')
  })

  test('une classification inconnue est ignorée, on retombe sur la note', () => {
    assert.equal(classifierAvis({ rating_raw: 1, rating_scale: 5, classification: 'bof' }), 'negatif')
  })

  test('une échelle différente de 5 est ramenée sur 5 avant comparaison', () => {
    // 4/10 = 2/5 → négatif ; 7/10 = 3,5/5 → bon.
    assert.equal(classifierAvis({ rating_raw: 4, rating_scale: 10 }), 'negatif')
    assert.equal(classifierAvis({ rating_raw: 7, rating_scale: 10 }), 'bon')
  })
})

describe('noteSur5 — un pouce n’est pas une note', () => {

  test('Glovo n’a pas de note : null, pas 5', () => {
    assert.equal(noteSur5({ platform: 'glovo', classification: 'bon' }), null)
    assert.equal(noteSur5({ platform: 'glovo', rating_raw: null }), null)
  })

  test('la note déjà normalisée par la base est reprise telle quelle', () => {
    assert.equal(noteSur5({ rating_raw: 4, rating_scale: 10, rating_normalized: 2 }), 2)
  })

  test('sinon elle est ramenée sur 5', () => {
    assert.equal(noteSur5({ rating_raw: 4, rating_scale: 10 }), 2)
    assert.equal(noteSur5({ rating_raw: 4, rating_scale: 5 }), 4)
  })
})

describe('kpisAvis — ce que lit le manager', () => {

  const AVIS = [
    { platform: 'yango', rating_raw: 5, rating_scale: 5 },
    { platform: 'yango', rating_raw: 1, rating_scale: 5 },
    { platform: 'glovo', classification: 'bon' },
    { platform: 'glovo', classification: 'negatif' },
  ]

  test('compte les avis et les négatifs', () => {
    const k = kpisAvis(AVIS)
    assert.equal(k.nb, 4)
    assert.equal(k.nbNegatifs, 2)
    assert.equal(k.nbBons, 2)
    assert.equal(k.pctNegatifs, 50)
  })

  test('la moyenne ne porte que sur les avis notés', () => {
    const k = kpisAvis(AVIS)
    // (5 + 1) / 2 = 3 — les deux avis Glovo ne comptent pas dans la note.
    assert.equal(k.noteMoyenne, 3)
    assert.equal(k.nbNotes, 2)
  })

  test('aucun avis noté → pas de moyenne inventée', () => {
    const k = kpisAvis([{ platform: 'glovo', classification: 'bon' }])
    assert.equal(k.noteMoyenne, null)
    assert.equal(k.nbNotes, 0)
  })

  test('liste vide : tout à zéro, aucune division par zéro', () => {
    assert.deepEqual(kpisAvis([]), {
      nb: 0, nbNegatifs: 0, nbBons: 0, pctNegatifs: 0, nbNotes: 0, noteMoyenne: null,
    })
  })
})

describe('kpisParPlateforme', () => {

  test('les deux plateformes sont toujours présentes, même sans avis', () => {
    const par = kpisParPlateforme([{ platform: 'yango', rating_raw: 4, rating_scale: 5 }])
    assert.equal(par.yango.nb, 1)
    assert.equal(par.glovo.nb, 0)
    assert.equal(par.glovo.noteMoyenne, null)
  })
})

describe('kpisParRestaurant — le classement affiché', () => {

  const AVIS = [
    { platform: 'yango', restaurant_id: RESTO_A, rating_raw: 5, rating_scale: 5 },
    { platform: 'yango', restaurant_id: RESTO_A, rating_raw: 4, rating_scale: 5 },
    { platform: 'glovo', restaurant_id: RESTO_B, classification: 'negatif' },
    { platform: 'glovo', restaurant_id: null, classification: 'negatif' },
  ]

  test('le restaurant qui va le plus mal apparaît en premier', () => {
    const lignes = kpisParRestaurant(AVIS, { [RESTO_A]: 'Samer Palmeraie', [RESTO_B]: 'Samer Maroc' })
    assert.equal(lignes[0].pctNegatifs, 100)
    assert.equal(lignes.at(-1).nom, 'Samer Palmeraie')
  })

  test('les avis sans restaurant sont regroupés sous « À rattacher », jamais perdus', () => {
    const lignes = kpisParRestaurant(AVIS, {})
    const orphelins = lignes.find(l => l.restaurant_id === null)
    assert.equal(orphelins.nom, 'À rattacher')
    assert.equal(orphelins.nb, 1)
    assert.equal(lignes.reduce((s, l) => s + l.nb, 0), AVIS.length)
  })
})

describe('boutiquesARattacher — la file de travail', () => {

  const AVIS = [
    { platform: 'glovo', external_store_label: 'Chez Samer (Palmeraie) [ABN]', restaurant_id: null, classification: 'negatif', review_date: '2026-09-01' },
    { platform: 'glovo', external_store_label: 'Chez Samer (Palmeraie) [ABN]', restaurant_id: null, classification: 'bon', review_date: '2026-09-02' },
    { platform: 'yango', external_store_label: 'Chez Samer Yopougon Maroc', restaurant_id: null, rating_raw: 2, rating_scale: 5, review_date: '2026-08-30' },
    { platform: 'yango', external_store_label: 'Déjà rattaché', restaurant_id: RESTO_A, rating_raw: 5, rating_scale: 5, review_date: '2026-09-02' },
  ]

  test('une ligne par boutique non rattachée, la plus fournie en tête', () => {
    const b = boutiquesARattacher(AVIS)
    assert.equal(b.length, 2)
    assert.equal(b[0].label, 'Chez Samer (Palmeraie) [ABN]')
    assert.equal(b[0].nb, 2)
    assert.equal(b[0].nbNegatifs, 1)
  })

  test('une boutique déjà rattachée n’apparaît plus', () => {
    assert.equal(boutiquesARattacher(AVIS).some(b => b.label === 'Déjà rattaché'), false)
  })

  test('la même enseigne sur les deux plateformes reste deux lignes distinctes', () => {
    // Le mapping est par (plateforme, libellé) : 9 boutiques Glovo et
    // 17 restaurants Yango ne se recouvrent pas.
    const b = boutiquesARattacher([
      { platform: 'glovo', external_store_label: 'Samer Maroc', restaurant_id: null },
      { platform: 'yango', external_store_label: 'Samer Maroc', restaurant_id: null },
    ])
    assert.equal(b.length, 2)
  })

  test('la date du dernier avis remonte pour prioriser', () => {
    assert.equal(boutiquesARattacher(AVIS)[0].dernier, '2026-09-02')
  })
})

describe('aUnMotif — un avis négatif ne devient un litige que s’il dit pourquoi', () => {
  // L’objet est l’avis tel qu’envoyé par l’extraction : les tags Yango sont
  // dans raw.tag, les thèmes Glovo dans raw.theme.

  test('un commentaire suffit', () => {
    assert.equal(aUnMotif({ comment: 'Froid à l’arrivée' }), true)
  })

  test('un tag Yango suffit, sans commentaire', () => {
    assert.equal(aUnMotif({ comment: '', raw: { tag: ['Pas très bon'] } }), true)
  })

  test('un thème Glovo suffit, même transmis en simple texte', () => {
    assert.equal(aUnMotif({ comment: null, raw: { theme: 'Portion trop petite' } }), true)
  })

  test('avis muet : ni commentaire, ni tag, ni thème → pas de litige', () => {
    assert.equal(aUnMotif({ comment: '' }), false)
    assert.equal(aUnMotif({ comment: '   ', raw: { tag: [], theme: [''] } }), false)
    assert.equal(aUnMotif({}), false)
  })

  test('le plat commandé n’est pas un motif', () => {
    // Glovo affiche toujours le plat : le compter ferait de chaque pouce
    // rouge muet un litige.
    assert.equal(aUnMotif({ comment: '', raw: { dish: 'Chawarma poulet', theme: [] } }), false)
  })
})

describe('plateformesEnRetard — rappel « pense à cliquer sur le bouton avis »', () => {
  const MAINTENANT = Date.parse('2026-10-10T12:00:00Z')

  test('le seuil est de 2 jours', () => {
    assert.equal(SEUIL_RAPPEL_JOURS, 2)
  })

  test('envoi il y a moins de 48 h : pas de rappel', () => {
    const r = plateformesEnRetard({ glovo: '2026-10-08T13:00:00Z', yango: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.deepEqual(r, [])
  })

  test('48 h pile : rappel, avec le nombre de jours', () => {
    const r = plateformesEnRetard({ glovo: '2026-10-08T12:00:00Z', yango: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.deepEqual(r, [{ platform: 'glovo', label: 'Glovo', jours: 2 }])
  })

  test('plateforme jamais reçue : rappel sans nombre de jours', () => {
    const r = plateformesEnRetard({ glovo: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.deepEqual(r, [{ platform: 'yango', label: 'Yango', jours: null }])
  })

  test('date illisible : traitée comme jamais reçue', () => {
    const r = plateformesEnRetard({ yango: 'pas une date', glovo: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.equal(r[0].jours, null)
  })

  test('texte du rappel', () => {
    assert.equal(texteRetard({ label: 'Yango', jours: 3 }), 'Yango : derniers avis reçus il y a 3 jours')
    assert.equal(texteRetard({ label: 'Glovo', jours: null }), 'Glovo : aucun avis reçu pour le moment')
  })
})

describe('aUnCommentaire — le client a écrit quelque chose', () => {
  test('un texte compte', () => assert.equal(aUnCommentaire({ comment: 'Froid à l’arrivée' }), true))
  test('vide, espaces ou absent : non', () => {
    assert.equal(aUnCommentaire({ comment: '' }), false)
    assert.equal(aUnCommentaire({ comment: '   ' }), false)
    assert.equal(aUnCommentaire({ comment: null }), false)
    assert.equal(aUnCommentaire({}), false)
  })
  test('un simple tag ou thème n’est pas un commentaire', () => {
    assert.equal(aUnCommentaire({ comment: '', raw: { tag: ['Pas très bon'], theme: 'Portion' } }), false)
  })
})
