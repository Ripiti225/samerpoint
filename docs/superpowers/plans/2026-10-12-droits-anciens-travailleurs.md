# Droits des anciens travailleurs — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suivre par restaurant l'argent dû à chaque travailleur parti (nom, date de départ, motif, montant), comme un fournisseur administratif payé par le gérant en caisse ou par la direction, en une ou plusieurs fois (chaque paiement = une transaction sur la fiche).

**Architecture:** Une fiche = une ligne `fournisseurs` de type `administratif`, sans échéance, avec `depart_le` rempli (c'est ce qui la marque comme droit). Le montant dû est une écriture `ajustement_manager`. Logique pure dans `lib/droitsAnciensTravailleurs.js`, accès base dans `lib/droitsAnciensTravailleursDb.js`, écran dans un nouvel onglet de Trésorerie → À payer (`components/tresorerie/anciensTravailleurs.js`). Réutilise tout le circuit administratif (Déductions gérant, `tresorerie_payer_fournisseur_admin`, Crédits).

**Tech Stack:** Expo / React Native web, Supabase (supabase-js), tests `node:test` dans `lib/*.test.mjs`.

**Spéc :** `docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md`

## Global Constraints

- Interface, messages, commentaires : en français.
- Montants FCFA entiers, jamais de float affiché.
- Toute date se choisit au calendrier (`components/ChampDate`), jamais tapée.
- Une alerte web n'a jamais plus de 2 boutons (`Alert.alert` à 3 choix perd le 3e).
- Le journal (`journaliser`) ne bloque jamais : toujours `.catch(() => {})`.
- Ne jamais lire `fournisseurs` avec une liste de colonnes contenant `depart_le` / `depart_motif` / `travailleur_id` : utiliser `select('*')` pour que l'app marche AVANT la migration.
- Ne PAS exécuter la migration : c'est l'utilisateur qui la passe dans Supabase (projet Samtrackly `wlwotzxnzowbkbfcpnyi`).
- Ne PAS lancer `expo start` / localhost. Vérifier par tests, lint, `npx expo export -p web`.
- Livraison : commit + push seulement. Pas de Vercel, pas d'EAS.
- Prérequis : le chantier « fournisseurs administratifs » (plan `2026-10-12-fournisseurs-administratifs.md`) est terminé.
- Commits conventionnels en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Si `git` échoue à cause de Xcode : préfixer par `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/droitsAnciensTravailleurs.js` (créé) | Logique pure : reconnaître une fiche, résumé dû/payé/reste, regroupement, libellés, visibilité gérant |
| `lib/droitsAnciensTravailleurs.test.mjs` (créé) | Tests de la logique pure |
| `supabase_droits_anciens_travailleurs.sql` (créé) | Colonnes `depart_le`, `depart_motif`, `travailleur_id` |
| `lib/creditFournisseursMois.js` (modifié) | Exclure les droits de la variation du crédit |
| `lib/droitsAnciensTravailleursDb.js` (créé) | Charger, créer, modifier, remplacer une ancienne fiche globale |
| `lib/tresorerie.js` (modifié) | Onglet `anciens_travailleurs`, permission `saisir_anciens` |
| `components/tresorerie/commun.js` (modifié) | Style de l'onglet |
| `components/tresorerie/anciensTravailleurs.js` (créé) | Onglet complet (liste, création, modification, paiement direction, anciennes fiches) |
| `app/tresorerie-a-payer.js` (modifié) | Brancher l'onglet |
| `components/equipe/Modales.js`, `app/equipe.js` (modifiés) | Question « Lui doit-on de l'argent ? » après archivage d'un CDI |
| `app/deductions-gerant.js`, `components/deductions/OngletFournisseurs.js` (modifiés) | Sous-titre « Ancien travailleur · parti le … », fiches soldées cachées |
| `app/credits-fournisseurs.js` (modifié) | Section « Anciens travailleurs », sous-titre, pas de « Réglages » sur un droit |

---

### Task 1: Logique pure `lib/droitsAnciensTravailleurs.js`

**Files:**
- Create: `lib/droitsAnciensTravailleurs.js`
- Test: `lib/droitsAnciensTravailleurs.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `estDroitAncienTravailleur(f) → boolean` (vrai si `f.depart_le`)
  - `proposerDroits(trav) → boolean` (vrai si `trav.type_contrat === 'CDI'`)
  - `sousTitreDepart(f) → string` (« parti le 12/09/2026 · Démission »)
  - `resumeDroit(transactions) → { du, paye, reste }`
  - `paiementsDroit(transactions) → [{ id, date, montant, par: 'Direction' | 'Gérant' }]` (plus récent d'abord)
  - `resumeDroitsParResto(fiches, transactions) → { [restaurant_id]: { fiches: [{ ...f, du, paye, reste, nbPaiements, solde }], du, paye, reste } }`
  - `estAncienneFicheGlobale(f) → boolean`
  - `droitAAfficherGerant(f, creditVeille, dejaSaisi) → boolean`
  - constante `ONGLET_ANCIENS = 'anciens_travailleurs'`

- [ ] **Step 1: Write the failing test** — créer `lib/droitsAnciensTravailleurs.test.mjs` :

```js
// Tests de lib/droitsAnciensTravailleurs.js — droits des anciens travailleurs.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ONGLET_ANCIENS, droitAAfficherGerant, estAncienneFicheGlobale, estDroitAncienTravailleur, paiementsDroit,
  proposerDroits, resumeDroit, resumeDroitsParResto, sousTitreDepart,
} from './droitsAnciensTravailleurs.js'

const tx = (fid, date, facture, paye, source = null, id = `${fid}-${date}-${facture}-${paye}`) =>
  ({ id, fournisseur_id: fid, date_point: date, facture, paye, source, created_at: `${date}T10:00:00Z` })

describe('reconnaître une fiche', () => {
  test('droit = depart_le rempli', () => {
    assert.equal(estDroitAncienTravailleur({ type: 'administratif', depart_le: '2026-09-12' }), true)
    assert.equal(estDroitAncienTravailleur({ type: 'administratif', depart_le: null }), false)
    assert.equal(estDroitAncienTravailleur(null), false)
  })
  test('onglet', () => assert.equal(ONGLET_ANCIENS, 'anciens_travailleurs'))
  test('proposer les droits aux CDI seulement', () => {
    assert.equal(proposerDroits({ type_contrat: 'CDI' }), true)
    for (const c of ['CDD', 'Stage', 'Journalier', null]) assert.equal(proposerDroits({ type_contrat: c }), false)
    assert.equal(proposerDroits(null), false)
  })
  test('anciennes fiches globales « ANCIEN TRAVAILLEURS » et « Salaire ancien »', () => {
    assert.equal(estAncienneFicheGlobale({ nom: ' ANCIEN TRAVAILLEURS', actif: true }), true)
    assert.equal(estAncienneFicheGlobale({ nom: 'Salaire ancien ', actif: true }), true)
    assert.equal(estAncienneFicheGlobale({ nom: ' ANCIEN TRAVAILLEURS', actif: false }), false)
    assert.equal(estAncienneFicheGlobale({ nom: 'Ancien travailleur', depart_le: '2026-09-01', actif: true }), false)
    assert.equal(estAncienneFicheGlobale({ nom: 'PALMCI', actif: true }), false)
  })
})

describe('libellés', () => {
  test('sous-titre avec et sans motif', () => {
    assert.equal(sousTitreDepart({ depart_le: '2026-09-12', depart_motif: 'Démission' }), 'parti le 12/09/2026 · Démission')
    assert.equal(sousTitreDepart({ depart_le: '2026-09-12', depart_motif: '' }), 'parti le 12/09/2026')
  })
})

describe('dû, payé, reste', () => {
  test('montant dû + paiement gérant + paiement direction', () => {
    const t = [
      tx('a', '2026-09-15', 300000, 0, 'ajustement_manager'),
      tx('a', '2026-09-20', 0, 100000, null),
      tx('a', '2026-10-01', 0, 50000, 'paiement_direction'),
    ]
    assert.deepEqual(resumeDroit(t), { du: 300000, paye: 150000, reste: 150000 })
  })
  test('payé en plusieurs fois jusqu\'au solde', () => {
    const t = [
      tx('a', '2026-09-15', 300000, 0, 'ajustement_manager'),
      tx('a', '2026-09-20', 0, 50000, null),
      tx('a', '2026-09-27', 0, 50000, null),
      tx('a', '2026-10-01', 0, 100000, 'paiement_direction'),
    ]
    assert.deepEqual(resumeDroit(t), { du: 300000, paye: 200000, reste: 100000 })
    assert.equal(paiementsDroit(t).length, 3)
    t.push(tx('a', '2026-10-15', 0, 100000, null))
    assert.deepEqual(resumeDroit(t), { du: 300000, paye: 300000, reste: 0 })
  })
  test('correction à la baisse du montant dû : pas un paiement', () => {
    const t = [tx('a', '2026-09-15', 300000, 0, 'ajustement_manager'), tx('a', '2026-09-16', 0, 50000, 'ajustement_manager')]
    assert.deepEqual(resumeDroit(t), { du: 250000, paye: 0, reste: 250000 })
  })
  test('paiements : qui a payé, plus récent d\'abord, sans les corrections', () => {
    const t = [
      tx('a', '2026-09-15', 300000, 0, 'ajustement_manager', 't1'),
      tx('a', '2026-09-20', 0, 100000, null, 't2'),
      tx('a', '2026-10-01', 0, 50000, 'paiement_direction', 't3'),
    ]
    assert.deepEqual(paiementsDroit(t), [
      { id: 't3', date: '2026-10-01', montant: 50000, par: 'Direction' },
      { id: 't2', date: '2026-09-20', montant: 100000, par: 'Gérant' },
    ])
  })
  test('regroupement par restaurant, soldé à 0, plus récent départ d\'abord', () => {
    const fiches = [
      { id: 'a', restaurant_id: 'lav', nom: 'Awa', depart_le: '2026-08-01' },
      { id: 'b', restaurant_id: 'lav', nom: 'Koné', depart_le: '2026-09-01' },
      { id: 'c', restaurant_id: 'kms', nom: 'Yao', depart_le: '2026-09-05' },
    ]
    const t = [
      tx('a', '2026-08-02', 100000, 0, 'ajustement_manager'), tx('a', '2026-08-10', 0, 100000, null),
      tx('b', '2026-09-02', 200000, 0, 'ajustement_manager'),
      tx('c', '2026-09-06', 80000, 0, 'ajustement_manager'), tx('c', '2026-09-07', 0, 30000, null),
    ]
    const r = resumeDroitsParResto(fiches, t)
    assert.deepEqual(r.lav.fiches.map(f => [f.id, f.reste, f.nbPaiements, f.solde]), [['b', 200000, 0, false], ['a', 0, 1, true]])
    assert.deepEqual([r.lav.du, r.lav.paye, r.lav.reste], [300000, 100000, 200000])
    assert.deepEqual([r.kms.du, r.kms.paye, r.kms.reste], [80000, 30000, 50000])
  })
})

describe('Déductions gérant', () => {
  test('un fournisseur normal est toujours affiché', () => {
    assert.equal(droitAAfficherGerant({ type: 'administratif' }, 0, false), true)
  })
  test('un droit soldé disparaît, sauf s\'il est déjà saisi ce jour', () => {
    const d = { type: 'administratif', depart_le: '2026-09-01' }
    assert.equal(droitAAfficherGerant(d, 50000, false), true)
    assert.equal(droitAAfficherGerant(d, 0, false), false)
    assert.equal(droitAAfficherGerant(d, 0, true), true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/droitsAnciensTravailleurs.test.mjs`
Expected: FAIL — `Cannot find module …/droitsAnciensTravailleurs.js`.

- [ ] **Step 3: Write minimal implementation** — créer `lib/droitsAnciensTravailleurs.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Droits des anciens travailleurs (supabase_droits_anciens_travailleurs.sql).
//
// Ce qu'on doit à un travailleur parti : une fiche par travailleur, rangée
// comme un fournisseur administratif (type « administratif », sans échéance)
// et marquée par sa date de départ (`depart_le`). Le montant dû est une
// écriture `ajustement_manager` ; le gérant paie en caisse (Déductions →
// Administratifs), la direction depuis Trésorerie → À payer.
// Résultat net : compté au fil des paiements (lib/creditFournisseursMois.js
// écarte ces fiches de la variation du crédit).
//
// Spéc : docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md
// Pur : testé par lib/droitsAnciensTravailleurs.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

export const ONGLET_ANCIENS = 'anciens_travailleurs'

const SOURCE_AJUSTEMENT = 'ajustement_manager'
const SOURCE_DIRECTION = 'paiement_direction'

const n = v => Number(v) || 0
const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const jourDe = t => t.date_point || String(t.created_at || '').slice(0, 10)
const dateFR = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

export function estDroitAncienTravailleur(f) {
  return !!f?.depart_le
}

// Seul un CDI a des droits de fin de contrat à régler (choix du 12/10/2026).
export function proposerDroits(trav) {
  return trav?.type_contrat === 'CDI'
}

/** « parti le 12/09/2026 · Démission ». */
export function sousTitreDepart(f) {
  const motif = String(f?.depart_motif || '').trim()
  return `parti le ${dateFR(f?.depart_le)}${motif ? ` · ${motif}` : ''}`
}

// Dû = factures − corrections à la baisse ; payé = paiements réels (gérant, direction).
export function resumeDroit(transactions = []) {
  let du = 0
  let paye = 0
  for (const t of transactions || []) {
    du += n(t.facture)
    if (t.source === SOURCE_AJUSTEMENT) du -= n(t.paye)
    else paye += n(t.paye)
  }
  return { du, paye, reste: du - paye }
}

export function paiementsDroit(transactions = []) {
  return (transactions || [])
    .filter(t => t.source !== SOURCE_AJUSTEMENT && n(t.paye) > 0)
    .map(t => ({ id: t.id, date: jourDe(t), montant: n(t.paye), par: t.source === SOURCE_DIRECTION ? 'Direction' : 'Gérant' }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function resumeDroitsParResto(fiches = [], transactions = []) {
  const parFiche = {}
  for (const t of transactions || []) (parFiche[t.fournisseur_id] ||= []).push(t)
  const out = {}
  for (const f of fiches || []) {
    const r = resumeDroit(parFiche[f.id])
    const g = (out[f.restaurant_id] ||= { fiches: [], du: 0, paye: 0, reste: 0 })
    g.fiches.push({ ...f, ...r, nbPaiements: paiementsDroit(parFiche[f.id]).length, solde: r.reste <= 0 })
    g.du += r.du
    g.paye += r.paye
    g.reste += Math.max(0, r.reste)
  }
  // Restants d'abord, puis le départ le plus récent.
  for (const g of Object.values(out)) {
    g.fiches.sort((a, b) => (a.solde - b.solde) || String(b.depart_le).localeCompare(String(a.depart_le)))
  }
  return out
}

// Les fiches « ANCIEN TRAVAILLEURS » (une par restaurant) et « Salaire ancien »
// d'avant le 12/10/2026, à remplacer par une fiche par travailleur.
const ANCIENNE_FICHE = /ancien travailleur|salaire ancien/
export function estAncienneFicheGlobale(f) {
  return !!f && f.actif !== false && !estDroitAncienTravailleur(f) && ANCIENNE_FICHE.test(normaliser(f.nom))
}

// Déductions gérant : un droit soldé n'encombre plus la liste, sauf s'il a
// déjà une saisie ce jour (sinon la saisie disparaîtrait de l'écran).
export function droitAAfficherGerant(f, creditVeille, dejaSaisi) {
  if (!estDroitAncienTravailleur(f)) return true
  return n(creditVeille) > 0 || !!dejaSaisi
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node lib/droitsAnciensTravailleurs.test.mjs`
Expected: PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add lib/droitsAnciensTravailleurs.js lib/droitsAnciensTravailleurs.test.mjs
git commit -m "feat(equipe): logique des droits des anciens travailleurs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration SQL

**Files:**
- Create: `supabase_droits_anciens_travailleurs.sql`

**Interfaces:**
- Produces : colonnes `fournisseurs.depart_le date`, `fournisseurs.depart_motif text`, `fournisseurs.travailleur_id uuid` (FK `travailleurs.id`, `ON DELETE SET NULL`).

- [ ] **Step 1: Écrire le fichier**

```sql
-- =====================================================================
--  Droits des anciens travailleurs — 12/10/2026
--  Projet Samtrackly (wlwotzxnzowbkbfcpnyi). Idempotente : se repasse sans risque.
--
--  Une fiche par travailleur parti = un fournisseur administratif sans
--  échéance, marqué par sa date de départ (depart_le). Le montant dû est une
--  écriture « ajustement_manager » ; le gérant paie en caisse, la direction
--  avec tresorerie_payer_fournisseur_admin().
--  Spéc : docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'fournisseurs' and column_name = 'administratif_depuis') then
    raise exception 'Passez d''abord supabase_fournisseurs_administratifs.sql.';
  end if;
end $$;

ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS depart_le date;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS depart_motif text;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS travailleur_id uuid REFERENCES travailleurs(id) ON DELETE SET NULL;

-- Un droit d'ancien travailleur est toujours administratif.
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_depart_administratif_check
    CHECK (depart_le IS NULL OR type = 'administratif');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS fournisseurs_droits_anciens_idx
  ON fournisseurs (restaurant_id) WHERE depart_le IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Contrôle : droits enregistrés.
SELECT f.nom, r.nom AS resto, f.depart_le, f.depart_motif, f.credit_actuel
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.depart_le IS NOT NULL
 ORDER BY r.nom, f.depart_le DESC;
```

- [ ] **Step 2: Relire** — `travailleurs.id` est bien `uuid` (vérifié le 12/10/2026). Ne PAS exécuter la migration.

- [ ] **Step 3: Commit**

```bash
git add supabase_droits_anciens_travailleurs.sql
git commit -m "feat(equipe): migration des droits des anciens travailleurs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Résultat net — compté au fil des paiements

**Files:**
- Modify: `lib/creditFournisseursMois.js` (en-tête + boucle `for (const f of fournisseurs || [])`)
- Test: `lib/creditFournisseursMois.test.mjs`

**Interfaces:**
- Consumes: `estDroitAncienTravailleur` (Task 1).
- Produces : `creditFournisseursParRestoMois` ignore toute fiche avec `depart_le`.

- [ ] **Step 1: Write the failing test** — ajouter à la fin de `lib/creditFournisseursMois.test.mjs` :

```js
describe('droits des anciens travailleurs', () => {
  const four = [
    { id: 'awa', restaurant_id: 'lav', nom: 'Awa Koné', type: 'administratif', administratif_depuis: '2026-10-01', depart_le: '2026-10-03' },
    { id: 'odp', restaurant_id: 'lav', nom: 'ODP', type: 'administratif' },
  ]
  test('ni le montant dû ni ses paiements ne bougent la variation (la sortie de caisse suffit)', () => {
    const transactions = [
      { fournisseur_id: 'awa', date_point: '2026-10-03', reste: 300000, facture: 300000, paye: 0, point_id: null,
        saisi_par: 'manager', source: 'ajustement_manager', created_at: '2026-10-03T08:00:00Z' },
      { fournisseur_id: 'awa', date_point: '2026-10-10', reste: 200000, facture: 0, paye: 100000, point_id: 'p1',
        saisi_par: 'gerant', source: null, created_at: '2026-10-10T20:00:00Z' },
      { fournisseur_id: 'odp', date_point: '2026-10-05', reste: 1000, facture: 1000, paye: 0, point_id: 'p0',
        saisi_par: 'gerant', source: null, created_at: '2026-10-05T20:00:00Z' },
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-10'], fournisseurs: four, transactions })
    assert.deepEqual(r.lav['2026-10'], { debut: 0, fin: 1000, ajustements: 0, variation: 1000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/creditFournisseursMois.test.mjs`
Expected: FAIL — `fin: 201000` au lieu de `1000`.

- [ ] **Step 3: Implémentation** — dans `lib/creditFournisseursMois.js` :

  1. Ajouter l'import sous celui de `fournisseursAdmin.js` :
```js
import { estDroitAncienTravailleur } from './droitsAnciensTravailleurs.js'
```
  2. En tête de la boucle `for (const f of fournisseurs || []) {`, juste après `if (!f.restaurant_id) continue`, ajouter :
```js
    // Droits d'anciens travailleurs : comptés au fil des paiements, par la
    // sortie de caisse (gérant) ou la dépense direction — jamais par le crédit.
    if (estDroitAncienTravailleur(f)) continue
```
  3. Dans le commentaire d'en-tête, après le paragraphe « Fournisseurs administratifs (12/10/2026…) », ajouter :
```js
// Droits des anciens travailleurs (12/10/2026, lib/droitsAnciensTravailleurs.js) :
// écartés. Le montant dû n'est pas une charge du mois ; chaque paiement l'est,
// déjà retiré par l'encaissé (gérant) ou la dépense direction « administratif ».
```

- [ ] **Step 4: Run tests**

Run: `node lib/creditFournisseursMois.test.mjs && node lib/droitsAnciensTravailleurs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Vérifier qu'aucun paiement n'est compté deux fois** — lire `encaisseNetPoint` dans `lib/direction.js` et confirmer que les paiements fournisseurs du gérant (`fournisseurs_gerant` / sorties du point) sont bien retirés de l'encaissé ; lire `resultatsParRestoMois` et confirmer que les dépenses direction de catégorie `administratif` sont retirées (`compteDansResultat: true` dans `lib/direction.js:33`). Noter le résultat de la vérification dans le message de commit. Si un paiement gérant n'est PAS dans l'encaissé : s'arrêter et le signaler (ne pas improviser).

- [ ] **Step 6: Texte d'aide** — dans `app/tresorerie-resultats.js:130`, remplacer `exclus aussi PALMCI, Sécurité, Boss et Anciens travailleurs` par `exclus aussi PALMCI, Sécurité, Boss et les droits des anciens travailleurs, comptés quand ils sont payés`.

- [ ] **Step 7: Commit**

```bash
git add lib/creditFournisseursMois.js lib/creditFournisseursMois.test.mjs app/tresorerie-resultats.js
git commit -m "feat(resultats): droits des anciens travailleurs comptés au fil des paiements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Accès base `lib/droitsAnciensTravailleursDb.js`

**Files:**
- Create: `lib/droitsAnciensTravailleursDb.js`

**Interfaces:**
- Consumes: `estDroitAncienTravailleur`, `estAncienneFicheGlobale` (Task 1) ; `ecritureAjustementCredit` (`lib/creditsFournisseurs.js`) ; `chargerDerniersRestes(supabase, ids)` (`lib/derniersRestesFournisseurs.js`) ; `journaliser` (`lib/journal.js`) ; `aujourdhuiISO` (`lib/tresorerie.js`).
- Produces :
  - `chargerDroitsAnciens() → Promise<{ fiches, transactions, anciennes, archives }>`
  - `creerDroitAncien({ restaurantId, nom, travailleurId, departLe, motif, montant }, user) → Promise<string>` (id)
  - `modifierDroitAncien(fiche, { nom, departLe, motif, montantDu }, user) → Promise<void>` (`fiche.du` = dû actuel)
  - `remplacerAncienneFiche(fiche, user) → Promise<void>`
  - `user` = `{ userId, userNom }`

- [ ] **Step 1: Écrire le module**

```js
// Droits des anciens travailleurs — accès Supabase (logique pure :
// lib/droitsAnciensTravailleurs.js). Une fiche = un fournisseur administratif
// sans échéance, avec depart_le ; le montant dû est une écriture
// « ajustement_manager » (même chemin que « Modifier » dans Crédits).
import { estAncienneFicheGlobale, estDroitAncienTravailleur } from './droitsAnciensTravailleurs'
import { ecritureAjustementCredit } from './creditsFournisseurs'
import { chargerDerniersRestes } from './derniersRestesFournisseurs'
import { journaliser } from './journal'
import { supabase } from './supabase'
import { aujourdhuiISO } from './tresorerie'

const MIGRATION = 'Il faut d\'abord passer supabase_droits_anciens_travailleurs.sql dans Supabase.'
const traduire = e => (/depart_le|depart_motif|travailleur_id/.test(e?.message || '') ? new Error(MIGRATION) : e)
const ctx = (user, restaurantId) => ({ restaurantId, userId: user?.userId || null, userNom: user?.userNom || null })

// '*' : depart_le n'existe pas avant la migration (la liste reste alors vide).
export async function chargerDroitsAnciens() {
  const [admin, anciens, archives] = await Promise.all([
    supabase.from('fournisseurs').select('*').eq('type', 'administratif').order('nom'),
    supabase.from('fournisseurs').select('*').ilike('nom', '%ancien%').eq('actif', true),
    supabase.from('travailleurs').select('id, nom, restaurant_id, archived_at, archive_motif, type_contrat')
      .eq('statut', 'archive').order('archived_at', { ascending: false }),
  ])
  if (admin.error) throw admin.error
  const fiches = (admin.data || []).filter(estDroitAncienTravailleur)
  const ids = fiches.map(f => f.id)
  let transactions = []
  if (ids.length) {
    const { data, error } = await supabase.from('transactions_fournisseurs')
      .select('id, fournisseur_id, facture, paye, source, date_point, created_at')
      .in('fournisseur_id', ids).order('created_at')
    if (error) throw error
    transactions = data || []
  }
  return {
    fiches,
    transactions,
    anciennes: (anciens.data || []).filter(estAncienneFicheGlobale),
    archives: archives.data || [],
  }
}

async function ajuster(fournisseurId, delta, raison, user) {
  const e = ecritureAjustementCredit(delta)
  if (!e) return
  const { data: txId, error } = await supabase.rpc('inserer_transaction_hors_point', {
    p_fournisseur: fournisseurId, p_date: aujourdhuiISO(), p_facture: e.facture, p_paye: e.paye,
    p_saisi_par: 'manager', p_source: 'ajustement_manager', p_caissier_nom: user?.userNom || null,
  })
  if (error) throw error
  if (txId && raison) {
    await supabase.from('transactions_fournisseurs').update({ facture_correction_raison: raison }).eq('id', txId)
  }
}

export async function creerDroitAncien({ restaurantId, nom, travailleurId, departLe, motif, montant }, user) {
  const { data, error } = await supabase.from('fournisseurs').insert({
    nom: nom.trim(), type: 'administratif', restaurant_id: restaurantId, actif: true, facture_mensuelle: 0,
    depart_le: departLe, depart_motif: (motif || '').trim() || null, travailleur_id: travailleurId || null,
  }).select('id').single()
  if (error) throw traduire(error)
  await supabase.from('fournisseurs_restaurants').upsert(
    { fournisseur_id: data.id, restaurant_id: restaurantId, credit_actuel: 0 },
    { onConflict: 'fournisseur_id,restaurant_id' })
  await ajuster(data.id, Math.round(Number(montant) || 0), 'Droits à la sortie', user)
  journaliser('droit_ancien_travailleur_cree', { nom: nom.trim(), depart_le: departLe, motif, montant },
    ctx(user, restaurantId)).catch(() => {})
  return data.id
}

export async function modifierDroitAncien(fiche, { nom, departLe, motif, montantDu }, user) {
  const { error } = await supabase.from('fournisseurs').update({
    nom: nom.trim(), depart_le: departLe, depart_motif: (motif || '').trim() || null,
  }).eq('id', fiche.id)
  if (error) throw traduire(error)
  const delta = Math.round(Number(montantDu) || 0) - Math.round(Number(fiche.du) || 0)
  await ajuster(fiche.id, delta, 'Montant dû corrigé', user)
  journaliser('droit_ancien_travailleur_modifie', { nom: nom.trim(), depart_le: departLe, motif, ancien_du: fiche.du, nouveau_du: montantDu },
    ctx(user, fiche.restaurant_id)).catch(() => {})
}

// Ancienne fiche globale « ANCIEN TRAVAILLEURS » : remise à 0 (écriture, pas
// d'écrasement) puis désactivée. Son historique reste.
export async function remplacerAncienneFiche(fiche, user) {
  const derniers = await chargerDerniersRestes(supabase, [fiche.id])
  const reste = derniers[fiche.id] ? Number(derniers[fiche.id].reste) || 0 : Number(fiche.credit_actuel) || 0
  await ajuster(fiche.id, -reste, 'Remplacée par une fiche par ancien travailleur', user)
  const { error } = await supabase.from('fournisseurs').update({ actif: false }).eq('id', fiche.id)
  if (error) throw error
  journaliser('ancienne_fiche_travailleurs_remplacee', { nom: fiche.nom, reste }, ctx(user, fiche.restaurant_id)).catch(() => {})
}
```

- [ ] **Step 2: Lint** — `npx eslint lib/droitsAnciensTravailleursDb.js` → 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add lib/droitsAnciensTravailleursDb.js
git commit -m "feat(equipe): enregistrer les droits des anciens travailleurs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Onglet « Anciens travailleurs » dans Trésorerie → À payer

**Files:**
- Modify: `lib/tresorerie.js` (`PERMISSIONS`, `ONGLETS_A_PAYER`, `LIBELLES_ONGLET`, `categoriesVisibles`)
- Modify: `lib/tresorerie.test.mjs:497-507`
- Modify: `components/tresorerie/commun.js` (`STYLE_CATEGORIE`)
- Create: `components/tresorerie/anciensTravailleurs.js`
- Modify: `app/tresorerie-a-payer.js`

**Interfaces:**
- Consumes: Task 1 (`ONGLET_ANCIENS`, `resumeDroitsParResto`, `paiementsDroit`, `sousTitreDepart`) ; Task 4 (`chargerDroitsAnciens`, `creerDroitAncien`, `modifierDroitAncien`, `remplacerAncienneFiche`) ; `payerFournisseurAdminDirection(p, user)` et `chargerComptesTresorerie()` (`lib/tresorerieDb.js`) ; `MOTIFS_ARCHIVE` (`lib/equipe.js`).
- Produces : `export function OngletAnciensTravailleurs({ niveau, user, restaurants })`.

- [ ] **Step 1: Tests qui échouent** — dans `lib/tresorerie.test.mjs`, remplacer les deux tests l.497-507 par :

```js
  test('le RH saisit les sept charges, ne paie pas, ne voit pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('saisie_rh'), ['loyer', 'salaire', 'anciens_travailleurs'])
    assert.equal(peut('saisie_rh', 'saisir_charges'), true)
    assert.equal(peut('proprietaire', 'saisir_charges'), true)
    assert.equal(peut('lecture', 'saisir_charges'), false)
    assert.equal(peut('saisie_rh', 'payer'), false)
  })
  test('lecture : loyers, salaires, anciens travailleurs et la dette récente, pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('lecture'), ['loyer', 'salaire', 'anciens_travailleurs', 'dette_recente'])
    assert.deepEqual(categoriesVisibles('proprietaire').slice(-2), ['dette_recente', 'dette'])
  })
  test('anciens travailleurs : RH et managers saisissent, seule la direction paie', () => {
    for (const niv of ['saisie_rh', 'lecture', 'proprietaire']) assert.equal(peut(niv, 'saisir_anciens'), true)
    assert.equal(peut('lecture', 'payer'), false)
    assert.equal(peut('proprietaire', 'payer'), true)
  })
```

Run: `node lib/tresorerie.test.mjs` → FAIL sur ces trois tests.

- [ ] **Step 2: `lib/tresorerie.js`**
  - `PERMISSIONS` : ajouter `'saisir_anciens'` à la fin des listes `proprietaire`, `lecture` et `saisie_rh` ; au-dessus de `saisie_rh`, compléter le commentaire : `// … et, comme les managers, déclare les droits des anciens travailleurs.`
  - Remplacer :
```js
export const ONGLETS_A_PAYER = [...CATEGORIES_TRESORERIE, 'dette_recente', 'dette']
export const LIBELLES_ONGLET = { ...LIBELLES_CATEGORIE, bail: 'Bail', dette_recente: 'Dette récente' }
```
    par :
```js
// Anciens travailleurs : fournisseurs administratifs à part (lib/droitsAnciensTravailleurs.js).
export const ONGLETS_A_PAYER = [...CATEGORIES_TRESORERIE, 'anciens_travailleurs', 'dette_recente', 'dette']
export const LIBELLES_ONGLET = { ...LIBELLES_CATEGORIE, bail: 'Bail', dette_recente: 'Dette récente', anciens_travailleurs: 'Anciens travailleurs' }
```
  - Dans `categoriesVisibles` : `if (niveau === 'saisie_rh') return [...CATEGORIES_TRESORERIE, 'anciens_travailleurs']`.
  - Mettre à jour le commentaire au-dessus : `// Onglets de « À payer » : loyers, salaires, anciens travailleurs, puis la dette récente et les dettes (toutes catégories confondues).`

Run: `node lib/tresorerie.test.mjs` → PASS. Puis `grep -rn "ONGLETS_A_PAYER\|categoriesVisibles" app components lib --include=*.js` : vérifier que `app/tresorerie-restaurant.js:55` (filtre sur `CATEGORIES_TRESORERIE`) n'est pas touché par le nouvel onglet.

- [ ] **Step 3: `components/tresorerie/commun.js`** — dans `STYLE_CATEGORIE`, après `dette_recente` :
```js
  anciens_travailleurs: { icone: 'account-arrow-right-outline', couleur: '#B45309' },
```

- [ ] **Step 4: Créer `components/tresorerie/anciensTravailleurs.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie → À payer → Anciens travailleurs : ce qu'on doit aux travailleurs
// partis, une fiche par travailleur, regroupées par restaurant.
// RH et managers créent / modifient ; la direction paie (banque, espèces de la
// trésorerie, coffre) ; le gérant paie en caisse dans ses Déductions.
// Spéc : docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Switch, Text, View } from 'react-native'

import ChampDate from '../ChampDate'
import {
  Bouton, Champ, ChampMontant, Feuille, Hero, HeroCase, ItemIcone, Pastille, Puces, TitreSection,
  styleCategorie, useStylesTreso,
} from './commun'
import { ONGLET_ANCIENS, paiementsDroit, resumeDroitsParResto, sousTitreDepart } from '../../lib/droitsAnciensTravailleurs'
import {
  chargerDroitsAnciens, creerDroitAncien, modifierDroitAncien, remplacerAncienneFiche,
} from '../../lib/droitsAnciensTravailleursDb'
import { MOTIFS_ARCHIVE } from '../../lib/equipe'
import { aujourdhuiISO, fmt, formatDateFR, peut } from '../../lib/tresorerie'
import { chargerComptesTresorerie, payerFournisseurAdminDirection } from '../../lib/tresorerieDb'

const style = styleCategorie(ONGLET_ANCIENS)

export function OngletAnciensTravailleurs({ niveau, user, restaurants = [] }) {
  const { styles, colors } = useStylesTreso()
  const [donnees, setDonnees] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [restantsSeulement, setRestantsSeulement] = useState(true)
  const [edition, setEdition] = useState(null)   // { fiche | null }
  const [detail, setDetail] = useState(null)     // fiche résumée
  const [paiement, setPaiement] = useState(null) // fiche résumée

  const charger = useCallback(async () => {
    setErreur(null)
    try { setDonnees(await chargerDroitsAnciens()) } catch (e) { setErreur(e?.message || 'Chargement impossible.') }
  }, [])
  useEffect(() => { charger() }, [charger])

  const parResto = useMemo(
    () => (donnees ? resumeDroitsParResto(donnees.fiches, donnees.transactions) : {}),
    [donnees],
  )
  const nomResto = id => restaurants.find(r => r.id === id)?.nom || '—'
  const peutSaisir = peut(niveau, 'saisir_anciens')
  const peutPayer = peut(niveau, 'payer')

  if (erreur) return <Text style={styles.vide}>{erreur}</Text>
  if (!donnees) return <ActivityIndicator color={colors.primary} style={{ paddingVertical: 24 }} />

  const groupes = Object.entries(parResto)
    .map(([rid, g]) => ({ rid, ...g, fiches: g.fiches.filter(f => !restantsSeulement || !f.solde) }))
    .filter(g => g.fiches.length)
    .sort((a, b) => nomResto(a.rid).localeCompare(nomResto(b.rid)))
  const total = Object.values(parResto).reduce((s, g) => (
    { du: s.du + g.du, paye: s.paye + g.paye, reste: s.reste + g.reste }), { du: 0, paye: 0, reste: 0 })

  return (
    <>
      <Hero icone={style.icone} titre="Anciens travailleurs · reste à payer" valeur={`${fmt(total.reste)} F`}
        sous="Droits dus aux travailleurs partis, payés par le gérant en caisse ou par la direction">
        <View style={styles.heroCases}>
          <HeroCase label="Dû" couleur="#FDBA74" valeur={fmt(total.du)} />
          <HeroCase label="Déjà payé" couleur="#86EFAC" valeur={fmt(total.paye)} />
        </View>
      </Hero>

      {!groupes.length && (
        <Text style={styles.vide}>{restantsSeulement ? 'Rien à payer aux anciens travailleurs.' : 'Aucun ancien travailleur enregistré.'}</Text>
      )}
      {groupes.map(g => (
        <View key={g.rid} style={styles.carte}>
          <View style={[styles.carteEntete, { marginBottom: 12 }]}>
            <Pastille icone="storefront-outline" couleur={style.couleur} taille={36} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitre, { fontSize: 16 }]}>{nomResto(g.rid)}</Text>
              <Text style={styles.petit}>{g.fiches.length} ancien{g.fiches.length > 1 ? 's' : ''} travailleur{g.fiches.length > 1 ? 's' : ''}</Text>
            </View>
            <View style={[styles.etatPilule, { backgroundColor: g.reste ? colors.errorLight : colors.successLight }]}>
              <Text style={[styles.etatPiluleTxt, { color: g.reste ? colors.errorDark : colors.successDark }]}>
                {g.reste ? `reste ${fmt(g.reste)}` : 'tout payé'}
              </Text>
            </View>
          </View>
          {g.fiches.map(f => (
            <ItemIcone key={f.id} onPress={() => setDetail(f)}
              icone="account-outline" couleur={f.solde ? colors.success : style.couleur}
              titre={f.nom}
              sous={`${sousTitreDepart(f)} · dû ${fmt(f.du)} · payé ${fmt(f.paye)}${f.nbPaiements > 1 ? ` en ${f.nbPaiements} fois` : ''}`}
              droite={f.solde ? 'Soldé' : `${fmt(f.reste)} F`}
              couleurDroite={f.solde ? colors.success : colors.error}
            />
          ))}
        </View>
      ))}

      <View style={[styles.ligne, { marginTop: 4 }]}>
        <Text style={styles.ligneLabel}>Restants seulement</Text>
        <Switch value={restantsSeulement} onValueChange={setRestantsSeulement}
          trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
      </View>

      {peutSaisir && (
        <View style={{ gap: 8, marginTop: 10 }}>
          <Bouton icone="account-plus-outline" titre="Ancien travailleur" onPress={() => setEdition({ fiche: null })} />
        </View>
      )}

      {peutSaisir && donnees.anciennes.length > 0 && (
        <AnciennesFiches fiches={donnees.anciennes} nomResto={nomResto} user={user} apres={charger} />
      )}

      <FeuilleDroit demande={edition} restaurants={restaurants} archives={donnees.archives} user={user}
        onFermer={() => setEdition(null)} apres={charger} />
      <FeuilleDetailDroit fiche={detail} transactions={donnees.transactions} nomResto={nomResto}
        peutSaisir={peutSaisir} peutPayer={peutPayer}
        onFermer={() => setDetail(null)}
        onModifier={f => { setDetail(null); setEdition({ fiche: f }) }}
        onPayer={f => { setDetail(null); setPaiement(f) }} />
      <FeuillePayerDroit fiche={paiement} nomResto={nomResto} user={user}
        onFermer={() => setPaiement(null)} apres={charger} />
    </>
  )
}

// ── Création / modification ─────────────────────────────────────────────────

function FeuilleDroit({ demande, restaurants, archives, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const fiche = demande?.fiche || null
  const [restaurantId, setRestaurantId] = useState(null)
  const [travailleurId, setTravailleurId] = useState(null) // null = nom tapé
  const [nom, setNom] = useState('')
  const [departLe, setDepartLe] = useState(aujourdhuiISO())
  const [motif, setMotif] = useState('Démission')
  const [autre, setAutre] = useState('')
  const [montant, setMontant] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!demande) return
    const f = demande.fiche
    setRestaurantId(f?.restaurant_id || null)
    setTravailleurId(f?.travailleur_id || null)
    setNom(f?.nom || '')
    setDepartLe(f?.depart_le || aujourdhuiISO())
    const m = f?.depart_motif || 'Démission'
    setMotif(MOTIFS_ARCHIVE.includes(m) ? m : 'Autre')
    setAutre(MOTIFS_ARCHIVE.includes(m) ? '' : m)
    setMontant(f ? String(Math.round(f.du || 0)) : '')
  }, [demande])

  if (!demande) return null
  const archivesResto = archives.filter(t => t.restaurant_id === restaurantId)

  function choisirArchive(id) {
    const t = archives.find(x => x.id === id)
    setTravailleurId(id)
    if (!t) return
    setNom(t.nom || '')
    if (t.archived_at) setDepartLe(String(t.archived_at).slice(0, 10))
    if (t.archive_motif) {
      setMotif(MOTIFS_ARCHIVE.includes(t.archive_motif) ? t.archive_motif : 'Autre')
      setAutre(MOTIFS_ARCHIVE.includes(t.archive_motif) ? '' : t.archive_motif)
    }
  }

  async function enregistrer() {
    const v = parseInt(montant, 10) || 0
    if (!fiche && !restaurantId) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (!nom.trim()) { Alert.alert('Nom manquant', 'Choisissez ou écrivez le nom du travailleur.'); return }
    if (!fiche && v <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant dû au travailleur.'); return }
    const m = motif === 'Autre' ? (autre.trim() || 'Autre') : motif
    setOccupe(true)
    try {
      if (fiche) await modifierDroitAncien(fiche, { nom, departLe, motif: m, montantDu: v }, user)
      else await creerDroitAncien({ restaurantId, nom, travailleurId, departLe, motif: m, montant: v }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={fiche ? `Modifier · ${fiche.nom}` : 'Ancien travailleur'}>
      {!fiche && (
        <>
          <Text style={styles.label}>Restaurant</Text>
          <Puces options={restaurants.map(r => ({ valeur: r.id, label: r.nom }))} valeur={restaurantId}
            onChange={v => { setRestaurantId(v); setTravailleurId(null); setNom('') }} />
          {restaurantId && archivesResto.length > 0 && (
            <>
              <Text style={styles.label}>Travailleur archivé</Text>
              <Puces options={[...archivesResto.map(t => ({ valeur: t.id, label: t.nom })), { valeur: null, label: 'Autre nom…' }]}
                valeur={travailleurId} onChange={v => (v ? choisirArchive(v) : (setTravailleurId(null), setNom('')))} />
            </>
          )}
        </>
      )}
      {(fiche || !travailleurId) && (
        <Champ label="Nom du travailleur" value={nom} onChangeText={setNom} placeholder="Ex : Awa Koné" />
      )}
      <ChampDate label="A cessé de travailler le" styleLabel={styles.label} valeur={departLe} onChange={setDepartLe} maxDate={aujourdhuiISO()} />
      <Text style={styles.label}>Motif</Text>
      <Puces options={MOTIFS_ARCHIVE.map(m => ({ valeur: m, label: m }))} valeur={motif} onChange={setMotif} />
      {motif === 'Autre' && <Champ label="Préciser le motif" value={autre} onChangeText={setAutre} placeholder="Ex : Abandon de poste" />}
      <ChampMontant label={fiche ? 'Montant dû au total' : 'Montant dû'} valeur={montant} onChange={setMontant} />
      {fiche && (
        <Text style={[styles.petit, { marginBottom: 10 }]}>
          Changer le montant ajoute une correction ; les paiements déjà faits ne bougent pas.
        </Text>
      )}
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Détail : paiements, puis Payer / Modifier ───────────────────────────────

function FeuilleDetailDroit({ fiche, transactions, nomResto, peutSaisir, peutPayer, onFermer, onModifier, onPayer }) {
  const { styles, colors } = useStylesTreso()
  if (!fiche) return null
  const paiements = paiementsDroit(transactions.filter(t => t.fournisseur_id === fiche.id))
  return (
    <Feuille visible onFermer={onFermer} titre={fiche.nom}>
      <Text style={styles.petit}>{nomResto(fiche.restaurant_id)} · {sousTitreDepart(fiche)}</Text>
      <View style={[styles.heroCases, { marginVertical: 12 }]}>
        <HeroCase label="Dû" couleur={colors.text} valeur={fmt(fiche.du)} />
        <HeroCase label="Payé" couleur={colors.success} valeur={fmt(fiche.paye)} />
        <HeroCase label="Reste" couleur={colors.error} valeur={fmt(Math.max(0, fiche.reste))} />
      </View>
      <TitreSection icone="cash-multiple" couleur={style.couleur} titre="Paiements" droite={`${paiements.length}`} />
      {paiements.length === 0
        ? <Text style={styles.vide}>Aucun paiement pour l'instant.</Text>
        : paiements.map(p => (
          <ItemIcone key={p.id} icone={p.par === 'Direction' ? 'bank-outline' : 'cash-register'} couleur={colors.success}
            titre={`${fmt(p.montant)} F`} sous={`${formatDateFR(p.date)} · ${p.par}`} />
        ))}
      <View style={{ gap: 8, marginTop: 12 }}>
        {peutPayer && fiche.reste > 0 && <Bouton icone="cash-fast" titre="Payer (direction)" onPress={() => onPayer(fiche)} />}
        {peutSaisir && <Bouton secondaire icone="pencil-outline" titre="Modifier" onPress={() => onModifier(fiche)} />}
      </View>
      <Text style={[styles.petit, { marginTop: 10 }]}>Le gérant paie en espèces dans Déductions gérant → Admin.</Text>
    </Feuille>
  )
}

// ── Paiement par la direction ───────────────────────────────────────────────

function FeuillePayerDroit({ fiche, nomResto, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [comptes, setComptes] = useState([])
  const [source, setSource] = useState(null)
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!fiche) return
    setMontant(String(Math.max(0, Math.round(fiche.reste))))
    setDate(aujourdhuiISO())
    setSource(null)
    chargerComptesTresorerie().then(setComptes).catch(() => setComptes([]))
  }, [fiche])

  if (!fiche) return null
  const v = parseInt(montant, 10) || 0

  async function enregistrer() {
    if (v <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant payé.'); return }
    if (v > fiche.reste) { Alert.alert('Montant trop élevé', `Il ne reste que ${fmt(fiche.reste)} F à payer.`); return }
    if (!source) { Alert.alert('Compte manquant', 'D\'où sort l\'argent ?'); return }
    setOccupe(true)
    try {
      await payerFournisseurAdminDirection({ fournisseur: fiche, date, montant: v, source, note: 'Droits ancien travailleur' }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Paiement non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Payer · ${fiche.nom}`}>
      <Text style={styles.petit}>{nomResto(fiche.restaurant_id)} · reste {fmt(fiche.reste)} F</Text>
      <ChampMontant label="Montant payé" valeur={montant} onChange={setMontant} />
      <ChampDate label="Date du paiement" styleLabel={styles.label} valeur={date} onChange={setDate} maxDate={aujourdhuiISO()} />
      <Text style={styles.label}>Payé depuis</Text>
      <Puces options={[...comptes.map(c => ({ valeur: c.id, label: c.nom })), { valeur: 'coffre', label: 'Coffre' }]}
        valeur={source} onChange={setSource} />
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        Noté dans Dépenses direction ; compte comme une charge du restaurant ce mois-ci.
      </Text>
      <Bouton titre="Enregistrer le paiement" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Anciennes fiches « ANCIEN TRAVAILLEURS » (une par restaurant) ───────────

function AnciennesFiches({ fiches, nomResto, user, apres }) {
  const { styles, colors } = useStylesTreso()
  const [occupe, setOccupe] = useState(null)

  function remplacer(f) {
    const reste = Number(f.credit_actuel) || 0
    Alert.alert('Fiche remplacée ?',
      `${f.nom.trim()} · ${nomResto(f.restaurant_id)}${reste ? ` : ${fmt(reste)} F seront remis à 0` : ''}. Saisissez d'abord une fiche par travailleur. L'historique est gardé.`, [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Remplacer', onPress: async () => {
            setOccupe(f.id)
            try { await remplacerAncienneFiche(f, user); await apres() } catch (e) { Alert.alert('Impossible', e?.message || 'Réessayez.') }
            setOccupe(null)
          },
        },
      ])
  }

  return (
    <>
      <TitreSection icone="archive-outline" couleur={colors.textMuted} titre="Anciennes fiches à remplacer" droite={`${fiches.length}`} />
      <Text style={[styles.petit, { marginBottom: 8 }]}>
        Avant le 12/10/2026, un seul fournisseur « Ancien travailleurs » par restaurant. Une fois les fiches par travailleur saisies, remplacez-le.
      </Text>
      {fiches.map(f => (
        <ItemIcone key={f.id} onPress={() => remplacer(f)} icone="account-group-outline" couleur={colors.textMuted}
          titre={`${f.nom.trim()} · ${nomResto(f.restaurant_id)}`}
          sous={occupe === f.id ? 'Remplacement…' : 'Toucher pour la remplacer'}
          droite={`${fmt(Number(f.credit_actuel) || 0)} F`} />
      ))}
    </>
  )
}
```

- [ ] **Step 5: Brancher dans `app/tresorerie-a-payer.js`**
  1. Import : `import { OngletAnciensTravailleurs } from '../components/tresorerie/anciensTravailleurs'` et `import { ONGLET_ANCIENS } from '../lib/droitsAnciensTravailleurs'`.
  2. Remplacer `{onglet && (` (le `<Hero …>` du haut de la liste) par `{onglet && onglet !== ONGLET_ANCIENS && (`.
  3. Juste après la fermeture de ce bloc Hero, ajouter :
```js
            {onglet === ONGLET_ANCIENS && (
              <OngletAnciensTravailleurs niveau={niveau} user={user} restaurants={donnees.restaurants} />
            )}
```
  4. En-tête du fichier : ajouter la ligne `// Anciens travailleurs : components/tresorerie/anciensTravailleurs.js (droits dus aux travailleurs partis).`
  5. Vérifier que `resteOnglet` / `dusOnglet` donnent `0` / `[]` pour cet onglet (aucun dû n'a cette catégorie) : pas d'autre changement.

- [ ] **Step 6: Vérifier** — `npm run lint` (0 erreur), `for f in lib/*.test.mjs; do node "$f"; done` (0 échec), `npx expo export -p web` (compile). Vérifier que `useStylesTreso().styles` contient bien `heroCases`, `ligne`, `ligneLabel`, `carte` (utilisés dans `app/tresorerie-a-payer.js`) ; sinon reprendre les mêmes noms qu'à l'écran À payer.

- [ ] **Step 7: Commit**

```bash
git add lib/tresorerie.js lib/tresorerie.test.mjs components/tresorerie/commun.js components/tresorerie/anciensTravailleurs.js app/tresorerie-a-payer.js
git commit -m "feat(tresorerie): onglet Anciens travailleurs dans À payer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Équipe — « Lui doit-on de l'argent ? » après l'archivage d'un CDI

**Files:**
- Modify: `components/equipe/Modales.js` (nouvelle fenêtre `ModalDroitsDus`)
- Modify: `app/equipe.js` (`archiver`, `useApp`, montage)

**Interfaces:**
- Consumes: `proposerDroits` (Task 1), `creerDroitAncien` (Task 4).
- Produces : `export function ModalDroitsDus({ trav, motif, styles, onFermer, onEnregistrer })` — `onEnregistrer(montant)`.

- [ ] **Step 1: `ModalDroitsDus`** — dans `components/equipe/Modales.js`, après `ModalArchive` (réutilise `FondModal`, `EnTete` et les styles de la fenêtre d'archivage) :

```js
// ── Droits dus après l'archivage d'un CDI ────────────────────────────────────
// Deux vrais boutons, pas d'Alert (un menu à 3 choix perd le 3e sur le web).
export function ModalDroitsDus({ trav, motif, styles, onFermer, onEnregistrer }) {
  const [montant, setMontant] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (trav) setMontant('') }, [trav])
  if (!trav) return null
  const v = parseInt(montant, 10) || 0

  async function enregistrer() {
    if (v <= 0) return
    setSaving(true)
    await onEnregistrer(v)
    setSaving(false)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <FondModal styles={styles}>
        <ScrollView style={styles.modal} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <EnTete styles={styles} titre="Lui doit-on de l'argent ?" onFermer={onFermer} />
          <Text style={styles.modalLabel}>{trav.nom} (CDI) · {motif}</Text>
          <Text style={styles.modalLabel}>Montant dû (FCFA)</Text>
          <TextInput style={[styles.modalInput, { fontSize: 18, fontWeight: '700' }]} value={montant}
            onChangeText={t => setMontant(t.replace(/[^0-9]/g, ''))} keyboardType="numeric"
            placeholder="0" placeholderTextColor="#999" />
          <Text style={[styles.modalLabel, { fontWeight: '400' }]}>
            Le droit s'ajoute dans Trésorerie → À payer → Anciens travailleurs. Le gérant pourra le payer en caisse.
          </Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            <TouchableOpacity style={[styles.modalConfirm, { flex: 0 }, (v <= 0 || saving) && { opacity: 0.5 }]}
              onPress={enregistrer} disabled={v <= 0 || saving}>
              <Text style={styles.modalConfirmTxt}>{saving ? 'Enregistrement…' : 'Enregistrer ce montant dû'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalCancel, { flex: 0 }]} onPress={onFermer}>
              <Text style={styles.modalCancelTxt}>Rien n'est dû</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      </FondModal>
    </Modal>
  )
}
```

- [ ] **Step 2: `app/equipe.js`**
  1. `const { roleActif, isManager } = useApp() ?? {}` → `const { roleActif, isManager, userId, userNom } = useApp() ?? {}`.
  2. Imports : ajouter `ModalDroitsDus` à l'import de `../components/equipe/Modales`, puis `import { proposerDroits } from '../lib/droitsAnciensTravailleurs'` et `import { creerDroitAncien } from '../lib/droitsAnciensTravailleursDb'` ; `aujourdhuiISO` depuis `../lib/contrats` s'il n'est pas déjà importé.
  3. État : `const [droitsDus, setDroitsDus] = useState(null) // { trav, motif } après archivage d'un CDI`.
  4. Remplacer `archiver` par :
```js
  async function archiver(trav, motif) {
    await db.archiverTravailleur(trav, motif)
    setAArchiver(null); setFiche(null)
    charger()
    // CDI : ses droits de fin de contrat se saisissent tout de suite.
    if (proposerDroits(trav)) setDroitsDus({ trav, motif })
    else Alert.alert('Archivé', `${trav.nom} a été archivé.`)
  }

  async function enregistrerDroits(montant) {
    const { trav, motif } = droitsDus
    try {
      await creerDroitAncien({
        restaurantId: trav.restaurant_id, nom: trav.nom, travailleurId: trav.id,
        departLe: aujourdhuiISO(), motif, montant,
      }, { userId, userNom })
      setDroitsDus(null)
      Alert.alert('Enregistré', `${trav.nom} a été archivé. Ses droits sont dans Trésorerie → À payer → Anciens travailleurs.`)
    } catch (e) {
      Alert.alert('Droits non enregistrés', `${trav.nom} est bien archivé. ${e?.message || 'Réessayez depuis Trésorerie → À payer.'}`)
    }
  }
```
  5. Monter la fenêtre juste après `<ModalArchive … />` :
```js
      <ModalDroitsDus trav={droitsDus?.trav} motif={droitsDus?.motif} styles={styles}
        onFermer={() => { const t = droitsDus?.trav; setDroitsDus(null); if (t) Alert.alert('Archivé', `${t.nom} a été archivé.`) }}
        onEnregistrer={enregistrerDroits} />
```
  6. Vérifier que l'objet `trav` passé à `archiver` porte bien `type_contrat` et `restaurant_id` (lecture de `travailleurs` dans `lib/equipeDb.js`) ; sinon ajouter `type_contrat` au `select` qui charge l'équipe.

- [ ] **Step 3: Vérifier** — `npm run lint` → 0 erreur ; `npx expo export -p web` compile.

- [ ] **Step 4: Commit**

```bash
git add components/equipe/Modales.js app/equipe.js lib/equipeDb.js
git commit -m "feat(equipe): saisir les droits d'un CDI à son archivage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Déductions gérant et Crédits fournisseurs

**Files:**
- Modify: `app/deductions-gerant.js` (chargement l.57, onglet Administratifs l.383-430)
- Modify: `components/deductions/OngletFournisseurs.js` (prop `sousTitre`)
- Modify: `app/credits-fournisseurs.js` (carte l.686-740, onglet Administratifs l.991-1006, exports l.482 et l.548)

**Interfaces:**
- Consumes: `estDroitAncienTravailleur`, `sousTitreDepart`, `droitAAfficherGerant` (Task 1).

- [ ] **Step 1: Déductions — chargement** : `app/deductions-gerant.js:57` `.select('id, nom, type')` → `.select('*')` (commentaire : `// '*' : depart_le (droits des anciens travailleurs), absent avant migration.`).

- [ ] **Step 2: Déductions — onglet Administratifs** : après `const { marchandise, administratifs } = separerFournisseurs(fournisseursList)` ajouter :
```js
  // Droits d'anciens travailleurs soldés : hors de la liste, sauf déjà saisis ce jour.
  const adminAffiches = administratifs.filter(f => droitAAfficherGerant(f, getCreditVeille(f), !!fournisseursGerantCaisse[f.id]))
```
  et dans `<OngletFournisseurs` de l'onglet `administratifs` : `fournisseursList={adminAffiches}` et la prop `sousTitre={f => (estDroitAncienTravailleur(f) ? `Ancien travailleur · ${sousTitreDepart(f)}` : null)}`. Imports depuis `../lib/droitsAnciensTravailleurs`. Garder `idsAdmin` calculé sur `administratifs` (pas sur `adminAffiches`) pour que `resumeDeductions` compte toutes les saisies.

- [ ] **Step 3: `OngletFournisseurs`** — ajouter la prop `sousTitre = null` à la signature, puis juste après la `</View>` qui ferme la ligne titre/étiquette (avant `four.caissier_facture`) :
```js
              {sousTitre?.(four) ? <Text style={styles.petitDoux}>{sousTitre(four)}</Text> : null}
```

- [ ] **Step 4: Crédits — carte** : dans `renderCard(f)`, remplacer
```js
            {estAdministratif(f) ? (
              <Text style={styles.cardResto} numberOfLines={1}>{libelleEcheance(f, aujourdhuiISO())}</Text>
            ) : null}
```
  par
```js
            {estAdministratif(f) ? (
              <Text style={styles.cardResto} numberOfLines={1}>
                {estDroitAncienTravailleur(f) ? `Ancien travailleur · ${sousTitreDepart(f)}` : libelleEcheance(f, aujourdhuiISO())}
              </Text>
            ) : null}
```
  et la condition du bouton « Réglages » `{peutGererAdmin && (` → `{peutGererAdmin && !estDroitAncienTravailleur(f) && (` (un droit se règle dans Trésorerie → À payer).

- [ ] **Step 5: Crédits — onglet Administratifs** : au-dessus du `return`, à côté de `totalAdmin` :
```js
  // Droits d'anciens travailleurs : section à part, soldés cachés (historique dans À payer).
  const droitsAnciens = administratifs.filter(f => estDroitAncienTravailleur(f) && (f.credit_actuel || 0) > 0)
  const adminSansDroits = administratifs.filter(f => !estDroitAncienTravailleur(f))
```
  Dans le bloc `ongletAdmin`, remplacer `administratifs.length === 0` / `administratifs.map(f => renderCard(f))` par `adminSansDroits…`, puis ajouter après :
```js
            {droitsAnciens.length > 0 && (
              <>
                <View style={{ height: 8 }} />
                {titreSection('account-arrow-right-outline', 'Anciens travailleurs',
                  `${droitsAnciens.length} · ${fmt(droitsAnciens.reduce((s, f) => s + (f.credit_actuel || 0), 0))}`, '#B45309', '#FEF3C7')}
                {droitsAnciens.map(f => renderCard(f))}
              </>
            )}
```
  (`totalAdmin` reste sur `administratifs` : les droits comptent dans « Dû aux administrations ».)

- [ ] **Step 6: Crédits — exports** : l.548 (Excel) `libelleEcheance(f, aujourdhui)` → `estDroitAncienTravailleur(f) ? sousTitreDepart(f) : libelleEcheance(f, aujourdhui)` ; l.482 (PDF) : après `<strong>${f.nom}</strong>` ajouter `${estDroitAncienTravailleur(f) ? ` <span style="color:#999">(${sousTitreDepart(f)})</span>` : ''}`. Import `estDroitAncienTravailleur, sousTitreDepart` depuis `../lib/droitsAnciensTravailleurs`.

- [ ] **Step 7: Vérifier** — `npm run lint` → 0 erreur ; tests `lib/*.test.mjs` → 0 échec ; `npx expo export -p web` compile.

- [ ] **Step 8: Commit**

```bash
git add app/deductions-gerant.js components/deductions/OngletFournisseurs.js app/credits-fournisseurs.js
git commit -m "feat(fournisseurs): anciens travailleurs dans les déductions gérant et les crédits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Vérification finale et livraison

- [ ] **Step 1:** `npm run lint` → 0 erreur ; `for f in lib/*.test.mjs; do node "$f"; done` → 0 échec ; `npx expo export -p web` → compile. Chercher une chaîne SANS accent dans le bundle si besoin (`grep -c "Anciens travailleurs" dist/…` donne 0 à cause des accents échappés : utiliser `grep -c "anciens_travailleurs"`).
- [ ] **Step 2:** Relire la spéc section par section et cocher : onglet À payer (§2), archivage CDI (§3), gérant (§4), crédits (§5), résultat net (§6), anciennes fiches globales (décision du 12/10 : remplacement à la main).
- [ ] **Step 3:** `graphify update .` puis commit `chore: graphe graphify à jour`.
- [ ] **Step 4:** `git push`. NE PAS publier (ni Vercel ni EAS).
- [ ] **Step 5:** Mémoire : créer `droits-anciens-travailleurs.md` (type project) — migration `supabase_droits_anciens_travailleurs.sql` à passer APRÈS celle des administratifs ; Lavage 560 000 F et Oasis −10 000 F sur l'ancienne fiche « ANCIEN TRAVAILLEURS » à répartir puis « remplacer » ; pas publié. Ajouter la ligne dans `MEMORY.md`.
- [ ] **Step 6:** Résumé à l'utilisateur en français simple (mémoire « Résumé après build ») : ce qui change pour le RH, le gérant, la direction ; ce qu'il reste à faire (passer la migration, saisir les fiches de Lavage, remplacer les anciennes fiches).
