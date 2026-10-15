import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { lignesNotesPOS } from './notesPOS.js'

const critere = (cle, points, max) => ({ cle, points, max, applicable: true, resume: 'r', conseil: null, manquants: [{ date: 'x' }] })
const NOTE = {
  cle: 'id:st-awa', id: 'st-awa', nom: 'Awa', nbShifts: 12, note: 15.5, idsPos: [],
  criteres: [critere('caisse', 6, 7), critere('contacts', 4, 4)], bonus: { cle: 'bonus', points: 0.5, max: 1, applicable: true },
}
const SITE = [
  { id: 'pos-awa-7e', restaurant_id: 'r-7e', externe_id: 'T-12', actif: true },
  { id: 'pos-awa-yop', restaurant_id: 'r-yop', externe_id: 'T-12', actif: true },
  { id: 'pos-autre', restaurant_id: 'r-7e', externe_id: 'T-99', actif: true },
]
const USERS = [{ id: 'st-awa', travailleur_id: 'T-12' }]
const periodes = { debut: '2026-09-16', fin: '2026-10-15' }

describe('Note des caissiers → lignes POS', () => {
  test('une ligne par compte POS de la personne, sur chaque site', () => {
    const l = lignesNotesPOS({ notes: [NOTE], utilisateurs: USERS, utilisateursSite: SITE, periodes })
    assert.deepEqual(l.map(x => `${x.restaurant_id}:${x.id}`).sort(), ['r-7e:pos-awa-7e', 'r-yop:pos-awa-yop'])
    assert.equal(l[0].note, 15.5)
    assert.equal(l[0].appreciation, 'Très bien')
    assert.equal(l[0].min_shifts, 8)
    assert.equal(l[0].periode_fin, '2026-10-15')
  })

  test('les critères partent sans les listes nominatives', () => {
    const [l] = lignesNotesPOS({ notes: [NOTE], utilisateurs: USERS, utilisateursSite: SITE.slice(0, 1), periodes })
    assert.deepEqual(Object.keys(l.criteres[0]).sort(), ['applicable', 'cle', 'conseil', 'max', 'points', 'resume'])
  })

  test('la note précédente donne la flèche de progression', () => {
    const [l] = lignesNotesPOS({ notes: [NOTE], notesPrec: [{ cle: 'id:st-awa', note: 14 }], utilisateurs: USERS, utilisateursSite: SITE.slice(0, 1), periodes })
    assert.equal(l.note_precedente, 14)
  })

  test('sans fiche reliée, le compte est retrouvé par les services tenus au POS', () => {
    const sansFiche = { ...NOTE, cle: 'nom:flora', id: null, idsPos: ['pos-autre'] }
    const l = lignesNotesPOS({ notes: [sansFiche], utilisateurs: USERS, utilisateursSite: SITE, periodes })
    assert.deepEqual(l.map(x => x.id), ['pos-autre'])
  })

  test('pas encore assez de shifts : la ligne part quand même, note vide', () => {
    const [l] = lignesNotesPOS({ notes: [{ ...NOTE, note: null, nbShifts: 3 }], utilisateurs: USERS, utilisateursSite: SITE.slice(0, 1), periodes })
    assert.equal(l.note, null)
    assert.equal(l.nb_shifts, 3)
    assert.equal(l.appreciation, 'Pas encore noté')
  })

  test('deux fiches sur le même compte : celle qui a le plus de shifts gagne', () => {
    const petite = { ...NOTE, cle: 'nom:awa', id: null, nbShifts: 2, note: null, idsPos: ['pos-awa-7e'] }
    const l = lignesNotesPOS({ notes: [petite, NOTE], utilisateurs: USERS, utilisateursSite: SITE.slice(0, 1), periodes })
    assert.equal(l.length, 1)
    assert.equal(l[0].note, 15.5)
  })

  test('un compte POS désactivé ne reçoit rien', () => {
    const l = lignesNotesPOS({ notes: [NOTE], utilisateurs: USERS, utilisateursSite: [{ ...SITE[0], actif: false }], periodes })
    assert.equal(l.length, 0)
  })
})
