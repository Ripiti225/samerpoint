# Réponses aux avis Glovo — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le manager valide ou modifie dans Samtrackly une réponse proposée (modèle par motif) à chaque avis Glovo écrit ; le bouton favori l'envoie à Glovo au clic suivant.

**Architecture:** logique pure dans `lib/reponsesAvis.js` (motif, modèle, vérification) ; table `reponses_avis` ; onglet « À répondre » de l'écran Avis ; `ingest-reviews` donne les réponses validées (GET) et enregistre les résultats (POST) ; le relais `envoi-avis` fait passer les deux ; le moteur du favori retrouve l'avis Glovo par `orderId` et appelle `POST /v1/reviews/reply`.

**Tech Stack:** Expo / React Native web, Supabase (Postgres + Edge Functions Deno), favori `javascript:` (moteur servi tel quel), tests `node:test`.

Spec : `docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md`.

## Global Constraints

- Glovo seulement ; avis **avec un texte** ; manager seul (`roleActif === 'manager'`).
- Réponse : **≤ 250 caractères**, **aucun chiffre**, **aucun nom de restaurant ni de marque** (Samer, Kayan, Yango, Glovo, Uber, Jumia, Xpress), pas de signature.
- Les 8 textes de modèles sont ceux de la spec, au caractère près.
- Envoi : `POST https://vrs-api.eu.prd.portal.restaurant/v1/reviews/reply`, corps `{ global_vendor_code, reviewId, text, language: 'fr' }`, en-tête `Authorization: Bearer <jeton persist:root>`. Le jeton ne quitte jamais la page.
- Une réponse n'est envoyée qu'une fois : seules les `validee` partent ; un avis qui a déjà un `reply` chez Glovo est compté comme envoyé sans renvoi.
- Interface et messages en français courant, jamais de code technique.
- Tout le moteur reste DANS `moteurAvis()` (le favori n'embarque que cette fonction) ; idem `moteurRelais()`.
- Tests : `for f in lib/*.test.mjs; do node "$f"; done` à 0 échec ; `npm run lint` à 0 erreur.
- Commits conventionnels en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Avant tout `git` : `export DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
- Publication (Vercel + EAS) seulement à la fin, avec l'accord de l'utilisateur.

---

### Task 1: Logique pure — motif, modèle, vérification

**Files:**
- Create: `lib/reponsesAvis.js`
- Test: `lib/reponsesAvis.test.mjs`

**Interfaces:**
- Produces:
  - `MODELES: Record<Motif, string>` ; `Motif = 'manquant_erreur'|'froid_sec'|'gout'|'photo_portion'|'emballage'|'negatif_autre'|'positif'|'positif_mais'`
  - `LIBELLES_MOTIF: Record<Motif, string>` (français, pour l'écran)
  - `MAX_REPONSE = 250`
  - `detecterMotif(avis) → Motif` ; `avis = { classification: 'bon'|'negatif', comment: string, raw: { raw?: { theme?: string|string[] } } }`
  - `proposerReponse(avis) → { motif: Motif, texte: string }`
  - `verifierReponse(texte) → string[]` (vide = envoyable)
  - `avisARepondre(avis[], reponsesParAvis: Map<reviewId, { statut }>) → avis[]`

- [ ] **Step 1: Write the failing test** — `lib/reponsesAvis.test.mjs`

```js
// Tests de lib/reponsesAvis.js — réponses proposées aux avis Glovo.
// Glovo annule une réponse avec un chiffre ou un nom de restaurant, et coupe à 250 caractères.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MODELES, MAX_REPONSE, detecterMotif, proposerReponse, verifierReponse, avisARepondre } from './reponsesAvis.js'

const neg = (comment, theme) => ({ classification: 'negatif', comment, raw: { raw: theme ? { theme } : {} } })
const bon = comment => ({ classification: 'bon', comment, raw: { raw: {} } })

describe('MODELES', () => {
  test('chaque modèle est envoyable tel quel', () => {
    for (const [motif, texte] of Object.entries(MODELES)) {
      assert.deepEqual(verifierReponse(texte), [], motif)
      assert.ok(texte.length <= MAX_REPONSE, motif)
    }
  })
})

describe('detecterMotif', () => {
  test('étiquette Glovo d’abord', () => {
    assert.equal(detecterMotif(neg('bof', ['Produits manquants ou incorrects', 'Mauvais goût'])), 'manquant_erreur')
    assert.equal(detecterMotif(neg('bof', 'Mauvais goût')), 'gout')
    assert.equal(detecterMotif(neg('bof', ['Portion trop petite'])), 'photo_portion')
    assert.equal(detecterMotif(neg('bof', ["Qualité de l'emballage"])), 'emballage')
  })
  test('mots du client (avis du 14 au 19/10/2026)', () => {
    assert.equal(detecterMotif(neg('je n\'ai pas reçu ma boisson')), 'manquant_erreur')
    assert.equal(detecterMotif(neg('La pizza commandé n’est pas celle qu’on a reçu.')), 'manquant_erreur')
    assert.equal(detecterMotif(neg('Vielles Frittes froides')), 'froid_sec')
    assert.equal(detecterMotif(neg('les frites st sèches et sans goût')), 'froid_sec')
    assert.equal(detecterMotif(neg('la pizza était trop salée')), 'gout')
    assert.equal(detecterMotif(neg('Pas de goût, fade j’ai pas aimé')), 'gout')
    assert.equal(detecterMotif(neg('J’ai reçu une nourriture différente de la photo')), 'photo_portion')
    assert.equal(detecterMotif(neg('un sauce s’est renversée')), 'emballage')
    assert.equal(detecterMotif(neg('Vous jouez avec les Gens!!!')), 'negatif_autre')
  })
  test('positif, avec ou sans réserve', () => {
    assert.equal(detecterMotif(bon('excellent')), 'positif')
    assert.equal(detecterMotif(bon('trop bon 🤤 , mais j\'ai pas eu de piment à l\'intérieur')), 'positif_mais')
    assert.equal(detecterMotif(bon('samer peut faire mieux')), 'positif_mais')
  })
})

describe('proposerReponse', () => {
  test('le texte du modèle du motif', () => {
    assert.deepEqual(proposerReponse(neg('la pizza était trop salée')), { motif: 'gout', texte: MODELES.gout })
  })
})

describe('verifierReponse', () => {
  test('texte correct : rien à signaler', () => {
    assert.deepEqual(verifierReponse('Bonjour, merci pour votre retour.'), [])
  })
  test('vide', () => {
    assert.deepEqual(verifierReponse('   '), ['Écrivez une réponse.'])
  })
  test('trop long', () => {
    assert.deepEqual(verifierReponse('a'.repeat(263)), ['Trop long : 263 / 250 caractères.'])
  })
  test('un chiffre', () => {
    assert.deepEqual(verifierReponse('Merci, à dans 2 jours'), ['Retirez les chiffres : Glovo refuse les réponses qui en contiennent.'])
  })
  test('un nom de restaurant ou de marque', () => {
    assert.deepEqual(verifierReponse('Merci de la part de Chez Samer'), ['Retirez « Samer » : pas de nom de restaurant ni de marque.'])
    assert.deepEqual(verifierReponse('Toute l’équipe Al Kayan vous remercie'), ['Retirez « Kayan » : pas de nom de restaurant ni de marque.'])
  })
})

describe('avisARepondre', () => {
  const a1 = { id: 'a1', platform: 'glovo', comment: 'trop salé' }
  const a2 = { id: 'a2', platform: 'glovo', comment: '' }
  const a3 = { id: 'a3', platform: 'yango', comment: 'bof' }
  const a4 = { id: 'a4', platform: 'glovo', comment: 'froid' }
  const a5 = { id: 'a5', platform: 'glovo', comment: 'pas reçu' }
  test('Glovo, avec texte, sans réponse ou réponse refusée', () => {
    const rep = new Map([['a4', { statut: 'validee' }], ['a5', { statut: 'refusee' }]])
    assert.deepEqual(avisARepondre([a1, a2, a3, a4, a5], rep).map(a => a.id), ['a1', 'a5'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/reponsesAvis.test.mjs`
Expected: FAIL — `Cannot find module` / `does not provide an export named 'MODELES'`.

- [ ] **Step 3: Write minimal implementation** — `lib/reponsesAvis.js`

```js
// ──────────────────────────────────────────────────────────────────────────────
//  RÉPONSES AUX AVIS GLOVO — proposition par motif et vérification
//
//  Le manager valide ou modifie la réponse proposée ; le favori l'envoie.
//  Glovo annule une réponse qui contient un chiffre ou un nom de restaurant,
//  et son champ s'arrête à 250 caractères (relevé le 21/10/2026).
//  Spec : docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
//  Tests : lib/reponsesAvis.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const MAX_REPONSE = 250

export const MODELES = {
  manquant_erreur: 'Bonjour, merci pour votre retour et toutes nos excuses pour cette erreur dans votre commande. Nous avons fait le point avec l\'équipe pour que cela ne se reproduise pas. Au plaisir de mieux vous servir.',
  froid_sec: 'Bonjour, merci pour votre retour. Nous sommes désolés que votre commande ne soit pas arrivée chaude et fraîche. Nous revoyons la préparation et la remise au livreur. Au plaisir de mieux vous servir.',
  gout: 'Bonjour, merci d\'avoir pris le temps de nous écrire. Nous sommes désolés que le goût ne vous ait pas plu. Votre remarque est transmise à notre cuisine. Au plaisir de vous régaler la prochaine fois.',
  photo_portion: 'Bonjour, merci pour votre retour. Nous sommes désolés que votre commande ne corresponde pas à vos attentes. Nous veillons à ce que chaque plat soit servi comme présenté. Au plaisir de vous revoir.',
  emballage: 'Bonjour, merci pour votre retour et toutes nos excuses pour l\'état de votre commande à l\'arrivée. Nous renforçons la vérification des emballages avant chaque départ. Au plaisir de mieux vous servir.',
  negatif_autre: 'Bonjour, merci pour votre retour. Nous sommes désolés que votre expérience n\'ait pas été à la hauteur. Votre remarque est transmise à l\'équipe. Au plaisir de mieux vous servir très bientôt.',
  positif: 'Bonjour, merci beaucoup pour votre message ! Toute l\'équipe est ravie que vous ayez apprécié votre commande. À très bientôt !',
  positif_mais: 'Bonjour, merci pour votre message, nous sommes ravis que vous ayez apprécié ! Nous prenons note de votre remarque pour que la prochaine commande soit parfaite. À très bientôt !',
}

export const LIBELLES_MOTIF = {
  manquant_erreur: 'Produit manquant ou erreur',
  froid_sec: 'Froid, sec',
  gout: 'Goût',
  photo_portion: 'Différent de la photo, portion',
  emballage: 'Emballage',
  negatif_autre: 'Avis négatif',
  positif: 'Avis positif',
  positif_mais: 'Positif avec une remarque',
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’`]/g, '\'')

// Étiquettes Glovo (libellés français de THEMES_GLOVO, public/bouton-avis.js).
const PAR_THEME = [
  ['manquant_erreur', ['produits manquants ou incorrects']],
  ['gout', ['mauvais gout']],
  ['photo_portion', ['portion trop petite', 'taille des portions']],
  ['emballage', ['qualite de l\'emballage']],
]

// Mots du client, dans l'ordre de priorité.
const PAR_MOTS = [
  ['manquant_erreur', /pas re[cç]u|recu (une|un|des)? ?(autre|mauvais)|manqu|oubli|pas (la|le|les) bon|pas celle|pas celui|pas ce que|au lieu|contraire|erreur|tromp/],
  ['froid_sec', /froid|tiede|\bsec(he)?s?\b|pas chaud|pas frais|rassis|vieil/],
  ['gout', /gout|fade|\bsalee?s?\b|trop de sel|immangeable|pas bon|mauvais(e)? (pizza|pate|qualite)|\bpate\b/],
  ['photo_portion', /photo|portion|trop petit|quantite|pas assez/],
  ['emballage', /emballage|renvers|couvert|papier alu|\bsac\b|fuite|ecrase/],
]

const RESERVE = /\bmais\b|\bsauf\b|pas eu de|peut faire mieux|manquait|dommage/

function themes(avis) {
  const t = avis?.raw?.raw?.theme
  return (Array.isArray(t) ? t : t ? [t] : []).map(norm)
}

export function detecterMotif(avis) {
  const texte = norm(avis?.comment)
  if (avis?.classification !== 'negatif') return RESERVE.test(texte) ? 'positif_mais' : 'positif'
  const ts = themes(avis)
  for (const [motif, libelles] of PAR_THEME) if (ts.some(t => libelles.includes(t))) return motif
  for (const [motif, re] of PAR_MOTS) if (re.test(texte)) return motif
  return 'negatif_autre'
}

export function proposerReponse(avis) {
  const motif = detecterMotif(avis)
  return { motif, texte: MODELES[motif] }
}

const MARQUES = [['samer', 'Samer'], ['kayan', 'Kayan'], ['yango', 'Yango'], ['glovo', 'Glovo'], ['uber', 'Uber'], ['jumia', 'Jumia'], ['xpress', 'Xpress']]

export function verifierReponse(texte) {
  const t = String(texte ?? '').trim()
  if (!t) return ['Écrivez une réponse.']
  const problemes = []
  if (t.length > MAX_REPONSE) problemes.push(`Trop long : ${t.length} / ${MAX_REPONSE} caractères.`)
  if (/\d/.test(t)) problemes.push('Retirez les chiffres : Glovo refuse les réponses qui en contiennent.')
  const n = norm(t)
  for (const [cle, nom] of MARQUES) {
    if (new RegExp(`\\b${cle}`).test(n)) problemes.push(`Retirez « ${nom} » : pas de nom de restaurant ni de marque.`)
  }
  return problemes
}

/** Avis Glovo écrits, sans réponse ou dont la réponse a été refusée par Glovo. */
export function avisARepondre(avis, reponsesParAvis) {
  return (avis || []).filter(a => {
    if (a.platform !== 'glovo' || !String(a.comment || '').trim()) return false
    const r = reponsesParAvis?.get(a.id)
    return !r || r.statut === 'refusee'
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node lib/reponsesAvis.test.mjs`
Expected: PASS, `fail 0`. Si un motif de la batterie « mots du client » échoue, ajuster l'expression de `PAR_MOTS` concernée (jamais le test : ces phrases sont de vrais avis).

- [ ] **Step 5: Commit**

```bash
git add lib/reponsesAvis.js lib/reponsesAvis.test.mjs
git commit -m "feat(avis): réponses proposées par motif et vérification avant envoi Glovo"
```

---

### Task 2: Table `reponses_avis` et accès base côté app

**Files:**
- Create: `supabase_reponses_avis.sql`
- Create: `lib/reponsesAvisDb.js`

**Interfaces:**
- Produces:
  - table `reponses_avis(id, review_id UNIQUE, texte, modele, statut, erreur, valide_par, valide_le, envoye_le)`
  - `chargerAvisGlovoEcrits({ depuis: 'AAAA-MM-JJ' }) → Promise<avis[]>` (mêmes colonnes que `chargerAvis`)
  - `chargerReponses(reviewIds: string[]) → Promise<Map<reviewId, ligne>>`
  - `enregistrerReponse({ reviewId, texte, modele, statut: 'validee'|'ignoree', par }) → Promise<void>` (upsert sur `review_id`, remet `erreur` à null)

- [ ] **Step 1: Write the migration** — `supabase_reponses_avis.sql`

```sql
-- =====================================================================
--  RÉPONSES AUX AVIS GLOVO
--  docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
--  Idempotent. À passer dans le SQL Editor du projet Samtrackly.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reponses_avis (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  UUID NOT NULL UNIQUE REFERENCES platform_reviews(id) ON DELETE CASCADE,
  texte      TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 250),
  modele     TEXT,
  statut     TEXT NOT NULL CHECK (statut IN ('validee', 'envoyee', 'refusee', 'ignoree')),
  erreur     TEXT,
  valide_par TEXT,
  valide_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  envoye_le  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reponses_avis_statut ON reponses_avis (statut);

-- Même posture que les autres tables de l'app (clé anon, RLS ouvert).
ALTER TABLE reponses_avis ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY tout ON reponses_avis FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Faire passer la migration** — demander à l'utilisateur (AskUserQuestion) : « je la passe moi-même sur le projet Samtrackly » ou « vous la passez dans le SQL Editor ». Puis vérifier :

```sql
select column_name from information_schema.columns where table_name = 'reponses_avis' order by ordinal_position;
```
Expected : les 9 colonnes.

- [ ] **Step 3: Write `lib/reponsesAvisDb.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
//  RÉPONSES AUX AVIS GLOVO — accès base (table reponses_avis)
//  La logique vit dans lib/reponsesAvis.js ; ici on ne parle qu'à Supabase.
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'

const COLONNES_AVIS = 'id, platform, restaurant_id, external_store_label, external_ref, classification, comment, review_date, commande_le, raw'

/** Avis Glovo avec texte depuis une date (paginé : Supabase coupe à 1000). */
export async function chargerAvisGlovoEcrits({ depuis }) {
  const lignes = []
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase.from('platform_reviews').select(COLONNES_AVIS)
      .eq('platform', 'glovo').gte('review_date', depuis).neq('comment', '')
      .order('review_date', { ascending: false }).order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    lignes.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return lignes.filter(a => String(a.comment || '').trim())
}

export async function chargerReponses(reviewIds) {
  const parAvis = new Map()
  for (let i = 0; i < reviewIds.length; i += 200) {
    const { data, error } = await supabase.from('reponses_avis').select('*').in('review_id', reviewIds.slice(i, i + 200))
    if (error) throw error
    for (const r of data || []) parAvis.set(r.review_id, r)
  }
  return parAvis
}

export async function enregistrerReponse({ reviewId, texte, modele, statut, par }) {
  const { error } = await supabase.from('reponses_avis').upsert({
    review_id: reviewId, texte: String(texte).trim(), modele, statut,
    erreur: null, valide_par: par || null, valide_le: new Date().toISOString(), envoye_le: null,
  }, { onConflict: 'review_id' })
  if (error) throw error
}
```

- [ ] **Step 4: Lint**

Run: `npx eslint lib/reponsesAvisDb.js`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add supabase_reponses_avis.sql lib/reponsesAvisDb.js
git commit -m "feat(avis): table reponses_avis et accès base"
```

---

### Task 3: Onglet « À répondre » de l'écran Avis (manager)

**Files:**
- Create: `components/avis/ReponsesAvis.js`
- Modify: `app/avis-plateformes.js` (barre d'onglets ~l. 211-216, rendu des onglets ~l. 223-260, imports)

**Interfaces:**
- Consumes: Task 1 (`proposerReponse`, `verifierReponse`, `avisARepondre`, `LIBELLES_MOTIF`, `MAX_REPONSE`) ; Task 2 (`chargerAvisGlovoEcrits`, `chargerReponses`, `enregistrerReponse`).
- Produces: `<ReponsesAvis restaurants colors userNom restoFilter />` (charge lui-même ses données).

- [ ] **Step 1: Write `components/avis/ReponsesAvis.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
//  Onglet « À répondre » (écran Avis, manager) — réponses aux avis Glovo écrits.
//  Valider : la réponse part au prochain clic sur le bouton favori (portail Glovo).
//  Spec : docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { LIBELLES_MOTIF, MAX_REPONSE, avisARepondre, proposerReponse, verifierReponse } from '../../lib/reponsesAvis'
import { chargerAvisGlovoEcrits, chargerReponses, enregistrerReponse } from '../../lib/reponsesAvisDb'

const JOURS = 60

export default function ReponsesAvis({ restaurants, colors, userNom, restoFilter }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [avis, setAvis] = useState([])
  const [reponses, setReponses] = useState(new Map())
  const [textes, setTextes] = useState({})          // id avis → texte en cours
  const [enEdition, setEnEdition] = useState(null)
  const [enCours, setEnCours] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)

  async function charger() {
    setChargement(true); setErreur(null)
    try {
      const depuis = new Date(Date.now() - JOURS * 86400000).toISOString().slice(0, 10)
      const lignes = await chargerAvisGlovoEcrits({ depuis })
      setAvis(lignes)
      setReponses(await chargerReponses(lignes.map(a => a.id)))
    } catch (_e) {
      setErreur('Les avis n’ont pas pu être chargés. Tirez vers le bas pour réessayer.')
    } finally { setChargement(false) }
  }
  useEffect(() => { charger() }, [])

  const nomResto = id => restaurants.find(r => r.id === id)?.nom || 'Boutique non rattachée'
  const liste = avisARepondre(avis, reponses).filter(a => !restoFilter || a.restaurant_id === restoFilter)
  const enAttente = [...reponses.values()].filter(r => r.statut === 'validee').length

  function texteDe(a) {
    if (textes[a.id] != null) return textes[a.id]
    const r = reponses.get(a.id)
    return r?.statut === 'refusee' ? r.texte : proposerReponse(a).texte
  }

  async function decider(a, statut) {
    const texte = texteDe(a)
    if (statut === 'validee' && verifierReponse(texte).length) return
    setEnCours(a.id)
    try {
      await enregistrerReponse({ reviewId: a.id, texte, modele: proposerReponse(a).motif, statut, par: userNom })
      setReponses(prev => new Map(prev).set(a.id, { review_id: a.id, texte, statut }))
      setEnEdition(null)
    } catch (_e) {
      setErreur('L’enregistrement a échoué. Réessayez.')
    } finally { setEnCours(null) }
  }

  if (chargement) return <View style={styles.centre}><ActivityIndicator color={colors.primary} /></View>

  return (
    <ScrollView style={styles.body}>
      <Text style={styles.entete}>
        {liste.length} à répondre · {enAttente} en attente d’envoi
      </Text>
      {enAttente ? (
        <Text style={styles.rappel}>📤 Cliquez sur le bouton favori dans le portail Glovo pour envoyer les réponses validées.</Text>
      ) : null}
      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}
      {liste.length === 0 ? <Text style={styles.vide}>✅ Aucun avis en attente de réponse</Text> : null}
      {liste.map(a => {
        const texte = texteDe(a)
        const problemes = verifierReponse(texte)
        const refusee = reponses.get(a.id)?.statut === 'refusee' ? reponses.get(a.id) : null
        const plat = a.raw?.raw?.dish
        return (
          <View key={a.id} style={styles.carte}>
            <Text style={styles.meta}>
              {a.classification === 'negatif' ? '👎' : '👍'} {a.review_date?.split('-').reverse().join('/')} · {nomResto(a.restaurant_id)}
            </Text>
            {plat ? <Text style={styles.plat}>🍽 {Array.isArray(plat) ? plat.join(', ') : plat}</Text> : null}
            <Text style={styles.client}>« {a.comment} »</Text>
            <Text style={styles.motif}>{LIBELLES_MOTIF[proposerReponse(a).motif]}</Text>
            {refusee ? <Text style={styles.erreur}>Refusée par Glovo : {refusee.erreur || 'sans raison donnée'}</Text> : null}
            {enEdition === a.id ? (
              <TextInput style={styles.champ} value={texte} multiline
                onChangeText={v => setTextes(p => ({ ...p, [a.id]: v }))} />
            ) : (
              <Text style={styles.reponse}>{texte}</Text>
            )}
            <Text style={[styles.compteur, texte.length > MAX_REPONSE && styles.rouge]}>{texte.length} / {MAX_REPONSE}</Text>
            {problemes.map(p => <Text key={p} style={styles.erreur}>⚠️ {p}</Text>)}
            <View style={styles.boutons}>
              <TouchableOpacity style={[styles.btn, styles.btnIgnorer]} disabled={enCours === a.id} onPress={() => decider(a, 'ignoree')}>
                <Text style={styles.btnTxtSombre}>Ignorer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnModifier]} onPress={() => setEnEdition(enEdition === a.id ? null : a.id)}>
                <Text style={styles.btnTxtSombre}>{enEdition === a.id ? 'Fermer' : 'Modifier'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnValider, (problemes.length || enCours === a.id) && { opacity: 0.4 }]}
                disabled={!!problemes.length || enCours === a.id} onPress={() => decider(a, 'validee')}>
                <Text style={styles.btnTxt}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      })}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    body: { flex: 1, padding: 16 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    entete: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
    rappel: { fontSize: 13, color: colors.textSecondary, marginBottom: 12 },
    vide: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 40 },
    carte: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
    meta: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
    plat: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
    client: { fontSize: 15, color: colors.text, fontStyle: 'italic', marginBottom: 8 },
    motif: { fontSize: 12, fontWeight: '700', color: colors.primary, marginBottom: 6 },
    reponse: { fontSize: 14, color: colors.text, lineHeight: 20, backgroundColor: colors.background, borderRadius: 10, padding: 10 },
    champ: { fontSize: 14, color: colors.text, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, padding: 10, minHeight: 100, textAlignVertical: 'top' },
    compteur: { fontSize: 12, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
    rouge: { color: '#C62828', fontWeight: '700' },
    erreur: { fontSize: 13, color: '#C62828', marginTop: 4 },
    boutons: { flexDirection: 'row', gap: 8, marginTop: 10 },
    btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    btnIgnorer: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    btnModifier: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.primary },
    btnValider: { backgroundColor: '#2E7D32' },
    btnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
    btnTxtSombre: { color: colors.text, fontWeight: '700', fontSize: 15 },
  })
}
```

- [ ] **Step 2: Brancher l'onglet dans `app/avis-plateformes.js`**

Import en tête :
```js
import ReponsesAvis from '../components/avis/ReponsesAvis'
```
Barre d'onglets : remplacer le tableau littéral par
```js
{[['resume', 'Résumé'], ['avis', 'Avis'],
  ...(roleActif === 'manager' ? [['repondre', 'À répondre']] : []),
  ['rattacher', `À rattacher${boutiques.length ? ` (${boutiques.length})` : ''}`]].map(([cle, label]) => (
```
Rendu : juste avant la branche `) : onglet === 'rattacher' ? (`, insérer
```js
) : onglet === 'repondre' && roleActif === 'manager' ? (
  <ReponsesAvis restaurants={restaurants} colors={colors} userNom={userNom} restoFilter={restoFilter} />
```
Mettre à jour le commentaire d'état : `// 'resume' | 'avis' | 'repondre' | 'rattacher'`.

- [ ] **Step 3: Lint + export web (pas de localhost)**

Run: `npx eslint app/avis-plateformes.js components/avis/ReponsesAvis.js && npx expo export -p web`
Expected: 0 erreur ; `Exported: dist`. Vérifier la présence dans le bundle avec un fragment SANS accent : `grep -l "en attente d" dist/_expo/static/js/web/*.js`.

- [ ] **Step 4: Commit**

```bash
git add components/avis/ReponsesAvis.js app/avis-plateformes.js
git commit -m "feat(avis): onglet « À répondre » — valider, modifier ou ignorer la réponse proposée"
```

---

### Task 4: `ingest-reviews` — réponses à envoyer (GET) et résultats (POST)

**Files:**
- Modify: `supabase/functions/ingest-reviews/index.ts` (en-tête l. 6-16, GET l. 131-143, début du POST l. 145-150)

**Interfaces:**
- Produces:
  - GET → en plus `reponses: [{ id, external_ref, external_store_label, review_date, texte }]` (statut `validee`, avis Glovo).
  - POST `{ reponses_resultats: [{ id, ok: boolean, erreur?: string }] }` → `{ reponses_maj: number }` ; `ok` → `envoyee` + `envoye_le`, sinon `refusee` + `erreur`.

- [ ] **Step 1: Ajouter la lecture des réponses validées** (après `derniersParPlateforme`)

```ts
// Réponses validées par le manager, à envoyer à Glovo par le favori.
async function reponsesAEnvoyer() {
  const { data, error } = await supabase.from('reponses_avis')
    .select('id, texte, platform_reviews!inner(external_ref, external_store_label, review_date, platform)')
    .eq('statut', 'validee').eq('platform_reviews.platform', 'glovo').limit(200)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id, texte: r.texte,
    external_ref: r.platform_reviews.external_ref,
    external_store_label: r.platform_reviews.external_store_label,
    review_date: r.platform_reviews.review_date,
  }))
}
```

GET : ajouter `reponsesAEnvoyer()` au `Promise.all` et `reponses` à la réponse :
```ts
const [{ data, error }, derniers, reponses] = await Promise.all([ /* … existant … */, derniersParPlateforme(), reponsesAEnvoyer()])
if (error) throw error
return json({ done_today: !!data, finished_at: data?.finished_at ?? null, derniers, reponses })
```

- [ ] **Step 2: Ajouter la branche POST des résultats** (juste après `const body = await req.json().catch(() => null)`)

```ts
// Résultats d'envoi des réponses (favori → relais). Seules les « validee » bougent.
if (Array.isArray(body?.reponses_resultats)) {
  let maj = 0
  for (const r of body.reponses_resultats) {
    if (!r?.id) continue
    const champs = r.ok
      ? { statut: 'envoyee', envoye_le: new Date().toISOString(), erreur: null }
      : { statut: 'refusee', erreur: String(r.erreur || 'Glovo a refusé la réponse.').slice(0, 300) }
    const { error, count } = await supabase.from('reponses_avis').update(champs, { count: 'exact' })
      .eq('id', r.id).eq('statut', 'validee')
    if (error) throw error
    maj += count ?? 0
  }
  return json({ reponses_maj: maj })
}
```
Mettre à jour l'en-tête du fichier (routage GET/POST) en conséquence.

- [ ] **Step 3: Déployer et vérifier**

```bash
npx supabase functions deploy ingest-reviews --no-verify-jwt --project-ref wlwotzxnzowbkbfcpnyi
```
Vérifier qu'un GET sans secret répond toujours 401 :
`curl -s -o /dev/null -w "%{http_code}" https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-reviews` → `401`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ingest-reviews/index.ts
git commit -m "feat(avis): ingest-reviews donne les réponses validées et enregistre leur envoi"
```

---

### Task 5: Relais `envoi-avis` — transmettre les réponses et leurs résultats

**Files:**
- Modify: `public/envoi-avis.js` (handler `config` l. 60-81, nouveau type `reponses`, export)
- Modify: `public/envoi-avis.html` (ajouter `<p id="reponses"></p>` sous `#etat`, même style `.ok`/`.erreur`)
- Test: `lib/envoiAvis.test.mjs`

**Interfaces:**
- Consumes: Task 4 (GET `reponses`, POST `reponses_resultats`).
- Produces: message `derniers` porte `reponses` ; le relais accepte `{ type: 'reponses', resultats: [{ id, ok, erreur? }] }` ; `resumeReponses(resultats) → string`.

- [ ] **Step 1: Write the failing test** (ajouter à `lib/envoiAvis.test.mjs`, et `resumeReponses` à la déstructuration en tête)

```js
describe('resumeReponses — ce que voit le manager après l’envoi', () => {
  test('envoyées et refusées', () => {
    assert.equal(resumeReponses([{ ok: true }, { ok: true }, { ok: false, erreur: 'x' }]), 'Réponses Glovo : 2 envoyées · 1 refusée par Glovo (à corriger dans Samtrackly)')
  })
  test('une seule envoyée', () => {
    assert.equal(resumeReponses([{ ok: true }]), 'Réponses Glovo : 1 envoyée')
  })
  test('rien à envoyer : rien à dire', () => {
    assert.equal(resumeReponses([]), '')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/envoiAvis.test.mjs`
Expected: FAIL — `resumeReponses is not a function`.

- [ ] **Step 3: Implement** dans `moteurRelais()`

```js
  function resumeReponses(resultats) {
    const ok = resultats.filter(function (r) { return r.ok }).length
    const ko = resultats.length - ok
    if (!resultats.length) return ''
    let t = 'Réponses Glovo : ' + ok + ' envoyée' + (ok > 1 ? 's' : '')
    if (ko) t += ' · ' + ko + ' refusée' + (ko > 1 ? 's' : '') + ' par Glovo (à corriger dans Samtrackly)'
    return t
  }
```
Dans le handler `config`, transmettre la liste :
```js
portail.postMessage({ type: 'derniers', derniers: j.derniers || {}, commandes: derniersCommandes, reponses: j.reponses || [] }, e.origin)
```
Nouveau cas, avant `else if (e.data.type === 'erreur')` :
```js
      } else if (e.data.type === 'reponses' && secret && p === plateforme) {
        const resultats = Array.isArray(e.data.resultats) ? e.data.resultats : []
        const zone = document.getElementById('reponses')
        try {
          const envoi = await fetch(urlFonction, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
            body: JSON.stringify({ reponses_resultats: resultats }),
          })
          zone.textContent = envoi.ok ? resumeReponses(resultats) : messageHttp(envoi.status)
          zone.className = envoi.ok ? 'ok' : 'erreur'
        } catch (_e) {
          zone.textContent = RESEAU
          zone.className = 'erreur'
        }
```
Ajouter `resumeReponses: resumeReponses` à l'objet retourné. Dans `envoi-avis.html` : `<p id="reponses"></p>` et `#reponses.ok`, `#reponses.erreur` dans le style (mêmes couleurs que `#etat`).

- [ ] **Step 4: Run tests**

Run: `node lib/envoiAvis.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/envoi-avis.js public/envoi-avis.html lib/envoiAvis.test.mjs
git commit -m "feat(bouton-avis): le relais transmet les réponses validées et leurs résultats"
```

---

### Task 6: Moteur du favori — envoyer les réponses à Glovo

**Files:**
- Modify: `public/bouton-avis.js` (`lireGlovo` l. 246-276, nouvelles fonctions dans `moteurAvis()`, `lancer` l. 512-566, export l. 568+ , en-tête l. 1-15)
- Test: `lib/boutonAvis.test.mjs`

**Interfaces:**
- Consumes: Task 5 (`reponse.reponses` dans le message `derniers` ; message `reponses`).
- Produces (exportés pour les tests) :
  - `indexerAvisGlovo(bruts) → Map<'vendeur|orderId', { id, deja }>`
  - `planReponses(reponses, index) → { aEnvoyer: [{ reponse, reviewId }], deja: [id], introuvables: [reponse] }`

- [ ] **Step 1: Write the failing test** (ajouter à `lib/boutonAvis.test.mjs`, et les deux noms à la déstructuration de `moteurAvis()`)

```js
describe('réponses aux avis Glovo', () => {
  const bruts = [
    { id: 'rv1', orderId: '101806279410', globalVendorCode: 'GV_CI;84806', reply: null },
    { id: 'rv2', orderId: '101807594693', globalVendorCode: 'GV_CI;84806', reply: { text: 'déjà fait' } },
  ]
  const rep = (id, ref) => ({ id, external_ref: ref, external_store_label: 'GV_CI;84806', review_date: '2026-10-19', texte: 'Merci' })
  test('index par boutique et numéro de commande', () => {
    const i = indexerAvisGlovo(bruts)
    assert.deepEqual(i.get('GV_CI;84806|101806279410'), { id: 'rv1', deja: false })
    assert.deepEqual(i.get('GV_CI;84806|101807594693'), { id: 'rv2', deja: true })
  })
  test('à envoyer, déjà répondu chez Glovo, introuvable', () => {
    const p = planReponses([rep('a', '101806279410'), rep('b', '101807594693'), rep('c', '999')], indexerAvisGlovo(bruts))
    assert.deepEqual(p.aEnvoyer.map(x => [x.reponse.id, x.reviewId]), [['a', 'rv1']])
    assert.deepEqual(p.deja, ['b'])
    assert.deepEqual(p.introuvables.map(r => r.id), ['c'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/boutonAvis.test.mjs`
Expected: FAIL — `indexerAvisGlovo is not a function`.

- [ ] **Step 3: Implement** dans `moteurAvis()`

`lireGlovo` garde les avis bruts : déclarer `let bruts = []` en tête, faire `bruts = bruts.concat(lot)` à chaque page, et avant `return tous` : `tous.bruts = bruts`.

Ajouter après `lireGlovo` :
```js
  // ── Réponses aux avis (validées dans Samtrackly) ──────────────────────
  // Spec : docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
  let URL_GLOVO_REPONSE = 'https://vrs-api.eu.prd.portal.restaurant/v1/reviews/reply'

  function indexerAvisGlovo(bruts) {
    let index = new Map()
    ;(bruts || []).forEach(function (r) {
      index.set(r.globalVendorCode + '|' + String(r.orderId), { id: r.id, deja: !!r.reply })
    })
    return index
  }

  function planReponses(reponses, index) {
    let plan = { aEnvoyer: [], deja: [], introuvables: [] }
    ;(reponses || []).forEach(function (rep) {
      let a = index.get(rep.external_store_label + '|' + String(rep.external_ref))
      if (!a) plan.introuvables.push(rep)
      else if (a.deja) plan.deja.push(rep.id)
      else plan.aEnvoyer.push({ reponse: rep, reviewId: a.id })
    })
    return plan
  }

  // Avis d'une boutique un jour donné (avis hors de la période relue).
  async function lireAvisDuJour(jeton, vendeur, jour) {
    let r = await fetch(URL_GLOVO, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
      body: JSON.stringify({ global_vendor_codes: [vendeur], include_stats: false, pagination: { perPage: PAR_PAGE },
        filter: { ratingMin: 1, ratingMax: 5, hasText: true, startDate: jour + 'T00:00:00.000Z', endDate: jour + 'T23:59:59.999Z' } }),
    })
    if (r.status === 401 || r.status === 403) throw sessionExpiree('Glovo')
    if (!r.ok) throw erreurFr('Glovo n’a pas répondu.')
    return (await r.json()).reviews || []
  }

  async function envoyerUneReponse(jeton, vendeur, reviewId, texte) {
    let r = await fetch(URL_GLOVO_REPONSE, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
      body: JSON.stringify({ global_vendor_code: vendeur, reviewId: reviewId, text: texte, language: 'fr' }),
    })
    if (r.status === 401 || r.status === 403) throw sessionExpiree('Glovo')
    if (r.ok) return { ok: true }
    if (r.status >= 400 && r.status < 500) {
      let raison = ''
      try { let j = await r.json(); raison = j.message || j.error || '' } catch (_e) { /* corps vide */ }
      return { ok: false, erreur: 'Glovo a refusé la réponse' + (raison ? ' : ' + String(raison).slice(0, 200) : '.') }
    }
    throw erreurFr('Glovo n’a pas répondu.')   // 5xx : réessai, sinon reste « validée »
  }

  // → résultats [{ id, ok, erreur? }] ; une réponse non tentée (réseau) n'y figure pas.
  async function envoyerReponsesGlovo(reponses, bruts, info) {
    if (!reponses || !reponses.length) return []
    let jeton = jetonGlovo()
    if (!jeton) throw erreurFr('Ta session Glovo a expiré : reconnecte-toi au portail puis clique à nouveau.')
    let index = indexerAvisGlovo(bruts)
    let plan = planReponses(reponses, index)
    let jours = {}
    plan.introuvables.forEach(function (rep) { jours[rep.external_store_label + '|' + rep.review_date] = true })
    for (let cle of Object.keys(jours)) {
      let p = cle.split('|')
      try { indexerAvisGlovo(await lireAvisDuJour(jeton, p[0], p[1])).forEach(function (v, k) { index.set(k, v) }) } catch (e) { if (e && e.definitif) throw e }
    }
    plan = planReponses(reponses, index)
    let resultats = plan.deja.map(function (id) { return { id: id, ok: true } })
    let faits = 0
    await enParallele(plan.aEnvoyer, 2, async function (x) {
      try {
        let r = await avecReprise(function () { return envoyerUneReponse(jeton, x.reponse.external_store_label, x.reviewId, x.reponse.texte) })
        resultats.push({ id: x.reponse.id, ok: r.ok, erreur: r.erreur })
      } catch (e) { if (e && e.definitif) throw e }
      faits++
      info('Réponses Glovo : ' + faits + '/' + plan.aEnvoyer.length)
    })
    return resultats
  }
```

Dans `lancer`, juste après l'envoi des avis (`fen.postMessage({ type: 'avis', … })` et son `info(...)`), ajouter :
```js
      if (plateforme === 'glovo' && reponse.reponses && reponse.reponses.length) {
        try {
          info('Envoi de ' + reponse.reponses.length + ' réponse' + (reponse.reponses.length > 1 ? 's' : '') + ' aux avis Glovo…')
          let resultats = await envoyerReponsesGlovo(reponse.reponses, avis.bruts, info)
          fen.postMessage({ type: 'reponses', resultats: resultats }, cfg.origine)
        } catch (e) {
          info(e && e.messageFr ? e.messageFr : 'Les réponses n’ont pas pu partir : elles repartiront au prochain clic.', 8000)
        }
      }
```
Ajouter `indexerAvisGlovo` et `planReponses` à l'objet retourné. Compléter l'en-tête du fichier : « 5. envoie à Glovo les réponses validées dans Samtrackly ».

- [ ] **Step 4: Run tests**

Run: `node lib/boutonAvis.test.mjs`
Expected: PASS (les tests existants inclus).

- [ ] **Step 5: Commit**

```bash
git add public/bouton-avis.js lib/boutonAvis.test.mjs
git commit -m "feat(bouton-avis): envoi à Glovo des réponses validées dans Samtrackly"
```

---

### Task 7: Vérification d'ensemble, publication et premier envoi réel

**Files:** aucun nouveau.

- [ ] **Step 1: Tous les tests et le lint**

Run: `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ÉCHEC $f"; done; npm run lint 2>&1 | tail -2`
Expected: aucune ligne « ÉCHEC » ; `0 errors`.

- [ ] **Step 2: Push puis demander l'accord de publier** (AskUserQuestion). Avec l'accord :

```bash
git push
rm -rf dist && npx expo export -p web && npx vercel deploy --prod --yes --scope ripiti225s-projects
npx eas-cli update --branch production --message "Réponses aux avis Glovo depuis Samtrackly" --non-interactive
```

- [ ] **Step 3: Réinstaller le favori** — l'utilisateur ouvre Samtrackly → Avis → « 🔖 Bouton avis » sur samtrackly.vercel.app, colle le secret, remplace l'ancien favori.

- [ ] **Step 4: Premier envoi réel, une seule réponse** — choisir avec l'utilisateur UN avis dans « À répondre », le valider, cliquer sur le favori dans le portail Glovo, vérifier : fenêtre « Réponses Glovo : 1 envoyée », statut `envoyee` en base, réponse visible dans le portail sous l'avis. Seulement ensuite, valider les autres.

- [ ] **Step 5: Mettre à jour la mémoire** `reponses-avis-glovo.md` (publié, EAS id, premier envoi vérifié).
