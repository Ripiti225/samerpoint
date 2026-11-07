# Jours fériés ivoiriens et alertes de stock — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter à l'espace Événements les jours fériés ivoiriens (bouton dans l'application et fichier `.ics`) et des alertes de stock à J-7 et J-2, avec le chiffre réel de hausse, sur l'accueil et par notification.

**Architecture :** la logique est pure dans `lib/joursFeries.js` et `lib/alertesStock.js`, partagée entre l'application et l'Edge Function `alertes-stock`, qui suit le modèle de `rappels-tresorerie`. L'interface s'ajoute à `app/evenements.js` et à l'accueil.

**Tech Stack :** React Native / Expo Router, Supabase (Edge Function Deno, `pg_cron`), `node:test`.

**Conception :** `docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md`.

## Global Constraints

- Interface et messages en français courant, sans code technique.
- Jamais de date tapée : toute date passe par `ChampDate`.
- Aucune quantité de produit dans une alerte : seulement le chiffre réel de hausse, ou aucun chiffre.
- La vente d'un point passe par `venteRetenue` de `lib/venteMachine.js`.
- `lib/joursFeries.js` et `lib/alertesStock.js` n'importent que des fichiers purs avec l'extension `.js`, pour tourner sous `node` et dans l'Edge Function.
- `journaliser` ne bloque jamais une action.
- Un échec de chargement sur l'accueil masque la ligne sans bloquer l'accueil.
- `git` : préfixer par `export DEVELOPER_DIR=/Library/Developer/CommandLineTools`. Ne jamais lancer `git add -A` : `.claude/settings.json` et `graphify-out/` ne doivent pas être committés, et une autre session peut travailler dans ce dossier.
- Ne jamais lancer `expo start` ni `localhost`, ni `CI=1`.
- **Dans ce plan : ne passer aucune migration, ne déployer aucune fonction, ne créer aucune tâche programmée, ne rien publier.** Les fichiers sont seulement écrits ; la mise en service se fait après accord de l'utilisateur.
- Commit et push à chaque tâche.
- Tests : `node lib/<fichier>.test.mjs` ; tout : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done`.

---

### Task 1 : liste des jours fériés et fichier `.ics`

**Files :**
- Create : `lib/joursFeries.js`
- Test : `lib/joursFeries.test.mjs`

**Interfaces :**
- Produces (depuis `lib/joursFeries.js`) :
  - `ANNEES_FERIES: number[]`, `ajouterJours(iso, n) → iso`, `datePaques(annee) → iso`
  - `joursFeriesAnnee(annee) → [{ cle, titre, date, estimee }]`, triés par date
  - `lignesFeries(annee, creePar) → lignes à insérer dans evenements_groupe`
  - `listeDeLAnnee(annee, evenements) → [{ cle, titre, date, estimee, evenement }]` ; `evenement` vaut `null` si la fête n'est pas encore en base
  - `fichierIcs(feries, maintenant) → string`, `nomFichierIcs(annee) → string`, `texteVersBase64(texte) → string`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/joursFeries.test.mjs` :

```js
// Tests de lib/joursFeries.js — liste des fériés ivoiriens et fichier .ics.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ANNEES_FERIES, ajouterJours, datePaques, fichierIcs, joursFeriesAnnee, lignesFeries, listeDeLAnnee, nomFichierIcs, texteVersBase64,
} from './joursFeries.js'

test('Pâques : dates connues', () => {
  assert.equal(datePaques(2026), '2026-04-05')
  assert.equal(datePaques(2027), '2027-03-28')
  assert.equal(datePaques(2030), '2030-04-21')
})

test('ajouterJours : passage de mois et d\'année', () => {
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01')
  assert.equal(ajouterJours('2027-01-01', -7), '2026-12-25')
})

test('année 2027 : 14 fêtes, triées, dates attendues', () => {
  const l = joursFeriesAnnee(2027)
  assert.equal(l.length, 14)
  assert.deepEqual(l.map(f => f.date), [...l.map(f => f.date)].sort())
  const date = cle => l.find(f => f.cle === cle).date
  assert.equal(date('nuit_destin'), '2027-03-07')
  assert.equal(date('korite'), '2027-03-09')
  assert.equal(date('lundi_paques'), '2027-03-29')
  assert.equal(date('ascension'), '2027-05-06')
  assert.equal(date('tabaski'), '2027-05-16')
  assert.equal(date('lundi_pentecote'), '2027-05-17')
  assert.equal(date('maouloud'), '2027-08-15')
  assert.equal(date('paix'), '2027-11-15')
})

test('seules les fêtes lunaires sont estimées', () => {
  const estimees = joursFeriesAnnee(2027).filter(f => f.estimee).map(f => f.cle).sort()
  assert.deepEqual(estimees, ['korite', 'maouloud', 'nuit_destin', 'tabaski'])
})

test('toutes les années disponibles ont 14 fêtes ; 2025 n\'a pas les lunaires', () => {
  for (const a of ANNEES_FERIES) assert.equal(joursFeriesAnnee(a).length, 14, a)
  const l2025 = joursFeriesAnnee(2025)
  assert.equal(l2025.length, 10)
  assert.equal(l2025.some(f => f.estimee), false)
  assert.ok(l2025.some(f => f.cle === 'noel' && f.date === '2025-12-25'))
})

test('lignesFeries : prêtes à insérer, alerte active', () => {
  const lignes = lignesFeries(2027, 'Awa')
  assert.equal(lignes.length, 14)
  const t = lignes.find(l => l.ferie_cle === 'tabaski')
  assert.deepEqual(t, {
    titre: 'Tabaski', date_evenement: '2027-05-16', note: null, restaurant_id: null, chaque_annee: false,
    ferie_cle: 'tabaski', ferie_annee: 2027, date_estimee: true, alerte_stock: true, cree_par_nom: 'Awa',
  })
})

test('listeDeLAnnee : sans ligne en base, la liste de référence', () => {
  const l = listeDeLAnnee(2027, [{ id: 'x', ferie_cle: 'noel', ferie_annee: 2026, titre: 'Noël', date_evenement: '2026-12-25' }])
  assert.equal(l.length, 14)
  assert.equal(l.find(f => f.cle === 'noel').evenement, null)
})

test('listeDeLAnnee : avec des lignes, seules elles comptent, corrections comprises', () => {
  const tabaski = { id: 't', ferie_cle: 'tabaski', ferie_annee: 2027, titre: 'Tabaski', date_evenement: '2027-05-17', date_estimee: false }
  const noel = { id: 'n', ferie_cle: 'noel', ferie_annee: 2027, titre: 'Noël', date_evenement: '2027-12-25', date_estimee: false }
  const manuel = { id: 'm', ferie_cle: null, ferie_annee: null, titre: 'Réunion', date_evenement: '2027-01-02' }
  const l = listeDeLAnnee(2027, [noel, manuel, tabaski])
  assert.deepEqual(l.map(f => [f.cle, f.date, f.estimee]), [['tabaski', '2027-05-17', false], ['noel', '2027-12-25', false]])
  assert.equal(l[0].evenement, tabaski)
})

test('fichierIcs : journées entières, deux rappels, date estimée signalée, fins de ligne CRLF', () => {
  const ics = fichierIcs([{ cle: 'tabaski', titre: 'Tabaski', date: '2027-05-16', estimee: true }], '2026-11-07T10:20:30.000Z')
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.match(ics, /DTSTART;VALUE=DATE:20270516\r\n/)
  assert.match(ics, /DTEND;VALUE=DATE:20270517\r\n/)
  assert.match(ics, /DTSTAMP:20261107T102030Z\r\n/)
  assert.match(ics, /SUMMARY:Tabaski \(date estimée\)\r\n/)
  assert.match(ics, /UID:ferie-tabaski-2027-05-16@samtrackly\r\n/)
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 2)
  assert.match(ics, /TRIGGER:-P7D\r\n/)
  assert.match(ics, /TRIGGER:-P2D\r\n/)
})

test('fichierIcs : caractères spéciaux échappés et longues lignes pliées', () => {
  const ics = fichierIcs([{ cle: 'x', titre: `Fête, avec; ${'a'.repeat(100)}`, date: '2027-01-01', estimee: false }], '2026-11-07T10:20:30.000Z')
  assert.match(ics, /SUMMARY:Fête\\, avec\\; a+/)
  assert.ok(ics.split('\r\n').every(l => l.length <= 61))
})

test('nomFichierIcs', () => {
  assert.equal(nomFichierIcs(2027), 'jours-feries-ci-2027.ics')
})

test('texteVersBase64 : accents et emoji, comme Buffer', () => {
  for (const t of ['a', 'ab', 'abc', 'Fête nationale à Abidjan', 'Noël 🎄']) {
    assert.equal(texteVersBase64(t), Buffer.from(t, 'utf8').toString('base64'))
  }
})
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/joursFeries.test.mjs`
Expected : échec `Cannot find module` sur `./joursFeries.js`.

- [ ] **Step 3 : écrire la logique**

Créer `lib/joursFeries.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Jours fériés ivoiriens : liste par année et fichier .ics. Logique pure.
//
// Base : décret n° 96-205 du 7 mars 1996, modifié par le décret n° 2011-371.
// Les dates lunaires sont des ESTIMATIONS (calendrier Umm al-Qura) : la date
// officielle tombe quelques jours avant la fête et se corrige dans l'application.
// Conception : docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md
// Tests : lib/joursFeries.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')

export function ajouterJours(iso, n) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Dimanche de Pâques (calcul grégorien anonyme). */
export function datePaques(annee) {
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const q = h + l - 7 * m + 114
  return `${annee}-${pad(Math.floor(q / 31))}-${pad((q % 31) + 1)}`
}

const FIXES = [
  { cle: 'an', titre: "Jour de l'An", jour: '01-01' },
  { cle: 'travail', titre: 'Fête du Travail', jour: '05-01' },
  { cle: 'nationale', titre: 'Fête nationale', jour: '08-07' },
  { cle: 'assomption', titre: 'Assomption', jour: '08-15' },
  { cle: 'toussaint', titre: 'Toussaint', jour: '11-01' },
  { cle: 'paix', titre: 'Journée nationale de la Paix', jour: '11-15' },
  { cle: 'noel', titre: 'Noël', jour: '12-25' },
]

const CALCULEES = [
  { cle: 'lundi_paques', titre: 'Lundi de Pâques', decalage: 1 },
  { cle: 'ascension', titre: 'Ascension', decalage: 39 },
  { cle: 'lundi_pentecote', titre: 'Lundi de Pentecôte', decalage: 50 },
]

const TITRES_LUNAIRES = {
  nuit_destin: 'Lendemain de la Nuit du Destin',
  korite: 'Korité',
  tabaski: 'Tabaski',
  maouloud: 'Lendemain du Maouloud',
}

const DATES_LUNAIRES = {
  2026: { nuit_destin: '2026-03-17', korite: '2026-03-20', tabaski: '2026-05-27', maouloud: '2026-08-26' },
  2027: { nuit_destin: '2027-03-07', korite: '2027-03-09', tabaski: '2027-05-16', maouloud: '2027-08-15' },
  2028: { nuit_destin: '2028-02-24', korite: '2028-02-26', tabaski: '2028-05-05', maouloud: '2028-08-04' },
  2029: { nuit_destin: '2029-02-12', korite: '2029-02-14', tabaski: '2029-04-24', maouloud: '2029-07-25' },
  2030: { nuit_destin: '2030-02-01', korite: '2030-02-04', tabaski: '2030-04-13', maouloud: '2030-07-14' },
}

export const ANNEES_FERIES = Object.keys(DATES_LUNAIRES).map(Number)

export function joursFeriesAnnee(annee) {
  const paques = datePaques(annee)
  const lunaires = DATES_LUNAIRES[annee] || {}
  return [
    ...FIXES.map(f => ({ cle: f.cle, titre: f.titre, date: `${annee}-${f.jour}`, estimee: false })),
    ...CALCULEES.map(f => ({ cle: f.cle, titre: f.titre, date: ajouterJours(paques, f.decalage), estimee: false })),
    ...Object.entries(lunaires).map(([cle, date]) => ({ cle, titre: TITRES_LUNAIRES[cle], date, estimee: true })),
  ].sort((a, b) => a.date.localeCompare(b.date))
}

export function lignesFeries(annee, creePar) {
  return joursFeriesAnnee(annee).map(f => ({
    titre: f.titre,
    date_evenement: f.date,
    note: null,
    restaurant_id: null,
    chaque_annee: false,
    ferie_cle: f.cle,
    ferie_annee: annee,
    date_estimee: f.estimee,
    alerte_stock: true,
    cree_par_nom: creePar || null,
  }))
}

/**
 * Fêtes d'une année. Dès qu'une fête de cette année est en base, seules les
 * lignes en base comptent : une date corrigée la remplace, une fête supprimée
 * disparaît. Sinon, la liste de référence.
 */
export function listeDeLAnnee(annee, evenements) {
  const lignes = evenements.filter(e => e.ferie_cle && e.ferie_annee === annee)
  if (!lignes.length) return joursFeriesAnnee(annee).map(f => ({ ...f, evenement: null }))
  return lignes
    .map(e => ({
      cle: e.ferie_cle,
      titre: e.titre,
      date: String(e.date_evenement).slice(0, 10),
      estimee: !!e.date_estimee,
      evenement: e,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const echapperIcs = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const plier = l => (l.length <= 60 ? l : `${l.slice(0, 60)}\r\n ${plier(l.slice(60))}`)
const dateIcs = iso => iso.slice(0, 10).replace(/-/g, '')

function evenementIcs(f, horodatage) {
  const titre = `${f.titre}${f.estimee ? ' (date estimée)' : ''}`
  const rappel = (delai, jours) => [
    'BEGIN:VALARM', `TRIGGER:-P${jours}D`, 'ACTION:DISPLAY',
    `DESCRIPTION:${echapperIcs(`${f.titre} dans ${delai}`)}`, 'END:VALARM',
  ]
  return [
    'BEGIN:VEVENT',
    `UID:ferie-${f.cle}-${f.date}@samtrackly`,
    `DTSTAMP:${horodatage}`,
    `DTSTART;VALUE=DATE:${dateIcs(f.date)}`,
    `DTEND;VALUE=DATE:${dateIcs(ajouterJours(f.date, 1))}`,
    `SUMMARY:${echapperIcs(titre)}`,
    ...rappel('7 jours', 7),
    ...rappel('2 jours', 2),
    'END:VEVENT',
  ]
}

/** `maintenant` : date ISO complète, passée en paramètre pour rester testable. */
export function fichierIcs(feries, maintenant) {
  const horodatage = `${maintenant.slice(0, 19).replace(/[-:]/g, '')}Z`
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Samtrackly//Jours feries CI//FR', 'CALSCALE:GREGORIAN',
    ...feries.flatMap(f => evenementIcs(f, horodatage)),
    'END:VCALENDAR',
  ]
  return `${lignes.map(plier).join('\r\n')}\r\n`
}

export const nomFichierIcs = annee => `jours-feries-ci-${annee}.ics`

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** UTF-8 puis base64, sans dépendre de btoa ni de Buffer (web et téléphone). */
export function texteVersBase64(texte) {
  const code = encodeURIComponent(texte)
  const octets = []
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '%') { octets.push(parseInt(code.slice(i + 1, i + 3), 16)); i += 2 } else octets.push(code.charCodeAt(i))
  }
  let sortie = ''
  for (let i = 0; i < octets.length; i += 3) {
    const [a, b, c] = [octets[i], octets[i + 1], octets[i + 2]]
    sortie += ALPHABET[a >> 2]
    sortie += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
    sortie += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
    sortie += c === undefined ? '=' : ALPHABET[c & 63]
  }
  return sortie
}
```

- [ ] **Step 4 : vérifier la réussite**

Run : `node lib/joursFeries.test.mjs`
Expected : tous les tests passent.

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/joursFeries.js lib/joursFeries.test.mjs
git commit -m "feat(evenements): liste des jours fériés ivoiriens et fichier de calendrier

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2 : logique des alertes de stock

**Files :**
- Create : `lib/alertesStock.js`
- Test : `lib/alertesStock.test.mjs`

**Interfaces :**
- Consumes : `ajouterJours`, `joursFeriesAnnee` de `lib/joursFeries.js` ; `dateDansAnnee`, `construireLignes` de `lib/evenements.js` ; `venteRetenue` de `lib/venteMachine.js`.
- Produces (depuis `lib/alertesStock.js`) :
  - `DELAIS_ALERTE = [7, 2]`, `DELAIS_ACCUEIL = [0, 1, 2, 3, 4, 5, 6, 7]`
  - `elementsAlerte(evenements, aujourdhui, delais) → [{ evenement, date, delai }]`
  - `editionPrecedente(evenement, date, evenements) → iso | null`
  - `joursReference(date) → iso[]`
  - `ventesParRestaurant(points) → { [restaurantId]: { [date]: vente } }`
  - `hausseRestaurant(ventes, date) → number | null`, `hausseGroupe(ventesParResto, date) → { pct, nb }`
  - `datesUtiles(elements, evenements) → iso[]`
  - `titreAlerte(titre, delai, estimee) → string`, `corpsAlerte({ pct, nb }) → string`
  - `itemsPour(utilisateur, { elements, evenements, ventes }) → [{ cle, titre, corps }]`
  - `regrouper(items) → { titre, corps } | null`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/alertesStock.test.mjs` :

```js
// Tests de lib/alertesStock.js — échéances, hausse réelle, textes, destinataires.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DELAIS_ALERTE, corpsAlerte, datesUtiles, editionPrecedente, elementsAlerte, hausseGroupe, hausseRestaurant, itemsPour,
  joursReference, regrouper, titreAlerte, ventesParRestaurant,
} from './alertesStock.js'

const ferie = (o = {}) => ({
  id: 'e1', titre: 'Tabaski', date_evenement: '2027-05-16', chaque_annee: false, restaurant_id: null,
  ferie_cle: 'tabaski', ferie_annee: 2027, date_estimee: true, alerte_stock: true, ...o,
})

test('elementsAlerte : exactement J-7 et J-2, alerte active seulement', () => {
  const evts = [
    ferie({ id: 'a', date_evenement: '2027-05-16' }),
    ferie({ id: 'b', date_evenement: '2027-05-11' }),
    ferie({ id: 'c', date_evenement: '2027-05-12' }),
    ferie({ id: 'd', date_evenement: '2027-05-16', alerte_stock: false }),
  ]
  const r = elementsAlerte(evts, '2027-05-09', DELAIS_ALERTE)
  assert.deepEqual(r.map(x => [x.evenement.id, x.delai]), [['b', 2], ['a', 7]])
})

test('elementsAlerte : un événement « chaque année » suit sa prochaine date', () => {
  const r = elementsAlerte([ferie({ id: 'n', ferie_cle: null, ferie_annee: null, date_evenement: '2020-12-25', chaque_annee: true })], '2026-12-18', DELAIS_ALERTE)
  assert.deepEqual(r.map(x => [x.date, x.delai]), [['2026-12-25', 7]])
})

test('editionPrecedente : une date lunaire doit être confirmée', () => {
  const t = ferie()
  assert.equal(editionPrecedente(t, '2027-05-16', []), null)
  const estimee = ferie({ id: 'p', ferie_annee: 2026, date_evenement: '2026-05-27', date_estimee: true })
  assert.equal(editionPrecedente(t, '2027-05-16', [estimee]), null)
  const confirmee = { ...estimee, date_estimee: false }
  assert.equal(editionPrecedente(t, '2027-05-16', [confirmee]), '2026-05-27')
})

test('editionPrecedente : fête fixe ou calculée sans ligne en base', () => {
  const noel = ferie({ ferie_cle: 'noel', ferie_annee: 2026, date_evenement: '2026-12-25', date_estimee: false })
  assert.equal(editionPrecedente(noel, '2026-12-25', []), '2025-12-25')
  const paques = ferie({ ferie_cle: 'lundi_paques', ferie_annee: 2027, date_evenement: '2027-03-29', date_estimee: false })
  assert.equal(editionPrecedente(paques, '2027-03-29', []), '2026-04-06')
})

test('editionPrecedente : événement à la main', () => {
  const base = { id: 'm', ferie_cle: null, ferie_annee: null, restaurant_id: null, alerte_stock: true }
  assert.equal(editionPrecedente({ ...base, chaque_annee: true }, '2026-12-31', []), '2025-12-31')
  assert.equal(editionPrecedente({ ...base, chaque_annee: false }, '2026-12-31', []), null)
})

test('joursReference : 4 mêmes jours de semaine, sans les jours fériés', () => {
  assert.deepEqual(joursReference('2026-05-27'), ['2026-05-20', '2026-05-13', '2026-05-06', '2026-04-29'])
  assert.deepEqual(joursReference('2027-01-01'), ['2026-12-18', '2026-12-11', '2026-12-04'])
})

test('ventesParRestaurant : vente machine, sinon théorique', () => {
  const v = ventesParRestaurant([
    { restaurant_id: 'r1', date: '2026-05-27', vente_machine: 500, vente_total: 400 },
    { restaurant_id: 'r1', date: '2026-05-20', vente_machine: 0, vente_total: 300 },
  ])
  assert.deepEqual(v, { r1: { '2026-05-27': 500, '2026-05-20': 300 } })
})

const ventesFete = {
  '2026-05-27': 4500, '2026-05-20': 3000, '2026-05-13': 3000, '2026-05-06': 3000, '2026-04-29': 3000,
}

test('hausseRestaurant : pourcentage réel, ou rien si les données manquent', () => {
  assert.equal(hausseRestaurant(ventesFete, '2026-05-27'), 50)
  assert.equal(hausseRestaurant({ ...ventesFete, '2026-05-27': 0 }, '2026-05-27'), null)
  assert.equal(hausseRestaurant({ '2026-05-27': 4500, '2026-05-20': 3000 }, '2026-05-27'), null)
  assert.equal(hausseRestaurant({ '2026-05-27': 4500, '2026-05-20': 3000, '2026-05-13': 1000 }, '2026-05-27'), 125)
})

test('hausseGroupe : sommes des restaurants qui ont un chiffre, et leur nombre', () => {
  const r = hausseGroupe({
    r1: ventesFete,
    r2: { '2026-05-27': 1500, '2026-05-20': 1000, '2026-05-13': 1000 },
    r3: { '2026-05-27': 9000 },
  }, '2026-05-27')
  assert.deepEqual(r, { pct: 50, nb: 2 })
  assert.deepEqual(hausseGroupe({}, '2026-05-27'), { pct: null, nb: 0 })
})

test('datesUtiles : édition précédente et ses jours de référence, sans doublon', () => {
  const noel = ferie({ ferie_cle: 'noel', ferie_annee: 2026, date_evenement: '2026-12-25', date_estimee: false })
  const dates = datesUtiles([{ evenement: noel, date: '2026-12-25', delai: 7 }, { evenement: noel, date: '2026-12-25', delai: 2 }], [])
  assert.deepEqual(dates, ['2025-11-27', '2025-12-04', '2025-12-11', '2025-12-18', '2025-12-25'])
  assert.deepEqual(datesUtiles([{ evenement: ferie(), date: '2027-05-16', delai: 7 }], []), [])
})

test('titreAlerte : délai en clair et date estimée', () => {
  assert.equal(titreAlerte('Tabaski', 7, true), '📦 Tabaski dans 7 jours (date estimée)')
  assert.equal(titreAlerte('Noël', 2, false), '📦 Noël après-demain')
  assert.equal(titreAlerte('Noël', 1, false), '📦 Noël demain')
  assert.equal(titreAlerte('Noël', 0, false), "📦 Noël aujourd'hui")
})

test('corpsAlerte : quatre cas, jamais de quantité', () => {
  assert.equal(corpsAlerte({ pct: 45 }), "L'an dernier ce jour-là : +45 % de ventes. Pensez à rehausser le stock.")
  assert.equal(corpsAlerte({ pct: 10 }), "L'an dernier ce jour-là : +10 % de ventes. Pensez à rehausser le stock.")
  assert.equal(corpsAlerte({ pct: 9 }), "L'an dernier ce jour-là : ventes proches d'un jour normal. Vérifiez votre stock.")
  assert.equal(corpsAlerte({ pct: -9 }), "L'an dernier ce jour-là : ventes proches d'un jour normal. Vérifiez votre stock.")
  assert.equal(corpsAlerte({ pct: -10 }), "L'an dernier ce jour-là : −10 % de ventes. Vérifiez votre stock avant de commander.")
  assert.equal(corpsAlerte({ pct: null }), 'Pensez à vérifier et rehausser le stock.')
  assert.equal(corpsAlerte({ pct: 45, nb: 7 }), "L'an dernier ce jour-là : +45 % de ventes (7 restaurants). Pensez à rehausser le stock.")
  assert.equal(corpsAlerte({ pct: 45, nb: 1 }), "L'an dernier ce jour-là : +45 % de ventes (1 restaurant). Pensez à rehausser le stock.")
})

const contexte = () => {
  const passe = ferie({ id: 'p', ferie_annee: 2026, date_evenement: '2026-05-27', date_estimee: false })
  return {
    elements: [{ evenement: ferie(), date: '2027-05-16', delai: 7 }],
    evenements: [passe],
    ventes: { r1: ventesFete, r2: { '2026-05-27': 1000, '2026-05-20': 1000, '2026-05-13': 1000 } },
  }
}

test('itemsPour : le gérant a le chiffre de son restaurant', () => {
  const [i] = itemsPour({ id: 'g', role: 'gerant', restaurant_id: 'r1' }, contexte())
  assert.equal(i.cle, 'stock|e1|2027-05-16|7|g')
  assert.equal(i.titre, '📦 Tabaski dans 7 jours (date estimée)')
  assert.equal(i.corps, "L'an dernier ce jour-là : +50 % de ventes. Pensez à rehausser le stock.")
})

test('itemsPour : la direction et la RH ont le chiffre du groupe', () => {
  for (const role of ['manager', 'directeur', 'rh']) {
    const [i] = itemsPour({ id: 'd', role, restaurant_id: null }, contexte())
    assert.match(i.corps, /\+38 % de ventes \(2 restaurants\)/)
  }
})

test('itemsPour : un événement d\'un restaurant n\'alerte pas les autres gérants', () => {
  const c = contexte()
  c.elements = [{ evenement: ferie({ restaurant_id: 'r1' }), date: '2027-05-16', delai: 7 }]
  assert.equal(itemsPour({ id: 'g2', role: 'gerant', restaurant_id: 'r2' }, c).length, 0)
  assert.equal(itemsPour({ id: 'g1', role: 'gerant', restaurant_id: 'r1' }, c).length, 1)
  assert.match(itemsPour({ id: 'd', role: 'manager', restaurant_id: null }, c)[0].corps, /\+50 % de ventes\. /)
})

test('itemsPour : caissier ou gérant sans restaurant ne reçoivent rien', () => {
  assert.equal(itemsPour({ id: 'c', role: 'caissier', restaurant_id: 'r1' }, contexte()).length, 0)
  assert.equal(itemsPour({ id: 'g', role: 'gerant', restaurant_id: null }, contexte()).length, 0)
})

test('regrouper : un message par personne', () => {
  assert.equal(regrouper([]), null)
  assert.deepEqual(regrouper([{ cle: 'a', titre: 'T', corps: 'C' }]), { titre: 'T', corps: 'C' })
  assert.deepEqual(
    regrouper([{ cle: 'a', titre: '📦 Tabaski dans 7 jours', corps: 'C1' }, { cle: 'b', titre: '📦 Noël après-demain', corps: 'C2' }]),
    { titre: '📦 2 fêtes approchent', corps: 'Tabaski dans 7 jours : C1\nNoël après-demain : C2' },
  )
})
```

Le chiffre du groupe attendu `+38 %` vient de : fête `4500 + 1000 = 5500`, moyenne `3000 + 1000 = 4000`, soit `37,5` arrondi à `38`.

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/alertesStock.test.mjs`
Expected : échec `Cannot find module` sur `./alertesStock.js`.

- [ ] **Step 3 : écrire la logique**

Créer `lib/alertesStock.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Alertes de stock avant une fête : échéances, hausse réelle, textes,
// destinataires. Logique pure, partagée avec l'Edge Function alertes-stock.
// Jamais de quantité par produit : un chiffre réel de ventes, ou aucun chiffre.
// Conception : docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md
// Tests : lib/alertesStock.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { construireLignes, dateDansAnnee } from './evenements.js'
import { ajouterJours, joursFeriesAnnee } from './joursFeries.js'
import { venteRetenue } from './venteMachine.js'

export const DELAIS_ALERTE = [7, 2]
export const DELAIS_ACCUEIL = [0, 1, 2, 3, 4, 5, 6, 7]

const ROLES_GROUPE = ['manager', 'directeur', 'rh']
const NB_REFERENCES = 4
const MIN_REFERENCES = 2
const SEUIL = 10

const anneeDe = iso => Number(String(iso).slice(0, 4))

function joursEntre(debut, fin) {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86400000)
}

export function elementsAlerte(evenements, aujourdhui, delais) {
  const avecAlerte = evenements.filter(e => e.alerte_stock)
  return construireLignes({ travailleurs: [], evenements: avecAlerte, aujourdhui })
    .map(l => ({ evenement: l.evenement, date: l.date, delai: joursEntre(aujourdhui, l.date) }))
    .filter(x => delais.includes(x.delai))
}

/** Date de la dernière édition, seulement si elle est sûre. */
export function editionPrecedente(evenement, date, evenements) {
  if (evenement.ferie_cle) {
    const annee = anneeDe(date) - 1
    const ligne = evenements.find(e => e.ferie_cle === evenement.ferie_cle && e.ferie_annee === annee)
    if (ligne) return ligne.date_estimee ? null : String(ligne.date_evenement).slice(0, 10)
    const reference = joursFeriesAnnee(annee).find(f => f.cle === evenement.ferie_cle)
    return reference && !reference.estimee ? reference.date : null
  }
  return evenement.chaque_annee ? dateDansAnnee(date, anneeDe(date) - 1) : null
}

export function joursReference(date) {
  const annee = anneeDe(date)
  const feries = new Set([...joursFeriesAnnee(annee), ...joursFeriesAnnee(annee - 1)].map(f => f.date))
  return Array.from({ length: NB_REFERENCES }, (_, i) => ajouterJours(date, -7 * (i + 1))).filter(d => !feries.has(d))
}

export function ventesParRestaurant(points) {
  const ventes = {}
  for (const p of points) {
    ventes[p.restaurant_id] = ventes[p.restaurant_id] || {}
    ventes[p.restaurant_id][String(p.date).slice(0, 10)] = venteRetenue(p)
  }
  return ventes
}

function chiffresFete(ventes, date) {
  const fete = ventes[date]
  if (!fete) return null
  const references = joursReference(date).map(d => ventes[d]).filter(v => v > 0)
  if (references.length < MIN_REFERENCES) return null
  return { fete, moyenne: references.reduce((s, v) => s + v, 0) / references.length }
}

const pourcentage = (fete, moyenne) => Math.round(((fete - moyenne) / moyenne) * 100)

export function hausseRestaurant(ventes, date) {
  const c = chiffresFete(ventes, date)
  return c ? pourcentage(c.fete, c.moyenne) : null
}

export function hausseGroupe(ventesParResto, date) {
  const chiffres = Object.values(ventesParResto).map(v => chiffresFete(v, date)).filter(Boolean)
  if (!chiffres.length) return { pct: null, nb: 0 }
  const fete = chiffres.reduce((s, c) => s + c.fete, 0)
  const moyenne = chiffres.reduce((s, c) => s + c.moyenne, 0)
  return { pct: pourcentage(fete, moyenne), nb: chiffres.length }
}

/** Les seules dates de ventes à lire pour calculer les chiffres. */
export function datesUtiles(elements, evenements) {
  const dates = new Set()
  for (const { evenement, date } of elements) {
    const precedente = editionPrecedente(evenement, date, evenements)
    if (!precedente) continue
    dates.add(precedente)
    for (const d of joursReference(precedente)) dates.add(d)
  }
  return [...dates].sort()
}

function delaiEnClair(delai) {
  if (delai === 0) return "aujourd'hui"
  if (delai === 1) return 'demain'
  if (delai === 2) return 'après-demain'
  return `dans ${delai} jours`
}

export function titreAlerte(titre, delai, estimee) {
  return `📦 ${titre} ${delaiEnClair(delai)}${estimee ? ' (date estimée)' : ''}`
}

export function corpsAlerte({ pct, nb }) {
  if (pct === null || pct === undefined) return 'Pensez à vérifier et rehausser le stock.'
  const portee = nb ? ` (${nb} restaurant${nb > 1 ? 's' : ''})` : ''
  if (pct >= SEUIL) return `L'an dernier ce jour-là : +${pct} % de ventes${portee}. Pensez à rehausser le stock.`
  if (pct <= -SEUIL) return `L'an dernier ce jour-là : −${-pct} % de ventes${portee}. Vérifiez votre stock avant de commander.`
  return `L'an dernier ce jour-là : ventes proches d'un jour normal${portee}. Vérifiez votre stock.`
}

function concerne(utilisateur, evenement) {
  if (ROLES_GROUPE.includes(utilisateur.role)) return true
  if (utilisateur.role !== 'gerant' || !utilisateur.restaurant_id) return false
  return !evenement.restaurant_id || evenement.restaurant_id === utilisateur.restaurant_id
}

function chiffrePour(utilisateur, { evenement, date }, { evenements, ventes }) {
  const precedente = editionPrecedente(evenement, date, evenements)
  if (!precedente) return { pct: null }
  const restaurant = evenement.restaurant_id || (utilisateur.role === 'gerant' ? utilisateur.restaurant_id : null)
  return restaurant ? { pct: hausseRestaurant(ventes[restaurant] || {}, precedente) } : hausseGroupe(ventes, precedente)
}

export function itemsPour(utilisateur, contexte) {
  return contexte.elements
    .filter(el => concerne(utilisateur, el.evenement))
    .map(el => ({
      cle: `stock|${el.evenement.id}|${el.date}|${el.delai}|${utilisateur.id}`,
      titre: titreAlerte(el.evenement.titre, el.delai, !!el.evenement.date_estimee),
      corps: corpsAlerte(chiffrePour(utilisateur, el, contexte)),
    }))
}

/** Plusieurs fêtes le même jour : un seul message par personne. */
export function regrouper(items) {
  if (!items.length) return null
  if (items.length === 1) return { titre: items[0].titre, corps: items[0].corps }
  return {
    titre: `📦 ${items.length} fêtes approchent`,
    corps: items.map(i => `${i.titre.replace('📦 ', '')} : ${i.corps}`).join('\n'),
  }
}
```

- [ ] **Step 4 : vérifier la réussite**

Run : `node lib/alertesStock.test.mjs`
Expected : tous les tests passent.

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/alertesStock.js lib/alertesStock.test.mjs
git commit -m "feat(evenements): logique des alertes de stock avant une fête

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 3 : migration, base, formulaire et feuille des jours fériés

**Files :**
- Create : `supabase_jours_feries.sql`, `components/evenements/FeuilleJoursFeries.js`
- Modify : `lib/evenements.js`, `lib/evenements.test.mjs`, `lib/evenementsDb.js`, `components/evenements/FeuilleEvenement.js`, `components/evenements/LigneEvenement.js`, `app/evenements.js`

**Interfaces :**
- Consumes : `ANNEES_FERIES`, `fichierIcs`, `lignesFeries`, `listeDeLAnnee`, `nomFichierIcs`, `texteVersBase64` de `lib/joursFeries.js`.
- Produces :
  - `ajouterJoursFeries(annee, ctx) → Promise<number>` dans `lib/evenementsDb.js` : le nombre de fêtes réellement ajoutées.
  - `FeuilleJoursFeries({ visible, evenements, peutGerer, ctx, styles, colors, principale, onFermer, onAjoute, onModifier })`.
  - `erreurEvenement` accepte une date passée si `form.ferie_cle` est rempli ; `champsEvenement` renvoie aussi `alerte_stock` et `date_estimee`.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `lib/evenements.test.mjs`, remplacer le `assert.deepEqual` de `champsEvenement` du test « événement : titre et date obligatoires, champs nettoyés » par :

```js
  assert.deepEqual(
    champsEvenement({ titre: ' Noël ', date_evenement: '2026-12-25', note: ' ', restaurant_id: '', chaque_annee: true }),
    { titre: 'Noël', date_evenement: '2026-12-25', note: null, restaurant_id: null, chaque_annee: true, alerte_stock: false, date_estimee: false },
  )
```

Puis ajouter à la fin du fichier :

```js
test('jour férié : une date passée reste permise pour confirmer une édition précédente', () => {
  const form = { titre: 'Tabaski', date_evenement: '2026-05-27', chaque_annee: false, ferie_cle: 'tabaski' }
  assert.equal(erreurEvenement(form, '2026-11-07'), null)
  assert.equal(erreurEvenement({ ...form, ferie_cle: null }, '2026-11-07'), 'Choisissez une date à venir.')
})

test('champsEvenement : alerte et date estimée, sans écrire la clé du jour férié', () => {
  const c = champsEvenement({ titre: 'Tabaski', date_evenement: '2027-05-16', alerte_stock: true, date_estimee: true, ferie_cle: 'tabaski' })
  assert.equal(c.alerte_stock, true)
  assert.equal(c.date_estimee, true)
  assert.equal('ferie_cle' in c, false)
})
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/evenements.test.mjs`
Expected : échec sur ces deux nouveaux tests et sur le test modifié.

- [ ] **Step 3 : adapter la logique**

Dans `lib/evenements.js`, dans `erreurEvenement`, faire que le refus de date passée ne s'applique qu'aux événements sans `ferie_cle`. Lire la fonction, puis ajouter `&& !form.ferie_cle` à sa condition existante sur la date passée, sans rien changer d'autre.

Dans `champsEvenement`, ajouter à l'objet renvoyé :

```js
    alerte_stock: !!form.alerte_stock,
    date_estimee: !!form.date_estimee,
```

Run : `node lib/evenements.test.mjs`
Expected : tous les tests passent.

- [ ] **Step 4 : écrire la migration**

Créer `supabase_jours_feries.sql` :

```sql
-- Jours fériés ivoiriens et alertes de stock. À passer après supabase_evenements.sql.
-- Conception : docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md

alter table public.evenements_groupe add column if not exists ferie_cle text;
alter table public.evenements_groupe add column if not exists ferie_annee integer;
alter table public.evenements_groupe add column if not exists date_estimee boolean not null default false;
alter table public.evenements_groupe add column if not exists alerte_stock boolean not null default false;

-- Une fête par année. Les événements saisis à la main ont ces colonnes vides :
-- deux valeurs vides ne sont jamais en conflit.
create unique index if not exists evenements_groupe_ferie_unique
  on public.evenements_groupe (ferie_cle, ferie_annee);

-- Une alerte déjà envoyée ne repart pas. Écrite seulement par l'Edge Function
-- (clé de service) : aucun accès depuis l'application.
create table if not exists public.alertes_stock_envoyees (
  cle text primary key,
  message text,
  created_at timestamptz not null default now()
);
alter table public.alertes_stock_envoyees enable row level security;
revoke all on public.alertes_stock_envoyees from anon, authenticated;

-- Contrôle : 4 colonnes, 1 index, 1 table.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'evenements_groupe' and column_name in ('ferie_cle', 'ferie_annee', 'date_estimee', 'alerte_stock')) as colonnes,
  (select count(*) from pg_indexes where indexname = 'evenements_groupe_ferie_unique') as index_ok,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'alertes_stock_envoyees') as table_ok;
```

- [ ] **Step 5 : ajouter l'écriture en base**

Dans `lib/evenementsDb.js`, ajouter à l'import de `./journal` rien de nouveau, ajouter en tête :

```js
import { lignesFeries } from './joursFeries'
```

Puis à la fin du fichier :

```js
/** Ajoute les fériés d'une année. Une fête déjà présente n'est ni dupliquée ni écrasée. */
export async function ajouterJoursFeries(annee, ctx) {
  const { data, error } = await supabase.from('evenements_groupe')
    .upsert(lignesFeries(annee, ctx.userNom), { onConflict: 'ferie_cle,ferie_annee', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  const nombre = data?.length || 0
  if (nombre) {
    journaliser(ACTIONS.EVENEMENT_AJOUTE, { titre: `Jours fériés ${annee}`, nombre },
      { userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
  }
  return nombre
}
```

- [ ] **Step 6 : compléter le formulaire**

Dans `components/evenements/FeuilleEvenement.js` :

Remplacer la constante `VIDE` par :

```js
const VIDE = { titre: '', date_evenement: '', note: '', restaurant_id: '', chaque_annee: false, alerte_stock: false, date_estimee: false, ferie_cle: null }
```

Dans le `setForm(evenement ? {`, ajouter après `chaque_annee: !!evenement.chaque_annee,` :

```js
      alerte_stock: !!evenement.alerte_stock,
      date_estimee: !!evenement.date_estimee,
      ferie_cle: evenement.ferie_cle || null,
```

Après le bloc `Puces` de la fréquence, ajouter :

```jsx
      {form.ferie_cle ? (
        <>
          <Libelle styles={styles}>Date officielle</Libelle>
          <Puces styles={styles} actif={form.date_estimee} onChoisir={maj('date_estimee')}
            elements={[{ cle: true, label: 'Estimée' }, { cle: false, label: 'Confirmée' }]} />
        </>
      ) : null}

      <Libelle styles={styles}>Alerte stock (7 et 2 jours avant)</Libelle>
      <Puces styles={styles} actif={form.alerte_stock} onChoisir={maj('alerte_stock')}
        elements={[{ cle: true, label: 'Oui' }, { cle: false, label: 'Non' }]} />
```

- [ ] **Step 7 : afficher la date estimée dans le fil**

Dans `components/evenements/LigneEvenement.js`, remplacer la dernière ligne de la fonction `libelle` par :

```js
  const e = ligne.evenement
  const base = e.ferie_cle ? '🇨🇮 Jour férié' : e.chaque_annee ? '📅 Chaque année' : '📅 Événement'
  return e.date_estimee ? `${base} · date estimée` : base
```

- [ ] **Step 8 : écrire la feuille des jours fériés**

Créer `components/evenements/FeuilleJoursFeries.js` :

```js
// Jours fériés ivoiriens : choisir l'année, les ajouter (direction, RH),
// corriger une fête, télécharger le fichier pour le calendrier du téléphone.
import { useMemo, useState } from 'react'
import { Alert, Text, TouchableOpacity, View } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { libelleJour } from '../../lib/evenements'
import { ajouterJoursFeries } from '../../lib/evenementsDb'
import { enregistrer } from '../../lib/exportRapportMensuel'
import { ANNEES_FERIES, fichierIcs, listeDeLAnnee, nomFichierIcs, texteVersBase64 } from '../../lib/joursFeries'
import { Bouton, Feuille, Libelle, Puces } from '../ui/EcranModerne'

export default function FeuilleJoursFeries({ visible, evenements, peutGerer, ctx, styles, colors, principale, onFermer, onAjoute, onModifier }) {
  const aujourdhui = aujourdhuiISO()
  const premiere = ANNEES_FERIES.find(a => a >= Number(aujourdhui.slice(0, 4)) + 1) || ANNEES_FERIES[0]
  const [annee, setAnnee] = useState(premiere)
  const [occupe, setOccupe] = useState(false)

  const liste = useMemo(() => listeDeLAnnee(annee, evenements), [annee, evenements])
  const dejaAjoutee = liste.some(f => f.evenement)

  async function ajouter() {
    setOccupe(true)
    try {
      const nombre = await ajouterJoursFeries(annee, ctx)
      Alert.alert('Jours fériés', nombre ? `${nombre} jours fériés ajoutés pour ${annee}.` : `Les jours fériés de ${annee} sont déjà ajoutés.`)
      onAjoute()
    } catch {
      Alert.alert('Jours fériés', "Les jours fériés n'ont pas pu être ajoutés. Réessayez.")
    } finally {
      setOccupe(false)
    }
  }

  async function telecharger() {
    try {
      const base64 = texteVersBase64(fichierIcs(liste, new Date().toISOString()))
      await enregistrer(nomFichierIcs(annee), { base64 }, 'text/calendar')
    } catch {
      Alert.alert('Téléchargement', "Le fichier n'a pas pu être téléchargé. Réessayez.")
    }
  }

  return (
    <Feuille visible={visible} titre="🇨🇮 Jours fériés ivoiriens" onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Année</Libelle>
      <Puces styles={styles} actif={annee} onChoisir={setAnnee} elements={ANNEES_FERIES.map(a => ({ cle: a, label: String(a) }))} />

      <View style={{ gap: 8, marginBottom: 12 }}>
        {peutGerer ? (
          <Bouton label={occupe ? 'Ajout…' : `➕ Ajouter les jours fériés de ${annee}`} variante="plein" couleur={principale} styles={styles} disabled={occupe} onPress={ajouter} />
        ) : null}
        <Bouton label="📥 Télécharger le calendrier" couleur={principale} styles={styles} onPress={telecharger} />
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Ce fichier ne se met pas à jour tout seul. Si une date change, téléchargez-le à nouveau.
        </Text>
      </View>

      {liste.map(f => {
        const contenu = (
          <>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{f.titre}</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
              {libelleJour(f.date, aujourdhui)}{f.date.slice(0, 4) !== String(aujourdhui.slice(0, 4)) ? ` ${f.date.slice(0, 4)}` : ''}{f.estimee ? ' · date estimée' : ''}
            </Text>
          </>
        )
        return peutGerer && f.evenement
          ? <TouchableOpacity key={f.cle} style={styles.carte} activeOpacity={0.8} onPress={() => onModifier(f.evenement)}>{contenu}</TouchableOpacity>
          : <View key={f.cle} style={styles.carte}>{contenu}</View>
      })}
      {peutGerer && !dejaAjoutee ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Ajoutez les jours fériés pour pouvoir corriger une date ou recevoir les alertes.</Text>
      ) : null}
    </Feuille>
  )
}
```

- [ ] **Step 9 : brancher la feuille sur l'écran**

Dans `app/evenements.js` :

Ajouter l'import après celui de `FeuilleEvenement` :

```js
import FeuilleJoursFeries from '../components/evenements/FeuilleJoursFeries'
```

Ajouter l'état après `formulaire` :

```js
  const [joursFeries, setJoursFeries] = useState(false)
```

Remplacer le bloc `{groupe ? ( <View style={{ marginBottom: 12, gap: 8 }}> … </View> ) : null}` du haut de la liste par :

```jsx
          <View style={{ marginBottom: 12, gap: 8 }}>
            {groupe ? (
              <Bouton label="➕ Ajouter un événement" variante="plein" couleur={principale} styles={styles}
                onPress={() => setFormulaire({ visible: true, evenement: null })} />
            ) : null}
            <Bouton label="🇨🇮 Jours fériés ivoiriens" couleur={principale} styles={styles} onPress={() => setJoursFeries(true)} />
            {groupe && sansNaissance > 0 ? (
              <Text style={{ fontSize: 13, color: colors.textMuted }}>
                {sansNaissance} fiche{sansNaissance > 1 ? 's' : ''} sans date de naissance
              </Text>
            ) : null}
          </View>
```

Avant la fermeture `</SafeAreaView>` finale, ajouter :

```jsx
      <FeuilleJoursFeries visible={joursFeries && !formulaire.visible} evenements={donnees.evenements} peutGerer={groupe}
        ctx={{ userId: userId || null, userNom: userNom || null }} styles={styles} colors={colors} principale={principale}
        onFermer={() => setJoursFeries(false)} onAjoute={charger}
        onModifier={evenement => setFormulaire({ visible: true, evenement })} />
```

La feuille se masque pendant que le formulaire est ouvert, puis réapparaît : deux feuilles ne s'empilent pas.

- [ ] **Step 10 : vérifier**

Run : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done; npx eslint app/evenements.js components/evenements lib/evenements.js lib/evenementsDb.js`
Expected : aucun `ECHEC`, aucune erreur de lint.

- [ ] **Step 11 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add supabase_jours_feries.sql lib/evenements.js lib/evenements.test.mjs lib/evenementsDb.js components/evenements/FeuilleEvenement.js components/evenements/LigneEvenement.js components/evenements/FeuilleJoursFeries.js app/evenements.js
git commit -m "feat(evenements): jours fériés ivoiriens dans l'app et calendrier à télécharger

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4 : alerte de stock sur l'accueil

**Files :**
- Create : `components/evenements/AlertesStockAccueil.js`
- Modify : `lib/evenementsDb.js`, `components/accueil/AccueilManager.js`

**Interfaces :**
- Consumes : `DELAIS_ACCUEIL`, `datesUtiles`, `elementsAlerte`, `itemsPour`, `ventesParRestaurant` de `lib/alertesStock.js`.
- Produces : `chargerAlertesAccueil({ role, restaurantId, aujourdhui }) → Promise<items>` dans `lib/evenementsDb.js`, `AlertesStockAccueil({ role, restaurantId, styles, colors })`.

- [ ] **Step 1 : ajouter le chargement**

Dans `lib/evenementsDb.js`, ajouter en tête :

```js
import { DELAIS_ACCUEIL, datesUtiles, elementsAlerte, itemsPour, ventesParRestaurant } from './alertesStock'
```

Puis à la fin du fichier :

```js
/** Alertes de stock de l'accueil : ne lit que les ventes des dates nécessaires. */
export async function chargerAlertesAccueil({ role, restaurantId, aujourdhui }) {
  const groupe = ['manager', 'directeur', 'rh'].includes(role)
  if (!groupe && !restaurantId) return []
  let e = supabase.from('evenements_groupe').select('*')
  if (!groupe) e = e.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
  const { data: evenements, error } = await e
  if (error) throw error
  const elements = elementsAlerte(evenements || [], aujourdhui, DELAIS_ACCUEIL)
  if (!elements.length) return []
  const dates = datesUtiles(elements, evenements)
  let points = []
  if (dates.length) {
    let q = supabase.from('points').select('restaurant_id, date, vente_machine, vente_total').in('date', dates)
    if (!groupe) q = q.eq('restaurant_id', restaurantId)
    const r = await q
    if (r.error) throw r.error
    points = r.data || []
  }
  return itemsPour({ id: 'accueil', role, restaurant_id: restaurantId }, { elements, evenements, ventes: ventesParRestaurant(points) })
}
```

- [ ] **Step 2 : écrire le composant**

Créer `components/evenements/AlertesStockAccueil.js` :

```js
// Accueil : une ligne par fête à moins de 7 jours avec une alerte de stock.
// Un échec masque les lignes sans bloquer l'accueil.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { peutVoirEvenements } from '../../lib/evenements'
import { chargerAlertesAccueil } from '../../lib/evenementsDb'
import Survol from '../ui/Survol'

export default function AlertesStockAccueil({ role, restaurantId, styles, colors }) {
  const [items, setItems] = useState([])

  useFocusEffect(useCallback(() => {
    if (!peutVoirEvenements(role)) { setItems([]); return undefined }
    let vivant = true
    chargerAlertesAccueil({ role, restaurantId, aujourdhui: aujourdhuiISO() })
      .then(r => { if (vivant) setItems(r) })
      .catch(() => { if (vivant) setItems([]) })
    return () => { vivant = false }
  }, [role, restaurantId]))

  return items.map(i => (
    <Survol key={i.cle} onPress={() => router.push('/evenements')} accessibilityRole="button" accessibilityLabel={`${i.titre}. ${i.corps} Ouvrir les événements.`}
      style={[styles.bandeau, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} echelle={1.01} styleSurvol={{ borderColor: colors.primary + '66' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>{i.titre}</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{i.corps}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </Survol>
  ))
}
```

- [ ] **Step 3 : l'afficher sur l'accueil**

Dans `components/accueil/AccueilManager.js`, ajouter l'import après celui de `RappelEvenements` :

```js
import AlertesStockAccueil from '../evenements/AlertesStockAccueil'
```

Puis juste après la ligne `<RappelEvenements … />` :

```jsx
      <AlertesStockAccueil role={role} restaurantId={restaurantId} styles={styles} colors={colors} />
```

- [ ] **Step 4 : vérifier**

Run : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done; npx eslint components/evenements/AlertesStockAccueil.js components/accueil/AccueilManager.js lib/evenementsDb.js`
Expected : aucun `ECHEC`, aucune erreur de lint.

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add components/evenements/AlertesStockAccueil.js components/accueil/AccueilManager.js lib/evenementsDb.js
git commit -m "feat(evenements): alerte de stock sur l'accueil avant une fête

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 5 : notification quotidienne et vérification finale

**Files :**
- Create : `supabase/functions/alertes-stock/index.ts`, `supabase_alertes_stock_cron.sql`

**Interfaces :**
- Consumes : `DELAIS_ALERTE`, `datesUtiles`, `elementsAlerte`, `itemsPour`, `regrouper`, `ventesParRestaurant` de `lib/alertesStock.js`.
- Produces : l'Edge Function `alertes-stock`. Corps : `{ "essai": true?, "date": "AAAA-MM-JJ"? }`. Réponse : `{ ok, aujourdhui, essai, elements, envois }`.

- [ ] **Step 1 : écrire la fonction**

Créer `supabase/functions/alertes-stock/index.ts` :

```ts
// =====================================================================
//  Supabase Edge Function : alertes-stock
//
//  Appelée par pg_cron chaque jour à 9 h (Abidjan = UTC). Pour chaque fête
//  à J-7 ou J-2 avec une alerte de stock, envoie un message au gérant
//  (son restaurant), à la direction et à la RH (le groupe) : Android (Expo),
//  iPhone (send-web-push) et notification dans l'app. Une même alerte ne part
//  jamais deux fois (clé dans alertes_stock_envoyees).
//
//  Corps : { "essai": true?, "date": "AAAA-MM-JJ"? }
//  « essai » calcule et renvoie les messages SANS rien envoyer ni noter ;
//  « date » (essai seulement) simule un autre jour.
//
//  Déploiement : les fichiers lib/ partent avec la fonction.
//    npx supabase functions deploy alertes-stock --project-ref wlwotzxnzowbkbfcpnyi
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DELAIS_ALERTE, datesUtiles, elementsAlerte, itemsPour, regrouper, ventesParRestaurant } from '../../../lib/alertesStock.js'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!
const CLE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(URL_SUPABASE, CLE_SERVICE, { auth: { persistSession: false } })
const ECRAN = 'evenements'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Supabase coupe à 1 000 lignes : on lit par pages.
async function toutes(table: string, colonnes = '*', filtre?: (q: any) => any, ordre = 'id') {
  const lignes: any[] = []
  for (let debut = 0; ; debut += 1000) {
    let q = admin.from(table).select(colonnes).order(ordre).range(debut, debut + 999)
    if (filtre) q = filtre(q)
    const { data, error } = await q
    if (error) throw error
    lignes.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return lignes
}

async function envoyerExpo(tokens: string[], titre: string, corps: string) {
  if (!tokens.length) return 0
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map(to => ({
      to, title: titre, body: corps, sound: 'default', channelId: 'default', data: { screen: ECRAN },
    }))),
  })
  const res = await r.json().catch(() => ({}))
  return (Array.isArray(res?.data) ? res.data : []).filter((x: any) => x?.status === 'ok').length
}

async function envoyerWeb(userId: string, titre: string, corps: string) {
  await fetch(`${URL_SUPABASE}/functions/v1/send-web-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLE_SERVICE}` },
    body: JSON.stringify({ type: 'alerte_stock', titre, message: corps, cible_user_id: userId, screen: ECRAN }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  try {
    const corpsRequete = await req.json().catch(() => ({}))
    const essai = corpsRequete.essai === true
    const dateEssai = essai && /^\d{4}-\d{2}-\d{2}$/.test(corpsRequete.date || '') ? corpsRequete.date : null
    const aujourdhui = dateEssai || new Date().toISOString().slice(0, 10)

    const evenements = await toutes('evenements_groupe')
    const elements = elementsAlerte(evenements, aujourdhui, DELAIS_ALERTE)
    if (!elements.length) return json({ ok: true, aujourdhui, essai, elements: 0, envois: [] })

    const dates = datesUtiles(elements, evenements)
    const [points, utilisateurs, tokens] = await Promise.all([
      dates.length
        ? toutes('points', 'id, restaurant_id, date, vente_machine, vente_total', q => q.in('date', dates))
        : Promise.resolve([]),
      toutes('utilisateurs', 'id, nom, role, actif, restaurant_id', q => q.in('role', ['manager', 'directeur', 'rh', 'gerant']).eq('actif', true)),
      toutes('admin_push_tokens', 'id, user_id, token'),
    ])
    const contexte = { elements, evenements, ventes: ventesParRestaurant(points) }

    // Le téléphone web d'un restaurant est partagé entre ses gérants.
    const restaurantsDejaServis = new Set<string>()
    const rapport: any[] = []
    for (const u of utilisateurs) {
      const items = itemsPour(u, contexte)
      if (!items.length) continue

      if (essai) {
        const msg = regrouper(items)
        rapport.push({ compte: u.nom, role: u.role, titre: msg?.titre, corps: msg?.corps })
        continue
      }

      // Réserver chaque clé d'abord : un second appel n'envoie rien de plus.
      const gardes: any[] = []
      for (const item of items) {
        const { error } = await admin.from('alertes_stock_envoyees').insert({ cle: item.cle, message: `${item.titre} — ${item.corps}` })
        if (!error) gardes.push(item)
      }
      const msg = regrouper(gardes)
      if (!msg) { rapport.push({ compte: u.nom, statut: 'déjà envoyé' }); continue }

      const sesTokens = tokens.filter((t: any) => t.user_id === u.id).map((t: any) => t.token)
      const android = await envoyerExpo(sesTokens, msg.titre, msg.corps)
      const partage = u.role === 'gerant' ? u.restaurant_id : null
      if (!partage || !restaurantsDejaServis.has(partage)) {
        if (partage) restaurantsDejaServis.add(partage)
        await envoyerWeb(u.id, msg.titre, msg.corps)
      }
      await admin.from('notifications').insert({
        type: 'alerte_stock', titre: msg.titre, message: msg.corps, cible_user_id: u.id,
        cible_role: [], lu_par: [], screen: ECRAN,
      })
      rapport.push({ compte: u.nom, role: u.role, titre: msg.titre, android, statut: 'envoyé' })
    }
    return json({ ok: true, aujourdhui, essai, elements: elements.length, envois: rapport })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
  }
})
```

- [ ] **Step 2 : écrire la tâche programmée**

Lire `supabase_tresorerie_rappels.sql` et reprendre sa clé publique (anon) à l'identique, sans l'écrire dans un message ni dans un rapport. Créer `supabase_alertes_stock_cron.sql` :

```sql
-- =====================================================================
--  ALERTES DE STOCK : tâche quotidienne à 9 h (Abidjan = UTC).
--  À exécuter APRÈS le déploiement de l'Edge Function alertes-stock et
--  après supabase_jours_feries.sql. Idempotent.
--  La clé est la clé PUBLIQUE (anon) déjà présente dans l'app : elle autorise
--  seulement l'appel de la fonction, qui n'envoie jamais deux fois une alerte.
-- =====================================================================

SELECT cron.schedule('alertes-stock-9h', '0 9 * * *', $$
  SELECT net.http_post(
    url := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/alertes-stock',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer CLE_ANON_DE_supabase_tresorerie_rappels.sql"}'::jsonb,
    body := '{}'::jsonb
  )
$$);

-- Vérifier : SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'alertes-stock-9h';
```

Remplacer `CLE_ANON_DE_supabase_tresorerie_rappels.sql` par la clé relue.

- [ ] **Step 3 : vérifier l'ensemble**

Run : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done; npm run lint 2>&1 | tail -4; npx expo export -p web 2>&1 | tail -3; grep -l "Telecharger le calendrier\|calendrier" dist/_expo/static/js/web/*.js | head -3; grep -c "CLE_ANON" supabase_alertes_stock_cron.sql`
Expected : aucun `ECHEC`, `0 errors`, export réussi, au moins un fichier trouvé, et `0` pour le dernier comptage.

- [ ] **Step 4 : mettre le graphe à jour**

Run : `graphify update .`

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add supabase/functions/alertes-stock/index.ts supabase_alertes_stock_cron.sql
git commit -m "feat(evenements): notification quotidienne des alertes de stock

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6 : préparer la mise en service, sans rien lancer**

Rendre la main au contrôleur. L'ordre et l'accord de l'utilisateur sont décrits dans la section « Livraison » de la conception.
