# Bouton « Avis → Samtrackly » + rappel — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'extraction automatique des avis (tâches Claude cloud, en échec permanent) par un favori Chrome cliqué sur les portails Glovo/Yango, plus un rappel dans Samtrackly après 2 jours sans nouvel avis.

**Architecture:** Le favori embarque un moteur autonome (`public/bouton-avis.js`, servi tel quel, jamais transpilé) qui lit les avis avec la connexion du portail, puis les transmet par `postMessage` à une page relais statique (`public/envoi-avis.html`) qui appelle l'Edge Function `ingest-reviews`. Un écran manager génère le favori ; l'écran Avis clients et la cloche de l'accueil affichent le rappel calculé par une règle pure.

**Tech Stack:** Expo Router (React Native Web), Supabase (Edge Function Deno + Postgres), JS vanilla pour le favori et le relais, tests `node:test`.

Spec : `docs/superpowers/specs/2026-10-04-bouton-avis-design.md`

## Global Constraints

- Interface, messages et commentaires en **français** ; messages d'erreur en français courant, jamais de code technique.
- Le favori n'affiche ni ne transmet **aucun jeton de connexion** des portails ; seuls des avis sortent de la page.
- Le secret d'ingestion n'est **jamais** dans le code de l'app ni enregistré : le manager le colle une fois, il ne vit que dans le favori.
- Écran d'installation : rôle **manager** uniquement.
- Rappel : plateforme sans nouvel envoi depuis **2 jours** (48 h) → bandeau écran Avis clients + ligne dans la cloche (manager, directeur).
- Période lue : dernier `review_date` reçu − **3 jours**, plafonnée à **45 jours** ; `finalize: false`.
- Format des avis envoyés identique au rattrapage du 04/10 (libellé = identifiant de boutique : `GV_CI;84806`, `1969340`).
- `npm run lint` : 0 erreur. Tous les `lib/*.test.mjs` verts.
- Commit + push à chaque tâche (`DEVELOPER_DIR=/Library/Developer/CommandLineTools git push`). **Pas** de Vercel / EAS / déploiement de fonction avant la Task 8, et seulement avec l'accord d'Ange.
- Ne jamais lancer `expo start` soi-même.
- Fin de commit : `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `lib/avisPlateformes.js` (modif) | + `SEUIL_RAPPEL_JOURS`, `plateformesEnRetard`, `texteRetard` (purs) |
| `lib/avisPlateformesDb.js` (modif) | + `dernierAvisRecu()` |
| `supabase/functions/ingest-reviews/index.ts` (modif) | `GET` renvoie `derniers` par plateforme |
| `public/bouton-avis.js` (nouveau) | moteur du favori : `function moteurAvis()` |
| `public/envoi-avis.js` (nouveau) | logique du relais : `function moteurRelais()` |
| `public/envoi-avis.html` (nouveau) | page relais |
| `lib/boutonAvis.js` (nouveau) | `construireFavori`, `secretValide` (purs) |
| `app/bouton-avis.js` (nouveau) | écran manager d'installation |
| `app/avis-plateformes.js` (modif) | bandeau de rappel + lien manager |
| `context/NotificationsContext.js` + `app/accueil.js` (modif) | rappel dans la cloche |
| `lib/boutonAvis.test.mjs`, `lib/envoiAvis.test.mjs`, `lib/avisPlateformes.test.mjs` | tests |
| `doc/avis-plateformes.md`, spec (modif) | documentation |

Les fichiers de `public/` sont testés en les chargeant comme texte :
`new Function(readFileSync(chemin, 'utf8') + '\nreturn moteurAvis')()`.

---

### Task 1: Règle du rappel (pure)

**Files:**
- Modify: `lib/avisPlateformes.js` (ajout en fin de fichier)
- Test: `lib/avisPlateformes.test.mjs` (ajout en fin de fichier + import)

**Interfaces:**
- Produces: `SEUIL_RAPPEL_JOURS = 2` ; `plateformesEnRetard(derniers: {glovo?: string|null, yango?: string|null}, maintenant?: number, seuilJours?: number) → Array<{platform: 'glovo'|'yango', label: string, jours: number|null}>` (ordre de `PLATEFORMES` : yango puis glovo) ; `texteRetard({label, jours}) → string`.

- [ ] **Step 1: Write the failing test** — ajouter à l'import existant `plateformesEnRetard, texteRetard, SEUIL_RAPPEL_JOURS` puis en fin de fichier :

```js
describe('plateformesEnRetard — rappel « pense à cliquer sur le bouton avis »', () => {
  const MAINTENANT = Date.parse('2026-10-10T12:00:00Z')

  test('le seuil est de 2 jours', () => {
    assert.equal(SEUIL_RAPPEL_JOURS, 2)
  })

  test('envoi il y a moins de 48 h : pas de rappel', () => {
    const r = plateformesEnRetard({ glovo: '2026-10-08T13:00:00Z', yango: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.deepEqual(r, [])
  })

  test('48 h pile : rappel, avec le nombre de jours', () => {
    const r = plateformesEnRetard({ glovo: '2026-10-08T12:00:00Z', yango: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.deepEqual(r, [{ platform: 'glovo', label: 'Glovo', jours: 2 }])
  })

  test('plateforme jamais reçue : rappel sans nombre de jours', () => {
    const r = plateformesEnRetard({ glovo: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.deepEqual(r, [{ platform: 'yango', label: 'Yango', jours: null }])
  })

  test('date illisible : traitée comme jamais reçue', () => {
    const r = plateformesEnRetard({ yango: 'pas une date', glovo: '2026-10-10T08:00:00Z' }, MAINTENANT)
    assert.equal(r[0].jours, null)
  })

  test('texte du rappel', () => {
    assert.equal(texteRetard({ label: 'Yango', jours: 3 }), 'Yango : derniers avis reçus il y a 3 jours')
    assert.equal(texteRetard({ label: 'Glovo', jours: null }), 'Glovo : aucun avis reçu pour le moment')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/avisPlateformes.test.mjs`
Expected: FAIL — `does not provide an export named 'plateformesEnRetard'`

- [ ] **Step 3: Write minimal implementation** — en fin de `lib/avisPlateformes.js` :

```js
// ── Rappel « pense à cliquer sur le bouton avis » ───────────────────────────
// Les avis n'arrivent que quand quelqu'un clique sur le favori Chrome depuis
// le portail Glovo ou Yango. Sans envoi depuis 2 jours sur une plateforme,
// l'écran Avis clients et la cloche de l'accueil le rappellent.
export const SEUIL_RAPPEL_JOURS = 2

const JOUR_MS = 24 * 60 * 60 * 1000

/**
 * Plateformes dont le dernier envoi (`ingested_at` le plus récent) date d'au
 * moins `seuilJours` jours, ou qui n'ont encore rien reçu (jours = null).
 */
export function plateformesEnRetard(derniers = {}, maintenant = Date.now(), seuilJours = SEUIL_RAPPEL_JOURS) {
  return PLATEFORMES
    .map(p => {
      const t = derniers?.[p.key] ? Date.parse(derniers[p.key]) : NaN
      const jours = Number.isFinite(t) ? Math.floor((maintenant - t) / JOUR_MS) : null
      return { platform: p.key, label: p.label, jours }
    })
    .filter(x => x.jours == null || x.jours >= seuilJours)
}

/** Libellé affiché dans le bandeau et dans la cloche. */
export function texteRetard({ label, jours }) {
  return jours == null
    ? `${label} : aucun avis reçu pour le moment`
    : `${label} : derniers avis reçus il y a ${jours} jours`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/avisPlateformes.test.mjs`
Expected: PASS (tous les tests, dont les 6 nouveaux)

- [ ] **Step 5: Commit**

```bash
git add lib/avisPlateformes.js lib/avisPlateformes.test.mjs
git commit -m "feat(avis): règle du rappel après 2 jours sans nouvel avis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 2: `GET ingest-reviews` renvoie le dernier avis par plateforme

**Files:**
- Modify: `supabase/functions/ingest-reviews/index.ts` (bloc `if (req.method === 'GET')` + nouvelle fonction + en-tête)

**Interfaces:**
- Produces: `GET` → `{ done_today: boolean, finished_at: string|null, derniers: { yango: { review_date: string|null, ingested_at: string|null }, glovo: {...} } }`. Le relais (Task 4) lit `derniers`. `POST` inchangé.

Pas de Deno en local : la vérification se fait en Task 8 après déploiement.

- [ ] **Step 1: Ajouter la fonction** juste avant `Deno.serve(` :

```ts
// Dernier avis connu par plateforme : `review_date` sert au bouton avis à
// choisir la période à relire, `ingested_at` au rappel côté app.
async function derniersParPlateforme() {
  const out: Record<string, { review_date: string | null; ingested_at: string | null }> = {}
  for (const p of PLATEFORMES) {
    const [rd, ia] = await Promise.all([
      supabase.from('platform_reviews').select('review_date')
        .eq('platform', p).not('review_date', 'is', null)
        .order('review_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('platform_reviews').select('ingested_at')
        .eq('platform', p)
        .order('ingested_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (rd.error) throw rd.error
    if (ia.error) throw ia.error
    out[p] = { review_date: rd.data?.review_date ?? null, ingested_at: ia.data?.ingested_at ?? null }
  }
  return out
}
```

- [ ] **Step 2: Remplacer le bloc GET** par :

```ts
    if (req.method === 'GET') {
      const [{ data, error }, derniers] = await Promise.all([
        supabase
          .from('ingest_runs')
          .select('run_date, finished_at')
          .eq('run_date', aujourdhui())
          .eq('status', 'ok')
          .maybeSingle(),
        derniersParPlateforme(),
      ])
      if (error) throw error
      return json({ done_today: !!data, finished_at: data?.finished_at ?? null, derniers })
    }
```

- [ ] **Step 3: Mettre à jour l'en-tête** — remplacer la ligne
`//   GET  → { done_today: bool }   le créneau de retry appelle ça d'abord et`
et la suivante par :

```ts
//   GET  → { done_today, finished_at, derniers }   `derniers` donne, par
//          plateforme, le dernier review_date et le dernier ingested_at
//          (période relue par le bouton avis, rappel côté app).
```

- [ ] **Step 4: Relire le diff**

Run: `git diff supabase/functions/ingest-reviews/index.ts`
Expected: seuls l'en-tête, la nouvelle fonction et le bloc GET changent ; le POST est intact.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-reviews/index.ts
git commit -m "feat(avis): ingest-reviews renvoie le dernier avis reçu par plateforme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 3: Moteur du favori (`public/bouton-avis.js`)

**Files:**
- Create: `public/bouton-avis.js`
- Test: `lib/boutonAvis.test.mjs`

**Interfaces:**
- Produces: script contenant uniquement `function moteurAvis()` (aucune référence extérieure), qui retourne `{ periodeLecture, convertirGlovo, convertirYango, plateformeDuSite, lancer }`.
  - `periodeLecture(derniereDate: 'AAAA-MM-JJ'|null, maintenant: number) → { debut: 'AAAA-MM-JJ', fin: 'AAAA-MM-JJ' }`
  - `convertirGlovo(review) → avis au format ingest-reviews`
  - `convertirYango(feedback) → avis au format ingest-reviews`
  - `plateformeDuSite(hote: string) → 'glovo'|'yango'|null`
  - `lancer({ origine: string, secret: string }) → Promise<void>` (exécuté sur le portail)
- Protocole avec le relais (Task 4), messages `{type, …}` :
  relais → portail `pret` ; portail → relais `config {secret}` ; relais → portail `derniers {derniers}` ou `derniers {erreur}` ; portail → relais `avis {reviews}` ou `erreur {message}`.

- [ ] **Step 1: Write the failing test** — créer `lib/boutonAvis.test.mjs` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Tests du bouton « Avis → Samtrackly » (favori Chrome).
//
// Le moteur vit dans public/bouton-avis.js, servi tel quel : il tourne sur les
// portails Glovo et Yango, hors de l'app. On le charge ici comme du texte pour
// tester ses conversions — un thème mal traduit ou un pouce inversé ferait
// créer (ou rater) des litiges à 1000 FCFA.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../public/bouton-avis.js', import.meta.url), 'utf8')
const moteurAvis = new Function(source + '\nreturn moteurAvis')()
const { periodeLecture, convertirGlovo, convertirYango, plateformeDuSite } = moteurAvis()

const MAINTENANT = Date.parse('2026-10-10T12:00:00Z')

describe('periodeLecture — quels jours relire', () => {
  test('depuis le dernier avis reçu, moins 3 jours de marge', () => {
    assert.deepEqual(periodeLecture('2026-10-08', MAINTENANT), { debut: '2026-10-05', fin: '2026-10-10' })
  })
  test('jamais plus de 45 jours en arrière', () => {
    assert.deepEqual(periodeLecture('2026-01-01', MAINTENANT), { debut: '2026-08-26', fin: '2026-10-10' })
  })
  test('aucun avis reçu : les 45 derniers jours', () => {
    assert.deepEqual(periodeLecture(null, MAINTENANT), { debut: '2026-08-26', fin: '2026-10-10' })
  })
})

describe('convertirGlovo — un avis Glovo au format Samtrackly', () => {
  const brut = {
    id: '101791205516-review', orderId: '101791205516', globalVendorCode: 'GV_CI;84806',
    date: '2026-10-03T02:41:04Z', rating: 1, text: 'Froid', thumbs_up: false,
    vendor_pills: ['TASTED_BAD', 'MISSING_OR_MISTAKEN_ITEMS', 'CODE_NOUVEAU'],
    product_ratings: [{ name: 'Chawarma Poulet' }],
  }
  test('pouce rouge = négatif, n° de commande, date, boutique par son code', () => {
    const a = convertirGlovo(brut)
    assert.equal(a.platform, 'glovo')
    assert.equal(a.classification, 'negatif')
    assert.equal(a.external_ref, '101791205516')
    assert.equal(a.external_store_label, 'GV_CI;84806')
    assert.equal(a.review_date, '2026-10-03')
    assert.equal(a.comment, 'Froid')
    assert.equal(a.rating_raw, null)
  })
  test('thèmes traduits comme au 05/09, code inconnu gardé tel quel', () => {
    assert.deepEqual(convertirGlovo(brut).raw.theme, ['Mauvais goût', 'Produits manquants ou incorrects', 'CODE_NOUVEAU'])
  })
  test('un plat → texte, plusieurs → liste, aucun → absent', () => {
    assert.equal(convertirGlovo(brut).raw.dish, 'Chawarma Poulet')
    assert.deepEqual(convertirGlovo({ ...brut, product_ratings: [{ name: 'A' }, { name: 'B' }] }).raw.dish, ['A', 'B'])
    assert.equal('dish' in convertirGlovo({ ...brut, product_ratings: [] }).raw, false)
  })
  test('pouce vert = bon ; pas de thème → pas de clé theme', () => {
    const a = convertirGlovo({ ...brut, thumbs_up: true, vendor_pills: [], text: '' })
    assert.equal(a.classification, 'bon')
    assert.equal(a.comment, '')
    assert.equal('theme' in a.raw, false)
  })
  test('nom lisible de la boutique conservé', () => {
    assert.equal(convertirGlovo(brut).raw.store_name, 'Chez Samer (Riviéra Palmeraie Abidjan CI) [ABN]')
  })
})

describe('convertirYango — un avis Yango au format Samtrackly', () => {
  const brut = {
    order: { order_nr: '261003-CI0622322', place_id: '1969340' },
    order_feedback: { id: 2001389143, rating: 1, feedback_filled_at: '2026-10-03T21:05:00+00:00',
      predefined_comments: [{ comment: 'Pas très bon' }] },
  }
  test('note sous 3 = négatif, tags dans raw.tag, boutique par place_id', () => {
    const a = convertirYango(brut)
    assert.equal(a.platform, 'yango')
    assert.equal(a.classification, 'negatif')
    assert.equal(a.rating_raw, 1)
    assert.equal(a.rating_scale, 5)
    assert.equal(a.external_ref, '261003-CI0622322')
    assert.equal(a.external_store_label, '1969340')
    assert.equal(a.review_date, '2026-10-03')
    assert.equal(a.comment, '')
    assert.deepEqual(a.raw.tag, ['Pas très bon'])
  })
  test('3 étoiles = bon ; sans tag → pas de clé tag', () => {
    const a = convertirYango({ ...brut, order_feedback: { ...brut.order_feedback, rating: 3, predefined_comments: [] } })
    assert.equal(a.classification, 'bon')
    assert.equal('tag' in a.raw, false)
  })
})

describe('plateformeDuSite', () => {
  test('reconnaît les deux portails, rien d’autre', () => {
    assert.equal(plateformeDuSite('portal.glovoapp.com'), 'glovo')
    assert.equal(plateformeDuSite('vendor.yango.com'), 'yango')
    assert.equal(plateformeDuSite('samtrackly.vercel.app'), null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/boutonAvis.test.mjs`
Expected: FAIL — `ENOENT … public/bouton-avis.js`

- [ ] **Step 3: Write the implementation** — créer `public/bouton-avis.js` :

```js
/* global window, document, localStorage, location, alert, fetch, Request */
// ──────────────────────────────────────────────────────────────────────────────
//  MOTEUR DU BOUTON « AVIS → SAMTRACKLY » (favori Chrome)
//
//  Servi tel quel (jamais transpilé) : l'écran app/bouton-avis.js le lit et
//  l'emballe dans un favori `javascript:` avec l'origine Samtrackly et le
//  secret d'ingestion. Le favori tourne SUR le portail Glovo ou Yango :
//    1. ouvre tout de suite la fenêtre relais /envoi-avis.html (encore dans
//       le geste de clic, sinon Chrome la bloque) ;
//    2. reçoit du relais la date du dernier avis connu ;
//    3. lit les avis de la période avec la connexion du portail ;
//    4. les transmet au relais, qui les envoie à ingest-reviews.
//  Aucun jeton du portail ne sort de la page : seuls des avis sont transmis.
//
//  Tout doit rester DANS moteurAvis() : le favori n'embarque que cette
//  fonction. Tests : lib/boutonAvis.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
function moteurAvis() {
  var JOUR = 86400000
  var MARGE_JOURS = 3
  var PLAFOND_JOURS = 45
  var PAR_PAGE = 50
  var URL_GLOVO = 'https://vrs-api.eu.prd.portal.restaurant/v1/reviews'

  // Mêmes libellés que les avis du 05/09 et du rattrapage du 04/10.
  var THEMES_GLOVO = {
    TASTY: 'Bon goût',
    GOOD_VALUE: 'Bon rapport qualité-prix',
    PORTION_SIZE: 'Taille des portions',
    PACKAGING_QUALITY: "Qualité de l'emballage",
    SPEED_AND_RELIABILITY: 'Rapidité et fiabilité',
    MISSING_OR_MISTAKEN_ITEMS: 'Produits manquants ou incorrects',
    SMALL_PORTION_SIZE: 'Portion trop petite',
    TASTED_BAD: 'Mauvais goût',
    EXPENSIVE: 'Cher',
  }

  // Les 9 boutiques Glovo du groupe. Une nouvelle boutique doit être ajoutée
  // ici (et rattachée dans Samtrackly) pour que ses avis soient lus.
  var NOMS_GLOVO = {
    'GV_CI;109742': 'Al Kayan (Annaneraie) [YOP]',
    'GV_CI;315921': 'Al Kayan - ABN - Remblais',
    'GV_CI;109738': 'Chez Samer (21 BP915 21) [YOP]',
    'GV_CI;775202': 'Chez Samer (C323+24J) [ABN]',
    'GV_CI;219425': 'Chez Samer (L 155 - Voie de la 7e Tranche) [ABN]',
    'GV_CI;84806': 'Chez Samer (Riviéra Palmeraie Abidjan CI) [ABN]',
    'GV_CI;145792': 'Chez Samer (S 584) [YOP]',
    'GV_CI;121904': 'Chez Samer (S CI) [YOP]',
    'GV_CI;867368': 'Resto Xpress',
  }

  var NOMS = { glovo: 'Glovo', yango: 'Yango' }

  function jourIso(ms) { return new Date(ms).toISOString().slice(0, 10) }

  function periodeLecture(derniereDate, maintenant) {
    var plancher = jourIso(maintenant - PLAFOND_JOURS * JOUR)
    var debut = plancher
    if (derniereDate) {
      var d = jourIso(Date.parse(derniereDate + 'T00:00:00Z') - MARGE_JOURS * JOUR)
      if (d > plancher) debut = d
    }
    return { debut: debut, fin: jourIso(maintenant) }
  }

  function convertirGlovo(r) {
    var raw = { glovo_vendor_id: r.globalVendorCode, store_name: NOMS_GLOVO[r.globalVendorCode] || r.globalVendorCode }
    var themes = (r.vendor_pills || []).map(function (p) { return THEMES_GLOVO[p] || p })
    if (themes.length) raw.theme = themes
    var plats = (r.product_ratings || []).map(function (p) { return p.name }).filter(Boolean)
    if (plats.length) raw.dish = plats.length === 1 ? plats[0] : plats
    return {
      platform: 'glovo',
      external_store_label: r.globalVendorCode,
      external_ref: String(r.orderId),
      classification: r.thumbs_up ? 'bon' : 'negatif',
      comment: r.text || '',
      review_date: String(r.date).slice(0, 10),
      rating_raw: null,
      raw: raw,
    }
  }

  function convertirYango(f) {
    var avis = f.order_feedback || {}
    var tags = (avis.predefined_comments || []).map(function (c) { return c.comment }).filter(Boolean)
    var raw = { yango_place_id: String(f.order.place_id), yango_feedback_id: avis.id }
    if (tags.length) raw.tag = tags
    var note = Number(avis.rating)
    return {
      platform: 'yango',
      external_store_label: String(f.order.place_id),
      external_ref: f.order.order_nr,
      rating_raw: note,
      rating_scale: 5,
      classification: note < 3 ? 'negatif' : 'bon',
      comment: avis.comment || '',
      review_date: String(avis.feedback_filled_at).slice(0, 10),
      raw: raw,
    }
  }

  function plateformeDuSite(hote) {
    if (hote === 'portal.glovoapp.com') return 'glovo'
    if (hote === 'vendor.yango.com') return 'yango'
    return null
  }

  // ── Exécution sur le portail ─────────────────────────────────────────────
  function erreurFr(message) { var e = new Error(message); e.messageFr = message; return e }

  function frDate(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] }

  function bandeau() {
    var div = document.createElement('div')
    div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:14px 16px;'
      + 'background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)'
    document.body.appendChild(div)
    return function (texte, fermerApresMs) {
      div.textContent = '⭐ ' + texte
      if (fermerApresMs) setTimeout(function () { div.remove() }, fermerApresMs)
    }
  }

  function attendreMessage(fen, origine, type, delaiMs) {
    return new Promise(function (ok, ko) {
      var minuteur = setTimeout(function () {
        window.removeEventListener('message', ecoute)
        ko(erreurFr("La fenêtre d'envoi ne répond pas : clique à nouveau sur le bouton avis."))
      }, delaiMs)
      function ecoute(e) {
        if (e.source !== fen || e.origin !== origine || !e.data || e.data.type !== type) return
        clearTimeout(minuteur)
        window.removeEventListener('message', ecoute)
        ok(e.data)
      }
      window.addEventListener('message', ecoute)
    })
  }

  function jetonGlovo() {
    try {
      var racine = JSON.parse(localStorage.getItem('persist:root'))
      var t = JSON.parse(racine.authentication).accessToken
      return typeof t === 'string' && t.charAt(0) === '"' ? JSON.parse(t) : t
    } catch (e) { return null }
  }

  async function lireGlovo(periode, info) {
    var expire = 'Ta session Glovo a expiré : reconnecte-toi au portail puis clique à nouveau.'
    var jeton = jetonGlovo()
    if (!jeton) throw erreurFr(expire)
    var tous = []
    var apres = null
    for (var page = 0; page < 200; page++) {
      var corps = {
        global_vendor_codes: Object.keys(NOMS_GLOVO), include_stats: false,
        pagination: { perPage: PAR_PAGE },
        filter: { ratingMin: 1, ratingMax: 5, hasText: false,
          startDate: periode.debut + 'T00:00:00.000Z', endDate: periode.fin + 'T23:59:59.999Z' },
      }
      if (apres) { corps.pagination.afterId = apres.id; corps.pagination.afterTimestamp = apres.date }
      var r = await fetch(URL_GLOVO, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
        body: JSON.stringify(corps),
      })
      if (r.status === 401 || r.status === 403) throw erreurFr(expire)
      if (!r.ok) throw erreurFr("Glovo n'a pas répondu : clique à nouveau dans quelques minutes.")
      var lot = (await r.json()).reviews || []
      tous = tous.concat(lot.map(convertirGlovo))
      info('Lecture des avis Glovo… ' + tous.length + ' lus')
      if (lot.length < PAR_PAGE) break
      var dernier = lot[lot.length - 1]
      apres = { id: dernier.id, date: new Date(dernier.date).toISOString() }
    }
    return tous
  }

  // Yango : on ne touche pas à la connexion. On laisse la page émettre sa
  // propre demande d'avis (bouton « Afficher plus ») et on la réutilise en ne
  // changeant que la période et le curseur.
  function capturerRequeteYango(info) {
    return new Promise(function (ok, ko) {
      var fetchPage = window.fetch
      var fini = false
      var minuteur = setTimeout(function () {
        if (fini) return
        fini = true
        window.fetch = fetchPage
        ko(erreurFr('Fais défiler la liste des avis Yango jusqu’en bas, clique sur « Afficher plus », puis clique à nouveau sur le bouton avis.'))
      }, 20000)
      window.fetch = function (entree) {
        if (!fini && entree instanceof Request && entree.url.indexOf('places-order-feedbacks') !== -1) {
          fini = true
          clearTimeout(minuteur)
          window.fetch = fetchPage
          ok(entree.clone())
        }
        return fetchPage.apply(this, arguments)
      }
      var bouton = Array.prototype.slice.call(document.querySelectorAll('button'))
        .find(function (b) { return b.textContent.trim() === 'Afficher plus' })
      if (bouton) bouton.click()
      else info('Clique sur « Afficher plus » en bas de la liste des avis…')
    })
  }

  async function lireYango(periode, info) {
    if (location.pathname.indexOf('/feedback') !== 0) {
      throw erreurFr('Ouvre la page Avis du portail Yango (filtre « Tous les restaurants »), puis clique à nouveau sur le bouton avis.')
    }
    var modele = await capturerRequeteYango(info)
    var base = JSON.parse(await modele.clone().text())
    var tous = []
    var curseur = null
    for (var page = 0; page < 200; page++) {
      var corps = Object.assign({}, base, {
        limit: PAR_PAGE, from: periode.debut + 'T00:00:00Z', to: periode.fin + 'T23:59:59Z',
      })
      if (curseur) corps.cursor = curseur
      else delete corps.cursor
      var r = await fetch(new Request(modele, { body: JSON.stringify(corps) }))
      if (r.status === 401 || r.status === 403) throw erreurFr('Ta session Yango a expiré : reconnecte-toi au portail puis clique à nouveau.')
      if (!r.ok) throw erreurFr("Yango n'a pas répondu : clique à nouveau dans quelques minutes.")
      var j = await r.json()
      var lot = j.feedbacks || []
      tous = tous.concat(lot.map(convertirYango))
      info('Lecture des avis Yango… ' + tous.length + ' lus')
      if (!lot.length || !j.cursor) break
      curseur = j.cursor
    }
    return tous
  }

  async function lancer(cfg) {
    var plateforme = plateformeDuSite(location.hostname)
    if (!plateforme) {
      alert('Ouvre le portail Glovo ou la page Avis de Yango, puis clique à nouveau sur le bouton avis.')
      return
    }
    var fen = window.open(cfg.origine + '/envoi-avis.html', 'envoi-avis', 'width=440,height=320')
    if (!fen) {
      alert("Chrome a bloqué la fenêtre d'envoi : autorise les fenêtres pour ce site, puis clique à nouveau.")
      return
    }
    var info = bandeau()
    var nom = NOMS[plateforme]
    info('Avis ' + nom + ' : préparation…')
    try {
      await attendreMessage(fen, cfg.origine, 'pret', 20000)
      fen.postMessage({ type: 'config', secret: cfg.secret }, cfg.origine)
      var reponse = await attendreMessage(fen, cfg.origine, 'derniers', 20000)
      if (reponse.erreur) throw erreurFr(reponse.erreur)
      var dernier = reponse.derniers && reponse.derniers[plateforme]
      var periode = periodeLecture(dernier ? dernier.review_date : null, Date.now())
      info('Lecture des avis ' + nom + ' du ' + frDate(periode.debut) + ' au ' + frDate(periode.fin) + '…')
      var avis = plateforme === 'glovo' ? await lireGlovo(periode, info) : await lireYango(periode, info)
      fen.postMessage({ type: 'avis', reviews: avis }, cfg.origine)
      info(avis.length + ' avis ' + nom + ' transmis : le résultat s’affiche dans la petite fenêtre.', 10000)
    } catch (e) {
      var message = e && e.messageFr ? e.messageFr
        : "La lecture des avis n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes."
      try { fen.postMessage({ type: 'erreur', message: message }, cfg.origine) } catch (_) { /* fenêtre fermée */ }
      info(message, 15000)
    }
  }

  return {
    periodeLecture: periodeLecture,
    convertirGlovo: convertirGlovo,
    convertirYango: convertirYango,
    plateformeDuSite: plateformeDuSite,
    lancer: lancer,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/boutonAvis.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Lint**

Run: `npx eslint public/bouton-avis.js`
Expected: 0 erreur (avertissements tolérés, ex. `moteurAvis` non utilisée).

- [ ] **Step 6: Commit**

```bash
git add public/bouton-avis.js lib/boutonAvis.test.mjs
git commit -m "feat(avis): moteur du bouton favori — lecture Glovo/Yango et conversion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 4: Page relais (`public/envoi-avis.html` + `public/envoi-avis.js`)

**Files:**
- Create: `public/envoi-avis.js`, `public/envoi-avis.html`
- Test: `lib/envoiAvis.test.mjs`

**Interfaces:**
- Consumes: protocole de la Task 3 ; `GET` de la Task 2 (`derniers`, absent tant que la fonction n'est pas redéployée → traité comme `{}`).
- Produces: `function moteurRelais()` → `{ plateformeDOrigine(origine) → 'glovo'|'yango'|null, messageHttp(status) → string, resumeEnvoi(plateforme, resultat) → string, demarrer(urlFonction) → void }`.

- [ ] **Step 1: Write the failing test** — créer `lib/envoiAvis.test.mjs` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Tests de la page relais du bouton avis (public/envoi-avis.js).
//
// Le relais tient le secret le temps d'un envoi : il ne doit écouter que les
// deux portails, et parler à l'utilisateur en français sans code technique.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../public/envoi-avis.js', import.meta.url), 'utf8')
const { plateformeDOrigine, messageHttp, resumeEnvoi } = new Function(source + '\nreturn moteurRelais')()()

describe('plateformeDOrigine — seuls les deux portails sont écoutés', () => {
  test('origines exactes', () => {
    assert.equal(plateformeDOrigine('https://portal.glovoapp.com'), 'glovo')
    assert.equal(plateformeDOrigine('https://vendor.yango.com'), 'yango')
  })
  test('tout le reste est refusé, y compris les imitations', () => {
    assert.equal(plateformeDOrigine('https://portal.glovoapp.com.evil.test'), null)
    assert.equal(plateformeDOrigine('http://vendor.yango.com'), null)
    assert.equal(plateformeDOrigine('https://samtrackly.vercel.app'), null)
  })
})

describe('messageHttp — erreurs en français', () => {
  test('secret refusé : le bouton est à réinstaller', () => {
    assert.equal(messageHttp(401), "Le bouton n'est plus à jour : demande au manager de le réinstaller.")
  })
  test('autre erreur : rien n’est perdu', () => {
    assert.equal(messageHttp(500), "L'envoi n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes.")
  })
})

describe('resumeEnvoi — le résultat affiché', () => {
  test('nouveaux avis, litiges, boutiques à rattacher', () => {
    assert.equal(resumeEnvoi('glovo', { inserted: 37, litiges_crees: 4, unmapped: 2 }),
      'Glovo : 37 nouveaux avis · 4 litiges créés · 2 à rattacher')
  })
  test('singulier', () => {
    assert.equal(resumeEnvoi('yango', { inserted: 1, litiges_crees: 1, unmapped: 0 }),
      'Yango : 1 nouvel avis · 1 litige créé')
  })
  test('rien de nouveau', () => {
    assert.equal(resumeEnvoi('glovo', { inserted: 0, litiges_crees: 0, unmapped: 0 }),
      'Glovo : aucun nouvel avis depuis le dernier envoi.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/envoiAvis.test.mjs`
Expected: FAIL — `ENOENT … public/envoi-avis.js`

- [ ] **Step 3: Write `public/envoi-avis.js`**

```js
/* global window, document, fetch */
// ──────────────────────────────────────────────────────────────────────────────
//  PAGE RELAIS DU BOUTON AVIS — /envoi-avis.html
//
//  Ouverte par le favori depuis le portail Glovo ou Yango. Elle reçoit le
//  secret puis les avis par postMessage et les envoie à ingest-reviews :
//  Yango interdit à ses pages d'appeler un autre site, le relais le fait à
//  sa place. Page statique, hors de l'app (pas de session, pas de garde).
//  N'écoute QUE les deux portails. Tests : lib/envoiAvis.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
function moteurRelais() {
  var PLATEFORMES = { 'https://portal.glovoapp.com': 'glovo', 'https://vendor.yango.com': 'yango' }
  var NOMS = { glovo: 'Glovo', yango: 'Yango' }
  var RESEAU = "L'envoi n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes."

  function plateformeDOrigine(origine) {
    return Object.prototype.hasOwnProperty.call(PLATEFORMES, origine) ? PLATEFORMES[origine] : null
  }

  function messageHttp(status) {
    return status === 401 ? "Le bouton n'est plus à jour : demande au manager de le réinstaller." : RESEAU
  }

  function pluriel(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un) }

  function resumeEnvoi(plateforme, r) {
    var nom = NOMS[plateforme] || plateforme
    if (!r.inserted) return nom + ' : aucun nouvel avis depuis le dernier envoi.'
    var parties = [pluriel(r.inserted, 'nouvel avis', 'nouveaux avis'), pluriel(r.litiges_crees || 0, 'litige créé', 'litiges créés')]
    if (r.unmapped) parties.push(r.unmapped + ' à rattacher')
    return nom + ' : ' + parties.join(' · ')
  }

  function demarrer(urlFonction) {
    var etat = document.getElementById('etat')
    function afficher(texte, genre) { etat.textContent = texte; etat.className = genre || '' }

    if (!window.opener) {
      afficher('Cette page s’ouvre toute seule quand on clique sur le bouton avis, depuis le portail Glovo ou Yango.')
      return
    }

    var secret = null
    var plateforme = null

    window.addEventListener('message', async function (e) {
      var p = plateformeDOrigine(e.origin)
      if (!p || e.source !== window.opener || !e.data) return
      var portail = e.source

      if (e.data.type === 'config') {
        secret = String(e.data.secret || '')
        plateforme = p
        afficher('Avis ' + NOMS[p] + ' : lecture en cours sur le portail…')
        try {
          var r = await fetch(urlFonction, { headers: { 'x-ingest-secret': secret } })
          if (!r.ok) {
            var m = messageHttp(r.status)
            afficher(m, 'erreur')
            portail.postMessage({ type: 'derniers', erreur: m }, e.origin)
            return
          }
          var j = await r.json()
          portail.postMessage({ type: 'derniers', derniers: j.derniers || {} }, e.origin)
        } catch (_) {
          afficher(RESEAU, 'erreur')
          portail.postMessage({ type: 'derniers', erreur: RESEAU }, e.origin)
        }
      } else if (e.data.type === 'avis' && secret && p === plateforme) {
        var avis = Array.isArray(e.data.reviews) ? e.data.reviews : []
        afficher('Envoi de ' + avis.length + ' avis ' + NOMS[p] + ' à Samtrackly…')
        try {
          var envoi = await fetch(urlFonction, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
            body: JSON.stringify({ reviews: avis, finalize: false }),
          })
          if (!envoi.ok) { afficher(messageHttp(envoi.status), 'erreur'); return }
          afficher(resumeEnvoi(p, await envoi.json()), 'ok')
          setTimeout(function () { window.close() }, 8000)
        } catch (_) {
          afficher(RESEAU, 'erreur')
        }
      } else if (e.data.type === 'erreur') {
        afficher(String(e.data.message || RESEAU), 'erreur')
      }
    })

    window.opener.postMessage({ type: 'pret' }, '*')
  }

  return { plateformeDOrigine: plateformeDOrigine, messageHttp: messageHttp, resumeEnvoi: resumeEnvoi, demarrer: demarrer }
}
```

- [ ] **Step 4: Write `public/envoi-avis.html`**

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Envoi des avis</title>
  <style>
    :root { --fond: #f5f5f4; --texte: #1c1917; --ok: #2e7d32; --erreur: #c62828; }
    @media (prefers-color-scheme: dark) { :root { --fond: #1c1917; --texte: #f5f5f4; --ok: #66bb6a; --erreur: #ef5350; } }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: var(--fond); color: var(--texte); font: 16px/1.5 system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
    main { max-width: 380px; text-align: center; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    #etat.ok { color: var(--ok); font-weight: 600; }
    #etat.erreur { color: var(--erreur); font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>⭐ Avis → Samtrackly</h1>
    <p id="etat">Connexion au portail…</p>
  </main>
  <script src="/envoi-avis.js"></script>
  <script>moteurRelais().demarrer('https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-reviews')</script>
</body>
</html>
```

- [ ] **Step 5: Run tests + lint**

Run: `node --test lib/envoiAvis.test.mjs && npx eslint public/envoi-avis.js`
Expected: PASS (7 tests), 0 erreur de lint.

- [ ] **Step 6: Vérifier que l'export web garde les fichiers statiques**

Run: `npx expo export -p web && ls dist/envoi-avis.html dist/envoi-avis.js dist/bouton-avis.js`
Expected: les trois fichiers existent dans `dist/` (servis avant la réécriture `/(.*) → /` de `vercel.json`, qui ne s'applique qu'aux chemins sans fichier).

- [ ] **Step 7: Commit**

```bash
git add public/envoi-avis.js public/envoi-avis.html lib/envoiAvis.test.mjs
git commit -m "feat(avis): page relais du bouton avis (envoi à ingest-reviews)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 5: Écran manager « Bouton avis » (génération du favori)

**Files:**
- Create: `lib/boutonAvis.js`, `app/bouton-avis.js`
- Test: `lib/boutonAvis.test.mjs` (ajout)

**Interfaces:**
- Consumes: `public/bouton-avis.js` (Task 3), servi à `/bouton-avis.js`.
- Produces: `secretValide(s) → boolean` (64 caractères hexadécimaux) ; `construireFavori(source: string, { origine, secret }) → 'javascript:…'` ; route `/bouton-avis`.

- [ ] **Step 1: Write the failing test** — dans `lib/boutonAvis.test.mjs`, ajouter en haut, sous les autres imports :

```js
import { construireFavori, secretValide } from './boutonAvis.js'
```

puis en fin de fichier :

```js
describe('construireFavori — le favori à glisser dans Chrome', () => {
  const SECRET = 'a'.repeat(64)

  test('secret attendu : 64 caractères hexadécimaux', () => {
    assert.equal(secretValide(SECRET), true)
    assert.equal(secretValide('  ' + SECRET + ' '), true)
    assert.equal(secretValide('abc'), false)
    assert.equal(secretValide('z'.repeat(64)), false)
    assert.equal(secretValide(''), false)
  })

  test('un lien javascript: qui embarque le moteur et lance avec la bonne config', () => {
    const fav = construireFavori(source, { origine: 'https://samtrackly.vercel.app/', secret: ' ' + SECRET })
    assert.ok(fav.startsWith('javascript:'))
    const code = decodeURIComponent(fav.slice('javascript:'.length))
    assert.ok(code.includes('function moteurAvis()'))
    assert.ok(code.includes(`moteurAvis().lancer({"origine":"https://samtrackly.vercel.app","secret":"${SECRET}"})`))
    // Le code doit être du JavaScript valide (compilé, pas exécuté).
    assert.doesNotThrow(() => new Function(code))
  })

  test('refuse une source qui n’est pas le moteur', () => {
    assert.throws(() => construireFavori('<!doctype html>', { origine: 'https://x.test', secret: SECRET }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/boutonAvis.test.mjs`
Expected: FAIL — `Cannot find module … lib/boutonAvis.js`

- [ ] **Step 3: Write `lib/boutonAvis.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
//  BOUTON « AVIS → SAMTRACKLY » — fabrication du favori Chrome
//
//  Le moteur (public/bouton-avis.js) est servi tel quel ; on l'emballe ici
//  dans un lien `javascript:` avec l'origine Samtrackly (où vit la page
//  relais) et le secret d'ingestion collé par le manager. Le secret n'est
//  jamais enregistré : il ne vit que dans le favori.
// ──────────────────────────────────────────────────────────────────────────────

/** Le secret d'ingestion : 64 caractères hexadécimaux (openssl rand -hex 32). */
export function secretValide(secret) {
  return /^[0-9a-f]{64}$/i.test(String(secret || '').trim())
}

export function construireFavori(source, { origine, secret }) {
  if (!source || !String(source).includes('function moteurAvis()')) {
    throw new Error('Le code du bouton est introuvable.')
  }
  const config = JSON.stringify({
    origine: String(origine).replace(/\/+$/, ''),
    secret: String(secret).trim(),
  })
  return 'javascript:' + encodeURIComponent(`(function(){${source}\nmoteurAvis().lancer(${config})})()`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/boutonAvis.test.mjs`
Expected: PASS (14 tests)

- [ ] **Step 5: Write `app/bouton-avis.js`**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
//  BOUTON AVIS — installation (manager uniquement)
//
//  Génère le favori Chrome « ⭐ Avis → Samtrackly » : on le glisse dans la
//  barre de favoris, puis on clique dessus depuis le portail Glovo ou la page
//  Avis de Yango pour envoyer les nouveaux avis. Le secret d'ingestion est
//  collé ici une fois et n'est enregistré nulle part.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { construireFavori, secretValide } from '../lib/boutonAvis'
import { retour } from '../lib/navigation'

export default function BoutonAvis() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif } = useApp()
  const web = Platform.OS === 'web'

  const [secret, setSecret] = useState('')
  const [source, setSource] = useState(null)
  const [erreur, setErreur] = useState(null)
  const lienRef = useRef(null)

  useEffect(() => {
    if (!web) return
    fetch('/bouton-avis.js')
      .then(r => (r.ok ? r.text() : Promise.reject(new Error('absent'))))
      .then(setSource)
      .catch(() => setErreur("Le code du bouton n'a pas pu être chargé. Rechargez la page."))
  }, [web])

  const favori = useMemo(() => {
    if (!web || !source || !secretValide(secret)) return null
    return construireFavori(source, { origine: window.location.origin, secret })
  }, [web, source, secret])

  // React bloque les liens « javascript: » passés en href : on pose
  // l'adresse directement sur l'élément.
  useEffect(() => {
    if (lienRef.current && favori) lienRef.current.setAttribute('href', favori)
  }, [favori])

  const entete = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitre}>Bouton avis</Text>
      <Text style={styles.headerSub}>Envoyer les avis Glovo & Yango en un clic</Text>
    </View>
  )

  if (roleActif !== 'manager') {
    return (
      <SafeAreaView style={styles.container}>
        {entete}
        <View style={styles.body}><Text style={styles.texte}>Cet écran est réservé au manager.</Text></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {entete}
      <ScrollView style={styles.body}>
        {!web ? (
          <Text style={styles.texte}>
            Le bouton s'installe dans Chrome, sur ordinateur. Ouvrez Samtrackly dans Chrome pour l'installer.
          </Text>
        ) : (
          <>
            <Text style={styles.etape}>1. Collez le secret d'ingestion</Text>
            <Text style={styles.aide}>
              Il se trouve dans votre gestionnaire de mots de passe (64 caractères). Il n'est enregistré nulle part.
            </Text>
            <TextInput
              style={styles.champ}
              value={secret}
              onChangeText={setSecret}
              placeholder="Secret d'ingestion"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {secret && !secretValide(secret) ? (
              <Text style={styles.erreur}>Ce secret n'a pas le bon format : 64 caractères (chiffres et lettres a à f).</Text>
            ) : null}
            {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

            <Text style={styles.etape}>2. Glissez ce bouton dans la barre de favoris de Chrome</Text>
            {favori ? (
              <a
                ref={lienRef}
                draggable
                onClick={e => e.preventDefault()}
                style={{
                  display: 'inline-block', alignSelf: 'flex-start', padding: '12px 18px', borderRadius: 10,
                  background: colors.primary, color: '#FFFFFF', fontWeight: 700, fontSize: 15,
                  textDecoration: 'none', cursor: 'grab', marginBottom: 6,
                }}
              >
                ⭐ Avis → Samtrackly
              </a>
            ) : (
              <Text style={styles.aide}>Le bouton apparaît dès que le secret est collé.</Text>
            )}
            <Text style={styles.aide}>
              Barre de favoris cachée : Cmd + Maj + B (Mac) ou Ctrl + Maj + B (Windows).
            </Text>

            <Text style={styles.etape}>3. Utilisation</Text>
            <Text style={styles.texte}>
              • Glovo : sur n'importe quelle page du portail Glovo, cliquez sur le bouton.{'\n'}
              • Yango : ouvrez la page Avis (filtre « Tous les restaurants »), puis cliquez sur le bouton.{'\n'}
              • Une petite fenêtre affiche le résultat : nouveaux avis, litiges créés.{'\n'}
              • Un clic par portail, idéalement chaque jour. Samtrackly le rappelle après 2 jours sans envoi.
            </Text>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  backBtn: { marginBottom: 8 },
  backTxt: { color: colors.primaryText, fontSize: 14 },
  headerTitre: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },
  body: { flex: 1, padding: 16 },
  etape: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 6 },
  aide: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: 8 },
  texte: { fontSize: 14, color: colors.text, lineHeight: 22 },
  champ: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, minHeight: 48, color: colors.text, fontSize: 14 },
  erreur: { fontSize: 13, color: colors.errorDark, marginTop: 8 },
}) }
```

- [ ] **Step 6: Lint**

Run: `npx eslint app/bouton-avis.js lib/boutonAvis.js`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add lib/boutonAvis.js lib/boutonAvis.test.mjs app/bouton-avis.js
git commit -m "feat(avis): écran manager d'installation du bouton avis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 6: Bandeau de rappel + lien manager dans l'écran Avis clients

**Files:**
- Modify: `lib/avisPlateformesDb.js` (import + nouvelle fonction en fin de fichier)
- Modify: `app/avis-plateformes.js` (imports, état, `charger()`, en-tête, bandeau, styles)

**Interfaces:**
- Consumes: `plateformesEnRetard`, `texteRetard` (Task 1) ; route `/bouton-avis` (Task 5).
- Produces: `dernierAvisRecu() → Promise<{ yango: string|null, glovo: string|null }>` (dernier `ingested_at`), utilisé aussi en Task 7.

- [ ] **Step 1: Ajouter `dernierAvisRecu`** — dans `lib/avisPlateformesDb.js`, remplacer
`import { MONTANT_AVIS_MAUVAIS } from './avisPlateformes'` par
`import { MONTANT_AVIS_MAUVAIS, PLATEFORMES } from './avisPlateformes'`, puis en fin de fichier :

```js
/**
 * Date du dernier envoi d'avis par plateforme (`ingested_at` le plus récent).
 * Une ligne lue par plateforme — jamais toute la table. Sert au rappel
 * « pense à cliquer sur le bouton avis ».
 */
export async function dernierAvisRecu() {
  const out = {}
  await Promise.all(PLATEFORMES.map(async p => {
    const { data, error } = await supabase
      .from('platform_reviews')
      .select('ingested_at')
      .eq('platform', p.key)
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    out[p.key] = data?.ingested_at || null
  }))
  return out
}
```

- [ ] **Step 2: Imports de l'écran** — dans `app/avis-plateformes.js` :
  - ajouter `import { router } from 'expo-router'` sous `import { retour } from '../lib/navigation'` ;
  - dans l'import de `../lib/avisPlateformes`, ajouter `plateformesEnRetard, texteRetard` ;
  - remplacer `chargerAvis, chargerAvisNonRattaches, dernierRun, rattacherBoutique,` par
    `chargerAvis, chargerAvisNonRattaches, dernierAvisRecu, dernierRun, rattacherBoutique,`.

- [ ] **Step 3: État et chargement**
  - remplacer `const { userId, userNom } = useApp()` par `const { userId, userNom, roleActif } = useApp()` ;
  - sous `const [run, setRun] = useState(null)` ajouter `const [retards, setRetards] = useState([])` ;
  - dans `charger()`, remplacer le `Promise.all` et les `set…` qui suivent par :

```js
      const [lignes, sansResto, dernier, derniersEnvois] = await Promise.all([
        chargerAvis({ debut, fin, restaurantId: restoFilter, platform: platformFilter, classification: classFilter }),
        chargerAvisNonRattaches(),
        dernierRun().catch(() => null),
        dernierAvisRecu().catch(() => null),
      ])
      setAvis(lignes)
      setOrphelins(sansResto)
      setRun(dernier)
      setRetards(derniersEnvois ? plateformesEnRetard(derniersEnvois) : [])
      setVisible(PAR_PAGE)
```

- [ ] **Step 4: Lien manager dans l'en-tête** — juste après
`<Text style={styles.headerSub}>Yango & Glovo · notes et commentaires</Text>` :

```jsx
        {roleActif === 'manager' ? (
          <TouchableOpacity onPress={() => router.push('/bouton-avis')} style={styles.lienBouton}>
            <Text style={styles.lienBoutonTxt}>🔖 Installer le bouton avis</Text>
          </TouchableOpacity>
        ) : null}
```

- [ ] **Step 5: Bandeau** — dans l'onglet Avis, juste avant
`{erreur ? (` (le bloc `erreurBox` de la liste des avis) :

```jsx
          {retards.map(r => (
            <View key={r.platform} style={styles.rappelBox}>
              <Text style={styles.rappelTxt}>
                ⏰ {texteRetard(r)} — ouvrez le portail {r.label}{r.platform === 'yango' ? ' (page Avis)' : ''} et cliquez sur le bouton avis.
              </Text>
            </View>
          ))}
```

- [ ] **Step 6: Styles** — dans `makeStyles`, sous la ligne `erreurTxt: …` :

```js
  rappelBox: { backgroundColor: '#FFF3E0', borderRadius: 10, borderWidth: 1, borderColor: '#EF9F27', padding: 12, marginBottom: 12 },
  rappelTxt: { fontSize: 13, color: '#8A4B00', lineHeight: 19, fontWeight: '600' },
  lienBouton: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' },
  lienBoutonTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
```

- [ ] **Step 7: Lint + tests**

Run: `npx eslint app/avis-plateformes.js lib/avisPlateformesDb.js && for f in lib/*.test.mjs; do node --test "$f" >/dev/null || echo "ÉCHEC $f"; done`
Expected: 0 erreur, aucune ligne « ÉCHEC ».

- [ ] **Step 8: Commit**

```bash
git add lib/avisPlateformesDb.js app/avis-plateformes.js
git commit -m "feat(avis): rappel après 2 jours sans avis + lien d'installation du bouton

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 7: Rappel dans la cloche de l'accueil (manager, directeur)

**Files:**
- Modify: `context/NotificationsContext.js`
- Modify: `app/accueil.js` (destructuration `useNotifications`, condition « Aucune notification », `ListHeaderComponent`)

**Interfaces:**
- Consumes: `dernierAvisRecu` (Task 6), `plateformesEnRetard`, `texteRetard` (Task 1).
- Produces: contexte `avisEnRetard: Array<{platform, label, jours}>`, `ouvrirAvisEnRetard()`.

- [ ] **Step 1: Contexte** — dans `context/NotificationsContext.js` :
  - imports : ajouter
    `import { plateformesEnRetard } from '../lib/avisPlateformes'` et
    `import { dernierAvisRecu } from '../lib/avisPlateformesDb'` ;
  - valeur par défaut du `createContext` : ajouter `avisEnRetard: [],` sous `explicationsEnRetard: [],` ;
  - sous `const ROLES_SUIVI_EXPLICATIONS = ['manager', 'rh']` :

```js
// Rôles rappelés quand une plateforme n'a pas reçu d'avis depuis 2 jours.
const ROLES_RAPPEL_AVIS = ['manager', 'directeur']
```

  - sous `const [explicationsEnRetard, setExplicationsEnRetard] = useState([])` :

```js
  // Plateformes sans nouvel avis depuis 2 jours (personne n'a cliqué sur le
  // bouton avis). Calculées à l'affichage, disparaissent après un envoi.
  const [avisEnRetard, setAvisEnRetard] = useState([])
```

  - `nonLues` : remplacer `+ explicationsEnRetard.length` par `+ explicationsEnRetard.length + avisEnRetard.length` ;
  - dans `charger()`, sous `chargerExplicationsEnRetard()` ajouter `chargerAvisEnRetard()` ; idem dans `ouvrirPanel()` sous `chargerExplicationsEnRetard()` ;
  - nouvelle fonction juste après `chargerExplicationsEnRetard` :

```js
  async function chargerAvisEnRetard() {
    if (!ROLES_RAPPEL_AVIS.includes(roleActif)) { setAvisEnRetard([]); return }
    try {
      setAvisEnRetard(plateformesEnRetard(await dernierAvisRecu()))
    } catch {
      setAvisEnRetard([])
    }
  }
```

  - nouvelle fonction juste après `ouvrirExplicationEnRetard` :

```js
  function ouvrirAvisEnRetard() {
    fermerPanel()
    router.push('/avis-plateformes')
  }
```

  - dans la `value` du Provider : ajouter `avisEnRetard,` après `explicationsEnRetard,` et `ouvrirAvisEnRetard,` après `ouvrirExplicationEnRetard,` (repérer la ligne `ouvrirExplicationEnRetard` dans la `value` et l'y ajouter à côté).

- [ ] **Step 2: Accueil** — dans `app/accueil.js` :
  - ajouter `import { texteRetard } from '../lib/avisPlateformes'` avec les autres imports `../lib/` ;
  - dans la destructuration de `useNotifications()`, ajouter `avisEnRetard,` après `explicationsEnRetard,` et `ouvrirAvisEnRetard,` après `ouvrirExplicationEnRetard,` ;
  - remplacer la condition
    `{notifications.length === 0 && explicationsEnRetard.length === 0 ? (`
    par
    `{notifications.length === 0 && explicationsEnRetard.length === 0 && avisEnRetard.length === 0 ? (` ;
  - remplacer l'ouverture du `ListHeaderComponent`
    `ListHeaderComponent={explicationsEnRetard.length > 0 ? (`
    `  <View style={{ marginBottom: 6 }}>`
    par :

```jsx
                ListHeaderComponent={explicationsEnRetard.length > 0 || avisEnRetard.length > 0 ? (
                  <View style={{ marginBottom: 6 }}>
                    {avisEnRetard.length > 0 ? (
                      <>
                        <Text style={styles.notifSection}>⭐ Avis à envoyer ({avisEnRetard.length})</Text>
                        {avisEnRetard.map(a => (
                          <TouchableOpacity
                            key={a.platform}
                            activeOpacity={0.75}
                            onPress={ouvrirAvisEnRetard}
                            style={[styles.notifCard, styles.notifCardRetard]}
                            accessibilityRole="button"
                            accessibilityLabel={texteRetard(a)}
                          >
                            <Text style={styles.notifCardTitre}>{texteRetard(a)}</Text>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                              <Text style={[styles.notifCardDate, styles.notifRetardTxt]}>
                                Cliquez sur le bouton avis depuis le portail {a.label}
                              </Text>
                              <Text style={styles.notifVoir}>Voir ›</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </>
                    ) : null}
```

  - la section des explications reste inchangée, mais son titre ne doit s'afficher que s'il y en a : envelopper le bloc existant (le `<Text style={styles.notifSection}>⏰ Explications sans réponse …</Text>` et le `explicationsEnRetard.map(…)`) dans `{explicationsEnRetard.length > 0 ? (<>…</>) : null}`.

- [ ] **Step 3: Lint + tests**

Run: `npm run lint && for f in lib/*.test.mjs; do node --test "$f" >/dev/null || echo "ÉCHEC $f"; done`
Expected: 0 erreur, aucune ligne « ÉCHEC ».

- [ ] **Step 4: Vérifier que le bundle web compile**

Run: `npx expo export -p web`
Expected: export terminé sans erreur.

- [ ] **Step 5: Commit**

```bash
git add context/NotificationsContext.js app/accueil.js
git commit -m "feat(notifications): rappel « avis à envoyer » dans la cloche (manager, directeur)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 8: Documentation, vérification réelle, publication

**Files:**
- Modify: `doc/avis-plateformes.md` (section « Extraction quotidienne (Cowork + Chrome) » remplacée)
- Modify: `docs/superpowers/specs/2026-10-04-bouton-avis-design.md` (§1 et §3 : relais statique `public/envoi-avis.html` au lieu de `app/envoi-avis.js`)

- [ ] **Step 1: Documentation** — dans `doc/avis-plateformes.md`, remplacer toute la section `## Extraction quotidienne (Cowork + Chrome)` (jusqu'à `## Lire les résultats`, exclu) par :

```markdown
## Envoi des avis : le bouton « ⭐ Avis → Samtrackly »

Les tâches Claude planifiées (11h/12h/13h) ont échoué à chaque exécution :
elles tournaient dans le cloud, sans Chrome ni accès aux portails. Elles sont
en pause depuis le 04/10/2026. Les avis arrivent désormais par un **favori
Chrome** cliqué par un humain déjà connecté aux portails.

- **Installation** (manager) : Avis clients → « 🔖 Installer le bouton avis »,
  coller le secret d'ingestion, glisser le bouton dans la barre de favoris.
- **Glovo** : clic sur le bouton depuis n'importe quelle page du portail.
- **Yango** : clic depuis la page **Avis** (filtre « Tous les restaurants »).
- Le bouton relit depuis le dernier avis reçu moins 3 jours (45 jours au
  plus) ; le dédoublonnage absorbe les répétitions. Une petite fenêtre
  (`/envoi-avis.html`) envoie les avis et affiche le résultat.
- **Rappel** : sans envoi depuis 2 jours sur une plateforme, bandeau dans
  l'écran Avis clients et ligne dans la cloche (manager, directeur).
- **Secret changé** (`INGEST_SECRET`) → chaque utilisateur réinstalle le bouton.
- **Nouvelle boutique Glovo** : l'ajouter à `NOMS_GLOVO` dans
  `public/bouton-avis.js`, publier, réinstaller le bouton.

Code : `public/bouton-avis.js` (moteur), `public/envoi-avis.{html,js}`
(relais), `app/bouton-avis.js` (installation), tests
`lib/boutonAvis.test.mjs` et `lib/envoiAvis.test.mjs`.
```

- [ ] **Step 2: Spec** — dans la spec, §1 étape 2 remplacer `<origine Samtrackly>/envoi-avis` par `<origine Samtrackly>/envoi-avis.html` ; §3 remplacer le point **`app/envoi-avis.js`** par :

```markdown
- **`public/envoi-avis.html` + `public/envoi-avis.js`** : page statique, hors
  de l'app (les gardes de session de l'app redirigeraient la fenêtre vers la
  connexion ou le dernier écran). N'accepte un message que si son origine est
  exactement `https://portal.glovoapp.com` ou `https://vendor.yango.com`.
  Elle ne stocke rien.
```

- [ ] **Step 3: Commit doc**

```bash
git add doc/avis-plateformes.md docs/superpowers/specs/2026-10-04-bouton-avis-design.md
git commit -m "docs(avis): le bouton avis remplace l'extraction Cowork

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

- [ ] **Step 4: Demander l'accord d'Ange pour publier** (AskUserQuestion) : déploiement de `ingest-reviews` (GET avec `derniers`), Vercel (`npx expo export -p web && npx vercel deploy --prod --yes`, ajouter `--scope ripiti225s-projects` si « Not authorized »), EAS update (`DEVELOPER_DIR=/Library/Developer/CommandLineTools npx eas-cli update --branch production --message "Bouton avis Glovo/Yango + rappel"`). Ne rien publier sans « oui ».

- [ ] **Step 5: Déployer la fonction** (MCP Supabase `deploy_edge_function`, projet `wlwotzxnzowbkbfcpnyi`, `verify_jwt: false`, contenu exact de `supabase/functions/ingest-reviews/index.ts`), puis relire la version déployée (`get_edge_function`) et vérifier qu'elle est identique au fichier.

- [ ] **Step 6: Publier Vercel puis EAS** avec les commandes du Step 4. Vérifier : `curl -s -o /dev/null -w "%{http_code}\n" https://samtrackly.vercel.app/envoi-avis.html` → `200` et `curl -s https://samtrackly.vercel.app/bouton-avis.js | head -c 200` → commence par le commentaire du moteur (pas du HTML).

- [ ] **Step 7: Vérification réelle avec Ange** — Ange installe le bouton depuis `https://samtrackly.vercel.app/bouton-avis` (secret collé par lui), clique sur le portail Glovo puis sur la page Avis de Yango. Contrôle en base :

```sql
select platform, max(ingested_at) dernier_envoi, count(*) filter (where ingested_at > now() - interval '15 minutes') recus_15min
from platform_reviews group by 1;
```

Si le clic sur Yango ne fait rien du tout (pas de bandeau ⭐ ni de fenêtre), Chrome a bloqué le favori à cause de la sécurité de la page : le noter et revenir vers Ange avant toute correction.

Expected : `dernier_envoi` à l'instant pour les deux plateformes ; la fenêtre relais a affiché un résumé (« … : aucun nouvel avis depuis le dernier envoi. » est un succès si rien n'est arrivé depuis le rattrapage).

- [ ] **Step 8: Résumé** à Ange en français simple (nouveautés, comment s'en servir), et mise à jour de la mémoire `avis-extraction-cowork.md`.
