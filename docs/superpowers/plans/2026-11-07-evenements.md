# Espace « Événements » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter un écran « Événements » (anniversaires, ancienneté en années, calendrier du groupe), avec message modifiable à envoyer par WhatsApp ou SMS, et un rappel sur l'accueil.

**Architecture :** toute la logique est pure dans `lib/evenements.js`, testée avec `node:test`. Les accès à la base sont dans `lib/evenementsDb.js`. L'interface réutilise le kit `components/ui/EcranModerne.js`. Rien n'est calculé ni stocké côté serveur, sauf la nouvelle table du calendrier.

**Tech Stack :** React Native / Expo Router, Supabase, `node:test`.

**Conception :** `docs/superpowers/specs/2026-11-07-evenements-design.md`.

## Global Constraints

- Interface et messages en français courant, sans code technique.
- Jamais de date tapée : toute date passe par `ChampDate`.
- Ancienneté en années complètes uniquement : jamais de mois.
- Le message reste modifiable avant chaque envoi ; l'envoi reste manuel.
- L'indicatif 225 s'ajoute à l'envoi ; les numéros des fiches ne sont jamais modifiés.
- `journaliser` ne bloque jamais une action.
- `lib/evenements.js` n'importe rien : il doit tourner sous `node` sans React Native.
- `git` : préfixer par `export DEVELOPER_DIR=/Library/Developer/CommandLineTools`. Ne jamais lancer `git add -A` : le dossier peut contenir le travail d'une autre session, et `.claude/settings.json` ne doit pas être committé.
- Ne jamais lancer `expo start` ni `localhost`, ni `CI=1` : vérifier par les tests, le lint et l'export web.
- Commit et push à chaque tâche. **Aucune publication Vercel ou EAS dans ce plan.**
- Tests : `node lib/evenements.test.mjs` ; tout : `for f in lib/*.test.mjs; do node "$f"; done`.

---

### Task 1 : logique pure

**Files :**
- Create : `lib/evenements.js`
- Test : `lib/evenements.test.mjs`

**Interfaces :**
- Produces (depuis `lib/evenements.js`) :
  - `voitToutLeGroupe(role) → boolean`, `peutVoirEvenements(role) → boolean`
  - `dateDansAnnee(iso, annee) → iso`, `prochaineDate(iso, aujourdhui) → iso`
  - `SECTIONS: [{ cle, titre }]`, `sectionDe(date, aujourdhui) → 'aujourdhui' | 'semaine' | 'mois' | 'suivant' | null`
  - `construireLignes({ travailleurs, evenements, aujourdhui }) → lignes`. Une ligne est `{ cle, type: 'anniversaire', date, travailleur, age }`, `{ cle, type: 'anciennete', date, travailleur, annees }` ou `{ cle, type: 'calendrier', date, evenement }`.
  - `construireFil(lignes, aujourdhui, filtre = 'tout') → [{ cle, titre, lignes }]`
  - `dansRestaurant({ travailleurs, evenements }, restoId) → { travailleurs, evenements }`
  - `compterAujourdhui(lignes, aujourdhui) → { anniversaire, anciennete, calendrier, total }`, `texteRappel(compte) → string | null`
  - `nbSansNaissance(travailleurs) → number`
  - `texteAnnees(n) → string`, `libelleJour(date, aujourdhui) → string`
  - `messagePour(ligne) → string`
  - `numeroInternational(contact) → string | null`, `lienWhatsApp(numero, texte) → url`, `lienSms(numero, texte, ios) → url`
  - `erreurEvenement(form) → string | null`, `champsEvenement(form) → objet`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/evenements.test.mjs` :

```js
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
  assert.deepEqual(lignes.map(l => [l.evenement.id, l.date]), [['noel', '2026-12-25'], ['tab', '2026-11-10']])
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
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/evenements.test.mjs`
Expected : échec `Cannot find module` sur `./evenements.js`.

- [ ] **Step 3 : écrire la logique**

Créer `lib/evenements.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Événements : anniversaires, ancienneté (années complètes seulement) et
// calendrier du groupe. Logique pure, sans import.
// Conception : docs/superpowers/specs/2026-11-07-evenements-design.md
// Tests : lib/evenements.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const ROLES_GROUPE = ['manager', 'directeur', 'rh']
export const voitToutLeGroupe = role => ROLES_GROUPE.includes(role)
export const peutVoirEvenements = role => voitToutLeGroupe(role) || role === 'gerant'

const pad = n => String(n).padStart(2, '0')
const bissextile = a => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0

function parties(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number)
  return { a, m, j }
}

function ajouterJours(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function finDuMoisSuivant(iso) {
  const { a, m } = parties(iso)
  return new Date(Date.UTC(a, m + 1, 0)).toISOString().slice(0, 10)
}

/** La date d'anniversaire dans une année donnée ; le 29 février devient le 28 si besoin. */
export function dateDansAnnee(iso, annee) {
  const { m, j } = parties(iso)
  const jour = m === 2 && j === 29 && !bissextile(annee) ? 28 : j
  return `${annee}-${pad(m)}-${pad(jour)}`
}

/** Prochaine occurrence, aujourd'hui compris. */
export function prochaineDate(iso, aujourdhui) {
  const annee = parties(aujourdhui).a
  const cetteAnnee = dateDansAnnee(iso, annee)
  return cetteAnnee >= aujourdhui ? cetteAnnee : dateDansAnnee(iso, annee + 1)
}

export const SECTIONS = [
  { cle: 'aujourdhui', titre: "Aujourd'hui" },
  { cle: 'semaine', titre: '7 prochains jours' },
  { cle: 'mois', titre: 'Reste du mois' },
  { cle: 'suivant', titre: 'Mois suivant' },
]

export function sectionDe(date, aujourdhui) {
  if (date < aujourdhui) return null
  if (date === aujourdhui) return 'aujourdhui'
  if (date <= ajouterJours(aujourdhui, 7)) return 'semaine'
  if (date.slice(0, 7) === aujourdhui.slice(0, 7)) return 'mois'
  if (date <= finDuMoisSuivant(aujourdhui)) return 'suivant'
  return null
}

const estActif = t => !!t.actif && t.statut !== 'archive'

function lignesTravailleur(t, aujourdhui) {
  const lignes = []
  if (t.date_naissance) {
    const date = prochaineDate(t.date_naissance, aujourdhui)
    const age = parties(date).a - parties(t.date_naissance).a
    if (age >= 1) lignes.push({ cle: `anniversaire-${t.id}`, type: 'anniversaire', date, travailleur: t, age })
  }
  if (t.date_embauche) {
    const date = prochaineDate(t.date_embauche, aujourdhui)
    const annees = parties(date).a - parties(t.date_embauche).a
    if (annees >= 1) lignes.push({ cle: `anciennete-${t.id}`, type: 'anciennete', date, travailleur: t, annees })
  }
  return lignes
}

function ligneCalendrier(e, aujourdhui) {
  const date = e.chaque_annee ? prochaineDate(e.date_evenement, aujourdhui) : String(e.date_evenement).slice(0, 10)
  return date >= aujourdhui ? { cle: `calendrier-${e.id}`, type: 'calendrier', date, evenement: e } : null
}

const nomLigne = l => l.travailleur?.nom || l.evenement?.titre || ''

export function construireLignes({ travailleurs, evenements, aujourdhui }) {
  const lignes = [
    ...travailleurs.filter(estActif).flatMap(t => lignesTravailleur(t, aujourdhui)),
    ...evenements.map(e => ligneCalendrier(e, aujourdhui)).filter(Boolean),
  ]
  return lignes.sort((a, b) => a.date.localeCompare(b.date) || nomLigne(a).localeCompare(nomLigne(b), 'fr') || a.type.localeCompare(b.type))
}

export function construireFil(lignes, aujourdhui, filtre = 'tout') {
  const gardees = filtre === 'tout' ? lignes : lignes.filter(l => l.type === filtre)
  return SECTIONS
    .map(s => ({ ...s, lignes: gardees.filter(l => sectionDe(l.date, aujourdhui) === s.cle) }))
    .filter(s => s.lignes.length > 0)
}

/** Un restaurant : ses travailleurs, ses événements et ceux de tout le groupe. */
export function dansRestaurant({ travailleurs, evenements }, restoId) {
  if (!restoId) return { travailleurs, evenements }
  return {
    travailleurs: travailleurs.filter(t => t.restaurant_id === restoId),
    evenements: evenements.filter(e => !e.restaurant_id || e.restaurant_id === restoId),
  }
}

export function compterAujourdhui(lignes, aujourdhui) {
  const compte = { anniversaire: 0, anciennete: 0, calendrier: 0, total: 0 }
  for (const l of lignes) {
    if (l.date !== aujourdhui) continue
    compte[l.type] += 1
    compte.total += 1
  }
  return compte
}

const pluriel = (n, mot, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`

export function texteRappel(c) {
  if (!c.total) return null
  const morceaux = [
    c.anniversaire && `🎂 ${pluriel(c.anniversaire, 'anniversaire')}`,
    c.anciennete && `🏅 ${pluriel(c.anciennete, 'ancienneté')}`,
    c.calendrier && `📅 ${pluriel(c.calendrier, 'événement')}`,
  ].filter(Boolean)
  return `${morceaux.join(' · ')} aujourd'hui`
}

export const nbSansNaissance = travailleurs => travailleurs.filter(t => estActif(t) && !t.date_naissance).length

export const texteAnnees = n => pluriel(n, 'an')

export function libelleJour(date, aujourdhui) {
  if (date === aujourdhui) return "Aujourd'hui"
  if (date === ajouterJours(aujourdhui, 1)) return 'Demain'
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

const prenomDe = t => String(t.prenoms || '').trim() || t.nom

/** Texte de départ du message ; l'utilisateur le modifie librement avant l'envoi. */
export function messagePour(ligne) {
  const t = ligne.travailleur
  const resto = t.restaurants?.nom
  if (ligne.type === 'anciennete') {
    return `Bonjour ${prenomDe(t)}, cela fait ${texteAnnees(ligne.annees)} que vous êtes avec nous${resto ? ` à ${resto}` : ''}. Merci pour votre travail et votre fidélité !`
  }
  return `Joyeux anniversaire ${prenomDe(t)} ! 🎂 Toute l'équipe${resto ? ` de ${resto}` : ''} vous souhaite une excellente journée.`
}

/** Numéro de la fiche → 225 + 10 chiffres ; null si le format est inconnu. Ne modifie jamais la fiche. */
export function numeroInternational(contact) {
  const chiffres = String(contact ?? '').replace(/\D/g, '')
  if (/^225\d{10}$/.test(chiffres)) return chiffres
  if (/^\d{10}$/.test(chiffres)) return `225${chiffres}`
  return null
}

export const lienWhatsApp = (numero, texte) => `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`

export const lienSms = (numero, texte, ios) => `sms:+${numero}${ios ? '&' : '?'}body=${encodeURIComponent(texte)}`

export function erreurEvenement(form) {
  if (!String(form.titre ?? '').trim()) return "Indiquez le titre de l'événement."
  if (!form.date_evenement) return 'Choisissez la date.'
  return null
}

export function champsEvenement(form) {
  return {
    titre: String(form.titre).trim(),
    date_evenement: form.date_evenement,
    note: String(form.note ?? '').trim() || null,
    restaurant_id: form.restaurant_id || null,
    chaque_annee: !!form.chaque_annee,
  }
}
```

- [ ] **Step 4 : vérifier la réussite**

Run : `node lib/evenements.test.mjs`
Expected : tous les tests passent.

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/evenements.js lib/evenements.test.mjs
git commit -m "feat(evenements): logique des anniversaires, de l'ancienneté et des messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2 : table, tuile et accès à la base

**Files :**
- Create : `supabase_evenements.sql`, `lib/evenementsDb.js`
- Modify : `lib/menus.js`, `lib/groupesAccueil.js`, `lib/journal.js`, `app/_layout.tsx`
- Test : `lib/groupesAccueil.test.mjs`

**Interfaces :**
- Consumes : `champsEvenement(form)` de `lib/evenements.js`.
- Produces (depuis `lib/evenementsDb.js`) :
  - `chargerDonneesEvenements({ groupe, restaurantId }) → Promise<{ travailleurs, evenements }>` ; lève une erreur si la lecture échoue
  - `enregistrerEvenement(form, id, ctx) → Promise<void>`, `supprimerEvenement(evenement, ctx) → Promise<void>` ; `id` vaut `null` pour un ajout ; `ctx = { userId, userNom }`
- Produces : la tuile `evenements`, route `/evenements`.

- [ ] **Step 1 : écrire le test qui échoue**

Dans `lib/groupesAccueil.test.mjs`, ajouter `GROUPES_GERANT` à l'import depuis `./groupesAccueil.js`, puis ajouter à la fin du fichier :

```js
test('tuile Événements : dans Personnel, dans Équipe du gérant, avec son icône', () => {
  assert.ok(GROUPES_ADMIN.find(g => g.id === 'personnel').tuiles.includes('evenements'))
  assert.ok(GROUPES_GERANT.find(g => g.id === 'equipe').tuiles.includes('evenements'))
  assert.equal(ICONES_TUILES.evenements, 'party-popper')
  assert.ok(idsAdmin.includes('evenements'))
})
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/groupesAccueil.test.mjs`
Expected : échec du test « tuile Événements ».

- [ ] **Step 3 : déclarer la tuile**

Dans `lib/menus.js`, après la ligne de la tuile `salaires` :

```js
  { id: 'evenements',                 icon: '🎉',  titre: 'Événements',             sous: 'Anniversaires, ancienneté & calendrier', route: '/evenements',               admin: true },
```

Dans `ACCES_DEFAUT` du même fichier, ajouter `'evenements'` à la fin des listes `rh` et `gerant`.

Dans `lib/groupesAccueil.js` :
- ajouter `'evenements'` après `'salaires'` dans les `tuiles` du groupe `personnel` de `GROUPES_ADMIN` ;
- ajouter `'evenements'` à la fin des `tuiles` du groupe `equipe` de `GROUPES_GERANT` ;
- ajouter `'evenements': 'party-popper',` après `'salaires': 'cash-multiple',` dans `ICONES_TUILES`.

Dans `app/_layout.tsx`, après `<Stack.Screen name="salaires" />` :

```tsx
        <Stack.Screen name="evenements" />
```

Dans `lib/journal.js`, dans l'objet `ACTIONS`, après `BASCULE_POS:          'bascule_pos',` :

```js
  EVENEMENT_AJOUTE:     'evenement_ajoute',
  EVENEMENT_MODIFIE:    'evenement_modifie',
  EVENEMENT_SUPPRIME:   'evenement_supprime',
```

- [ ] **Step 4 : vérifier la réussite**

Run : `node lib/groupesAccueil.test.mjs`
Expected : tous les tests passent.

- [ ] **Step 5 : écrire la migration**

Créer `supabase_evenements.sql` :

```sql
-- Espace « Événements » : calendrier du groupe et tuile pour la RH et les gérants.
-- Conception : docs/superpowers/specs/2026-11-07-evenements-design.md
-- Les anniversaires et l'ancienneté ne sont pas stockés : ils se calculent depuis les fiches.

create table if not exists public.evenements_groupe (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (char_length(trim(titre)) between 1 and 120),
  date_evenement date not null,
  note text,
  restaurant_id uuid references public.restaurants(id) on delete cascade, -- vide = tout le groupe
  chaque_annee boolean not null default false,
  cree_par_nom text,
  created_at timestamptz not null default now()
);

create index if not exists idx_evenements_groupe_date on public.evenements_groupe (date_evenement);

-- Mêmes règles d'accès que le reste de la base.
alter table public.evenements_groupe enable row level security;
drop policy if exists allow_all on public.evenements_groupe;
create policy allow_all on public.evenements_groupe for all to public using (true) with check (true);
grant select, insert, update, delete on public.evenements_groupe to anon, authenticated;

-- Les tuiles du RH et du gérant sont lues dans roles_acces : sans cet ajout, ils ne verraient pas l'écran.
update public.roles_acces
set tuiles = tuiles || '["evenements"]'::jsonb, updated_at = now()
where role in ('rh', 'gerant') and not (tuiles @> '["evenements"]'::jsonb);

-- Contrôle : 1 table, 2 rôles avec la tuile.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'evenements_groupe') as table_ok,
  (select count(*) from public.roles_acces where tuiles @> '["evenements"]'::jsonb) as roles_avec_tuile;
```

- [ ] **Step 6 : écrire l'accès à la base**

Créer `lib/evenementsDb.js` :

```js
// Événements : lectures et écritures Supabase. Logique : lib/evenements.js
// Moins de 1000 travailleurs actifs et d'événements : une seule page de lecture suffit.
import { champsEvenement } from './evenements'
import { ACTIONS, journaliser } from './journal'
import { supabase } from './supabase'

const COLONNES_TRAVAILLEUR = 'id, nom, prenoms, contact, photo_url, date_naissance, date_embauche, restaurant_id, actif, statut, restaurants(nom, couleur)'

/** groupe = true : tout le groupe. Sinon, seulement restaurantId ; sans restaurant, rien. */
export async function chargerDonneesEvenements({ groupe, restaurantId }) {
  if (!groupe && !restaurantId) return { travailleurs: [], evenements: [] }

  let t = supabase.from('travailleurs').select(COLONNES_TRAVAILLEUR).eq('actif', true).order('nom')
  let e = supabase.from('evenements_groupe').select('*').order('date_evenement')
  if (!groupe) {
    t = t.eq('restaurant_id', restaurantId)
    e = e.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
  }
  const [travailleurs, evenements] = await Promise.all([t, e])
  if (travailleurs.error) throw travailleurs.error
  if (evenements.error) throw evenements.error
  return { travailleurs: travailleurs.data || [], evenements: evenements.data || [] }
}

export async function enregistrerEvenement(form, id, ctx) {
  const champs = champsEvenement(form)
  const { error } = id
    ? await supabase.from('evenements_groupe').update(champs).eq('id', id)
    : await supabase.from('evenements_groupe').insert({ ...champs, cree_par_nom: ctx.userNom || null })
  if (error) throw error
  journaliser(id ? ACTIONS.EVENEMENT_MODIFIE : ACTIONS.EVENEMENT_AJOUTE,
    { titre: champs.titre, date: champs.date_evenement },
    { restaurantId: champs.restaurant_id, userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
}

export async function supprimerEvenement(evenement, ctx) {
  const { error } = await supabase.from('evenements_groupe').delete().eq('id', evenement.id)
  if (error) throw error
  journaliser(ACTIONS.EVENEMENT_SUPPRIME,
    { titre: evenement.titre, date: evenement.date_evenement },
    { restaurantId: evenement.restaurant_id, userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
}
```

- [ ] **Step 7 : lancer tous les tests et le lint**

Run : `for f in lib/*.test.mjs; do node "$f" || echo "ECHEC $f"; done; npx eslint lib/evenementsDb.js lib/menus.js lib/groupesAccueil.js lib/journal.js`
Expected : aucun `ECHEC`, aucune erreur de lint.

- [ ] **Step 8 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add supabase_evenements.sql lib/evenementsDb.js lib/menus.js lib/groupesAccueil.js lib/groupesAccueil.test.mjs lib/journal.js app/_layout.tsx
git commit -m "feat(evenements): table du calendrier, tuile et accès à la base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 3 : écran, message et formulaire du calendrier

**Files :**
- Create : `app/evenements.js`, `components/evenements/LigneEvenement.js`, `components/evenements/FeuilleMessage.js`, `components/evenements/FeuilleEvenement.js`

**Interfaces :**
- Consumes : tout `lib/evenements.js` (Task 1) ; `chargerDonneesEvenements`, `enregistrerEvenement`, `supprimerEvenement` (Task 2) ; `chargerRestaurants` de `lib/equipeDb.js`.
- Produces : `LigneEvenement({ ligne, aujourdhui, voitAge, peutGerer, styles, colors, accent, onMessage, onModifier })`, `FeuilleMessage({ ligne, styles, colors, onFermer })`, `FeuilleEvenement({ visible, evenement, restaurants, ctx, styles, colors, principale, onFermer, onEnregistre })`.

- [ ] **Step 1 : écrire la ligne du fil**

Créer `components/evenements/LigneEvenement.js` :

```js
import { Text, TouchableOpacity, View } from 'react-native'

import { libelleJour, texteAnnees } from '../../lib/evenements'
import Avatar from '../equipe/Avatar'
import { Bouton } from '../ui/EcranModerne'

function libelle(ligne, voitAge) {
  if (ligne.type === 'anniversaire') return `🎂 Anniversaire${voitAge ? ` · ${texteAnnees(ligne.age)}` : ''}`
  if (ligne.type === 'anciennete') return `🏅 ${texteAnnees(ligne.annees)} chez nous`
  return ligne.evenement.chaque_annee ? '📅 Chaque année' : '📅 Événement'
}

export default function LigneEvenement({ ligne, aujourdhui, voitAge, peutGerer, styles, colors, accent, onMessage, onModifier }) {
  const jour = libelleJour(ligne.date, aujourdhui)

  if (ligne.type === 'calendrier') {
    const e = ligne.evenement
    const contenu = (
      <>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>{e.titre}</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{libelle(ligne)} · {jour}</Text>
        {e.note ? <Text style={{ fontSize: 13, color: colors.text, marginTop: 6 }}>{e.note}</Text> : null}
      </>
    )
    return peutGerer
      ? <TouchableOpacity style={styles.carte} onPress={() => onModifier(e)} activeOpacity={0.8}>{contenu}</TouchableOpacity>
      : <View style={styles.carte}>{contenu}</View>
  }

  const t = ligne.travailleur
  return (
    <View style={styles.carte}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar nom={t.nom} photo={t.photo_url} resto={t.restaurants} taille={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }} numberOfLines={1}>{t.nom}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
            {t.restaurants?.nom || 'Sans restaurant'} · {jour}
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: accent, marginTop: 2 }}>{libelle(ligne, voitAge)}</Text>
        </View>
      </View>
      <View style={{ marginTop: 10 }}>
        <Bouton label="💬 Envoyer un message" couleur={accent} styles={styles} onPress={() => onMessage(ligne)} />
      </View>
    </View>
  )
}
```

- [ ] **Step 2 : écrire la fenêtre de message**

Créer `components/evenements/FeuilleMessage.js` :

```js
import { useEffect, useState } from 'react'
import { Alert, Linking, Platform, Text, View } from 'react-native'

import { lienSms, lienWhatsApp, messagePour, numeroInternational } from '../../lib/evenements'
import { Bouton, Champ, Feuille, Libelle } from '../ui/EcranModerne'

export default function FeuilleMessage({ ligne, styles, colors, onFermer }) {
  const [texte, setTexte] = useState('')
  // Texte de départ à chaque ouverture : une modification ne vaut que pour cet envoi.
  useEffect(() => { if (ligne) setTexte(messagePour(ligne)) }, [ligne])
  if (!ligne) return null

  const numero = numeroInternational(ligne.travailleur.contact)
  const vide = !texte.trim()

  function ouvrir(lien, appli) {
    Linking.openURL(lien)
      .then(onFermer)
      .catch(() => Alert.alert('Envoi impossible', `Impossible d'ouvrir ${appli} sur cet appareil.`))
  }

  return (
    <Feuille visible titre="💬 Envoyer un message" sous={ligne.travailleur.nom} onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Message (modifiable)</Libelle>
      <Champ styles={styles} colors={colors} multiline value={texte} onChangeText={setTexte} placeholder="Écrivez votre message" />
      {!numero ? (
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.error }}>Pas de numéro valide sur la fiche</Text>
      ) : (
        <>
          {vide ? <Text style={{ fontSize: 13, color: colors.error, marginBottom: 8 }}>Écrivez un message pour pouvoir l'envoyer.</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton label="📲 WhatsApp" variante="plein" couleur="#25D366" flex grand styles={styles} disabled={vide}
              onPress={() => ouvrir(lienWhatsApp(numero, texte.trim()), 'WhatsApp')} />
            <Bouton label="💬 SMS" variante="plein" couleur="#2F7FD8" flex grand styles={styles} disabled={vide}
              onPress={() => ouvrir(lienSms(numero, texte.trim(), Platform.OS === 'ios'), "l'application SMS")} />
          </View>
        </>
      )}
    </Feuille>
  )
}
```

- [ ] **Step 3 : écrire le formulaire du calendrier**

Créer `components/evenements/FeuilleEvenement.js` :

```js
import { useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { erreurEvenement } from '../../lib/evenements'
import { enregistrerEvenement, supprimerEvenement } from '../../lib/evenementsDb'
import ChampDate from '../ChampDate'
import { Bouton, Champ, Feuille, Libelle, Puces } from '../ui/EcranModerne'

const VIDE = { titre: '', date_evenement: '', note: '', restaurant_id: '', chaque_annee: false }

export default function FeuilleEvenement({ visible, evenement, restaurants, ctx, styles, colors, principale, onFermer, onEnregistre }) {
  const [form, setForm] = useState(VIDE)
  const [erreur, setErreur] = useState(null)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible) return
    setErreur(null)
    setForm(evenement ? {
      titre: evenement.titre,
      date_evenement: String(evenement.date_evenement).slice(0, 10),
      note: evenement.note || '',
      restaurant_id: evenement.restaurant_id || '',
      chaque_annee: !!evenement.chaque_annee,
    } : VIDE)
  }, [visible, evenement])

  const maj = champ => valeur => setForm(f => ({ ...f, [champ]: valeur }))

  async function enregistrer() {
    const probleme = erreurEvenement(form)
    if (probleme) { setErreur(probleme); return }
    setOccupe(true)
    try {
      await enregistrerEvenement(form, evenement?.id || null, ctx)
      onEnregistre()
    } catch {
      setErreur("L'événement n'a pas pu être enregistré. Réessayez.")
    } finally {
      setOccupe(false)
    }
  }

  function supprimer() {
    Alert.alert('Supprimer cet événement ?', `« ${evenement.titre} » sera retiré du calendrier.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          try {
            await supprimerEvenement(evenement, ctx)
            onEnregistre()
          } catch {
            setErreur("L'événement n'a pas pu être supprimé. Réessayez.")
          }
        },
      },
    ])
  }

  const puccesRestaurants = [{ cle: '', label: 'Tout le groupe' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]

  return (
    <Feuille visible={visible} titre={evenement ? "Modifier l'événement" : 'Nouvel événement'} onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Titre</Libelle>
      <Champ styles={styles} colors={colors} value={form.titre} onChangeText={maj('titre')} placeholder="Ex : Noël, réunion des gérants" maxLength={120} />

      <ChampDate label="Date" valeur={form.date_evenement} onChange={maj('date_evenement')} couleur={principale} />
      <View style={{ height: 16 }} />

      <Libelle styles={styles}>Fréquence</Libelle>
      <Puces styles={styles} actif={form.chaque_annee} onChoisir={maj('chaque_annee')}
        elements={[{ cle: false, label: 'Une seule fois' }, { cle: true, label: 'Chaque année' }]} />

      <Libelle styles={styles}>Restaurant concerné</Libelle>
      <Puces styles={styles} actif={form.restaurant_id} onChoisir={maj('restaurant_id')} elements={puccesRestaurants} />

      <Libelle styles={styles}>Note (facultative)</Libelle>
      <Champ styles={styles} colors={colors} multiline value={form.note} onChangeText={maj('note')} placeholder="Ce qu'il faut préparer" />

      {erreur ? <Text style={{ fontSize: 13, fontWeight: '700', color: colors.error, marginBottom: 10 }}>{erreur}</Text> : null}

      <View style={{ gap: 8 }}>
        <Bouton label={occupe ? 'Enregistrement…' : 'Enregistrer'} variante="plein" couleur={principale} grand styles={styles} disabled={occupe} onPress={enregistrer} />
        {evenement ? <Bouton label="Supprimer" couleur={colors.error} grand styles={styles} disabled={occupe} onPress={supprimer} /> : null}
      </View>
    </Feuille>
  )
}
```

- [ ] **Step 4 : écrire l'écran**

Créer `app/evenements.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Événements : anniversaires, ancienneté et calendrier du groupe.
// Direction et RH : tout le groupe. Gérant : son restaurant, sans l'âge.
// Logique : lib/evenements.js — Base : lib/evenementsDb.js
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native'

import FeuilleEvenement from '../components/evenements/FeuilleEvenement'
import FeuilleMessage from '../components/evenements/FeuilleMessage'
import LigneEvenement from '../components/evenements/LigneEvenement'
import { Bouton, EnTete, Puces, Vide, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { aujourdhuiISO } from '../lib/contrats'
import { chargerRestaurants } from '../lib/equipeDb'
import { construireFil, construireLignes, dansRestaurant, nbSansNaissance, peutVoirEvenements, voitToutLeGroupe } from '../lib/evenements'
import { chargerDonneesEvenements } from '../lib/evenementsDb'

const FILTRES = [
  { cle: 'tout', label: 'Tout' },
  { cle: 'anniversaire', label: '🎂 Anniversaires' },
  { cle: 'anciennete', label: '🏅 Ancienneté' },
  { cle: 'calendrier', label: '📅 Calendrier' },
]

export default function EvenementsScreen() {
  const { roleActif, restaurantId, userId, userNom } = useApp()
  const { styles, colors, accent, principale } = useEcranModerne('sarcelle')
  const groupe = voitToutLeGroupe(roleActif)
  const autorise = peutVoirEvenements(roleActif)
  const aujourdhui = aujourdhuiISO()

  const [donnees, setDonnees] = useState({ travailleurs: [], evenements: [] })
  const [restaurants, setRestaurants] = useState([])
  const [restoFiltre, setRestoFiltre] = useState('')
  const [filtre, setFiltre] = useState('tout')
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState(false)
  const [ligneMessage, setLigneMessage] = useState(null)
  const [formulaire, setFormulaire] = useState({ visible: false, evenement: null })

  const charger = useCallback(async () => {
    if (!autorise) { setLoading(false); return }
    setErreur(false)
    try {
      setDonnees(await chargerDonneesEvenements({ groupe, restaurantId }))
    } catch {
      setErreur(true)
    } finally {
      setLoading(false)
    }
  }, [autorise, groupe, restaurantId])

  useEffect(() => { charger() }, [charger])
  useEffect(() => { if (groupe) chargerRestaurants().then(setRestaurants).catch(() => {}) }, [groupe])

  const visibles = useMemo(() => dansRestaurant(donnees, groupe ? restoFiltre : null), [donnees, groupe, restoFiltre])
  const lignes = useMemo(() => construireLignes({ ...visibles, aujourdhui }), [visibles, aujourdhui])
  const fil = useMemo(() => construireFil(lignes, aujourdhui, filtre), [lignes, aujourdhui, filtre])
  const sansNaissance = useMemo(() => nbSansNaissance(visibles.travailleurs), [visibles])

  const puccesRestos = useMemo(
    () => [{ cle: '', label: 'Tous les restaurants' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))],
    [restaurants],
  )

  if (!autorise) {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Événements" onRetour={() => router.back()} styles={styles} />
        <Vide icone="🔒" texte="Cet écran n'est pas disponible pour votre compte." styles={styles} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Événements" sous="Anniversaires, ancienneté et calendrier" onRetour={() => router.back()} styles={styles} />
      {groupe ? <Puces ligne styles={styles} actif={restoFiltre} onChoisir={setRestoFiltre} elements={puccesRestos} /> : null}
      <Puces ligne styles={styles} actif={filtre} onChoisir={setFiltre} elements={FILTRES} />

      {loading ? (
        <ActivityIndicator color={principale} style={{ marginTop: 40 }} />
      ) : erreur ? (
        <View style={styles.body}>
          <Vide icone="⚠️" texte="Les événements n'ont pas pu être chargés." sous="Vérifiez la connexion et réessayez." styles={styles} />
          <Bouton label="Réessayer" couleur={accent} styles={styles} onPress={() => { setLoading(true); charger() }} />
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {groupe ? (
            <View style={{ marginBottom: 12, gap: 8 }}>
              <Bouton label="➕ Ajouter un événement" variante="plein" couleur={principale} styles={styles}
                onPress={() => setFormulaire({ visible: true, evenement: null })} />
              {sansNaissance > 0 ? (
                <Text style={{ fontSize: 13, color: colors.textMuted }}>
                  {sansNaissance} fiche{sansNaissance > 1 ? 's' : ''} sans date de naissance
                </Text>
              ) : null}
            </View>
          ) : null}

          {fil.length === 0 ? (
            <Vide icone="🎉" texte="Rien de prévu pour le moment." styles={styles} />
          ) : fil.map(section => (
            <View key={section.cle}>
              <Text style={[styles.label, { marginTop: 8 }]}>{section.titre}</Text>
              {section.lignes.map(ligne => (
                <LigneEvenement key={ligne.cle} ligne={ligne} aujourdhui={aujourdhui} voitAge={groupe} peutGerer={groupe}
                  styles={styles} colors={colors} accent={accent}
                  onMessage={setLigneMessage}
                  onModifier={evenement => setFormulaire({ visible: true, evenement })} />
              ))}
            </View>
          ))}
          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      <FeuilleMessage ligne={ligneMessage} styles={styles} colors={colors} onFermer={() => setLigneMessage(null)} />
      {groupe ? (
        <FeuilleEvenement visible={formulaire.visible} evenement={formulaire.evenement} restaurants={restaurants}
          ctx={{ userId: userId || null, userNom: userNom || null }} styles={styles} colors={colors} principale={principale}
          onFermer={() => setFormulaire({ visible: false, evenement: null })}
          onEnregistre={() => { setFormulaire({ visible: false, evenement: null }); charger() }} />
      ) : null}
    </SafeAreaView>
  )
}
```

- [ ] **Step 5 : vérifier le lint**

Run : `npx eslint app/evenements.js components/evenements`
Expected : aucune erreur. Le lint ne doit signaler aucun import inutilisé dans ces fichiers.

- [ ] **Step 6 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add app/evenements.js components/evenements
git commit -m "feat(evenements): écran, message modifiable et formulaire du calendrier

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4 : rappel sur l'accueil et vérification finale

**Files :**
- Create : `components/evenements/RappelEvenements.js`
- Modify : `components/accueil/AccueilManager.js`

**Interfaces :**
- Consumes : `construireLignes`, `compterAujourdhui`, `texteRappel`, `voitToutLeGroupe`, `peutVoirEvenements` (Task 1) ; `chargerDonneesEvenements` (Task 2).
- Produces : `RappelEvenements({ role, restaurantId, styles, colors })`.

- [ ] **Step 1 : écrire le rappel**

Créer `components/evenements/RappelEvenements.js` :

```js
// Ligne de l'accueil, seulement s'il se passe quelque chose aujourd'hui.
// Calculée à l'ouverture ; un échec la masque sans bloquer l'accueil.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { compterAujourdhui, construireLignes, peutVoirEvenements, texteRappel, voitToutLeGroupe } from '../../lib/evenements'
import { chargerDonneesEvenements } from '../../lib/evenementsDb'
import Survol from '../ui/Survol'

export default function RappelEvenements({ role, restaurantId, styles, colors }) {
  const [texte, setTexte] = useState(null)

  useFocusEffect(useCallback(() => {
    if (!peutVoirEvenements(role)) { setTexte(null); return undefined }
    let vivant = true
    const aujourdhui = aujourdhuiISO()
    chargerDonneesEvenements({ groupe: voitToutLeGroupe(role), restaurantId })
      .then(d => { if (vivant) setTexte(texteRappel(compterAujourdhui(construireLignes({ ...d, aujourdhui }), aujourdhui))) })
      .catch(() => { if (vivant) setTexte(null) })
    return () => { vivant = false }
  }, [role, restaurantId]))

  if (!texte) return null
  return (
    <Survol onPress={() => router.push('/evenements')} accessibilityRole="button" accessibilityLabel={`${texte}. Ouvrir les événements.`}
      style={[styles.bandeau, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} echelle={1.01} styleSurvol={{ borderColor: colors.primary + '66' }}>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: colors.text }}>{texte}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </Survol>
  )
}
```

- [ ] **Step 2 : l'afficher sur l'accueil**

Dans `components/accueil/AccueilManager.js`, ajouter l'import après celui de `SqueletteBandeau` :

```js
import RappelEvenements from '../evenements/RappelEvenements'
```

Puis, dans le rendu de `AccueilManager`, juste après le bloc du bandeau et avant `{favoris.length > 0 && (` :

```jsx
      <RappelEvenements role={role} restaurantId={restaurantId} styles={styles} colors={colors} />
```

- [ ] **Step 3 : tout vérifier**

Run : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done; npm run lint 2>&1 | tail -4; npx expo export -p web 2>&1 | tail -3; grep -l "Envoyer un message" dist/_expo/static/js/web/*.js`
Expected : aucun `ECHEC`, `0 errors`, export réussi, et au moins un fichier trouvé par `grep` (le fragment choisi est sans accent, car le bundle échappe les accents).

- [ ] **Step 4 : mettre le graphe à jour**

Run : `graphify update .`

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add components/evenements/RappelEvenements.js components/accueil/AccueilManager.js
git commit -m "feat(evenements): rappel du jour sur l'accueil

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6 : préparer la remise, sans publier**

Demander à l'utilisateur :
1. l'autorisation de passer `supabase_evenements.sql` sur le projet Samtrackly (`wlwotzxnzowbkbfcpnyi`), puis contrôler que la requête finale renvoie `table_ok = 1` et `roles_avec_tuile = 2` ;
2. de tester sur son localhost : un travailleur avec date de naissance, le message modifié puis envoyé par WhatsApp et par SMS, un événement ajouté, modifié et supprimé, et l'écran vu avec un compte gérant (pas d'âge, pas de bouton d'ajout) ;
3. son feu vert pour la publication Vercel + EAS, à faire seulement après la migration.
