# Favori « Ventes Yango → Samtrackly » — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un favori Chrome, cliqué sur vendor.yango.com, lit les commandes et la pub d'une semaine Yango et les remet à l'écran d'import de Trésorerie → Partenaires, sans fichier Excel.

**Architecture:** Le moteur `public/bouton-ventes-yango.js` (servi tel quel, emballé dans un lien `javascript:`) ouvre la fenêtre `/tresorerie-partenaires?favori=yango`, reprend la connexion de la page, lit l'API du portail et convertit les commandes en lignes au format exact de l'export. La fenêtre Samtrackly passe ces lignes à `analyserYango` (même code que le fichier) et pré-remplit la pub. Échanges par `postMessage`, uniquement entre `https://vendor.yango.com` et l'origine Samtrackly.

**Tech Stack:** Expo Router (web), React Native Web, Supabase, tests `node:test` (`node lib/x.test.mjs`).

Conception : `docs/superpowers/specs/2026-10-27-favori-ventes-yango-design.md`.

## Global Constraints

- Tout texte visible en français courant, sans code technique ; montants en F (FCFA), entiers.
- Annulées « Sera payée » **comptées** ; seules « La commande sera payée = Non / vide » sont écartées (fichier ET favori).
- Coupure 22h (été) / 21h (hiver) inchangée ; taux Yango 0,77 inchangé.
- Le favori ne fait sortir du portail que des commandes et des pubs ; il ne lit ni n'affiche jamais la valeur d'un en-tête de connexion (il copie l'objet d'en-têtes de la page, il ne teste que les noms).
- L'app n'accepte que les messages d'origine `https://vendor.yango.com` venant de `window.opener`.
- Pub jamais enregistrée à 0 par défaut : seulement si Yango l'a comptée jusqu'au dernier jour de la semaine, et jamais si une pub existe déjà pour la période.
- Pas de `expo start` / localhost lancé par l'agent ; vérifier par tests, `npm run lint`, `npx expo export -p web`.
- Commits conventionnels en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` avant git. Ne pas inclure `.gitignore` ni `scripts/import-sheets/` (modifs de l'utilisateur).
- Pas de publication Vercel/EAS dans ce plan (« publier à la fin », sur demande).

---

### Task 1: Annulées payées comptées dans `analyserYango`

**Files:**
- Modify: `lib/partenairesImport.js` (fonction `analyserYango`)
- Modify: `app/tresorerie-partenaires.js` (texte d'explication Yango + `LIBELLES_ECARTE`)
- Test: `lib/partenairesImport.test.mjs`

**Interfaces:**
- Produces: `analyserYango(lignes, { seuil })` rend `ecarte = { bordDebut, bordFin, nonPayables }` et un nouveau champ `annuleesPayees` (nombre d'annulées gardées). Plus de clé `annulees`.

- [ ] **Step 1: Adapter le test existant (il doit échouer)**

Dans `lib/partenairesImport.test.mjs`, test « cadrage 22h, filtres et Montant × 0,77 », remplacer les assertions par :

```js
  test('cadrage 22h, non payables écartées, annulées payées gardées, Montant × 0,77', () => {
    const r = analyserYango(lignes)
    assert.equal(r.j1, '2026-09-18')
    assert.equal(r.jn, '2026-09-26')
    assert.equal(r.seuil, 22)
    assert.deepEqual(r.ecarte, { bordDebut: 1, bordFin: 1, nonPayables: 2 })
    assert.equal(r.annuleesPayees, 1)
    assert.equal(r.nbCommandes, 4)
    assert.deepEqual(r.parCode.KMS, { nb: 4, montant: 42000, paye: 32340 })
  })

  test('annulée non payable : écartée comme non payable', () => {
    const r = analyserYango([
      entetes,
      [kms, 'C1', 4000, 'Annulé', 'Non', '2026-09-20 12:00:00'],
      [kms, 'C2', 4000, 'Livré', 'Oui', '2026-09-21 12:00:00'],
    ])
    assert.equal(r.ecarte.nonPayables, 1)
    assert.equal(r.annuleesPayees, 0)
    assert.equal(r.nbCommandes, 1)
  })
```

Et dans le commentaire de la ligne A4 : `// annulée mais payée : gardée`.

- [ ] **Step 2: Lancer le test**

Run: `node lib/partenairesImport.test.mjs`
Expected: FAIL (ecarte contient encore `annulees`, nbCommandes 3).

- [ ] **Step 3: Modifier `analyserYango`**

Dans `lib/partenairesImport.js`, remplacer :

```js
  const ecarte = { bordDebut: 0, bordFin: 0, nonPayables: 0, annulees: 0 }
```
par
```js
  // Annulées « Sera payée » : Yango les rembourse au restaurant, elles comptent
  // (choix du 27/10/2026, écart volontaire avec la skill qui les retirait).
  const ecarte = { bordDebut: 0, bordFin: 0, nonPayables: 0 }
  let annuleesPayees = 0
```
remplacer
```js
    if (normaliser(l[idx.Statut]) === 'annule') { ecarte.annulees++; continue }
```
par
```js
    if (normaliser(l[idx.Statut]) === 'annule') annuleesPayees++
```
et dans l'objet rendu, après `ecarte, parCode: …,` ajouter `annuleesPayees,`.

- [ ] **Step 4: Textes de l'écran**

Dans `app/tresorerie-partenaires.js` :
- texte Yango de `FeuilleImport` : `"Export brut Yango (du jeudi au vendredi). L'app garde la fenêtre 22h → 22h (21h en hiver), retire les commandes non payables (les annulées que Yango paie quand même sont comptées), puis applique Montant × 0,77."`
- `LIBELLES_ECARTE` : supprimer la ligne `annulees: 'annulées',`.
- Sous la ligne « Écartées : … » de la carte de synthèse, ajouter :

```jsx
            {!!analyse.annuleesPayees && (
              <Text style={styles.petit}>Dont {analyse.annuleesPayees} annulée{analyse.annuleesPayees > 1 ? 's' : ''} que Yango paie : comptée{analyse.annuleesPayees > 1 ? 's' : ''}</Text>
            )}
```

- `details` envoyé à `importerExport` : ajouter `annulees_payees: analyse.annuleesPayees ?? null,`.

- [ ] **Step 5: Tests et lint**

Run: `node lib/partenairesImport.test.mjs && npx eslint lib/partenairesImport.js app/tresorerie-partenaires.js`
Expected: tous PASS, 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/partenairesImport.js lib/partenairesImport.test.mjs app/tresorerie-partenaires.js
git commit -m "feat(partenaires): annulées payées par Yango comptées à l'import"
```

---

### Task 2: Moteur du favori — conversions pures

**Files:**
- Create: `public/bouton-ventes-yango.js`
- Create: `lib/boutonVentesYango.js`
- Test: `lib/boutonVentesYango.test.mjs`

**Interfaces:**
- Produces (rendu par `moteurVentesYango()`) : `ENTETES`, `bornesLecture({debut, fin}) → {from, to}`, `nomBoutique(place) → string`, `dateExport(iso) → 'AAAA-MM-JJ hh:mm:ss' | ''`, `ligneExport(commande, noms) → Array(6)`, `lignesExport(commandes, places) → Array<Array>`, `lirePub(json) → { montant, dernierJour, majLe }`, `pubAJourAu(lectures) → 'AAAA-MM-JJ' | null`, `lancer(cfg)` (Task 3).
- Produces (`lib/boutonVentesYango.js`) : `construireFavoriVentes(source, { origine }) → 'javascript:…'`.

- [ ] **Step 1: Écrire les tests**

`lib/boutonVentesYango.test.mjs` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Tests du favori « Ventes Yango → Samtrackly ».
//
// Le moteur vit dans public/bouton-ventes-yango.js, servi tel quel : il tourne
// sur le portail Yango. On le charge comme du texte pour tester ses conversions.
// Formes des réponses relevées sur le portail le 26/10/2026.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { construireFavoriVentes } from './boutonVentesYango.js'
import { analyserYango } from './partenairesImport.js'

const source = readFileSync(new URL('../public/bouton-ventes-yango.js', import.meta.url), 'utf8')
const moteur = new Function(source + '\nreturn moteurVentesYango')()()
const { ENTETES, bornesLecture, nomBoutique, dateExport, ligneExport, lignesExport, lirePub, pubAJourAu } = moteur

const PLACES = [
  { id: 1969340, name: 'Chez Samer', address: "Рон-пуэн-Ривьера-Пальнре, Абиджан, Кот-д'Ивуар, Rond point Riviera Palmraie" },
  { id: 1969365, name: 'Chez Samer', address: 'Quartier de la Zone 4, Quartier de la Zone 4, Abidjan' },
]
const cmd = (o) => ({
  order_nr: 'X', flow: 'native', status: 'released', place_id: 1969340,
  place_confirmed_at: '2026-09-28T12:00:00+00:00', is_reimbursement_to_place: true,
  sum: '3000', total_sum: '3000', discount: '0', payment_type: 'cashless', summary_date: '2026-09-28', service: 'eda', ...o,
})

describe('bornes de lecture', () => {
  test('semaine vendredi → jeudi : on lit du jeudi d’avant au jeudi de fin (comme l’export)', () => {
    assert.deepEqual(bornesLecture({ debut: '2026-09-25', fin: '2026-10-01' }), { from: '2026-09-24', to: '2026-10-01' })
  })
})

describe('commande du portail → ligne d’export', () => {
  const noms = { 1969340: nomBoutique(PLACES[0]) }
  test('nom de boutique = « nom (adresse) », comme la colonne de l’export', () => {
    assert.equal(nomBoutique({ name: 'Al Kayan', address: 'Rue S95, Abidjan' }), 'Al Kayan (Rue S95, Abidjan)')
  })
  test('date confirmée en UTC, au format de l’export', () => {
    assert.equal(dateExport('2026-10-01T23:51:59+00:00'), '2026-10-01 23:51:59')
    assert.equal(dateExport(null), '')
  })
  test('livrée payée', () => {
    assert.deepEqual(ligneExport(cmd({ order_nr: 'A' }), noms), [noms[1969340], 'A', 3000, 'Livré', 'Oui', '2026-09-28 12:00:00'])
  })
  test('refusée : « Annulé », et « Non » quand Yango ne paie pas', () => {
    const l = ligneExport(cmd({ status: 'refused', is_reimbursement_to_place: false }), noms)
    assert.equal(l[3], 'Annulé')
    assert.equal(l[4], 'Non')
  })
  test('boutique inconnue : son numéro, pour être signalée', () => {
    assert.equal(ligneExport(cmd({ place_id: 42 }), noms)[0], '42')
  })
})

describe('lignes complètes → analyserYango (même calcul que le fichier)', () => {
  const lignes = lignesExport([
    cmd({ order_nr: 'B1', place_confirmed_at: '2026-09-24T21:59:00+00:00' }), // jeudi d'avant < 22h : coupée
    cmd({ order_nr: 'B2', place_confirmed_at: '2026-09-24T22:10:00+00:00' }), // gardée
    cmd({ order_nr: 'B3', status: 'refused' }),                                 // annulée payée : gardée
    cmd({ order_nr: 'B4', status: 'refused', is_reimbursement_to_place: false }), // non payable
    cmd({ order_nr: 'B5', place_id: 1969365, sum: '5000' }),
    cmd({ order_nr: 'B6', place_confirmed_at: '2026-10-01T22:30:00+00:00' }), // jeudi de fin ≥ 22h : coupée
  ], PLACES)

  test('en-têtes de l’export en première ligne', () => {
    assert.deepEqual(lignes[0], ENTETES)
  })
  test('mêmes filtres et mêmes codes que l’export Excel', () => {
    const r = analyserYango(lignes)
    assert.deepEqual(r.ecarte, { bordDebut: 1, bordFin: 1, nonPayables: 1 })
    assert.equal(r.annuleesPayees, 1)
    assert.deepEqual(r.parCode.PALM, { nb: 2, montant: 6000, paye: 4620 })
    assert.deepEqual(r.parCode.KMS, { nb: 1, montant: 5000, paye: 3850 })
  })
})

describe('pub', () => {
  const rep = (points, maj) => ({
    available: [{
      slug: 'cpa_advert_costs', total_value: { title: '127 193', value: points.reduce((s, p) => s + p[1], 0) },
      points_data: points.map(([j, v]) => ({ dt_from: j + 'T00:00:00+00:00', dt_to: j + 'T00:00:00+00:00', value: v })),
      ...(maj ? { updated_at: maj } : {}),
    }],
    unavailable: [],
  })
  test('total et dernier jour compté', () => {
    assert.deepEqual(lirePub(rep([['2026-09-30', 22762], ['2026-10-01', 14391]])), { montant: 37153, dernierJour: '2026-10-01', majLe: null })
  })
  test('jours à 0 en fin de période : Yango n’a pas encore compté', () => {
    assert.equal(lirePub(rep([['2026-10-05', 10782], ['2026-10-06', 0]])).dernierJour, '2026-10-05')
  })
  test('métrique absente : rien', () => {
    assert.deepEqual(lirePub({ available: [] }), { montant: 0, dernierJour: null, majLe: null })
  })
  test('à jour au : veille de updated_at si Yango le donne, sinon dernier jour avec une pub', () => {
    assert.equal(pubAJourAu([{ majLe: '2026-10-06', dernierJour: '2026-10-05' }]), '2026-10-05')
    assert.equal(pubAJourAu([{ majLe: null, dernierJour: '2026-10-01' }, { majLe: null, dernierJour: '2026-09-29' }]), '2026-10-01')
    assert.equal(pubAJourAu([{ majLe: null, dernierJour: null }]), null)
  })
})

describe('construireFavoriVentes', () => {
  test('emballe le moteur avec l’origine, sans barre finale', () => {
    const lien = construireFavoriVentes(source, { origine: 'https://samtrackly.vercel.app/' })
    assert.ok(lien.startsWith('javascript:'))
    const code = decodeURIComponent(lien.slice('javascript:'.length))
    assert.ok(code.includes('moteurVentesYango().lancer({"origine":"https://samtrackly.vercel.app"})'))
  })
  test('refuse un code qui n’est pas le moteur', () => {
    assert.throws(() => construireFavoriVentes('alert(1)', { origine: 'https://x' }))
  })
})
```

- [ ] **Step 2: Lancer les tests**

Run: `node lib/boutonVentesYango.test.mjs`
Expected: FAIL (fichiers absents).

- [ ] **Step 3: Écrire `lib/boutonVentesYango.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
//  FAVORI « VENTES YANGO → SAMTRACKLY » — fabrication du lien
//
//  Le moteur (public/bouton-ventes-yango.js) est servi tel quel ; on l'emballe
//  dans un lien `javascript:` avec l'origine Samtrackly, où s'ouvre l'écran
//  d'import. Pas de secret : l'import se fait dans l'app, avec la session.
// ──────────────────────────────────────────────────────────────────────────────

export function construireFavoriVentes(source, { origine }) {
  if (!source || !String(source).includes('function moteurVentesYango()')) {
    throw new Error('Le code du favori est introuvable.')
  }
  const config = JSON.stringify({ origine: String(origine).replace(/\/+$/, '') })
  return 'javascript:' + encodeURIComponent(`(function(){${source}\nmoteurVentesYango().lancer(${config})})()`)
}
```

- [ ] **Step 4: Écrire la partie pure de `public/bouton-ventes-yango.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
//  MOTEUR DU FAVORI « VENTES YANGO → SAMTRACKLY »
//
//  Servi tel quel (jamais transpilé) : app/bouton-ventes-yango.js l'emballe
//  dans un favori `javascript:` avec l'origine Samtrackly. Cliqué sur
//  vendor.yango.com, il :
//    1. ouvre la fenêtre /tresorerie-partenaires?favori=yango (dans le geste
//       de clic, sinon Chrome la bloque) ;
//    2. reprend la connexion de la page (en-têtes de sa prochaine requête) ;
//    3. à la demande de la fenêtre, lit les commandes et la pub d'une semaine ;
//    4. renvoie les commandes au format exact de l'export Excel, et la pub.
//  Le calcul (coupure, filtres, × 0,77) est fait dans l'app par analyserYango.
//
//  Tout doit rester DANS moteurVentesYango(). Tests : lib/boutonVentesYango.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
function moteurVentesYango() {
  const JOUR = 86400000
  const RACINE = '/4.0/restapp-front/'
  const PAR_PAGE = 50
  const ENTETES = ['Nom du restaurant', 'Numéro de la commande', 'Montant', 'Statut', 'La commande sera payée', 'Commande confirmée par le restaurant']

  function jourIso(ms) { return new Date(ms).toISOString().slice(0, 10) }
  function decaler(iso, k) { return jourIso(Date.parse(iso + 'T00:00:00Z') + k * JOUR) }

  // Semaine Yango vendredi → jeudi. L'export part du jeudi d'avant : la
  // coupure 22h/21h du premier jour est faite ensuite par analyserYango.
  function bornesLecture(periode) {
    return { from: decaler(periode.debut, -1), to: periode.fin }
  }

  // Colonne « Nom du restaurant » de l'export : « nom (adresse) ».
  function nomBoutique(place) {
    return String(place.name || '').trim() + ' (' + String(place.address || '').trim() + ')'
  }

  // « Commande confirmée par le restaurant » : UTC (= heure d'Abidjan).
  function dateExport(iso) {
    const t = Date.parse(iso)
    return iso && Number.isFinite(t) ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : ''
  }

  function ligneExport(commande, noms) {
    return [
      noms[commande.place_id] || String(commande.place_id),
      String(commande.order_nr),
      Number(commande.sum) || 0,
      commande.status === 'refused' ? 'Annulé' : 'Livré',
      commande.is_reimbursement_to_place === true ? 'Oui' : 'Non',
      dateExport(commande.place_confirmed_at),
    ]
  }

  function lignesExport(commandes, places) {
    const noms = {}
    places.forEach(function (p) { noms[p.id] = nomBoutique(p) })
    return [ENTETES.slice()].concat(commandes.map(function (c) { return ligneExport(c, noms) }))
  }

  // Réponse de reports/v1/place-metrics/get (une boutique, group_by day).
  function lirePub(json) {
    const m = ((json && json.available) || []).find(function (x) { return x.slug === 'cpa_advert_costs' })
    if (!m) return { montant: 0, dernierJour: null, majLe: null }
    let dernierJour = null
    ;(m.points_data || []).forEach(function (p) { if (Number(p.value) > 0) dernierJour = String(p.dt_from).slice(0, 10) })
    return {
      montant: Math.round(Number(m.total_value && m.total_value.value) || 0),
      dernierJour: dernierJour,
      majLe: m.updated_at ? String(m.updated_at).slice(0, 10) : null,
    }
  }

  // Dernier jour compté par Yango. Le 26/10/2026, ses statistiques s'étaient
  // arrêtées au 05/10 (« Mis à jour 6 octobre ») : 0 F chaque jour depuis.
  function pubAJourAu(lectures) {
    let maj = null
    let dernier = null
    lectures.forEach(function (l) {
      if (l.majLe && (!maj || l.majLe > maj)) maj = l.majLe
      if (l.dernierJour && (!dernier || l.dernierJour > dernier)) dernier = l.dernierJour
    })
    return maj ? decaler(maj, -1) : dernier
  }

  // ── Exécution sur le portail : voir Task 3 ───────────────────────────────
  async function lancer(_cfg) { /* Task 3 */ }

  return {
    ENTETES: ENTETES,
    bornesLecture: bornesLecture,
    nomBoutique: nomBoutique,
    dateExport: dateExport,
    ligneExport: ligneExport,
    lignesExport: lignesExport,
    lirePub: lirePub,
    pubAJourAu: pubAJourAu,
    lancer: lancer,
  }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `node lib/boutonVentesYango.test.mjs && node lib/partenairesImport.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/bouton-ventes-yango.js lib/boutonVentesYango.js lib/boutonVentesYango.test.mjs
git commit -m "feat(partenaires): moteur du favori Ventes Yango (conversions)"
```

---

### Task 3: Moteur du favori — exécution sur le portail

**Files:**
- Modify: `public/bouton-ventes-yango.js` (remplacer le `lancer` provisoire)
- Test: `lib/boutonVentesYango.test.mjs` (`avecReprise`, `aConnexion`)

**Interfaces:**
- Consumes: fonctions de la Task 2.
- Produces (messages `postMessage`) :
  - fenêtre → favori : `{ type: 'pret' }`, `{ type: 'lire', debut: 'AAAA-MM-JJ', fin: 'AAAA-MM-JJ' }`
  - favori → fenêtre : `{ type: 'favori' }`, `{ type: 'progression', texte }`, `{ type: 'ventes', periode: {debut, fin}, lignes, pubs: [{nom, montant}], pubAJourAu }`, `{ type: 'erreur', message }`
  - ajoute au retour de `moteurVentesYango()` : `avecReprise(fn, attendre)`, `aConnexion(entetes) → boolean`.

- [ ] **Step 1: Tests (échouent)**

Ajouter à `lib/boutonVentesYango.test.mjs` (et `avecReprise, aConnexion` à la déstructuration du moteur) :

```js
describe('exécution', () => {
  test('connexion reconnue aux NOMS d’en-têtes, jamais à leur valeur', () => {
    assert.equal(aConnexion({ 'X-Oauth': 'a', 'X-Partner-Id': 'b' }), true)
    assert.equal(aConnexion({ authorization: 'a' }), true)
    assert.equal(aConnexion({ Accept: 'application/json' }), false)
  })
  test('reprise : 5 nouveaux essais, puis message en français', async () => {
    let n = 0
    await assert.rejects(avecReprise(async () => { n++; throw new Error('x') }, async () => {}), e => /clique à nouveau/.test(e.messageFr))
    assert.equal(n, 6)
  })
  test('session expirée : pas de nouvel essai', async () => {
    let n = 0
    await assert.rejects(avecReprise(async () => { n++; const e = new Error('s'); e.definitif = true; throw e }, async () => {}))
    assert.equal(n, 1)
  })
})
```

Run: `node lib/boutonVentesYango.test.mjs` → FAIL (`aConnexion` absent).

- [ ] **Step 2: Implémenter l'exécution**

Dans `public/bouton-ventes-yango.js`, remplacer la ligne `async function lancer(_cfg) { /* Task 3 */ }` et le commentaire au-dessus par :

```js
  // ── Exécution sur le portail ─────────────────────────────────────────────
  const INCOMPLET = "La lecture Yango n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes."
  const SESSION = 'Ta session Yango a expiré : reconnecte-toi au portail puis clique à nouveau sur le favori.'
  const ATTENTE = 'Le portail ne répond pas : clique sur « Commandes » dans le menu du portail, puis à nouveau sur le favori.'
  const ATTENTES_REPRISE = [1000, 2000, 4000, 8000, 16000]
  const SANS = /^(x-idempotency-token|x-yarequestid|content-length)$/i

  function erreurFr(message) { const e = new Error(message); e.messageFr = message; return e }
  function frDate(iso) { const p = iso.split('-'); return p[2] + '/' + p[1] }
  function pause(ms) { return new Promise(function (ok) { setTimeout(ok, ms) }) }

  async function avecReprise(fn, attendre) {
    attendre = attendre || pause
    for (let essai = 0; ; essai++) {
      try { return await fn() } catch (e) {
        if (e && e.definitif) throw e
        if (essai >= ATTENTES_REPRISE.length) throw erreurFr(INCOMPLET)
        await attendre(ATTENTES_REPRISE[essai])
      }
    }
  }

  // On ne regarde que les NOMS d'en-têtes, jamais leur valeur.
  function aConnexion(entetes) {
    return Object.keys(entetes || {}).some(function (k) { return /oauth|authorization/i.test(k) })
  }

  // Attend la prochaine requête de la page vers l'API du portail et copie
  // ses en-têtes (sans ceux propres à une requête). Remet tout en place après.
  function capterConnexion(delaiMs) {
    return new Promise(function (ok, ko) {
      const proto = XMLHttpRequest.prototype
      const ouvrir = proto.open
      const poser = proto.setRequestHeader
      const envoyer = proto.send
      const fetchPage = window.fetch
      let fini = false
      function garder(h) {
        if (fini || !aConnexion(h)) return
        fini = true
        clearTimeout(minuteur)
        proto.open = ouvrir; proto.setRequestHeader = poser; proto.send = envoyer; window.fetch = fetchPage
        const out = {}
        Object.keys(h).forEach(function (k) { if (!SANS.test(k)) out[k] = h[k] })
        ok(out)
      }
      proto.open = function (_m, u) {
        this.__ventesYango = String(u || '').indexOf(RACINE) !== -1 ? {} : null
        return ouvrir.apply(this, arguments)
      }
      proto.setRequestHeader = function (k, v) {
        if (this.__ventesYango) this.__ventesYango[k] = v
        return poser.apply(this, arguments)
      }
      proto.send = function () {
        if (this.__ventesYango) garder(this.__ventesYango)
        return envoyer.apply(this, arguments)
      }
      window.fetch = function (entree, init) {
        try {
          const req = entree instanceof Request ? entree : new Request(entree, init)
          if (req.url.indexOf(RACINE) !== -1) {
            const h = {}
            req.headers.forEach(function (v, k) { h[k] = v })
            garder(h)
          }
        } catch (_e) { /* requête illisible : on attend la suivante */ }
        return fetchPage.apply(this, arguments)
      }
      const minuteur = setTimeout(function () {
        if (fini) return
        fini = true
        proto.open = ouvrir; proto.setRequestHeader = poser; proto.send = envoyer; window.fetch = fetchPage
        ko(erreurFr(ATTENTE))
      }, delaiMs)
    })
  }

  async function appel(entetes, chemin, params, corps) {
    const u = new URL(RACINE + chemin, location.origin)
    Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]) })
    const r = await fetch(u.toString(), {
      method: corps ? 'POST' : 'GET', headers: entetes, credentials: 'include',
      body: corps ? JSON.stringify(corps) : undefined,
    })
    if (r.status === 401 || r.status === 403) { const e = erreurFr(SESSION); e.definitif = true; throw e }
    if (!r.ok) throw erreurFr(INCOMPLET)
    return r.json()
  }

  async function lireSemaine(periode, entetes, etape) {
    const j = await avecReprise(function () {
      return appel(entetes, 'places/v2/search', { limit: 999, sort: 'rating', ascending: 'true', filter: 'all' })
    })
    const places = j.places || []
    const ids = places.map(function (p) { return p.id })
    const b = bornesLecture(periode)
    let commandes = []
    let curseur = null
    for (let page = 0; page < 200; page++) {
      const params = { limit: PAR_PAGE }
      if (curseur) params.cursor = curseur
      const lot = await avecReprise(function () {
        return appel(entetes, 'eats-restapp-orders/v2/history', params, { from: b.from, to: b.to, place_ids: ids })
      })
      commandes = commandes.concat(lot.orders || [])
      etape('Commandes Yango lues : ' + commandes.length)
      if (!lot.meta || !lot.meta.can_fetch_next || !lot.meta.cursor) break
      curseur = lot.meta.cursor
    }
    const lectures = []
    for (const p of places) {
      const rep = await avecReprise(function () {
        return appel(entetes, 'reports/v1/place-metrics/get', null, {
          filters: {
            places: [p.id], begin: periode.debut + 'T00:00:00.000Z', end: periode.fin + 'T23:59:59.999Z',
            group_by: 'day', additional: { service: 'eda' },
          },
          metrics: ['cpa_advert_costs'],
        })
      })
      lectures.push(Object.assign({ nom: nomBoutique(p) }, lirePub(rep)))
      etape('Pub Yango : ' + lectures.length + '/' + places.length + ' boutiques')
    }
    return {
      periode: periode,
      lignes: lignesExport(commandes, places),
      pubs: lectures.filter(function (l) { return l.montant > 0 }).map(function (l) { return { nom: l.nom, montant: l.montant } }),
      pubAJourAu: pubAJourAu(lectures),
    }
  }

  function bandeau() {
    const ancien = document.getElementById('ventes-yango-bandeau')
    if (ancien) ancien.remove()
    const div = document.createElement('div')
    div.id = 'ventes-yango-bandeau'
    div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:14px 16px;'
      + 'background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)'
    document.body.appendChild(div)
    return function (texte, fermerApresMs) {
      div.textContent = '🛵 ' + texte
      if (fermerApresMs) setTimeout(function () { div.remove() }, fermerApresMs)
    }
  }

  function lancer(cfg) {
    if (location.hostname !== 'vendor.yango.com') {
      alert('Ouvre le portail Yango (vendor.yango.com), puis clique à nouveau sur le favori.')
      return
    }
    const fen = window.open(cfg.origine + '/tresorerie-partenaires?favori=yango', 'ventes-yango')
    if (!fen) {
      alert('Chrome a bloqué la fenêtre Samtrackly : autorise les fenêtres pour ce site, puis clique à nouveau.')
      return
    }
    const info = bandeau()
    info('Ventes Yango : connexion au portail… Si rien ne bouge, clique sur « Commandes » dans le menu du portail.')
    let entetes = null
    const connexion = capterConnexion(60000).then(function (h) {
      entetes = h
      info('Ventes Yango : choisis la semaine dans la fenêtre Samtrackly.')
    })
    connexion.catch(function (e) { info(e.messageFr, 15000) })

    // Un second clic remplace l'écoute du premier.
    if (window.__ventesYangoEcoute) window.removeEventListener('message', window.__ventesYangoEcoute)
    let occupe = false
    window.__ventesYangoEcoute = async function (e) {
      if (e.source !== fen || e.origin !== cfg.origine || !e.data) return
      const envoyer = function (m) { try { fen.postMessage(m, cfg.origine) } catch (_) { /* fenêtre fermée */ } }
      if (e.data.type === 'pret') { envoyer({ type: 'favori' }); return }
      if (e.data.type !== 'lire' || occupe) return
      const iso = /^\d{4}-\d{2}-\d{2}$/
      if (!iso.test(e.data.debut) || !iso.test(e.data.fin)) return
      occupe = true
      const etape = function (t) { info(t); envoyer({ type: 'progression', texte: t }) }
      try {
        await connexion
        const periode = { debut: e.data.debut, fin: e.data.fin }
        etape('Lecture de la semaine du ' + frDate(periode.debut) + ' au ' + frDate(periode.fin) + '…')
        envoyer(Object.assign({ type: 'ventes' }, await lireSemaine(periode, entetes, etape)))
        info('Semaine envoyée : vérifie puis importe dans la fenêtre Samtrackly.', 10000)
      } catch (err) {
        const m = (err && err.messageFr) || INCOMPLET
        envoyer({ type: 'erreur', message: m })
        info(m, 15000)
      } finally {
        occupe = false
      }
    }
    window.addEventListener('message', window.__ventesYangoEcoute)
  }
```

Et compléter l'objet rendu : ajouter `avecReprise: avecReprise,` et `aConnexion: aConnexion,`.

- [ ] **Step 3: Tests**

Run: `node lib/boutonVentesYango.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/bouton-ventes-yango.js lib/boutonVentesYango.test.mjs
git commit -m "feat(partenaires): favori Ventes Yango, lecture sur le portail"
```

---

### Task 4: Logique app — semaines proposées et pub

**Files:**
- Create: `lib/ventesYangoFavori.js`
- Test: `lib/ventesYangoFavori.test.mjs`

**Interfaces:**
- Consumes: `periodeDe`, `ajouterJours` (`lib/partenaires.js`) ; `codeYango` (`lib/partenairesImport.js`).
- Produces: `ORIGINE_YANGO`, `semainesProposees(aujourdhui, nb = 5) → [{debut, fin}]`, `pubParCode(pubs) → {code: montant}`, `etatPub({ pubs, pubAJourAu, periode, codes, dejaSaisie }) → { statut: 'a_jour'|'pas_a_jour'|'deja_saisie'|'aucune', parCode, parts: [{restaurant_id, montant}], total }`, `messageValide(e, opener) → boolean`.

- [ ] **Step 1: Tests (échouent)**

```js
// Tests de la partie app du favori Ventes Yango (semaines, pub).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ORIGINE_YANGO, etatPub, messageValide, pubParCode, semainesProposees } from './ventesYangoFavori.js'

describe('semaines proposées', () => {
  test('mardi 27/10 : la dernière terminée est 16/10 → 22/10, puis les 4 d’avant', () => {
    const s = semainesProposees('2026-10-27')
    assert.equal(s.length, 5)
    assert.deepEqual(s[0], { debut: '2026-10-16', fin: '2026-10-22' })
    assert.deepEqual(s[4], { debut: '2026-09-18', fin: '2026-09-24' })
  })
  test('le jeudi, la semaine en cours n’est pas terminée', () => {
    assert.deepEqual(semainesProposees('2026-10-22')[0], { debut: '2026-10-09', fin: '2026-10-15' })
  })
  test('le vendredi, la semaine finie la veille est proposée', () => {
    assert.deepEqual(semainesProposees('2026-10-23')[0], { debut: '2026-10-16', fin: '2026-10-22' })
  })
})

describe('pub', () => {
  const pubs = [
    { nom: "Chez Samer (Rond point Riviera Palmraie)", montant: 81265 },
    { nom: 'Chez Samer (Quartier de la Angré, 7e tranche)', montant: 36219 },
    { nom: 'Al Kayan Pizza (La commune Koumassi)', montant: 1088 },
  ]
  const periode = { debut: '2026-09-25', fin: '2026-10-01' }
  const codes = { PALM: 'r-palm', '7E': 'r-7e', KMS: 'r-kms' }

  test('par code restaurant (mêmes règles que les ventes)', () => {
    assert.deepEqual(pubParCode(pubs), { PALM: 81265, '7E': 36219, KMS: 1088 })
  })
  test('à jour : par restaurant, prête à enregistrer', () => {
    const e = etatPub({ pubs, pubAJourAu: '2026-10-05', periode, codes, dejaSaisie: 0 })
    assert.equal(e.statut, 'a_jour')
    assert.equal(e.total, 118572)
    assert.deepEqual(e.parts.find(p => p.restaurant_id === 'r-palm'), { restaurant_id: 'r-palm', montant: 81265 })
  })
  test('Yango n’a pas compté jusqu’au jeudi : pas à jour', () => {
    assert.equal(etatPub({ pubs, pubAJourAu: '2026-09-30', periode, codes, dejaSaisie: 0 }).statut, 'pas_a_jour')
    assert.equal(etatPub({ pubs: [], pubAJourAu: null, periode, codes, dejaSaisie: 0 }).statut, 'pas_a_jour')
  })
  test('déjà saisie : rien n’est ajouté', () => {
    assert.equal(etatPub({ pubs, pubAJourAu: '2026-10-05', periode, codes, dejaSaisie: 5000 }).statut, 'deja_saisie')
  })
  test('à jour mais aucune pub', () => {
    assert.equal(etatPub({ pubs: [], pubAJourAu: '2026-10-05', periode, codes, dejaSaisie: 0 }).statut, 'aucune')
  })
  test('restaurant ignoré ou pas encore associé : pas compté', () => {
    const e = etatPub({ pubs, pubAJourAu: '2026-10-05', periode, codes: { PALM: 'ignorer', '7E': 'r-7e' }, dejaSaisie: 0 })
    assert.equal(e.total, 36219)
  })
})

describe('messages acceptés', () => {
  const opener = {}
  test('seulement du portail Yango, de la fenêtre qui a ouvert Samtrackly', () => {
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: opener, data: { type: 'ventes' } }, opener), true)
    assert.equal(messageValide({ origin: 'https://evil.example', source: opener, data: { type: 'ventes' } }, opener), false)
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: {}, data: { type: 'ventes' } }, opener), false)
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: opener, data: null }, opener), false)
    assert.equal(messageValide({ origin: ORIGINE_YANGO, source: null, data: { type: 'x' } }, null), false)
  })
})
```

Run: `node lib/ventesYangoFavori.test.mjs` → FAIL.

- [ ] **Step 2: Implémenter `lib/ventesYangoFavori.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Favori « Ventes Yango » — partie app (logique pure).
//
// La fenêtre Samtrackly ouverte par le favori propose une semaine, reçoit les
// lignes (format de l'export) et la pub lue sur le portail. Les lignes passent
// par analyserYango ; ici : les semaines et l'état de la pub.
// Tests : lib/ventesYangoFavori.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { ajouterJours, periodeDe } from './partenaires.js'
import { codeYango } from './partenairesImport.js'

export const ORIGINE_YANGO = 'https://vendor.yango.com'

// Semaines Yango (vendredi → jeudi) terminées, la plus récente d'abord.
export function semainesProposees(aujourdhui, nb = 5) {
  let p = periodeDe('yango', aujourdhui)
  if (p.fin >= aujourdhui) p = periodeDe('yango', ajouterJours(p.debut, -1))
  const out = []
  for (let i = 0; i < nb; i++) {
    out.push(p)
    p = periodeDe('yango', ajouterJours(p.debut, -1))
  }
  return out
}

// Pub par code restaurant : même règle de nom que les ventes (codeYango).
export function pubParCode(pubs) {
  const out = {}
  for (const p of pubs || []) {
    const code = codeYango(p.nom) || '?'
    out[code] = (out[code] || 0) + Math.round(Number(p.montant) || 0)
  }
  return out
}

// codes : code → restaurant_id | 'ignorer' (choix de l'écran d'import).
// dejaSaisie : total des pubs déjà enregistrées pour cette période.
export function etatPub({ pubs, pubAJourAu, periode, codes, dejaSaisie }) {
  const parCode = pubParCode(pubs)
  const parResto = {}
  for (const [code, montant] of Object.entries(parCode)) {
    const r = codes[code]
    if (!r || r === 'ignorer' || !montant) continue
    parResto[r] = (parResto[r] || 0) + montant
  }
  const parts = Object.entries(parResto).map(([restaurant_id, montant]) => ({ restaurant_id, montant }))
  const total = parts.reduce((s, x) => s + x.montant, 0)
  let statut = 'a_jour'
  if (dejaSaisie > 0) statut = 'deja_saisie'
  else if (!pubAJourAu || pubAJourAu < periode.fin) statut = 'pas_a_jour'
  else if (!total) statut = 'aucune'
  return { statut, parCode, parts, total }
}

export function messageValide(e, opener) {
  return !!e && !!opener && e.origin === ORIGINE_YANGO && e.source === opener
    && !!e.data && typeof e.data.type === 'string'
}
```

- [ ] **Step 3: Tests**

Run: `node lib/ventesYangoFavori.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/ventesYangoFavori.js lib/ventesYangoFavori.test.mjs
git commit -m "feat(partenaires): semaines et pub du favori Ventes Yango"
```

---

### Task 5: Écran d'import en mode favori

**Files:**
- Modify: `app/tresorerie-partenaires.js` (écran principal + `FeuilleImport`)

**Interfaces:**
- Consumes: `ORIGINE_YANGO`, `semainesProposees`, `etatPub`, `pubParCode`, `messageValide` (Task 4) ; messages de la Task 3 ; `ajouterPubs` (`lib/tresorerieDb.js`, existant).

- [ ] **Step 1: Ouverture automatique**

Dans `app/tresorerie-partenaires.js` :
- imports : ajouter `Platform` à l'import `react-native` ; ajouter
  `import { ORIGINE_YANGO, etatPub, messageValide, pubParCode, semainesProposees } from '../lib/ventesYangoFavori'`.
- dans `TresoreriePartenairesScreen`, après `const [importP, setImportP] = useState(null)` :

```js
  // Ouvert par le favori « Ventes Yango » depuis le portail : import Yango en mode favori.
  const [favori] = useState(() => Platform.OS === 'web' && params.favori === 'yango')
  useEffect(() => {
    if (favori && p) setImportP('yango')
  }, [favori, !!p])
```

- passer `favori={favori && importP === 'yango'}` à `<FeuilleImport … />`.

- [ ] **Step 2: État et écoute dans `FeuilleImport`**

Signature : `function FeuilleImport({ partenaire, donnees, user, onFermer, apres, favori })`. Après les `useState` existants :

```js
  const [pubFavori, setPubFavori] = useState(null)        // { pubs, pubAJourAu }
  const [etatFavori, setEtatFavori] = useState(null)      // { etape: 'attente'|'pret'|'lecture'|'erreur', texte }
  const semaines = useMemo(() => semainesProposees(aujourdhuiISO()), [])
  const [semaine, setSemaine] = useState(null)

  useEffect(() => {
    if (!favori) return
    const opener = typeof window !== 'undefined' ? window.opener : null
    if (!opener) {
      setEtatFavori({ etape: 'erreur', texte: 'Cette fenêtre s’ouvre en cliquant sur le favori « Ventes Yango », depuis le portail Yango.' })
      return
    }
    setEtatFavori({ etape: 'attente', texte: 'Connexion au favori…' })
    function ecoute(e) {
      if (!messageValide(e, opener)) return
      const d = e.data
      if (d.type === 'favori') setEtatFavori({ etape: 'pret', texte: '' })
      else if (d.type === 'progression') setEtatFavori({ etape: 'lecture', texte: String(d.texte || '') })
      else if (d.type === 'erreur') setEtatFavori({ etape: 'erreur', texte: String(d.message || 'La lecture Yango n’a pas abouti.') })
      else if (d.type === 'ventes' && Array.isArray(d.lignes) && d.periode) {
        setFichier({ nom: `Favori Yango du ${formatDateFR(aujourdhuiISO())}`, lignes: d.lignes })
        setSeuil(null)
        setPeriode(periodeDe('yango', d.periode.debut))
        setPubFavori({ pubs: Array.isArray(d.pubs) ? d.pubs : [], pubAJourAu: d.pubAJourAu || null })
        setEtatFavori({ etape: 'pret', texte: '' })
      }
    }
    window.addEventListener('message', ecoute)
    opener.postMessage({ type: 'pret' }, ORIGINE_YANGO)
    return () => window.removeEventListener('message', ecoute)
  }, [favori])

  function lireSemaine(s) {
    setSemaine(s)
    setErreur(null)
    setEtatFavori({ etape: 'lecture', texte: 'Lecture sur le portail Yango…' })
    window.opener?.postMessage({ type: 'lire', debut: s.debut, fin: s.fin }, ORIGINE_YANGO)
  }
```

Dans la fonction `choisir()` (fichier Excel), ajouter `setPubFavori(null)` après `setFichier(f)`.
Dans le `useEffect` de remise à zéro sur `partenaire` (celui qui fait `setFichier(null); setSeuil(null); …`), ajouter `setPubFavori(null)`.

- [ ] **Step 3: Codes de la pub à associer aussi**

Remplacer :

```js
  const codesExport = analyse && !analyse.erreur ? Object.keys(analyse.parCode) : []
```
par
```js
  const codesExport = analyse && !analyse.erreur
    ? [...new Set([...Object.keys(analyse.parCode), ...Object.keys(pubParCode(pubFavori?.pubs))])]
    : []
  const totauxCode = code => analyse.parCode[code] || { nb: 0, montant: 0, paye: 0 }
```

et utiliser `totauxCode(code)` / `totauxCode(c)` à la place de `analyse.parCode[code]` / `analyse.parCode[c]` dans `confirmer()`, `totalPaye` et le rendu « Par restaurant ». Dans la boucle de `confirmer()`, sauter les codes sans commande : `if (!t.nb) continue` après `const t = totauxCode(code)`.

Dans `useEffect` des codes connus, faire la même union pour pré-remplir les codes de la pub (remplacer `Object.keys(analyse.parCode)` par `[...Object.keys(analyse.parCode), ...Object.keys(pubParCode(pubFavori?.pubs))]`, et ajouter `pubFavori` aux dépendances).

- [ ] **Step 4: État de la pub et enregistrement**

Avant `async function confirmer()` :

```js
  const dejaSaisie = periode
    ? donnees.partenaires.lignes
      .filter(l => l.partenaire === 'yango' && l.type === 'pub' && l.periode_debut === periode.debut)
      .reduce((s, l) => s + Number(l.montant || 0), 0)
    : 0
  const pub = partenaire === 'yango' && pubFavori && periode
    ? etatPub({ ...pubFavori, periode, codes, dejaSaisie })
    : null
```

Dans `confirmer()`, juste après `await importerExport({...}, user)` :

```js
      if (pub?.statut === 'a_jour') {
        await ajouterPubs({ partenaire: 'yango', periodeDebut: periode.debut, parts: pub.parts, note: 'Lue sur le portail Yango' }, user)
      }
```

- [ ] **Step 5: Rendu**

Juste après le paragraphe d'explication, avant le bouton fichier :

```jsx
      {favori && (
        <View style={[styles.carte, { marginBottom: 10 }]}>
          <Text style={styles.lbl}>Lire une semaine sur le portail Yango</Text>
          {etatFavori?.etape === 'erreur' && <Text style={[styles.erreur, { marginTop: 6 }]}>{etatFavori.texte}</Text>}
          {(etatFavori?.etape === 'attente' || etatFavori?.etape === 'lecture') && (
            <Text style={[styles.petit, { marginTop: 6 }]}>{etatFavori.texte}</Text>
          )}
          {etatFavori && etatFavori.etape !== 'attente' && window.opener && (
            <>
              <Puces options={semaines.map(s => ({ valeur: s.debut, label: libellePeriode(s) }))}
                valeur={semaine?.debut} onChange={d => setSemaine(semaines.find(s => s.debut === d))} />
              <Bouton titre={semaine ? `Lire la semaine ${libellePeriode(semaine)}` : 'Choisissez une semaine'}
                onPress={() => lireSemaine(semaine)} desactive={!semaine || etatFavori.etape === 'lecture'}
                occupe={etatFavori.etape === 'lecture'} />
            </>
          )}
        </View>
      )}
```

Après la liste « Par restaurant » et avant la carte « Total » :

```jsx
          {pub && (
            <View style={styles.carte}>
              <Text style={styles.lbl}>Pub Yango</Text>
              {pub.statut === 'a_jour' && (
                <>
                  <Text style={styles.petit}>Lue sur le portail : enregistrée avec l'import.</Text>
                  {Object.entries(pub.parCode).map(([code, m]) => (
                    <Ligne key={code} label={code === '?' ? 'Noms inconnus' : code} valeur={-m} />
                  ))}
                  <Ligne label="Total pub" valeur={-pub.total} fort />
                </>
              )}
              {pub.statut === 'pas_a_jour' && (
                <Text style={[styles.petit, { color: colors.error }]}>
                  {pubFavori.pubAJourAu
                    ? `Yango n'a compté la pub que jusqu'au ${formatDateFR(pubFavori.pubAJourAu)} : elle n'est pas enregistrée. Recliquez sur le favori plus tard, ou saisissez-la à la main.`
                    : "Yango n'a encore compté aucune pub pour cette semaine : elle n'est pas enregistrée. Recliquez sur le favori plus tard, ou saisissez-la à la main."}
                </Text>
              )}
              {pub.statut === 'deja_saisie' && (
                <Text style={styles.petit}>Pub déjà saisie pour cette semaine : {fmt(dejaSaisie)} F. Rien n'est ajouté.</Text>
              )}
              {pub.statut === 'aucune' && <Text style={styles.petit}>Aucune pub Yango cette semaine.</Text>}
            </View>
          )}
```

Remarque : vérifier que `Ligne` accepte une valeur négative (sinon passer `valeur={m}` avec `label={`${code} (pub)`}`) — lire `components/tresorerie/commun.js` avant.

- [ ] **Step 6: Vérifications**

Run: `npx eslint app/tresorerie-partenaires.js && for f in lib/*.test.mjs; do node "$f" || exit 1; done`
Expected: 0 erreur, tous les tests PASS.

Run: `npx expo export -p web --output-dir /private/tmp/claude-501/-Users-macbookpro-samtrackly/cf36abaa-fde3-4c54-94d0-01eca44fc5c5/scratchpad/export-web`
Expected: export sans erreur.

- [ ] **Step 7: Commit**

```bash
git add app/tresorerie-partenaires.js
git commit -m "feat(partenaires): import Yango depuis le favori, pub pré-remplie"
```

---

### Task 6: Écran d'installation du favori

**Files:**
- Create: `app/bouton-ventes-yango.js`
- Modify: `app/tresorerie-partenaires.js` (bouton sur la carte Yango)

**Interfaces:**
- Consumes: `construireFavoriVentes` (Task 2), `/bouton-ventes-yango.js` servi par `public/`.

- [ ] **Step 1: Créer l'écran**

Copier la structure de `app/bouton-avis.js` (mêmes `makeStyles`, entête, lien `<a>` glissable posé via `lienRef.setAttribute('href', …)`), avec ces différences :
- en-tête : titre `Favori Ventes Yango`, sous-titre `Les ventes et la pub Yango sans fichier Excel` ;
- pas de champ secret, pas de restriction au manager (le lien ne contient aucun secret ; l'import reste soumis aux droits de Trésorerie) ;
- `fetch('/bouton-ventes-yango.js')` puis `construireFavoriVentes(source, { origine: window.location.origin })` ;
- libellé du lien : `🛵 Ventes Yango → Samtrackly` ;
- étapes affichées :
  1. « Glissez ce bouton dans la barre de favoris de Chrome (ne cliquez pas dessus ici). » + même aide au clic et même astuce Cmd/Ctrl + Maj + B que `bouton-avis.js` ;
  2. « Utilisation » :
     `• Connectez-vous à Samtrackly dans ce même Chrome.`
     `• Ouvrez le portail Yango (n'importe quelle page), cliquez sur le favori.`
     `• Une fenêtre Samtrackly s'ouvre : choisissez la semaine, « Lire la semaine », vérifiez, puis « Importer ».`
     `• La pub est ajoutée seulement quand Yango l'a comptée jusqu'au jeudi.`
     `• Installé depuis une autre adresse que celle-ci, le favori ouvre cette autre adresse : réinstallez-le après un changement d'adresse ou une mise à jour du favori.`
- hors web : « Le favori s'installe dans Chrome, sur ordinateur. Ouvrez Samtrackly dans Chrome pour l'installer. »

- [ ] **Step 2: Bouton sur la carte Yango**

Dans `CartePartenaire`, dans la rangée de boutons, après le bouton « Importer l'export » :

```jsx
        {partenaire === 'yango' && Platform.OS === 'web' && peut(niveau, 'recevoir_partenaires') && (
          <Bouton style={[styles.btnPetit, { flexShrink: 0, paddingHorizontal: 14 }]} secondaire icone="bookmark-outline"
            titre="Favori" onPress={() => router.push('/bouton-ventes-yango')} />
        )}
```

- [ ] **Step 3: Vérifications**

Run: `npx eslint app/bouton-ventes-yango.js app/tresorerie-partenaires.js && npx expo export -p web --output-dir /private/tmp/claude-501/-Users-macbookpro-samtrackly/cf36abaa-fde3-4c54-94d0-01eca44fc5c5/scratchpad/export-web && test -f /private/tmp/claude-501/-Users-macbookpro-samtrackly/cf36abaa-fde3-4c54-94d0-01eca44fc5c5/scratchpad/export-web/bouton-ventes-yango.js`
Expected: 0 erreur, export OK, le moteur est bien copié dans l'export.

- [ ] **Step 4: Commit + push + graphe**

```bash
git add app/bouton-ventes-yango.js app/tresorerie-partenaires.js
git commit -m "feat(partenaires): écran d'installation du favori Ventes Yango"
graphify update . && git add graphify-out && git commit -m "chore(graphify): graphe à jour"
git push
```

---

### Task 7: Essai réel sur le portail (avec l'utilisateur)

Pas de code. Après publication Vercel (sur accord de l'utilisateur) :
1. Installer le favori depuis `samtrackly.vercel.app/bouton-ventes-yango`.
2. Sur vendor.yango.com, cliquer le favori, lire la semaine **25/09 → 01/10** et comparer à l'import du 03/10 : 417 commandes + 20 annulées payées = 437, Montant 2 262 600 + annulées payées, mêmes codes ; pub 127 193 F (à jour : Yango l'avait comptée).
3. Puis lire 16/10 → 22/10 : ventes importables, pub annoncée « pas à jour » (statistiques Yango arrêtées au 05/10).
