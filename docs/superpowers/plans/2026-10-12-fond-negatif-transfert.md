# Remettre un fond négatif à 0 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bouton manager « Remettre le fond à 0 » qui remonte un fond de caisse négatif (en tout ou en partie) en transférant le montant vers une dette administration (Trésorerie) ou le fournisseur « Report caisse » du restaurant, avec annulation.

**Architecture:** deux fonctions SQL atomiques (`transferer_fond_negatif`, `annuler_transfert_fond`) font toutes les écritures (ajustement_fond, dette ou transaction fournisseur, trace, journal). L'app : une logique pure testée (`lib/transfertFond.js`), un accès base (`lib/transfertFondDb.js`), une feuille unique (`components/tresorerie/FeuilleTransfertFond.js`) ouverte depuis la Trésorerie (alerte + bloc « Fonds négatifs ») et la Vérification.

**Tech Stack:** Expo / React Native web, Supabase (PL/pgSQL + PostgREST rpc), tests `node:test`.

Spéc : `docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md`

## Global Constraints

- Interface et messages en français ; montants en F (FCFA).
- Fond laissé = `reste_fc + ajustement_fond` du dernier point validé ; ne jamais toucher `reste_fc`.
- Ne jamais ajouter `ajustement_fond` à l'update de `app/modifier-point.js`.
- Toute correction d'un solde fournisseur = transaction via `inserer_transaction_hors_point`, jamais un `update credit_actuel`.
- Les règles (montant > 0, ≤ négatif, fond < 0) sont vérifiées dans le SQL, pas seulement à l'écran.
- Alert web : 2 boutons maximum.
- La migration est passée par l'utilisateur (SQL Editor) ; je n'exécute aucune écriture SQL sur la base.
- Avant commit : `npm run lint` (0 erreur) et `for f in lib/*.test.mjs; do node "$f"; done` (0 échec). Commit + push, **pas de publication** (Vercel/EAS en fin de lot).

---

### Task 1 : logique pure + champ `fond` dans l'alerte

**Files:**
- Create: `lib/transfertFond.js`
- Create: `lib/transfertFond.test.mjs`
- Modify: `lib/alertes.js` (alerte `fond` : ajouter la valeur `fond`)
- Modify: `lib/alertes.test.mjs` (un test sur `fond`)

**Interfaces:**
- Produces : `DESTINATIONS`, `montantMaxTransfert(fond) → number`, `fondApres(fond, montant) → number`, `validerTransfert({ fond, montant, destination }) → string|null`, `fondsNegatifs(points, nomResto) → [{ restaurant_id, nom, fond, date }]`, ré-export `fondLaisse`.
- Alerte `type: 'fond'` porte désormais `fond` (number).

- [ ] **Step 1 : tests** — `lib/transfertFond.test.mjs`

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { DESTINATIONS, fondApres, fondsNegatifs, montantMaxTransfert, validerTransfert } from './transfertFond.js'

describe('montant maximum', () => {
  test('tout le négatif', () => assert.equal(montantMaxTransfert(-315612), 315612))
  test('centimes : arrondi au franc supérieur', () => assert.equal(montantMaxTransfert(-134764.25), 134765))
  test('fond positif ou nul : rien à transférer', () => {
    assert.equal(montantMaxTransfert(0), 0)
    assert.equal(montantMaxTransfert(20450), 0)
  })
})

describe('validation', () => {
  const ok = { fond: -407006, destination: 'dette_admin' }
  test('montant partiel accepté', () => assert.equal(validerTransfert({ ...ok, montant: 100000 }), null))
  test('tout accepté', () => assert.equal(validerTransfert({ ...ok, montant: 407006 }), null))
  test('report caisse accepté', () => assert.equal(validerTransfert({ ...ok, destination: 'report_caisse', montant: 1 }), null))
  test('au-delà du négatif refusé', () => assert.match(validerTransfert({ ...ok, montant: 407007 }), /dépasse/))
  test('zéro refusé', () => assert.match(validerTransfert({ ...ok, montant: 0 }), /supérieur à 0/))
  test('décimal refusé', () => assert.match(validerTransfert({ ...ok, montant: 10.5 }), /supérieur à 0/))
  test('destination inconnue refusée', () => assert.match(validerTransfert({ ...ok, destination: 'banque', montant: 10 }), /Choisissez/))
  test('fond positif refusé', () => assert.match(validerTransfert({ fond: 5000, destination: 'dette_admin', montant: 10 }), /pas négatif/))
  test('deux destinations', () => assert.deepEqual(Object.keys(DESTINATIONS), ['dette_admin', 'report_caisse']))
})

test('fond après transfert', () => {
  assert.equal(fondApres(-430212, 430212), 0)
  assert.equal(fondApres(-430212, 30212), -400000)
})

describe('fonds négatifs', () => {
  const noms = id => ({ pal: 'Palmeraie', yop: 'Yop', oas: 'Oasis' }[id])
  const points = [
    { restaurant_id: 'pal', date: '2026-10-10', valide: true, reste_fc: -100, ajustement_fond: 0 },
    { restaurant_id: 'pal', date: '2026-10-11', valide: true, reste_fc: -3167467, ajustement_fond: 0 },
    { restaurant_id: 'pal', date: '2026-10-12', valide: false, reste_fc: 0 },
    { restaurant_id: 'yop', date: '2026-10-11', valide: true, reste_fc: -407006, ajustement_fond: 7006 },
    { restaurant_id: 'oas', date: '2026-10-11', valide: true, reste_fc: 20450 },
  ]
  test('dernier point validé, du plus creusé au moins creusé, positifs exclus', () => {
    assert.deepEqual(fondsNegatifs(points, noms), [
      { restaurant_id: 'pal', nom: 'Palmeraie', fond: -3167467, date: '2026-10-11' },
      { restaurant_id: 'yop', nom: 'Yop', fond: -400000, date: '2026-10-11' },
    ])
  })
})
```

Dans `lib/alertes.test.mjs`, ajouter (dans le `describe` du fond s'il existe, sinon en fin de fichier) :

```js
test('alerte fond : porte la valeur du fond', () => {
  const a = calculerAlertes({
    aujourdhui: '2026-10-12', nomResto,
    points: [{ restaurant_id: 'kms', date: '2026-10-11', valide: true, reste_fc: -1248460, ajustement_fond: 0 }],
    plafonds: [{ restaurant_id: 'kms', plafond: 300000 }],
  })
  assert.equal(a[0].type, 'fond')
  assert.equal(a[0].fond, -1248460)
})
```

- [ ] **Step 2 : lancer, constater l'échec** — `node lib/transfertFond.test.mjs` → module introuvable ; `node lib/alertes.test.mjs` → `fond` undefined.

- [ ] **Step 3 : implémentation** — `lib/transfertFond.js`

```js
// ──────────────────────────────────────────────────────────────────────────────
// Fond de caisse négatif remis à 0 (en tout ou en partie) : le trou part en
// dette administration (l'administration doit la somme au restaurant) ou chez
// le fournisseur « Report caisse » du restaurant. Logique pure ; les écritures
// sont faites par la fonction SQL transferer_fond_negatif.
// Spéc : docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md
// Tests : lib/transfertFond.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { derniersPoints, fondLaisse } from './alertes.js'

export { fondLaisse }

export const DESTINATIONS = {
  dette_admin: {
    label: 'Dette administration',
    detail: "L'administration doit cette somme au restaurant (Trésorerie → Dettes).",
  },
  report_caisse: {
    label: 'Report caisse',
    detail: 'Le crédit du fournisseur « Report caisse » du restaurant monte d’autant.',
  },
}

const n = v => Number(v) || 0
const fmtF = v => `${Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`

// Tout le négatif, arrondi au franc supérieur (certains fonds ont des centimes).
export function montantMaxTransfert(fond) {
  const f = n(fond)
  return f < 0 ? Math.ceil(-f) : 0
}

export function fondApres(fond, montant) {
  return n(fond) + n(montant)
}

// Message d'erreur en français, ou null si le transfert est possible.
export function validerTransfert({ fond, montant, destination }) {
  if (!DESTINATIONS[destination]) return 'Choisissez où transférer : dette administration ou Report caisse.'
  const max = montantMaxTransfert(fond)
  if (!max) return "Le fond de ce restaurant n'est pas négatif."
  const m = Number(montant)
  if (!Number.isInteger(m) || m <= 0) return 'Saisissez un montant supérieur à 0.'
  if (m > max) return `Le montant dépasse le fond négatif (${fmtF(max)} maximum).`
  return null
}

// Restaurants dont le dernier point validé laisse un fond négatif, du plus
// creusé au moins creusé.
export function fondsNegatifs(points = [], nomResto = id => id) {
  return Object.entries(derniersPoints(points))
    .map(([id, p]) => ({ restaurant_id: id, nom: nomResto(id), fond: fondLaisse(p), date: p.date }))
    .filter(f => f.fond < 0)
    .sort((a, b) => a.fond - b.fond)
}
```

Dans `lib/alertes.js`, bloc « 3. Fond sous le plafond », ajouter `fond,` à l'objet poussé :

```js
        cle: `fond:${pl.restaurant_id}:${p.date}`, type: 'fond', niveau: 'orange', restaurant_id: pl.restaurant_id, fond,
```

- [ ] **Step 4 : tests verts** — `node lib/transfertFond.test.mjs && node lib/alertes.test.mjs` → 0 échec.

- [ ] **Step 5 : commit** — `git add lib/transfertFond.js lib/transfertFond.test.mjs lib/alertes.js lib/alertes.test.mjs && git commit -m "feat(fond): logique du transfert d'un fond négatif"`

---

### Task 2 : migration SQL

**Files:**
- Create: `supabase_fond_transferts.sql`

**Interfaces:**
- Produces : table `transferts_fond` ; `transferer_fond_negatif(p_restaurant uuid, p_montant bigint, p_destination text, p_note text, p_user_id text, p_user_nom text) → uuid` ; `annuler_transfert_fond(p_transfert uuid, p_user_id text, p_user_nom text) → void`.
- Consumes : `inserer_transaction_hors_point` (supabase_factures_mensuelles.sql, déjà passée).

- [ ] **Step 1 : écrire le fichier**

```sql
-- =====================================================================
--  FOND DE CAISSE NÉGATIF → REMIS À 0 (en tout ou en partie)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Le trou du fond part :
--   - en DETTE ADMINISTRATION : une dette de la Trésorerie (l'administration
--     doit cette somme au restaurant) ;
--   - chez le fournisseur « REPORT CAISSE » du restaurant (créé au premier
--     transfert) : une facture sans journée, son crédit monte d'autant.
--  Le fond remonte via points.ajustement_fond du dernier point validé
--  (même mécanique que les régularisations d'écart). reste_fc n'est jamais
--  touché.
--  Spéc : docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md
-- =====================================================================

do $$
begin
  if to_regclass('public.transactions_fournisseurs') is null or to_regclass('public.tresorerie_dus') is null then
    raise exception 'Mauvais projet Supabase : tables introuvables. Ce script est destiné à Samtrackly (wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

CREATE TABLE IF NOT EXISTS transferts_fond (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants(id),
  date            date NOT NULL DEFAULT current_date,
  montant         bigint NOT NULL CHECK (montant > 0),
  destination     text NOT NULL CHECK (destination IN ('dette_admin','report_caisse')),
  fond_avant      numeric NOT NULL,
  fond_point_id   uuid REFERENCES points(id) ON DELETE SET NULL,
  du_id           uuid REFERENCES tresorerie_dus(id) ON DELETE SET NULL,
  fournisseur_id  uuid REFERENCES fournisseurs(id) ON DELETE SET NULL,
  transaction_id  uuid REFERENCES transactions_fournisseurs(id) ON DELETE SET NULL,
  note            text,
  cree_par        text,
  cree_par_nom    text,
  annule_le       timestamptz,
  annule_par_nom  text,
  annule_point_id uuid REFERENCES points(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transferts_fond_resto ON transferts_fond (restaurant_id, created_at DESC);

ALTER TABLE transferts_fond ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON transferts_fond;
CREATE POLICY allow_all ON transferts_fond FOR ALL TO public USING (true) WITH CHECK (true);

-- ── Transfert ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transferer_fond_negatif(
  p_restaurant uuid, p_montant bigint, p_destination text, p_note text,
  p_user_id text, p_user_nom text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  pt     record;
  v_fond numeric;
  v_nom  text;
  v_du   uuid;
  v_four uuid;
  v_tx   uuid;
  v_id   uuid;
BEGIN
  IF p_destination NOT IN ('dette_admin','report_caisse') THEN
    RAISE EXCEPTION 'Choisissez où transférer : dette administration ou Report caisse.';
  END IF;
  IF coalesce(p_montant, 0) <= 0 THEN
    RAISE EXCEPTION 'Saisissez un montant supérieur à 0.';
  END IF;

  SELECT id, date, reste_fc, ajustement_fond INTO pt
    FROM points
   WHERE restaurant_id = p_restaurant AND valide
   ORDER BY date DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune journée validée pour ce restaurant.'; END IF;

  v_fond := coalesce(pt.reste_fc, 0) + coalesce(pt.ajustement_fond, 0);
  IF v_fond >= 0 THEN RAISE EXCEPTION 'Le fond de ce restaurant n''est pas négatif.'; END IF;
  IF p_montant > ceil(-v_fond) THEN
    RAISE EXCEPTION 'Le montant dépasse le fond négatif (% F maximum).', ceil(-v_fond)::bigint;
  END IF;

  SELECT trim(nom) INTO v_nom FROM restaurants WHERE id = p_restaurant;

  IF p_destination = 'dette_admin' THEN
    INSERT INTO tresorerie_dus (categorie, restaurant_id, libelle, creancier, montant_du, note, cree_par, cree_par_nom)
    VALUES ('dette', p_restaurant, 'Fond négatif repris par l''administration',
            'Fond de caisse – ' || coalesce(v_nom, 'restaurant'), p_montant, nullif(trim(p_note), ''),
            p_user_id, p_user_nom)
    RETURNING id INTO v_du;
  ELSE
    SELECT id INTO v_four FROM fournisseurs
     WHERE restaurant_id = p_restaurant AND lower(trim(nom)) = 'report caisse'
     ORDER BY created_at
     LIMIT 1;
    IF v_four IS NULL THEN
      INSERT INTO fournisseurs (nom, type, restaurant_id, actif)
      VALUES ('Report caisse', 'fournisseur', p_restaurant, true)
      RETURNING id INTO v_four;
      INSERT INTO fournisseurs_restaurants (fournisseur_id, restaurant_id, credit_actuel)
      VALUES (v_four, p_restaurant, 0)
      ON CONFLICT (fournisseur_id, restaurant_id) DO NOTHING;
    ELSE
      UPDATE fournisseurs SET actif = true WHERE id = v_four AND actif IS NOT TRUE;
    END IF;
    v_tx := inserer_transaction_hors_point(v_four, current_date, p_montant, 0, 'manager', 'report_caisse', p_user_nom);
  END IF;

  UPDATE points SET ajustement_fond = coalesce(ajustement_fond, 0) + p_montant WHERE id = pt.id;

  INSERT INTO transferts_fond (restaurant_id, montant, destination, fond_avant, fond_point_id,
                               du_id, fournisseur_id, transaction_id, note, cree_par, cree_par_nom)
  VALUES (p_restaurant, p_montant, p_destination, v_fond, pt.id,
          v_du, v_four, v_tx, nullif(trim(p_note), ''), p_user_id, p_user_nom)
  RETURNING id INTO v_id;

  INSERT INTO journal_activite (action, details, restaurant_id, point_id, user_id, user_nom)
  VALUES ('fond_transfert',
          jsonb_build_object('transfert_id', v_id, 'montant', p_montant, 'destination', p_destination,
                             'fond_avant', v_fond, 'fond_apres', v_fond + p_montant, 'note', p_note),
          p_restaurant, pt.id, p_user_id, p_user_nom);

  RETURN v_id;
END;
$$;

-- ── Annulation ─────────────────────────────────────────────────────────────
-- Le −montant va sur le dernier point validé AU MOMENT DE L'ANNULATION : si des
-- journées ont été validées depuis, le +montant est déjà passé dans leur FC de
-- la veille ; le retirer sur l'ancien point ne changerait plus le fond.
CREATE OR REPLACE FUNCTION annuler_transfert_fond(p_transfert uuid, p_user_id text, p_user_nom text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  tr record;
  pt record;
BEGIN
  SELECT * INTO tr FROM transferts_fond WHERE id = p_transfert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable.'; END IF;
  IF tr.annule_le IS NOT NULL THEN RAISE EXCEPTION 'Ce transfert est déjà annulé.'; END IF;

  SELECT id INTO pt
    FROM points
   WHERE restaurant_id = tr.restaurant_id AND valide
   ORDER BY date DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune journée validée pour ce restaurant.'; END IF;

  IF tr.destination = 'dette_admin' THEN
    IF tr.du_id IS NOT NULL AND EXISTS (SELECT 1 FROM tresorerie_paiements WHERE du_id = tr.du_id) THEN
      RAISE EXCEPTION 'Cette dette est déjà en partie remboursée : le transfert ne peut plus être annulé.';
    END IF;
    IF tr.du_id IS NOT NULL THEN DELETE FROM tresorerie_dus WHERE id = tr.du_id; END IF;
  ELSIF tr.fournisseur_id IS NOT NULL THEN
    PERFORM inserer_transaction_hors_point(tr.fournisseur_id, current_date, 0, tr.montant,
                                           'manager', 'report_caisse_annule', p_user_nom);
  END IF;

  UPDATE points SET ajustement_fond = coalesce(ajustement_fond, 0) - tr.montant WHERE id = pt.id;

  UPDATE transferts_fond
     SET annule_le = now(), annule_par_nom = p_user_nom, annule_point_id = pt.id
   WHERE id = tr.id;

  INSERT INTO journal_activite (action, details, restaurant_id, point_id, user_id, user_nom)
  VALUES ('fond_transfert_annule',
          jsonb_build_object('transfert_id', tr.id, 'montant', tr.montant, 'destination', tr.destination),
          tr.restaurant_id, pt.id, p_user_id, p_user_nom);
END;
$$;
```

- [ ] **Step 2 : relecture** — vérifier les noms de colonnes contre la base (lecture seule : `information_schema.columns` de `tresorerie_dus`, `fournisseurs`, `fournisseurs_restaurants`, `journal_activite`). Pas d'exécution du script.

- [ ] **Step 3 : commit** — `git add supabase_fond_transferts.sql && git commit -m "feat(fond): migration transferts de fond négatif"`

---

### Task 3 : accès base

**Files:**
- Create: `lib/transfertFondDb.js`

**Interfaces:**
- Consumes : `fondsNegatifs` (Task 1), rpc de la Task 2.
- Produces :
  - `chargerFondRestaurant(restaurantId) → { id, date, reste_fc, ajustement_fond } | null`
  - `chargerTransferts(restaurantId) → { lignes: [], migration: boolean }`
  - `chargerFondsNegatifs(nomResto) → [{ restaurant_id, nom, fond, date }]`
  - `transfererFond({ restaurantId, montant, destination, note }, user) → uuid`
  - `annulerTransfert(id, user) → void`
  - `user = { userId, userNom }` (forme de `useTresorerie().user`)

- [ ] **Step 1 : écrire le fichier**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Fond négatif remis à 0 — lectures et appels des fonctions SQL
// (supabase_fond_transferts.sql). Logique pure : lib/transfertFond.js.
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { aujourdhuiISO } from './tresorerie'
import { fondsNegatifs } from './transfertFond'

const MIGRATION = 'Migration à passer : supabase_fond_transferts.sql (SQL Editor de Supabase).'

// Fonction ou table absente → message clair au lieu d'une erreur technique.
function migrationManquante(error) {
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)
}

function erreur(error) {
  if (migrationManquante(error)) return new Error(MIGRATION)
  return new Error(error?.message || 'Réessayez.')
}

function ilYa(iso, jours) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - jours)
  return d.toISOString().slice(0, 10)
}

// Dernier point validé du restaurant : c'est lui qui porte le fond laissé.
export async function chargerFondRestaurant(restaurantId) {
  const { data, error } = await supabase.from('points')
    .select('id, date, reste_fc, ajustement_fond')
    .eq('restaurant_id', restaurantId).eq('valide', true)
    .order('date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw erreur(error)
  return data || null
}

export async function chargerTransferts(restaurantId) {
  const { data, error } = await supabase.from('transferts_fond').select('*')
    .eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(20)
  if (error) {
    if (migrationManquante(error)) return { lignes: [], migration: true }
    throw erreur(error)
  }
  return { lignes: data || [], migration: false }
}

// Fonds négatifs de tous les restaurants (dernier point validé des 30 derniers jours).
export async function chargerFondsNegatifs(nomResto) {
  const { data, error } = await supabase.from('points')
    .select('restaurant_id, date, valide, reste_fc, ajustement_fond')
    .eq('valide', true).gte('date', ilYa(aujourdhuiISO(), 30)).range(0, 4999)
  if (error) throw erreur(error)
  return fondsNegatifs(data || [], nomResto)
}

export async function transfererFond({ restaurantId, montant, destination, note }, user) {
  const { data, error } = await supabase.rpc('transferer_fond_negatif', {
    p_restaurant: restaurantId, p_montant: montant, p_destination: destination, p_note: note || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw erreur(error)
  return data
}

export async function annulerTransfert(id, user) {
  const { error } = await supabase.rpc('annuler_transfert_fond', {
    p_transfert: id, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw erreur(error)
}
```

- [ ] **Step 2 : lint** — `npx eslint lib/transfertFondDb.js` → 0 erreur.
- [ ] **Step 3 : commit** — `git add lib/transfertFondDb.js && git commit -m "feat(fond): accès base du transfert de fond"`

---

### Task 4 : feuille « Remettre le fond à 0 »

**Files:**
- Create: `components/tresorerie/FeuilleTransfertFond.js`

**Interfaces:**
- Consumes : Task 1 + Task 3 ; `Bouton, Champ, ChampMontant, Feuille, Ligne, Puces, useStylesTreso` de `./commun` ; `fmt, formatDateFR` de `lib/tresorerie`.
- Produces : `export default function FeuilleTransfertFond({ restaurantId, nomResto, user, peutTransferer, onFermer, apres })` — affichée quand `restaurantId` est non nul ; `apres()` appelé après chaque transfert/annulation.

- [ ] **Step 1 : écrire le composant**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// « Remettre le fond à 0 » : transfère tout ou partie d'un fond de caisse
// négatif vers la dette administration ou le fournisseur « Report caisse »,
// et liste les transferts du restaurant (annulables). Ouverte depuis la
// Trésorerie (alerte « Fond bas », bloc « Fonds négatifs ») et la Vérification.
// Spéc : docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'

import { Bouton, Champ, ChampMontant, Feuille, Ligne, Puces, useStylesTreso } from './commun'
import { fmt, formatDateFR } from '../../lib/tresorerie'
import { DESTINATIONS, fondApres, fondLaisse, montantMaxTransfert, validerTransfert } from '../../lib/transfertFond'
import { annulerTransfert, chargerFondRestaurant, chargerTransferts, transfererFond } from '../../lib/transfertFondDb'

const signe = v => (v < 0 ? `− ${fmt(-v)}` : fmt(v))

export default function FeuilleTransfertFond({ restaurantId, nomResto, user, peutTransferer = true, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [point, setPoint] = useState(undefined)   // undefined : chargement ; null : aucune journée validée
  const [historique, setHistorique] = useState({ lignes: [], migration: false })
  const [destination, setDestination] = useState('dette_admin')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  const charger = useCallback(async () => {
    setErreur(null)
    try {
      const [p, h] = await Promise.all([chargerFondRestaurant(restaurantId), chargerTransferts(restaurantId)])
      setPoint(p)
      setHistorique(h)
    } catch (e) {
      setErreur(e?.message || 'Chargement impossible.')
    }
  }, [restaurantId])

  useEffect(() => {
    if (!restaurantId) return
    setPoint(undefined); setMontant(''); setNote(''); setDestination('dette_admin')
    charger()
  }, [restaurantId, charger])

  if (!restaurantId) return null

  const fond = point ? fondLaisse(point) : 0
  const max = montantMaxTransfert(fond)
  const v = montant === '' ? 0 : parseInt(montant, 10)

  async function transferer() {
    setOccupe(true)
    try {
      await transfererFond({ restaurantId, montant: v, destination, note: note.trim() }, user)
      setMontant(''); setNote('')
      await charger()
      if (apres) await apres()
    } catch (e) {
      Alert.alert('Transfert non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  function confirmer() {
    const err = validerTransfert({ fond, montant: v, destination })
    if (err) { Alert.alert('Transfert impossible', err); return }
    Alert.alert(
      'Confirmer le transfert ?',
      `${fmt(v)} F vers ${DESTINATIONS[destination].label}.\nFond de ${nomResto} : ${signe(fond)} F → ${signe(fondApres(fond, v))} F.`,
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Transférer', onPress: transferer },
      ],
    )
  }

  function annuler(t) {
    const suite = t.destination === 'dette_admin'
      ? 'la dette administration est supprimée'
      : 'une écriture inverse est passée au fournisseur Report caisse'
    Alert.alert(
      'Annuler ce transfert ?',
      `${fmt(t.montant)} F vers ${DESTINATIONS[t.destination]?.label}. Le fond redescend d'autant et ${suite}.`,
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Annuler le transfert', style: 'destructive', onPress: async () => {
            try { await annulerTransfert(t.id, user); await charger(); if (apres) await apres() }
            catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  let contenu
  if (erreur) contenu = <Text style={styles.erreur}>{erreur}</Text>
  else if (point === undefined) contenu = <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
  else if (point === null) contenu = <Text style={styles.muted}>Aucune journée validée pour ce restaurant.</Text>
  else {
    contenu = (
      <>
        <Ligne label={`Fond laissé le ${formatDateFR(point.date)}`} valeur={fond} fort
          couleur={fond < 0 ? colors.error : colors.success} />
        {historique.migration && <Text style={[styles.erreur, { marginTop: 8 }]}>Migration à passer : supabase_fond_transferts.sql (SQL Editor de Supabase).</Text>}

        {peutTransferer && max > 0 && !historique.migration && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.label}>Transférer vers</Text>
            <Puces options={Object.entries(DESTINATIONS).map(([valeur, d]) => ({ valeur, label: d.label }))}
              valeur={destination} onChange={setDestination} />
            <Text style={[styles.petit, { marginBottom: 12 }]}>{DESTINATIONS[destination].detail}</Text>

            <ChampMontant label="Montant" valeur={montant} onChange={setMontant} placeholder={fmt(max)} />
            <TouchableOpacity onPress={() => setMontant(String(max))} style={{ marginTop: -6, marginBottom: 12 }}
              accessibilityRole="button" accessibilityLabel={`Tout transférer, ${fmt(max)} francs`}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Tout ({fmt(max)} F)</Text>
            </TouchableOpacity>
            {v > 0 && (
              <Ligne label="Fond après transfert" valeur={fondApres(fond, v)}
                couleur={fondApres(fond, v) < 0 ? colors.error : colors.success} />
            )}
            <Champ label="Motif (facultatif)" value={note} onChangeText={setNote} placeholder="Ex : dépenses gérant non couvertes" />
            <Bouton titre="Remettre le fond à 0" icone="cash-refund" onPress={confirmer} occupe={occupe} desactive={!v} />
          </View>
        )}
        {peutTransferer && max === 0 && (
          <Text style={styles.muted}>Le fond n'est pas négatif : rien à transférer.</Text>
        )}

        {historique.lignes.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.label}>Transferts du fond</Text>
            {historique.lignes.map(t => (
              <View key={t.id} style={[styles.ligne, { opacity: t.annule_le ? 0.5 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ligneLabel}>
                    {formatDateFR(t.date)} · {DESTINATIONS[t.destination]?.label} · {fmt(t.montant)} F
                  </Text>
                  <Text style={styles.petit}>
                    {[t.cree_par_nom, t.note, t.annule_le ? `annulé par ${t.annule_par_nom || '—'}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {peutTransferer && !t.annule_le && (
                  <TouchableOpacity onPress={() => annuler(t)} accessibilityRole="button" accessibilityLabel="Annuler ce transfert">
                    <Text style={{ color: colors.error, fontWeight: '700' }}>Annuler</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </>
    )
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Fond de caisse · ${nomResto}`}>
      {contenu}
    </Feuille>
  )
}
```

Vérifier que `colors.success`, `styles.ligneLabel`, `styles.ligne`, `styles.petit`, `styles.label`, `styles.muted`, `styles.erreur` existent (`components/tresorerie/commun.js` / `lib/theme.js`) ; sinon prendre l'équivalent existant (ex. `colors.successDark`).

- [ ] **Step 2 : lint** — `npx eslint components/tresorerie/FeuilleTransfertFond.js` → 0 erreur.
- [ ] **Step 3 : commit** — `git add components/tresorerie/FeuilleTransfertFond.js && git commit -m "feat(fond): feuille Remettre le fond à 0"`

---

### Task 5 : branchement Trésorerie (alerte + bloc « Fonds négatifs »)

**Files:**
- Modify: `app/tresorerie.js`

**Interfaces:**
- Consumes : `FeuilleTransfertFond` (Task 4), `chargerFondsNegatifs` (Task 3), alerte `a.fond` (Task 1).

- [ ] **Step 1 : imports et état**

```js
import FeuilleTransfertFond from '../components/tresorerie/FeuilleTransfertFond'
import { chargerFondsNegatifs } from '../lib/transfertFondDb'
```
Dans le composant :
```js
  const [fondsNeg, setFondsNeg] = useState([])
  const [transfertResto, setTransfertResto] = useState(null)   // restaurant_id ouvert
```
Effet (après celui des alertes) :
```js
  const rechargerFonds = useCallback(() => {
    if (!donnees) return Promise.resolve()
    const noms = id => donnees.restaurants.find(r => r.id === id)?.nom?.trim() || 'Restaurant'
    return chargerFondsNegatifs(noms).then(setFondsNeg).catch(() => setFondsNeg([]))
  }, [donnees])
  useEffect(() => { if (peut(niveau, 'voir_vue')) rechargerFonds() }, [niveau, rechargerFonds])
```
(ajouter `useCallback` à l'import React.)

- [ ] **Step 2 : bouton sur la carte d'alerte** — dans le `map` des alertes, après le `<Text>` du message :

```jsx
                {a.type === 'fond' && a.fond < 0 && peut(niveau, 'saisir_dus') && (
                  <TouchableOpacity onPress={() => setTransfertResto(a.restaurant_id)}
                    accessibilityRole="button" accessibilityLabel="Remettre le fond à 0">
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.warningDark }}>Remettre à 0</Text>
                  </TouchableOpacity>
                )}
```

- [ ] **Step 3 : bloc « Fonds de caisse négatifs »** — juste après le lien « Voir les N alertes », avant le `Hero` :

```jsx
          {fondsNeg.length > 0 && peut(niveau, 'saisir_dus') && (
            <View style={{ marginBottom: 12 }}>
              <TitreSection icone="cash-remove" couleur={colors.error} titre="Fonds de caisse négatifs" />
              {fondsNeg.map(f => (
                <ItemIcone key={f.restaurant_id} icone="cash-remove" couleur={colors.error}
                  titre={f.nom} sous={`fond laissé le ${formatDateFR(f.date)} · appuyer pour remettre à 0`}
                  droite={`− ${fmt(-f.fond)} F`} couleurDroite={colors.error}
                  onPress={() => setTransfertResto(f.restaurant_id)} />
              ))}
            </View>
          )}
```

- [ ] **Step 4 : la feuille** — dans le bloc `{donnees && (<>…</>)}` des feuilles :

```jsx
          <FeuilleTransfertFond
            restaurantId={transfertResto} nomResto={nomResto(transfertResto).trim()} user={user}
            peutTransferer={peut(niveau, 'saisir_dus')}
            onFermer={() => setTransfertResto(null)}
            apres={async () => {
              await rechargerFonds()
              chargerAlertes().then(setAlertes).catch(() => {})
              await recharger()
            }}
          />
```

- [ ] **Step 5 : lint + tests** — `npm run lint` (0 erreur) ; `for f in lib/*.test.mjs; do node "$f"; done` (0 échec).
- [ ] **Step 6 : commit** — `git add app/tresorerie.js && git commit -m "feat(tresorerie): remettre un fond négatif à 0 depuis l'alerte et la liste"`

---

### Task 6 : branchement Vérification

**Files:**
- Modify: `app/verification.js` (récap, ligne « Reste + Fc », ~l. 2072)

**Interfaces:**
- Consumes : `FeuilleTransfertFond` (Task 4).

- [ ] **Step 1 : import + état**

```js
import FeuilleTransfertFond from '../components/tresorerie/FeuilleTransfertFond'
```
```js
  const [transfertFondOuvert, setTransfertFondOuvert] = useState(false)
```

- [ ] **Step 2 : bouton** — juste après la ligne « Reste + Fc » :

```jsx
                      {roleActif === 'manager' && ((p?.reste_fc || 0) + (p?.ajustement_fond || 0)) < 0 && (
                        <TouchableOpacity onPress={() => setTransfertFondOuvert(true)}
                          style={{ alignSelf: 'flex-end', paddingVertical: 8 }}
                          accessibilityRole="button" accessibilityLabel="Remettre le fond à 0">
                          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Remettre le fond à 0 →</Text>
                        </TouchableOpacity>
                      )}
```

- [ ] **Step 3 : la feuille** — à côté des autres modales de l'écran (niveau racine du rendu) :

```jsx
      <FeuilleTransfertFond
        restaurantId={transfertFondOuvert ? pointSelectionne?.restaurant_id : null}
        nomResto={(restaurants.find(r => r.id === pointSelectionne?.restaurant_id)?.nom || '').trim()}
        user={{ userId, userNom }}
        peutTransferer={roleActif === 'manager'}
        onFermer={() => setTransfertFondOuvert(false)}
        apres={async () => {
          const { data } = await supabase.from('points').select('*').eq('id', pointSelectionne.id).single()
          if (data) setPointSelectionne(data)
        }}
      />
```
(La feuille charge le fond du **dernier** point validé : si le point affiché est plus ancien, elle montre le fond actuel, c'est voulu.)

- [ ] **Step 4 : lint + tests** — comme Task 5.
- [ ] **Step 5 : commit** — `git add app/verification.js && git commit -m "feat(verification): remettre le fond à 0 depuis le récap"`

---

### Task 7 : finition

- [ ] `npm run lint` (0 erreur) et tous les tests `lib/*.test.mjs` (0 échec).
- [ ] `npx expo export -p web` sans erreur (contrôle de compilation, pas de publication).
- [ ] `graphify update .`
- [ ] Mémoire : nouvelle fiche « fond-negatif-transfert » (migration à passer, non publié) + ligne dans MEMORY.md ; lier [[fonds-negatifs-restaurants]] et [[ecart-fond-ajustement]].
- [ ] `git push`.
