// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/contactsPOS.js — d'où viennent les « contacts pris », et quand
// peut-on en tirer une retenue de 500 FCFA par contact manquant ?
//
// Le risque que ces tests couvrent est chiffré : sur Angré 7E, du 17 au 25 août
// 2026, la table `commandes` est restée vide (les caissières saisissent dans le
// POS) pendant que le gérant déclarait ses commandes Yango/Glovo. Le calcul
// historique en déduisait 100 % de contacts manquants — un faux litige de
// plusieurs dizaines de milliers de FCFA sur des caissières irréprochables.
//
//   node lib/contactsPOS.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  compterContactsPOS, compterCommandesPOS, choisirNombreContacts,
  calculerLitigeContact, PRIX_CONTACT_MANQUANT,
} from './contactsPOS.js'

const shift = (contacts, extra = {}) => ({ pos_nb_contacts: contacts, ...extra })
// Point type : 20 commandes livraison déclarées par le gérant.
const POINT = { yango_nb_commandes: 15, glovo_nb_commandes: 5 }

describe('compterContactsPOS — somme des compteurs de shift', () => {
  test('deux shifts renseignés : 5 + 7 = 12', () => {
    const r = compterContactsPOS([shift(5), shift(7)])
    assert.equal(r.nombre, 12)
    assert.equal(r.disponible, true)
    assert.equal(r.shiftsSansDonnee, 0)
  })

  test('zéro transmis reste une mesure disponible', () => {
    const r = compterContactsPOS([shift(0), shift(0)])
    assert.equal(r.nombre, 0)
    assert.equal(r.disponible, true)
  })

  test('tous les compteurs à null : indisponible, et surtout pas 0 « reçu »', () => {
    const r = compterContactsPOS([shift(null), shift(undefined)])
    assert.equal(r.disponible, false)
    assert.equal(r.shiftsSansDonnee, 2)
  })

  test('un shift renseigné, un shift pas encore synchronisé : partiel', () => {
    const r = compterContactsPOS([shift(6), shift(null)])
    assert.equal(r.nombre, 6)
    assert.equal(r.disponible, true)
    assert.equal(r.shiftsSansDonnee, 1)
  })

  test('resynchronisation : le total suit la nouvelle valeur du shift', () => {
    assert.equal(compterContactsPOS([shift(5), shift(7)]).nombre, 12)
    assert.equal(compterContactsPOS([shift(6), shift(7)]).nombre, 13)
  })

  test('une valeur aberrante ne creuse pas le total', () => {
    assert.equal(compterContactsPOS([shift(-4), shift(3)]).nombre, 3)
  })
})

describe('compterCommandesPOS — contrôle croisé Yango/Glovo', () => {
  test('somme les deux partenaires quand le POS les transmet', () => {
    const r = compterCommandesPOS([
      { pos_nb_yango: 8, pos_nb_glovo: 2 },
      { pos_nb_yango: 5, pos_nb_glovo: 1 },
    ])
    assert.equal(r.yango, 13)
    assert.equal(r.glovo, 3)
    assert.equal(r.nombre, 16)
    assert.equal(r.disponible, true)
  })

  test('rien transmis : indisponible', () => {
    assert.equal(compterCommandesPOS([{ pos_nb_yango: null, pos_nb_glovo: null }]).disponible, false)
  })
})

describe('choisirNombreContacts — une source, jamais la somme des deux', () => {
  test('site Samtrackly : les commandes font foi', () => {
    const r = choisirNombreContacts({
      sourcePoint: 'SAMTRACKLY', shifts: [], contactsSamtrackly: 8,
    })
    assert.equal(r.nombre, 8)
    assert.equal(r.source, 'SAMTRACKLY')
    assert.equal(r.disponible, true)
  })

  test('site POS : les compteurs de shift font foi', () => {
    const r = choisirNombreContacts({
      sourcePoint: 'POS', shifts: [shift(5), shift(7)], contactsSamtrackly: 0,
    })
    assert.equal(r.nombre, 12)
    assert.equal(r.source, 'POS')
  })

  test('site POS avec un historique Samtrackly : 12, jamais 32', () => {
    // 20 anciennes lignes `commandes` + 12 contacts POS : les additionner
    // doublerait les contacts des journées de transition.
    const r = choisirNombreContacts({
      sourcePoint: 'POS', shifts: [shift(5), shift(7)], contactsSamtrackly: 20,
    })
    assert.equal(r.nombre, 12)
  })

  test('site POS sans compteur : indisponible, pas de repli silencieux sur les commandes', () => {
    const r = choisirNombreContacts({
      sourcePoint: 'POS', shifts: [shift(null), shift(null)], contactsSamtrackly: 20,
    })
    assert.equal(r.disponible, false)
    assert.equal(r.nombre, 0)
  })

  test('site POS partiellement synchronisé : incomplet', () => {
    const r = choisirNombreContacts({
      sourcePoint: 'POS', shifts: [shift(12), shift(null)], contactsSamtrackly: 0,
    })
    assert.equal(r.nombre, 12)
    assert.equal(r.incomplet, true)
    assert.equal(r.shiftsSansDonnee, 1)
  })

  test('valeur de source inattendue : on se comporte comme un site Samtrackly', () => {
    const r = choisirNombreContacts({ sourcePoint: 'pos ', shifts: [shift(3)], contactsSamtrackly: 9 })
    assert.equal(r.source, 'POS')   // normalisation casse/espaces
    const r2 = choisirNombreContacts({ sourcePoint: null, shifts: [shift(3)], contactsSamtrackly: 9 })
    assert.equal(r2.source, 'SAMTRACKLY')
    assert.equal(r2.nombre, 9)
  })
})

describe('calculerLitigeContact — aucune retenue sur une donnée absente', () => {
  const info = (o) => ({ source: 'POS', disponible: true, incomplet: false, shiftsSansDonnee: 0, ...o })

  test('site Samtrackly : règle historique inchangée (20 cmd, 8 contacts)', () => {
    const calc = calculerLitigeContact(POINT, 8)
    assert.equal(calc.nbContacts, 8)
    assert.equal(calc.ecart, 12)
    assert.equal(calc.taux, 60)
    assert.equal(calc.litige, 12 * PRIX_CONTACT_MANQUANT)
    assert.equal(calc.calculSuspendu, false)
    assert.equal(calc.contactsSource, 'SAMTRACKLY')
  })

  test('site POS complet : la retenue s\'applique normalement', () => {
    const calc = calculerLitigeContact(POINT, 12, info())
    assert.equal(calc.ecart, 8)
    assert.equal(calc.litige, 8 * PRIX_CONTACT_MANQUANT)
    assert.equal(calc.calculSuspendu, false)
  })

  test('site POS sans compteur : 0 FCFA, motif affiché — le faux litige à 100 %', () => {
    const calc = calculerLitigeContact(POINT, 0, info({ disponible: false }))
    assert.equal(calc.litigeCalcule, 0)
    assert.equal(calc.litige, 0)
    assert.equal(calc.calculSuspendu, true)
    assert.match(calc.motifSuspension, /Calcul suspendu/)
  })

  test('site POS partiel : 0 FCFA tant que tous les shifts ne sont pas remontés', () => {
    const calc = calculerLitigeContact(POINT, 12, info({ incomplet: true, shiftsSansDonnee: 1 }))
    assert.equal(calc.litige, 0)
    assert.equal(calc.calculSuspendu, true)
    assert.equal(calc.shiftsSansContact, 1)
  })

  test('site POS à 0 contact réellement transmis : la retenue s\'applique', () => {
    // 0 reçu ≠ 0 inconnu : ici le POS a compté, personne n'a pris de contact.
    const calc = calculerLitigeContact(POINT, 0, info())
    assert.equal(calc.calculSuspendu, false)
    assert.equal(calc.litige, 20 * PRIX_CONTACT_MANQUANT)
  })

  test('sous le seuil de 20 % : toujours aucune retenue', () => {
    const calc = calculerLitigeContact(POINT, 17, info())
    assert.equal(calc.taux, 15)
    assert.equal(calc.litige, 0)
  })

  test('surplus de contacts : jamais de litige', () => {
    assert.equal(calculerLitigeContact(POINT, 25, info()).litige, 0)
  })

  test('montant forcé par un manager : survit à la suspension', () => {
    const calc = calculerLitigeContact(
      { ...POINT, contact_litige_override: 3000 }, 0, info({ disponible: false })
    )
    assert.equal(calc.litigeCalcule, 0)
    assert.equal(calc.litige, 3000)
    assert.equal(calc.forceParManager, true)
  })
})

describe('bout en bout — le cas Angré 7E du 17 au 25 août 2026', () => {
  // Le gérant déclare ses commandes, `commandes` est vide, le POS n'envoie
  // pas encore ses compteurs. Avant correctif : 22 × 500 = 11 000 FCFA retenus.
  const point = { yango_nb_commandes: 21, glovo_nb_commandes: 1 }
  const shiftsNonSynchro = [shift(null), shift(null), shift(null)]

  test('avant remontée des compteurs : aucune retenue', () => {
    const info = choisirNombreContacts({
      sourcePoint: 'POS', shifts: shiftsNonSynchro, contactsSamtrackly: 0,
    })
    const calc = calculerLitigeContact(point, info.nombre, info)
    assert.equal(calc.litige, 0)
    assert.equal(calc.contactsDisponibles, false)
  })

  test('après remontée : 18 contacts sur 22 → 18,2 % manquants, sous le seuil, rien retenu', () => {
    const info = choisirNombreContacts({
      sourcePoint: 'POS', shifts: [shift(8), shift(6), shift(4)], contactsSamtrackly: 0,
    })
    const calc = calculerLitigeContact(point, info.nombre, info)
    assert.equal(calc.nbContacts, 18)
    assert.equal(calc.ecart, 4)
    assert.equal(calc.taux, 18.2)
    assert.equal(calc.litige, 0)      // 18,2 % ≤ 20 % : tolérance inchangée
  })

  test('après remontée : 16 contacts sur 22 → 27,3 %, retenue de 6 contacts', () => {
    const info = choisirNombreContacts({
      sourcePoint: 'POS', shifts: [shift(8), shift(5), shift(3)], contactsSamtrackly: 0,
    })
    const calc = calculerLitigeContact(point, info.nombre, info)
    assert.equal(calc.nbContacts, 16)
    assert.equal(calc.litige, 6 * PRIX_CONTACT_MANQUANT)
  })
})
