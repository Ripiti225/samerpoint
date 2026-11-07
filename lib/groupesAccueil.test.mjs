// Tests de lib/groupesAccueil.js — regroupement des tuiles de l'accueil manager.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  FAVORIS_ADMIN, GROUPES_ADMIN, GROUPES_GERANT, ICONES_TUILES, couleursGroupe, etatPointsDuJour, groupeDeRoute, messagesTresorerie,
  nbAVerifier, nomCourtResto,
  organiserAccueil, organiserAccueilAdmin,
} from './groupesAccueil.js'

// Les id admin du catalogue, lus dans lib/menus.js (qui ne se charge pas sous node).
const idsAdmin = [...fs.readFileSync(new URL('./menus.js', import.meta.url), 'utf8')
  .matchAll(/\{ id: '([^']+)'[^\n]*admin: true/g)].map(m => m[1])

describe('accueil manager', () => {
  test('chaque tuile admin du catalogue est rangée dans exactement un groupe', () => {
    assert.ok(idsAdmin.length >= 20)
    for (const id of idsAdmin) {
      assert.equal(GROUPES_ADMIN.filter(g => g.tuiles.includes(id)).length, 1, id)
    }
  })
  test('les favoris existent dans le catalogue', () => {
    for (const id of FAVORIS_ADMIN) assert.ok(idsAdmin.includes(id), id)
  })
  test('favoris d\'abord, groupes vides retirés, tuile inconnue dans « Autres »', () => {
    const r = organiserAccueilAdmin([{ id: 'journal' }, { id: 'tresorerie' }, { id: 'nouvelle' }])
    assert.deepEqual(r.favoris.map(t => t.id), ['tresorerie'])
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(t => t.id)]), [['tresorerie', ['tresorerie']], ['administration', ['journal']]])
    assert.deepEqual(r.autres.map(t => t.id), ['nouvelle'])
  })
})

describe('icônes et points du jour', () => {
  test('chaque tuile admin a son icône vectorielle', () => {
    for (const id of idsAdmin) assert.ok(ICONES_TUILES[id], id)
  })
  test('noms courts des restaurants', () => {
    assert.deepEqual(['Samer Palmeraie', 'Al Kayan KMS', 'À la Braise', 'Samer Angré 7E'].map(nomCourtResto),
      ['Palmeraie', 'KMS', 'Braise', 'Angré 7E'])
  })
  test('état des points d\'une journée : vérifié, à vérifier, en attente', () => {
    const restaurants = [{ id: 'k', nom: 'Al Kayan KMS' }, { id: 'p', nom: 'Samer Palmeraie' }, { id: 'b', nom: 'À la Braise' }]
    const points = [
      { restaurant_id: 'k', date: '2026-10-02', valide: true, verifie: true },
      { restaurant_id: 'p', date: '2026-10-02', valide: true, verifie: false },
      { restaurant_id: 'b', date: '2026-10-01', valide: true, verifie: true },
    ]
    const e = etatPointsDuJour({ points, restaurants, date: '2026-10-02' })
    assert.deepEqual(e.lignes.map(l => [l.nom, l.statut]), [['Braise', 'en_attente'], ['KMS', 'verifie'], ['Palmeraie', 'a_verifier']])
    assert.deepEqual([e.valides, e.total], [2, 3])
    assert.equal(nbAVerifier(points), 1)
  })
})

describe('messages Trésorerie du bandeau', () => {
  const du = (id, echeance, montant_du = 1000, categorie = 'loyer') => ({ id, categorie, restaurant_id: 'r', echeance, montant_du })
  const base = { aujourdhui: '2026-10-10', demain: '2026-10-11', hier: '2026-10-09' }
  test('échéances du jour et de demain, non soldées, avec le reste', () => {
    const m = messagesTresorerie({
      ...base,
      dus: [du('a', '2026-10-10', 700000), du('b', '2026-10-10', 2000000), du('c', '2026-10-11', 500000), du('d', '2026-10-10', 300, 'autre')],
      paiements: [{ du_id: 'b', montant: 2000000 }, { du_id: 'a', montant: 100000 }],
    })
    assert.deepEqual(m.aujourdhui, { n: 1, total: 600000 })
    assert.deepEqual(m.demain, { n: 1, total: 500000 })
  })
  test('passées en dette ce matin : date limite d\'hier, pas soldées', () => {
    const m = messagesTresorerie({ ...base, dus: [du('h', '2026-10-09', 900000), du('h2', '2026-10-09', 50)], paiements: [{ du_id: 'h2', montant: 50 }] })
    assert.deepEqual(m.detteCeMatin, { n: 1, total: 900000 })
  })
  test('emprunts au coffre à rembourser', () => {
    const m = messagesTresorerie({ ...base, emprunts: [
      { id: 'e', montant: 300000, rembourser_le: '2026-10-10', created_at: '2026-10-01T00:00:00Z' },
      { id: 'f', montant: 100000, rembourser_le: '2026-10-20', created_at: '2026-10-01T00:00:00Z' },
    ] })
    assert.deepEqual(m.coffre, { n: 1, total: 300000 })
  })
})

describe('couleur des écrans selon leur groupe', () => {
  test('écrans de la Trésorerie, sous-écrans et crédits fournisseurs', () => {
    for (const r of ['/tresorerie', '/tresorerie-a-payer?onglet=loyer', '/tresorerie-restaurant', '/credits-fournisseurs']) {
      assert.equal(groupeDeRoute(r)?.id, 'tresorerie', r)
    }
  })
  test('un groupe pas encore activé garde les couleurs habituelles', () => {
    assert.equal(groupeDeRoute('/equipe'), null)
    assert.equal(groupeDeRoute('/equipe', ['personnel'])?.id, 'personnel')
    assert.equal(groupeDeRoute('/verification')?.id, 'controle')
    assert.equal(groupeDeRoute('/accueil'), null)
  })
  test('couleurs : foncé en clair (texte blanc lisible), vif en sombre', () => {
    const g = GROUPES_ADMIN[0]
    assert.equal(couleursGroupe(g, false).primary, g.fonce)
    assert.equal(couleursGroupe(g, true).primary, g.couleur)
    assert.equal(couleursGroupe(g, false).headerBg, g.fonce)
  })
})

describe('organiserAccueil — gérant', () => {
  const t = ids => ids.map(id => ({ id }))
  test('Nouveau travailleur rangé dans le bandeau Équipe du gérant', () => {
    const r = organiserAccueil(t(['demandes', 'recrutement']), 'gerant')
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(x => x.id)]), [['equipe', ['recrutement', 'demandes']]])
    assert.deepEqual(r.autres, [])
  })
  test('Stats caissiers rangée dans le bandeau Équipe du gérant', () => {
    const r = organiserAccueil(t(['stats-caissiers', 'demandes']), 'gerant')
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(x => x.id)]), [['equipe', ['demandes', 'stats-caissiers']]])
  })
  test('accès directs dans l’ordre, seulement ceux de sa liste', () => {
    const r = organiserAccueil(t(['point-caissier', 'contacts', 'ventes']), 'gerant')
    assert.deepEqual(r.favoris.map(x => x.id), ['ventes', 'point-caissier'])
  })
  test('bandeaux dans l’ordre, vides retirés, écran inconnu dans « Autres »', () => {
    const r = organiserAccueil(t(['documents', 'contacts', 'ventes', 'demandes', 'nouvel-ecran']), 'gerant')
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(x => x.id)]), [
      ['journee', ['ventes']], ['equipe', ['demandes', 'documents']], ['clients', ['contacts']],
    ])
    assert.deepEqual(r.autres.map(x => x.id), ['nouvel-ecran'])
  })
  test('le manager garde sa configuration', () => {
    assert.deepEqual(organiserAccueil(t(['tresorerie']), 'manager').favoris.map(x => x.id), ['tresorerie'])
  })
})

test('messagesTresorerie ignore les charges administratives', () => {
  const m = messagesTresorerie({
    dus: [{ id: 'c', categorie: 'cnps', echeance: '2026-10-15', montant_du: 1000 }],
    paiements: [], emprunts: [], receptions: [], aujourdhui: '2026-10-15', demain: '2026-10-16', hier: '2026-10-14',
  })
  assert.equal(m.aujourdhui.n, 0)
})

test('tuile Événements : dans Personnel, dans Équipe du gérant, avec son icône', () => {
  assert.ok(GROUPES_ADMIN.find(g => g.id === 'personnel').tuiles.includes('evenements'))
  assert.ok(GROUPES_GERANT.find(g => g.id === 'equipe').tuiles.includes('evenements'))
  assert.equal(ICONES_TUILES.evenements, 'party-popper')
  assert.ok(idsAdmin.includes('evenements'))
})
