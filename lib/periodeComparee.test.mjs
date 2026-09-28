// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/periodeComparee.js — la période B d'une comparaison.
//
// Tout l'intérêt de la comparaison tient à une propriété : A et B ont la même
// durée. Sans elle, « −21 % » ne mesure plus la performance mais la différence
// de nombre de jours, et les courbes ne peuvent plus se superposer jour contre
// jour. C'est ce qu'on vérifie ici, pas la jolie mise en forme.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  nombreDeJours,
  periodePrecedente,
  estMoisEntier,
  libelleJour,
  libellePeriode,
  libelleDuree,
  bandeauDeuxPeriodes,
  moisCouverts,
} from './periodeComparee.js'

describe('nombreDeJours — bornes incluses', () => {

  test('une journée seule vaut 1 jour, pas 0', () => {
    assert.equal(nombreDeJours('2025-10-25', '2025-10-25'), 1)
  })

  test('du 1er au 25 octobre : 25 jours', () => {
    assert.equal(nombreDeJours('2025-10-01', '2025-10-25'), 25)
  })

  test('un mois de 31 jours en compte 31', () => {
    assert.equal(nombreDeJours('2025-07-01', '2025-07-31'), 31)
  })

  test('février bissextile : 29 jours', () => {
    assert.equal(nombreDeJours('2024-02-01', '2024-02-29'), 29)
  })

  test('bornes inversées ou invalides : null, jamais un nombre négatif', () => {
    assert.equal(nombreDeJours('2025-10-25', '2025-10-01'), null)
    assert.equal(nombreDeJours('', '2025-10-01'), null)
    assert.equal(nombreDeJours('2025-13-01', '2025-13-05'), null)
    assert.equal(nombreDeJours('2025-02-30', '2025-03-02'), null)
    assert.equal(nombreDeJours(null, undefined), null)
  })
})

describe('periodePrecedente — B a exactement la durée de A', () => {

  for (const [debut, fin, duree] of [
    ['2025-10-25', '2025-10-25', 1],
    ['2025-10-19', '2025-10-25', 7],
    ['2025-10-01', '2025-10-25', 25],
    ['2025-07-01', '2025-07-31', 31],
  ]) {
    test(`sur ${duree} jour(s), B en fait ${duree} aussi`, () => {
      const b = periodePrecedente(debut, fin)
      assert.equal(nombreDeJours(b.debut, b.fin), duree)
      assert.equal(b.nbJours, duree)
    })
  }

  test('B se termine la veille du début de A : ni trou ni chevauchement', () => {
    const b = periodePrecedente('2025-10-01', '2025-10-25')
    assert.equal(b.fin, '2025-09-30')
    assert.equal(b.debut, '2025-09-06')
  })

  test('B traverse le changement d’année sans se tromper', () => {
    const b = periodePrecedente('2025-01-01', '2025-01-07')
    assert.deepEqual({ debut: b.debut, fin: b.fin }, { debut: '2024-12-25', fin: '2024-12-31' })
  })

  test('« Mois préc. » comme A donne bien le mois d’avant, jour pour jour', () => {
    // A = septembre entier (30 j) → B = les 30 jours précédents, pas « août ».
    const b = periodePrecedente('2025-09-01', '2025-09-30')
    assert.equal(b.nbJours, 30)
    assert.equal(b.fin, '2025-08-31')
    assert.equal(b.debut, '2025-08-02')
  })

  test('bornes invalides : null, pas une période inventée', () => {
    assert.equal(periodePrecedente('2025-10-25', '2025-10-01'), null)
    assert.equal(periodePrecedente('', ''), null)
  })
})

describe('estMoisEntier — le verdict qui autorise la ligne « Charges fixes »', () => {

  test('du 1er au dernier jour du mois : oui', () => {
    assert.equal(estMoisEntier('2025-10-01', '2025-10-31'), true)
    assert.equal(estMoisEntier('2025-09-01', '2025-09-30'), true)
    assert.equal(estMoisEntier('2024-02-01', '2024-02-29'), true)
    assert.equal(estMoisEntier('2025-02-01', '2025-02-28'), true)
  })

  test('mois tronqué : non — le loyer entier serait imputé à une partie du mois', () => {
    assert.equal(estMoisEntier('2025-10-01', '2025-10-25'), false)
    assert.equal(estMoisEntier('2025-10-02', '2025-10-31'), false)
  })

  test('deux mois à cheval : non', () => {
    assert.equal(estMoisEntier('2025-09-01', '2025-10-31'), false)
  })

  test('bornes invalides : non', () => {
    assert.equal(estMoisEntier('2025-10-31', '2025-10-01'), false)
    assert.equal(estMoisEntier(null, null), false)
  })
})

describe('libellePeriode — les vraies dates, jamais un nom de mois', () => {

  test('dans un même mois, le mois n’est écrit qu’une fois', () => {
    assert.equal(libellePeriode('2025-10-01', '2025-10-25'), '1 → 25 oct. 2025')
  })

  test('deux mois de la même année : les deux mois, une seule année', () => {
    assert.equal(libellePeriode('2025-09-06', '2025-10-05'), '6 sept. → 5 oct. 2025')
  })

  test('à cheval sur deux années : les deux années', () => {
    assert.equal(libellePeriode('2024-12-28', '2025-01-03'), '28 déc. 2024 → 3 janv. 2025')
  })

  test('une seule journée : une seule date', () => {
    assert.equal(libellePeriode('2025-10-25', '2025-10-25'), '25 oct. 2025')
    assert.equal(libelleJour('2025-08-09'), '9 août 2025')
  })

  test('bornes invalides : chaîne vide, pas « Invalid Date »', () => {
    assert.equal(libellePeriode('2025-10-25', '2025-10-01'), '')
    assert.equal(libelleJour('n’importe quoi'), '')
  })
})

describe('libelleDuree — comment B se nomme', () => {

  test('au pluriel, par sa durée', () => {
    assert.equal(libelleDuree(25), 'les 25 jours précédents')
    assert.equal(libelleDuree(7), 'les 7 jours précédents')
  })

  test('un seul jour se dit au singulier', () => {
    assert.equal(libelleDuree(1), 'la journée précédente')
  })

  test('durée absente : chaîne vide', () => {
    assert.equal(libelleDuree(0), '')
    assert.equal(libelleDuree(null), '')
  })
})

describe('bandeauDeuxPeriodes — ce que lit le gérant en tête d’écran', () => {

  test('les deux termes portent la même durée et leurs vraies dates', () => {
    const bandeau = bandeauDeuxPeriodes('2025-10-01', '2025-10-25', 'Ce mois')
    assert.deepEqual(bandeau, {
      a: { titre: 'Ce mois', dates: '1 → 25 oct. 2025', nbJours: 25 },
      b: { titre: 'les 25 jours précédents', dates: '6 → 30 sept. 2025', nbJours: 25 },
    })
  })

  test('B ne s’appelle jamais « Mois précédent »', () => {
    const bandeau = bandeauDeuxPeriodes('2025-10-01', '2025-10-25', 'Ce mois')
    assert.ok(!/mois/i.test(bandeau.b.titre), `titre B trompeur : ${bandeau.b.titre}`)
  })

  test('période invalide : null, l’écran n’affiche pas de comparaison', () => {
    assert.equal(bandeauDeuxPeriodes('', ''), null)
  })
})

describe('moisCouverts — la liste des mois que la période touche', () => {

  test('une période dans un seul mois', () => {
    assert.deepEqual(moisCouverts('2025-10-01', '2025-10-25'), ['2025-10'])
  })

  test('à cheval sur deux mois : les deux', () => {
    assert.deepEqual(moisCouverts('2025-09-26', '2025-10-02'), ['2025-09', '2025-10'])
  })

  test('un mois sans aucun point est quand même listé — sinon son loyer disparaît', () => {
    assert.deepEqual(moisCouverts('2025-08-15', '2025-10-05'), ['2025-08', '2025-09', '2025-10'])
  })

  test('à cheval sur deux années', () => {
    assert.deepEqual(moisCouverts('2024-11-20', '2025-02-03'), ['2024-11', '2024-12', '2025-01', '2025-02'])
  })

  test('bornes invalides : liste vide', () => {
    assert.deepEqual(moisCouverts('2025-10-25', '2025-10-01'), [])
    assert.deepEqual(moisCouverts('', ''), [])
  })
})
