# Avis : heure de commande, caissier, écran Résumé — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque avis Glovo/Yango porte l'heure de sa commande et le caissier qui tenait la caisse ; l'écran Avis clients s'ouvre sur un Résumé (chiffres + évolution, restaurants, caissiers, motifs) ; les bons avis comptent dans la note /20.

**Architecture:** Le bouton avis lit l'heure de chaque commande sur le portail et l'envoie (`commande_le`). `ingest-reviews` l'enregistre, complète les avis déjà connus (fonction SQL), date les litiges à la commande et leur attribue un responsable avec une copie exacte de `lib/attributionAvis.js`. Côté app, une bibliothèque pure `lib/avisResume.js` calcule périodes, évolutions, classements, motifs et attribution à l'affichage.

**Tech Stack:** Expo Router (React Native Web), Supabase (Postgres + Edge Function Deno), JS vanilla (favori), `node:test`.

Spec : `docs/superpowers/specs/2026-10-04-avis-caissiers-resume-design.md`

## Global Constraints

- Français partout ; messages sans code technique.
- Abidjan = UTC : date et heure de commande se lisent en UTC (`toISOString()`).
- Règle d'attribution inchangée : `caissierAuMoment` de `lib/attributionAvis.js` ; plusieurs caissiers ou aucun shift → personne.
- Un responsable de litige déjà renseigné n'est **jamais** écrasé.
- Négatif muet (pas de litige) : ne compte contre personne.
- Bons avis plateforme attribués : « bon avis » (+0,5) dans la note, critère plafonné comme aujourd'hui.
- Les fichiers de `lib/` testés par `node:test` importent avec l'extension `.js`.
- `npm run lint` : 0 erreur ; tous les `lib/*.test.mjs` verts.
- Commit + push à chaque tâche (`DEVELOPER_DIR=/Library/Developer/CommandLineTools git push`) ; fin de message `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migration en base, déploiement de fonction, Vercel, EAS : **uniquement avec l'accord d'Ange** (Task 7).
- Ne jamais lancer `expo start` soi-même (le serveur local d'Ange tourne déjà).

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `supabase_avis_commande_le.sql` (nouveau) | colonne `commande_le` + `completer_heures_avis(jsonb)` |
| `supabase/functions/ingest-reviews/index.ts` (modif) | `commande_le`, heures des avis connus, date/heure des litiges, attribution |
| `supabase/functions/ingest-reviews/attributionAvis.js` (nouveau) | copie exacte de `lib/attributionAvis.js` |
| `public/bouton-avis.js` (modif) | lecture de l'heure de commande (Glovo, Yango) |
| `public/envoi-avis.js` (modif) | résumé : litiges attribués |
| `lib/avisResume.js` (nouveau) | périodes, évolution, chiffres, caissier d'un avis, classements, motifs, bons avis pour la note |
| `lib/avisPlateformesDb.js` (modif) | `raw`, `commande_le`, litiges des avis, shifts |
| `components/avis/ResumeAvis.js` (nouveau) | onglet Résumé |
| `app/avis-plateformes.js` (modif) | en-tête moderne, périodes, 3 onglets, heure + caissier sur les cartes |
| `lib/noteCaissierDb.js` (modif) | bons avis plateforme dans la note |
| tests : `lib/avisResume.test.mjs` (nouveau), `lib/attributionAvis.test.mjs`, `lib/boutonAvis.test.mjs`, `lib/envoiAvis.test.mjs` (modif) | |

---

### Task 1: Base + fonction d'ingestion

**Files:**
- Create: `supabase_avis_commande_le.sql`, `supabase/functions/ingest-reviews/attributionAvis.js`
- Modify: `supabase/functions/ingest-reviews/index.ts`
- Test: `lib/attributionAvis.test.mjs` (ajout)

**Interfaces:**
- Produces: colonne `platform_reviews.commande_le TIMESTAMPTZ` ; RPC `completer_heures_avis(p_heures jsonb) → setof uuid` (service_role seulement) ; champ d'entrée `commande_le` (ISO) par avis ; résumé POST + `heures_ajoutees`, `litiges_attribues`.

- [ ] **Step 1: Test de la copie (doit échouer)** — ajouter en fin de `lib/attributionAvis.test.mjs` :

```js
import { readFileSync } from 'node:fs'

test('la fonction ingest-reviews utilise une copie EXACTE de la règle', () => {
  const original = readFileSync(new URL('./attributionAvis.js', import.meta.url), 'utf8')
  const copie = readFileSync(new URL('../supabase/functions/ingest-reviews/attributionAvis.js', import.meta.url), 'utf8')
  assert.equal(copie, original, 'Recopier lib/attributionAvis.js dans supabase/functions/ingest-reviews/')
})
```

Run: `node --test lib/attributionAvis.test.mjs` → FAIL (ENOENT).

- [ ] **Step 2: Copier** — `cp lib/attributionAvis.js supabase/functions/ingest-reviews/attributionAvis.js` ; relancer le test → PASS.

- [ ] **Step 3: Migration** — créer `supabase_avis_commande_le.sql` :

```sql
-- ════════════════════════════════════════════════════════════════════
--  Avis plateformes — heure de la commande
--
--  Le bouton avis lit l'heure de chaque commande sur le portail Glovo ou
--  Yango. Elle sert à retrouver le caissier qui tenait la caisse
--  (lib/attributionAvis.js) et date le litige au jour de la commande.
--  Idempotent, rejouable.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE platform_reviews ADD COLUMN IF NOT EXISTS commande_le TIMESTAMPTZ;

COMMENT ON COLUMN platform_reviews.commande_le IS
  'Date-heure de la commande (lue sur le portail). NULL = inconnue.';

-- Complète l'heure des avis DÉJÀ connus (relus par le bouton) et de leur
-- litige s'il n'en a pas : heure_commande + date = date de la commande.
-- Rien d'autre n'est modifié. Renvoie les avis complétés.
CREATE OR REPLACE FUNCTION completer_heures_avis(p_heures JSONB)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH h AS (
    SELECT e->>'dedup_hash' AS dedup_hash, (e->>'commande_le')::timestamptz AS commande_le
      FROM jsonb_array_elements(p_heures) AS e
  ), maj AS (
    UPDATE platform_reviews r
       SET commande_le = h.commande_le
      FROM h
     WHERE r.dedup_hash = h.dedup_hash
       AND r.commande_le IS NULL
    RETURNING r.id, r.commande_le
  ), lit AS (
    UPDATE litiges_avis_clients l
       SET heure_commande = (maj.commande_le AT TIME ZONE 'UTC')::time,
           date = (maj.commande_le AT TIME ZONE 'UTC')::date
      FROM maj
     WHERE l.review_id = maj.id
       AND l.heure_commande IS NULL
    RETURNING l.review_id
  )
  SELECT id FROM maj
$$;

REVOKE ALL ON FUNCTION completer_heures_avis(JSONB) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Fonction — lecture de `commande_le`** dans `index.ts` :
  - ajouter `import { caissierAuMoment } from './attributionAvis.js'` sous l'import de supabase-js ;
  - après `const dateIso = …` ajouter :

```ts
// Une date-heure ISO valide → ISO UTC normalisé ; sinon null.
const dateHeureIso = (v: unknown) => {
  const s = texte(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// Abidjan = UTC : jour et heure de la commande, lus directement.
const jourEtHeure = (iso: string | null) =>
  iso ? { date: new Date(iso).toISOString().slice(0, 10), heure: new Date(iso).toISOString().slice(11, 16) } : null
```

  - dans la boucle, sous `const review_date = dateIso(r?.review_date)` : `const commande_le = dateHeureIso(r?.commande_le)` ; dans `rows.push({ … })` ajouter `commande_le,` après `review_date,`.

- [ ] **Step 5: Fonction — insertion et heures des avis connus**
  - type `inseres` : ajouter `dedup_hash: string; commande_le: string | null;` ; `.select(…)` : ajouter `, dedup_hash, commande_le` ;
  - juste après la boucle d'insertion, ajouter :

```ts
    // Avis déjà connus relus avec une heure : on la complète (et celle du
    // litige lié), sans rien toucher d'autre.
    const hashesInseres = new Set(inseres.map((x) => x.dedup_hash))
    const heuresConnues = rows
      .filter((x) => x.commande_le && !hashesInseres.has(x.dedup_hash as string))
      .map((x) => ({ dedup_hash: x.dedup_hash, commande_le: x.commande_le }))
    const completes: string[] = []
    for (let i = 0; i < heuresConnues.length; i += LOT) {
      const { data, error } = await supabase.rpc('completer_heures_avis', { p_heures: heuresConnues.slice(i, i + LOT) })
      if (error) throw error
      completes.push(...((data ?? []) as unknown as string[]).map((d) => (typeof d === 'string' ? d : (d as { completer_heures_avis: string }).completer_heures_avis)))
    }
```

- [ ] **Step 6: Fonction — litiges datés à la commande** — dans le `map` des litiges, remplacer
`date: x.review_date ?? aujourdhui(),` par :

```ts
        date: jourEtHeure(x.commande_le)?.date ?? x.review_date ?? aujourdhui(),
        heure_commande: jourEtHeure(x.commande_le)?.heure ?? null,
```

- [ ] **Step 7: Fonction — attribution** — juste avant `const resume = {`, ajouter :

```ts
    // ── Responsable des litiges dont l'heure est connue ──────────────
    // Caissier présent à l'heure de la commande (lib/attributionAvis.js,
    // copie exacte). Jamais d'écrasement d'un responsable déjà renseigné ;
    // shift pas encore saisi → le bouton « Attribuer » de Litiges rattrapera.
    const avisAvecHeure = [...inseres.filter((x) => x.commande_le).map((x) => x.id), ...completes]
    let litiges_attribues = 0
    const aAttribuer: { id: string; restaurant_id: string; date: string; heure_commande: string }[] = []
    for (let i = 0; i < avisAvecHeure.length; i += 150) {
      const { data, error } = await supabase.from('litiges_avis_clients')
        .select('id, restaurant_id, date, heure_commande')
        .in('review_id', avisAvecHeure.slice(i, i + 150))
        .is('responsable_id', null).is('responsable_nom', null)
        .not('heure_commande', 'is', null)
      if (error) throw error
      aAttribuer.push(...(data ?? []))
    }
    if (aAttribuer.length) {
      const dates = aAttribuer.map((l) => l.date).sort()
      const veille = new Date(Date.parse(`${dates[0]}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
      const { data: shifts, error } = await supabase.from('points_shifts')
        .select('restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin')
        .in('restaurant_id', [...new Set(aAttribuer.map((l) => l.restaurant_id))])
        .gte('date', veille).lte('date', dates[dates.length - 1])
        .range(0, 4999)
      if (error) throw error
      for (const l of aAttribuer) {
        const r = caissierAuMoment(shifts ?? [], { restaurantId: l.restaurant_id, date: l.date, heure: String(l.heure_commande).slice(0, 5) })
        if (!r.caissier_id && !r.caissier_nom) continue
        const { error: e } = await supabase.from('litiges_avis_clients')
          .update({ responsable_id: r.caissier_id || null, responsable_nom: r.caissier_nom || null })
          .eq('id', l.id).is('responsable_id', null).is('responsable_nom', null)
        if (!e) litiges_attribues++
      }
    }
```

  - dans `resume`, ajouter après `litiges_ignores_sans_motif,` :
    `heures_ajoutees: inseres.filter((x) => x.commande_le).length + completes.length,` et `litiges_attribues,`.

- [ ] **Step 8: En-tête de la fonction** — sous la ligne `qui a un commentaire ou un tag …` ajouter :

```ts
//          `commande_le` (heure de la commande, lue par le bouton avis) :
//          enregistrée, complétée sur les avis déjà connus, et utilisée pour
//          dater le litige et lui attribuer le caissier présent.
```

- [ ] **Step 9: Relire + tests + commit**

Run: `git diff --stat && for f in lib/*.test.mjs; do node --test "$f" >/dev/null 2>&1 || echo "ÉCHEC $f"; done`
Expected: aucune ligne ÉCHEC.

```bash
git add supabase_avis_commande_le.sql supabase/functions/ingest-reviews lib/attributionAvis.test.mjs
git commit -m "feat(avis): heure de commande enregistrée, litige daté à la commande et attribué au caissier présent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 2: Bouton avis — lecture de l'heure de commande

**Files:**
- Modify: `public/bouton-avis.js`, `public/envoi-avis.js`
- Test: `lib/boutonAvis.test.mjs`, `lib/envoiAvis.test.mjs`

**Interfaces:**
- Produces: `moteurAvis()` expose en plus `heureGlovo(json) → iso|null`, `heureYango(json) → iso|null`, `enParallele(elements, n, fn) → Promise<résultats>` ; chaque avis envoyé porte `commande_le` (ISO ou absent).
- Consumes: champs `heures_ajoutees`, `litiges_attribues` du résumé (Task 1).

- [ ] **Step 1: Tests (doivent échouer)** — dans `lib/boutonAvis.test.mjs`, ajouter `heureGlovo, heureYango, enParallele` à la déstructuration de `moteurAvis()`, puis :

```js
describe('heure de la commande lue sur le portail', () => {
  test('Glovo : placedTimestamp du détail de commande', () => {
    const j = { data: { orders: { order: { order: { orderId: '1', placedTimestamp: '2026-10-03T23:20:10Z' } } } } }
    assert.equal(heureGlovo(j), '2026-10-03T23:20:10.000Z')
  })
  test('Yango : created_at du détail de commande', () => {
    assert.equal(heureYango({ created_at: '2026-10-03T18:59:49.819258+00:00' }), '2026-10-03T18:59:49.819Z')
  })
  test('réponse incomplète ou illisible : pas d’heure', () => {
    assert.equal(heureGlovo({ data: null }), null)
    assert.equal(heureGlovo(null), null)
    assert.equal(heureYango({ created_at: 'n’importe quoi' }), null)
  })
  test('enParallele garde l’ordre et limite le nombre d’appels simultanés', async () => {
    let enCours = 0, maxi = 0
    const r = await enParallele([1, 2, 3, 4, 5, 6], 2, async x => {
      enCours++; maxi = Math.max(maxi, enCours)
      await new Promise(ok => setTimeout(ok, 5))
      enCours--
      return x * 10
    })
    assert.deepEqual(r, [10, 20, 30, 40, 50, 60])
    assert.ok(maxi <= 2)
  })
})
```

Dans `lib/envoiAvis.test.mjs`, ajouter au describe `resumeEnvoi` :

```js
  test('litiges attribués à un caissier', () => {
    assert.equal(resumeEnvoi('glovo', { inserted: 5, litiges_crees: 2, unmapped: 0, litiges_attribues: 2 }),
      'Glovo : 5 nouveaux avis · 2 litiges créés · 2 attribués à un caissier')
  })
```

Run: `node --test lib/boutonAvis.test.mjs lib/envoiAvis.test.mjs` → FAIL.

- [ ] **Step 2: Extracteurs + parallélisme** — dans `public/bouton-avis.js`, après `plateformeDuSite` :

```js
  function isoValide(v) {
    const t = Date.parse(v)
    return v && Number.isFinite(t) ? new Date(t).toISOString() : null
  }

  function heureGlovo(json) {
    const o = json && json.data && json.data.orders && json.data.orders.order && json.data.orders.order.order
    return o ? isoValide(o.placedTimestamp) : null
  }

  function heureYango(json) {
    return json ? isoValide(json.created_at) : null
  }

  // Applique fn à chaque élément, n à la fois, en gardant l'ordre.
  async function enParallele(elements, n, fn) {
    const resultats = new Array(elements.length)
    let suivant = 0
    async function ouvrier() {
      while (suivant < elements.length) {
        const i = suivant++
        resultats[i] = await fn(elements[i], i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, elements.length) }, ouvrier))
    return resultats
  }
```

Ajouter `heureGlovo: heureGlovo, heureYango: heureYango, enParallele: enParallele,` à l'objet retourné.

- [ ] **Step 3: Lecture réelle des heures** — avant `async function lancer(cfg)` :

```js
  const URL_GLOVO_COMMANDE = 'https://vagw-api.eu.prd.portal.restaurant/query'
  const REQUETE_GLOVO = 'query GetOrderDetails($params: OrderReq!) { orders { order(input: $params) { order { orderId placedTimestamp } } } }'

  function lecteurHeureGlovo() {
    const jeton = jetonGlovo()
    return async function (avis) {
      const vendeur = String(avis.external_store_label).split(';')
      const r = await fetch(URL_GLOVO_COMMANDE, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
        body: JSON.stringify({
          operationName: 'GetOrderDetails',
          variables: { params: { orderId: avis.external_ref, GlobalVendorCode: { globalEntityId: vendeur[0], vendorId: vendeur[1] },
            isBillingDataFlagEnabled: false, useRefundStreamIssueSource: false } },
          query: REQUETE_GLOVO,
        }),
      })
      return r.ok ? heureGlovo(await r.json()) : null
    }
  }

  function lecteurHeureYango(modele) {
    return async function (avis) {
      const u = new URL('/4.0/restapp-front/eats-restapp-orders/v1/order', location.origin)
      u.searchParams.set('order_nr', avis.external_ref)
      const r = await fetch(new Request(u.toString(), { method: 'GET', headers: modele.headers, credentials: 'include' }))
      return r.ok ? heureYango(await r.json()) : null
    }
  }

  async function ajouterHeures(avis, lireHeure, info, nom) {
    let faits = 0
    let introuvables = 0
    await enParallele(avis, 4, async function (a) {
      let iso = null
      try { iso = await lireHeure(a) } catch (_e) { iso = null }
      if (iso) a.commande_le = iso
      else introuvables++
      faits++
      if (faits % 10 === 0 || faits === avis.length) info('Heures de commande ' + nom + ' : ' + faits + '/' + avis.length)
    })
    return introuvables
  }
```

- [ ] **Step 4: Brancher** :
  - `lireYango` doit rendre aussi le modèle : remplacer `return tous` final de `lireYango` par `tous.modele = modele\n    return tous` ;
  - dans `lancer`, remplacer la ligne `fen.postMessage({ type: 'avis', reviews: avis }, cfg.origine)` et la ligne `info(...)` suivante par :

```js
      const lireHeure = plateforme === 'glovo' ? lecteurHeureGlovo() : lecteurHeureYango(avis.modele)
      const introuvables = await ajouterHeures(avis, lireHeure, info, nom)
      fen.postMessage({ type: 'avis', reviews: Array.prototype.slice.call(avis) }, cfg.origine)
      info(avis.length + ' avis ' + nom + ' transmis'
        + (introuvables ? ' (' + introuvables + ' heure' + (introuvables > 1 ? 's' : '') + ' introuvable' + (introuvables > 1 ? 's' : '') + ')' : '')
        + ' : le résultat s’affiche dans la petite fenêtre.', 10000)
```

- [ ] **Step 5: Relais** — dans `public/envoi-avis.js`, `resumeEnvoi`, avant `return nom + ' : ' + parties.join(' · ')` :

```js
    if (r.litiges_attribues) parties.push(r.litiges_attribues + ' attribué' + (r.litiges_attribues > 1 ? 's' : '') + ' à un caissier')
```

- [ ] **Step 6: Tests + lint + commit**

Run: `node --test lib/boutonAvis.test.mjs lib/envoiAvis.test.mjs && npx eslint public/bouton-avis.js public/envoi-avis.js`
Expected: PASS, 0 erreur.

```bash
git add public/bouton-avis.js public/envoi-avis.js lib/boutonAvis.test.mjs lib/envoiAvis.test.mjs
git commit -m "feat(avis): le bouton lit l'heure de chaque commande sur Glovo et Yango

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 3: Bibliothèque pure du Résumé (`lib/avisResume.js`)

**Files:**
- Create: `lib/avisResume.js`, `lib/avisResume.test.mjs`

**Interfaces:**
- Consumes: `kpisAvis`, `classifierAvis` (`lib/avisPlateformes.js`), `caissierAuMoment` (`lib/attributionAvis.js`).
- Produces:
  - `PERIODES_AVIS: Array<{cle, label}>` — clés `jour, hier, semaine, mois, mois_calendaire, mois_dernier, perso`
  - `decalerJour(iso, n) → iso`
  - `plagePeriode(cle, aujourdhui, perso?) → {debut, fin} | null`
  - `periodePrecedente({debut, fin}) → {debut, fin}`
  - `evolution(actuel, precedent, plusEstMieux = true) → null | {delta, sens: 'hausse'|'baisse'|'egal', mieux: boolean|null}`
  - `resumeChiffres(avis, litiges) → kpisAvis(avis) + {nbLitiges, montantLitiges}`
  - `caissierDeLAvis(avis, {shifts, litigeParReview}) → null | {caissier_id, caissier_nom, source: 'litige'|'shift'}`
  - `classementCaissiers(avis, caissierPar: {[avisId]: résultat|null}) → Array<{cle, nom, bons, mauvais, nb, pctNegatifs}>` (« Sans caissier » en dernier)
  - `topMotifs(avis, n = 6) → Array<{motif, nb}>`
  - `bonsAvisAttribues(avis, shifts) → Array<{responsable_id, responsable_nom, date, bon: true, nature: 'bon avis'}>`

- [ ] **Step 1: Tests (doivent échouer)** — créer `lib/avisResume.test.mjs` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/avisResume.js — l'onglet Résumé de l'écran Avis clients et
// l'attribution d'un avis au caissier. Une période mal découpée fausse
// l'évolution affichée ; un avis attribué au mauvais caissier fausse sa note.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  PERIODES_AVIS, plagePeriode, periodePrecedente, evolution, resumeChiffres,
  caissierDeLAvis, classementCaissiers, topMotifs, bonsAvisAttribues,
} from './avisResume.js'

describe('périodes', () => {
  const AUJ = '2026-10-04'
  test('les 7 choix, dans l’ordre', () => {
    assert.deepEqual(PERIODES_AVIS.map(p => p.cle), ['jour', 'hier', 'semaine', 'mois', 'mois_calendaire', 'mois_dernier', 'perso'])
  })
  test('aujourd’hui, hier, 7 jours, 30 jours, ce mois', () => {
    assert.deepEqual(plagePeriode('jour', AUJ), { debut: AUJ, fin: AUJ })
    assert.deepEqual(plagePeriode('hier', AUJ), { debut: '2026-10-03', fin: '2026-10-03' })
    assert.deepEqual(plagePeriode('semaine', AUJ), { debut: '2026-09-28', fin: AUJ })
    assert.deepEqual(plagePeriode('mois', AUJ), { debut: '2026-09-05', fin: AUJ })
    assert.deepEqual(plagePeriode('mois_calendaire', AUJ), { debut: '2026-10-01', fin: AUJ })
  })
  test('mois dernier, y compris février', () => {
    assert.deepEqual(plagePeriode('mois_dernier', AUJ), { debut: '2026-09-01', fin: '2026-09-30' })
    assert.deepEqual(plagePeriode('mois_dernier', '2026-03-15'), { debut: '2026-02-01', fin: '2026-02-28' })
  })
  test('dates au choix : remises dans l’ordre, incomplètes → rien', () => {
    assert.deepEqual(plagePeriode('perso', AUJ, { debut: '2026-09-10', fin: '2026-09-01' }), { debut: '2026-09-01', fin: '2026-09-10' })
    assert.equal(plagePeriode('perso', AUJ, { debut: '2026-09-10' }), null)
  })
  test('période précédente : même durée, juste avant', () => {
    assert.deepEqual(periodePrecedente({ debut: '2026-10-01', fin: '2026-10-07' }), { debut: '2026-09-24', fin: '2026-09-30' })
    assert.deepEqual(periodePrecedente({ debut: '2026-10-04', fin: '2026-10-04' }), { debut: '2026-10-03', fin: '2026-10-03' })
  })
})

describe('evolution', () => {
  test('hausse d’une note : mieux ; hausse des négatifs : pire', () => {
    assert.deepEqual(evolution(4.2, 4, true), { delta: 0.2, sens: 'hausse', mieux: true })
    assert.deepEqual(evolution(18, 12, false), { delta: 6, sens: 'hausse', mieux: false })
  })
  test('égal, ou rien à comparer', () => {
    assert.deepEqual(evolution(5, 5), { delta: 0, sens: 'egal', mieux: null })
    assert.equal(evolution(5, null), null)
  })
})

const av = (id, classification, extra = {}) => ({ id, platform: 'glovo', classification, restaurant_id: 'palm', ...extra })

describe('resumeChiffres', () => {
  test('litiges liés aux avis de la période, avec leur montant', () => {
    const avis = [av('a', 'negatif'), av('b', 'bon')]
    const r = resumeChiffres(avis, [{ review_id: 'a', montant: 1000 }, { review_id: 'zz', montant: 1000 }])
    assert.equal(r.nb, 2)
    assert.equal(r.nbLitiges, 1)
    assert.equal(r.montantLitiges, 1000)
  })
})

const shifts = [
  { restaurant_id: 'palm', date: '2026-10-03', caissier_id: 'b', caissier_nom: 'Bazie', heure_debut: '06:00:00', heure_fin: '15:00:00' },
  { restaurant_id: 'palm', date: '2026-10-03', caissier_id: 'm', caissier_nom: 'Moise', heure_debut: '15:00:00', heure_fin: '02:30:00' },
]

describe('caissierDeLAvis', () => {
  test('heure de commande → caissier du shift', () => {
    assert.deepEqual(caissierDeLAvis(av('a', 'bon', { commande_le: '2026-10-03T09:12:00Z' }), { shifts }),
      { caissier_id: 'b', caissier_nom: 'Bazie', source: 'shift' })
  })
  test('commande après minuit : service de soirée de la veille', () => {
    assert.equal(caissierDeLAvis(av('a', 'bon', { commande_le: '2026-10-04T01:10:00Z' }), { shifts }).caissier_nom, 'Moise')
  })
  test('le responsable du litige prime (correction du manager)', () => {
    const r = caissierDeLAvis(av('a', 'negatif', { commande_le: '2026-10-03T09:12:00Z' }),
      { shifts, litigeParReview: { a: { responsable_id: 'x', responsable_nom: 'Xavier' } } })
    assert.deepEqual(r, { caissier_id: 'x', caissier_nom: 'Xavier', source: 'litige' })
  })
  test('sans heure, ou aucun shift : personne', () => {
    assert.equal(caissierDeLAvis(av('a', 'bon'), { shifts }), null)
    assert.equal(caissierDeLAvis(av('a', 'bon', { commande_le: '2026-10-10T09:00:00Z' }), { shifts }), null)
  })
})

describe('classementCaissiers', () => {
  test('du plus de mauvais avis au moins, « Sans caissier » en dernier', () => {
    const avis = [av('1', 'negatif'), av('2', 'negatif'), av('3', 'bon'), av('4', 'negatif'), av('5', 'bon'), av('6', 'negatif')]
    const par = {
      1: { caissier_id: 'b', caissier_nom: 'Bazie' }, 2: { caissier_id: 'b', caissier_nom: 'Bazie' }, 3: { caissier_id: 'b', caissier_nom: 'Bazie' },
      4: { caissier_id: 'm', caissier_nom: 'Moise' }, 5: { caissier_id: 'm', caissier_nom: 'Moise' }, 6: null,
    }
    const r = classementCaissiers(avis, par)
    assert.deepEqual(r.map(x => [x.nom, x.bons, x.mauvais, x.pctNegatifs]), [
      ['Bazie', 1, 2, 66.7], ['Moise', 1, 1, 50], ['Sans caissier', 0, 1, 100],
    ])
  })
})

describe('topMotifs', () => {
  test('thèmes Glovo et tags Yango des négatifs ; commentaire seul → « Commentaire sans motif »', () => {
    const avis = [
      av('1', 'negatif', { raw: { raw: { theme: ['Mauvais goût', 'Cher'] } } }),
      av('2', 'negatif', { raw: { raw: { tag: ['Mauvais goût'] } } }),
      av('3', 'negatif', { comment: 'Froid', raw: { raw: {} } }),
      av('4', 'negatif', { raw: { raw: {} } }),
      av('5', 'bon', { raw: { raw: { tag: ['Délicieux'] } } }),
    ]
    assert.deepEqual(topMotifs(avis), [
      { motif: 'Mauvais goût', nb: 2 }, { motif: 'Cher', nb: 1 }, { motif: 'Commentaire sans motif', nb: 1 },
    ])
  })
})

describe('bonsAvisAttribues — pour la note des caissiers', () => {
  test('seuls les bons avis attribués comptent, datés du jour de la commande', () => {
    const avis = [
      av('1', 'bon', { commande_le: '2026-10-03T09:12:00Z' }),
      av('2', 'negatif', { commande_le: '2026-10-03T09:12:00Z' }),
      av('3', 'bon'),
    ]
    assert.deepEqual(bonsAvisAttribues(avis, shifts), [
      { responsable_id: 'b', responsable_nom: 'Bazie', date: '2026-10-03', bon: true, nature: 'bon avis' },
    ])
  })
})
```

Run: `node --test lib/avisResume.test.mjs` → FAIL (module introuvable).

- [ ] **Step 2: Implémentation** — créer `lib/avisResume.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
//  AVIS CLIENTS — Résumé et attribution aux caissiers (pur, testé)
//
//  Périodes et période précédente (pour les flèches ↑↓), chiffres clés,
//  caissier d'un avis, classements et motifs de l'onglet Résumé de l'écran
//  Avis clients, et bons avis pour la note des caissiers.
//
//  Caissier d'un avis : le responsable de son litige s'il en a un (le manager
//  peut l'avoir corrigé), sinon le caissier présent à l'heure de la commande
//  (lib/attributionAvis.js, règle du 03/10). Abidjan = UTC.
//  Tests : lib/avisResume.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
import { caissierAuMoment } from './attributionAvis.js'
import { classifierAvis, kpisAvis } from './avisPlateformes.js'

const JOUR = 86_400_000

export const PERIODES_AVIS = [
  { cle: 'jour', label: "Aujourd'hui" },
  { cle: 'hier', label: 'Hier' },
  { cle: 'semaine', label: '7 jours' },
  { cle: 'mois', label: '30 jours' },
  { cle: 'mois_calendaire', label: 'Ce mois' },
  { cle: 'mois_dernier', label: 'Mois dernier' },
  { cle: 'perso', label: '📅 Dates au choix' },
]

export const decalerJour = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * JOUR).toISOString().slice(0, 10)

export function plagePeriode(cle, aujourdhui, perso = {}) {
  switch (cle) {
    case 'jour': return { debut: aujourdhui, fin: aujourdhui }
    case 'hier': { const h = decalerJour(aujourdhui, -1); return { debut: h, fin: h } }
    case 'semaine': return { debut: decalerJour(aujourdhui, -6), fin: aujourdhui }
    case 'mois_calendaire': return { debut: `${aujourdhui.slice(0, 8)}01`, fin: aujourdhui }
    case 'mois_dernier': {
      const fin = decalerJour(`${aujourdhui.slice(0, 8)}01`, -1)
      return { debut: `${fin.slice(0, 8)}01`, fin }
    }
    case 'perso': {
      if (!perso?.debut || !perso?.fin) return null
      return perso.debut <= perso.fin ? { debut: perso.debut, fin: perso.fin } : { debut: perso.fin, fin: perso.debut }
    }
    default: return { debut: decalerJour(aujourdhui, -29), fin: aujourdhui }
  }
}

export function periodePrecedente({ debut, fin }) {
  const duree = Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / JOUR) + 1
  return { debut: decalerJour(debut, -duree), fin: decalerJour(debut, -1) }
}

/** Évolution d'un chiffre ; `mieux` dit si le sens du changement est une bonne nouvelle. */
export function evolution(actuel, precedent, plusEstMieux = true) {
  if (actuel == null || precedent == null) return null
  const delta = Math.round((actuel - precedent) * 100) / 100
  if (delta === 0) return { delta, sens: 'egal', mieux: null }
  const monte = delta > 0
  return { delta, sens: monte ? 'hausse' : 'baisse', mieux: monte === plusEstMieux }
}

/** Chiffres clés : ceux de kpisAvis + les litiges nés des avis de la période. */
export function resumeChiffres(avis = [], litiges = []) {
  const ids = new Set(avis.map(a => a.id))
  const lies = (litiges || []).filter(l => ids.has(l.review_id))
  return {
    ...kpisAvis(avis),
    nbLitiges: lies.length,
    montantLitiges: lies.reduce((s, l) => s + (Number(l.montant) || 0), 0),
  }
}

export function caissierDeLAvis(avis, { shifts = [], litigeParReview = {} } = {}) {
  const l = litigeParReview?.[avis.id]
  if (l && (l.responsable_id || (l.responsable_nom && String(l.responsable_nom).trim()))) {
    return { caissier_id: l.responsable_id || null, caissier_nom: String(l.responsable_nom || '').trim(), source: 'litige' }
  }
  if (!avis.commande_le || !avis.restaurant_id) return null
  const t = Date.parse(avis.commande_le)
  if (!Number.isFinite(t)) return null
  const iso = new Date(t).toISOString()
  const r = caissierAuMoment(shifts, { restaurantId: avis.restaurant_id, date: iso.slice(0, 10), heure: iso.slice(11, 16) })
  return r.caissier_id || r.caissier_nom
    ? { caissier_id: r.caissier_id || null, caissier_nom: r.caissier_nom || '', source: 'shift' }
    : null
}

export function classementCaissiers(avis = [], caissierPar = {}) {
  const par = new Map()
  for (const a of avis) {
    const c = caissierPar[a.id]
    const cle = c ? (c.caissier_id ? `id:${c.caissier_id}` : `nom:${String(c.caissier_nom).toLowerCase()}`) : 'aucun'
    const acc = par.get(cle) || { cle, nom: c ? (c.caissier_nom || 'Caissier') : 'Sans caissier', bons: 0, mauvais: 0 }
    if (classifierAvis(a) === 'negatif') acc.mauvais += 1
    else acc.bons += 1
    par.set(cle, acc)
  }
  return [...par.values()]
    .map(x => ({ ...x, nb: x.bons + x.mauvais, pctNegatifs: Math.round((x.mauvais / (x.bons + x.mauvais)) * 1000) / 10 }))
    .sort((a, b) => (a.cle === 'aucun') - (b.cle === 'aucun') || b.mauvais - a.mauvais || b.pctNegatifs - a.pctNegatifs || a.nom.localeCompare(b.nom))
}

const liste = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x).trim()).filter(Boolean)

/** Plaintes les plus fréquentes parmi les avis négatifs. */
export function topMotifs(avis = [], n = 6) {
  const compte = new Map()
  for (const a of avis) {
    if (classifierAvis(a) !== 'negatif') continue
    const raw = a.raw?.raw || {}
    const motifs = [...liste(raw.theme), ...liste(raw.tag)]
    const finaux = motifs.length ? motifs : (a.comment && String(a.comment).trim() ? ['Commentaire sans motif'] : [])
    for (const m of new Set(finaux)) compte.set(m, (compte.get(m) || 0) + 1)
  }
  return [...compte.entries()]
    .map(([motif, nb]) => ({ motif, nb }))
    .sort((a, b) => b.nb - a.nb || a.motif.localeCompare(b.motif))
    .slice(0, n)
}

/** Bons avis plateforme attribués, au format des « incidents » de la note. */
export function bonsAvisAttribues(avis = [], shifts = []) {
  const out = []
  for (const a of avis) {
    if (classifierAvis(a) === 'negatif') continue
    const c = caissierDeLAvis(a, { shifts })
    if (!c) continue
    out.push({
      responsable_id: c.caissier_id, responsable_nom: c.caissier_nom,
      date: new Date(a.commande_le).toISOString().slice(0, 10), bon: true, nature: 'bon avis',
    })
  }
  return out
}
```

- [ ] **Step 3: Tests + lint + commit**

Run: `node --test lib/avisResume.test.mjs && npx eslint lib/avisResume.js`
Expected: PASS (15 tests), 0 erreur.

```bash
git add lib/avisResume.js lib/avisResume.test.mjs
git commit -m "feat(avis): calculs du Résumé — périodes, évolution, caissiers, motifs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 4: Accès base

**Files:**
- Modify: `lib/avisPlateformesDb.js`

**Interfaces:**
- Produces: `chargerAvis` renvoie aussi `raw`, `commande_le` ; `chargerLitigesDesAvis(ids: string[]) → Promise<Array<{id, review_id, responsable_id, responsable_nom, montant}>>` ; `chargerShifts({ restaurantId: string|null, debut, fin }) → Promise<Array<{restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin}>>` (veille de `debut` incluse).

- [ ] **Step 1:** dans `chargerAvis`, remplacer la liste du `.select(…)` par
`'id, platform, restaurant_id, external_store_label, external_ref, rating_raw, rating_scale, rating_normalized, classification, comment, author, review_date, ingested_at, commande_le, raw'`.

- [ ] **Step 2:** ajouter `import { decalerJour } from './avisResume'` sous les imports, puis en fin de fichier :

```js
/** Litiges nés de ces avis (par lots : une liste `in` trop longue échoue). */
export async function chargerLitigesDesAvis(ids = []) {
  const out = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('litiges_avis_clients')
      .select('id, review_id, responsable_id, responsable_nom, montant')
      .in('review_id', ids.slice(i, i + 150))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/**
 * Shifts de caisse de la période (veille comprise : un service de soirée
 * déborde après minuit), pour retrouver le caissier d'un avis.
 */
export async function chargerShifts({ restaurantId = null, debut, fin }) {
  const lignes = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase
      .from('points_shifts')
      .select('restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin')
      .gte('date', decalerJour(debut, -1))
      .lte('date', fin)
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    const debutPage = page * TAILLE_PAGE
    const { data, error } = await q.order('date').order('id').range(debutPage, debutPage + TAILLE_PAGE - 1)
    if (error) throw error
    lignes.push(...(data || []))
    if ((data || []).length < TAILLE_PAGE) break
  }
  return lignes
}
```

- [ ] **Step 3: Lint + commit**

Run: `npx eslint lib/avisPlateformesDb.js` → 0 erreur.

```bash
git add lib/avisPlateformesDb.js
git commit -m "feat(avis): lecture des heures, litiges liés et shifts pour l'attribution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 5: Écran Avis clients — Résumé, périodes, caissiers

**Files:**
- Create: `components/avis/ResumeAvis.js`
- Modify: `app/avis-plateformes.js`

**Interfaces:**
- Consumes: Tasks 3 et 4 ; `useEcranModerne('orange')`, `EnTete`, `Puces`, `ChampDates` (`components/ui/EcranModerne.js`).
- Produces: `<ResumeAvis chiffres chiffresPrec parPlateforme parResto caissiers motifs colors />`.

- [ ] **Step 1: Composant Résumé** — créer `components/avis/ResumeAvis.js` :

```jsx
// ──────────────────────────────────────────────────────────────────────────────
//  Onglet Résumé de l'écran Avis clients : 4 chiffres clés avec leur évolution
//  par rapport à la période précédente, puis restaurants, caissiers et motifs.
//  Les calculs viennent de lib/avisResume.js ; ce composant ne fait qu'afficher.
// ──────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { evolution } from '../../lib/avisResume'
import { PLATEFORMES } from '../../lib/avisPlateformes'

const VERT = '#2E7D32'
const ROUGE = '#C62828'
const fcfa = n => `${Math.round(n || 0).toLocaleString('fr-FR')} F`

function Fleche({ evo, unite = '', styles }) {
  if (!evo) return <Text style={styles.evoNeutre}>—</Text>
  if (evo.sens === 'egal') return <Text style={styles.evoNeutre}>= stable</Text>
  const couleur = evo.mieux ? VERT : ROUGE
  const signe = evo.delta > 0 ? '+' : ''
  return (
    <Text style={[styles.evo, { color: couleur }]}>
      {evo.sens === 'hausse' ? '↑' : '↓'} {signe}{String(evo.delta).replace('.', ',')}{unite}
    </Text>
  )
}

function Tuile({ libelle, valeur, sous, evo, unite, styles }) {
  return (
    <View style={styles.tuile}>
      <Text style={styles.tuileLibelle}>{libelle}</Text>
      <Text style={styles.tuileValeur}>{valeur}</Text>
      {sous ? <Text style={styles.tuileSous}>{sous}</Text> : null}
      <Fleche evo={evo} unite={unite} styles={styles} />
    </View>
  )
}

function Barre({ pct, styles }) {
  return (
    <View style={styles.barreFond}>
      <View style={[styles.barre, { width: `${Math.min(100, pct)}%`, backgroundColor: pct > 20 ? ROUGE : VERT }]} />
    </View>
  )
}

export default function ResumeAvis({ chiffres, chiffresPrec, parPlateforme, parResto, caissiers, motifs, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  const p = chiffresPrec?.nb ? chiffresPrec : null
  const noteFmt = chiffres.noteMoyenne != null ? String(chiffres.noteMoyenne).replace('.', ',') : '—'

  return (
    <View>
      <View style={styles.grille}>
        <Tuile styles={styles} libelle="Note moyenne" valeur={`${noteFmt} / 5`} sous={`${chiffres.nbNotes} avis notés`}
          evo={p ? evolution(chiffres.noteMoyenne, p.noteMoyenne, true) : null} />
        <Tuile styles={styles} libelle="Avis reçus" valeur={String(chiffres.nb)} sous={`${chiffres.nbBons} bons`}
          evo={p ? evolution(chiffres.nb, p.nb, true) : null} />
        <Tuile styles={styles} libelle="Négatifs" valeur={`${String(chiffres.pctNegatifs).replace('.', ',')} %`} sous={`${chiffres.nbNegatifs} avis`}
          evo={p ? evolution(chiffres.pctNegatifs, p.pctNegatifs, false) : null} unite=" pt" />
        <Tuile styles={styles} libelle="Litiges" valeur={String(chiffres.nbLitiges)} sous={fcfa(chiffres.montantLitiges)}
          evo={p ? evolution(chiffres.nbLitiges, p.nbLitiges, false) : null} />
      </View>
      {!p ? <Text style={styles.aide}>Pas d'avis sur la période précédente : pas de comparaison.</Text> : null}

      <View style={styles.bloc}>
        <Text style={styles.blocTitre}>Par plateforme</Text>
        {PLATEFORMES.map(pl => {
          const k = parPlateforme[pl.key]
          return (
            <View key={pl.key} style={styles.ligne}>
              <Text style={[styles.ligneNom, { color: pl.couleur }]}>{pl.label}</Text>
              <Text style={styles.ligneVal}>
                {k.nb} avis{k.noteMoyenne != null ? ` · ${String(k.noteMoyenne).replace('.', ',')}/5` : ''}{k.nb ? ` · ${String(k.pctNegatifs).replace('.', ',')} % nég.` : ''}
              </Text>
            </View>
          )
        })}
      </View>

      {parResto.length > 1 ? (
        <View style={styles.bloc}>
          <Text style={styles.blocTitre}>Restaurants · du pire au meilleur</Text>
          {parResto.map(r => (
            <View key={r.restaurant_id || 'orphelins'} style={styles.ligneBarre}>
              <View style={styles.ligne}>
                <Text style={styles.ligneNom} numberOfLines={1}>{r.nom}</Text>
                <Text style={styles.ligneVal}>{r.nb} avis · {String(r.pctNegatifs).replace('.', ',')} % nég.</Text>
              </View>
              <Barre pct={r.pctNegatifs} styles={styles} />
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.bloc}>
        <Text style={styles.blocTitre}>Caissiers</Text>
        {caissiers.length === 0 ? <Text style={styles.aide}>Aucun avis sur la période.</Text> : caissiers.map(c => (
          <View key={c.cle} style={styles.ligne}>
            <Text style={[styles.ligneNom, c.cle === 'aucun' && { color: colors.textMuted }]} numberOfLines={1}>{c.nom}</Text>
            <Text style={styles.ligneVal}>
              👍 {c.bons}  👎 {c.mauvais}  ·  <Text style={{ color: c.pctNegatifs > 20 ? ROUGE : colors.textSecondary, fontWeight: '700' }}>{String(c.pctNegatifs).replace('.', ',')} %</Text>
            </Text>
          </View>
        ))}
        <Text style={styles.aide}>Caissier présent à l'heure de la commande, ou responsable du litige.</Text>
      </View>

      <View style={styles.bloc}>
        <Text style={styles.blocTitre}>Motifs les plus fréquents</Text>
        {motifs.length === 0 ? <Text style={styles.aide}>Aucune plainte sur la période. 🎉</Text> : motifs.map(m => (
          <View key={m.motif} style={styles.ligne}>
            <Text style={styles.ligneNom} numberOfLines={1}>{m.motif}</Text>
            <Text style={styles.ligneVal}>{m.nb}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  tuile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight, padding: 14 },
  tuileLibelle: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  tuileValeur: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 4, letterSpacing: -0.4 },
  tuileSous: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  evo: { fontSize: 13, fontWeight: '800', marginTop: 6 },
  evoNeutre: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  aide: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: 6, lineHeight: 17 },
  bloc: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight, padding: 14, marginTop: 12 },
  blocTitre: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 8 },
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6 },
  ligneBarre: { paddingBottom: 6 },
  ligneNom: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  ligneVal: { fontSize: 13, color: colors.textSecondary },
  barreFond: { height: 6, borderRadius: 3, backgroundColor: colors.borderLight, overflow: 'hidden' },
  barre: { height: 6, borderRadius: 3 },
}) }
```

- [ ] **Step 2: Écran — imports et périodes** — dans `app/avis-plateformes.js` :
  - supprimer `const TODAY = …`, la fonction `ilYA` et la constante `PERIODES` ;
  - ajouter les imports :

```js
import ResumeAvis from '../components/avis/ResumeAvis'
import { ChampDates, EnTete, Puces, useEcranModerne } from '../components/ui/EcranModerne'
import {
  PERIODES_AVIS, caissierDeLAvis, classementCaissiers, periodePrecedente, plagePeriode, resumeChiffres, topMotifs,
} from '../lib/avisResume'
```

  - dans l'import de `../lib/avisPlateformesDb`, ajouter `chargerLitigesDesAvis, chargerShifts,` ;
  - remplacer `const [onglet, setOnglet] = useState('avis')          // 'avis' | 'rattacher'` par
    `const [onglet, setOnglet] = useState('resume')        // 'resume' | 'avis' | 'rattacher'` ;
  - sous `const [periodeKey, setPeriodeKey] = useState('mois')` ajouter :

```js
  const [perso, setPerso] = useState({ debut: null, fin: null })
  const [champDate, setChampDate] = useState(null)
  const [avisPrec, setAvisPrec] = useState([])
  const [litiges, setLitiges] = useState([])
  const [litigesPrec, setLitigesPrec] = useState([])
  const [shifts, setShifts] = useState([])
  const em = useEcranModerne('orange')
```

  - remplacer `const periode = PERIODES.find(p => p.key === periodeKey) || PERIODES[2]` par :

```js
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const plage = plagePeriode(periodeKey, aujourdhui, perso)
```

  - dépendances du `useEffect` de chargement : `[periodeKey, perso.debut, perso.fin, restoFilter, platformFilter, classFilter]`.

- [ ] **Step 3: Écran — chargement** — remplacer le corps du `try` de `charger()` par :

```js
      if (!plage) { setLoading(false); return }   // dates au choix incomplètes
      const prec = periodePrecedente(plage)
      const filtres = { restaurantId: restoFilter, platform: platformFilter, classification: classFilter }
      const [lignes, lignesPrec, sansResto, dernier, derniersEnvois, sh] = await Promise.all([
        chargerAvis({ debut: plage.debut, fin: plage.fin, ...filtres }),
        chargerAvis({ debut: prec.debut, fin: prec.fin, ...filtres }),
        chargerAvisNonRattaches(),
        dernierRun().catch(() => null),
        dernierAvisRecu().catch(() => null),
        chargerShifts({ restaurantId: restoFilter, debut: plage.debut, fin: plage.fin }).catch(() => []),
      ])
      const [lit, litPrec] = await Promise.all([
        chargerLitigesDesAvis(lignes.map(a => a.id)).catch(() => []),
        chargerLitigesDesAvis(lignesPrec.map(a => a.id)).catch(() => []),
      ])
      setAvis(lignes)
      setAvisPrec(lignesPrec)
      setLitiges(lit)
      setLitigesPrec(litPrec)
      setShifts(sh)
      setOrphelins(sansResto)
      setRun(dernier)
      setRetards(derniersEnvois ? plateformesEnRetard(derniersEnvois) : [])
      setVisible(PAR_PAGE)
```

- [ ] **Step 4: Écran — calculs** — sous `const boutiques = useMemo(…)` :

```js
  const caissierPar = useMemo(() => {
    const litigeParReview = Object.fromEntries(litiges.map(l => [l.review_id, l]))
    return Object.fromEntries(avis.map(a => [a.id, caissierDeLAvis(a, { shifts, litigeParReview })]))
  }, [avis, litiges, shifts])
  const chiffres = useMemo(() => resumeChiffres(avis, litiges), [avis, litiges])
  const chiffresPrec = useMemo(() => resumeChiffres(avisPrec, litigesPrec), [avisPrec, litigesPrec])
  const caissiers = useMemo(() => classementCaissiers(avis, caissierPar), [avis, caissierPar])
  const motifs = useMemo(() => topMotifs(avis), [avis])
```

  et supprimer `const kpis = useMemo(() => kpisAvis(avis), [avis])` (remplacé par `chiffres`) ; retirer `kpisAvis` de l'import de `../lib/avisPlateformes`.

- [ ] **Step 5: Écran — en-tête, périodes, onglets** — remplacer le bloc `<View style={styles.header}> … </View>` (jusqu'à la fin du lien manager) **et** le bloc `{/* Onglets */} <View style={styles.ongletsBar}> … </View>` par :

```jsx
      <EnTete titre="⭐ Avis clients" sous="Yango & Glovo" onRetour={() => retour()} styles={em.styles} />

      <View style={styles.hautFixe}>
        <Puces ligne elements={PERIODES_AVIS} actif={periodeKey} onChoisir={setPeriodeKey} styles={em.styles} />
        {periodeKey === 'perso' ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
            <ChampDates debut={perso.debut} fin={perso.fin}
              setDebut={d => setPerso(p => ({ ...p, debut: d }))} setFin={d => setPerso(p => ({ ...p, fin: d }))}
              champ={champDate} setChamp={setChampDate} styles={em.styles} colors={em.colors} accent={em.accent} couleur={em.principale} />
          </View>
        ) : null}
        <View style={styles.ligneOutils}>
          <TouchableOpacity style={[styles.selecteur, { flex: 1, marginBottom: 0 }]} onPress={() => setShowRestoPicker(true)}>
            <Text style={styles.selecteurTxt}>🏪 {restoNom}</Text>
            <Text style={styles.selecteurChevron}>▾</Text>
          </TouchableOpacity>
          {roleActif === 'manager' ? (
            <TouchableOpacity onPress={() => router.push('/bouton-avis')} style={styles.lienBouton}>
              <Text style={styles.lienBoutonTxt}>🔖 Bouton avis</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.ongletsBar}>
        {[['resume', 'Résumé'], ['avis', 'Avis'], ['rattacher', `À rattacher${boutiques.length ? ` (${boutiques.length})` : ''}`]].map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.ongletBtn, onglet === cle && styles.ongletBtnActif]} onPress={() => setOnglet(cle)}>
            <Text style={[styles.ongletTxt, onglet === cle && styles.ongletTxtActif]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
```

  Puis dans l'onglet Avis, **supprimer** les anciens blocs `{/* Période */}` (puces) et `{/* Restaurant */}` (sélecteur), ainsi que `{/* KPI */}`, `{/* Par plateforme */}` et `{/* Par restaurant … */}` (passés dans le Résumé).

- [ ] **Step 6: Écran — onglet Résumé** — remplacer `) : onglet === 'rattacher' ? (` par :

```jsx
      ) : !plage ? (
        <View style={styles.centre}><Text style={styles.emptyTxt}>Choisissez une date de début et une date de fin.</Text></View>
      ) : onglet === 'resume' ? (
        <ScrollView
          style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {retards.map(r => (
            <View key={r.platform} style={styles.rappelBox}>
              <Text style={styles.rappelTxt}>
                ⏰ {texteRetard(r)} — ouvrez le portail {r.label}{r.platform === 'yango' ? ' (page Avis)' : ''} et cliquez sur le bouton avis.
              </Text>
            </View>
          ))}
          {erreur ? <View style={styles.erreurBox}><Text style={styles.erreurTxt}>{erreur}</Text></View> : null}
          <ResumeAvis chiffres={chiffres} chiffresPrec={chiffresPrec} parPlateforme={parPlateforme}
            parResto={parResto} caissiers={caissiers} motifs={motifs} colors={colors} />
          {run ? (
            <Text style={styles.pied}>
              Dernier envoi complet : {fmtDate(run.run_date)} · {run.inserted} nouvel{run.inserted > 1 ? 's' : ''} avis
            </Text>
          ) : null}
          <View style={{ height: 40 }} />
        </ScrollView>
      ) : onglet === 'rattacher' ? (
```

  Dans l'onglet Avis, **supprimer** le bloc `{retards.map(…)}` (désormais dans le Résumé) et le pied `{/* État de la dernière extraction */}`.

- [ ] **Step 7: Écran — carte d'avis** — dans la carte, sous la ligne `{a.external_ref ? <Text style={styles.ligneSous}>Commande {a.external_ref}</Text> : null}`, ajouter :

```jsx
                <Text style={styles.ligneSous}>
                  {a.commande_le ? `Commande à ${new Date(a.commande_le).toISOString().slice(11, 16)} · ` : 'Heure de commande inconnue · '}
                  {caissierPar[a.id]?.caissier_nom ? `Caissier : ${caissierPar[a.id].caissier_nom}` : 'Caissier : non trouvé'}
                </Text>
```

- [ ] **Step 8: Styles** — dans `makeStyles` :
  - remplacer `lienBouton: …` par
    `lienBouton: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' },`
  - remplacer `lienBoutonTxt: …` par `lienBoutonTxt: { color: colors.text, fontSize: 13, fontWeight: '700' },`
  - ajouter : `hautFixe: { paddingBottom: 10 },` et `ligneOutils: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, alignItems: 'center' },`
  - supprimer `header`, `backBtn`, `backTxt`, `headerTitre`, `headerSub`, `kpiRow`, `kpiCard`, `kpiLabel`, `kpiVal`, `kpiSous` s'ils ne servent plus (vérifier avec `grep -n "styles\.kpi\|styles\.header\|styles\.back" app/avis-plateformes.js`).

- [ ] **Step 9: Lint + tests + export**

Run: `npm run lint && for f in lib/*.test.mjs; do node --test "$f" >/dev/null 2>&1 || echo "ÉCHEC $f"; done; npx expo export -p web`
Expected: 0 erreur de lint, aucun ÉCHEC, export terminé.

- [ ] **Step 10: Commit**

```bash
git add components/avis/ResumeAvis.js app/avis-plateformes.js
git commit -m "feat(avis): écran modernisé — onglet Résumé, périodes, heure et caissier sur chaque avis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 6: Bons avis plateforme dans la note /20

**Files:**
- Modify: `lib/noteCaissierDb.js`

**Interfaces:**
- Consumes: `bonsAvisAttribues(avis, shifts)` (Task 3).

- [ ] **Step 1:** ajouter `import { bonsAvisAttribues } from './avisResume'` sous les imports.

- [ ] **Step 2:** dans le `Promise.all` de `chargerNotesCaissiers`, ajouter en dernière position (et `bonsPlateformes` en dernier dans la déstructuration `const [shifts, …, pos, bonsPlateformes] = …`) :

```js
    toutes(() => filtreResto(supabase.from('platform_reviews').select('id, restaurant_id, classification, rating_raw, rating_scale, commande_le')
      .eq('classification', 'bon').not('commande_le', 'is', null)
      .gte('commande_le', `${debutPrec}T00:00:00Z`).lte('commande_le', `${fin}T23:59:59Z`)).order('id')),
```

- [ ] **Step 3:** dans `incidents`, après `...pasFait.map(…)`, ajouter :

```js
    // Bons avis Glovo/Yango : au caissier présent à l'heure de la commande.
    ...bonsAvisAttribues(bonsPlateformes, shifts),
```

- [ ] **Step 4: Lint + tests + commit**

Run: `npx eslint lib/noteCaissierDb.js && for f in lib/*.test.mjs; do node --test "$f" >/dev/null 2>&1 || echo "ÉCHEC $f"; done`
Expected: 0 erreur, aucun ÉCHEC.

```bash
git add lib/noteCaissierDb.js
git commit -m "feat(caissiers): les bons avis Glovo/Yango comptent dans la note du caissier présent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 7: Mise en base, documentation, essai réel

- [ ] **Step 1: Documentation** — dans `doc/avis-plateformes.md`, ajouter à la fin de la section « Envoi des avis : le bouton » :

```markdown
- **Heure de commande et caissier** : le bouton lit aussi l'heure de chaque
  commande (détail de commande Glovo / Yango). Le litige est daté du jour de
  la commande et attribué au caissier présent (règle de
  `lib/attributionAvis.js`, copiée dans la fonction — un test vérifie la
  copie). Un clic complète l'heure des avis déjà reçus de la fenêtre relue.
```

  Commit + push (`docs(avis): heure de commande et caissier`).

- [ ] **Step 2: Demander l'accord d'Ange** (AskUserQuestion) pour : appliquer `supabase_avis_commande_le.sql` (MCP `apply_migration`), déployer `ingest-reviews` (MCP `deploy_edge_function`, `verify_jwt: false`, fichiers `index.ts` + `attributionAvis.js`). Vercel / EAS seulement s'il le demande.

- [ ] **Step 3: Mise en base** (si accord) — appliquer la migration, déployer la fonction, relire la version déployée (`get_edge_function`) et vérifier qu'elle est identique aux deux fichiers.

- [ ] **Step 4: Essai réel avec Ange** — il réinstalle le favori (le code est copié au moment de l'installation) depuis `http://localhost:8081/bouton-avis`, clique sur Glovo puis sur la page Avis de Yango. Contrôle :

```sql
select platform, count(*) total, count(commande_le) avec_heure from platform_reviews group by 1;
select count(*) filter (where responsable_id is not null or responsable_nom is not null) attribues, count(*) total
from litiges_avis_clients where source = 'avis_plateforme';
```

Expected : la majorité des avis récents a une heure ; une partie des litiges a un responsable (les autres : shifts manquants ou plusieurs caissiers).

- [ ] **Step 5: Vérification à l'écran** (Ange, localhost) : onglet Résumé (tuiles + flèches, restaurants, caissiers, motifs), onglet Avis (« Commande à … · Caissier : … »), période « Dates au choix ».

- [ ] **Step 6:** `graphify update .`, commit `chore(graphify): graphe à jour`, push ; résumé à Ange en français simple ; mettre à jour la mémoire `avis-extraction-cowork.md`.
