// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/contactsParCaissier.js — « Hilary 5 / 7 ».
//
// Ce que ces tests protègent : la ventilation par caissier ne doit JAMAIS
// transformer une donnée absente en zéro. Afficher « Hilary 0 / 7 » parce que
// le POS n'a pas encore synchronisé, c'est accuser une caissière irréprochable
// — la même erreur que le faux litige d'août 2026 sur Angré 7E.
//
//   node lib/contactsParCaissier.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  detailContactsParCaissier, panierMoyenLivraison, estimerCommandesShift,
  NOM_INCONNU, MIN_JOURS_PANIER, repartirLitigeContacts, totauxLitigeContactsParCaissier,
} from './contactsParCaissier.js'

const NOMS = { u1: 'Hilary Sea', u2: 'Awa K.' }

describe('site Samtrackly — ventilation des lignes commandes', () => {
  const commandes = [
    { caissier_id: 'u1', contact_client: '0700000001' },
    { caissier_id: 'u1', contact_client: '0700000002' },
    { caissier_id: 'u1', contact_client: '' },
    { caissier_id: 'u1', contact_client: null },
    { caissier_id: 'u2', contact_client: '0700000003' },
  ]

  test('compte contacts pris et commandes de chaque caissier', () => {
    const r = detailContactsParCaissier({ sourcePoint: 'SAMTRACKLY', commandes, noms: NOMS })
    assert.equal(r.source, 'SAMTRACKLY')
    assert.deepEqual(
      r.lignes.map(l => `${l.nom} ${l.contacts}/${l.commandes}`),
      ['Hilary Sea 2/4', 'Awa K. 1/1']
    )
  })

  test('un contact fait de blancs ne compte pas', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [{ caissier_id: 'u1', contact_client: '   ' }],
      noms: NOMS,
    })
    assert.equal(r.lignes[0].contacts, 0)
    assert.equal(r.lignes[0].commandes, 1)
  })

  test('commande sans caissier : ligne « non identifié », jamais ignorée', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [{ caissier_id: null, contact_client: '0700000004' }],
      noms: NOMS,
    })
    assert.equal(r.lignes[0].nom, NOM_INCONNU)
    assert.equal(r.sommeCommandes, 1)
  })

  test('sommes utilisables pour comparer au total saisi par le gérant', () => {
    const r = detailContactsParCaissier({ sourcePoint: 'SAMTRACKLY', commandes, noms: NOMS })
    assert.equal(r.sommeContacts, 3)
    assert.equal(r.sommeCommandes, 5)
  })
})

describe('site POS — ventilation des compteurs de shift', () => {
  test('deux shifts de la même caissière sont regroupés', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'POS',
      shifts: [
        { caissier_id: 'u1', caissier_nom: 'Hilary Sea', pos_nb_contacts: 3, pos_nb_yango: 2, pos_nb_glovo: 2 },
        { caissier_id: 'u1', caissier_nom: 'Hilary Sea', pos_nb_contacts: 2, pos_nb_yango: 3, pos_nb_glovo: 0 },
      ],
      noms: NOMS,
    })
    assert.equal(r.lignes.length, 1)
    assert.equal(r.lignes[0].contacts, 5)
    assert.equal(r.lignes[0].commandes, 7)
  })

  test('compteur non transmis : null, surtout pas 0', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'POS',
      shifts: [{ caissier_id: 'u1', pos_nb_contacts: null, pos_nb_yango: null, pos_nb_glovo: null }],
      noms: NOMS,
    })
    assert.equal(r.lignes[0].contacts, null)
    assert.equal(r.lignes[0].commandes, null)
    assert.equal(r.lignes[0].disponible, false)
  })

  test('zéro transmis reste un vrai zéro', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'POS',
      shifts: [{ caissier_id: 'u1', pos_nb_contacts: 0, pos_nb_yango: 4, pos_nb_glovo: 0 }],
      noms: NOMS,
    })
    assert.equal(r.lignes[0].contacts, 0)
    assert.equal(r.lignes[0].commandes, 4)
    assert.equal(r.lignes[0].disponible, true)
  })

  test('nom du shift utilisé quand l\'id est inconnu de la table utilisateurs', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'POS',
      shifts: [{ caissier_id: 'u9', caissier_nom: 'Fatou', pos_nb_contacts: 1, pos_nb_yango: 1 }],
      noms: NOMS,
    })
    assert.equal(r.lignes[0].nom, 'Fatou')
  })

  test('un site POS ignore les lignes commandes (jamais les deux sources)', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'POS',
      shifts: [{ caissier_id: 'u1', pos_nb_contacts: 5, pos_nb_yango: 7 }],
      commandes: [{ caissier_id: 'u2', contact_client: '0700000005' }],
      noms: NOMS,
    })
    assert.equal(r.lignes.length, 1)
    assert.equal(r.sommeContacts, 5)
  })
})

describe('cas limites', () => {
  test('aucune donnée : liste vide, sommes à zéro', () => {
    const r = detailContactsParCaissier({ sourcePoint: 'SAMTRACKLY' })
    assert.deepEqual(r.lignes, [])
    assert.equal(r.sommeContacts, 0)
    assert.equal(r.sommeCommandes, 0)
  })

  test('source inconnue : repli sur Samtrackly, comme partout ailleurs', () => {
    const r = detailContactsParCaissier({
      sourcePoint: undefined,
      commandes: [{ caissier_id: 'u1', contact_client: '0700000006' }],
      noms: NOMS,
    })
    assert.equal(r.source, 'SAMTRACKLY')
    assert.equal(r.lignes[0].contacts, 1)
  })

  test('tri : le plus gros volume de commandes en premier', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [
        { caissier_id: 'u2', contact_client: '07' },
        { caissier_id: 'u1', contact_client: '07' },
        { caissier_id: 'u1', contact_client: '07' },
      ],
      noms: NOMS,
    })
    assert.equal(r.lignes[0].nom, 'Hilary Sea')
  })
})

// ── Estimation sur les sites SANS POS ────────────────────────────────────────
// Ce qu'on ne peut pas savoir : les commandes jamais saisies. Ce qu'on peut
// estimer : l'argent livraison du shift ÷ panier moyen. C'est une alerte, pas
// une preuve — ces tests verrouillent surtout les cas où il faut SE TAIRE.

const jour = (cse, nb) => ({ yango_cse: cse, glovo_cse: 0, yango_nb_commandes: nb, glovo_nb_commandes: 0 })

describe('panierMoyenLivraison', () => {
  test('argent total ÷ commandes totales', () => {
    const r = panierMoyenLivraison([
      jour(10000, 2), jour(20000, 4), jour(15000, 3), jour(5000, 1), jour(10000, 2),
    ])
    assert.equal(r.panier, 5000)
    assert.equal(r.jours, 5)
  })

  test('trop peu de journées : aucun panier, donc aucune estimation', () => {
    const r = panierMoyenLivraison([jour(10000, 2), jour(20000, 4)])
    assert.equal(r.panier, null)
    assert.ok(r.jours < MIN_JOURS_PANIER)
  })

  test('journées sans livraison ou sans comptage ignorées', () => {
    const r = panierMoyenLivraison([
      jour(0, 0), jour(10000, 0), jour(0, 3),
      jour(10000, 2), jour(10000, 2), jour(10000, 2), jour(10000, 2), jour(10000, 2),
    ])
    assert.equal(r.jours, 5)
    assert.equal(r.panier, 5000)
  })

  test('liste vide : pas de panier, pas de division par zéro', () => {
    assert.deepEqual(panierMoyenLivraison([]), { panier: null, jours: 0 })
  })
})

describe('estimerCommandesShift', () => {
  test('16 000 F avec un panier de 4 000 → environ 4 commandes', () => {
    assert.equal(estimerCommandesShift(16000, 4000), 4)
  })
  test('sans panier fiable : on ne dit rien', () => {
    assert.equal(estimerCommandesShift(16000, null), null)
  })
  test('shift sans argent livraison : on ne dit rien (pas « 0 attendu »)', () => {
    assert.equal(estimerCommandesShift(0, 4000), null)
  })
})

describe('site sans POS — alerte « commandes jamais saisies »', () => {
  const noms = { u1: 'Hilary Sea' }

  test('argent de 12 commandes, 3 enregistrées : alerte', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [
        { caissier_id: 'u1', contact_client: '07' },
        { caissier_id: 'u1', contact_client: '07' },
        { caissier_id: 'u1', contact_client: '' },
      ],
      shifts: [{ caissier_id: 'u1', caissier_nom: 'Hilary Sea', yango_cse: 30000, glovo_cse: 18000 }],
      noms,
      panier: 4000,
    })
    assert.equal(r.lignes[0].commandes, 3)
    assert.equal(r.lignes[0].attendu, 12)
    assert.equal(r.lignes[0].alerte, true)
  })

  test('deux commandes d\'écart : bruit normal, on se tait', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [{ caissier_id: 'u1', contact_client: '07' }, { caissier_id: 'u1', contact_client: '07' }],
      shifts: [{ caissier_id: 'u1', yango_cse: 16000, glovo_cse: 0 }],
      noms,
      panier: 4000,
    })
    assert.equal(r.lignes[0].attendu, 4)
    assert.equal(r.lignes[0].alerte, false)
  })

  test('sans panier fiable : aucune estimation, aucune alerte', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [{ caissier_id: 'u1', contact_client: '07' }],
      shifts: [{ caissier_id: 'u1', yango_cse: 48000, glovo_cse: 0 }],
      noms,
      panier: null,
    })
    assert.equal(r.lignes[0].attendu, null)
    assert.equal(r.lignes[0].alerte, false)
  })

  test('caissier qui n\'a RIEN enregistré mais a encaissé : ligne créée, 0 / 0', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [],
      shifts: [{ caissier_id: 'u1', caissier_nom: 'Hilary Sea', yango_cse: 40000, glovo_cse: 0 }],
      noms,
      panier: 4000,
    })
    assert.equal(r.lignes.length, 1)
    assert.equal(r.lignes[0].commandes, 0)
    assert.equal(r.lignes[0].attendu, 10)
    assert.equal(r.lignes[0].alerte, true)
  })

  test('shift sans argent livraison et sans commande : pas de ligne inutile', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'SAMTRACKLY',
      commandes: [],
      shifts: [{ caissier_id: 'u2', caissier_nom: 'Awa K.', yango_cse: 0, glovo_cse: 0 }],
      noms,
      panier: 4000,
    })
    assert.deepEqual(r.lignes, [])
  })

  test('site POS : jamais d\'estimation, le POS compte pour de vrai', () => {
    const r = detailContactsParCaissier({
      sourcePoint: 'POS',
      shifts: [{ caissier_id: 'u1', pos_nb_contacts: 5, pos_nb_yango: 7, yango_cse: 40000 }],
      noms,
      panier: 4000,
    })
    assert.equal(r.lignes[0].attendu, undefined)
    assert.equal(r.lignes[0].contacts, 5)
  })
})

describe('répartition du litige contacts entre les caissiers', () => {
  test('au prorata des contacts oubliés, total = litige du jour', () => {
    const r = repartirLitigeContacts(3000, [
      { cle: 'u1', nom: 'Hilary', contacts: 3, commandes: 7 },
      { cle: 'u2', nom: 'Awa', contacts: 5, commandes: 7 },
      { cle: 'u3', nom: 'Michel', contacts: 4, commandes: 4 },
    ])
    assert.deepEqual(r.parts.map(p => [p.nom, p.oublies, p.montant]), [['Hilary', 4, 2000], ['Awa', 2, 1000]])
    assert.equal(r.nonAttribue, 0)
  })

  test('les arrondis tombent juste au franc près', () => {
    const r = repartirLitigeContacts(1000, [
      { cle: 'a', nom: 'A', contacts: 0, commandes: 1 },
      { cle: 'b', nom: 'B', contacts: 0, commandes: 1 },
      { cle: 'c', nom: 'C', contacts: 0, commandes: 1 },
    ])
    assert.equal(r.parts.reduce((s, p) => s + p.montant, 0), 1000)
  })

  test('compteur non transmis : rien d’inventé, le litige reste non attribué', () => {
    const r = repartirLitigeContacts(1500, [
      { cle: 'u1', nom: 'Hilary', contacts: null, commandes: 7 },
      { cle: 'u2', nom: 'Awa', contacts: 7, commandes: 7 },
    ])
    assert.deepEqual(r.parts, [])
    assert.equal(r.nonAttribue, 1500)
  })

  test('pas de litige : personne ne paie', () => {
    assert.deepEqual(repartirLitigeContacts(0, [{ cle: 'u1', nom: 'H', contacts: 1, commandes: 7 }]), { parts: [], nonAttribue: 0 })
  })

  test('total par caissier sur la période', () => {
    const jours = [
      { repartition: { parts: [{ cle: 'u1', nom: 'Hilary', montant: 2000 }, { cle: 'u2', nom: 'Awa', montant: 1000 }], nonAttribue: 0 } },
      { repartition: { parts: [{ cle: 'u1', nom: 'Hilary', montant: 500 }], nonAttribue: 500 } },
      { repartition: null },
    ]
    const t = totauxLitigeContactsParCaissier(jours)
    assert.deepEqual(t.parCaissier.map(x => [x.nom, x.montant, x.jours]), [['Hilary', 2500, 2], ['Awa', 1000, 1]])
    assert.equal(t.nonAttribue, 500)
  })
})
