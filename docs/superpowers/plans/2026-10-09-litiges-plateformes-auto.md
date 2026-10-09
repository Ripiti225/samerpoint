# Litiges Yango / Glovo automatiques — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer automatiquement les litiges tapé −, tapé +, remboursement et temps d'attente de Litiges → Yango / Glovo en comparant, plat par plat et jour par jour, les ventes partenaires du POS aux historiques des portails.

**Architecture:** Le favori « Avis → Samtrackly » lit en plus les commandes des portails et les passe au relais, qui les envoie à une nouvelle Edge Function `ingest-commandes-plateformes`. Cette fonction range les commandes (`commandes_plateformes`), relit le POS cloud (comme `import-contacts-pos`), appelle le calcul pur `lib/litigesPlateformes.js` et écrit les litiges dans `litiges_yango` / `litiges_glovo`. L'app gagne un écran Correspondances et, dans Litiges, la pastille « auto », le détail et le bouton Annuler.

**Tech Stack:** Expo Router (React Native web), Supabase (Postgres + Edge Functions Deno), `node:test` pour les tests purs, favori Chrome en JavaScript ES5+ sans dépendance.

Conception : `docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md`.

## Global Constraints

- Toute l'interface et tous les messages en **français courant**, jamais de code technique affiché.
- Montants en **FCFA entiers** (`Math.round`), jamais de flottant stocké.
- Journée = **minuit → minuit**, heure d'Abidjan = UTC (`toISOString()` suffit).
- **Seuil 1 000 F** par sens (tapé + / tapé −), par restaurant × plateforme × jour.
- Plateforme côté POS : `commandes.partenaire` = `'YANGO'` / `'GLOVO'`, statut `PAYEE`, lignes `commande_items` non annulées (`annule_par IS NULL`).
- Côté plateforme, vendues = livrées + **Yango annulées avec montant payé > 0**.
- Premier passage : **à partir d'hier**, pas d'historique antérieur.
- Un litige auto annulé **ne revient jamais**.
- L'auto **remplace** les saisies manuelles du même restaurant × jour × type quand il a calculé ce type.
- Supabase coupe à **1 000 lignes** : toute lecture potentiellement longue est paginée (`.order()` + `.range()`).
- Projet Supabase Samtrackly = `wlwotzxnzowbkbfcpnyi` ; POS cloud = `vbsmxwlxlcgkodwkbhfa` (lecture seule ici). Tout déploiement de fonction passe `--project-ref wlwotzxnzowbkbfcpnyi`.
- git : préfixer par `DEVELOPER_DIR=/Library/Developer/CommandLineTools`. Commits conventionnels en français. Commit + push à chaque tâche ; **Vercel + EAS seulement à la toute fin** (tâche 11).
- Ne jamais lancer `expo start` / localhost soi-même : vérifier par tests, lint, export web.
- Après modification de code : `graphify update .`.
- Toute question à Ange passe par `AskUserQuestion` (QCM).

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `supabase_litiges_plateformes_auto.sql` (créé) | Tables et colonnes nouvelles |
| `lib/litigesPlateformes.js` (créé) | Calcul pur : normalisation, comparaison d'une journée, retenues, plan d'écriture, proposition de correspondance |
| `lib/litigesPlateformes.test.mjs` (créé) | Tests du calcul |
| `lib/fixtures/commandes-glovo.json`, `lib/fixtures/commandes-yango.json` (créés, tâche 0) | Réponses brutes des portails anonymisées |
| `public/bouton-avis.js` (modifié) | Lecture des commandes sur les portails + conversion |
| `lib/boutonAvis.test.mjs` (modifié) | Tests des conversions de commandes |
| `public/envoi-avis.js`, `public/envoi-avis.html` (modifiés) | Relais : envoi des commandes à la 2e fonction |
| `supabase/functions/ingest-commandes-plateformes/index.ts` (créé) | Ingestion + lecture POS + écriture des litiges |
| `app/correspondances-plats.js` (créé) | Écran manager de correspondances |
| `app/litiges.js` (modifié) | Pastille auto, détail, Annuler, bandeau « à relier » |

---

### Task 0: Repérage des portails (avec Ange, dans Chrome)

**But :** savoir exactement où les portails donnent les commandes, leurs plats, le montant payé des annulées Yango, les remboursements et les pénalités d'attente. **Aucune ligne de code de la tâche 5 ne s'écrit avant la fin de cette tâche.**

**Files:**
- Create: `lib/fixtures/commandes-glovo.json`, `lib/fixtures/commandes-yango.json`
- Create: `docs/superpowers/specs/2026-10-09-portails-commandes-notes.md`

- [ ] **Step 1: Ouvrir Chrome avec Ange.** Charger les outils claude-in-chrome (un seul ToolSearch : `tabs_context_mcp, navigate, read_page, tabs_create_mcp, read_network_requests, javascript_tool, get_page_text`). Demander à Ange (AskUserQuestion) d'être connecté à `portal.glovoapp.com` et `vendor.yango.com`.

- [ ] **Step 2: Glovo.** Ouvrir la page historique des commandes du portail. Avec `read_network_requests`, relever l'appel qui liste les commandes (URL, méthode, corps, pagination, plafond de période) et l'appel détail d'une commande (le moteur des avis utilise déjà `GetOrderDetails` sur vagw-api : vérifier s'il donne les produits et quantités). Relever : n° long, heure, statut, montant payé au restaurant, boutique, produits (nom, quantité, prix), remboursement retenu, pénalité d'attente. **Ne jamais lire ni copier le jeton** : le moteur réutilise le Bearer de `persist:root` comme pour les avis.

- [ ] **Step 3: Yango.** Même travail sur `vendor.yango.com` (historique des commandes). Rappel : CSP bloque les appels sortants (d'où le relais) ; on réutilise la `Request` modèle de la page comme `lireYango`. Vérifier en particulier, pour une commande **annulée**, le champ qui porte le montant versé au restaurant.

- [ ] **Step 4: Enregistrer les fixtures.** Pour chaque plateforme, copier la réponse brute d'une page de liste + 2 détails (dont 1 annulée pour Yango, 1 avec remboursement si possible) dans `lib/fixtures/commandes-<plateforme>.json`, en remplaçant noms de clients, téléphones et adresses par `"ANONYME"`.

- [ ] **Step 5: Écrire les notes** dans `docs/superpowers/specs/2026-10-09-portails-commandes-notes.md` : URL et forme des appels, champs retenus pour chaque élément du format normalisé (voir tâche 5), plafond de période, et pour chaque plateforme si `remboursement` et `temps_attente` sont fournis (ce qui fixe `RETENUES_FOURNIES` en tâche 4).

- [ ] **Step 6: Point d'arrêt.** Si une donnée manque (ex. pas de produits, pas de montant payé sur les annulées), poser la question à Ange (AskUserQuestion) avant de continuer.

- [ ] **Step 7: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/fixtures docs/superpowers/specs/2026-10-09-portails-commandes-notes.md
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "docs(litiges): repérage des commandes Glovo/Yango sur les portails"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 1: Migration SQL

**Files:**
- Create: `supabase_litiges_plateformes_auto.sql`

**Interfaces:**
- Produces: tables `commandes_plateformes`, `correspondances_plats`, `plats_pos_vus`, `litiges_auto_annules`, `journees_litiges_plateformes` ; colonnes `origine`, `cle_auto`, `detail` sur `litiges_yango` et `litiges_glovo`.

- [ ] **Step 1: Écrire la migration**

```sql
-- =====================================================================
--  LITIGES YANGO / GLOVO AUTOMATIQUES
--  docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
--  Idempotent. À passer dans le SQL Editor du projet Samtrackly.
-- =====================================================================

-- Commandes lues sur les portails par le favori (une ligne par commande).
CREATE TABLE IF NOT EXISTS commandes_plateformes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme       TEXT NOT NULL CHECK (plateforme IN ('glovo', 'yango')),
  numero           TEXT NOT NULL,
  boutique         TEXT,
  restaurant_id    UUID REFERENCES restaurants(id),
  commande_le      TIMESTAMPTZ NOT NULL,
  jour             DATE NOT NULL,
  statut           TEXT NOT NULL CHECK (statut IN ('livree', 'annulee', 'autre')),
  montant_paye     INTEGER,
  rembourse        INTEGER NOT NULL DEFAULT 0,
  penalite_attente INTEGER NOT NULL DEFAULT 0,
  lignes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  recu_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plateforme, numero)
);
CREATE INDEX IF NOT EXISTS idx_cmd_plateformes_jour ON commandes_plateformes (restaurant_id, plateforme, jour);

-- Nom de plat plateforme → nom de plat POS (ou ignorer).
CREATE TABLE IF NOT EXISTS correspondances_plats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme     TEXT NOT NULL CHECK (plateforme IN ('glovo', 'yango')),
  nom_norm       TEXT NOT NULL,
  nom_plateforme TEXT NOT NULL,
  nom_pos        TEXT,
  ignorer        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plateforme, nom_norm),
  CHECK (ignorer OR nom_pos IS NOT NULL)
);

-- Noms de plats vus dans le POS sur les commandes partenaires.
CREATE TABLE IF NOT EXISTS plats_pos_vus (
  nom_norm TEXT PRIMARY KEY,
  nom      TEXT NOT NULL,
  ignorer  BOOLEAN NOT NULL DEFAULT false,
  vu_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Litiges auto annulés par le manager : jamais recréés.
CREATE TABLE IF NOT EXISTS litiges_auto_annules (
  cle_auto   TEXT PRIMARY KEY,
  plateforme TEXT NOT NULL,
  copie      JSONB NOT NULL,
  annule_par TEXT,
  annule_le  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- État du calcul par restaurant × plateforme × jour.
CREATE TABLE IF NOT EXISTS journees_litiges_plateformes (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  plateforme    TEXT NOT NULL,
  jour          DATE NOT NULL,
  statut        TEXT NOT NULL CHECK (statut IN ('calculee', 'a_relier', 'pos_manquant')),
  noms_inconnus TEXT[] NOT NULL DEFAULT '{}',
  calcule_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, plateforme, jour)
);

ALTER TABLE litiges_yango ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE litiges_yango ADD COLUMN IF NOT EXISTS cle_auto TEXT;
ALTER TABLE litiges_yango ADD COLUMN IF NOT EXISTS detail JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_litiges_yango_cle_auto ON litiges_yango (cle_auto) WHERE cle_auto IS NOT NULL;

ALTER TABLE litiges_glovo ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE litiges_glovo ADD COLUMN IF NOT EXISTS cle_auto TEXT;
ALTER TABLE litiges_glovo ADD COLUMN IF NOT EXISTS detail JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_litiges_glovo_cle_auto ON litiges_glovo (cle_auto) WHERE cle_auto IS NOT NULL;

-- Même posture que les autres tables de l'app (clé anon, RLS ouvert) :
-- l'app lit tout, écrit les correspondances, les plats ignorés et les annulations.
ALTER TABLE commandes_plateformes ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondances_plats ENABLE ROW LEVEL SECURITY;
ALTER TABLE plats_pos_vus ENABLE ROW LEVEL SECURITY;
ALTER TABLE litiges_auto_annules ENABLE ROW LEVEL SECURITY;
ALTER TABLE journees_litiges_plateformes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY lecture ON commandes_plateformes FOR SELECT USING (true);
  CREATE POLICY tout ON correspondances_plats FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY tout ON plats_pos_vus FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY tout ON litiges_auto_annules FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY lecture ON journees_litiges_plateformes FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Demander l'accord d'Ange** (AskUserQuestion : « Passer la migration sur la base Samtrackly maintenant ? »). Sur oui, l'appliquer avec `mcp__claude_ai_Supabase__apply_migration` (project_id `wlwotzxnzowbkbfcpnyi`, name `litiges_plateformes_auto`).

- [ ] **Step 3: Vérifier**

```sql
select table_name from information_schema.tables where table_schema='public'
  and table_name in ('commandes_plateformes','correspondances_plats','plats_pos_vus','litiges_auto_annules','journees_litiges_plateformes');
select column_name from information_schema.columns where table_name='litiges_glovo' and column_name in ('origine','cle_auto','detail');
```
Expected: 5 tables, 3 colonnes.

- [ ] **Step 4: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add supabase_litiges_plateformes_auto.sql
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): tables des litiges plateformes automatiques"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 2: Calcul pur — briques de base

**Files:**
- Create: `lib/litigesPlateformes.js`
- Create: `lib/litigesPlateformes.test.mjs`

**Interfaces:**
- Produces:
  - `SEUIL_LITIGE = 1000`
  - `normaliserNom(s: string) → string` (minuscules, sans accents, ponctuation → espace, espaces compactés)
  - `quatreChiffres(ref: string|null) → string|null` (4 derniers chiffres, `null` si moins de 4 chiffres)
  - `compteCommeVendue(c: { plateforme, statut, montant_paye }) → boolean`
  - `jourDe(iso) → 'AAAA-MM-JJ'`, `heureDe(iso) → 'HH:MM'`
  - `proposerCorrespondance(nomPlateforme: string, nomsPos: string[]) → string|null`

- [ ] **Step 1: Écrire les tests**

```js
// Tests de lib/litigesPlateformes.js — litiges Yango/Glovo automatiques.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliserNom, quatreChiffres, compteCommeVendue, jourDe, heureDe, proposerCorrespondance,
} from './litigesPlateformes.js'

describe('normaliserNom', () => {
  test('minuscules, sans accents ni ponctuation', () => {
    assert.equal(normaliserNom('  Chawarma Poulet — XL ! '), 'chawarma poulet xl')
    assert.equal(normaliserNom('Thé glacé'), 'the glace')
    assert.equal(normaliserNom(null), '')
  })
})

describe('quatreChiffres', () => {
  test('garde les 4 derniers chiffres', () => {
    assert.equal(quatreChiffres('101791205516'), '5516')
    assert.equal(quatreChiffres(' 5516 '), '5516')
    assert.equal(quatreChiffres('YG-2510-0042'), '0042')
  })
  test('moins de 4 chiffres ou vide : null', () => {
    assert.equal(quatreChiffres('42'), null)
    assert.equal(quatreChiffres(''), null)
    assert.equal(quatreChiffres(null), null)
  })
})

describe('compteCommeVendue', () => {
  test('livrée : vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'glovo', statut: 'livree' }), true)
  })
  test('Yango annulée mais payée : vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: 4500 }), true)
  })
  test('Yango annulée sans paiement : pas vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: 0 }), false)
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'annulee', montant_paye: null }), false)
  })
  test('Glovo annulée : jamais vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'glovo', statut: 'annulee', montant_paye: 4500 }), false)
  })
  test('autre statut : pas vendue', () => {
    assert.equal(compteCommeVendue({ plateforme: 'yango', statut: 'autre' }), false)
  })
})

describe('jourDe / heureDe — Abidjan = UTC', () => {
  test('découpe une date ISO', () => {
    assert.equal(jourDe('2026-10-08T23:59:00Z'), '2026-10-08')
    assert.equal(jourDe('2026-10-08T23:59:00.000+00:00'), '2026-10-08')
    assert.equal(heureDe('2026-10-08T14:07:31Z'), '14:07')
  })
})

describe('proposerCorrespondance', () => {
  const nomsPos = ['Chawarma poulet', 'Chawarma viande', 'Pizza reine', 'Coca 33cl']
  test('le nom POS le plus proche', () => {
    assert.equal(proposerCorrespondance('Chawarma Poulet XL', nomsPos), 'Chawarma poulet')
    assert.equal(proposerCorrespondance('PIZZA REINE', nomsPos), 'Pizza reine')
  })
  test('rien de ressemblant : null', () => {
    assert.equal(proposerCorrespondance('Burger double', nomsPos), null)
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node lib/litigesPlateformes.test.mjs`
Expected: FAIL (`Cannot find module './litigesPlateformes.js'`).

- [ ] **Step 3: Écrire le code**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Litiges Yango / Glovo automatiques — calcul pur.
// docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
//
// On compare, plat par plat et jour par jour (minuit → minuit, Abidjan = UTC),
// les ventes partenaires tapées dans le POS aux commandes vendues sur le
// portail. Plat en trop dans le POS → tapé + (repère la vente sur place
// déclarée Yango/Glovo) ; plat en moins → tapé −.
// Utilisé par l'Edge Function ingest-commandes-plateformes.
// Pur : testé par lib/litigesPlateformes.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
import { caissierAuMoment } from './attributionAvis.js'

export const SEUIL_LITIGE = 1000

export function normaliserNom(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** « 101791205516 » → « 5516 » : ce que le caissier tape dans le POS. */
export function quatreChiffres(ref) {
  const chiffres = String(ref ?? '').replace(/\D/g, '')
  return chiffres.length >= 4 ? chiffres.slice(-4) : null
}

/** Livrée, ou Yango annulée mais payée au restaurant. */
export function compteCommeVendue(c) {
  if (c.statut === 'livree') return true
  return c.statut === 'annulee' && c.plateforme === 'yango' && (Number(c.montant_paye) || 0) > 0
}

export const jourDe = iso => new Date(iso).toISOString().slice(0, 10)
export const heureDe = iso => new Date(iso).toISOString().slice(11, 16)

const mots = s => new Set(normaliserNom(s).split(' ').filter(Boolean))

/** Nom POS le plus proche (mots communs / mots en tout ≥ 0,5), sinon null. */
export function proposerCorrespondance(nomPlateforme, nomsPos) {
  const a = mots(nomPlateforme)
  let meilleur = null, score = 0
  for (const nom of nomsPos || []) {
    const b = mots(nom)
    const communs = [...a].filter(m => b.has(m)).length
    const s = communs / (new Set([...a, ...b]).size || 1)
    if (s > score) { score = s; meilleur = nom }
  }
  return score >= 0.5 ? meilleur : null
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `node lib/litigesPlateformes.test.mjs`
Expected: tous les tests `ok`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/litigesPlateformes.js lib/litigesPlateformes.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): briques du calcul des litiges plateformes"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 3: Calcul pur — comparer une journée (tapé + / tapé −)

**Files:**
- Modify: `lib/litigesPlateformes.js` (ajout en fin de fichier)
- Modify: `lib/litigesPlateformes.test.mjs` (ajout en fin de fichier)

**Interfaces:**
- Consumes: briques de la tâche 2 ; `caissierAuMoment(shifts, { restaurantId, date, heure })` de `lib/attributionAvis.js` → `{ caissier_id, caissier_nom, raison }` (`caissier_id: null` si ambigu).
- Produces: `comparerJournee(e) → { statut: 'calculee'|'a_relier'|'pos_manquant', nomsInconnus: string[], litiges: Litige[] }` avec
  - `e = { plateforme, restaurantId, jour, posPresent, seuil?, commandesPlateforme, commandesPos, correspondances, posIgnores, prixReference, shifts }`
  - `commandesPlateforme: [{ plateforme, numero, commande_le, statut, montant_paye, lignes: [{ nom, quantite, prix_unitaire }] }]`
  - `commandesPos: [{ id, numero_ticket, ref_partenaire, created_at, caissier_id, caissier_nom, items: [{ nom, quantite, prix_unitaire }] }]`
  - `correspondances: Map<nom_norm plateforme, { nom_pos: string|null, ignorer: boolean }>`
  - `posIgnores: Set<nom_norm POS>`
  - `prixReference: { [nom_norm POS]: number }`
  - `Litige = { type, montant, responsable_id, responsable_nom, cle_auto, numero_commande, notes, detail: { lignes: [{ plat, commande, heure, prix }] } }`
  - `cle_auto = plateforme|restaurantId|jour|type|cleResponsable` où `cleResponsable` = `id:<uuid>` sinon `nom:<nom minuscule>` sinon `personne`.

- [ ] **Step 1: Écrire les tests**

```js
import { comparerJournee } from './litigesPlateformes.js'

const RESTO = 'resto-1'
const JOUR = '2026-10-08'
const SHIFTS = [
  { restaurant_id: RESTO, date: JOUR, caissier_id: 'awa', caissier_nom: 'Awa', heure_debut: '08:00', heure_fin: '16:00' },
  { restaurant_id: RESTO, date: JOUR, caissier_id: 'koffi', caissier_nom: 'Koffi', heure_debut: '16:00', heure_fin: '23:59' },
]
const CORR = new Map([
  ['chawarma poulet xl', { nom_pos: 'Chawarma poulet', ignorer: false }],
  ['coca cola 33cl', { nom_pos: 'Coca', ignorer: false }],
  ['sauce blanche', { nom_pos: null, ignorer: true }],
])
const pf = (numero, heure, lignes, extra = {}) => ({
  plateforme: 'yango', numero, commande_le: `${JOUR}T${heure}:00Z`, statut: 'livree', montant_paye: 5000, lignes, ...extra,
})
const pos = (id, ref, heure, caissier, items) => ({
  id, numero_ticket: Number(id.replace(/\D/g, '')) || 1, ref_partenaire: ref, created_at: `${JOUR}T${heure}:00Z`,
  caissier_id: caissier, caissier_nom: caissier === 'awa' ? 'Awa' : 'Koffi', items,
})
const base = over => ({
  plateforme: 'yango', restaurantId: RESTO, jour: JOUR, posPresent: true,
  commandesPlateforme: [], commandesPos: [], correspondances: CORR, posIgnores: new Set(),
  prixReference: { 'chawarma poulet': 3000, coca: 1000 }, shifts: SHIFTS, ...over,
})

describe('comparerJournee', () => {
  test('mêmes plats des deux côtés : aucun litige, même tapés en retard', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Chawarma Poulet XL', quantite: 2, prix_unitaire: 3500 }])],
      commandesPos: [pos('c1', '1234', '15:30', 'awa', [{ nom: 'Chawarma poulet', quantite: 2, prix_unitaire: 3000 }])],
    }))
    assert.equal(r.statut, 'calculee')
    assert.deepEqual(r.litiges, [])
  })

  test('tapé + : commande POS sans équivalent plateforme → caissier qui l’a tapée', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }])],
      commandesPos: [
        pos('c1', '1234', '12:05', 'awa', [{ nom: 'Chawarma poulet', quantite: 1, prix_unitaire: 3000 }]),
        pos('c2', '7777', '18:00', 'koffi', [{ nom: 'Chawarma poulet', quantite: 2, prix_unitaire: 3000 }]),
      ],
    }))
    assert.equal(r.litiges.length, 1)
    const l = r.litiges[0]
    assert.equal(l.type, 'tape_plus')
    assert.equal(l.montant, 6000)
    assert.equal(l.responsable_id, 'koffi')
    assert.equal(l.cle_auto, `yango|${RESTO}|${JOUR}|tape_plus|id:koffi`)
    assert.equal(l.numero_commande, '7777')
    assert.equal(l.detail.lignes.length, 2)
  })

  test('tapé − : commande plateforme absente du POS → caissier présent à son heure', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [
        pf('900001234', '12:00', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }]),
        pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }]),
      ],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Chawarma poulet', quantite: 1, prix_unitaire: 3000 }])],
    }))
    assert.equal(r.litiges.length, 1)
    assert.equal(r.litiges[0].type, 'tape_moins')
    assert.equal(r.litiges[0].montant, 3000)
    assert.equal(r.litiges[0].responsable_id, 'koffi')
    assert.equal(r.litiges[0].numero_commande, '900005678')
  })

  test('prix du plat manquant : prix POS du jour, sinon prix de référence, sinon prix plateforme', () => {
    const r = comparerJournee(base({
      prixReference: {},
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Coca Cola 33cl', quantite: 1, prix_unitaire: 1500 }])],
      commandesPos: [pos('c9', '0001', '10:00', 'awa', [{ nom: 'Chawarma poulet', quantite: 1, prix_unitaire: 3000 }])],
    }))
    // Coca : aucun prix POS → prix plateforme 1500 ; chawarma POS sans équivalent → tapé + 3000
    const moins = r.litiges.find(l => l.type === 'tape_moins')
    assert.equal(moins.montant, 1500)
  })

  test('sous le seuil de 1 000 F : rien', () => {
    const r = comparerJournee(base({
      prixReference: { coca: 500 },
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Coca Cola 33cl', quantite: 1, prix_unitaire: 500 }])],
    }))
    assert.deepEqual(r.litiges, [])
  })

  test('Yango annulée mais payée : compte comme vendue', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }], { statut: 'annulee', montant_paye: 3000 })],
    }))
    assert.equal(r.litiges[0].type, 'tape_moins')
  })

  test('annulée non payée : ignorée', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }], { statut: 'annulee', montant_paye: 0 })],
    }))
    assert.deepEqual(r.litiges, [])
  })

  test('plat plateforme non relié : journée à relier, aucun litige', () => {
    const r = comparerJournee(base({
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Burger double', quantite: 1, prix_unitaire: 4000 }])],
    }))
    assert.equal(r.statut, 'a_relier')
    assert.deepEqual(r.nomsInconnus, ['Burger double'])
    assert.deepEqual(r.litiges, [])
  })

  test('plat plateforme « ignorer » et plat POS ignoré : hors comparaison', () => {
    const r = comparerJournee(base({
      posIgnores: new Set(['frites']),
      commandesPlateforme: [pf('900001234', '12:00', [{ nom: 'Sauce blanche', quantite: 3, prix_unitaire: 0 }])],
      commandesPos: [pos('c1', '1234', '12:05', 'awa', [{ nom: 'Frites', quantite: 2, prix_unitaire: 1000 }])],
    }))
    assert.deepEqual(r.litiges, [])
  })

  test('POS absent ce jour-là : pos_manquant, aucun litige', () => {
    const r = comparerJournee(base({
      posPresent: false,
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.equal(r.statut, 'pos_manquant')
    assert.deepEqual(r.litiges, [])
  })

  test('heure ambiguë : litige sans responsable', () => {
    const r = comparerJournee(base({
      shifts: [],
      commandesPlateforme: [pf('900005678', '17:30', [{ nom: 'Chawarma Poulet XL', quantite: 1, prix_unitaire: 3500 }])],
    }))
    assert.equal(r.litiges[0].responsable_id, null)
    assert.equal(r.litiges[0].cle_auto, `yango|${RESTO}|${JOUR}|tape_moins|personne`)
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node lib/litigesPlateformes.test.mjs`
Expected: FAIL (`comparerJournee` n'est pas exporté).

- [ ] **Step 3: Écrire le code** (ajouter en fin de `lib/litigesPlateformes.js`)

```js
// Une entrée par unité vendue : 2 chawarmas → 2 entrées.
function empiler(m, cle, quantite, unite) {
  const q = Math.max(0, Math.round(Number(quantite) || 0))
  if (!m.has(cle)) m.set(cle, [])
  for (let i = 0; i < q; i++) m.get(cle).push(unite)
}

function cleResponsable(r) {
  if (r.id) return `id:${r.id}`
  const nom = String(r.nom || '').trim().toLowerCase()
  return nom ? `nom:${nom}` : 'personne'
}

// Prix POS du canal : moyenne des lignes POS du jour, sinon prix de référence
// (dernier prix POS connu), sinon prix plateforme.
function prixPlat(cle, unitesPos, prixReference, unitesPf) {
  const prixPos = unitesPos.map(u => Number(u.prix) || 0).filter(p => p > 0)
  if (prixPos.length) return Math.round(prixPos.reduce((s, p) => s + p, 0) / prixPos.length)
  const ref = Number(prixReference?.[cle]) || 0
  if (ref > 0) return Math.round(ref)
  const prixPf = unitesPf.map(u => Number(u.prix) || 0).filter(p => p > 0)
  return prixPf.length ? Math.round(prixPf[0]) : 0
}

/** Compare une journée restaurant × plateforme. Voir l'interface dans le plan. */
export function comparerJournee(e) {
  const seuil = e.seuil ?? SEUIL_LITIGE
  if (!e.posPresent) return { statut: 'pos_manquant', nomsInconnus: [], litiges: [] }

  const vendues = (e.commandesPlateforme || []).filter(compteCommeVendue)
  const inconnus = new Set()
  const cotePf = new Map()
  for (const c of vendues) {
    for (const l of c.lignes || []) {
      const corr = e.correspondances?.get(normaliserNom(l.nom))
      if (!corr) { inconnus.add(l.nom); continue }
      if (corr.ignorer || !corr.nom_pos) continue
      empiler(cotePf, normaliserNom(corr.nom_pos), l.quantite, { commande: c, libelle: corr.nom_pos, prix: l.prix_unitaire })
    }
  }
  if (inconnus.size) return { statut: 'a_relier', nomsInconnus: [...inconnus].sort(), litiges: [] }

  const cotePos = new Map()
  for (const c of e.commandesPos || []) {
    for (const it of c.items || []) {
      const cle = normaliserNom(it.nom)
      if (e.posIgnores?.has(cle)) continue
      empiler(cotePos, cle, it.quantite, { commande: c, libelle: it.nom, prix: it.prix_unitaire })
    }
  }

  const refsPf = new Set(vendues.map(c => quatreChiffres(c.numero)).filter(Boolean))
  const refsPos = new Set((e.commandesPos || []).map(c => quatreChiffres(c.ref_partenaire)).filter(Boolean))
  const temps = iso => Date.parse(iso) || 0

  const groupes = new Map()
  const ajouter = (type, resp, prix, ligne) => {
    const cle = `${e.plateforme}|${e.restaurantId}|${e.jour}|${type}|${cleResponsable(resp)}`
    if (!groupes.has(cle)) {
      groupes.set(cle, { type, montant: 0, responsable_id: resp.id || null, responsable_nom: resp.nom || null, cle_auto: cle, lignes: [] })
    }
    const g = groupes.get(cle)
    g.montant += prix
    g.lignes.push({ ...ligne, prix })
  }

  for (const cle of new Set([...cotePf.keys(), ...cotePos.keys()])) {
    const uPf = cotePf.get(cle) || [], uPos = cotePos.get(cle) || []
    const ecart = uPos.length - uPf.length
    if (ecart === 0) continue
    const prix = prixPlat(cle, uPos, e.prixReference, uPf)
    if (ecart > 0) {
      // Les plus suspectes d'abord : n° absent chez la plateforme, puis les plus tardives.
      const suspect = u => (refsPf.has(quatreChiffres(u.commande.ref_partenaire)) ? 1 : 0)
      const tri = [...uPos].sort((a, b) => suspect(a) - suspect(b) || temps(b.commande.created_at) - temps(a.commande.created_at))
      for (const u of tri.slice(0, ecart)) {
        ajouter('tape_plus', { id: u.commande.caissier_id, nom: u.commande.caissier_nom }, prix, {
          plat: u.libelle, commande: u.commande.ref_partenaire || `ticket ${u.commande.numero_ticket}`, heure: heureDe(u.commande.created_at),
        })
      }
    } else {
      // Les plus probablement oubliées d'abord : n° absent du POS, puis les plus anciennes.
      const oubliee = u => (refsPos.has(quatreChiffres(u.commande.numero)) ? 1 : 0)
      const tri = [...uPf].sort((a, b) => oubliee(a) - oubliee(b) || temps(a.commande.commande_le) - temps(b.commande.commande_le))
      for (const u of tri.slice(0, -ecart)) {
        const heure = heureDe(u.commande.commande_le)
        const r = caissierAuMoment(e.shifts, { restaurantId: e.restaurantId, date: e.jour, heure })
        ajouter('tape_moins', { id: r.caissier_id, nom: r.caissier_nom }, prix, { plat: u.libelle, commande: u.commande.numero, heure })
      }
    }
  }

  const parType = {}
  for (const g of groupes.values()) parType[g.type] = (parType[g.type] || 0) + g.montant
  const litiges = [...groupes.values()]
    .filter(g => parType[g.type] >= seuil)
    .map(g => ({
      type: g.type,
      montant: Math.round(g.montant),
      responsable_id: g.responsable_id,
      responsable_nom: g.responsable_nom,
      cle_auto: g.cle_auto,
      numero_commande: [...new Set(g.lignes.map(l => l.commande))].join(', ') || null,
      notes: resumePlats(g.lignes),
      detail: { lignes: g.lignes },
    }))
  return { statut: 'calculee', nomsInconnus: [], litiges }
}

/** « 2 × Chawarma poulet, 1 × Coca » */
function resumePlats(lignes) {
  const n = new Map()
  for (const l of lignes) n.set(l.plat, (n.get(l.plat) || 0) + 1)
  return [...n].map(([plat, q]) => `${q} × ${plat}`).join(', ')
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `node lib/litigesPlateformes.test.mjs`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/litigesPlateformes.js lib/litigesPlateformes.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): comparaison plat par plat d'une journée Yango/Glovo"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 4: Calcul pur — remboursements, attente et plan d'écriture

**Files:**
- Modify: `lib/litigesPlateformes.js`, `lib/litigesPlateformes.test.mjs` (ajouts en fin de fichier)

**Interfaces:**
- Consumes: tâches 2 et 3.
- Produces:
  - `RETENUES_FOURNIES: { glovo: string[], yango: string[] }` : types de retenue que chaque portail donne (valeur fixée d'après les notes de la tâche 0 ; défaut ci-dessous).
  - `retenuesJournee({ plateforme, restaurantId, jour, commandesPlateforme, shifts }) → Litige[]` (un litige par commande et par type, `cle_auto = plateforme|restaurantId|jour|type|<numero>`).
  - `planEcriture({ calcules: Litige[], existants: Row[], annules: Set<string>, typesCouverts: string[] }) → { aInserer: Litige[], aMettreAJour: (Litige & { id })[], aSupprimer: string[] /* ids */ }`, où `Row = { id, type, origine, cle_auto, montant, responsable_id, responsable_nom, notes, numero_commande }`.

- [ ] **Step 1: Écrire les tests**

```js
import { retenuesJournee, planEcriture } from './litigesPlateformes.js'

describe('retenuesJournee', () => {
  test('un remboursement et une pénalité → deux litiges au caissier de l’heure', () => {
    const r = retenuesJournee({
      plateforme: 'glovo', restaurantId: RESTO, jour: JOUR, shifts: SHIFTS,
      commandesPlateforme: [
        { plateforme: 'glovo', numero: '101791205516', commande_le: `${JOUR}T13:00:00Z`, statut: 'livree', rembourse: 2500, penalite_attente: 0, lignes: [] },
        { plateforme: 'glovo', numero: '101791209999', commande_le: `${JOUR}T19:00:00Z`, statut: 'livree', rembourse: 0, penalite_attente: 700, lignes: [] },
      ],
    })
    assert.deepEqual(r.map(l => [l.type, l.montant, l.responsable_id, l.numero_commande]), [
      ['remboursement', 2500, 'awa', '101791205516'],
      ['temps_attente', 700, 'koffi', '101791209999'],
    ])
    assert.equal(r[0].cle_auto, `glovo|${RESTO}|${JOUR}|remboursement|101791205516`)
  })
})

describe('planEcriture', () => {
  const calcule = { type: 'tape_plus', montant: 6000, responsable_id: 'koffi', responsable_nom: 'Koffi', cle_auto: 'k1', numero_commande: '7777', notes: '2 × Chawarma poulet', detail: { lignes: [] } }

  test('nouveau litige : inséré', () => {
    const p = planEcriture({ calcules: [calcule], existants: [], annules: new Set(), typesCouverts: ['tape_plus', 'tape_moins'] })
    assert.deepEqual(p.aInserer.map(l => l.cle_auto), ['k1'])
    assert.deepEqual(p.aSupprimer, [])
  })
  test('litige annulé par le manager : jamais recréé', () => {
    const p = planEcriture({ calcules: [calcule], existants: [], annules: new Set(['k1']), typesCouverts: ['tape_plus'] })
    assert.deepEqual(p.aInserer, [])
  })
  test('déjà là, montant changé : mis à jour', () => {
    const p = planEcriture({
      calcules: [calcule], annules: new Set(), typesCouverts: ['tape_plus'],
      existants: [{ id: 'x', type: 'tape_plus', origine: 'auto', cle_auto: 'k1', montant: 3000, responsable_id: 'koffi', responsable_nom: 'Koffi', notes: '1 × Chawarma poulet', numero_commande: '7777' }],
    })
    assert.deepEqual(p.aMettreAJour.map(l => [l.id, l.montant]), [['x', 6000]])
    assert.deepEqual(p.aInserer, [])
  })
  test('auto qui n’a plus lieu d’être : supprimé', () => {
    const p = planEcriture({
      calcules: [], annules: new Set(), typesCouverts: ['tape_plus'],
      existants: [{ id: 'x', type: 'tape_plus', origine: 'auto', cle_auto: 'k1', montant: 3000 }],
    })
    assert.deepEqual(p.aSupprimer, ['x'])
  })
  test('l’auto remplace la saisie manuelle du même type, pas des autres types', () => {
    const p = planEcriture({
      calcules: [calcule], annules: new Set(), typesCouverts: ['tape_plus', 'tape_moins'],
      existants: [
        { id: 'm1', type: 'tape_plus', origine: 'manuel', cle_auto: null, montant: 5000 },
        { id: 'm2', type: 'temps_attente', origine: 'manuel', cle_auto: null, montant: 500 },
      ],
    })
    assert.deepEqual(p.aSupprimer, ['m1'])
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node lib/litigesPlateformes.test.mjs`
Expected: FAIL (`retenuesJournee` n'est pas exporté).

- [ ] **Step 3: Écrire le code** (ajouter en fin de `lib/litigesPlateformes.js`)

```js
// Retenues que chaque portail donne (repérage du 09/10, tâche 0). Un type
// absent ici n'est jamais calculé, donc jamais remplacé : la saisie manuelle
// reste la seule source pour lui.
export const RETENUES_FOURNIES = {
  glovo: ['remboursement', 'temps_attente'],
  yango: ['remboursement', 'temps_attente'],
}

const CHAMP_RETENUE = { remboursement: 'rembourse', temps_attente: 'penalite_attente' }

/** Un litige par commande et par retenue, au caissier présent à l'heure de la commande. */
export function retenuesJournee({ plateforme, restaurantId, jour, commandesPlateforme, shifts }) {
  const litiges = []
  for (const type of RETENUES_FOURNIES[plateforme] || []) {
    for (const c of commandesPlateforme || []) {
      const montant = Math.round(Number(c[CHAMP_RETENUE[type]]) || 0)
      if (montant <= 0) continue
      const heure = heureDe(c.commande_le)
      const r = caissierAuMoment(shifts, { restaurantId, date: jour, heure })
      litiges.push({
        type, montant,
        responsable_id: r.caissier_id || null,
        responsable_nom: r.caissier_nom || null,
        cle_auto: `${plateforme}|${restaurantId}|${jour}|${type}|${c.numero}`,
        numero_commande: c.numero,
        notes: type === 'remboursement' ? `Remboursé par ${plateforme === 'glovo' ? 'Glovo' : 'Yango'} (commande de ${heure})` : `Pénalité d'attente (commande de ${heure})`,
        detail: { lignes: [{ commande: c.numero, heure, prix: montant }] },
      })
    }
  }
  return litiges
}

const CHAMPS_COMPARES = ['montant', 'responsable_id', 'responsable_nom', 'notes', 'numero_commande']

/**
 * Ce qu'il faut écrire pour un restaurant × plateforme × jour.
 * existants : toutes les lignes litiges_<plateforme> de ce restaurant ce jour-là.
 * typesCouverts : types que l'auto a calculés ce jour-là (il remplace la main).
 */
export function planEcriture({ calcules, existants, annules, typesCouverts }) {
  const couverts = new Set(typesCouverts)
  const voulus = (calcules || []).filter(l => !annules?.has(l.cle_auto))
  const parCle = new Map((existants || []).filter(x => x.origine === 'auto' && x.cle_auto).map(x => [x.cle_auto, x]))
  const aInserer = [], aMettreAJour = []
  for (const l of voulus) {
    const x = parCle.get(l.cle_auto)
    if (!x) { aInserer.push(l); continue }
    if (CHAMPS_COMPARES.some(k => (x[k] ?? null) !== (l[k] ?? null))) aMettreAJour.push({ ...l, id: x.id })
  }
  const clesVoulues = new Set(voulus.map(l => l.cle_auto))
  const aSupprimer = (existants || [])
    .filter(x => couverts.has(x.type))
    .filter(x => (x.origine === 'auto' ? !clesVoulues.has(x.cle_auto) : true))
    .map(x => x.id)
  return { aInserer, aMettreAJour, aSupprimer }
}
```

- [ ] **Step 4: Lancer tous les tests**

Run: `for f in lib/*.test.mjs; do node "$f"; done 2>&1 | grep -E "^# (pass|fail)"`
Expected: aucune ligne `# fail` différente de `# fail 0`.

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/litigesPlateformes.js lib/litigesPlateformes.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): remboursements, attente et plan d'écriture des litiges auto"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 5: Favori — lecture des commandes sur les portails

**Prérequis :** tâche 0 terminée (fixtures + notes). Les champs bruts lus ci-dessous viennent des notes ; les noms marqués `‹champ›` sont à remplacer par ceux relevés en tâche 0 — c'est la seule partie du plan qui dépend des portails.

**Files:**
- Modify: `public/bouton-avis.js`
- Modify: `lib/boutonAvis.test.mjs`

**Interfaces:**
- Produces (exposés par `moteurAvis()`) :
  - `convertirCommandeGlovo(brut) → CommandePlateforme`
  - `convertirCommandeYango(brut) → CommandePlateforme`
  - `periodeCommandes(dernierJour: string|null, maintenant: number, plafondJours: number) → { debut, fin }` : depuis `dernierJour − 2 j`, sinon **hier** ; jamais plus loin que le plafond ; `fin` = aujourd'hui.
  - `CommandePlateforme = { plateforme: 'glovo'|'yango', numero: string, boutique: string, commande_le: ISO, statut: 'livree'|'annulee'|'autre', montant_paye: number|null, rembourse: number, penalite_attente: number, lignes: [{ nom, quantite, prix_unitaire }] }`
  - Le relais reçoit un nouveau message `{ type: 'commandes', commandes: CommandePlateforme[] }`.

- [ ] **Step 1: Écrire les tests** (ajouter à `lib/boutonAvis.test.mjs`, adapter la ligne de destructuration du haut pour inclure `convertirCommandeGlovo, convertirCommandeYango, periodeCommandes`)

```js
const fixturesGlovo = JSON.parse(readFileSync(new URL('./fixtures/commandes-glovo.json', import.meta.url), 'utf8'))
const fixturesYango = JSON.parse(readFileSync(new URL('./fixtures/commandes-yango.json', import.meta.url), 'utf8'))

describe('periodeCommandes — quels jours de commandes relire', () => {
  test('premier passage : depuis hier', () => {
    assert.deepEqual(periodeCommandes(null, MAINTENANT, 30), { debut: '2026-10-09', fin: '2026-10-10' })
  })
  test('ensuite : 2 jours de marge avant le dernier jour reçu', () => {
    assert.deepEqual(periodeCommandes('2026-10-08', MAINTENANT, 30), { debut: '2026-10-06', fin: '2026-10-10' })
  })
  test('jamais au-delà du plafond du portail', () => {
    assert.deepEqual(periodeCommandes('2026-01-01', MAINTENANT, 30), { debut: '2026-09-10', fin: '2026-10-10' })
  })
})

describe('convertirCommandeGlovo / convertirCommandeYango', () => {
  const forme = c => {
    assert.ok(['glovo', 'yango'].includes(c.plateforme))
    assert.match(c.numero, /\d{4,}/)
    assert.ok(!Number.isNaN(Date.parse(c.commande_le)))
    assert.ok(['livree', 'annulee', 'autre'].includes(c.statut))
    assert.ok(Array.isArray(c.lignes) && c.lignes.every(l => l.nom && l.quantite > 0))
    assert.ok(Number.isInteger(c.rembourse) && Number.isInteger(c.penalite_attente))
  }
  test('chaque commande Glovo de la fixture a la bonne forme', () => {
    fixturesGlovo.commandes.map(convertirCommandeGlovo).forEach(forme)
  })
  test('chaque commande Yango de la fixture a la bonne forme', () => {
    fixturesYango.commandes.map(convertirCommandeYango).forEach(forme)
  })
  test('Yango annulée payée : statut annulee et montant_paye > 0', () => {
    const c = fixturesYango.commandes.map(convertirCommandeYango).find(x => x.statut === 'annulee')
    assert.ok(c, 'la fixture Yango doit contenir une commande annulée')
    assert.equal(typeof c.montant_paye, 'number')
  })
})
```

Lors de l'enregistrement des fixtures (tâche 0), les ranger sous la forme `{ "commandes": [ <brut>, ... ] }`.

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node lib/boutonAvis.test.mjs`
Expected: FAIL (`periodeCommandes is not a function`).

- [ ] **Step 3: Écrire le code** dans `moteurAvis()` de `public/bouton-avis.js`, juste après `convertirYango` :

```js
  // ── Commandes (litiges automatiques) ─────────────────────────────────
  // Premier passage : depuis hier. Ensuite 2 jours de marge avant le dernier
  // jour reçu (une commande Yango peut changer de statut le lendemain).
  function periodeCommandes(dernierJour, maintenant, plafondJours) {
    let jour = 86400000
    let fin = jourIso(maintenant)
    let plancher = jourIso(maintenant - plafondJours * jour)
    let debut = dernierJour ? jourIso(Date.parse(dernierJour + 'T00:00:00Z') - 2 * jour) : jourIso(maintenant - jour)
    if (debut < plancher) debut = plancher
    return { debut: debut, fin: fin }
  }

  function entier(v) { let n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0 }

  function convertirCommandeGlovo(b) {
    return {
      plateforme: 'glovo',
      numero: String(b.‹numero›),
      boutique: NOMS_GLOVO[b.‹code_boutique›] || String(b.‹code_boutique›),
      commande_le: new Date(b.‹heure›).toISOString(),
      statut: b.‹statut› === '‹livree›' ? 'livree' : b.‹statut› === '‹annulee›' ? 'annulee' : 'autre',
      montant_paye: b.‹montant_paye› == null ? null : entier(b.‹montant_paye›),
      rembourse: entier(b.‹rembourse›),
      penalite_attente: entier(b.‹penalite›),
      lignes: (b.‹produits› || []).map(function (p) {
        return { nom: String(p.‹nom›), quantite: entier(p.‹quantite›), prix_unitaire: entier(p.‹prix›) }
      }).filter(function (l) { return l.nom && l.quantite > 0 }),
    }
  }

  function convertirCommandeYango(b) {
    return {
      plateforme: 'yango',
      numero: String(b.‹numero›),
      boutique: String(b.‹libelle_boutique_complet›), // adresse comprise, comme pour les avis
      commande_le: new Date(b.‹heure›).toISOString(),
      statut: b.‹statut› === '‹livree›' ? 'livree' : b.‹statut› === '‹annulee›' ? 'annulee' : 'autre',
      montant_paye: b.‹montant_paye› == null ? null : entier(b.‹montant_paye›),
      rembourse: entier(b.‹rembourse›),
      penalite_attente: entier(b.‹penalite›),
      lignes: (b.‹produits› || []).map(function (p) {
        return { nom: String(p.‹nom›), quantite: entier(p.‹quantite›), prix_unitaire: entier(p.‹prix›) }
      }).filter(function (l) { return l.nom && l.quantite > 0 }),
    }
  }
```

Puis écrire `lireCommandesGlovo(periode, info)` et `lireCommandesYango(periode, info, modele)` sur le modèle exact de `lireGlovo` / `lireYango` (même jeton Glovo, même `Request` modèle Yango, pagination relevée en tâche 0, `info('Commandes ' + nom + ' : ' + n + ' lues')` toutes les pages), qui renvoient le tableau des commandes converties.

Dans `lancer(cfg)`, après l'envoi des avis :

```js
      let derniersCommandes = reponse.commandes && reponse.commandes[plateforme]
      let periodeCmd = periodeCommandes(derniersCommandes ? derniersCommandes.jour : null, Date.now(), PLAFOND_JOURS[plateforme])
      info('Lecture des commandes ' + nom + ' du ' + frDate(periodeCmd.debut) + ' au ' + frDate(periodeCmd.fin) + '…')
      let commandes = plateforme === 'glovo'
        ? await lireCommandesGlovo(periodeCmd, info)
        : await lireCommandesYango(periodeCmd, info, avis.modele)
      fen.postMessage({ type: 'commandes', commandes: commandes }, cfg.origine)
```

Si la lecture des commandes échoue, les avis restent envoyés : entourer ce bloc d'un `try/catch` qui affiche « Les avis sont partis, mais la lecture des commandes n'a pas abouti : clique à nouveau dans quelques minutes. »

Exposer `periodeCommandes`, `convertirCommandeGlovo`, `convertirCommandeYango` dans l'objet retourné par `moteurAvis()`.

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `node lib/boutonAvis.test.mjs`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add public/bouton-avis.js lib/boutonAvis.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(bouton-avis): lecture des commandes Glovo/Yango pour les litiges"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 6: Relais — envoyer les commandes à la nouvelle fonction

**Files:**
- Modify: `public/envoi-avis.js`
- Modify: `public/envoi-avis.html:24`

**Interfaces:**
- Consumes: message `{ type: 'commandes', commandes }` (tâche 5) ; fonction `ingest-commandes-plateformes` (tâche 7) : `GET → { derniers: { glovo: { jour }, yango: { jour } } }`, `POST { commandes } → { recues, inserees, a_rattacher, journees, litiges }`.
- Produces: le message `derniers` renvoyé au portail porte en plus `commandes: { glovo: { jour }, yango: { jour } }`.

- [ ] **Step 1: Modifier `demarrer`** pour accepter une 2e adresse : `demarrer(urlFonction, urlCommandes)`.

Dans la branche `config`, après la lecture des avis, lire aussi les derniers jours de commandes et les joindre :

```js
          let derniersCommandes = {}
          try {
            const rc = await fetch(urlCommandes, { headers: { 'x-ingest-secret': secret } })
            if (rc.ok) derniersCommandes = (await rc.json()).derniers || {}
          } catch (_e) { /* les avis passent quand même */ }
          portail.postMessage({ type: 'derniers', derniers: j.derniers || {}, commandes: derniersCommandes }, e.origin)
```

(Remplace l'actuel `portail.postMessage({ type: 'derniers', derniers: j.derniers || {} }, e.origin)`.)

Ajouter la branche :

```js
      } else if (e.data.type === 'commandes' && secret && p === plateforme) {
        const commandes = Array.isArray(e.data.commandes) ? e.data.commandes : []
        afficher('Envoi de ' + commandes.length + ' commandes ' + NOMS[p] + ' et calcul des litiges…')
        try {
          const envoi = await fetch(urlCommandes, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
            body: JSON.stringify({ commandes: commandes }),
          })
          if (!envoi.ok) { afficher(messageHttp(envoi.status), 'erreur'); return }
          const r = await envoi.json()
          afficher(commandes.length + ' commandes ' + NOMS[p] + ' reçues · ' + (r.litiges || 0) + ' litige' + ((r.litiges || 0) > 1 ? 's' : '')
            + ((r.a_relier || 0) ? ' · ' + r.a_relier + ' journée' + (r.a_relier > 1 ? 's' : '') + ' à relier' : ''), 'ok')
          setTimeout(function () { window.close() }, 10000)
        } catch (_e) {
          afficher(RESEAU, 'erreur')
        }
```

Retirer le `setTimeout(window.close, 8000)` de la branche `avis` : la fenêtre doit rester ouverte jusqu'aux commandes.

- [ ] **Step 2: Modifier `public/envoi-avis.html`**

```html
  <script>moteurRelais().demarrer('https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-reviews', 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-commandes-plateformes')</script>
```

- [ ] **Step 3: Lancer les tests existants**

Run: `for f in lib/*.test.mjs; do node "$f"; done 2>&1 | grep -E "^# fail" | sort | uniq -c`
Expected: uniquement `# fail 0`.

- [ ] **Step 4: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add public/envoi-avis.js public/envoi-avis.html
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(bouton-avis): le relais envoie aussi les commandes"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 7: Edge Function `ingest-commandes-plateformes`

**Files:**
- Create: `supabase/functions/ingest-commandes-plateformes/index.ts`

**Interfaces:**
- Consumes: `lib/litigesPlateformes.js` (import relatif `../../../lib/…`, comme `import-contacts-pos`) ; secrets existants `INGEST_SECRET`, `POS_URL`, `POS_CLE_SERVICE`.
- Produces:
  - `GET` (secret requis) → `{ derniers: { glovo: { jour } | null, yango: { jour } | null } }`
  - `POST { commandes }` (secret requis) → `{ ok, recues, inserees, a_rattacher, journees, a_relier, litiges }`
  - `POST { recalculer: true }` (sans secret : ne fait que recalculer depuis les données déjà reçues) → recalcule les journées `a_relier` → même réponse sans `recues`.

- [ ] **Step 1: Écrire la fonction**

```ts
// =====================================================================
//  Supabase Edge Function : ingest-commandes-plateformes
//
//  Reçoit les commandes Glovo/Yango lues par le bouton avis (relais
//  envoi-avis.html), les range dans commandes_plateformes, relit le POS cloud
//  et crée les litiges tapé −, tapé +, remboursement et temps d'attente dans
//  litiges_yango / litiges_glovo (calcul pur : lib/litigesPlateformes.js).
//  Conception : docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
//
//  Secrets : INGEST_SECRET (comme ingest-reviews), POS_URL, POS_CLE_SERVICE.
//  Déploiement :
//    npx supabase functions deploy ingest-commandes-plateformes --no-verify-jwt --project-ref wlwotzxnzowbkbfcpnyi
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  comparerJournee, retenuesJournee, planEcriture, normaliserNom, jourDe, RETENUES_FOURNIES,
} from '../../../lib/litigesPlateformes.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ingest-secret, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const pos = createClient(Deno.env.get('POS_URL')!, Deno.env.get('POS_CLE_SERVICE')!, { auth: { persistSession: false } })
const PLATEFORMES = ['glovo', 'yango'] as const
const TABLE = { glovo: 'litiges_glovo', yango: 'litiges_yango' } as const
const aujourdhui = () => new Date().toISOString().slice(0, 10)
const lendemain = (jour: string) => new Date(Date.parse(jour + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
const veille = (jour: string) => new Date(Date.parse(jour + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)

// Supabase coupe à 1 000 lignes : lecture par pages.
async function toutes(fabrique: () => any) {
  const lignes: any[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await fabrique().range(de, de + 999)
    if (error) throw error
    lignes.push(...(data ?? []))
    if (!data || data.length < 1000) return lignes
  }
}

async function secretOk(req: Request) {
  return req.headers.get('x-ingest-secret') === Deno.env.get('INGEST_SECRET')
}

// ── Ingestion ──────────────────────────────────────────────────────────
async function ranger(commandes: any[]) {
  const { data: mapping } = await admin.from('review_store_mapping').select('platform, label_norm, restaurant_id')
  const resto = new Map((mapping ?? []).map(m => [`${m.platform}|${m.label_norm}`, m.restaurant_id]))
  const normLabel = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  const lignes = commandes
    .filter(c => PLATEFORMES.includes(c?.plateforme) && c?.numero && c?.commande_le)
    .map(c => ({
      plateforme: c.plateforme,
      numero: String(c.numero),
      boutique: c.boutique ?? null,
      restaurant_id: resto.get(`${c.plateforme}|${normLabel(c.boutique)}`) ?? null,
      commande_le: c.commande_le,
      jour: jourDe(c.commande_le),
      statut: ['livree', 'annulee'].includes(c.statut) ? c.statut : 'autre',
      montant_paye: c.montant_paye == null ? null : Math.round(Number(c.montant_paye) || 0),
      rembourse: Math.round(Number(c.rembourse) || 0),
      penalite_attente: Math.round(Number(c.penalite_attente) || 0),
      lignes: Array.isArray(c.lignes) ? c.lignes : [],
      recu_le: new Date().toISOString(),
    }))
  for (let i = 0; i < lignes.length; i += 500) {
    const { error } = await admin.from('commandes_plateformes').upsert(lignes.slice(i, i + 500), { onConflict: 'plateforme,numero' })
    if (error) throw error
  }
  const journees = new Set(lignes.filter(l => l.restaurant_id && l.jour < aujourdhui()).map(l => `${l.restaurant_id}|${l.plateforme}|${l.jour}`))
  return { inserees: lignes.length, a_rattacher: lignes.filter(l => !l.restaurant_id).length, journees: [...journees] }
}

// ── Lecture POS d'une journée ──────────────────────────────────────────
async function lirePos(restaurantId: string, plateforme: string, jour: string) {
  const { data: r } = await pos.from('restaurants').select('restaurant_id').eq('samtrackly_id', restaurantId).limit(1)
  const posId = r?.[0]?.restaurant_id
  if (!posId) return { posPresent: false, commandesPos: [], prixReference: {} }

  const debut = `${jour}T00:00:00Z`, fin = `${lendemain(jour)}T00:00:00Z`
  const { count } = await pos.from('commandes').select('id', { count: 'exact', head: true })
    .eq('restaurant_id', posId).gte('created_at', debut).lt('created_at', fin)
  if (!count) return { posPresent: false, commandesPos: [], prixReference: {} }

  const cmds = await toutes(() => pos.from('commandes')
    .select('id, numero_ticket, ref_partenaire, created_at, service_id, commande_items(nom_snapshot, quantite, prix_unitaire, annule_par)')
    .eq('restaurant_id', posId).eq('partenaire', plateforme.toUpperCase()).eq('statut', 'PAYEE')
    .gte('created_at', debut).lt('created_at', fin).order('id'))

  // Caissier : shift Samtrackly lié au service POS.
  const services = [...new Set(cmds.map(c => c.service_id).filter(Boolean))]
  const { data: shifts } = services.length
    ? await admin.from('points_shifts').select('pos_service_id, caissier_id, caissier_nom').in('pos_service_id', services)
    : { data: [] }
  const parService = new Map((shifts ?? []).map(s => [s.pos_service_id, s]))

  const commandesPos = cmds.map(c => ({
    id: c.id, numero_ticket: c.numero_ticket, ref_partenaire: c.ref_partenaire, created_at: c.created_at,
    caissier_id: parService.get(c.service_id)?.caissier_id ?? null,
    caissier_nom: parService.get(c.service_id)?.caissier_nom ?? null,
    items: (c.commande_items ?? []).filter((i: any) => !i.annule_par)
      .map((i: any) => ({ nom: i.nom_snapshot, quantite: i.quantite, prix_unitaire: i.prix_unitaire })),
  }))

  // Prix de référence : dernier prix POS du canal sur 30 jours.
  const depuis = new Date(Date.parse(debut) - 30 * 86400000).toISOString()
  const lignesRef = await toutes(() => pos.from('commande_items')
    .select('nom_snapshot, prix_unitaire, commandes!inner(partenaire, restaurant_id, created_at)')
    .eq('commandes.restaurant_id', posId).eq('commandes.partenaire', plateforme.toUpperCase())
    .gte('commandes.created_at', depuis).lt('commandes.created_at', fin).order('id'))
  const prixReference: Record<string, number> = {}
  for (const l of lignesRef.sort((a, b) => String(a.commandes.created_at).localeCompare(String(b.commandes.created_at)))) {
    if (l.prix_unitaire > 0) prixReference[normaliserNom(l.nom_snapshot)] = l.prix_unitaire
  }

  // Noms POS vus, pour l'écran Correspondances.
  const vus = [...new Map(commandesPos.flatMap(c => c.items).map(i => [normaliserNom(i.nom), i.nom])).entries()]
    .map(([nom_norm, nom]) => ({ nom_norm, nom, vu_le: new Date().toISOString() }))
  if (vus.length) await admin.from('plats_pos_vus').upsert(vus, { onConflict: 'nom_norm', ignoreDuplicates: false })

  return { posPresent: true, commandesPos, prixReference }
}

// ── Calcul et écriture d'une journée ───────────────────────────────────
async function traiterJournee(restaurantId: string, plateforme: 'glovo' | 'yango', jour: string) {
  const [{ data: cmdsPf }, { data: corr }, { data: ignores }, { data: shifts }, { data: existants }] = await Promise.all([
    admin.from('commandes_plateformes').select('*').eq('restaurant_id', restaurantId).eq('plateforme', plateforme).eq('jour', jour),
    admin.from('correspondances_plats').select('nom_norm, nom_pos, ignorer').eq('plateforme', plateforme),
    admin.from('plats_pos_vus').select('nom_norm').eq('ignorer', true),
    admin.from('points_shifts').select('restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin')
      .eq('restaurant_id', restaurantId).in('date', [veille(jour), jour]),
    admin.from(TABLE[plateforme]).select('id, type, origine, cle_auto, montant, responsable_id, responsable_nom, notes, numero_commande')
      .eq('restaurant_id', restaurantId).eq('date', jour),
  ])
  const lecture = await lirePos(restaurantId, plateforme, jour)
  const resultat = comparerJournee({
    plateforme, restaurantId, jour, posPresent: lecture.posPresent,
    commandesPlateforme: cmdsPf ?? [], commandesPos: lecture.commandesPos,
    correspondances: new Map((corr ?? []).map(c => [c.nom_norm, c])),
    posIgnores: new Set((ignores ?? []).map(i => i.nom_norm)),
    prixReference: lecture.prixReference, shifts: shifts ?? [],
  })
  const retenues = retenuesJournee({ plateforme, restaurantId, jour, commandesPlateforme: cmdsPf ?? [], shifts: shifts ?? [] })
  const calcules = [...resultat.litiges, ...retenues]
  const typesCouverts = [...(resultat.statut === 'calculee' ? ['tape_moins', 'tape_plus'] : []), ...RETENUES_FOURNIES[plateforme]]

  const cles = calcules.map(l => l.cle_auto)
  const { data: annules } = cles.length
    ? await admin.from('litiges_auto_annules').select('cle_auto').in('cle_auto', cles)
    : { data: [] }
  const plan = planEcriture({ calcules, existants: existants ?? [], annules: new Set((annules ?? []).map(a => a.cle_auto)), typesCouverts })

  const enLigne = (l: any) => ({
    restaurant_id: restaurantId, date: jour, type: l.type, montant: l.montant,
    responsable_id: l.responsable_id, responsable_nom: l.responsable_nom,
    numero_commande: l.numero_commande, notes: l.notes, detail: l.detail,
    origine: 'auto', cle_auto: l.cle_auto, created_by: 'Automatique',
  })
  if (plan.aSupprimer.length) {
    const { error } = await admin.from(TABLE[plateforme]).delete().in('id', plan.aSupprimer)
    if (error) throw error
  }
  for (const l of plan.aMettreAJour) {
    const { error } = await admin.from(TABLE[plateforme]).update({ ...enLigne(l), modified_at: new Date().toISOString() }).eq('id', l.id)
    if (error) throw error
  }
  if (plan.aInserer.length) {
    const { error } = await admin.from(TABLE[plateforme]).insert(plan.aInserer.map(enLigne))
    if (error) throw error
  }
  await admin.from('journees_litiges_plateformes').upsert({
    restaurant_id: restaurantId, plateforme, jour, statut: resultat.statut,
    noms_inconnus: resultat.nomsInconnus, calcule_le: new Date().toISOString(),
  }, { onConflict: 'restaurant_id,plateforme,jour' })

  return { statut: resultat.statut, litiges: plan.aInserer.length + plan.aMettreAJour.length }
}

async function traiterJournees(cles: string[]) {
  let litiges = 0, a_relier = 0
  for (const cle of cles) {
    const [restaurantId, plateforme, jour] = cle.split('|')
    const r = await traiterJournee(restaurantId, plateforme as 'glovo' | 'yango', jour)
    litiges += r.litiges
    if (r.statut === 'a_relier') a_relier++
  }
  return { journees: cles.length, litiges, a_relier }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') {
      if (!(await secretOk(req))) return json({ erreur: 'secret' }, 401)
      const derniers: Record<string, { jour: string } | null> = {}
      for (const p of PLATEFORMES) {
        const { data } = await admin.from('commandes_plateformes').select('jour').eq('plateforme', p).order('jour', { ascending: false }).limit(1)
        derniers[p] = data?.[0] ? { jour: data[0].jour } : null
      }
      return json({ derniers })
    }
    const corps = await req.json().catch(() => ({}))
    if (corps?.recalculer) {
      const { data } = await admin.from('journees_litiges_plateformes').select('restaurant_id, plateforme, jour').eq('statut', 'a_relier')
      return json({ ok: true, ...(await traiterJournees((data ?? []).map(j => `${j.restaurant_id}|${j.plateforme}|${j.jour}`))) })
    }
    if (!(await secretOk(req))) return json({ erreur: 'secret' }, 401)
    const commandes = Array.isArray(corps?.commandes) ? corps.commandes : []
    const rangees = await ranger(commandes)
    const r = await traiterJournees(rangees.journees)
    return json({ ok: true, recues: commandes.length, inserees: rangees.inserees, a_rattacher: rangees.a_rattacher, ...r })
  } catch (e) {
    console.error('ingest-commandes-plateformes', e)
    return json({ ok: false, erreur: String((e as Error)?.message ?? e) }, 500)
  }
})
```

- [ ] **Step 2: Vérifier la jointure POS** (le `commande_items(...)` embarqué exige une clé étrangère `commande_items.commande_id → commandes.id` sur le cloud POS) :

```sql
-- projet vbsmxwlxlcgkodwkbhfa
select conname from pg_constraint where conrelid = 'commande_items'::regclass and contype = 'f';
```
Expected: une contrainte vers `commandes`. Sinon, remplacer l'embarquement par une 2e lecture `commande_items` `.in('commande_id', ids)` par lots de 200.

- [ ] **Step 3: Déployer** (après accord d'Ange par AskUserQuestion)

Run: `npx supabase functions deploy ingest-commandes-plateformes --no-verify-jwt --project-ref wlwotzxnzowbkbfcpnyi`
Expected: `Deployed Functions on project wlwotzxnzowbkbfcpnyi: ingest-commandes-plateformes`.

- [ ] **Step 4: Essai à blanc**

Run: `curl -s -X POST https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-commandes-plateformes -H 'Content-Type: application/json' -d '{"recalculer":true}'`
Expected: `{"ok":true,"journees":0,"litiges":0,"a_relier":0}`.

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add supabase/functions/ingest-commandes-plateformes
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): fonction d'ingestion des commandes et calcul des litiges auto"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 8: Écran Correspondances (manager)

**Files:**
- Create: `app/correspondances-plats.js`

**Interfaces:**
- Consumes: tables `correspondances_plats`, `plats_pos_vus`, `journees_litiges_plateformes`, `commandes_plateformes` ; `proposerCorrespondance`, `normaliserNom` (tâche 2) ; `POST { recalculer: true }` (tâche 7).
- Produces: route `/correspondances-plats`.

- [ ] **Step 1: Écrire l'écran**

```js
// ──────────────────────────────────────────────────────────────────────────────
//  CORRESPONDANCES DE PLATS — Glovo / Yango → POS (manager uniquement)
//
//  Les litiges automatiques comparent les plats vendus sur les portails à ceux
//  tapés dans le POS. Chaque nom de plat d'un portail doit être relié une fois
//  à un plat du POS (ou ignoré : sauce, couverts…). Tant qu'un nom n'est pas
//  relié, la journée reste « à relier » et aucun tapé ± n'est créé.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { normaliserNom, proposerCorrespondance } from '../lib/litigesPlateformes'
import { retour } from '../lib/navigation'
import { supabase } from '../lib/supabase'

const URL_RECALCUL = 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-commandes-plateformes'
const NOMS = { glovo: 'Glovo', yango: 'Yango' }

export default function CorrespondancesPlats() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif } = useApp()
  const [chargement, setChargement] = useState(true)
  const [inconnus, setInconnus] = useState([])      // [{ plateforme, nom, jours }]
  const [platsPos, setPlatsPos] = useState([])      // [{ nom_norm, nom, ignorer }]
  const [choix, setChoix] = useState({})            // `${plateforme}|${nom}` → nom POS | '__ignorer'
  const [ouvert, setOuvert] = useState(null)
  const [message, setMessage] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    setChargement(true)
    const [{ data: journees }, { data: pos }] = await Promise.all([
      supabase.from('journees_litiges_plateformes').select('plateforme, jour, noms_inconnus').eq('statut', 'a_relier'),
      supabase.from('plats_pos_vus').select('nom_norm, nom, ignorer').order('nom'),
    ])
    const parNom = new Map()
    for (const j of journees || []) {
      for (const nom of j.noms_inconnus || []) {
        const cle = `${j.plateforme}|${nom}`
        if (!parNom.has(cle)) parNom.set(cle, { plateforme: j.plateforme, nom, jours: 0 })
        parNom.get(cle).jours++
      }
    }
    const liste = [...parNom.values()].sort((a, b) => b.jours - a.jours || a.nom.localeCompare(b.nom))
    const nomsPos = (pos || []).filter(p => !p.ignorer).map(p => p.nom)
    const propositions = {}
    for (const i of liste) {
      const p = proposerCorrespondance(i.nom, nomsPos)
      if (p) propositions[`${i.plateforme}|${i.nom}`] = p
    }
    setInconnus(liste)
    setPlatsPos(pos || [])
    setChoix(propositions)
    setChargement(false)
  }, [])

  useEffect(() => { charger() }, [charger])

  async function enregistrer() {
    const lignes = inconnus
      .filter(i => choix[`${i.plateforme}|${i.nom}`])
      .map(i => {
        const c = choix[`${i.plateforme}|${i.nom}`]
        return {
          plateforme: i.plateforme, nom_norm: normaliserNom(i.nom), nom_plateforme: i.nom,
          nom_pos: c === '__ignorer' ? null : c, ignorer: c === '__ignorer',
        }
      })
    if (!lignes.length) { setMessage('Choisissez au moins un plat.'); return }
    setEnvoi(true)
    const { error } = await supabase.from('correspondances_plats').upsert(lignes, { onConflict: 'plateforme,nom_norm' })
    if (error) { setEnvoi(false); setMessage("L'enregistrement n'a pas abouti. Réessayez."); return }
    try {
      const r = await fetch(URL_RECALCUL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recalculer: true }) })
      const j = await r.json()
      setMessage(`${lignes.length} plat${lignes.length > 1 ? 's' : ''} relié${lignes.length > 1 ? 's' : ''} · ${j.litiges || 0} litige${(j.litiges || 0) > 1 ? 's' : ''} recalculé${(j.litiges || 0) > 1 ? 's' : ''}`)
    } catch (_e) {
      setMessage('Plats reliés. Le recalcul se fera au prochain clic du bouton avis.')
    }
    setEnvoi(false)
    charger()
  }

  async function basculerIgnorePos(p) {
    await supabase.from('plats_pos_vus').update({ ignorer: !p.ignorer }).eq('nom_norm', p.nom_norm)
    charger()
  }

  const entete = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitre}>Correspondances</Text>
      <Text style={styles.headerSub}>Relier les plats Glovo & Yango à ceux du POS</Text>
    </View>
  )

  if (roleActif !== 'manager') {
    return (
      <SafeAreaView style={styles.page}>{entete}
        <Text style={styles.vide}>Cet écran est réservé au manager.</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.page}>
      {entete}
      {chargement ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.contenu}>
          {inconnus.length === 0 ? (
            <Text style={styles.vide}>Tous les plats sont reliés. Rien à faire.</Text>
          ) : inconnus.map(i => {
            const cle = `${i.plateforme}|${i.nom}`
            const c = choix[cle]
            return (
              <View key={cle} style={styles.carte}>
                <Text style={styles.nomPf}>{NOMS[i.plateforme]} · {i.nom}</Text>
                <Text style={styles.sous}>{i.jours} journée{i.jours > 1 ? 's' : ''} en attente</Text>
                <TouchableOpacity style={styles.selecteur} onPress={() => setOuvert(ouvert === cle ? null : cle)}>
                  <Text style={styles.selecteurTxt}>
                    {c === '__ignorer' ? 'Ignorer (pas un plat)' : c ? `→ ${c}` : 'Choisir le plat du POS'}
                  </Text>
                </TouchableOpacity>
                {ouvert === cle && (
                  <View style={styles.liste}>
                    <TouchableOpacity style={styles.option} onPress={() => { setChoix({ ...choix, [cle]: '__ignorer' }); setOuvert(null) }}>
                      <Text style={styles.optionTxt}>Ignorer (sauce, couverts…)</Text>
                    </TouchableOpacity>
                    {platsPos.filter(p => !p.ignorer).map(p => (
                      <TouchableOpacity key={p.nom_norm} style={styles.option} onPress={() => { setChoix({ ...choix, [cle]: p.nom }); setOuvert(null) }}>
                        <Text style={styles.optionTxt}>{p.nom}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )
          })}
          {inconnus.length > 0 && (
            <TouchableOpacity style={[styles.bouton, envoi && { opacity: 0.6 }]} disabled={envoi} onPress={enregistrer}>
              <Text style={styles.boutonTxt}>{envoi ? 'Enregistrement…' : 'Enregistrer et recalculer'}</Text>
            </TouchableOpacity>
          )}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <Text style={styles.titreSection}>Plats du POS à ne pas comparer</Text>
          <Text style={styles.sous}>Ex. un supplément tapé comme un article. Touchez pour basculer.</Text>
          {platsPos.map(p => (
            <TouchableOpacity key={p.nom_norm} style={styles.ligneIgnore} onPress={() => basculerIgnorePos(p)}>
              <Text style={styles.optionTxt}>{p.nom}</Text>
              <Text style={[styles.etat, { color: p.ignorer ? colors.error : colors.successDark }]}>{p.ignorer ? 'Ignoré' : 'Comparé'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = c => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  backBtn: { minHeight: 44, justifyContent: 'center' },
  backTxt: { color: c.primary, fontSize: 16, fontWeight: '600' },
  headerTitre: { color: c.text, fontSize: 22, fontWeight: '700' },
  headerSub: { color: c.textSecondary, fontSize: 14, marginTop: 2 },
  contenu: { padding: 16, gap: 12, paddingBottom: 48 },
  vide: { color: c.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 32 },
  carte: { backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
  nomPf: { color: c.text, fontSize: 16, fontWeight: '700' },
  sous: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  selecteur: { marginTop: 10, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: c.primary, justifyContent: 'center', paddingHorizontal: 12 },
  selecteurTxt: { color: c.primary, fontSize: 15, fontWeight: '600' },
  liste: { marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: c.border, maxHeight: 280, overflow: 'scroll' },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  optionTxt: { color: c.text, fontSize: 15 },
  bouton: { minHeight: 52, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  boutonTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  message: { color: c.text, fontSize: 14, textAlign: 'center' },
  titreSection: { color: c.text, fontSize: 17, fontWeight: '700', marginTop: 24 },
  ligneIgnore: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  etat: { fontSize: 14, fontWeight: '600' },
})
```

Avant d'écrire, vérifier dans `lib/theme.js` les clés de couleur réellement disponibles (`background`, `card`, `border`, `text`, `textSecondary`, `primary`, `error`, `successDark`) et remplacer celles qui manquent par leurs équivalents.

- [ ] **Step 2: Lint**

Run: `npm run lint 2>&1 | tail -5`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add app/correspondances-plats.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): écran de correspondance des plats Glovo/Yango → POS"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 9: Litiges → Yango / Glovo : pastille auto, détail, Annuler, bandeau

**Files:**
- Modify: `app/litiges.js` (rendu des listes Yango et Glovo des onglets `yango` / `glovo`, fonctions `chargerYango` / `chargerGlovo` vers les lignes 684-705)

**Interfaces:**
- Consumes: colonnes `origine`, `cle_auto`, `detail` ; tables `litiges_auto_annules`, `journees_litiges_plateformes`.

- [ ] **Step 1: Repérer le rendu des onglets.** `grep -n "litigesYango.map\|litigesGlovo.map" app/litiges.js` — ce sont les deux listes à enrichir (pas la vue globale des lignes 1160-1210, qui reste telle quelle).

- [ ] **Step 2: Ajouter l'état et le chargement des journées à relier** (près des autres `useState`, et appeler `chargerARelier()` là où `chargerYango()` / `chargerGlovo()` sont appelés) :

```js
  const [aRelier, setARelier] = useState(0)
  const [detailOuvert, setDetailOuvert] = useState(null)

  async function chargerARelier() {
    const { count } = await supabase.from('journees_litiges_plateformes')
      .select('jour', { count: 'exact', head: true })
      .eq('restaurant_id', restoSelectionne.id).eq('statut', 'a_relier')
    setARelier(count || 0)
  }
```

- [ ] **Step 3: Ajouter l'annulation**

```js
  // Litige automatique annulé : retiré de la liste et rangé dans
  // litiges_auto_annules, pour que le calcul ne le recrée jamais.
  async function annulerLitigeAuto(ligne, table) {
    const plateforme = table === 'litiges_yango' ? 'yango' : 'glovo'
    const { error: e1 } = await supabase.from('litiges_auto_annules').upsert({
      cle_auto: ligne.cle_auto, plateforme, copie: ligne, annule_par: userNom || userId,
    }, { onConflict: 'cle_auto' })
    if (e1) { setSaveError("L'annulation n'a pas abouti. Réessayez."); return }
    const { error: e2 } = await supabase.from(table).delete().eq('id', ligne.id)
    if (e2) { setSaveError("L'annulation n'a pas abouti. Réessayez."); return }
    if (table === 'litiges_yango') chargerYango(); else chargerGlovo()
  }
```

Le bouton passe par la confirmation à deux boutons déjà utilisée dans l'écran (mémoire : un Alert web perd le 3e bouton — deux boutons « Annuler le litige » / « Garder » seulement).

- [ ] **Step 4: Enrichir chaque ligne** des listes Yango et Glovo des onglets (pour `y` / `g` selon la liste) :

```jsx
{y.origine === 'auto' && (
  <View style={styles.pastilleAuto}><Text style={styles.pastilleAutoTxt}>auto</Text></View>
)}
{y.origine === 'auto' && y.detail?.lignes?.length > 0 && (
  <TouchableOpacity onPress={() => setDetailOuvert(detailOuvert === y.id ? null : y.id)}>
    <Text style={styles.lienDetail}>{detailOuvert === y.id ? 'Masquer le détail' : 'Voir le détail'}</Text>
  </TouchableOpacity>
)}
{detailOuvert === y.id && (y.detail?.lignes || []).map((l, i) => (
  <Text key={i} style={styles.ligneDetail}>
    {l.heure} · {l.plat ? `${l.plat} · ` : ''}n° {l.commande} · {fmtShort(l.prix)}
  </Text>
))}
{y.origine === 'auto' && roleActif === 'manager' && (
  <TouchableOpacity onPress={() => confirmerAnnulationAuto(y, 'litiges_yango')}>
    <Text style={styles.lienAnnuler}>Annuler ce litige</Text>
  </TouchableOpacity>
)}
```

Les lignes `origine === 'auto'` n'ouvrent pas le formulaire de modification manuelle (sinon le recalcul écraserait la modification) : dans le `onPress` qui ouvre `LitigeForm` pour Yango/Glovo, ajouter `if (y.origine === 'auto') return`.

- [ ] **Step 5: Ajouter le bandeau** en tête des onglets Yango et Glovo :

```jsx
{aRelier > 0 && roleActif === 'manager' && (
  <TouchableOpacity style={styles.bandeauRelier} onPress={() => router.push('/correspondances-plats')}>
    <Text style={styles.bandeauRelierTxt}>
      {aRelier} journée{aRelier > 1 ? 's' : ''} en attente : des plats Glovo/Yango ne sont pas encore reliés au POS. Toucher pour les relier.
    </Text>
  </TouchableOpacity>
)}
```

(Importer `router` depuis `expo-router` s'il ne l'est pas déjà.)

- [ ] **Step 6: Styles** dans `makeStyles` :

```js
  pastilleAuto: { alignSelf: 'flex-start', backgroundColor: colors.primary + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2 },
  pastilleAutoTxt: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  lienDetail: { color: colors.primary, fontSize: 13, marginTop: 4 },
  ligneDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  lienAnnuler: { color: colors.error, fontSize: 13, marginTop: 6, fontWeight: '600' },
  bandeauRelier: { backgroundColor: colors.warning + '22', borderRadius: 10, padding: 12, marginBottom: 12, minHeight: 48, justifyContent: 'center' },
  bandeauRelierTxt: { color: colors.text, fontSize: 14 },
```

(Vérifier `colors.warning` dans `lib/theme.js`, sinon utiliser `'#F59E0B'`.)

- [ ] **Step 7: Lint et tests**

Run: `npm run lint 2>&1 | tail -5 && for f in lib/*.test.mjs; do node "$f"; done 2>&1 | grep -E "^# fail" | sort | uniq -c`
Expected: 0 erreur de lint ; uniquement `# fail 0`.

- [ ] **Step 8: Export web** (vérifie que tout compile, sans lancer de serveur)

Run: `npx expo export -p web 2>&1 | tail -3`
Expected: export terminé sans erreur.

- [ ] **Step 9: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add app/litiges.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(litiges): litiges auto Yango/Glovo — pastille, détail, annulation, plats à relier"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 10: Premier passage réel (avec Ange)

- [ ] **Step 1:** `graphify update .` puis commit `chore(graphify): graphe à jour`.
- [ ] **Step 2:** Publier le web seul pour que le favori pointe sur la nouvelle version : `npx expo export -p web && npx vercel deploy --prod --yes` (ajouter `--scope ripiti225s-projects` si « Not authorized »). Demander l'accord avant (AskUserQuestion).
- [ ] **Step 3:** Ange réinstalle le favori depuis `samtrackly.vercel.app/bouton-avis`, puis clique sur Glovo, puis sur Yango.
- [ ] **Step 4:** Vérifier côté base :

```sql
select plateforme, jour, count(*), count(*) filter (where restaurant_id is null) a_rattacher
  from commandes_plateformes group by 1,2 order by 2 desc, 1;
select plateforme, statut, count(*) from journees_litiges_plateformes group by 1,2;
```
- [ ] **Step 5:** Ange relie les plats dans Correspondances ; vérifier que les journées passent à `calculee`.
- [ ] **Step 6:** Contrôle croisé sur une journée d'un restaurant : compter à la main les chawarmas Yango POS vs portail et comparer aux litiges créés. Toute anomalie → superpowers:systematic-debugging avant correction.
- [ ] **Step 7:** Changer le secret d'ingestion avant de redistribuer le favori (mémoire avis : secret exposé), si Ange le souhaite (AskUserQuestion).

### Task 11: Publication finale

- [ ] **Step 1:** `npm run lint` (0 erreur) et `for f in lib/*.test.mjs; do node "$f"; done` (0 échec).
- [ ] **Step 2:** `git add -A` (sans les deux fichiers SQL non suivis du 05/10 qui ne font pas partie du chantier : les exclure explicitement), commit, push.
- [ ] **Step 3:** `npx expo export -p web && npx vercel deploy --prod --yes`.
- [ ] **Step 4:** `DEVELOPER_DIR=/Library/Developer/CommandLineTools npx eas-cli update --branch production --message "Litiges Yango/Glovo automatiques (tapé +, tapé −, remboursements, attente)"`.
- [ ] **Step 5:** Mettre à jour la mémoire (nouveau fichier projet « litiges plateformes auto » + ligne dans MEMORY.md) et `handoff.md`.
- [ ] **Step 6:** Résumer à Ange les nouveautés en français simple, sans jargon.
