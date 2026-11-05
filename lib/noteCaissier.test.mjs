// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/noteCaissier.js — la note sur 20 des caissiers.
// Les garde-fous sont testés en premier : ce sont eux qui évitent qu'un
// caissier se sente lésé (pas de note sans assez de shifts, critère neutre
// quand il ne s'applique pas, écart justifié = pas une faute, tolérance).
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  BAREME, MIN_SHIFTS, appreciation, bonusVentes, calculerNotes, critereCaisse, critereClients, critereContacts,
  critereInventaire, criterePresence, normaliserNom, noteSur20,
} from './noteCaissier.js'

const shift = (o = {}) => ({ id: Math.random().toString(36).slice(2), point_id: 'p1', date: '2026-10-01', caissier_id: 'c1', caissier_nom: 'Awa', restaurant_id: 'r1', ecart_pos: 0, pos_nb_yango: 0, pos_nb_glovo: 0, pos_nb_contacts: 0, ...o })

test('le barème fait 20 points, plus 1 de bonus', () => {
  assert.equal(BAREME.caisse + BAREME.contacts + BAREME.inventaire + BAREME.clients + BAREME.presence, 20)
  assert.equal(BAREME.bonus, 1)
})

describe('justesse de la caisse', () => {
  test('tolérance : un manquant de 500 F n’est pas une faute, 501 F oui', () => {
    const s = [...Array(8)].map(() => shift()).concat([shift({ ecart_pos: -500 }), shift({ ecart_pos: -501 })])
    const c = critereCaisse(s)
    assert.equal(c.manquants.length, 1)
    assert.equal(c.mesures, 10)
  })

  test('un surplus de plus de 500 F est une erreur de caisse, comme un manquant', () => {
    const s = [...Array(5)].map(() => shift()).concat([...Array(5)].map(() => shift({ ecart_pos: 5000 })))
    const c = critereCaisse(s)
    assert.equal(c.surplus.length, 5)
    assert.equal(c.manquants.length, 0)
    assert.equal(c.points, 3.5)
    assert.match(c.resume, /5 shifts justes sur 10/)
  })

  test('tolérance : un surplus de 500 F n’est pas une faute, 501 F oui', () => {
    const s = [...Array(8)].map(() => shift()).concat([shift({ ecart_pos: 500 }), shift({ ecart_pos: 501 })])
    const c = critereCaisse(s)
    assert.equal(c.surplus.length, 1)
    assert.equal(c.surplus[0].montant, 501)
  })

  test('un surplus ne rattrape pas le manquant d’un autre shift', () => {
    const s = [...Array(8)].map(() => shift()).concat([shift({ ecart_pos: 3000 }), shift({ ecart_pos: -3000 })])
    const c = critereCaisse(s)
    assert.equal(c.surplus.length, 1)
    assert.equal(c.manquants.length, 1)
    assert.match(c.resume, /8 shifts justes sur 10/)
  })

  test('un surplus justifié dans Vérification ne compte pas', () => {
    const s = [...Array(5)].map(() => shift()).concat([shift({ id: 'y', ecart_pos: 3000 })])
    const c = critereCaisse(s, [{ source: 'verification_pos', point_id: 'p1', shift_id: 'y', decision: 'justifiee', montant: 3000 }])
    assert.equal(c.surplus.length, 0)
    assert.equal(c.points, BAREME.caisse)
  })

  test('le conseil nomme les surplus et ne les additionne pas aux manquants', () => {
    const s = [...Array(8)].map(() => shift()).concat([shift({ ecart_pos: 2000 }), shift({ ecart_pos: -1000 })])
    const { conseil } = critereCaisse(s)
    assert.match(conseil, /1 manquant de plus de 500 F, pour 1\s000 F/)
    assert.match(conseil, /1 surplus de plus de 500 F, pour 2\s000 F/)
  })

  test('caisse toujours juste : le conseil félicite', () => {
    const c = critereCaisse([...Array(6)].map(() => shift()))
    assert.equal(c.points, BAREME.caisse)
    assert.doesNotMatch(c.conseil, /manquant|surplus/i)
  })

  test('un manquant justifié dans Vérification ne compte pas', () => {
    const s = [...Array(5)].map(() => shift()).concat([shift({ id: 'x', ecart_pos: -3000 })])
    const sansDecision = critereCaisse(s)
    const avecDecision = critereCaisse(s, [{ source: 'verification_pos', point_id: 'p1', shift_id: 'x', decision: 'justifiee', montant: 3000 }])
    assert.equal(sansDecision.manquants.length, 1)
    assert.equal(avecDecision.manquants.length, 0)
    assert.equal(avecDecision.points, BAREME.caisse)
  })

  test('moins de 5 shifts mesurés : critère neutre', () => {
    const c = critereCaisse([shift(), shift({ ecart_pos: null }), shift({ ecart_pos: -9000 })])
    assert.equal(c.applicable, false)
  })
})

describe('numéros des clients', () => {
  test('paliers', () => {
    const avec = (contacts, livraisons) => critereContacts([shift({ pos_nb_yango: livraisons, pos_nb_contacts: contacts })]).points
    assert.equal(avec(95, 100), 4)
    assert.equal(avec(90, 100), 3.5)
    assert.equal(avec(84, 100), 3)
    assert.equal(avec(72, 100), 2)
    assert.equal(avec(25, 100), 0)
  })
  test('pas de livraison (À la Braise) : neutre, jamais pénalisé', () => {
    assert.equal(critereContacts([shift(), shift()]).applicable, false)
  })
})

test('inventaire : paliers par shift', () => {
  assert.equal(critereInventaire({ nbShifts: 10, montantInventaire: 0 }).points, 4)
  assert.equal(critereInventaire({ nbShifts: 10, montantInventaire: 6000 }).points, 3)
  assert.equal(critereInventaire({ nbShifts: 10, montantInventaire: 15000 }).points, 2)
  assert.equal(critereInventaire({ nbShifts: 10, montantInventaire: 30000 }).points, 1)
  assert.equal(critereInventaire({ nbShifts: 25, montantInventaire: 1_041_305 }).points, 0)
})

test('clients : incidents ramenés à 20 shifts, bon avis en bonus', () => {
  assert.equal(critereClients({ nbShifts: 20, incidents: [] }).points, 3)
  assert.equal(critereClients({ nbShifts: 20, incidents: [{}] }).points, 2)
  assert.equal(critereClients({ nbShifts: 10, incidents: [{}] }).points, 1) // 2 pour 20 shifts
  assert.equal(critereClients({ nbShifts: 20, incidents: [{}], bonsAvis: 2 }).points, 3)
})

test('présence : -0,5 par absence non justifiée, neutre sans fiche', () => {
  assert.equal(criterePresence({ connu: true, absences: 0 }).points, 2)
  assert.equal(criterePresence({ connu: true, absences: 3 }).points, 0.5)
  assert.equal(criterePresence({ connu: true, absences: 9 }).points, 0)
  assert.equal(criterePresence({ connu: false }).applicable, false)
})

test('bonus ventes : jamais de pénalité', () => {
  assert.equal(bonusVentes({ nbCommandes: 100, ticket: 4400, ticketRestaurant: 4000 }).points, 1)
  assert.equal(bonusVentes({ nbCommandes: 100, ticket: 4250, ticketRestaurant: 4000 }).points, 0.5)
  assert.equal(bonusVentes({ nbCommandes: 100, ticket: 3000, ticketRestaurant: 4000 }).points, 0)
  assert.equal(bonusVentes({ nbCommandes: 10, ticket: 9000, ticketRestaurant: 4000 }).applicable, false)
})

test('noteSur20 : un critère neutre redistribue ses points, plafond 20', () => {
  const plein = [{ applicable: true, max: 7, points: 7 }, { applicable: false, max: 4, points: 0 }, { applicable: true, max: 9, points: 9 }]
  assert.equal(noteSur20(plein, { points: 1 }), 20)
  const moitie = [{ applicable: true, max: 10, points: 5 }, { applicable: true, max: 10, points: 5 }]
  assert.equal(noteSur20(moitie, { points: 0 }), 10)
  assert.equal(noteSur20([{ applicable: false, max: 7, points: 0 }]), null)
})

test('normaliserNom rapproche les saisies', () => {
  assert.equal(normaliserNom('  Gnapi  Bénédicte '), 'gnapi benedicte')
  assert.equal(normaliserNom('N’Guessan Marcel'), normaliserNom("n'guessan  marcel"))
})

describe('calculerNotes', () => {
  test(`moins de ${MIN_SHIFTS} shifts : pas encore noté`, () => {
    const notes = calculerNotes({ shifts: [shift(), shift()], utilisateurs: [{ id: 'c1', nom: 'Awa' }] })
    assert.equal(notes[0].note, null)
    assert.equal(appreciation(notes[0].note).mot, 'Pas encore noté')
  })

  test('un caissier sans faute a 20/20, quel que soit le volume de ventes', () => {
    const s = [...Array(10)].map(() => shift({ vente_shift: 50_000, pos_nb_yango: 3, pos_nb_contacts: 3 }))
    const notes = calculerNotes({ shifts: s, utilisateurs: [{ id: 'c1', nom: 'Awa', travailleur_id: 't1' }] })
    assert.equal(notes[0].note, 20)
  })

  test('les incidents saisis au nom (sans id) sont bien rattachés', () => {
    const s = [...Array(10)].map(() => shift())
    const notes = calculerNotes({
      shifts: s, utilisateurs: [{ id: 'c1', nom: 'Awa Koné', travailleur_id: 't1' }],
      incidents: [{ responsable_nom: 'awa  koné', nature: 'mauvais avis' }, { responsable_nom: 'Autre', nature: 'yango' }],
      absences: [{ travailleur_id: 't1' }, { travailleur_id: 't2' }],
    })
    const clients = notes[0].criteres.find(c => c.cle === 'clients')
    const presence = notes[0].criteres.find(c => c.cle === 'presence')
    assert.equal(clients.incidents.length, 1)
    assert.equal(presence.absences, 1)
  })

  test('bonus : ticket moyen comparé à celui de son restaurant, par service de caisse', () => {
    const a = [...Array(10)].map((_, i) => shift({ pos_service_id: `a${i}` }))
    const b = [...Array(10)].map((_, i) => shift({ caissier_id: 'c2', caissier_nom: 'Ben', pos_service_id: `b${i}` }))
    const ventesParService = {}
    a.forEach(x => { ventesParService[x.pos_service_id] = { nb: 10, ca: 50_000 } })   // ticket 5 000
    b.forEach(x => { ventesParService[x.pos_service_id] = { nb: 10, ca: 30_000 } })   // ticket 3 000
    const notes = calculerNotes({ shifts: [...a, ...b], ventesParService,
      utilisateurs: [{ id: 'c1', nom: 'Awa', travailleur_id: 't1' }, { id: 'c2', nom: 'Ben', travailleur_id: 't2' }] })
    const awa = notes.find(x => x.id === 'c1'), ben = notes.find(x => x.id === 'c2')
    assert.equal(awa.bonus.points, 1)    // 5 000 contre 4 000 de moyenne : +25 %
    assert.equal(ben.bonus.points, 0)    // en dessous : aucun bonus, jamais de pénalité
    assert.equal(ben.note, 20)
  })

  test('shifts POS sans compte : rattachés seulement sans ambiguïté', () => {
    const users = [
      { id: 'g', nom: 'Gahie Constant ', restaurant_id: 'lavage' },
      { id: 'm', nom: 'Milogo Linda', restaurant_id: 'maroc' },
      { id: 'f', nom: 'Flora ', restaurant_id: '7e' },
    ]
    const s = [
      shift({ caissier_id: 'g', caissier_nom: 'Gahie Constant ', restaurant_id: 'lavage' }),
      shift({ caissier_id: null, caissier_nom: 'GAHIE CONSTANT', restaurant_id: 'lavage' }),
      shift({ caissier_id: null, caissier_nom: 'MILOGO BRAKISSA LINDA', restaurant_id: 'maroc' }),
      shift({ caissier_id: null, caissier_nom: 'ZAN LOU MARLENE FLORA', restaurant_id: 'palmeraie' }),
    ]
    const notes = calculerNotes({ shifts: s, utilisateurs: users })
    const gahie = notes.find(x => x.id === 'g')
    const milogo = notes.find(x => x.id === 'm')
    assert.equal(gahie.nbShifts, 2)                       // même nom exact
    assert.equal(milogo.nbShifts, 1)                      // mots du compte dans le nom POS, même restaurant
    assert.deepEqual(milogo.rapproches, ['MILOGO BRAKISSA LINDA'])
    assert.equal(notes.find(x => x.id === 'f'), undefined) // Flora du 7E : jamais rattachée à la Palmeraie
    assert.ok(notes.some(x => x.id === null && x.nom === 'ZAN LOU MARLENE FLORA'))
  })
})
