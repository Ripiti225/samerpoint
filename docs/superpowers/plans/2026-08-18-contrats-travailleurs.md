# Gestion des contrats de travail (RH) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au RH d'enregistrer les contrats successifs (Stage / CDD / CDI) d'un travailleur, l'alerter à J-15, J-7 et J-3 avant l'échéance, et archiver automatiquement le travailleur si aucun contrat ne prend le relais.

**Architecture :** Toute la logique de dates et de statuts vit dans `lib/contrats.js`, un module pur testable avec `node --test` — aucun accès réseau, aucun composant React. Les écrans (`components/FormulaireContrat.js`, `components/BlocContrats.js`) ne font que l'afficher. La partie automatique est une Edge Function Deno déclenchée par pg_cron, calquée sur `rappel-explications` qui tourne déjà en production.

**Tech Stack :** React Native / Expo Router, Supabase (PostgreSQL + Storage + Edge Functions Deno + pg_cron), tests `node:test` sur fichiers `.test.mjs`.

**Spec :** `docs/superpowers/specs/2026-08-18-contrats-travailleurs-design.md`

## Global Constraints

- **Langue : tout le texte visible est en français.** Libellés, messages d'erreur, notifications. Montants en FCFA.
- **Dates en chaînes `AAAA-MM-JJ`**, jamais d'objet `Date` stocké ou passé entre modules. Les comparaisons se font sur des chaînes ou en UTC — jamais en heure locale, qui décale d'un jour selon le fuseau du navigateur.
- **Aucun `Date.now()` implicite dans `lib/contrats.js`** : toute fonction qui dépend du jour prend `aujourdhui` en paramètre. Sinon les tests ne sont pas reproductibles.
- **Abidjan est à UTC+0.** Le cron à 07:00 UTC tombe à 07:00 heure locale.
- **Le journal ne bloque jamais** : tout appel à `journaliser()` ou `creerNotification()` est suivi de `.catch(() => {})`.
- **Types de contrat** : exactement `'Stage'`, `'CDD'`, `'CDI'`. `'Journalier'` reste une valeur de `travailleurs.type_contrat` mais n'ouvre aucun contrat.
- **Durées** : exactement `3`, `6`, `12` (mois), ou `null` pour une durée libre / un CDI.
- **Paliers d'alerte** : exactement `15`, `7`, `3` (jours).
- Commits conventionnels en français : `feat(rh): ...`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `lib/contrats.js` (créer) | Logique pure : calcul de date de fin, statut, jours restants, palier d'alerte, validation du formulaire |
| `lib/contrats.test.mjs` (créer) | Tests de `lib/contrats.js` |
| `lib/uploadFichier.js` (créer) | Upload web + natif vers un bucket Supabase, extrait de `app/rh.js` |
| `supabase_contrats_travailleurs.sql` (créer) | Migration : table, contraintes, RLS, cron |
| `components/FormulaireContrat.js` (créer) | Modal de saisie d'un contrat |
| `components/BlocContrats.js` (créer) | Bloc « Contrat » affiché dans la fiche travailleur |
| `app/rh.js` (modifier) | Onglet Contrats, branchement du bloc, archivage et suppression |
| `supabase/functions/rappel-contrats/index.ts` (créer) | Alertes J-15/7/3 + désactivation automatique |

`app/rh.js` fait déjà 1971 lignes. Les deux composants vivent donc dans `components/`, comme `FormulaireTravailleur.js`, plutôt que de gonfler l'écran de 500 lignes de plus.

---

### Task 1 : Logique des contrats (`lib/contrats.js`)

Module pur, sans React ni réseau. C'est le cœur : tout le reste ne fait que l'afficher.

**Files:**
- Create: `lib/contrats.js`
- Test: `lib/contrats.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `TYPES_CONTRAT: string[]` → `['Stage','CDD','CDI']`
  - `DUREES_MOIS: number[]` → `[3,6,12]`
  - `PALIERS_ALERTE: number[]` → `[15,7,3]`
  - `aujourdhuiISO(): string` → la date du jour en `'AAAA-MM-JJ'`
  - `ajouterJours(iso: string, n: number): string`
  - `calculerDateFin(dateDebut: string, dureeMois: number): string`
  - `finEffective(contrat): string|null`
  - `statutContrat(contrat, aujourdhui: string): 'a_venir'|'en_cours'|'rompu'|'expire'`
  - `contratEnCours(contrats: object[], aujourdhui: string): object|null`
  - `joursRestants(contrat, aujourdhui: string): number|null`
  - `palierAEnvoyer(contrat, aujourdhui: string): number|null`
  - `doitEtreDesactive(contrats: object[], aujourdhui: string): boolean`
  - `validerFormulaireContrat(form): { ok: boolean, erreur: string|null }`

Un « contrat » est un objet `{ type, date_debut, date_fin, duree_mois, cloture_le, rappels_envoyes }`.

- [x] **Step 1 : Écrire les tests qui échouent**

Créer `lib/contrats.test.mjs` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/contrats.js — les contrats de travail du personnel.
//
// Deux pièges justifient ce fichier. D'abord l'arithmétique des mois : 3 mois
// après le 31 janvier n'existe pas le 31 avril. Ensuite la désactivation
// automatique, qui archive un travailleur : une erreur ici sort quelqu'un des
// effectifs sans que personne l'ait demandé.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  TYPES_CONTRAT, DUREES_MOIS, PALIERS_ALERTE,
  calculerDateFin, finEffective, statutContrat, contratEnCours,
  joursRestants, palierAEnvoyer, doitEtreDesactive, validerFormulaireContrat,
} from './contrats.js'

const CDD = {
  type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-10-16',
  duree_mois: 6, cloture_le: null, rappels_envoyes: [],
}
const CDI = {
  type: 'CDI', date_debut: '2026-01-05', date_fin: null,
  duree_mois: null, cloture_le: null, rappels_envoyes: [],
}

describe('constantes', () => {
  test('les trois types et rien d\'autre', () => {
    assert.deepEqual(TYPES_CONTRAT, ['Stage', 'CDD', 'CDI'])
  })
  test('les durées proposées', () => {
    assert.deepEqual(DUREES_MOIS, [3, 6, 12])
  })
  test('les paliers, du plus lointain au plus proche', () => {
    assert.deepEqual(PALIERS_ALERTE, [15, 7, 3])
  })
})

describe('calculerDateFin', () => {
  test('6 mois après le 16/04/2026', () => {
    assert.equal(calculerDateFin('2026-04-16', 6), '2026-10-16')
  })
  test('12 mois franchissent l\'année', () => {
    assert.equal(calculerDateFin('2026-08-18', 12), '2027-08-18')
  })
  test('3 mois après le 20/11 franchissent l\'année', () => {
    assert.equal(calculerDateFin('2026-11-20', 3), '2027-02-20')
  })
  // Le 31 avril n'existe pas : on retombe sur le dernier jour du mois.
  test('un 31 qui tombe sur un mois de 30 jours est ramené au 30', () => {
    assert.equal(calculerDateFin('2026-01-31', 3), '2026-04-30')
  })
  test('un 30 qui tombe sur février bissextile est ramené au 29', () => {
    assert.equal(calculerDateFin('2027-11-30', 3), '2028-02-29')
  })
  test('sans durée, pas de date', () => {
    assert.equal(calculerDateFin('2026-04-16', null), '')
    assert.equal(calculerDateFin('', 6), '')
  })
})

describe('finEffective', () => {
  test('un CDD non clôturé finit à sa date de fin', () => {
    assert.equal(finEffective(CDD), '2026-10-16')
  })
  test('une clôture anticipée prime sur la date de fin', () => {
    assert.equal(finEffective({ ...CDD, cloture_le: '2026-06-02' }), '2026-06-02')
  })
  test('un CDI n\'a pas de fin', () => {
    assert.equal(finEffective(CDI), null)
  })
})

describe('statutContrat', () => {
  test('en cours pendant la période', () => {
    assert.equal(statutContrat(CDD, '2026-08-18'), 'en_cours')
  })
  test('en cours le jour même de la fin — le dernier jour est travaillé', () => {
    assert.equal(statutContrat(CDD, '2026-10-16'), 'en_cours')
  })
  test('expiré le lendemain de la fin', () => {
    assert.equal(statutContrat(CDD, '2026-10-17'), 'expire')
  })
  test('à venir avant le début', () => {
    assert.equal(statutContrat(CDD, '2026-04-15'), 'a_venir')
  })
  test('rompu après une clôture anticipée', () => {
    assert.equal(statutContrat({ ...CDD, cloture_le: '2026-06-02' }, '2026-08-18'), 'rompu')
  })
  test('un CDI reste en cours indéfiniment', () => {
    assert.equal(statutContrat(CDI, '2030-01-01'), 'en_cours')
  })
})

describe('contratEnCours', () => {
  const historique = [
    { type: 'Stage', date_debut: '2026-01-15', date_fin: '2026-04-15', duree_mois: 3, cloture_le: null, rappels_envoyes: [] },
    CDD,
  ]
  test('retourne celui qui couvre la date', () => {
    assert.equal(contratEnCours(historique, '2026-08-18').type, 'CDD')
    assert.equal(contratEnCours(historique, '2026-02-01').type, 'Stage')
  })
  test('rien entre deux contrats', () => {
    assert.equal(contratEnCours(historique, '2026-04-16'), null)
  })
  test('rien sur une liste vide', () => {
    assert.equal(contratEnCours([], '2026-08-18'), null)
  })
})

describe('joursRestants', () => {
  test('compte les jours jusqu\'à la fin', () => {
    assert.equal(joursRestants(CDD, '2026-10-09'), 7)
  })
  test('zéro le dernier jour', () => {
    assert.equal(joursRestants(CDD, '2026-10-16'), 0)
  })
  test('négatif après la fin', () => {
    assert.equal(joursRestants(CDD, '2026-10-20'), -4)
  })
  test('un CDI n\'a pas d\'échéance', () => {
    assert.equal(joursRestants(CDI, '2026-10-09'), null)
  })
})

describe('palierAEnvoyer', () => {
  test('J-15 pile', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-10-01'), 15)
  })
  test('J-7 pile, si J-15 est déjà parti', () => {
    assert.equal(palierAEnvoyer({ ...CDD, rappels_envoyes: [15] }, '2026-10-09'), 7)
  })
  test('rien si le palier est déjà parti', () => {
    assert.equal(palierAEnvoyer({ ...CDD, rappels_envoyes: [15] }, '2026-10-01'), null)
  })
  // Contrat saisi tardivement : on ne rate pas le coche, on envoie le palier
  // applicable le plus haut plutôt que d'attendre bêtement J-3.
  test('contrat saisi à 5 jours de la fin : envoie J-7, pas J-3', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-10-11'), 7)
  })
  test('rien à J-20, c\'est trop tôt', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-09-26'), null)
  })
  test('rien après la date de fin', () => {
    assert.equal(palierAEnvoyer(CDD, '2026-10-17'), null)
  })
  test('rien pour un contrat clôturé', () => {
    assert.equal(palierAEnvoyer({ ...CDD, cloture_le: '2026-06-02' }, '2026-10-09'), null)
  })
  test('rien pour un CDI', () => {
    assert.equal(palierAEnvoyer(CDI, '2026-10-09'), null)
  })
})

describe('doitEtreDesactive', () => {
  test('contrat expiré et rien derrière', () => {
    assert.equal(doitEtreDesactive([CDD], '2026-10-17'), true)
  })
  test('pas le dernier jour du contrat', () => {
    assert.equal(doitEtreDesactive([CDD], '2026-10-16'), false)
  })
  // Sans cette règle, le premier passage du cron archivait 130 personnes.
  test('aucun contrat enregistré : on ne touche à rien', () => {
    assert.equal(doitEtreDesactive([], '2026-10-17'), false)
  })
  test('un CDI ne s\'éteint jamais', () => {
    assert.equal(doitEtreDesactive([CDI], '2030-01-01'), false)
  })
  test('le contrat suivant en continuité protège', () => {
    const suivant = { type: 'CDD', date_debut: '2026-10-17', date_fin: '2027-04-17', duree_mois: 6, cloture_le: null, rappels_envoyes: [] }
    assert.equal(doitEtreDesactive([CDD, suivant], '2026-10-17'), false)
  })
  // Le RH a signalé la continuité : l'app n'a pas à archiver puis à lui faire
  // cliquer « Réactiver » trois jours plus tard.
  test('un contrat futur avec trois jours de battement protège aussi', () => {
    const suivant = { type: 'CDD', date_debut: '2026-10-20', date_fin: '2027-04-20', duree_mois: 6, cloture_le: null, rappels_envoyes: [] }
    assert.equal(doitEtreDesactive([CDD, suivant], '2026-10-17'), false)
  })
  test('un contrat rompu et rien derrière : désactivation', () => {
    assert.equal(doitEtreDesactive([{ ...CDD, cloture_le: '2026-06-02' }], '2026-06-03'), true)
  })
})

describe('validerFormulaireContrat', () => {
  const base = { type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-10-16', duree_mois: 6, photo_url: 'https://x/c.jpg' }

  test('un formulaire complet passe', () => {
    assert.deepEqual(validerFormulaireContrat(base), { ok: true, erreur: null })
  })
  test('sans photo, refusé', () => {
    const r = validerFormulaireContrat({ ...base, photo_url: null })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /photo du contrat/i)
  })
  test('sans type, refusé', () => {
    assert.equal(validerFormulaireContrat({ ...base, type: null }).ok, false)
  })
  test('sans date de début, refusé', () => {
    assert.equal(validerFormulaireContrat({ ...base, date_debut: '' }).ok, false)
  })
  test('un CDD sans date de fin, refusé', () => {
    const r = validerFormulaireContrat({ ...base, date_fin: '', duree_mois: null })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /date de fin/i)
  })
  test('un CDI n\'a besoin ni de fin ni de durée', () => {
    const r = validerFormulaireContrat({ type: 'CDI', date_debut: '2026-04-16', date_fin: '', duree_mois: null, photo_url: 'https://x/c.jpg' })
    assert.deepEqual(r, { ok: true, erreur: null })
  })
  test('un CDI avec une date de fin, refusé', () => {
    const r = validerFormulaireContrat({ type: 'CDI', date_debut: '2026-04-16', date_fin: '2026-10-16', duree_mois: null, photo_url: 'https://x/c.jpg' })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /CDI/i)
  })
  test('une fin avant le début, refusé', () => {
    const r = validerFormulaireContrat({ ...base, date_fin: '2026-01-01' })
    assert.equal(r.ok, false)
    assert.match(r.erreur, /après/i)
  })
})
```

- [x] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module './contrats.js'`

- [x] **Step 3 : Écrire `lib/contrats.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Contrats de travail : Stage, CDD, CDI.
//
// Module pur — aucune fonction ne lit l'horloge : la date du jour est toujours
// passée en paramètre. C'est ce qui rend la désactivation automatique testable,
// et donc sûre : elle archive des gens.
//
// Les dates circulent en chaînes 'AAAA-MM-JJ'. Les comparer en chaîne est exact
// pour ce format, et évite le décalage d'un jour que provoque un objet Date lu
// dans le fuseau du navigateur.
// ──────────────────────────────────────────────────────────────────────────────

export const TYPES_CONTRAT = ['Stage', 'CDD', 'CDI']
export const DUREES_MOIS = [3, 6, 12]
export const PALIERS_ALERTE = [15, 7, 3]

const JOUR_MS = 24 * 60 * 60 * 1000

function versUTC(iso) {
  const [a, m, j] = String(iso).split('-').map(Number)
  return Date.UTC(a, m - 1, j)
}

export function aujourdhuiISO() {
  return new Date().toISOString().slice(0, 10)
}

export function ajouterJours(iso, n) {
  return new Date(versUTC(iso) + n * JOUR_MS).toISOString().slice(0, 10)
}

// 3 mois après le 31 janvier tombe sur un 31 avril qui n'existe pas : on
// retombe sur le dernier jour du mois plutôt que de déborder sur mai.
export function calculerDateFin(dateDebut, dureeMois) {
  if (!dateDebut || !dureeMois) return ''
  const [a, m, j] = String(dateDebut).split('-').map(Number)
  const total = (m - 1) + dureeMois
  const annee = a + Math.floor(total / 12)
  const mois = (total % 12) + 1
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const jour = Math.min(j, dernierJour)
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

// Une rupture anticipée prime toujours sur la date prévue.
export function finEffective(contrat) {
  if (!contrat) return null
  return contrat.cloture_le || contrat.date_fin || null
}

export function statutContrat(contrat, aujourdhui) {
  if (!contrat) return null
  if (aujourdhui < contrat.date_debut) return 'a_venir'
  const fin = finEffective(contrat)
  if (!fin) return 'en_cours'
  if (aujourdhui <= fin) return 'en_cours'
  return contrat.cloture_le ? 'rompu' : 'expire'
}

export function contratEnCours(contrats, aujourdhui) {
  return (contrats || []).find(c => statutContrat(c, aujourdhui) === 'en_cours') || null
}

export function joursRestants(contrat, aujourdhui) {
  const fin = finEffective(contrat)
  if (!fin) return null
  return Math.round((versUTC(fin) - versUTC(aujourdhui)) / JOUR_MS)
}

// Le palier applicable le plus haut non encore envoyé. Un contrat saisi à 5
// jours de sa fin reçoit J-7 tout de suite, au lieu d'attendre J-3.
export function palierAEnvoyer(contrat, aujourdhui) {
  if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
  const restants = joursRestants(contrat, aujourdhui)
  if (restants === null || restants < 0) return null
  const envoyes = contrat.rappels_envoyes || []
  for (const palier of PALIERS_ALERTE) {
    if (restants <= palier && !envoyes.includes(palier)) return palier
  }
  return null
}

// Trois verrous : il faut au moins un contrat (sinon le premier passage du cron
// archiverait les 130 travailleurs actifs), aucun contrat couvrant aujourd'hui,
// et aucun contrat à venir — le RH qui saisit le suivant avec trois jours de
// battement a signalé la continuité.
export function doitEtreDesactive(contrats, aujourdhui) {
  const liste = contrats || []
  if (liste.length === 0) return false
  if (contratEnCours(liste, aujourdhui)) return false
  if (liste.some(c => statutContrat(c, aujourdhui) === 'a_venir')) return false
  return true
}

export function validerFormulaireContrat(form) {
  const ko = erreur => ({ ok: false, erreur })
  if (!form?.type || !TYPES_CONTRAT.includes(form.type)) return ko('Choisis le type de contrat.')
  if (!form.date_debut) return ko('Indique la date de début du contrat.')
  if (!form.photo_url) return ko('La photo du contrat signé est obligatoire.')

  if (form.type === 'CDI') {
    if (form.date_fin) return ko("Un CDI n'a pas de date de fin.")
    return { ok: true, erreur: null }
  }
  if (!form.date_fin) return ko('Indique la durée, ou la date de fin du contrat.')
  if (form.date_fin < form.date_debut) return ko('La date de fin doit être après la date de début.')
  return { ok: true, erreur: null }
}
```

- [x] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, tous les tests de `contrats.test.mjs` verts, et les tests existants (`basculePOS`, `ecartPOS`, `sourcePoint`) toujours verts.

- [x] **Step 5 : Commit**

```bash
git add lib/contrats.js lib/contrats.test.mjs
git commit -m "feat(rh): logique des contrats de travail (dates, statuts, paliers d'alerte)"
```

---

### Task 2 : Migration SQL

**Files:**
- Create: `supabase_contrats_travailleurs.sql`

**Interfaces:**
- Produces : la table `contrats_travailleurs` consommée par toutes les tâches suivantes.

Cette migration se passe **à la main dans le SQL Editor de Supabase**, comme les précédentes du dossier. Rien ne l'exécute automatiquement.

- [x] **Step 1 : Écrire la migration**

```sql
-- =====================================================================
--  CONTRATS DE TRAVAIL — Stage / CDD / CDI
--
--  À exécuter dans le SQL Editor de Supabase.
--  Idempotent : relançable sans dégât.
--  Voir docs/superpowers/specs/2026-08-18-contrats-travailleurs-design.md
-- =====================================================================

-- Nécessaire pour la contrainte anti-chevauchement (uuid + daterange).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS contrats_travailleurs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  travailleur_id uuid NOT NULL REFERENCES travailleurs(id) ON DELETE CASCADE,
  restaurant_id  uuid REFERENCES restaurants(id),
  type           text NOT NULL CHECK (type IN ('Stage','CDD','CDI')),
  date_debut     date NOT NULL,
  date_fin       date,
  duree_mois     int CHECK (duree_mois IN (3,6,12)),
  photo_url      text NOT NULL,
  photo_type     text NOT NULL DEFAULT 'photo' CHECK (photo_type IN ('photo','pdf')),
  cloture_le     date,
  cloture_motif  text,
  rappels_envoyes int[] NOT NULL DEFAULT '{}',
  desactivation_faite_le date,
  cree_par       uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contrat_cdi_sans_fin CHECK (
    (type = 'CDI' AND date_fin IS NULL) OR (type <> 'CDI' AND date_fin IS NOT NULL)
  ),
  CONSTRAINT contrat_fin_apres_debut CHECK (date_fin IS NULL OR date_fin >= date_debut),
  CONSTRAINT contrat_cloture_coherente CHECK (cloture_le IS NULL OR cloture_le >= date_debut)
);

-- Un travailleur n'a qu'un seul contrat à la fois. La borne haute est exclusive
-- et décalée d'un jour : le dernier jour du contrat est un jour travaillé.
-- Un CDI (fin NULL) occupe l'intervalle jusqu'à l'infini — impossible d'ouvrir
-- un contrat par-dessus sans clôturer le CDI d'abord.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contrats_sans_chevauchement'
  ) THEN
    ALTER TABLE contrats_travailleurs
      ADD CONSTRAINT contrats_sans_chevauchement
      EXCLUDE USING gist (
        travailleur_id WITH =,
        daterange(date_debut, (COALESCE(cloture_le, date_fin) + 1), '[)') WITH &&
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contrats_travailleur
  ON contrats_travailleurs (travailleur_id, date_debut DESC);
CREATE INDEX IF NOT EXISTS idx_contrats_echeance
  ON contrats_travailleurs (date_fin) WHERE cloture_le IS NULL;

ALTER TABLE contrats_travailleurs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON contrats_travailleurs;
CREATE POLICY allow_all ON contrats_travailleurs
  FOR ALL TO public USING (true) WITH CHECK (true);

-- 'Stage' rejoint les valeurs acceptées sur la fiche travailleur.
-- Si aucune contrainte CHECK n'existe sur type_contrat, ce bloc ne fait rien.
DO $$
DECLARE v_nom text;
BEGIN
  SELECT conname INTO v_nom
    FROM pg_constraint
   WHERE conrelid = 'travailleurs'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type_contrat%'
   LIMIT 1;
  IF v_nom IS NOT NULL THEN
    EXECUTE format('ALTER TABLE travailleurs DROP CONSTRAINT %I', v_nom);
    ALTER TABLE travailleurs ADD CONSTRAINT travailleurs_type_contrat_check
      CHECK (type_contrat IN ('Stage','CDD','CDI','Journalier'));
  END IF;
END $$;

-- =====================================================================
--  CRON QUOTIDIEN (alertes J-15/7/3 + désactivation à l'échéance)
--  Nécessite pg_cron et pg_net activées, et l'Edge Function
--  `rappel-contrats` déployée. Remplace <PROJECT_REF> et
--  <SERVICE_ROLE_KEY> avant d'exécuter ce bloc.
--  Abidjan est à UTC+0 : 07:00 UTC = 07:00 heure locale.
-- =====================================================================
-- SELECT cron.schedule(
--   'rappel-contrats-quotidien',
--   '0 7 * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/rappel-contrats',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
-- Pour supprimer la tâche : SELECT cron.unschedule('rappel-contrats-quotidien');

-- =====================================================================
--  FIN
-- =====================================================================
```

- [x] **Step 2 : Vérifier la syntaxe du fichier**

Le fichier n'est pas exécuté par les tests. Le relire une fois de bout en bout, en vérifiant en particulier que les `$$` des blocs `DO` et du bloc cron commenté sont équilibrés.

- [x] **Step 3 : Commit**

```bash
git add supabase_contrats_travailleurs.sql
git commit -m "feat(rh): migration de la table contrats_travailleurs"
```

- [ ] **Step 4 : Signaler la migration à l'utilisateur**

Ne pas l'exécuter soi-même. Dire à l'utilisateur, en français simple, qu'il doit coller `supabase_contrats_travailleurs.sql` dans le SQL Editor de Supabase et l'exécuter, sans quoi l'écran plantera à l'enregistrement d'un contrat.

---

### Task 3 : Extraire l'upload de fichier (`lib/uploadFichier.js`)

Le formulaire de contrat a besoin exactement de l'upload que `app/rh.js` fait déjà pour les papiers : blob sur le web, base64 en natif. Le copier une deuxième fois garantit que les deux copies divergeront.

**Files:**
- Create: `lib/uploadFichier.js`
- Modify: `app/rh.js` (fonction `uploaderFichierPapier`, ~ lignes 463-493)

**Interfaces:**
- Produces : `uploaderFichier({ uri, bucket, prefixe, estPDF }): Promise<{ url: string, type: 'photo'|'pdf' }>` — lève une exception en cas d'échec.

- [x] **Step 1 : Créer `lib/uploadFichier.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Upload d'un fichier vers un bucket Supabase Storage.
//
// Deux chemins parce que l'URI n'a pas la même nature : sur le web c'est une
// blob URL qu'on refetch, en natif un chemin de fichier qu'on lit en base64.
// Passer par le client supabase-js directement échoue sur l'un des deux.
// ──────────────────────────────────────────────────────────────────────────────
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import { supabase } from './supabase'

export async function uploaderFichier({ uri, bucket, prefixe, estPDF = false }) {
  const ext = estPDF ? 'pdf' : 'jpg'
  const contentType = estPDF ? 'application/pdf' : 'image/jpeg'
  const filename = `${prefixe}_${Date.now()}.${ext}`

  let blob
  if (Platform.OS === 'web') {
    const resp = await fetch(uri)
    blob = await resp.blob()
  } else {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
    const octets = atob(b64)
    const tableau = new Uint8Array(octets.length)
    for (let i = 0; i < octets.length; i++) tableau[i] = octets.charCodeAt(i)
    blob = new Blob([tableau], { type: contentType })
  }

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, blob, { contentType, upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename)
  return { url: data.publicUrl, type: estPDF ? 'pdf' : 'photo' }
}
```

- [x] **Step 2 : Faire consommer le module par `app/rh.js`**

Remplacer le corps de `uploaderFichierPapier` par un appel au module. Le comportement visible ne change pas : même bucket, même préfixe, même message d'erreur.

```js
  async function uploaderFichierPapier(uri, typeDoc, fichierType) {
    setUploadingPapier(true)
    try {
      const { url, type } = await uploaderFichier({
        uri, bucket: 'documents-travailleurs', prefixe: 'papier',
        estPDF: fichierType === 'pdf',
      })
      setPapiersDraft(prev => [...prev, {
        type_document: typeDoc, fichier_url: url,
        fichier_type: type === 'pdf' ? 'pdf' : 'image',
      }])
    } catch {
      Alert.alert('Erreur', "Impossible d'uploader le fichier")
    }
    setUploadingPapier(false)
  }
```

Ajouter l'import en haut de `app/rh.js`, dans le groupe des imports `../lib/` :

```js
import { uploaderFichier } from '../lib/uploadFichier'
```

Vérifier ensuite si `FileSystem` et `Platform` servent encore ailleurs dans `app/rh.js` (`grep -n "FileSystem\.\|Platform\." app/rh.js`) et retirer les imports devenus inutiles — mais **seulement** s'ils ne servent plus nulle part. `FileSystem` est aussi utilisé par l'export Excel.

- [x] **Step 3 : Vérifier**

Run: `npm run lint`
Expected: aucune erreur nouvelle sur `app/rh.js` ni `lib/uploadFichier.js`.

Puis, l'app tournant (`npm start`) : ouvrir RH → Travailleurs → ajouter un travailleur → Papiers → ajouter une photo pour « CNI ». Le `✓ Photo` doit apparaître comme avant.

- [x] **Step 4 : Commit**

```bash
git add lib/uploadFichier.js app/rh.js
git commit -m "refactor(rh): extraction de l'upload de fichier dans lib/uploadFichier.js"
```

---

### Task 4 : Formulaire de contrat (`components/FormulaireContrat.js`)

**Files:**
- Create: `components/FormulaireContrat.js`

**Interfaces:**
- Consumes : `lib/contrats.js` (`TYPES_CONTRAT`, `DUREES_MOIS`, `calculerDateFin`, `validerFormulaireContrat`, `aujourdhuiISO`, `ajouterJours`), `lib/uploadFichier.js`.
- Produces : composant par défaut `FormulaireContrat({ visible, travailleur, contratsExistants, colors, onFermer, onEnregistrer })`.
  `onEnregistrer(contrat)` reçoit `{ type, date_debut, date_fin, duree_mois, photo_url, photo_type }` — `date_fin` et `duree_mois` valent `null` pour un CDI.

- [x] **Step 1 : Écrire le composant**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// Saisie d'un contrat de travail.
//
// L'ordre des champs suit le raisonnement du RH : quel type, à partir de quand,
// pour combien de temps, et la preuve. La date de fin n'est pas un champ à
// remplir mais un résultat affiché — sauf si la durée sort des trois cas.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  TYPES_CONTRAT, DUREES_MOIS, calculerDateFin, validerFormulaireContrat,
  aujourdhuiISO, ajouterJours, finEffective,
} from '../lib/contrats'
import { uploaderFichier } from '../lib/uploadFichier'

const LIBELLE_DUREE = { 3: '3 mois', 6: '6 mois', 12: '1 an' }

function formatFR(iso) {
  if (!iso) return ''
  const [a, m, j] = iso.split('-')
  return `${j}/${m}/${a}`
}

// Premier contrat : la date d'embauche. Renouvellement : le lendemain de la fin
// du dernier contrat, pour ne pas laisser de trou par inadvertance.
function debutParDefaut(travailleur, contratsExistants) {
  const finsConnues = (contratsExistants || [])
    .map(finEffective)
    .filter(Boolean)
    .sort()
  if (finsConnues.length > 0) return ajouterJours(finsConnues[finsConnues.length - 1], 1)
  return travailleur?.date_embauche || aujourdhuiISO()
}

export default function FormulaireContrat({
  visible, travailleur, contratsExistants, colors, onFermer, onEnregistrer,
}) {
  const [type, setType] = useState('CDD')
  const [dateDebut, setDateDebut] = useState('')
  const [duree, setDuree] = useState(6)
  const [dateFinLibre, setDateFinLibre] = useState('')
  const [photo, setPhoto] = useState(null)
  const [upload, setUpload] = useState(false)
  const [enreg, setEnreg] = useState(false)

  useEffect(() => {
    if (!visible) return
    setType('CDD')
    setDateDebut(debutParDefaut(travailleur, contratsExistants))
    setDuree(6)
    setDateFinLibre('')
    setPhoto(null)
  }, [visible, travailleur?.id])

  const estCDI = type === 'CDI'
  const dureeLibre = duree === 'autre'
  const dateFin = estCDI ? '' : (dureeLibre ? dateFinLibre : calculerDateFin(dateDebut, duree))

  const form = {
    type,
    date_debut: dateDebut,
    date_fin: estCDI ? '' : dateFin,
    duree_mois: estCDI || dureeLibre ? null : duree,
    photo_url: photo?.url || null,
  }
  const validation = validerFormulaireContrat(form)

  function choisirFichier() {
    Alert.alert('Contrat signé', 'Type de fichier', [
      { text: 'Photo (JPG/PNG)', onPress: () => prendrePhoto() },
      { text: 'Document PDF', onPress: () => prendrePDF() },
      { text: 'Annuler', style: 'cancel' },
    ])
  }

  async function prendrePhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85,
    })
    if (r.canceled) return
    await televerser(r.assets[0].uri, false)
  }

  async function prendrePDF() {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' })
    if (r.canceled) return
    await televerser(r.assets[0].uri, true)
  }

  async function televerser(uri, estPDF) {
    setUpload(true)
    try {
      const res = await uploaderFichier({
        uri, bucket: 'documents-travailleurs', prefixe: 'contrat', estPDF,
      })
      setPhoto(res)
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer le fichier. Vérifie ta connexion.")
    }
    setUpload(false)
  }

  async function enregistrer() {
    if (!validation.ok) {
      Alert.alert('Contrat incomplet', validation.erreur)
      return
    }
    setEnreg(true)
    await onEnregistrer({
      type,
      date_debut: dateDebut,
      date_fin: estCDI ? null : dateFin,
      duree_mois: estCDI || dureeLibre ? null : duree,
      photo_url: photo.url,
      photo_type: photo.type,
    })
    setEnreg(false)
  }

  const label = { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }
  const input = { backgroundColor: colors.bg, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, marginBottom: 14 }
  const puce = { flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border }
  const puceActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }
  const txtPuce = actif => ({ fontSize: 13, color: actif ? '#fff' : colors.textMuted, fontWeight: actif ? '600' : '400' })

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Nouveau contrat</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 22, color: colors.textMuted }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 18 }}>
              {travailleur?.nom}
            </Text>

            <Text style={label}>Type de contrat *</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {TYPES_CONTRAT.map(t => (
                <TouchableOpacity key={t} style={[puce, type === t && puceActive]} onPress={() => setType(t)}>
                  <Text style={txtPuce(type === t)}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={label}>Date de début *</Text>
            <TextInput
              style={input}
              placeholder="AAAA-MM-JJ"
              value={dateDebut}
              onChangeText={setDateDebut}
              placeholderTextColor="#bbb"
            />

            {!estCDI && (
              <>
                <Text style={label}>Durée *</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {DUREES_MOIS.map(d => (
                    <TouchableOpacity key={d} style={[puce, duree === d && puceActive]} onPress={() => setDuree(d)}>
                      <Text style={txtPuce(duree === d)}>{LIBELLE_DUREE[d]}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[puce, dureeLibre && puceActive]} onPress={() => setDuree('autre')}>
                    <Text style={txtPuce(dureeLibre)}>Autre</Text>
                  </TouchableOpacity>
                </View>

                {dureeLibre ? (
                  <>
                    <Text style={label}>Date de fin *</Text>
                    <TextInput
                      style={input}
                      placeholder="AAAA-MM-JJ"
                      value={dateFinLibre}
                      onChangeText={setDateFinLibre}
                      placeholderTextColor="#bbb"
                    />
                  </>
                ) : (
                  <View style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.text }}>
                      {dateFin
                        ? `Se termine le ${formatFR(dateFin)}`
                        : 'Renseigne la date de début pour voir la date de fin.'}
                    </Text>
                  </View>
                )}
              </>
            )}

            {estCDI && (
              <View style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.textMuted }}>
                  Un CDI n'a pas de date de fin : aucune alerte, aucune désactivation automatique.
                </Text>
              </View>
            )}

            <Text style={label}>Contrat signé * (photo ou PDF)</Text>
            <TouchableOpacity
              style={[input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
              onPress={choisirFichier}
              disabled={upload}
            >
              <Text style={{ fontSize: 15, color: photo ? colors.text : '#bbb' }}>
                {upload ? 'Envoi en cours…' : photo ? `✓ ${photo.type === 'pdf' ? 'PDF' : 'Photo'} ajouté` : 'Ajouter le contrat signé'}
              </Text>
              {upload ? <ActivityIndicator size="small" /> : <Text style={{ color: '#185FA5' }}>+</Text>}
            </TouchableOpacity>

            {!validation.ok && (
              <Text style={{ fontSize: 13, color: '#993C1D', marginBottom: 14 }}>{validation.erreur}</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 30 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center' }}
                onPress={onFermer}
              >
                <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: validation.ok ? '#185FA5' : colors.border, alignItems: 'center' }}
                onPress={enregistrer}
                disabled={!validation.ok || enreg}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {enreg ? 'Enregistrement…' : 'Enregistrer'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
```

- [x] **Step 2 : Vérifier**

Run: `npm run lint`
Expected: aucune erreur sur `components/FormulaireContrat.js`.

Le composant n'est pas encore branché : rien à voir dans l'app à ce stade.

- [x] **Step 3 : Commit**

```bash
git add components/FormulaireContrat.js
git commit -m "feat(rh): formulaire de saisie d'un contrat de travail"
```

---

### Task 5 : Bloc « Contrat » dans la fiche travailleur

**Files:**
- Create: `components/BlocContrats.js`
- Modify: `app/rh.js` (modal de détail travailleur `modalTravailleur`)

**Interfaces:**
- Consumes : `lib/contrats.js`, `components/FormulaireContrat.js`.
- Produces : composant par défaut `BlocContrats({ travailleur, contrats, colors, onAjouter })`.
  `onAjouter()` est appelé au clic sur « + Nouveau contrat » — l'ouverture du formulaire est gérée par `app/rh.js`.

- [x] **Step 1 : Écrire `components/BlocContrats.js`**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// Le contrat en cours d'un travailleur, et son historique replié en dessous.
//
// Le badge d'échéance s'allume à 30 jours : plus tôt il n'apprend rien, plus
// tard il prévient trop tard pour préparer un renouvellement.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { contratEnCours, statutContrat, joursRestants, aujourdhuiISO } from '../lib/contrats'

const SEUIL_BADGE_JOURS = 30

function formatFR(iso) {
  if (!iso) return ''
  const [a, m, j] = iso.split('-')
  return `${j}/${m}/${a}`
}

function libelleStatut(contrat, jour) {
  const s = statutContrat(contrat, jour)
  if (s === 'rompu') return `rompu le ${formatFR(contrat.cloture_le)}${contrat.cloture_motif ? ` · ${contrat.cloture_motif}` : ''}`
  if (s === 'expire') return 'terminé'
  if (s === 'a_venir') return 'à venir'
  return 'en cours'
}

export function badgeEcheance(contrat, jour) {
  if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
  const restants = joursRestants(contrat, jour)
  if (restants === null || restants < 0 || restants > SEUIL_BADGE_JOURS) return null
  if (restants === 0) return { texte: "Dernier jour", couleur: '#993C1D' }
  return {
    texte: `Expire dans ${restants} j`,
    couleur: restants <= 7 ? '#993C1D' : '#854F0B',
  }
}

export default function BlocContrats({ travailleur, contrats, colors, onAjouter }) {
  const [ouvert, setOuvert] = useState(false)
  const jour = aujourdhuiISO()
  const liste = contrats || []
  const courant = contratEnCours(liste, jour)
  const historique = liste.filter(c => c.id !== courant?.id)
  const badge = badgeEcheance(courant, jour)

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 }}>
        Contrat
      </Text>

      {courant ? (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
              {courant.type}
              {courant.date_fin
                ? ` · ${formatFR(courant.date_debut)} → ${formatFR(courant.date_fin)}`
                : ` · depuis le ${formatFR(courant.date_debut)}`}
            </Text>
            {badge && (
              <View style={{ backgroundColor: badge.couleur, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>{badge.texte}</Text>
              </View>
            )}
          </View>
          {courant.photo_url && (
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
              📄 contrat signé{courant.photo_type === 'pdf' ? ' (PDF)' : ''}
            </Text>
          )}
        </View>
      ) : (
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 12 }}>
          Aucun contrat enregistré
        </Text>
      )}

      {historique.length > 0 && (
        <>
          <TouchableOpacity onPress={() => setOuvert(o => !o)} style={{ paddingVertical: 6 }}>
            <Text style={{ fontSize: 13, color: '#185FA5', fontWeight: '500' }}>
              Historique ({historique.length}) {ouvert ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
          {ouvert && historique.map(c => (
            <View key={c.id} style={{ paddingVertical: 6, paddingLeft: 10 }}>
              <Text style={{ fontSize: 13, color: colors.text }}>
                {c.type} · {formatFR(c.date_debut)}
                {c.date_fin ? ` → ${formatFR(c.date_fin)}` : ''}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{libelleStatut(c, jour)}</Text>
            </View>
          ))}
        </>
      )}

      <TouchableOpacity
        style={{ marginTop: 10, alignSelf: 'flex-start', backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 0.5, borderColor: colors.border }}
        onPress={onAjouter}
      >
        <Text style={{ fontSize: 13, color: '#185FA5', fontWeight: '500' }}>+ Nouveau contrat</Text>
      </TouchableOpacity>
    </View>
  )
}
```

- [x] **Step 2 : Charger les contrats et brancher le bloc dans `app/rh.js`**

Ajouter les imports :

```js
import BlocContrats from '../components/BlocContrats'
import FormulaireContrat from '../components/FormulaireContrat'
import { aujourdhuiISO } from '../lib/contrats'
```

Ajouter les états, à côté de `travailleurSelectionne` :

```js
  const [contratsTravailleur, setContratsTravailleur] = useState([])
  const [modalContrat, setModalContrat] = useState(false)
```

Ajouter les deux fonctions, à côté de `archiverTravailleur` :

```js
  async function chargerContrats(travailleurId) {
    if (!travailleurId) { setContratsTravailleur([]); return }
    const { data } = await supabase
      .from('contrats_travailleurs')
      .select('*')
      .eq('travailleur_id', travailleurId)
      .order('date_debut', { ascending: true })
    setContratsTravailleur(data || [])
  }

  async function enregistrerContrat(contrat) {
    const trav = travailleurSelectionne
    if (!trav) return
    const { error } = await supabase.from('contrats_travailleurs').insert({
      ...contrat,
      travailleur_id: trav.id,
      restaurant_id: trav.restaurant_id || null,
      cree_par: userId || null,
    })
    if (error) {
      // Le chevauchement est refusé par la base : c'est la seule erreur que le
      // RH peut corriger lui-même, elle mérite donc son propre message.
      const chevauchement = String(error.message || '').includes('contrats_sans_chevauchement')
      Alert.alert(
        'Contrat non enregistré',
        chevauchement
          ? "Ce travailleur a déjà un contrat sur cette période. Vérifie les dates."
          : "Impossible d'enregistrer le contrat. Vérifie ta connexion et réessaie."
      )
      return
    }
    await supabase.from('documents_travailleurs').insert({
      travailleur_id: trav.id,
      type_document: 'Contrat',
      fichier_url: contrat.photo_url,
      fichier_type: contrat.photo_type === 'pdf' ? 'pdf' : 'image',
    }).then(() => {}, () => {})

    await supabase.from('travailleurs')
      .update({ type_contrat: contrat.type })
      .eq('id', trav.id)

    creerNotification({
      type: 'contrat_ajoute',
      titre: '📝 Contrat enregistré',
      message: `${contrat.type} pour ${trav.nom}${contrat.date_fin ? ` — jusqu'au ${contrat.date_fin}` : ''}`,
      restaurant_id: trav.restaurant_id || null,
      cible_role: ['manager', 'directeur'],
      screen: 'rh',
    }).catch(() => {})

    setModalContrat(false)
    await chargerContrats(trav.id)
    chargerDonnees()
  }
```

Récupérer `userId` depuis le contexte, en complétant la ligne existante :

```js
  const { roleActif, isManager, userId } = useApp() ?? {}
```

Appeler `chargerContrats` à l'ouverture de la fiche : partout où `setModalTravailleur(true)` est suivi de `setTravailleurSelectionne(t)`, ajouter `chargerContrats(t.id)`.

Enfin, insérer le bloc dans le contenu du modal de détail travailleur, juste après l'en-tête (nom, poste, photo) :

```jsx
                <BlocContrats
                  travailleur={travailleurSelectionne}
                  contrats={contratsTravailleur}
                  colors={colors}
                  onAjouter={() => setModalContrat(true)}
                />
```

Et le formulaire, à la fin du composant, à côté des autres modals :

```jsx
      <FormulaireContrat
        visible={modalContrat}
        travailleur={travailleurSelectionne}
        contratsExistants={contratsTravailleur}
        colors={colors}
        onFermer={() => setModalContrat(false)}
        onEnregistrer={enregistrerContrat}
      />
```

- [ ] **Step 3 : Vérifier dans l'app**

Run: `npm run lint` puis `npm start`

Parcours à faire, la migration de la Task 2 devant être passée :
1. RH → Travailleurs → cliquer un travailleur → le bloc « Contrat » affiche « Aucun contrat enregistré ».
2. « + Nouveau contrat » → CDD, début `2026-04-16`, durée 6 mois → « Se termine le 16/10/2026 ».
3. Enregistrer sans photo → le bouton est gris et le message « La photo du contrat signé est obligatoire. » s'affiche.
4. Ajouter une photo → enregistrer → le contrat apparaît dans le bloc.
5. Ré-ouvrir « + Nouveau contrat » → la date de début est pré-remplie au 17/10/2026.
6. Créer un second contrat qui chevauche le premier → message « Ce travailleur a déjà un contrat sur cette période. »

- [x] **Step 4 : Commit**

```bash
git add components/BlocContrats.js app/rh.js
git commit -m "feat(rh): bloc contrat et saisie depuis la fiche travailleur"
```

---

### Task 6 : Onglet « Contrats » dans l'écran RH

**Files:**
- Modify: `app/rh.js` (constante `ONGLETS` ligne 49, rendu des onglets lignes ~1676-1698)

**Interfaces:**
- Consumes : `lib/contrats.js`, `badgeEcheance` exporté par `components/BlocContrats.js`.

- [x] **Step 1 : Ajouter l'onglet et son chargement**

Étendre la constante existante :

```js
const ONGLETS = ['Dashboard', 'Travailleurs', 'Présences', 'Salaires', 'Contrats', 'Archivés']
```

Ajouter les états :

```js
  const [tousContrats, setTousContrats] = useState([])
  const [filtreContrats, setFiltreContrats] = useState('Expire bientôt')
```

Ajouter le chargement, à côté de `chargerArchives` :

```js
  // Une seule requête, puis regroupement en mémoire : les contrats se comptent
  // en dizaines, pas en milliers.
  async function chargerTousContrats() {
    const { data } = await supabase
      .from('contrats_travailleurs')
      .select('*, travailleurs(nom, poste, restaurant_id, actif)')
      .order('date_fin', { ascending: true, nullsFirst: false })
    setTousContrats(data || [])
  }
```

Le déclencher, à côté de la ligne 117 existante :

```js
    if (onglet === 'Contrats') chargerTousContrats()
```

- [x] **Step 2 : Écrire le rendu de l'onglet**

```jsx
  function renderContrats() {
    const jour = aujourdhuiISO()
    const actifs = travailleurs.filter(t => t.actif !== false)
    const avecContrat = new Set(tousContrats.map(c => c.travailleur_id))
    // Les Journaliers n'ont pas de contrat par construction : les compter comme
    // « sans contrat » noierait les 46 fiches qui en attendent vraiment un.
    const sansContrat = actifs.filter(t => !avecContrat.has(t.id) && t.type_contrat !== 'Journalier')

    const filtres = ['Expire bientôt', 'En cours', 'Expirés', 'Sans contrat']

    let lignes = []
    if (filtreContrats === 'Sans contrat') {
      lignes = sansContrat.map(t => ({ sansContrat: true, travailleur: t, id: t.id }))
    } else {
      lignes = tousContrats.filter(c => {
        const statut = statutContrat(c, jour)
        if (filtreContrats === 'En cours') return statut === 'en_cours'
        if (filtreContrats === 'Expirés') return statut === 'expire' || statut === 'rompu'
        return badgeEcheance(c, jour) !== null   // Expire bientôt
      })
    }

    return (
      <View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {filtres.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.ongletBtn, filtreContrats === f && styles.ongletBtnActive]}
              onPress={() => setFiltreContrats(f)}
            >
              <Text style={[styles.ongletTxt, filtreContrats === f && styles.ongletTxtActive]}>
                {f}{f === 'Sans contrat' ? ` (${sansContrat.length})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {lignes.length === 0 && (
          <Text style={{ fontSize: 14, color: colors.textMuted, padding: 20, textAlign: 'center' }}>
            {filtreContrats === 'Expire bientôt'
              ? 'Aucun contrat n\'arrive à échéance dans les 30 jours.'
              : 'Rien à afficher.'}
          </Text>
        )}

        {lignes.map(l => {
          if (l.sansContrat) {
            return (
              <TouchableOpacity
                key={l.id}
                style={styles.travCard}
                onPress={() => { setTravailleurSelectionne(l.travailleur); chargerContrats(l.travailleur.id); setModalTravailleur(true) }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.travNom}>{l.travailleur.nom}</Text>
                  <Text style={styles.travPoste}>
                    {l.travailleur.poste} · aucun contrat enregistré
                  </Text>
                </View>
              </TouchableOpacity>
            )
          }
          const badge = badgeEcheance(l, jour)
          const trav = l.travailleurs || {}
          return (
            <TouchableOpacity
              key={l.id}
              style={styles.travCard}
              onPress={() => {
                const t = travailleurs.find(x => x.id === l.travailleur_id)
                if (!t) return
                setTravailleurSelectionne(t); chargerContrats(t.id); setModalTravailleur(true)
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.travNom}>{trav.nom || '—'}</Text>
                <Text style={styles.travPoste}>
                  {l.type}
                  {l.date_fin ? ` · jusqu'au ${l.date_fin.split('-').reverse().join('/')}` : ' · sans échéance'}
                </Text>
              </View>
              {badge && (
                <View style={{ backgroundColor: badge.couleur, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>{badge.texte}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    )
  }
```

Compléter les imports :

```js
import BlocContrats, { badgeEcheance } from '../components/BlocContrats'
import { aujourdhuiISO, statutContrat } from '../lib/contrats'
```

Et brancher le rendu à côté des autres :

```jsx
          {onglet === 'Contrats' && renderContrats()}
```

Vérifier que les styles `travCard`, `travNom`, `travPoste` existent dans le `makeStyles` de `app/rh.js` (`grep -n "travCard\|travNom\|travPoste" app/rh.js`). S'ils portent d'autres noms, utiliser ceux du rendu Travailleurs existant plutôt que d'en créer de nouveaux.

- [ ] **Step 2 bis : Vérifier dans l'app**

Run: `npm start`

1. RH → onglet **Contrats** → le filtre « Expire bientôt » est actif.
2. Filtre **Sans contrat** → le compteur affiche les fiches non-Journalier sans contrat.
3. Cliquer une ligne → ouvre la fiche du travailleur, bloc Contrat visible.

- [x] **Step 3 : Commit**

```bash
git add app/rh.js
git commit -m "feat(rh): onglet Contrats avec filtres d'échéance"
```

---

### Task 7 : Archivage et suppression clôturent les contrats

**Files:**
- Modify: `app/rh.js` (`archiverTravailleur` ~ligne 328, `supprimerTravailleur` ~ligne 396)

**Interfaces:**
- Consumes : `lib/contrats.js` (`aujourdhuiISO`).

- [x] **Step 1 : Clôturer le contrat en cours à l'archivage**

Dans `archiverTravailleur`, juste après le `update` sur `travailleurs` et avant `creerNotification` :

```js
    // Archiver, c'est rompre le contrat. Sans cette clôture, le cron continuerait
    // d'envoyer des alertes d'échéance pour quelqu'un qui est parti.
    await supabase.from('contrats_travailleurs')
      .update({ cloture_le: aujourdhuiISO(), cloture_motif: motifFinal })
      .eq('travailleur_id', travailleurAction.id)
      .is('cloture_le', null)
      .or(`date_fin.is.null,date_fin.gte.${aujourdhuiISO()}`)
```

- [x] **Step 2 : Effacer les contrats à la suppression définitive**

Dans `supprimerTravailleur`, ajouter la ligne avant la suppression de la fiche :

```js
                    await supabase.from('contrats_travailleurs').delete().eq('travailleur_id', trav.id)
```

Et corriger le texte d'avertissement — supprimer un dossier de contrats sans le dire n'est pas acceptable sur une action irréversible :

```js
      `Supprimer définitivement ${trav.nom} ? Toutes ses présences, ses documents et ses contrats seront effacés. Cette action est irréversible.`,
```

- [ ] **Step 3 : Vérifier dans l'app**

Run: `npm start`

1. Créer un contrat CDD sur un travailleur de test.
2. L'archiver avec le motif « Démission » → ré-ouvrir sa fiche depuis Archivés : l'historique affiche `rompu le <aujourd'hui> · Démission`.
3. Ouvrir la boîte de suppression d'un travailleur → le texte mentionne bien « ses contrats ».
4. Supprimer le travailleur de test → vérifier dans Supabase que `contrats_travailleurs` ne contient plus de ligne pour lui.

- [x] **Step 4 : Commit**

```bash
git add app/rh.js
git commit -m "feat(rh): l'archivage clôture le contrat, la suppression efface les contrats"
```

---

### Task 8 : Alertes automatiques et désactivation (`rappel-contrats`)

**Files:**
- Create: `supabase/functions/rappel-contrats/index.ts`

**Interfaces:**
- Consumes : la table `contrats_travailleurs` (Task 2).
- Produces : rien côté code de l'app. La fonction est appelée par pg_cron.

La logique de `lib/contrats.js` est réécrite ici en TypeScript : une Edge Function Deno ne peut pas importer un module de l'app. Les règles doivent rester identiques — `lib/contrats.test.mjs` fait foi.

- [x] **Step 1 : Écrire la fonction**

```ts
// Supabase Edge Function : rappel-contrats
//
// Deux passes, tous les jours à 07:00 (Abidjan est à UTC+0) :
//   1. alertes d'échéance à J-15, J-7 et J-3, une seule fois par palier ;
//   2. archivage des travailleurs dont plus aucun contrat ne court.
//
// Déploiement :
//   supabase functions deploy rappel-contrats --no-verify-jwt
// Planification : voir le bloc pg_cron dans supabase_contrats_travailleurs.sql
//
// La logique reproduit lib/contrats.js. Les tests de référence sont dans
// lib/contrats.test.mjs — toute divergence ici est un bug.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const ROLES_ADMIN = ['manager', 'directeur', 'rh']
const PALIERS = [15, 7, 3]
const JOUR_MS = 24 * 60 * 60 * 1000

type Contrat = {
  id: string
  travailleur_id: string
  restaurant_id: string | null
  type: string
  date_debut: string
  date_fin: string | null
  cloture_le: string | null
  rappels_envoyes: number[] | null
  desactivation_faite_le: string | null
  travailleurs?: { nom: string; actif: boolean; restaurant_id: string | null } | null
}

const versUTC = (iso: string) => {
  const [a, m, j] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, j)
}
const finEffective = (c: Contrat) => c.cloture_le || c.date_fin || null
const joursRestants = (c: Contrat, jour: string) => {
  const fin = finEffective(c)
  return fin === null ? null : Math.round((versUTC(fin) - versUTC(jour)) / JOUR_MS)
}
const enCours = (c: Contrat, jour: string) => {
  if (jour < c.date_debut) return false
  const fin = finEffective(c)
  return fin === null || jour <= fin
}
const aVenir = (c: Contrat, jour: string) => jour < c.date_debut

function palierAEnvoyer(c: Contrat, jour: string): number | null {
  if (c.cloture_le || !c.date_fin) return null
  const restants = joursRestants(c, jour)
  if (restants === null || restants < 0) return null
  const envoyes = c.rappels_envoyes || []
  for (const p of PALIERS) {
    if (restants <= p && !envoyes.includes(p)) return p
  }
  return null
}

const formatFR = (iso: string) => iso.split('-').reverse().join('/')

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const jour = new Date().toISOString().slice(0, 10)

    const { data: contrats, error } = await supabase
      .from('contrats_travailleurs')
      .select('*, travailleurs(nom, actif, restaurant_id)')
    if (error) throw error
    const tous = (contrats || []) as Contrat[]

    // ── Passe 1 : alertes d'échéance ────────────────────────────────────────
    let alertes = 0
    for (const c of tous) {
      if (!c.travailleurs?.actif) continue
      const palier = palierAEnvoyer(c, jour)
      if (palier === null) continue

      const nom = c.travailleurs?.nom || 'un travailleur'
      const resto = c.restaurant_id || c.travailleurs?.restaurant_id || null
      const quand = c.date_fin ? formatFR(c.date_fin) : ''
      const titre = `⏰ Fin de contrat dans ${palier} jours`

      // Deux notifications : les admins peuvent ouvrir l'écran RH, le gérant non.
      // Lui envoyer `screen: 'rh'` le mènerait sur un écran auquel il n'a pas
      // accès — sa notification est volontairement sans navigation.
      await supabase.from('notifications').insert({
        type: 'contrat_echeance',
        titre,
        message: `${c.type} de ${nom} — se termine le ${quand}`,
        restaurant_id: resto,
        cible_role: ROLES_ADMIN,
        lu_par: [],
        screen: 'rh',
      })
      await supabase.from('notifications').insert({
        type: 'contrat_echeance',
        titre,
        message: `${nom} (${c.type}) — contrat terminé le ${quand}`,
        restaurant_id: resto,
        cible_role: ['gerant'],
        lu_par: [],
      })
      await supabase.from('contrats_travailleurs')
        .update({ rappels_envoyes: [...(c.rappels_envoyes || []), palier] })
        .eq('id', c.id)
      alertes++
    }

    // ── Passe 2 : désactivation à l'échéance ────────────────────────────────
    const parTravailleur = new Map<string, Contrat[]>()
    for (const c of tous) {
      const liste = parTravailleur.get(c.travailleur_id) || []
      liste.push(c)
      parTravailleur.set(c.travailleur_id, liste)
    }

    let desactives = 0
    for (const [travailleurId, liste] of parTravailleur) {
      const trav = liste[0].travailleurs
      if (!trav?.actif) continue
      if (liste.some(c => enCours(c, jour))) continue
      if (liste.some(c => aVenir(c, jour))) continue

      const dernier = liste
        .filter(c => finEffective(c))
        .sort((a, b) => (finEffective(a)! < finEffective(b)! ? 1 : -1))[0]
      if (!dernier || dernier.desactivation_faite_le) continue

      await supabase.from('travailleurs').update({
        statut: 'archive',
        actif: false,
        archived_at: new Date().toISOString(),
        archive_motif: 'Fin de contrat',
      }).eq('id', travailleurId)

      await supabase.from('contrats_travailleurs')
        .update({ desactivation_faite_le: jour })
        .eq('id', dernier.id)

      const quand = formatFR(finEffective(dernier)!)
      const resto = dernier.restaurant_id || trav.restaurant_id || null
      await supabase.from('notifications').insert({
        type: 'contrat_desactivation',
        titre: '🔒 Travailleur désactivé',
        message: `${trav.nom} — fin de contrat le ${quand}`,
        restaurant_id: resto,
        cible_role: ROLES_ADMIN,
        lu_par: [],
        screen: 'rh',
      })
      await supabase.from('notifications').insert({
        type: 'contrat_desactivation',
        titre: '🔒 Travailleur désactivé',
        message: `${trav.nom} — son contrat s'est terminé le ${quand}`,
        restaurant_id: resto,
        cible_role: ['gerant'],
        lu_par: [],
      })
      desactives++
    }

    // ── Push hors-app aux admins, si quelque chose s'est passé ──────────────
    if (alertes + desactives > 0) {
      const { data: admins } = await supabase
        .from('utilisateurs').select('id').in('role', ROLES_ADMIN)
      const { data: tokens } = await supabase
        .from('admin_push_tokens').select('token')
        .in('user_id', (admins || []).map((u: { id: string }) => u.id))

      if (tokens && tokens.length > 0) {
        const corps = [
          alertes > 0 ? `${alertes} contrat(s) arrivent à échéance` : '',
          desactives > 0 ? `${desactives} travailleur(s) désactivé(s)` : '',
        ].filter(Boolean).join(' · ')
        const messages = tokens.map((t: { token: string }) => ({
          to: t.token, title: '📋 Contrats', body: corps,
          sound: 'default', data: { screen: 'rh' },
        }))
        for (let i = 0; i < messages.length; i += 100) {
          await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(messages.slice(i, i + 100)),
          }).catch(() => {})
        }
      }
    }

    return json({ ok: true, alertes, desactives })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
```

- [x] **Step 2 : Vérifier la cohérence avec les tests de référence**

Relire `palierAEnvoyer`, `enCours` et la condition de désactivation en les comparant ligne à ligne avec `lib/contrats.js`. Les trois verrous de la désactivation doivent être présents : au moins un contrat (garanti par la boucle sur `parTravailleur`), aucun contrat en cours, aucun contrat à venir.

- [x] **Step 3 : Commit**

```bash
git add supabase/functions/rappel-contrats/index.ts
git commit -m "feat(rh): alertes J-15/7/3 et désactivation automatique à l'échéance"
```

- [ ] **Step 4 : Signaler le déploiement à l'utilisateur**

Ne pas déployer soi-même. Indiquer à l'utilisateur, en français simple, les deux gestes qui restent :
1. `supabase functions deploy rappel-contrats --no-verify-jwt`
2. décommenter le bloc `cron.schedule` de `supabase_contrats_travailleurs.sql`, y remplacer `<PROJECT_REF>` et `<SERVICE_ROLE_KEY>`, puis l'exécuter dans le SQL Editor.

Et prévenir que tant que ces deux gestes ne sont pas faits, la saisie des contrats fonctionne mais **aucune alerte ne part et aucune désactivation n'a lieu**.

---

## Vérification finale

- [x] `npm test` — tous les fichiers `lib/*.test.mjs` verts.
- [x] `npm run lint` — aucune erreur nouvelle.
- [ ] Parcours complet, migration passée : créer un Stage 3 mois avec photo → le bloc l'affiche → ajouter un CDD en renouvellement (date pré-remplie) → l'onglet Contrats le montre sous « Expire bientôt » si l'échéance est proche → archiver le travailleur pour Démission → l'historique affiche « rompu ».
- [ ] Appeler la fonction à la main pour valider les deux passes sans attendre le cron :
  `curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/rappel-contrats' -H 'Authorization: Bearer <SERVICE_ROLE_KEY>'`
  → réponse `{"ok":true,"alertes":N,"desactives":N}`.
