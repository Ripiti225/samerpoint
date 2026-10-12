# Fournisseurs administratifs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TEE, ITS, Timbre, CNPS, Bail (et mairie, ODP…) deviennent des fournisseurs « administratifs » par restaurant, dont le crédit monte seul (mensuel ou annuel), payés par le gérant depuis Déductions gérant ; ils quittent la Trésorerie.

**Architecture:** On réutilise la colonne existante `fournisseurs.type` (nouvelle valeur `administratif`) et le mécanisme existant de facture mensuelle automatique (`facture_mensuelle`, `facture_mensuelle_depuis`, `appliquer_factures_mensuelles()`), étendu d'une périodicité annuelle. La logique pure va dans `lib/fournisseursAdmin.js` (testée) ; les écrans filtrent avec `estAdministratif()`. La Trésorerie cache les dûs des catégories `cnps, impot, its, tee, bail` et n'en crée plus.

**Tech Stack:** Expo / React Native web, Supabase (PostgREST + plpgsql), tests `node:test` (`lib/*.test.mjs`).

Spéc : `docs/superpowers/specs/2026-10-12-fournisseurs-administratifs-design.md`

## Global Constraints

- Tout libellé visible en français ; montants en FCFA entiers.
- Dates choisies au calendrier ou par puces, jamais tapées (`ChampDate`) — voir mémoire « Dates au calendrier ».
- Alert web : 2 boutons maximum.
- Requêtes de lecture susceptibles de dépasser 1 000 lignes : paginées (`toutesLesLignes`).
- Ne jamais sélectionner une colonne créée par la migration dans une requête existante (avant migration, PostgREST échoue) : utiliser `select('*')` là où on a besoin de `facture_periodicite` / `administratif_depuis`. `type` existe déjà : sélection nommée permise.
- Le journal (`journaliser`) ne bloque jamais : `.catch(() => {})`.
- Vérifs finales : `npm run lint` 0 erreur ; `for f in lib/*.test.mjs; do node "$f"; done` 0 échec ; `npx expo export -p web` compile. Ne PAS lancer `expo start` / localhost.
- Livraison : commit + push seulement. Pas de Vercel, pas d'EAS. Commits en français, conventionnels, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Préfixer les commandes git par `DEVELOPER_DIR=/Library/Developer/CommandLineTools` si git se plaint de Xcode.

---

### Task 1: Logique pure `lib/fournisseursAdmin.js`

**Files:**
- Create: `lib/fournisseursAdmin.js`
- Test: `lib/fournisseursAdmin.test.mjs`

**Interfaces:**
- Produces :
  - `TYPE_ADMIN = 'administratif'`
  - `estAdministratif(f) → boolean` (f.type === 'administratif')
  - `separerFournisseurs(liste) → { marchandise: [], administratifs: [] }` (ordre conservé)
  - `totalDu(liste) → number` — somme des `credit_actuel` > 0 des fiches `actif !== false`
  - `prochaineEcheance(f, aujourdhuiISO) → 'AAAA-MM-01' | null` — premier mois facturé ≥ mois suivant le mois courant… voir code
  - `libelleEcheance(f, aujourdhuiISO) → string` — « 25 000 F / mois · prochain : 1er novembre 2026 » ou « 120 000 F / an · prochain : 1er mars 2027 » ; « Aucune échéance automatique » si montant 0
  - `choixMoisDepart(periodicite, aujourdhuiISO, actuel) → ['AAAA-MM-01', …]` — mensuel : mois courant + suivant (+ actuel) ; annuel : les 12 mois à partir du mois courant (+ actuel), triés, sans doublon
  - `champsEcheance({ montant, periodicite, depuis }, aujourdhuiISO) → { facture_mensuelle, facture_periodicite, facture_mensuelle_depuis }`

- [ ] **Step 1: Write the failing test**

```js
// lib/fournisseursAdmin.test.mjs
// Tests de lib/fournisseursAdmin.js — fournisseurs administratifs (impôts, CNPS, bail…).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  TYPE_ADMIN, champsEcheance, choixMoisDepart, estAdministratif, libelleEcheance,
  prochaineEcheance, separerFournisseurs, totalDu,
} from './fournisseursAdmin.js'

describe('découpage', () => {
  test('administratif reconnu par le type seulement, pas par le nom', () => {
    assert.equal(estAdministratif({ type: TYPE_ADMIN, nom: 'Albert' }), true)
    assert.equal(estAdministratif({ type: 'cotisation', nom: 'CNPS' }), false)
    assert.equal(estAdministratif({ nom: 'TEE' }), false)
    assert.equal(estAdministratif(null), false)
  })
  test('separerFournisseurs garde l’ordre', () => {
    const l = [{ id: 'a', type: 'fournisseur' }, { id: 'b', type: TYPE_ADMIN }, { id: 'c' }, { id: 'd', type: TYPE_ADMIN }]
    const r = separerFournisseurs(l)
    assert.deepEqual(r.marchandise.map(f => f.id), ['a', 'c'])
    assert.deepEqual(r.administratifs.map(f => f.id), ['b', 'd'])
  })
  test('totalDu : dettes seulement, fiches actives seulement', () => {
    assert.equal(totalDu([
      { credit_actuel: 1000 }, { credit_actuel: -500 }, { credit_actuel: 300, actif: false }, { credit_actuel: '200' },
    ]), 1200)
    assert.equal(totalDu(), 0)
  })
})

describe('échéances', () => {
  const tee = { facture_mensuelle: 25000, facture_periodicite: 'mensuel', facture_mensuelle_depuis: '2026-11-01' }
  test('mensuel pas encore commencé : prochaine = mois de départ', () => {
    assert.equal(prochaineEcheance(tee, '2026-10-12'), '2026-11-01')
  })
  test('mensuel commencé : prochaine = mois suivant', () => {
    assert.equal(prochaineEcheance({ ...tee, facture_mensuelle_depuis: '2026-09-01' }, '2026-10-12'), '2026-11-01')
    assert.equal(prochaineEcheance({ ...tee, facture_mensuelle_depuis: '2026-09-01' }, '2026-12-31'), '2027-01-01')
  })
  test('annuel : même mois chaque année', () => {
    const bail = { facture_mensuelle: 1200000, facture_periodicite: 'annuel', facture_mensuelle_depuis: '2026-03-01' }
    assert.equal(prochaineEcheance(bail, '2026-10-12'), '2027-03-01')
    assert.equal(prochaineEcheance(bail, '2027-02-28'), '2027-03-01')
    assert.equal(prochaineEcheance({ ...bail, facture_mensuelle_depuis: '2027-01-01' }, '2026-10-12'), '2027-01-01')
  })
  test('sans périodicité = mensuel ; sans montant = aucune échéance', () => {
    assert.equal(prochaineEcheance({ facture_mensuelle: 10, facture_mensuelle_depuis: '2026-10-01' }, '2026-10-12'), '2026-11-01')
    assert.equal(prochaineEcheance({ facture_mensuelle: 0, facture_mensuelle_depuis: '2026-10-01' }, '2026-10-12'), null)
  })
  test('libellés', () => {
    assert.equal(libelleEcheance(tee, '2026-10-12'), '25 000 F / mois · prochaine : novembre 2026')
    assert.equal(libelleEcheance({ facture_mensuelle: 120000, facture_periodicite: 'annuel', facture_mensuelle_depuis: '2027-03-01' }, '2026-10-12'),
      '120 000 F / an · prochaine : mars 2027')
    assert.equal(libelleEcheance({ facture_mensuelle: 0 }, '2026-10-12'), 'Aucune échéance automatique')
  })
})

describe('formulaire', () => {
  test('choix du mois de départ', () => {
    assert.deepEqual(choixMoisDepart('mensuel', '2026-10-12'), ['2026-10-01', '2026-11-01'])
    assert.deepEqual(choixMoisDepart('mensuel', '2026-10-12', '2026-08-01'), ['2026-08-01', '2026-10-01', '2026-11-01'])
    const an = choixMoisDepart('annuel', '2026-10-12')
    assert.equal(an.length, 12)
    assert.equal(an[0], '2026-10-01')
    assert.equal(an[11], '2027-09-01')
  })
  test('champsEcheance', () => {
    assert.deepEqual(champsEcheance({ montant: '25 000', periodicite: 'mensuel', depuis: '2026-11-01' }, '2026-10-12'),
      { facture_mensuelle: 25000, facture_periodicite: 'mensuel', facture_mensuelle_depuis: '2026-11-01' })
    assert.deepEqual(champsEcheance({ montant: '', periodicite: 'annuel' }, '2026-10-12'),
      { facture_mensuelle: 0, facture_periodicite: 'annuel', facture_mensuelle_depuis: null })
    assert.deepEqual(champsEcheance({ montant: '5000' }, '2026-10-12'),
      { facture_mensuelle: 5000, facture_periodicite: 'mensuel', facture_mensuelle_depuis: '2026-10-01' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/fournisseursAdmin.test.mjs`
Expected: FAIL — `Cannot find module './fournisseursAdmin.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// lib/fournisseursAdmin.js
// ──────────────────────────────────────────────────────────────────────────────
// Fournisseurs administratifs (supabase_fournisseurs_administratifs.sql).
//
// TEE, ITS, Timbre, CNPS, bail, mairie… : un fournisseur par restaurant, de
// type « administratif ». Son crédit monte seul à chaque échéance (mensuelle
// ou annuelle, le 1er du mois) par appliquer_factures_mensuelles(), et le
// gérant le paie avec les espèces (Déductions gérant → Administratifs).
// Ils remplacent les charges TEE / ITS / Timbre / CNPS / Bail de la Trésorerie
// depuis le 12/10/2026.
//
// Pur : testé par lib/fournisseursAdmin.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

export const TYPE_ADMIN = 'administratif'

const n = v => Number(String(v ?? '').replace(/[^\d-]/g, '')) || 0

export function estAdministratif(f) {
  return f?.type === TYPE_ADMIN
}

export function separerFournisseurs(liste = []) {
  const marchandise = []
  const administratifs = []
  for (const f of liste || []) (estAdministratif(f) ? administratifs : marchandise).push(f)
  return { marchandise, administratifs }
}

// Un crédit négatif est une avance, pas une dette.
export function totalDu(liste = []) {
  return (liste || [])
    .filter(f => f.actif !== false && n(f.credit_actuel) > 0)
    .reduce((s, f) => s + n(f.credit_actuel), 0)
}

const premierDu = iso => `${String(iso).slice(0, 7)}-01`
function decaler(moisISO, k) {
  const [a, m] = moisISO.split('-').map(Number)
  const t = a * 12 + (m - 1) + k
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

export function prochaineEcheance(f, aujourdhui) {
  if (!(n(f?.facture_mensuelle) > 0)) return null
  const pas = f.facture_periodicite === 'annuel' ? 12 : 1
  const mc = premierDu(aujourdhui)
  let m = premierDu(f.facture_mensuelle_depuis || mc)
  // Le mois courant est déjà facturé (le 1er) : la prochaine est après.
  while (m <= mc) m = decaler(m, pas)
  return m
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const libMois = iso => `${MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const fmtF = v => Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')

export function libelleEcheance(f, aujourdhui) {
  const p = prochaineEcheance(f, aujourdhui)
  if (!p) return 'Aucune échéance automatique'
  const par = f.facture_periodicite === 'annuel' ? 'an' : 'mois'
  return `${fmtF(f.facture_mensuelle)} F / ${par} · prochaine : ${libMois(p)}`
}

export function choixMoisDepart(periodicite, aujourdhui, actuel = null) {
  const mc = premierDu(aujourdhui)
  const k = periodicite === 'annuel' ? 12 : 2
  const out = Array.from({ length: k }, (_, i) => decaler(mc, i))
  if (actuel) out.push(premierDu(actuel))
  return [...new Set(out)].sort()
}

export function champsEcheance({ montant, periodicite, depuis } = {}, aujourdhui) {
  const m = Math.max(0, Math.round(n(montant)))
  return {
    facture_mensuelle: m,
    facture_periodicite: periodicite === 'annuel' ? 'annuel' : 'mensuel',
    facture_mensuelle_depuis: m > 0 ? premierDu(depuis || aujourdhui) : null,
  }
}
```

Note : dans le test « choix du mois de départ » annuel, `choixMoisDepart('annuel', '2026-10-12')` rend 12 mois (oct. 2026 → sept. 2027).

- [ ] **Step 4: Run test to verify it passes**

Run: `node lib/fournisseursAdmin.test.mjs`
Expected: PASS (toutes les assertions). Si `toLocaleString('fr-FR')` rend une espace fine insécable, la normalisation `.replace(/[  ]/g, ' ')` couvre les deux.

- [ ] **Step 5: Commit**

```bash
git add lib/fournisseursAdmin.js lib/fournisseursAdmin.test.mjs
git commit -m "feat(fournisseurs): logique des fournisseurs administratifs et de leurs échéances"
```

---

### Task 2: Migration SQL

**Files:**
- Create: `supabase_fournisseurs_administratifs.sql`

**Interfaces:**
- Produces (colonnes) : `fournisseurs.facture_periodicite text NOT NULL DEFAULT 'mensuel'` (CHECK `mensuel|annuel`), `fournisseurs.administratif_depuis date` (rempli par trigger = 1er du mois où le type devient `administratif`, remis à NULL s'il le quitte).
- `appliquer_factures_mensuelles()` : même signature, pas de 12 mois si `annuel`.

- [ ] **Step 1: Écrire le fichier**

```sql
-- =====================================================================
--  FOURNISSEURS ADMINISTRATIFS (TEE, ITS, Timbre, CNPS, bail, mairie…)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  • fournisseurs.type accepte « administratif » (colonne texte sans contrainte).
--  • La facture automatique devient mensuelle OU annuelle : facture_periodicite.
--    Annuelle = le mois de facture_mensuelle_depuis, puis tous les 12 mois.
--  • administratif_depuis : 1er du mois où la fiche est devenue administrative
--    (posé par trigger). Le résultat net ne compte un administratif qu'à partir
--    de ce mois : les mois passés ne bougent pas.
--  Spéc : docs/superpowers/specs/2026-10-12-fournisseurs-administratifs-design.md
-- =====================================================================

do $$
begin
  if to_regclass('public.factures_mensuelles_fournisseurs') is null then
    raise exception 'Passez d''abord supabase_factures_mensuelles.sql (projet Samtrackly wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS facture_periodicite text NOT NULL DEFAULT 'mensuel';
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_facture_periodicite_check
    CHECK (facture_periodicite IN ('mensuel', 'annuel'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS administratif_depuis date;

CREATE OR REPLACE FUNCTION fournisseurs_administratif_depuis()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'administratif' THEN
    IF TG_OP = 'INSERT' OR OLD.type IS DISTINCT FROM 'administratif' OR NEW.administratif_depuis IS NULL THEN
      NEW.administratif_depuis := coalesce(
        CASE WHEN TG_OP = 'UPDATE' AND OLD.type = 'administratif' THEN OLD.administratif_depuis END,
        date_trunc('month', current_date)::date);
    END IF;
  ELSE
    NEW.administratif_depuis := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fournisseurs_administratif_depuis ON fournisseurs;
CREATE TRIGGER trg_fournisseurs_administratif_depuis
  BEFORE INSERT OR UPDATE OF type, administratif_depuis ON fournisseurs
  FOR EACH ROW EXECUTE FUNCTION fournisseurs_administratif_depuis();

-- Facture automatique : mensuelle ou annuelle (même table de marques, unique par mois).
CREATE OR REPLACE FUNCTION appliquer_factures_mensuelles()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  f record;
  m date;
  marque uuid;
  tx uuid;
  nb integer := 0;
BEGIN
  FOR f IN
    SELECT id, nom, restaurant_id, facture_mensuelle AS montant,
           CASE WHEN facture_periodicite = 'annuel' THEN 12 ELSE 1 END AS pas,
           date_trunc('month', coalesce(facture_mensuelle_depuis, current_date))::date AS depuis
      FROM fournisseurs
     WHERE facture_mensuelle > 0 AND coalesce(actif, true)
     ORDER BY id
     FOR UPDATE
  LOOP
    m := f.depuis;
    WHILE m <= date_trunc('month', current_date)::date LOOP
      INSERT INTO factures_mensuelles_fournisseurs (fournisseur_id, mois, montant)
      VALUES (f.id, m, f.montant)
      ON CONFLICT (fournisseur_id, mois) DO NOTHING
      RETURNING id INTO marque;

      IF marque IS NOT NULL THEN
        tx := inserer_transaction_hors_point(f.id, m, f.montant, 0, 'mensuel', 'facture_mensuelle');
        UPDATE factures_mensuelles_fournisseurs SET transaction_id = tx WHERE id = marque;
        INSERT INTO journal_activite (action, details, restaurant_id, user_nom)
        VALUES ('facture_mensuelle_fournisseur',
                jsonb_build_object('fournisseur', f.nom, 'mois', to_char(m, 'YYYY-MM'), 'montant', f.montant,
                                   'periodicite', CASE WHEN f.pas = 12 THEN 'annuel' ELSE 'mensuel' END),
                f.restaurant_id, 'Facture automatique');
        nb := nb + 1;
      END IF;

      m := (m + make_interval(months => f.pas))::date;
    END LOOP;
  END LOOP;
  RETURN nb;
END;
$$;

GRANT EXECUTE ON FUNCTION appliquer_factures_mensuelles() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Contrôle : fournisseurs administratifs.
SELECT f.nom, r.nom AS resto, f.facture_mensuelle, f.facture_periodicite, f.facture_mensuelle_depuis,
       f.administratif_depuis, f.credit_actuel
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.type = 'administratif'
 ORDER BY r.nom, f.nom;
```

- [ ] **Step 2: Relire** — la boucle `FOR … FOR UPDATE` et l'unicité `(fournisseur_id, mois)` sont inchangées : un mois n'est jamais facturé deux fois. Ne PAS exécuter la migration soi-même : c'est l'utilisateur qui la passe.

- [ ] **Step 3: Commit**

```bash
git add supabase_fournisseurs_administratifs.sql
git commit -m "feat(fournisseurs): migration des fournisseurs administratifs (périodicité annuelle, date de bascule)"
```

---

### Task 3: Résultat net — compter les administratifs à partir de leur bascule

**Files:**
- Modify: `lib/creditFournisseursMois.js` (fonction `creditFournisseursParRestoMois`, en-tête)
- Modify: `lib/tresorerieDb.js:878` (`chargerResultats` : `select('*')` sur fournisseurs)
- Modify: `app/tresorerie-resultats.js:130` (texte d'aide)
- Test: `lib/creditFournisseursMois.test.mjs`

**Interfaces:**
- Consumes : `estAdministratif` de `lib/fournisseursAdmin.js`.
- Produces : `creditFournisseursParRestoMois({ fournisseurs, transactions, mois })` — `fournisseurs` peut désormais porter `type` et `administratif_depuis` ; un administratif compte pour les mois `m >= administratif_depuis.slice(0,7)`, et pour les mois d'avant suit l'ancienne règle par le nom (`estFournisseurCharge(nom)`).

- [ ] **Step 1: Write the failing test** (ajouter à la fin de `lib/creditFournisseursMois.test.mjs`)

```js
describe('fournisseurs administratifs', () => {
  const four = [
    { id: 'tee', restaurant_id: 'kms', nom: 'TEE', type: 'administratif', administratif_depuis: '2026-11-01' },
  ]
  test('compté à partir du mois de bascule, écarté avant (comme une cotisation)', () => {
    const transactions = [
      tx('tee', '2026-10-10', 50000),
      { fournisseur_id: 'tee', date_point: '2026-11-01', reste: 75000, facture: 25000, paye: 0, point_id: null,
        saisi_par: 'mensuel', source: 'facture_mensuelle', created_at: '2026-11-01T06:00:00Z' },
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-10', '2026-11'], fournisseurs: four, transactions })
    assert.equal(r.kms?.['2026-10'], undefined)
    assert.deepEqual(r.kms['2026-11'], { debut: 50000, fin: 75000, ajustements: 0, variation: 25000 })
  })
  test('crédit de départ saisi par le manager : pas une charge du mois', () => {
    const transactions = [
      { fournisseur_id: 'tee', date_point: '2026-11-02', reste: 400000, facture: 400000, paye: 0, point_id: null,
        saisi_par: 'manager', source: 'ajustement_manager', created_at: '2026-11-02T08:00:00Z' },
    ]
    const r = creditFournisseursParRestoMois({ mois: ['2026-11'], fournisseurs: four, transactions })
    assert.deepEqual(r.kms['2026-11'], { debut: 0, fin: 400000, ajustements: 400000, variation: 0 })
  })
  test('sans administratif_depuis : compté tout le temps', () => {
    const r = creditFournisseursParRestoMois({
      mois: ['2026-10'], fournisseurs: [{ id: 'odp', restaurant_id: 'kms', nom: 'ODP', type: 'administratif' }],
      transactions: [tx('odp', '2026-10-05', 1000)],
    })
    assert.equal(r.kms['2026-10'].variation, 1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/creditFournisseursMois.test.mjs`
Expected: FAIL sur « compté à partir du mois de bascule » (TEE écarté par le nom : `r.kms` indéfini).

- [ ] **Step 3: Implémentation** — dans `lib/creditFournisseursMois.js` :

1. Ajouter `import { estAdministratif } from './fournisseursAdmin.js'`.
2. Remplacer le calcul de `restoDe` et `creditAvant` par une inclusion par mois :

```js
export function creditFournisseursParRestoMois({ fournisseurs = [], transactions = [], mois = [] }) {
  // Mois (AAAA-MM) à partir duquel un fournisseur compte ; null = jamais.
  const restoDe = {}
  const depuis = {}
  for (const f of fournisseurs || []) {
    if (!f.restaurant_id) continue
    if (estAdministratif(f)) {
      restoDe[f.id] = f.restaurant_id
      // Avant sa bascule, l'ancienne règle (par le nom) : les mois passés ne bougent pas.
      depuis[f.id] = estFournisseurCharge(f.nom) && f.administratif_depuis ? f.administratif_depuis.slice(0, 7) : ''
    } else if (!estFournisseurCharge(f.nom)) {
      restoDe[f.id] = f.restaurant_id
      depuis[f.id] = ''
    }
  }
  const compte = (fid, m) => restoDe[fid] && m >= depuis[fid]
  const retenues = (transactions || []).filter(t => restoDe[t.fournisseur_id])
  const dateParPoint = {}
  for (const t of retenues) if (t.point_id) dateParPoint[t.point_id] = jourDe(t)

  // Dernier reste par fournisseur, toutes transactions datées AVANT la borne.
  const cache = {}
  const derniersAvant = borne => (cache[borne] ||= choisirDerniersRestes(retenues.filter(t => jourDe(t) < borne), dateParPoint))
  const creditAvant = (borne, sansNegatifs, m) => {
    const parResto = {}
    for (const [fid, d] of Object.entries(derniersAvant(borne))) {
      if (!compte(fid, m)) continue
      const reste = Number(d.reste) || 0
      parResto[restoDe[fid]] = (parResto[restoDe[fid]] || 0) + (sansNegatifs ? Math.max(0, reste) : reste)
    }
    return parResto
  }

  // Corrections du manager par restaurant et par mois (facture − payé).
  const ajustements = {}
  for (const t of retenues) {
    if (t.source !== SOURCE_AJUSTEMENT) continue
    const m = jourDe(t).slice(0, 7)
    if (!compte(t.fournisseur_id, m)) continue
    const r = restoDe[t.fournisseur_id]
    ;(ajustements[r] ||= {})[m] = (ajustements[r][m] || 0) + (Number(t.facture) || 0) - (Number(t.paye) || 0)
  }

  const out = {}
  for (const m of mois) {
    // Début et fin d'un même mois toujours avec la même règle et les mêmes fournisseurs.
    const sansNegatifs = m < MOIS_FORMULE_NORMALE
    const debut = creditAvant(`${m}-01`, sansNegatifs, m)
    const fin = creditAvant(moisSuivant(m), sansNegatifs, m)
    for (const r of new Set([...Object.keys(debut), ...Object.keys(fin)])) {
      const d = Math.round(debut[r] || 0)
      const f = Math.round(fin[r] || 0)
      const a = sansNegatifs ? 0 : Math.round(ajustements[r]?.[m] || 0)
      ;(out[r] ||= {})[m] = { debut: d, fin: f, ajustements: a, variation: f - d - a }
    }
  }
  return out
}
```

3. Mettre à jour la docstring (`fournisseurs : [{ id, restaurant_id, nom, type?, administratif_depuis? }]`) et ajouter au bloc d'en-tête : « Fournisseurs administratifs (12/10/2026) : comptés comme des fournisseurs normaux à partir du mois où ils le sont devenus (`administratif_depuis`) ; un TEE / CNPS / bail transformé reste écarté pour les mois d'avant. »
4. `lib/tresorerieDb.js:878` : `supabase.from('fournisseurs').select('id, restaurant_id, nom').order('id')` → `select('*')` (les nouvelles colonnes n'existent qu'après migration).
5. `app/tresorerie-resultats.js:130` : remplacer « Loyer, salaires, CNPS, timbre, ITS, TEE et bail comptent au mois de leur date limite » par « Loyer et salaires comptent au mois de leur date limite (CNPS, timbre, ITS, TEE et bail aussi jusqu'à leur passage en fournisseurs administratifs) », et « (cotisations, CNPS, timbre, loyer et bail exclus, déjà dans les charges, … » par « (cotisations, loyer et anciens CNPS, timbre, bail exclus, déjà dans les charges ; les fournisseurs administratifs comptent comme des fournisseurs depuis leur passage, … ».

- [ ] **Step 4: Run tests**

Run: `node lib/creditFournisseursMois.test.mjs && node lib/direction.test.mjs`
Expected: PASS (anciens tests inchangés compris).

- [ ] **Step 5: Commit**

```bash
git add lib/creditFournisseursMois.js lib/creditFournisseursMois.test.mjs lib/tresorerieDb.js app/tresorerie-resultats.js
git commit -m "feat(resultats): les fournisseurs administratifs comptent dans le résultat net depuis leur passage"
```

---

### Task 4: Trésorerie — logique pure (catégories retirées)

**Files:**
- Modify: `lib/tresorerie.js` (constantes, `ONGLETS_A_PAYER`, `categoriesVisibles`)
- Modify: `lib/rappelsTresorerie.js:50` (`elementsDuJour`)
- Modify: `lib/groupesAccueil.js:148` (`messagesTresorerie`)
- Modify: `lib/alertes.js` (retrait de l'alerte CNPS) et `lib/alertesDb.js`
- Test: `lib/tresorerie.test.mjs`, `lib/rappelsTresorerie.test.mjs`, `lib/groupesAccueil.test.mjs`, `lib/alertes.test.mjs`

**Interfaces:**
- Produces (dans `lib/tresorerie.js`) :
  - `CATEGORIES_ADMINISTRATIVES = ['cnps', 'impot', 'its', 'tee', 'bail']`
  - `CATEGORIES_TRESORERIE = ['loyer', 'salaire']` (= `CATEGORIES_SERIE` sans les administratives)
  - `sansChargesAdministratives(dus) → dus` sans les catégories administratives
  - `ONGLETS_A_PAYER = [...CATEGORIES_TRESORERIE, 'dette_recente', 'dette']`
  - `categoriesVisibles('saisie_rh') → ['loyer', 'salaire']`

- [ ] **Step 1: Tests qui échouent**

Dans `lib/tresorerie.test.mjs` : ajouter `CATEGORIES_TRESORERIE, sansChargesAdministratives` à l'import, remplacer les attentes lignes 498 et 505 :

```js
    assert.deepEqual(categoriesVisibles('saisie_rh'), ['loyer', 'salaire'])
```
```js
  test('lecture : loyers, salaires et la dette récente, pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('lecture'), ['loyer', 'salaire', 'dette_recente'])
```
et ajouter :
```js
describe('charges passées en fournisseurs administratifs', () => {
  test('seuls loyers et salaires restent', () => {
    assert.deepEqual(CATEGORIES_TRESORERIE, ['loyer', 'salaire'])
  })
  test('sansChargesAdministratives garde loyers, salaires, dettes, autres', () => {
    const dus = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail', 'dette', 'autre'].map(categorie => ({ categorie }))
    assert.deepEqual(sansChargesAdministratives(dus).map(d => d.categorie), ['loyer', 'salaire', 'dette', 'autre'])
  })
})
```

Dans `lib/rappelsTresorerie.test.mjs`, ajouter :
```js
test('plus de rappel pour TEE / CNPS / bail (fournisseurs administratifs)', () => {
  const dus = [{ id: 't1', categorie: 'tee', restaurant_id: 'r1', echeance: '2026-10-15', montant_du: 25000 }]
  const e = elementsDuJour({ moment: 'matin', aujourdhui: '2026-10-15', dus, paiements: [], nomResto: () => 'KMS' })
  assert.equal(e.length, 0)
})
```

Dans `lib/groupesAccueil.test.mjs`, ajouter :
```js
test('messagesTresorerie ignore les charges administratives', () => {
  const m = messagesTresorerie({
    dus: [{ id: 'c', categorie: 'cnps', echeance: '2026-10-15', montant_du: 1000 }],
    paiements: [], emprunts: [], receptions: [], aujourdhui: '2026-10-15', demain: '2026-10-16', hier: '2026-10-14',
  })
  assert.equal(m.aujourdhui.n, 0)
})
```

Dans `lib/alertes.test.mjs` : supprimer le `describe` CNPS (lignes ~31-48) et le remplacer par :
```js
test('plus d’alerte CNPS : la CNPS est un fournisseur administratif', () => {
  const du = { id: 'c1', categorie: 'cnps', restaurant_id: 'kms', mois: '2026-07-01', montant_du: 412000, echeance: '2026-08-15' }
  assert.equal(calculerAlertes({ aujourdhui: '2026-10-21', cnps: [du] }).length, 0)
})
```

- [ ] **Step 2: Run** — `node lib/tresorerie.test.mjs; node lib/rappelsTresorerie.test.mjs; node lib/groupesAccueil.test.mjs; node lib/alertes.test.mjs` → FAIL sur les nouveaux tests.

- [ ] **Step 3: Implémentation**

`lib/tresorerie.js`, après `CATEGORIES_SERIE` :
```js
// Passées en fournisseurs administratifs le 12/10/2026 (lib/fournisseursAdmin.js) :
// plus créées, plus affichées ni rappelées. Les lignes déjà en base restent pour
// le résultat net des mois passés (lib/chargesMois.js les lit directement).
export const CATEGORIES_ADMINISTRATIVES = ['cnps', 'impot', 'its', 'tee', 'bail']
export const CATEGORIES_TRESORERIE = CATEGORIES_SERIE.filter(c => !CATEGORIES_ADMINISTRATIVES.includes(c))

export function sansChargesAdministratives(dus = []) {
  return (dus || []).filter(d => !CATEGORIES_ADMINISTRATIVES.includes(d.categorie))
}
```
puis :
```js
// Onglets de « À payer » : loyers, salaires, puis la dette récente et les
// dettes (toutes catégories confondues).
export const ONGLETS_A_PAYER = [...CATEGORIES_TRESORERIE, 'dette_recente', 'dette']
```
et dans `categoriesVisibles` : `if (niveau === 'saisie_rh') return [...CATEGORIES_TRESORERIE]`.

`lib/rappelsTresorerie.js` : importer `CATEGORIES_TRESORERIE` à la place de `CATEGORIES_SERIE`, et ligne 50 `if (!CATEGORIES_TRESORERIE.includes(du.categorie) || du.echeance !== aujourdhui) continue`. Au début de `elementsDuJour`, filtrer aussi les prévisions : `const visibles = sansChargesAdministratives(dus)` et utiliser `visibles` à la place de `dus` dans `etats` et dans la boucle (importer `sansChargesAdministratives`).

`lib/groupesAccueil.js:148` : `CATEGORIES_SERIE` → `CATEGORIES_TRESORERIE` (import mis à jour ; garder `CATEGORIES_SERIE` s'il sert ailleurs dans le fichier).

`lib/alertes.js` : supprimer le bloc « 2. CNPS en retard de plus de 60 jours », la constante `SEUIL_RETARD_CNPS` et les imports devenus inutiles ; garder le paramètre `cnps = []` dans la signature (ignoré) pour ne pas casser l'appel ; renuméroter les commentaires. `lib/alertesDb.js` : retirer la requête `tresorerie_dus … cnps` et celle des paiements associés, passer `cnps: []` ou ne plus le passer.

- [ ] **Step 4: Run** — les quatre fichiers de test ci-dessus + `node lib/historique.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tresorerie.js lib/rappelsTresorerie.js lib/groupesAccueil.js lib/alertes.js lib/alertesDb.js lib/*.test.mjs
git commit -m "feat(tresorerie): CNPS, timbre, ITS, TEE et bail quittent la trésorerie (logique)"
```

---

### Task 5: Trésorerie — écrans

**Files:**
- Modify: `lib/tresorerieDb.js:85-120` (`chargerTresorerie`)
- Modify: `components/accueil/AccueilManager.js:67`
- Modify: `app/tresorerie-a-payer.js` (boutons et constantes des catégories retirées)
- Modify: `app/tresorerie-restaurant.js:55`
- Modify: `app/tresorerie.js:224,332` (tuile Administratifs)

**Interfaces:**
- Consumes : `sansChargesAdministratives`, `CATEGORIES_TRESORERIE` (Task 4) ; `separerFournisseurs`, `totalDu` (Task 1).

- [ ] **Step 1: `chargerTresorerie`**
  - Fournisseurs : `select('id, restaurant_id, nom, credit_actuel, actif, type')`.
  - Après la lecture des dûs : `let dus = sansChargesAdministratives(await toutesLesLignes(...))` (et pareil pour la relecture après création).
  - Création automatique : `const aCreer = moisLoyersACreer(loyers, dus, mc)` — retirer `chargesFixesACreer(...)` (il ne créait que timbre / ITS / TEE / bail). Retirer l'import devenu inutile.

- [ ] **Step 2: AccueilManager** — ligne 67 : `.in('categorie', CATEGORIES_SERIE)` → `.in('categorie', CATEGORIES_TRESORERIE)` (import mis à jour).

- [ ] **Step 3: À payer** — dans `app/tresorerie-a-payer.js` :
  - `TITRES_SAISIE` : ne garder que `salaire`.
  - Supprimer `MOIS_PAR_RESTAURANT` et le bouton « Mois dus par restaurant », le bouton « Régler les montants par restaurant » (`CATEGORIES_MONTANT_FIXE`), le bouton « Saisir les baux d'une année » (`onglet === 'bail'`), et les feuilles associées (`reglage === 'moisResto' | 'montants' | 'bail'`) avec leurs imports (`FeuilleMoisRestaurants`, `FeuilleMontantsFixes`, `FeuilleSaisieBaux`) s'ils ne servent plus.
  - Garder « Changer la date limite » pour `salaire` (`CATEGORIES_JOUR_COMMUN.includes(onglet)` reste vrai pour salaire).
  - Laisser `components/tresorerie/reglagesCharges.js` et `saisieGroupee.js` : leurs exports non utilisés ne gênent pas le lint (vérifier : si `npm run lint` signale un export mort, ne rien supprimer d'autre que les imports).

- [ ] **Step 4: Trésorerie d'un restaurant** — `app/tresorerie-restaurant.js:55` : `CATEGORIES_SERIE.filter(...)` → `CATEGORIES_TRESORERIE.filter(...)`.

- [ ] **Step 5: Accueil Trésorerie** — `app/tresorerie.js` :
  - importer `separerFournisseurs, totalDu` de `../lib/fournisseursAdmin` ;
  - `const { marchandise, administratifs } = separerFournisseurs(donnees.fournisseurs)` ;
  - ligne 224 : « Pour information : fournisseurs dus {fmt(totalDu(marchandise))} F, administrations {fmt(totalDu(administratifs))} F (payés par les restaurants). » ;
  - ligne 332 : la tuile Fournisseurs affiche `totalDu(marchandise)` ; ajouter juste après une tuile
    `<Tuile icone="bank-outline" couleur="#7C3AED" titre="Administrations" sous={`${fmt(totalDu(administratifs))} F`} detail="impôts, CNPS, bail… dus" route="/credits-fournisseurs?onglet=administratifs" />`
    (vérifier que `Tuile` accepte une route avec paramètre ; sinon `route="/credits-fournisseurs"`).

- [ ] **Step 6: Vérifier** — `npm run lint` (0 erreur), `for f in lib/*.test.mjs; do node "$f"; done` (0 échec).

- [ ] **Step 7: Commit**

```bash
git add lib/tresorerieDb.js components/accueil/AccueilManager.js app/tresorerie-a-payer.js app/tresorerie-restaurant.js app/tresorerie.js
git commit -m "feat(tresorerie): écrans sans CNPS, timbre, ITS, TEE, bail ; tuile Administrations"
```

---

### Task 6: Feuille « Fournisseur administratif » (créer / régler / transformer)

**Files:**
- Create: `components/fournisseurs/FeuilleFournisseurAdmin.js`

**Interfaces:**
- Consumes : `TYPE_ADMIN`, `champsEcheance`, `choixMoisDepart` (Task 1) ; `supabase`, `journaliser`, `aujourdhuiISO` (lib/tresorerie), `libelleMois` (lib/facturesMensuelles).
- Produces : `export default function FeuilleFournisseurAdmin({ visible, fournisseur, restaurants, restaurantParDefaut, userNom, onFermer, onEnregistre })`
  - `fournisseur` null = création ; sinon fiche complète (`select('*')`), administrative ou non (transformation).
  - À l'enregistrement : appelle `onEnregistre()` après succès.

- [ ] **Step 1: Écrire le composant** — Modal `animationType="slide"` `presentationStyle="formSheet"`, styles via `useTheme()` (mêmes conventions que `app/credits-fournisseurs.js` : `colors.bg`, `colors.surface`, `colors.primary`, `colors.border`, `colors.text`, `colors.textMuted`, `colors.error`). Contenu :
  1. Titre : « Nouveau fournisseur administratif » / « Réglages · {nom} ».
  2. Nom (TextInput, obligatoire).
  3. Restaurant : puces des `restaurants` (création seulement ; en modification, le restaurant est affiché, pas modifiable).
  4. Montant par échéance (TextInput numérique, chiffres seulement ; vide = pas d'échéance automatique).
  5. Périodicité : deux puces « Chaque mois » / « Chaque année ».
  6. Mois de la (prochaine) échéance : puces `choixMoisDepart(periodicite, aujourdhuiISO(), fournisseur?.facture_mensuelle_depuis)` affichées avec `libelleMois` ; texte d'aide : mensuel « Le 1er de chaque mois, le montant s'ajoute à ce que doit le restaurant. » ; annuel « Le 1er de ce mois, chaque année. ».
  7. En modification d'une fiche déjà administrative : bouton secondaire « Repasser en fournisseur normal » (type `fournisseur`, `facture_mensuelle: 0`, `facture_mensuelle_depuis: null`), avec `Alert.alert` à 2 boutons (Annuler / Confirmer).
  8. Texte d'information en bas : « Ce que le restaurant doit déjà (le retard) se règle avec « Modifier » sur sa fiche, dans Crédits fournisseurs. » — le crédit de départ n'est PAS dans cette feuille.
  9. Bouton « Enregistrer » (désactivé sans nom, ou sans restaurant en création).

  Enregistrement :
  ```js
  const champs = { nom: nom.trim(), type: TYPE_ADMIN, ...champsEcheance({ montant, periodicite, depuis }, aujourdhuiISO()) }
  if (fournisseur?.id) {
    const { error } = await supabase.from('fournisseurs').update(champs).eq('id', fournisseur.id)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('fournisseurs')
      .insert({ ...champs, restaurant_id: restaurantId, actif: true }).select('id').single()
    if (error) throw error
    await supabase.from('fournisseurs_restaurants').upsert(
      { fournisseur_id: data.id, restaurant_id: restaurantId, credit_actuel: 0 },
      { onConflict: 'fournisseur_id,restaurant_id' })
  }
  journaliser({ action: fournisseur?.id ? 'fournisseur_admin_modifie' : 'fournisseur_admin_cree',
    details: { nom: champs.nom, montant: champs.facture_mensuelle, periodicite: champs.facture_periodicite },
    restaurantId: fournisseur?.restaurant_id || restaurantId, userNom }).catch(() => {})
  ```
  (Vérifier la signature réelle de `journaliser` dans `lib/journal.js` et l'adapter.) Erreur : message en français dans la feuille ; si l'erreur mentionne `facture_periodicite` → « Il faut d'abord passer supabase_fournisseurs_administratifs.sql dans Supabase. ».

- [ ] **Step 2: Lint** — `npx eslint components/fournisseurs/FeuilleFournisseurAdmin.js` → 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add components/fournisseurs/FeuilleFournisseurAdmin.js
git commit -m "feat(fournisseurs): feuille de création et de réglage d'un fournisseur administratif"
```

---

### Task 7: Crédits fournisseurs — deux totaux, deux onglets

**Files:**
- Modify: `app/credits-fournisseurs.js` (chargement l.154, rendu l.790-940, cartes l.650-720, export l.500-560)

**Interfaces:**
- Consumes : `separerFournisseurs`, `totalDu`, `estAdministratif`, `libelleEcheance` (Task 1) ; `FeuilleFournisseurAdmin` (Task 6).

- [ ] **Step 1: Chargement** — l.154 : `.select('id, nom, credit_actuel, restaurant_id')` → `.select('*')`. Lire le paramètre `onglet` (`useLocalSearchParams` d'expo-router) : `const [ongletCredits, setOngletCredits] = useState(params.onglet === 'administratifs' ? 'administratifs' : 'fournisseurs')`.
- [ ] **Step 2: Droits** — `const peutGererAdmin = peutModifier || isRH`.
- [ ] **Step 3: Totaux côte à côte** — à la place de la rangée KPI l.802-806 :
  ```js
  const { marchandise, administratifs } = separerFournisseurs(fournisseurs)
  ```
  et la rangée affiche deux tuiles, toujours visibles quel que soit l'onglet :
  `tuileKpi('truck-outline', 'Dû aux fournisseurs', fmt(totalDu(marchandise)), colors.error, colors.errorLight)` et
  `tuileKpi('bank-outline', 'Dû aux administrations', fmt(totalDu(administratifs)), '#7C3AED', '#EDE9FE')`.
  L'ancienne tuile « Avances reçues » passe dans l'en-tête de la section Cotisations (déjà affichée là : `${cotisList.length} · ${fmt(totalAvances)}`), donc on la retire de la rangée.
- [ ] **Step 4: Onglets** — sous les totaux, deux puces (même style que `moisChip`) « Fournisseurs · n » / « Administratifs · n ». La vue « Soldes actuels » (`!moisSel`) :
  - onglet Fournisseurs : `fournList` / `cotisList` calculés sur `marchandise` (au lieu de `fournisseurs`) ; rendu inchangé ;
  - onglet Administratifs : section `titreSection('bank-outline', 'Administrations', `${administratifs.length} · ${fmt(totalDu(administratifs))}`, …)`, cartes `renderCard(f)` ; vide → « Aucun fournisseur administratif ». Si `peutGererAdmin` : bouton « + Fournisseur administratif » en tête de section (ouvre la feuille avec `fournisseur: null`).
  - La vue d'un mois (`moisSel`) filtre `mouvMois.parFourn` selon l'onglet : construire un `Set` des ids administratifs et garder `g => estAdmin.has(g.id) === (ongletCredits === 'administratifs')`. Vérifier que `g.id` est bien l'id fournisseur dans `chargerMois` ; sinon adapter la clé.
- [ ] **Step 5: Cartes** — dans `renderCard(f)` :
  - sous le restaurant, si `estAdministratif(f)` : ligne `libelleEcheance(f, aujourdhuiISO())` en `textMuted` ;
  - action supplémentaire si `peutGererAdmin` : « Réglages » (icône `cog-outline`) pour un administratif, « Passer en administratif » (icône `bank-transfer`) pour un fournisseur normal ou une cotisation ; les deux ouvrent `FeuilleFournisseurAdmin` avec la fiche ;
  - pas de « Remettre à 0 » sur un administratif (`isCotisation && peutModifier && !estAdministratif(f)`).
- [ ] **Step 6: Feuille** — monter `<FeuilleFournisseurAdmin visible={!!feuilleAdmin} fournisseur={feuilleAdmin?.f || null} restaurants={restaurants} restaurantParDefaut={restoFilter} userNom={userNom} onFermer={() => setFeuilleAdmin(null)} onEnregistre={() => { setFeuilleAdmin(null); charger() }} />` avec `const [feuilleAdmin, setFeuilleAdmin] = useState(null)` (`{ f: null }` pour une création). Si `restaurants` est vide (RH sans liste), le charger comme pour `peutVoirRestaurants` (déjà le cas pour RH).
- [ ] **Step 7: Export Excel** — l.507-560 : les feuilles existantes portent sur `marchandise` ; ajouter une feuille « Administrations » `['Fournisseur', 'Restaurant', 'Crédit dû', 'Échéance']` sur les administratifs (même requête de base, filtrée par `estAdministratif`). Vérifier que la requête d'export sélectionne `type` (ajouter `type` à son `select`, colonne existante).
- [ ] **Step 8: Titre** — `entete('Crédits et cotisations · …')` → `entete('Crédits · …')`.
- [ ] **Step 9: Vérifier** — `npm run lint` 0 erreur ; `npx expo export -p web` compile.
- [ ] **Step 10: Commit**

```bash
git add app/credits-fournisseurs.js
git commit -m "feat(credits): dû aux fournisseurs et dû aux administrations côte à côte, onglet Administratifs"
```

---

### Task 8: Déductions gérant — 4e onglet Administratifs

**Files:**
- Modify: `app/deductions-gerant.js:56,383-420`
- Modify: `lib/manquantsSaisie.js` (`resumeDeductions`)
- Test: `lib/manquantsSaisie.test.mjs`

**Interfaces:**
- Consumes : `separerFournisseurs`, `estAdministratif` (Task 1) ; `OngletFournisseurs` (inchangé).
- Produces : `resumeDeductions(depenses, fournisseurs, paies, idsAdmin = new Set())` → `{ fournisseurs, administratifs, depenses, paies }` où `administratifs` compte les entrées de `fournisseurs` dont l'id est dans `idsAdmin`, et `fournisseurs` les autres.

- [ ] **Step 1: Test qui échoue** (ajouter dans `lib/manquantsSaisie.test.mjs`)

```js
describe('resumeDeductions — administratifs à part', () => {
  test('les administratifs ont leur propre compteur', () => {
    const r = resumeDeductions({}, { f1: { paye: '3000' }, tee: { paye: '25000' }, f2: { montant_facture: '100' } }, [], new Set(['tee']))
    assert.deepEqual(r.fournisseurs, { n: 2, total: 3000 })
    assert.deepEqual(r.administratifs, { n: 1, total: 25000 })
  })
  test('sans liste : tout reste en fournisseurs', () => {
    const r = resumeDeductions({}, { f1: { paye: '3000' } }, [])
    assert.deepEqual(r.administratifs, { n: 0, total: 0 })
  })
})
```

- [ ] **Step 2: Run** — `node lib/manquantsSaisie.test.mjs` → FAIL (`r.administratifs` indéfini).

- [ ] **Step 3: Implémentation** — `lib/manquantsSaisie.js` :

```js
// Nombre de lignes et montant de chaque onglet des déductions. idsAdmin : ids
// des fournisseurs administratifs (onglet à part).
export function resumeDeductions(depenses, fournisseurs, paies, idsAdmin = new Set()) {
  const lignesDep = Object.values(depenses || {}).flatMap(l => l || [])
  const saisis = Object.entries(fournisseurs || {}).filter(([, f]) => nombre(f?.paye) > 0 || nombre(f?.montant_facture) > 0)
  const compter = liste => ({ n: liste.length, total: liste.reduce((s, [, f]) => s + nombre(f?.paye), 0) })
  const listePaies = paies || []
  return {
    fournisseurs: compter(saisis.filter(([id]) => !idsAdmin.has(id))),
    administratifs: compter(saisis.filter(([id]) => idsAdmin.has(id))),
    depenses: { n: lignesDep.length, total: lignesDep.reduce((s, l) => s + nombre(l?.montant), 0) },
    paies: { n: listePaies.length, total: listePaies.reduce((s, l) => s + nombre(l?.montant), 0) },
  }
}
```

`app/deductions-gerant.js` :
- l.56 : `.select('id, nom')` → `.select('id, nom, type')`.
- Calculer `const { marchandise, administratifs } = useMemo(() => separerFournisseurs(fournisseursList), [fournisseursList])` et `const idsAdmin = useMemo(() => new Set(administratifs.map(f => f.id)), [administratifs])`.
- `resumeDeductions(depensesGerantCaisse, fournisseursGerantCaisse, paiesGerantCaisse, idsAdmin)`.
- `onglets` : insérer après Fournisseurs `{ cle: 'administratifs', label: 'Administratifs', detail: detail(resume.administratifs) }`.
- Onglet `fournisseurs` : `fournisseursList={marchandise}` ; nouveau bloc `onglet === 'administratifs'` : même `<OngletFournisseurs …>` avec `fournisseursList={administratifs}` (toutes les autres props identiques). Le message vide d'`OngletFournisseurs` dit « Aucun fournisseur enregistré pour ce restaurant » : ajouter une prop facultative `texteVide` au composant (`components/deductions/OngletFournisseurs.js`, défaut = texte actuel) et passer « Aucun fournisseur administratif pour ce restaurant ».
- Vérifier que `Onglets` (StyleChaleureux) tient 4 éléments sur un écran de téléphone (sinon libellés courts : « Fourn. », « Admin. » — demander à l'utilisateur via AskUserQuestion uniquement si ça déborde visiblement dans le code de `Onglets`).
- Sauvegarde : rien à changer (même `fournisseursGerantCaisse`).

- [ ] **Step 4: Run** — `node lib/manquantsSaisie.test.mjs` → PASS ; `npm run lint` → 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add lib/manquantsSaisie.js lib/manquantsSaisie.test.mjs app/deductions-gerant.js components/deductions/OngletFournisseurs.js
git commit -m "feat(deductions): 4e onglet Administratifs dans les déductions gérant"
```

---

### Task 9: Caissier et inventaire ne voient pas les administratifs

**Files:**
- Modify: `app/fournisseurs.js:51-56` (saisie fournisseurs du caissier / gérant-caissier)
- Modify: `app/inventaire.js:92`

- [ ] **Step 1:** `app/fournisseurs.js` : `.select('id, nom, actif, credit_actuel')` → `.select('id, nom, actif, credit_actuel, type')`, puis après la lecture `const fournVisibles = (fourn || []).filter(f => !estAdministratif(f))` et utiliser `fournVisibles` à la place de `fourn` pour la liste. Import `estAdministratif` de `../lib/fournisseursAdmin`.
- [ ] **Step 2:** `app/inventaire.js:92` : `.select('id, nom')` → `.select('id, nom, type')` et `.then(({ data }) => setFournisseursListe((data || []).filter(f => !estAdministratif(f))))`.
- [ ] **Step 3:** Ne PAS filtrer `app/modifier-point.js`, `app/recap-point.js`, `app/brouillons-fournisseurs.js`, `app/point-shift.js` (`chargerFournNoms` n'est qu'une table de noms) : le manager doit pouvoir corriger un paiement administratif d'un point.
- [ ] **Step 4:** `npm run lint` → 0 erreur.
- [ ] **Step 5: Commit**

```bash
git add app/fournisseurs.js app/inventaire.js
git commit -m "feat(fournisseurs): les administratifs n'apparaissent ni chez le caissier ni dans l'inventaire"
```

---

### Task 10: Paramètres → Fournisseurs (manager)

**Files:**
- Modify: `app/parametres.js:270-280,416-470,1085-1090,1450-1500`

**Interfaces:**
- Consumes : `TYPE_ADMIN`, `choixMoisDepart` (Task 1).

- [ ] **Step 1: Type** — l.1452 : `['fournisseur', 'cotisation']` → `['fournisseur', 'cotisation', 'administratif']`, avec libellés affichés `{ fournisseur: 'Fournisseur', cotisation: 'Cotisation', administratif: 'Administratif' }[t]`.
- [ ] **Step 2: Badge liste** — l.1085-1088 : afficher « Admin. » pour `f.type === 'administratif'` (style `typeBadgeCotis` réutilisé ou nouveau style violet `#EDE9FE` / `#7C3AED`).
- [ ] **Step 3: Échéance** — dans le bloc « Facture mensuelle automatique » (l.1466-1500) :
  - titre : « Facture automatique » ;
  - puces de périodicité « Chaque mois » / « Chaque année » (`form.facture_periodicite`, défaut `mensuel`) ;
  - puces de mois : `choixMoisDepart(form.facture_periodicite || 'mensuel', aujourdhuiISO(), form.facture_mensuelle_depuis)` au lieu de `[depuis, ceMois, moisProchain]` ;
  - texte d'aide selon la périodicité (mêmes phrases qu'en Task 6).
- [ ] **Step 4: Enregistrement** — `champsFactureMensuelle()` : ajouter `facture_periodicite: form.facture_periodicite === 'annuel' ? 'annuel' : 'mensuel'` **seulement si** `form.facture_periodicite !== undefined` (fiche relue après migration ou puce touchée) — sinon l'enregistrement échouerait avant migration.
- [ ] **Step 5:** `npm run lint` → 0 erreur.
- [ ] **Step 6: Commit**

```bash
git add app/parametres.js
git commit -m "feat(parametres): type Administratif et facture automatique mensuelle ou annuelle"
```

---

### Task 11: Vérification finale, documents, livraison

- [ ] **Step 1:** Mettre à jour la spéc (`docs/superpowers/specs/2026-10-12-fournisseurs-administratifs-design.md`) : bail inclus ; mécanisme = facture automatique existante + périodicité ; colonnes réelles (`facture_periodicite`, `administratif_depuis`) ; tuile Administrations sur l'accueil Trésorerie (pas de ligne dans À payer) ; deux totaux côte à côte en haut de Crédits.
- [ ] **Step 2:** `npm run lint` → 0 erreur.
- [ ] **Step 3:** `for f in lib/*.test.mjs; do node "$f" || echo "ÉCHEC $f"; done` → aucun « ÉCHEC ».
- [ ] **Step 4:** `npx expo export -p web` → compile sans erreur.
- [ ] **Step 5:** `graphify update .`
- [ ] **Step 6:** Commit + push :

```bash
git add -A
git commit -m "docs(fournisseurs): spéc à jour + graphe"
git push
```

- [ ] **Step 7:** Mémoire : créer `fournisseurs-administratifs.md` (commit, migration à passer, fonction `rappels-tresorerie` à redéployer avec `--project-ref wlwotzxnzowbkbfcpnyi` lors de la publication, pas publié) + ligne dans `MEMORY.md`.
- [ ] **Step 8:** Résumé à l'utilisateur en français simple : ce qui change, la migration à passer, puis transformer CNPS / TEE / ITS / IMPÔT ET TIMBRE / CONTRAT DE BAIL de chaque restaurant (Crédits → « Passer en administratif ») et saisir leur retard avec « Modifier ».
