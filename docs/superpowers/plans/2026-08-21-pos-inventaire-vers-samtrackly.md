# Pont inventaire POS → Samtrackly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Étendre le pont existant POS → Samtrackly pour qu'il pousse aussi l'inventaire de chaque service clôturé (ligne d'en-tête + lignes par produit + réceptions), avec la retenue argent qui va avec.

**Architecture:** Extension de `transfererService()` dans `supabase/functions/samtrackly-points/index.ts` (dépôt `pos-samer`, cloud POS). Nouveau module pur `_shared/samtrackly-inventaire.ts` (aucun accès réseau, testé avec `node --test`), consommé par `index.ts` au même passage que le shift. Une colonne neuve côté Samtrackly (`inventaires_shifts.pos_service_id`) porte l'idempotence.

**Tech Stack:** Deno (Edge Functions Supabase), TypeScript, `node --test` pour les tests (Node lit le TS directement, Deno n'est pas installé sur ce Mac), PostgREST côté Samtrackly.

## Global Constraints

- Toute somme d'argent transitant par ce pont doit rester déterministe et testée avant d'écrire du réseau (spec § 4, § 6) — pas de calcul d'argent dans du code non testé.
- `montant_a_deduire` (et chaque `montant_deduit` de ligne) = calculé **seulement si** l'inventaire POS est validé normalement (`valide = true` ET `debloque_par` nul) ; **`0` sinon** (débloqué manager) — spec § 4, décision du 2026-08-20.
- `explication_statut = 'en_attente'` doit être posé pour toute ligne avec une explication ET un écart non nul, **indépendamment** du cas validé/débloqué — spec § 4, décision confirmée du 2026-08-21.
- Idempotence : `upsert` sur `pos_service_id` pour l'en-tête ; purge + réinsertion scopée à `inventaire_id` pour les lignes et les entrées (spec § 5) — jamais de doublon en rejouant un transfert.
- Un échec sur l'inventaire (en-tête ou lignes) doit faire échouer tout le transfert du service (comme le shift aujourd'hui) — c'est la partie argent. Un échec sur les entrées (`entrees_shift`, traçabilité seulement) ne doit jamais bloquer le reste — même principe que le rattrapage journal déjà présent dans `index.ts`.
- `produits_inventaire.code` (POS) = `inventaire_lignes.produit_id` (Samtrackly) — identifiants texte déjà identiques, aucune table de correspondance à inventer.

---

## Task 1: Migration Samtrackly — colonne d'idempotence

**Files:**
- Create: `/Users/macbookpro/samtrackly/supabase_pos_inventaire.sql`

**Interfaces:**
- Produces: colonne `inventaires_shifts.pos_service_id` (UUID, UNIQUE), utilisée par Task 4 comme cible d'`upsert`.

- [ ] **Step 1: Écrire le fichier de migration**

```sql
-- ════════════════════════════════════════════════════════════════════════════
--  Pont inventaire POS → Samtrackly — colonne d'idempotence
--
--  Spéc : docs/superpowers/specs/2026-08-20-pos-inventaire-vers-samtrackly-design.md
--  À lancer dans SAMTRACKLY (pas le cloud POS). Rejouable sans risque.
--
--  Même patron que points_shifts.pos_service_id (supabase_pos_bascule.sql) :
--  un renvoi après coupure retombe sur la même ligne au lieu d'en créer une
--  seconde.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.inventaires_shifts
  ADD COLUMN IF NOT EXISTS pos_service_id UUID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'un_inventaires_shifts_pos_service') THEN
    DROP INDEX public.un_inventaires_shifts_pos_service;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'un_inventaires_shifts_pos_service'
  ) THEN
    ALTER TABLE public.inventaires_shifts
      ADD CONSTRAINT un_inventaires_shifts_pos_service UNIQUE (pos_service_id);
  END IF;
END $$;

COMMENT ON COLUMN public.inventaires_shifts.pos_service_id IS
  'Id du service POS d''origine (clé d''idempotence du pont). NULL pour un inventaire saisi à la main.';


-- ── Vérification ────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'inventaires_shifts' AND column_name = 'pos_service_id';
--
--   SELECT conname FROM pg_constraint WHERE conname = 'un_inventaires_shifts_pos_service';
```

- [ ] **Step 2: Ne PAS l'exécuter automatiquement**

Ce fichier est à coller dans l'éditeur SQL de Samtrackly par vous — je n'ai pas d'accès DDL depuis cette session (seule la clé anon publique est disponible ici, elle ne peut pas faire d'`ALTER TABLE`). Je vous le signalerai à la fin du plan.

---

## Task 2: Helper DELETE dans `samtrackly-api.ts`

**Files:**
- Modify: `/Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-api.ts`

**Interfaces:**
- Produces: `supprimer(chemin: string): Promise<void>` — `chemin` inclut la table et le filtre PostgREST (ex. `'inventaire_lignes?inventaire_id=eq.<uuid>'`).
- Consumes: le helper interne `appeler()` déjà présent dans ce fichier (inchangé).

- [ ] **Step 1: Ajouter la fonction**

Ajouter à la fin de `/Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-api.ts` :

```ts
/**
 * Suppression. `chemin` inclut la table et le filtre PostgREST — jamais un
 * DELETE sans filtre, PostgREST le refuse de toute façon sans `Prefer:
 * return=minimal` explicite ici, donc une faute de filtre échoue fort plutôt
 * que de vider une table.
 */
export function supprimer(chemin: string): Promise<void> {
  return appeler(
    chemin,
    { method: 'DELETE', headers: entetes({ Prefer: 'return=minimal' }) },
    `DELETE ${chemin}`,
  ).then(() => undefined);
}
```

- [ ] **Step 2: Vérifier que le fichier compile toujours (lecture seule, pas de build Deno ici)**

Run: `node --check /Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-api.ts 2>&1 | head -5`

`node --check` accepte la syntaxe TS de base (types effacés) ; ce n'est pas une vraie vérification de types, juste un filet anti-faute-de-frappe. Expected: aucune sortie (pas d'erreur de syntaxe).

- [ ] **Step 3: Commit**

```bash
cd /Users/macbookpro/pos-samer
git add supabase/functions/_shared/samtrackly-api.ts
git commit -m "feat(pont): ajoute le helper DELETE pour purger les lignes d'inventaire avant réécriture"
```

---

## Task 3: Module pur `samtrackly-inventaire.ts` (TDD)

**Files:**
- Create: `/Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-inventaire.ts`
- Test: `/Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-inventaire.test.ts`

**Interfaces:**
- Consumes: rien (module pur, aucune dépendance réseau).
- Produces (utilisés par Task 4) :
  - `typeShiftDe(heureDebut: string | null): string`
  - `construireInventaireShift(inventaire: InventaireServiceCloud, ctx: ContexteInventaire): LigneInventaireShift`
  - `construireLignesInventaire(lignes: LigneInventairePosCloud[], produits: Map<string, ProduitInfo>, invShiftId: string, valideNormalement: boolean): LigneInventaireDetail[]`
  - `construireEntreesShift(entrees: EntreeStockCloud[], produits: Map<string, ProduitInfo>, invShiftId: string): LigneEntreeShift[]`
  - Types : `InventaireServiceCloud`, `ContexteInventaire`, `LigneInventaireShift`, `LigneInventairePosCloud`, `ProduitInfo`, `LigneInventaireDetail`, `EntreeStockCloud`, `LigneEntreeShift`

### Step 1: Écrire les tests (ils doivent tous échouer au départ — le fichier `samtrackly-inventaire.ts` n'existe pas encore)

- [ ] Créer `/Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-inventaire.test.ts` :

```ts
// ──────────────────────────────────────────────────────────────────────────────
// Tests de samtrackly-inventaire.ts — conversion inventaire POS → Samtrackly.
//
// Deuxième partie du pont qui manipule de l'argent (après samtrackly-shift.ts) :
// une erreur ici déduit un montant faux sur la paie d'un caissier.
//
// Exécution locale : node --test supabase/functions/_shared/samtrackly-inventaire.test.ts
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  typeShiftDe,
  construireInventaireShift,
  construireLignesInventaire,
  construireEntreesShift,
  type ProduitInfo,
} from './samtrackly-inventaire.ts';

describe('typeShiftDe — le créneau le plus proche', () => {
  test('08:00 pile → matin', () => {
    assert.equal(typeShiftDe('08:00'), 'matin');
  });

  test('16:00 pile → soir', () => {
    assert.equal(typeShiftDe('16:00'), 'soir');
  });

  test('00:05 → nuit (le plus proche de minuit)', () => {
    assert.equal(typeShiftDe('00:05'), 'nuit');
  });

  test('23:50 → nuit malgré la distance en horloge murale (proximité circulaire à minuit)', () => {
    assert.equal(typeShiftDe('23:50'), 'nuit');
  });

  test('12:00 pile → double', () => {
    assert.equal(typeShiftDe('12:00'), 'double');
  });

  test('égalité exacte (10:00, à 2h de matin et de double) → le créneau le plus matinal l’emporte', () => {
    assert.equal(typeShiftDe('10:00'), 'matin');
  });

  test('heure absente → repli sur matin, jamais une exception', () => {
    assert.equal(typeShiftDe(null), 'matin');
  });

  test('heure mal formée → repli sur matin, jamais une exception', () => {
    assert.equal(typeShiftDe('pas une heure'), 'matin');
  });
});

describe('construireInventaireShift — la ligne d’en-tête', () => {
  const CTX = {
    pointId: 'point-1',
    restaurantId: 'resto-1',
    caissierId: 'user-1',
    date: '2026-08-19',
    heureDebut: '16:00',
    heureFin: '00:00',
    posServiceId: 'svc-1',
  };

  test('validé normalement → montant_a_deduire reprend le manquant du POS', () => {
    const inv = { id: 'inv-1', valide: true, debloque_par: null, montant_manquant: 3_500 };
    const ligne = construireInventaireShift(inv, CTX);
    assert.equal(ligne.montant_a_deduire, 3_500);
    assert.equal(ligne.valide, true);
    assert.equal(ligne.pos_service_id, 'svc-1');
    assert.equal(ligne.type_shift, 'soir');
  });

  test('débloqué par un manager → montant_a_deduire à zéro, même si le POS a un manquant chiffré', () => {
    const inv = { id: 'inv-1', valide: false, debloque_par: 'mgr-1', montant_manquant: 7_000 };
    const ligne = construireInventaireShift(inv, CTX);
    assert.equal(ligne.montant_a_deduire, 0, 'un comptage admis incomplet par un manager ne doit jamais déduire');
  });

  test('valide ET débloqué en même temps (état impossible en théorie, non protégé par une CHECK en base) → traité comme débloqué, par prudence', () => {
    const inv = { id: 'inv-1', valide: true, debloque_par: 'mgr-1', montant_manquant: 7_000 };
    const ligne = construireInventaireShift(inv, CTX);
    assert.equal(ligne.montant_a_deduire, 0);
  });
});

describe('construireLignesInventaire — le détail par produit', () => {
  const PRODUITS = new Map<string, ProduitInfo>([
    ['uuid-p1', { code: 'p1', nom: 'Pain chawarma', prix: 2_500 }],
    ['uuid-po8', { code: 'po8', nom: 'Total poulet', prix: 8_000 }],
  ]);

  test('produit_id devient le code, pas l’uuid POS', () => {
    const lignes = [
      { produit_id: 'uuid-p1', stock_initial: '10', entrees: '0', sorties: '8', stock_compte: '2', ecart: '0', quantite_expliquee: '0', explication: null },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.produit_id, 'p1');
    assert.equal(l.inventaire_id, 'inv-shift-1');
  });

  test('manquant non expliqué chiffré : même formule que calcul.ts (écart négatif − expliqué, jamais sous zéro, arrondi au FCFA)', () => {
    // po8 : écart −3, rien d'expliqué, prix 8000 → 3 × 8000 = 24 000
    const lignes = [
      { produit_id: 'uuid-po8', stock_initial: '20', entrees: '0', sorties: '17', stock_compte: '17', ecart: '-3', quantite_expliquee: '0', explication: null },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.montant_deduit, 24_000);
  });

  test('une quantité expliquée réduit le manquant chiffré avant l’arrondi', () => {
    // écart −3, 1 unité expliquée → 2 restantes × 8000 = 16 000
    const lignes = [
      { produit_id: 'uuid-po8', stock_initial: '20', entrees: '0', sorties: '17', stock_compte: '17', ecart: '-3', quantite_expliquee: '1', explication: 'cassé' },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.montant_deduit, 16_000);
  });

  test('un surplus (écart positif) ne déduit jamais rien', () => {
    const lignes = [
      { produit_id: 'uuid-p1', stock_initial: '10', entrees: '0', sorties: '5', stock_compte: '6', ecart: '1', quantite_expliquee: '0', explication: null },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.montant_deduit, 0);
  });

  test('inventaire débloqué → montant_deduit à zéro sur toutes les lignes, même avec un écart réel', () => {
    const lignes = [
      { produit_id: 'uuid-po8', stock_initial: '20', entrees: '0', sorties: '17', stock_compte: '17', ecart: '-3', quantite_expliquee: '0', explication: null },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', false);
    assert.equal(l.montant_deduit, 0);
  });

  test('une explication avec écart réel → explication_statut en_attente, MÊME sur un inventaire débloqué', () => {
    const lignes = [
      { produit_id: 'uuid-po8', stock_initial: '20', entrees: '0', sorties: '17', stock_compte: '17', ecart: '-3', quantite_expliquee: '1', explication: 'cassé' },
    ];
    const [validee] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    const [debloquee] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', false);
    assert.equal(validee.explication_statut, 'en_attente');
    assert.equal(debloquee.explication_statut, 'en_attente', 'le déblocage manager évite la retenue automatique, pas la revue du vérificateur');
  });

  test('un écart nul avec une explication ne déclenche pas la revue (rien à revoir)', () => {
    const lignes = [
      { produit_id: 'uuid-p1', stock_initial: '10', entrees: '0', sorties: '10', stock_compte: '10', ecart: '0', quantite_expliquee: '0', explication: 'texte sans objet' },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.explication_statut, undefined);
  });

  test('sans explication et sans écart → pas de statut du tout', () => {
    const lignes = [
      { produit_id: 'uuid-p1', stock_initial: '10', entrees: '0', sorties: '10', stock_compte: '10', ecart: '0', quantite_expliquee: '0', explication: null },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.explication_statut, undefined);
  });

  test('un produit_id absent du catalogue (supprimé entretemps) est écarté plutôt que de faire planter le transfert', () => {
    const lignes = [
      { produit_id: 'uuid-inconnu', stock_initial: '1', entrees: '0', sorties: '1', stock_compte: '0', ecart: '0', quantite_expliquee: '0', explication: null },
    ];
    const resultat = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(resultat.length, 0);
  });

  test('entrees est reprise telle quelle depuis la ligne figée du POS', () => {
    const lignes = [
      { produit_id: 'uuid-p1', stock_initial: '10', entrees: '5', sorties: '8', stock_compte: '7', ecart: '0', quantite_expliquee: '0', explication: null },
    ];
    const [l] = construireLignesInventaire(lignes, PRODUITS, 'inv-shift-1', true);
    assert.equal(l.entrees, 5);
  });
});

describe('construireEntreesShift — les réceptions détaillées', () => {
  const PRODUITS = new Map<string, ProduitInfo>([
    ['uuid-p1', { code: 'p1', nom: 'Pain chawarma', prix: 2_500 }],
    ['uuid-b7', { code: 'b7', nom: 'Darina', prix: 0 }],
  ]);

  test('une entrée normale devient une ligne entrees_shift avec le code produit', () => {
    const entrees = [{ produit_id: 'uuid-p1', quantite: '20', fournisseur: 'Boulangerie Awa' }];
    const [l] = construireEntreesShift(entrees, PRODUITS, 'inv-shift-1');
    assert.equal(l.produit_id, 'p1');
    assert.equal(l.produit_nom, 'Pain chawarma');
    assert.equal(l.quantite, 20);
    assert.equal(l.fournisseur_nom, 'Boulangerie Awa');
    assert.equal(l.fournisseur_id, null, 'le POS n’a qu’un texte libre, jamais un id fournisseur Samtrackly');
    assert.equal(l.source, 'reception');
    assert.equal(l.inventaire_id, 'inv-shift-1');
  });

  test('le produit Darina (b7) est exclu : son entrée vit dans inventaire_lignes.entrees, pas ici', () => {
    const entrees = [
      { produit_id: 'uuid-p1', quantite: '20', fournisseur: null },
      { produit_id: 'uuid-b7', quantite: '4', fournisseur: null },
    ];
    const resultat = construireEntreesShift(entrees, PRODUITS, 'inv-shift-1');
    assert.equal(resultat.length, 1);
    assert.equal(resultat[0].produit_id, 'p1');
  });

  test('un fournisseur absent devient null, jamais une chaîne vide', () => {
    const entrees = [{ produit_id: 'uuid-p1', quantite: '3', fournisseur: null }];
    const [l] = construireEntreesShift(entrees, PRODUITS, 'inv-shift-1');
    assert.equal(l.fournisseur_nom, null);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent tous (le module n'existe pas)**

Run: `cd /Users/macbookpro/pos-samer && node --test supabase/functions/_shared/samtrackly-inventaire.test.ts`
Expected: FAIL — `Cannot find module './samtrackly-inventaire.ts'` (ou équivalent). C'est le signal attendu à ce stade.

### Step 3: Écrire l'implémentation

- [ ] Créer `/Users/macbookpro/pos-samer/supabase/functions/_shared/samtrackly-inventaire.ts` :

```ts
// ──────────────────────────────────────────────────────────────────────────────
// Conversion de l'inventaire d'un service POS clôturé en lignes Samtrackly.
//
// Deuxième partie du pont qui manipule de l'argent (après samtrackly-shift.ts) :
// une erreur ici ne plante pas — elle déduit un montant faux sur la paie d'un
// caissier. D'où sa séparation, ses tests, et l'absence de tout accès réseau.
//
// Spéc : samtrackly/docs/superpowers/specs/2026-08-20-pos-inventaire-vers-samtrackly-design.md
//
// ⚠ produits_inventaire.code (POS) = inventaire_lignes.produit_id (Samtrackly)
// — le même identifiant texte des deux côtés, catalogue de comptage repris tel
// quel de Samtrackly. Pas de table de correspondance : une simple recherche par
// uuid POS → code.
// ──────────────────────────────────────────────────────────────────────────────

/** Nombre sûr : une donnée absente ou non numérique vaut 0, jamais NaN. */
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Nombre sûr ou null : distingue « pas de valeur » de « zéro » (ecart, stock_reel). */
function nOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// ---------------------------------------------------------------------------
// Le créneau (matin/soir/nuit/double) le plus proche de l'heure réelle
// ---------------------------------------------------------------------------

const MINUTES_PAR_JOUR = 24 * 60;

/** Ordre volontaire : décide qui gagne une égalité exacte de distance. */
const CRENEAUX: { id: string; minutes: number }[] = [
  { id: 'nuit', minutes: 0 },
  { id: 'matin', minutes: 8 * 60 },
  { id: 'double', minutes: 12 * 60 },
  { id: 'soir', minutes: 16 * 60 },
];

function minutesDe(heure: string | null): number | null {
  if (!heure) return null;
  const m = /^(\d{2}):(\d{2})/.exec(heure);
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

/** Distance en minutes sur une horloge de 24h (23h50 est à 10 min de minuit, pas à 23h50). */
function distanceCirculaire(a: number, b: number): number {
  const d = Math.abs(a - b) % MINUTES_PAR_JOUR;
  return Math.min(d, MINUTES_PAR_JOUR - d);
}

/**
 * Le créneau `inventaires_shifts.type_shift` (matin/soir/nuit/double) le plus
 * proche de l'heure d'ouverture réelle du service POS. `points_shifts` n'a pas
 * besoin de cette notion (il garde l'heure réelle) ; `inventaires_shifts` si —
 * c'est une contrainte de Samtrackly, pas du POS.
 *
 * Heure absente ou mal formée → repli sur 'matin', jamais une exception : un
 * mauvais créneau affiché est un détail visuel, une inventaire qui ne part pas
 * du tout est une vente perdue.
 */
export function typeShiftDe(heureDebut: string | null): string {
  const minutes = minutesDe(heureDebut);
  if (minutes === null) return 'matin';

  let meilleur = CRENEAUX[0]!.id;
  let meilleureDistance = Infinity;
  for (const c of CRENEAUX) {
    const d = distanceCirculaire(minutes, c.minutes);
    if (d < meilleureDistance) {
      meilleureDistance = d;
      meilleur = c.id;
    }
  }
  return meilleur;
}

// ---------------------------------------------------------------------------
// L'en-tête : inventaires_shifts
// ---------------------------------------------------------------------------

export interface InventaireServiceCloud {
  id: string;
  valide: boolean;
  debloque_par: string | null;
  montant_manquant: number | null;
}

export interface ContexteInventaire {
  pointId: string;
  restaurantId: string;
  caissierId: string | null;
  date: string | null;
  heureDebut: string | null;
  heureFin: string | null;
  posServiceId: string;
}

export interface LigneInventaireShift {
  point_id: string;
  caissier_id: string | null;
  restaurant_id: string;
  date: string | null;
  type_shift: string;
  heure_debut: string | null;
  heure_fin: string | null;
  valide: boolean;
  montant_a_deduire: number;
  pos_service_id: string;
}

/**
 * Un inventaire est « validé normalement » seulement si `valide` est vrai ET
 * qu'aucun manager ne l'a débloqué. Les deux ne devraient jamais être vrais en
 * même temps (l'API POS le refuse par 409 des deux côtés), mais rien ne
 * l'empêche en base — un double contrôle ici coûte une ligne, pas un incident.
 */
function valideNormalement(inv: InventaireServiceCloud): boolean {
  return inv.valide === true && !inv.debloque_par;
}

/**
 * La ligne d'en-tête `inventaires_shifts`. `valide` est toujours `true` à
 * l'arrivée : la clôture du service POS garantit déjà que l'inventaire est
 * validé OU débloqué (jamais entre les deux) — voir § 1 de la spec.
 */
export function construireInventaireShift(
  inventaire: InventaireServiceCloud,
  ctx: ContexteInventaire,
): LigneInventaireShift {
  return {
    point_id: ctx.pointId,
    caissier_id: ctx.caissierId,
    restaurant_id: ctx.restaurantId,
    date: ctx.date,
    type_shift: typeShiftDe(ctx.heureDebut),
    heure_debut: ctx.heureDebut,
    heure_fin: ctx.heureFin,
    valide: true,
    montant_a_deduire: valideNormalement(inventaire) ? n(inventaire.montant_manquant) : 0,
    pos_service_id: ctx.posServiceId,
  };
}

// ---------------------------------------------------------------------------
// Le détail : inventaire_lignes
// ---------------------------------------------------------------------------

export interface ProduitInfo {
  code: string;
  nom: string;
  prix: number;
}

export interface LigneInventairePosCloud {
  produit_id: string;
  stock_initial: string | number | null;
  entrees: string | number | null;
  sorties: string | number | null;
  stock_compte: string | number | null;
  ecart: string | number | null;
  quantite_expliquee: string | number | null;
  explication: string | null;
}

export interface LigneInventaireDetail {
  inventaire_id: string;
  produit_id: string;
  stock_initial: number;
  entrees: number;
  sorties: number;
  stock_reel: number | null;
  ecart: number | null;
  nombre_explique: number | null;
  explication: string | null;
  montant_deduit: number;
  explication_statut?: 'en_attente';
}

/**
 * Le manquant non expliqué chiffré d'une ligne — MÊME FORMULE que
 * `manque_chiffre` dans `modules/inventaire/calcul.ts` côté POS (c'est celle
 * qui a produit le `montant_manquant` de l'en-tête, ligne par ligne cette
 * fois) : seul un écart négatif (manquant) coûte, l'expliqué s'en retire
 * avant l'arrondi, jamais sous zéro.
 */
function manqueChiffre(ecart: number | null, quantiteExpliquee: number, prix: number): number {
  if (ecart === null || ecart >= 0) return 0;
  const resteInexplique = Math.max(0, Math.abs(ecart) - quantiteExpliquee);
  return Math.round(resteInexplique * prix);
}

/** Même condition que `app/inventaire.js:631` côté Samtrackly. */
function aUneExplicationUtile(explication: string | null, quantiteExpliquee: number): boolean {
  return !!(explication && explication.trim()) || quantiteExpliquee > 0;
}

/**
 * Les lignes `inventaire_lignes`, une par produit compté côté POS.
 *
 * Un produit disparu du catalogue entre le comptage et le transfert (cas
 * limite, jamais vu) est écarté plutôt que de faire échouer tout le service —
 * une ligne de moins est visible et corrigeable, un service entier qui ne part
 * jamais ne l'est pas.
 */
export function construireLignesInventaire(
  lignes: LigneInventairePosCloud[],
  produits: Map<string, ProduitInfo>,
  invShiftId: string,
  serviceValideNormalement: boolean,
): LigneInventaireDetail[] {
  const resultat: LigneInventaireDetail[] = [];

  for (const l of lignes) {
    const produit = produits.get(l.produit_id);
    if (!produit) continue;

    const ecart = nOuNull(l.ecart);
    const quantiteExpliquee = n(l.quantite_expliquee);
    const montantDeduit = serviceValideNormalement
      ? manqueChiffre(ecart, quantiteExpliquee, produit.prix)
      : 0;

    const ligne: LigneInventaireDetail = {
      inventaire_id: invShiftId,
      produit_id: produit.code,
      stock_initial: n(l.stock_initial),
      entrees: n(l.entrees),
      sorties: n(l.sorties),
      stock_reel: nOuNull(l.stock_compte),
      ecart,
      nombre_explique: nOuNull(l.quantite_expliquee),
      explication: l.explication ?? null,
      montant_deduit: montantDeduit,
    };

    // Le déblocage manager évite la retenue automatique (ci-dessus), il ne
    // dispense pas de la revue du vérificateur — une explication écrite dans
    // le POS repasse par la même file d'attente qu'une explication manuelle.
    if (aUneExplicationUtile(ligne.explication, quantiteExpliquee) && ecart !== null && Math.abs(ecart) > 0.01) {
      ligne.explication_statut = 'en_attente';
    }

    resultat.push(ligne);
  }

  return resultat;
}

// ---------------------------------------------------------------------------
// Les réceptions : entrees_shift
// ---------------------------------------------------------------------------

/** Le produit dont l'entrée vit dans `inventaire_lignes.entrees` plutôt qu'ici. */
const CODE_DARINA = 'b7';

export interface EntreeStockCloud {
  produit_id: string;
  quantite: string | number;
  fournisseur: string | null;
}

export interface LigneEntreeShift {
  inventaire_id: string;
  fournisseur_id: null;
  fournisseur_nom: string | null;
  produit_id: string;
  produit_nom: string;
  quantite: number;
  source: 'reception';
}

/**
 * Les réceptions détaillées, pour la traçabilité manager (« 20 pains reçus de
 * Boulangerie Awa ») — n'entrent dans AUCUN calcul d'argent, `ecart` et
 * `entrees` sont déjà figés côté POS et repris tels quels dans
 * `construireLignesInventaire`. `fournisseur_id` reste toujours `null` : le
 * POS ne connaît qu'un texte libre, jamais l'id structuré des fournisseurs
 * Samtrackly.
 */
export function construireEntreesShift(
  entrees: EntreeStockCloud[],
  produits: Map<string, ProduitInfo>,
  invShiftId: string,
): LigneEntreeShift[] {
  const resultat: LigneEntreeShift[] = [];

  for (const e of entrees) {
    const produit = produits.get(e.produit_id);
    if (!produit || produit.code === CODE_DARINA) continue;

    resultat.push({
      inventaire_id: invShiftId,
      fournisseur_id: null,
      fournisseur_nom: e.fournisseur && e.fournisseur.trim() ? e.fournisseur : null,
      produit_id: produit.code,
      produit_nom: produit.nom,
      quantite: n(e.quantite),
      source: 'reception',
    });
  }

  return resultat;
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent tous**

Run: `cd /Users/macbookpro/pos-samer && node --test supabase/functions/_shared/samtrackly-inventaire.test.ts`
Expected: PASS — tous les tests verts (22 tests environ).

- [ ] **Step 5: Lancer la suite complète des fonctions pour vérifier l'absence de régression**

Run: `cd /Users/macbookpro/pos-samer && npm run test:functions`
Expected: PASS — le nouveau fichier s'ajoute au glob `_shared/*.test.ts`, aucun test existant cassé.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbookpro/pos-samer
git add supabase/functions/_shared/samtrackly-inventaire.ts supabase/functions/_shared/samtrackly-inventaire.test.ts
git commit -m "feat(pont): module pur de conversion inventaire POS → Samtrackly, testé"
```

---

## Task 4: Brancher dans le pont (`samtrackly-points/index.ts`)

**Files:**
- Modify: `/Users/macbookpro/pos-samer/supabase/functions/samtrackly-points/index.ts`

**Interfaces:**
- Consumes: tout ce que produit Task 3 (`typeShiftDe` n'est pas appelé directement ici, seulement `construireInventaireShift`/`construireLignesInventaire`/`construireEntreesShift`), et `supprimer`/`upsert`/`inserer`/`lire` de Task 2 + l'existant `samtrackly-api.ts`.
- Produces: rien de plus — c'est le point d'intégration final.

- [ ] **Step 1: Ajouter les imports**

En haut du fichier, à côté des imports existants de `_shared/samtrackly-detail.ts` :

```ts
import {
  construireInventaireShift,
  construireLignesInventaire,
  construireEntreesShift,
  type InventaireServiceCloud,
  type ProduitInfo,
} from '../_shared/samtrackly-inventaire.ts';
```

Et ajouter `supprimer` à l'import existant de `_shared/samtrackly-api.ts` :

```ts
import { ErreurSamtrackly, lire, inserer, upsert, patch, supprimer, samtracklyConfigure } from '../_shared/samtrackly-api.ts';
```

- [ ] **Step 2: Lire l'inventaire d'un service côté POS**

Ajouter cette fonction juste après `resoudreEquipeRH` (avant la section « Le point (journée) côté SamerTrackly ») :

```ts
// ---------------------------------------------------------------------------
// L'inventaire du service, côté POS
// ---------------------------------------------------------------------------

interface InventaireDuService {
  inventaire: InventaireServiceCloud;
  lignes: {
    produit_id: string;
    stock_initial: string | number | null;
    entrees: string | number | null;
    sorties: string | number | null;
    stock_compte: string | number | null;
    ecart: string | number | null;
    quantite_expliquee: string | number | null;
    explication: string | null;
  }[];
  entrees: { produit_id: string; quantite: string | number; fournisseur: string | null }[];
}

/**
 * Null si ce service n'a jamais eu d'inventaire (cas théorique seulement — la
 * clôture POS le garantit) : le shift part quand même, l'inventaire est un
 * bonus, pas une condition d'envoi de la vente.
 */
async function lireInventaireDuService(
  admin: SupabaseClient,
  serviceId: string,
): Promise<InventaireDuService | null> {
  const { data: inventaire } = await admin
    .from('inventaires_service')
    .select('id, valide, debloque_par, montant_manquant')
    .eq('service_id', serviceId)
    .maybeSingle();
  if (!inventaire) return null;

  const [{ data: lignes }, { data: entrees }] = await Promise.all([
    admin
      .from('inventaire_lignes')
      .select('produit_id, stock_initial, entrees, sorties, stock_compte, ecart, quantite_expliquee, explication')
      .eq('inventaire_id', inventaire.id),
    admin
      .from('entrees_stock')
      .select('produit_id, quantite, fournisseur')
      .eq('inventaire_id', inventaire.id),
  ]);

  return {
    inventaire: inventaire as InventaireServiceCloud,
    lignes: lignes ?? [],
    entrees: entrees ?? [],
  };
}
```

- [ ] **Step 3: Charger le catalogue de produits une seule fois par passage**

Dans `Deno.serve`, juste après la ligne `const admin = clientAdmin();`, ajouter :

```ts
  // Chargé une seule fois par passage (catalogue stable, ~50 produits) plutôt
  // que refait à chaque service — même raison que `configParResto` plus bas.
  const { data: catalogueInventaire } = await admin
    .from('produits_inventaire')
    .select('id, code, nom, prix');
  const produitsParId = new Map<string, ProduitInfo>(
    (catalogueInventaire ?? []).map((p) => [p.id as string, { code: p.code, nom: p.nom, prix: p.prix } as ProduitInfo]),
  );
```

- [ ] **Step 4: Étendre `transfererService()` pour pousser l'inventaire**

`transfererService` a la signature `(admin, service, restaurantStId)`. Lui ajouter un quatrième paramètre `produitsParId: Map<string, ProduitInfo>`, et à la fin de la fonction (juste avant le `return { pointId, journee, vente: ..., ... }` existant), insérer :

```ts
  // ── Inventaire ────────────────────────────────────────────────────────────
  // Bonus du shift, pas une condition : si rien n'a jamais été compté pour ce
  // service (cas théorique), on continue sans rien écrire côté inventaire.
  let nbLignesInventaire = 0;
  const inventaireDuService = await lireInventaireDuService(admin, service.id);
  if (inventaireDuService) {
    const ligneInventaireShift = construireInventaireShift(inventaireDuService.inventaire, {
      pointId,
      restaurantId: restaurantStId,
      caissierId: caissier.id,
      date: journee,
      heureDebut: ligneShift.heure_debut,
      heureFin: ligneShift.heure_fin,
      posServiceId: service.id,
    });

    // L'inventaire est de l'argent, comme le shift : un échec ici doit faire
    // échouer tout le transfert du service (voir le catch de l'appelant), pas
    // être avalé en silence.
    const [inventaireShiftSt] = await upsert(
      'inventaires_shifts',
      [ligneInventaireShift as unknown as Record<string, unknown>],
      'pos_service_id',
    );
    const invShiftId = (inventaireShiftSt as { id: string }).id;

    const serviceValideNormalement = inventaireDuService.inventaire.valide === true
      && !inventaireDuService.inventaire.debloque_par;
    const lignesDetail = construireLignesInventaire(
      inventaireDuService.lignes,
      produitsParId,
      invShiftId,
      serviceValideNormalement,
    );
    await supprimer(`inventaire_lignes?inventaire_id=eq.${invShiftId}`);
    await inserer('inventaire_lignes', lignesDetail as unknown as Record<string, unknown>[]);
    nbLignesInventaire = lignesDetail.length;

    // Les réceptions détaillées sont de la traçabilité, jamais un calcul
    // d'argent (voir samtrackly-inventaire.ts) : une panne ici ne doit jamais
    // annuler ce qui vient d'être écrit au-dessus — même principe que le
    // rattrapage journal plus bas dans ce fichier.
    try {
      const lignesEntrees = construireEntreesShift(inventaireDuService.entrees, produitsParId, invShiftId);
      await supprimer(`entrees_shift?inventaire_id=eq.${invShiftId}`);
      await inserer('entrees_shift', lignesEntrees as unknown as Record<string, unknown>[]);
    } catch (e) {
      // Volontairement avalé : voir le commentaire ci-dessus. La ligne
      // apparaît dans `bilan.details` de l'appelant via le `resultat` normal,
      // pas ici — ce sous-échec ne doit pas remonter comme un échec du service.
    }
  }
```

Et modifier le `return` existant de `transfererService` pour inclure `nbLignesInventaire` :

```ts
  return {
    pointId,
    journee,
    vente: ligneShift.vente_shift,
    nbDep: lignesDepenses.length,
    nbPres: lignesPresences.length,
    nbInv: nbLignesInventaire,
    ignores,
  };
```

- [ ] **Step 5: Mettre à jour l'appel à `transfererService` et le type de retour**

Dans `Deno.serve`, la ligne `const r = await transfererService(admin, service as never, restaurantStId);` devient :

```ts
      const r = await transfererService(admin, service as never, restaurantStId, produitsParId);
```

Et mettre à jour la signature `Promise<{ pointId: string; journee: string; vente: number; nbDep: number; nbPres: number }>` de `transfererService` pour ajouter `nbInv: number`.

- [ ] **Step 6: Enrichir le message de bilan**

Dans la boucle `for (const service of aTraiter)`, la ligne qui construit `bilan.details.push({ service: service.id, resultat: ... })` après un succès devient :

```ts
      bilan.details.push({
        service: service.id,
        resultat:
          `${r.journee} · ${r.vente} F` +
          (r.nbInv > 0 ? ` · inventaire (${r.nbInv} produits)` : '') +
          (r.ignores.length > 0 ? ` · ${r.ignores.length} présence(s) en attente de fiche RH` : ''),
      });
```

- [ ] **Step 7: Ajouter `SupabaseClient` à l'import de type si absent**

Vérifier que `import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';` est bien déjà présent en haut du fichier (il l'est, réutilisé par `lireInventaireDuService`) — aucune action si c'est déjà le cas.

- [ ] **Step 8: Vérification syntaxique**

Run: `node --check /Users/macbookpro/pos-samer/supabase/functions/samtrackly-points/index.ts 2>&1 | head -20`
Expected: aucune erreur de syntaxe. (Toujours pas une vraie vérification de types Deno — celle-ci se fera au déploiement.)

- [ ] **Step 9: Relancer toute la suite de tests des fonctions**

Run: `cd /Users/macbookpro/pos-samer && npm run test:functions`
Expected: PASS — `index.ts` n'a pas de test direct (c'est de la plomberie, testée par les modules purs qu'il appelle), mais aucun test existant ne doit casser.

- [ ] **Step 10: Commit**

```bash
cd /Users/macbookpro/pos-samer
git add supabase/functions/samtrackly-points/index.ts
git commit -m "feat(pont): pousse l'inventaire de chaque service dans le même passage que le shift"
```

---

## Task 5: Déploiement et vérification en conditions réelles

**Files:** aucun — étapes manuelles, à faire par vous (accès Supabase requis, absent de cette session).

- [ ] **Step 1: Exécuter la migration Task 1** dans l'éditeur SQL de **Samtrackly** (pas le cloud POS) :

Coller le contenu de `/Users/macbookpro/samtrackly/supabase_pos_inventaire.sql`.

- [ ] **Step 2: Vérifier la nullabilité de `entrees_shift.fournisseur_id`**

```sql
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'entrees_shift' AND column_name = 'fournisseur_id';
```

Si `is_nullable = 'NO'`, la Task 4 (Step 4) plantera dès la première entrée poussée — mais elle est déjà protégée par le try/catch « avalé volontairement », donc **rien ne cassera**, seule la traçabilité des réceptions manquera silencieusement pour les sites POS. Si vous préférez que ces réceptions apparaissent vraiment, revenez me voir : il suffira de rendre la colonne nullable par une migration d'une ligne (`ALTER TABLE entrees_shift ALTER COLUMN fournisseur_id DROP NOT NULL;`).

- [ ] **Step 3: Déployer la fonction** depuis `pos-samer` :

```bash
cd /Users/macbookpro/pos-samer
supabase functions deploy samtrackly-points
```

- [ ] **Step 4: Attendre le prochain passage du cron (5 min) et vérifier**

```sql
-- Cloud POS : le passage a-t-il tourné, et sans erreur ?
SELECT start_time, status, left(return_message, 300)
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'pont-samtrackly'
 ORDER BY start_time DESC LIMIT 3;
```

```sql
-- Samtrackly : le prochain service clôturé avec inventaire validé a-t-il
-- bien poussé un montant_a_deduire cohérent avec le POS ?
SELECT s.date, s.pos_service_id, i.type_shift, i.montant_a_deduire, i.valide
  FROM points_shifts s
  JOIN inventaires_shifts i ON i.pos_service_id = s.pos_service_id
 WHERE s.pos_service_id IS NOT NULL
 ORDER BY s.date DESC LIMIT 5;
```

- [ ] **Step 5: Confirmer côté écran** — ouvrir `recap-point.js` sur un point d'Angré 7E dont l'inventaire vient d'arriver : la bannière « 🔒 Inventaire du jour requis » doit avoir disparu **pour la vraie raison** cette fois (une ligne `inventaires_shifts.valide = true` existe), pas seulement grâce au filet `pointVenuDuPOS` posé le 2026-08-20.

---

## Self-Review (fait avant de vous remettre ce plan)

- **Couverture de la spec** : § 4 (en-tête + lignes + entrées) → Tasks 3-4 ; § 5 (idempotence) → Task 2 (`supprimer`) + `upsert` réutilisé ; § 6 (filet `pointVenuDuPOS` inchangé, `montant_manquant` reste informatif côté POS) → aucune modification POS nécessaire, déjà vrai ; § 7 (migration) → Task 1.
- **Type-consistency** : `ProduitInfo`, `InventaireServiceCloud`, `LigneInventaireDetail` ont les mêmes noms et formes entre Task 3 (définition) et Task 4 (usage) — vérifié en écrivant Task 4 avec les types de Task 3 sous les yeux.
- **Écart avec la spec, assumé et documenté** : la spec ne précisait pas si `entrees_shift.fournisseur_id` accepte `null` — inconnu depuis cette session (pas d'accès au schéma Samtrackly complet). Traité en échec silencieux non bloquant (Task 4 Step 4) plutôt qu'en supposition risquée, avec la vérification et le correctif possible explicités en Task 5 Step 2.
