// Tests de lib/evenements.js — anniversaires, ancienneté, calendrier, messages.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  champsEvenement, compterAujourdhui, construireFil, construireLignes, dansRestaurant, dateDansAnnee, erreurEvenement,
  libelleJour, lienSms, lienWhatsApp, messagePour, nbSansNaissance, numeroInternational, peutVoirEvenements, prochaineDate,
  sectionDe, texteAnnees, texteRappel, voitToutLeGroupe,
} from './evenements.js'

const AUJ = '2026-11-07'
const trav = (o = {}) => ({
  id: 't1', nom: 'KONE AWA', prenoms: 'Awa', contact: '0708091011', actif: true, statut: 'actif',
  restaurant_id: 'r1', restaurants: { nom: 'Samer Maroc' }, date_naissance: null, date_embauche: null, ...o,
})

test('rôles : direction et RH voient le groupe, le gérant son équipe, les autres rien', () => {
  for (const r of ['manager', 'directeur', 'rh']) assert.equal(voitToutLeGroupe(r), true)
  assert.equal(voitToutLeGroupe('gerant'), false)
  assert.equal(peutVoirEvenements('gerant'), true)
  for (const r of ['superviseur', 'caissier', 'verificateur', null]) assert.equal(peutVoirEvenements(r), false)
})

test('29 février : tombe le 28 les années non bissextiles', () => {
  assert.equal(dateDansAnnee('2000-02-29', 2026), '2026-02-28')
  assert.equal(dateDansAnnee('2000-02-29', 2028), '2028-02-29')
})

test('prochaineDate : aujourd\'hui compte, hier passe à l\'année suivante', () => {
  assert.equal(prochaineDate('1990-11-07', AUJ), '2026-11-07')
  assert.equal(prochaineDate('1990-11-06', AUJ), '2027-11-06')
})

test('sectionDe : chaque date va dans la première section qui correspond', () => {
  assert.equal(sectionDe('2026-11-06', AUJ), null)
  assert.equal(sectionDe(AUJ, AUJ), 'aujourdhui')
  assert.equal(sectionDe('2026-11-14', AUJ), 'semaine')
  assert.equal(sectionDe('2026-11-15', AUJ), 'mois')
  assert.equal(sectionDe('2026-12-31', AUJ), 'suivant')
  assert.equal(sectionDe('2027-01-01', AUJ), null)
})

test('sectionDe : passage de mois et d\'année', () => {
  assert.equal(sectionDe('2026-12-03', '2026-11-28'), 'semaine')
  assert.equal(sectionDe('2027-01-03', '2026-12-28'), 'semaine')
  assert.equal(sectionDe('2027-01-20', '2026-12-28'), 'suivant')
  assert.equal(sectionDe('2027-02-01', '2026-12-28'), null)
})

test('anniversaire : âge atteint à la prochaine date', () => {
  const [l] = construireLignes({ travailleurs: [trav({ date_naissance: '1990-11-20' })], evenements: [], aujourdhui: AUJ })
  assert.equal(l.type, 'anniversaire')
  assert.equal(l.date, '2026-11-20')
  assert.equal(l.age, 36)
})

test('ancienneté : années complètes seulement, rien avant un an', () => {
  const lignes = construireLignes({
    travailleurs: [
      trav({ id: 'a', date_embauche: '2024-11-20' }),
      trav({ id: 'b', date_embauche: '2025-12-01' }),
      trav({ id: 'c', date_embauche: '2026-11-20' }),
      trav({ id: 'd', date_embauche: '2026-08-01' }),
    ],
    evenements: [],
    aujourdhui: AUJ,
  })
  const parId = Object.fromEntries(lignes.map(l => [l.travailleur.id, l]))
  assert.equal(parId.a.annees, 2)
  assert.equal(parId.b.annees, 1)
  assert.equal(parId.c, undefined)
  assert.equal(parId.d.annees, 1)
  assert.equal(parId.d.date, '2027-08-01')
  assert.equal(texteAnnees(1), '1 an')
  assert.equal(texteAnnees(2), '2 ans')
})

test('travailleurs inactifs, archivés ou sans date : aucune ligne', () => {
  const lignes = construireLignes({
    travailleurs: [
      trav({ id: 'i', actif: false, date_naissance: '1990-11-20' }),
      trav({ id: 'x', statut: 'archive', date_naissance: '1990-11-20' }),
      trav({ id: 's' }),
    ],
    evenements: [],
    aujourdhui: AUJ,
  })
  assert.deepEqual(lignes, [])
})

test('calendrier : date unique passée masquée, « chaque année » à sa prochaine date', () => {
  const lignes = construireLignes({
    travailleurs: [],
    evenements: [
      { id: 'passe', titre: 'Réunion', date_evenement: '2026-11-01', chaque_annee: false },
      { id: 'noel', titre: 'Noël', date_evenement: '2020-12-25', chaque_annee: true },
      { id: 'tab', titre: 'Promo', date_evenement: '2026-11-10', chaque_annee: false },
    ],
    aujourdhui: AUJ,
  })
  assert.deepEqual(lignes.map(l => [l.evenement.id, l.date]), [['tab', '2026-11-10'], ['noel', '2026-12-25']])
})

test('fil : sections vides retirées, tri par date, filtre par type', () => {
  const lignes = construireLignes({
    travailleurs: [
      trav({ id: 'a', nom: 'ZAN', date_naissance: '1990-11-07', date_embauche: '2020-11-07' }),
      trav({ id: 'b', nom: 'ABA', date_naissance: '1995-11-07' }),
      trav({ id: 'c', nom: 'COU', date_naissance: '1995-11-09' }),
    ],
    evenements: [],
    aujourdhui: AUJ,
  })
  const fil = construireFil(lignes, AUJ)
  assert.deepEqual(fil.map(s => s.cle), ['aujourdhui', 'semaine'])
  assert.deepEqual(fil[0].lignes.map(l => `${l.type}:${l.travailleur.nom}`), ['anniversaire:ABA', 'anciennete:ZAN', 'anniversaire:ZAN'])
  const seuls = construireFil(lignes, AUJ, 'anciennete')
  assert.equal(seuls.length, 1)
  assert.equal(seuls[0].lignes.length, 1)
})

test('dansRestaurant : le restaurant choisi et les événements de tout le groupe', () => {
  const r = dansRestaurant({
    travailleurs: [trav({ id: 'a', restaurant_id: 'r1' }), trav({ id: 'b', restaurant_id: 'r2' })],
    evenements: [{ id: 'g', restaurant_id: null }, { id: 'e1', restaurant_id: 'r1' }, { id: 'e2', restaurant_id: 'r2' }],
  }, 'r1')
  assert.deepEqual(r.travailleurs.map(t => t.id), ['a'])
  assert.deepEqual(r.evenements.map(e => e.id), ['g', 'e1'])
  const tout = dansRestaurant({ travailleurs: [trav()], evenements: [{ id: 'g' }] }, null)
  assert.equal(tout.travailleurs.length, 1)
})

test('rappel : texte seulement s\'il se passe quelque chose aujourd\'hui', () => {
  const lignes = [
    { type: 'anniversaire', date: AUJ }, { type: 'anniversaire', date: AUJ },
    { type: 'anciennete', date: AUJ }, { type: 'calendrier', date: AUJ },
    { type: 'calendrier', date: '2026-11-08' },
  ]
  const c = compterAujourdhui(lignes, AUJ)
  assert.deepEqual(c, { anniversaire: 2, anciennete: 1, calendrier: 1, total: 4 })
  assert.equal(texteRappel(c), "🎂 2 anniversaires · 🏅 1 ancienneté · 📅 1 événement aujourd'hui")
  assert.equal(texteRappel(compterAujourdhui([], AUJ)), null)
})

test('nbSansNaissance : seulement les actifs', () => {
  assert.equal(nbSansNaissance([trav(), trav({ date_naissance: '1990-01-01' }), trav({ actif: false })]), 1)
})

test('libelleJour : aujourd\'hui et demain en clair', () => {
  assert.equal(libelleJour(AUJ, AUJ), "Aujourd'hui")
  assert.equal(libelleJour('2026-11-08', AUJ), 'Demain')
  assert.match(libelleJour('2026-11-20', AUJ), /20/)
})

test('messages : prénom, restaurant et années, jamais de mois', () => {
  const t = trav()
  assert.equal(
    messagePour({ type: 'anniversaire', travailleur: t }),
    "Joyeux anniversaire Awa ! 🎂 Toute l'équipe de Samer Maroc vous souhaite une excellente journée.",
  )
  assert.equal(
    messagePour({ type: 'anciennete', travailleur: t, annees: 2 }),
    'Bonjour Awa, cela fait 2 ans que vous êtes avec nous à Samer Maroc. Merci pour votre travail et votre fidélité !',
  )
  assert.match(messagePour({ type: 'anciennete', travailleur: t, annees: 1 }), /cela fait 1 an que/)
  const sans = trav({ prenoms: null, nom: 'KONE AWA', restaurants: null })
  assert.equal(messagePour({ type: 'anniversaire', travailleur: sans }), "Joyeux anniversaire KONE AWA ! 🎂 Toute l'équipe vous souhaite une excellente journée.")
})

test('numeroInternational : ajoute 225 sans toucher aux formats inconnus', () => {
  assert.equal(numeroInternational('0708091011'), '2250708091011')
  assert.equal(numeroInternational('07 08 09 10 11'), '2250708091011')
  assert.equal(numeroInternational('+225 0708091011'), '2250708091011')
  assert.equal(numeroInternational('2250708091011'), '2250708091011')
  assert.equal(numeroInternational('12345'), null)
  assert.equal(numeroInternational(''), null)
  assert.equal(numeroInternational(null), null)
})

test('liens : le texte modifié part encodé, séparateur SMS selon le téléphone', () => {
  assert.equal(lienWhatsApp('2250708091011', 'Bonne fête & merci'), 'https://wa.me/2250708091011?text=Bonne%20f%C3%AAte%20%26%20merci')
  assert.equal(lienSms('2250708091011', 'Salut', true), 'sms:+2250708091011&body=Salut')
  assert.equal(lienSms('2250708091011', 'Salut', false), 'sms:+2250708091011?body=Salut')
})

test('événement : titre et date obligatoires, champs nettoyés', () => {
  assert.equal(erreurEvenement({ titre: ' ', date_evenement: AUJ }), "Indiquez le titre de l'événement.")
  assert.equal(erreurEvenement({ titre: 'Noël', date_evenement: '' }), 'Choisissez la date.')
  assert.equal(erreurEvenement({ titre: 'Noël', date_evenement: AUJ }), null)
  assert.deepEqual(
    champsEvenement({ titre: ' Noël ', date_evenement: '2026-12-25', note: ' ', restaurant_id: '', chaque_annee: true }),
    { titre: 'Noël', date_evenement: '2026-12-25', note: null, restaurant_id: null, chaque_annee: true },
  )
})
