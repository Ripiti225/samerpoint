// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/sourcePoint.js — qui alimente le point d'un restaurant.
//
// Ce module est le point de décision UNIQUE entre « ce site fait son point dans
// Samtrackly » et « le point de ce site arrive du POS ». Se tromper ici, c'est
// soit empêcher des caissières de travailler, soit compter une journée deux fois.
// D'où des tests, dans un dépôt qui n'en avait aucun.
//
//   npm test
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { estSurPOS, separerComptesPOS, estRempliParLePOS, peutSaisirVenteMachineManuellement, venteMachineEstRecue } from './sourcePoint.js'

// L'équipe réelle d'Angré 7E, telle qu'elle est en base.
const EQUIPE = [
  { id: '1', nom: 'Aminata', role: 'gerant' },
  { id: '2', nom: 'Marie-Paule', role: 'caissier' },
  { id: '3', nom: 'Hilary Sea', role: 'caissier' },
  { id: '4', nom: 'Flora', role: 'caissier' },
]

describe('estSurPOS — le drapeau de bascule', () => {

  test('un site explicitement marqué POS est basculé', () => {
    assert.equal(estSurPOS({ source_point: 'POS' }), true)
  })

  test('un site marqué SAMTRACKLY ne l’est pas', () => {
    assert.equal(estSurPOS({ source_point: 'SAMTRACKLY' }), false)
  })

  // ── Le sens du repli. C'est le cœur du module. ──
  // Verrouiller par erreur un site SANS POS empêche ses caissières de
  // travailler le soir même, et personne sur place ne peut rien y faire.
  // Laisser la saisie ouverte par erreur sur un site AVEC POS crée au pire un
  // doublon, visible et corrigeable. La panne bénigne est toujours du même côté.

  test('la colonne absente ne bascule pas le site', () => {
    // Cas réel : la migration supabase_pos_bascule.sql pas encore passée.
    assert.equal(estSurPOS({ nom: 'Samer Oasis ' }), false)
  })

  test('une valeur nulle ne bascule pas le site', () => {
    assert.equal(estSurPOS({ source_point: null }), false)
  })

  test('une valeur inattendue ne bascule pas le site', () => {
    // Quelqu'un écrit 'Pos-Samer' à la main dans Supabase : on ne devine pas.
    assert.equal(estSurPOS({ source_point: 'Pos-Samer' }), false)
  })

  test('un restaurant introuvable ne bascule pas', () => {
    // Cas réel : appareil hors ligne qui n'a jamais vu ce site.
    assert.equal(estSurPOS(null), false)
    assert.equal(estSurPOS(undefined), false)
  })

  test('la casse et les espaces ne changent pas la décision', () => {
    // Les noms de restaurants en base portent des espaces finales ; on ne
    // laissera pas un espace décider si des caissières peuvent travailler.
    assert.equal(estSurPOS({ source_point: ' pos ' }), true)
    assert.equal(estSurPOS({ source_point: 'Pos' }), true)
  })
})

describe('separerComptesPOS — masquer les comptes caissiers', () => {

  test('sur un site basculé, les caissières sortent de la liste', () => {
    const { visibles } = separerComptesPOS({ source_point: 'POS' }, EQUIPE)
    assert.deepEqual(visibles.map(u => u.nom), ['Aminata'])
  })

  test('sur un site basculé, les comptes masqués sont rendus à l’appelant', () => {
    // L'écran s'en sert pour EXPLIQUER l'absence : un compte qui disparaît sans
    // un mot déclenche un appel au support.
    const { reprisParLePOS } = separerComptesPOS({ source_point: 'POS' }, EQUIPE)
    assert.deepEqual(reprisParLePOS.map(u => u.nom), ['Marie-Paule', 'Hilary Sea', 'Flora'])
  })

  test('sur un site non basculé, personne n’est masqué', () => {
    const { visibles, reprisParLePOS } = separerComptesPOS({ source_point: 'SAMTRACKLY' }, EQUIPE)
    assert.equal(visibles.length, 4)
    assert.deepEqual(reprisParLePOS, [])
  })

  test('la casse du rôle ne change pas la décision', () => {
    const equipe = [{ id: '9', nom: 'Test', role: 'Caissier' }]
    const { visibles } = separerComptesPOS({ source_point: 'POS' }, equipe)
    assert.deepEqual(visibles, [])
  })

  test('une liste absente ou vide ne fait pas tomber l’écran de connexion', () => {
    assert.deepEqual(separerComptesPOS({ source_point: 'POS' }, null).visibles, [])
    assert.deepEqual(separerComptesPOS(null, undefined).visibles, [])
  })
})

describe('estRempliParLePOS — les cases grisées du gérant', () => {

  test('la vente machine est en lecture seule sur un site basculé', () => {
    assert.equal(estRempliParLePOS({ source_point: 'POS' }, 'vente_machine'), true)
  })

  test('elle reste saisissable sur un site non basculé', () => {
    assert.equal(estRempliParLePOS({ source_point: 'SAMTRACKLY' }, 'vente_machine'), false)
  })

  test('le nombre de commandes Yango reste saisissable même sur un site basculé', () => {
    // Décision du 2026-08-17 : le gérant garde sa saisie prise dans l'app
    // partenaire. L'écart avec le compte du POS est un contrôle croisé voulu.
    assert.equal(estRempliParLePOS({ source_point: 'POS' }, 'yango_nb_commandes'), false)
  })
})

describe('peutSaisirVenteMachineManuellement — secours en cas de panne POS', () => {
  const POS = { source_point: 'POS' }

  test('autorise le secours seulement quand la vente POS manque et le point est ouvert', () => {
    assert.equal(peutSaisirVenteMachineManuellement(POS, '', false), true)
    assert.equal(peutSaisirVenteMachineManuellement(POS, null, false), true)
  })

  test('refuse le secours dès que le POS a fourni une valeur, même zéro', () => {
    assert.equal(peutSaisirVenteMachineManuellement(POS, '125000', false), false)
    assert.equal(peutSaisirVenteMachineManuellement(POS, 0, false), false)
  })

  test('refuse toute saisie de secours sur un point déjà validé', () => {
    assert.equal(peutSaisirVenteMachineManuellement(POS, '', true), false)
  })

  test('un site Samtrackly conserve son flux normal, pas le mode secours POS', () => {
    assert.equal(peutSaisirVenteMachineManuellement({ source_point: 'SAMTRACKLY' }, '', false), false)
  })
})

describe('venteMachineEstRecue — reçue du POS ou pas encore reçue', () => {
  // Le bug d'origine : `ventesJour.venteMachine ? ... : 'en attente du POS'`.
  // Un test de vérité range 0 et '0' du côté de l'absence, donc une journée
  // réellement transmise à 0 FCFA restait « en attente » pour toujours.
  test('rien reçu : chaîne vide, null, undefined', () => {
    assert.equal(venteMachineEstRecue(''), false)
    assert.equal(venteMachineEstRecue(null), false)
    assert.equal(venteMachineEstRecue(undefined), false)
  })

  test('reçue : zéro est une mesure, pas une absence', () => {
    assert.equal(venteMachineEstRecue(0), true)
    assert.equal(venteMachineEstRecue('0'), true)
  })

  test('reçue : une vente ordinaire, nombre ou chaîne', () => {
    assert.equal(venteMachineEstRecue(348500), true)
    assert.equal(venteMachineEstRecue('348500'), true)
  })
})

describe('secours manuel et vente reçue — une seule et même frontière', () => {
  const POS = { source_point: 'POS' }

  test('le secours s\'ouvre exactement quand la vente n\'est pas reçue', () => {
    for (const v of ['', null, undefined]) {
      assert.equal(venteMachineEstRecue(v), false)
      assert.equal(peutSaisirVenteMachineManuellement(POS, v, false), true)
    }
    for (const v of [0, '0', 348500, '348500']) {
      assert.equal(venteMachineEstRecue(v), true)
      assert.equal(peutSaisirVenteMachineManuellement(POS, v, false), false)
    }
  })

  test('point validé : plus de secours, même sans vente reçue', () => {
    assert.equal(peutSaisirVenteMachineManuellement(POS, '', true), false)
  })
})

describe('EQUIPE — garde-fou de fixture', () => {
  test('la fixture contient bien trois caissières et une gérante', () => {
    assert.equal(EQUIPE.filter(u => u.role === 'caissier').length, 3)
    assert.equal(EQUIPE.filter(u => u.role !== 'caissier').length, 1)
  })
})
