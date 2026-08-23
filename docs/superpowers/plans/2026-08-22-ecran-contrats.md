# Écran Contrats autonome — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir la gestion des contrats de l'écran RH pour lui donner son écran `/contrats`, où l'on voit chaque travailleur sur son contrat courant, avec renouvellements illimités, historique, et quatre actions (renouveler, rompre, corriger, supprimer).

**Architecture :** Toute la logique de sélection, de rang et de validation vit dans `lib/contrats.js`, module pur testé avec `node --test`. L'écran `app/contrats.js` ne fait qu'orchestrer ; les trois blocs d'interface (formulaire, fiche, sélecteur) sont des composants séparés dans `components/`. Aucune logique métier n'est dupliquée entre l'écran et les composants.

**Tech Stack :** React Native / Expo Router, Supabase (PostgreSQL), tests `node:test` sur fichiers `.test.mjs`.

**Spec :** `docs/superpowers/specs/2026-08-22-ecran-contrats-design.md`

## Global Constraints

- **Langue : tout le texte visible est en français.** Libellés, messages d'erreur, boutons. Jamais de code technique affiché à l'utilisateur (pas de « 23P01 », pas de nom de contrainte Postgres).
- **Dates en chaînes `AAAA-MM-JJ`**, jamais d'objet `Date` stocké ou passé entre modules. Les comparaisons se font en chaîne ou en UTC — jamais en heure locale, qui décale d'un jour selon le fuseau du navigateur.
- **Aucun `Date.now()` implicite dans `lib/contrats.js`** : toute fonction qui dépend du jour prend `aujourdhui` en paramètre, sinon les tests ne sont pas reproductibles.
- **Types de contrat** : exactement `'Stage'`, `'CDD'`, `'CDI'`.
- **Durées** : boutons `1, 2, 3, 6, 12` mois, plus un champ libre borné à **1–60 mois**. `null` pour un CDI.
- **Le journal ne bloque jamais** : tout appel à `journaliser()` est suivi de `.catch(() => {})`.
- **Un CDI n'a ni durée ni date de fin.**
- **Numérotation par type** : le rang d'un contrat se compte parmi les contrats du même type du travailleur, trié par date de début.
- Commits conventionnels en français : `feat(contrats): ...`.
- Le style suit `app/equipe.js` : `useMemo(() => makeStyles(colors), [colors])`, `SafeAreaView`, en-tête avec « ‹ Retour ».

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `supabase_contrats_duree_libre.sql` (créer) | Migration : remplace `duree_mois IN (3,6,12)` par une borne 1–60 |
| `lib/contrats.js` (étendre) | `formatFR`, `ordinalFR`, `rangParType`, `contratAffiche`, `validerCloture`, `validerDureeLibre`, `MOTIFS_RUPTURE`, `DUREES_MOIS` élargi |
| `lib/contrats.test.mjs` (étendre) | Tests des nouvelles fonctions |
| `components/FormulaireContrat.js` (réécrire) | Durées 1/2/3/6/12 + champ libre, date de fin modifiable, mode correction |
| `components/SelecteurTravailleur.js` (créer) | Choix du travailleur à l'ajout |
| `components/FicheContrat.js` (créer) | Fiche d'un travailleur : contrat courant, historique, 4 actions |
| `app/contrats.js` (créer) | L'écran : chargement, filtres, recherche, liste |
| `components/BlocContrats.js` (modifier) | `onAjouter` optionnel → bloc lecture seule |
| `lib/menus.js` (modifier) | La tuile pointe sur `/contrats` |
| `app/rh.js` (modifier) | Retrait de l'onglet Contrats et de tout ce qui l'accompagne |

`app/rh.js` fait 2 166 lignes : ce plan lui en **retire**, il ne lui en ajoute aucune.

---

### Task 1 : Migration — durées libres

**Files:**
- Create: `supabase_contrats_duree_libre.sql`

**Interfaces:**
- Consumes : la table `contrats_travailleurs` (migration précédente).
- Produces : la colonne `duree_mois` accepte tout entier de 1 à 60, ou `NULL`.

- [x] **Step 1 : Écrire la migration**

Le nom de la contrainte actuelle a été relevé sur la base de production : Postgres l'a
générée automatiquement sous le nom `contrats_travailleurs_duree_mois_check`.

```sql
-- =====================================================================
--  CONTRATS — durées libres (1 à 60 mois)
--
--  À exécuter dans le SQL Editor de Supabase.
--  Idempotent : relançable sans dégât.
--
--  La contrainte d'origine n'acceptait que 3, 6 et 12 mois. Un stage
--  renouvelé 4 mois était refusé par la base. Tous les contrats déjà
--  saisis restent valides : 3, 6 et 12 sont dans le nouvel intervalle.
-- =====================================================================

DO $$
BEGIN
  -- L'ancienne contrainte porte le nom auto-généré par Postgres.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contrats_travailleurs_duree_mois_check'
       AND conrelid = 'contrats_travailleurs'::regclass
  ) THEN
    ALTER TABLE contrats_travailleurs
      DROP CONSTRAINT contrats_travailleurs_duree_mois_check;
    RAISE NOTICE 'Ancienne contrainte duree_mois supprimée.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contrat_duree_bornee'
       AND conrelid = 'contrats_travailleurs'::regclass
  ) THEN
    ALTER TABLE contrats_travailleurs
      ADD CONSTRAINT contrat_duree_bornee
      CHECK (duree_mois IS NULL OR (duree_mois >= 1 AND duree_mois <= 60));
    RAISE NOTICE 'Contrainte contrat_duree_bornee ajoutée (1 à 60 mois).';
  END IF;
END $$;

-- =====================================================================
--  FIN
-- =====================================================================
```

- [x] **Step 2 : Vérifier la syntaxe du fichier**

Run: `grep -c "END \$\$" supabase_contrats_duree_libre.sql`
Expected: `1`

Relire que le `DO $$ ... END $$;` est bien fermé et que les deux blocs `IF` le sont aussi.

- [x] **Step 3 : Commit**

```bash
git add supabase_contrats_duree_libre.sql
git commit -m "feat(contrats): migration des durées libres 1 à 60 mois"
```

- [ ] **Step 4 : Signaler la migration à l'utilisateur**

Ne pas exécuter la migration soi-même. Dire à l'utilisateur, en français simple, qu'il doit
coller `supabase_contrats_duree_libre.sql` dans le SQL Editor de Supabase, et que tant que
ce n'est pas fait, seules les durées 3, 6 et 12 mois seront acceptées — une durée de 4 mois
sera refusée par la base avec un message d'erreur.

---

### Task 2 : Logique de sélection, de rang et de validation

Module pur, sans React ni réseau. Tout ce qui suit se teste sans base de données.

**Files:**
- Modify: `lib/contrats.js`
- Test: `lib/contrats.test.mjs`

**Interfaces:**
- Consumes : les fonctions déjà présentes dans `lib/contrats.js` — `statutContrat`, `contratEnCours`, `finEffective`, `calculerDateFin`.
- Produces :
  - `DUREES_MOIS: number[]` → `[1, 2, 3, 6, 12]` (remplace `[3, 6, 12]`)
  - `DUREE_MIN: number` → `1`
  - `DUREE_MAX: number` → `60`
  - `MOTIFS_RUPTURE: string[]` → `['Démission', 'Renvoi', 'Fin anticipée', 'Autre']`
  - `formatFR(iso: string): string` → `'16/10/2026'`, chaîne vide si absent
  - `ordinalFR(n: number): string` → `'1er'`, `'2e'`, `'3e'`…
  - `rangParType(contrats, contrat): number` → 1-based parmi les contrats du même type ; `0` si introuvable
  - `contratAffiche(contrats, aujourdhui): object|null` → le contrat qui représente le travailleur
  - `validerCloture(contrat, dateCloture, motif): { ok, erreur }`
  - `validerDureeLibre(valeur): { ok, erreur, mois }`

- [x] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `lib/contrats.test.mjs`. Compléter aussi la ligne d'import en tête du
fichier pour y ajouter les nouveaux noms.

Remplacer d'abord le bloc d'import en tête de `lib/contrats.test.mjs` par celui-ci :

```js
import {
  TYPES_CONTRAT, DUREES_MOIS, PALIERS_ALERTE, MOTIFS_RUPTURE,
  calculerDateFin, finEffective, statutContrat, contratEnCours,
  joursRestants, palierAEnvoyer, doitEtreDesactive, validerFormulaireContrat,
  formatFR, ordinalFR, rangParType, contratAffiche, validerCloture, validerDureeLibre,
} from './contrats.js'
```

Puis ajouter ces suites à la fin du fichier :

```js
describe('formatFR', () => {
  test('convertit en jour/mois/année', () => {
    assert.equal(formatFR('2026-10-16'), '16/10/2026')
  })
  test('chaîne vide si rien', () => {
    assert.equal(formatFR(null), '')
    assert.equal(formatFR(''), '')
  })
})

describe('ordinalFR', () => {
  test('1 donne 1er', () => {
    assert.equal(ordinalFR(1), '1er')
  })
  test('les autres prennent e', () => {
    assert.equal(ordinalFR(2), '2e')
    assert.equal(ordinalFR(3), '3e')
    assert.equal(ordinalFR(11), '11e')
  })
})

describe('DUREES_MOIS', () => {
  test('propose 1, 2, 3, 6 et 12 mois', () => {
    assert.deepEqual(DUREES_MOIS, [1, 2, 3, 6, 12])
  })
})

describe('MOTIFS_RUPTURE', () => {
  test('les quatre motifs, dans l\'ordre', () => {
    assert.deepEqual(MOTIFS_RUPTURE, ['Démission', 'Renvoi', 'Fin anticipée', 'Autre'])
  })
})

// Un parcours réaliste : 3 stages puis un CDD. C'est le cas décrit par
// l'utilisateur, il sert de fixture à tous les tests de rang et d'affichage.
const S1 = { id: 's1', type: 'Stage', date_debut: '2026-01-16', date_fin: '2026-04-15', cloture_le: null, rappels_envoyes: [] }
const S2 = { id: 's2', type: 'Stage', date_debut: '2026-04-16', date_fin: '2026-08-15', cloture_le: null, rappels_envoyes: [] }
const S3 = { id: 's3', type: 'Stage', date_debut: '2026-08-16', date_fin: '2027-02-15', cloture_le: null, rappels_envoyes: [] }
const D1 = { id: 'd1', type: 'CDD',   date_debut: '2027-02-16', date_fin: '2027-08-15', cloture_le: null, rappels_envoyes: [] }
const PARCOURS = [S1, S2, S3, D1]

describe('rangParType', () => {
  test('les stages se numérotent entre eux', () => {
    assert.equal(rangParType(PARCOURS, S1), 1)
    assert.equal(rangParType(PARCOURS, S2), 2)
    assert.equal(rangParType(PARCOURS, S3), 3)
  })
  test('le passage en CDD repart à 1', () => {
    assert.equal(rangParType(PARCOURS, D1), 1)
  })
  test('l\'ordre de la liste ne change rien, seule la date de début compte', () => {
    assert.equal(rangParType([S3, S1, S2], S2), 2)
  })
  test('0 pour un contrat absent de la liste', () => {
    assert.equal(rangParType(PARCOURS, { id: 'x', type: 'Stage', date_debut: '2025-01-01' }), 0)
  })
  test('0 sans contrat', () => {
    assert.equal(rangParType(PARCOURS, null), 0)
  })
})

describe('contratAffiche', () => {
  test('le contrat en cours prime sur tout', () => {
    assert.equal(contratAffiche(PARCOURS, '2026-09-01')?.id, 's3')
  })
  test('sans contrat, null', () => {
    assert.equal(contratAffiche([], '2026-09-01'), null)
  })
  // La décision explicite de la spec : pendant la période creuse, on montre le
  // contrat fini, pas celui qui n'a pas encore commencé.
  test('contrat fini et suivant pas démarré : on montre le fini', () => {
    const fini = { id: 'f', type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-08-15', cloture_le: null }
    const futur = { id: 'v', type: 'CDD', date_debut: '2026-09-01', date_fin: '2027-03-01', cloture_le: null }
    assert.equal(contratAffiche([fini, futur], '2026-08-20')?.id, 'f')
  })
  test('le plus récemment terminé, pas le plus ancien', () => {
    assert.equal(contratAffiche([S1, S2], '2026-09-01')?.id, 's2')
  })
  test('un contrat rompu compte comme terminé', () => {
    const rompu = { id: 'r', type: 'CDD', date_debut: '2026-01-01', date_fin: '2026-12-31', cloture_le: '2026-06-02' }
    assert.equal(contratAffiche([rompu], '2026-08-20')?.id, 'r')
  })
  test('rien que des contrats à venir : on montre le plus proche', () => {
    const a = { id: 'a', type: 'CDD', date_debut: '2026-09-01', date_fin: '2027-03-01', cloture_le: null }
    const b = { id: 'b', type: 'CDD', date_debut: '2027-04-01', date_fin: '2027-10-01', cloture_le: null }
    assert.equal(contratAffiche([b, a], '2026-08-20')?.id, 'a')
  })
})

describe('validerCloture', () => {
  const CDD = { type: 'CDD', date_debut: '2026-04-16', date_fin: '2026-10-16', cloture_le: null }
  test('une date dans les bornes avec motif, accepté', () => {
    assert.equal(validerCloture(CDD, '2026-06-02', 'Démission').ok, true)
  })
  test('sans motif, refusé', () => {
    const r = validerCloture(CDD, '2026-06-02', '')
    assert.equal(r.ok, false)
    assert.match(r.erreur, /motif/i)
  })
  test('sans date, refusé', () => {
    assert.equal(validerCloture(CDD, '', 'Démission').ok, false)
  })
  test('avant le début, refusé et le message cite la date', () => {
    const r = validerCloture(CDD, '2026-01-01', 'Démission')
    assert.equal(r.ok, false)
    assert.ok(r.erreur.includes('16/04/2026'))
  })
  test('après la fin, refusé et le message cite les deux bornes', () => {
    const r = validerCloture(CDD, '2026-12-01', 'Démission')
    assert.equal(r.ok, false)
    assert.ok(r.erreur.includes('16/04/2026'))
    assert.ok(r.erreur.includes('16/10/2026'))
  })
  test('un contrat déjà rompu, refusé', () => {
    const r = validerCloture({ ...CDD, cloture_le: '2026-05-01' }, '2026-06-02', 'Démission')
    assert.equal(r.ok, false)
    assert.match(r.erreur, /déjà rompu/i)
  })
  test('un CDI peut être rompu à n\'importe quelle date après son début', () => {
    const CDI = { type: 'CDI', date_debut: '2026-03-01', date_fin: null, cloture_le: null }
    assert.equal(validerCloture(CDI, '2030-01-01', 'Démission').ok, true)
  })
})

describe('validerDureeLibre', () => {
  test('4 mois, accepté', () => {
    assert.deepEqual(validerDureeLibre('4'), { ok: true, erreur: null, mois: 4 })
  })
  test('accepte aussi un nombre', () => {
    assert.equal(validerDureeLibre(4).mois, 4)
  })
  test('vide, refusé', () => {
    assert.equal(validerDureeLibre('').ok, false)
  })
  test('du texte, refusé', () => {
    assert.equal(validerDureeLibre('quatre').ok, false)
  })
  test('0 mois, refusé', () => {
    assert.equal(validerDureeLibre('0').ok, false)
  })
  test('61 mois, refusé et le message cite les bornes', () => {
    const r = validerDureeLibre('61')
    assert.equal(r.ok, false)
    assert.ok(r.erreur.includes('1'))
    assert.ok(r.erreur.includes('60'))
  })
  test('60 mois pile, accepté', () => {
    assert.equal(validerDureeLibre('60').ok, true)
  })
})
```

- [x] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test lib/contrats.test.mjs`
Expected: FAIL — les nouveaux noms ne sont pas exportés.

- [x] **Step 3 : Modifier `lib/contrats.js`**

Remplacer la ligne `export const DUREES_MOIS = [3, 6, 12]` par les constantes ci-dessous,
et ajouter les fonctions à la suite de celles qui existent.

```js
export const DUREES_MOIS = [1, 2, 3, 6, 12]
export const DUREE_MIN = 1
export const DUREE_MAX = 60
export const MOTIFS_RUPTURE = ['Démission', 'Renvoi', 'Fin anticipée', 'Autre']

export function formatFR(iso) {
  if (!iso) return ''
  const [a, m, j] = String(iso).split('-')
  return `${j}/${m}/${a}`
}

export function ordinalFR(n) {
  return n === 1 ? '1er' : `${n}e`
}

// Le rang se compte PAR TYPE : trois stages d'affilée sont 1er, 2e et 3e
// contrat de stage, et le premier CDD qui suit repart à 1.
export function rangParType(contrats, contrat) {
  if (!contrat) return 0
  const memeType = (contrats || [])
    .filter(c => c.type === contrat.type)
    .sort((a, b) => (a.date_debut < b.date_debut ? -1 : a.date_debut > b.date_debut ? 1 : 0))
  const i = memeType.findIndex(c => c.id === contrat.id)
  return i === -1 ? 0 : i + 1
}

// Le contrat qui représente le travailleur dans la liste. L'ordre compte :
// un contrat terminé passe AVANT un contrat à venir, pour qu'un travailleur
// dont le CDD s'est fini reste visible dans « Expirés » tant que le suivant
// n'a pas démarré.
export function contratAffiche(contrats, aujourdhui) {
  const liste = contrats || []
  if (liste.length === 0) return null

  const enCours = contratEnCours(liste, aujourdhui)
  if (enCours) return enCours

  const termines = liste
    .filter(c => ['expire', 'rompu'].includes(statutContrat(c, aujourdhui)))
    .sort((a, b) => (finEffective(a) < finEffective(b) ? 1 : -1))
  if (termines.length > 0) return termines[0]

  const aVenir = liste
    .filter(c => statutContrat(c, aujourdhui) === 'a_venir')
    .sort((a, b) => (a.date_debut < b.date_debut ? -1 : 1))
  return aVenir[0] || null
}

// La base a le dernier mot (contrainte contrat_cloture_coherente), mais valider
// ici permet de citer les vraies bornes du contrat dans le message.
export function validerCloture(contrat, dateCloture, motif) {
  const ko = erreur => ({ ok: false, erreur })
  if (!contrat) return ko('Contrat introuvable.')
  if (contrat.cloture_le) return ko('Ce contrat est déjà rompu.')
  if (!dateCloture) return ko('Indique la date de rupture.')
  if (!motif || !String(motif).trim()) return ko('Indique le motif de la rupture.')
  if (dateCloture < contrat.date_debut) {
    return ko(`La date de rupture ne peut pas être avant le début du contrat, le ${formatFR(contrat.date_debut)}.`)
  }
  if (contrat.date_fin && dateCloture > contrat.date_fin) {
    return ko(`La date de rupture doit être comprise entre le ${formatFR(contrat.date_debut)} et le ${formatFR(contrat.date_fin)}.`)
  }
  return { ok: true, erreur: null }
}

export function validerDureeLibre(valeur) {
  const ko = erreur => ({ ok: false, erreur, mois: null })
  const txt = String(valeur ?? '').trim()
  if (!txt) return ko('Indique la durée en mois.')
  if (!/^\d+$/.test(txt)) return ko('La durée doit être un nombre de mois.')
  const mois = Number(txt)
  if (mois < DUREE_MIN || mois > DUREE_MAX) {
    return ko(`La durée doit être comprise entre ${DUREE_MIN} et ${DUREE_MAX} mois.`)
  }
  return { ok: true, erreur: null, mois }
}
```

- [x] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, aucun échec. Les tests déjà présents doivent rester verts — en particulier
`palierAEnvoyer` et `doitEtreDesactive`, que ce plan ne touche pas.

- [x] **Step 5 : Commit**

```bash
git add lib/contrats.js lib/contrats.test.mjs
git commit -m "feat(contrats): rang par type, contrat affiché, validation de rupture et de durée"
```

---

### Task 3 : Formulaire — durées libres, date de fin modifiable, mode correction

Le formulaire existant ne propose que 3/6/12 mois et, sous « Autre », un champ de date de
fin à taper à la main. Il est remplacé par : des boutons 1/2/3/6/12, un champ libre **en
mois**, et une date de fin calculée mais **modifiable**. Il gagne aussi un mode correction.

**Files:**
- Rewrite: `components/FormulaireContrat.js`

**Interfaces:**
- Consumes : `lib/contrats.js` (`TYPES_CONTRAT`, `DUREES_MOIS`, `calculerDateFin`, `validerFormulaireContrat`, `validerDureeLibre`, `aujourdhuiISO`, `ajouterJours`, `finEffective`, `formatFR`), `lib/uploadFichier.js`.
- Produces : composant par défaut
  `FormulaireContrat({ visible, travailleur, contratsExistants, contratEdite, colors, onFermer, onEnregistrer })`.
  `contratEdite` absent ou `null` = création ; présent = correction.
  `onEnregistrer(contrat)` reçoit `{ type, date_debut, date_fin, duree_mois, photo_url, photo_type }`.
  `date_fin` et `duree_mois` valent `null` pour un CDI. `duree_mois` vaut `null` quand la
  date de fin a été saisie à la main.

- [x] **Step 1 : Écrire le composant**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// Saisie d'un contrat de travail — création ou correction.
//
// L'ordre des champs suit le raisonnement du RH : quel type, à partir de quand,
// pour combien de temps, et la preuve. La date de fin est un résultat calculé,
// mais elle reste modifiable pour le contrat qui ne tombe pas sur un nombre
// entier de mois (« jusqu'au 30 juin »). La corriger à la main met duree_mois à
// null : on n'enregistre pas une durée qui ne correspond plus aux dates.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  TYPES_CONTRAT, DUREES_MOIS, calculerDateFin, validerFormulaireContrat,
  validerDureeLibre, aujourdhuiISO, ajouterJours, finEffective, formatFR,
} from '../lib/contrats'
import { uploaderFichier } from '../lib/uploadFichier'

const LIBELLE_DUREE = { 1: '1 mois', 2: '2 mois', 3: '3 mois', 6: '6 mois', 12: '1 an' }

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
  visible, travailleur, contratsExistants, contratEdite, colors, onFermer, onEnregistrer,
}) {
  const enCorrection = !!contratEdite

  const [type, setType] = useState('CDD')
  const [dateDebut, setDateDebut] = useState('')
  const [duree, setDuree] = useState(3)
  const [dureeLibre, setDureeLibre] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [finManuelle, setFinManuelle] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [upload, setUpload] = useState(false)
  const [enreg, setEnreg] = useState(false)

  useEffect(() => {
    if (!visible) return
    if (contratEdite) {
      setType(contratEdite.type)
      setDateDebut(contratEdite.date_debut)
      setDateFin(contratEdite.date_fin || '')
      // Un contrat sans duree_mois a eu sa date de fin saisie à la main.
      const connue = DUREES_MOIS.includes(contratEdite.duree_mois)
      setDuree(connue ? contratEdite.duree_mois : (contratEdite.duree_mois ? 'autre' : 3))
      setDureeLibre(connue || !contratEdite.duree_mois ? '' : String(contratEdite.duree_mois))
      setFinManuelle(!contratEdite.duree_mois && !!contratEdite.date_fin)
    } else {
      setType('CDD')
      setDateDebut(debutParDefaut(travailleur, contratsExistants))
      setDuree(3)
      setDureeLibre('')
      setDateFin('')
      setFinManuelle(false)
    }
    setPhoto(null)
    // Volontairement limité : recharger la liste des contrats pendant la saisie
    // ne doit pas remettre le formulaire à zéro sous les doigts du RH.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travailleur?.id, contratEdite?.id])

  const estCDI = type === 'CDI'
  const dureeLibreChoisie = duree === 'autre'

  // Recalcule la date de fin tant que l'utilisateur ne l'a pas reprise à la main.
  useEffect(() => {
    if (estCDI) { setDateFin(''); return }
    if (finManuelle) return
    const mois = dureeLibreChoisie ? validerDureeLibre(dureeLibre).mois : duree
    setDateFin(mois && dateDebut ? calculerDateFin(dateDebut, mois) : '')
  }, [estCDI, finManuelle, dureeLibreChoisie, dureeLibre, duree, dateDebut])

  const dureeMois = estCDI || finManuelle
    ? null
    : (dureeLibreChoisie ? validerDureeLibre(dureeLibre).mois : duree)

  const photoUrl = photo?.url || contratEdite?.photo_url || null
  const photoType = photo?.type || contratEdite?.photo_type || 'photo'

  const erreurDuree = (!estCDI && dureeLibreChoisie && !finManuelle)
    ? validerDureeLibre(dureeLibre).erreur
    : null
  const validation = erreurDuree
    ? { ok: false, erreur: erreurDuree }
    : validerFormulaireContrat({
        type,
        date_debut: dateDebut,
        date_fin: estCDI ? '' : dateFin,
        duree_mois: dureeMois,
        photo_url: photoUrl,
      })

  function choisirDuree(d) {
    setDuree(d)
    setFinManuelle(false)   // reprendre un bouton reprend la main sur la date
  }

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
        uri, dossier: 'documents-travailleurs', prefixe: 'contrat', estPDF,
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
      duree_mois: dureeMois,
      photo_url: photoUrl,
      photo_type: photoType,
    })
    setEnreg(false)
  }

  const label = { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }
  const input = { backgroundColor: colors.bg, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, marginBottom: 14 }
  const puce = { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border }
  const puceActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }
  const txtPuce = actif => ({ fontSize: 13, color: actif ? '#fff' : colors.textMuted, fontWeight: actif ? '600' : '400' })

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
              {enCorrection ? 'Corriger le contrat' : 'Nouveau contrat'}
            </Text>
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
                <TouchableOpacity key={t} style={[puce, { flex: 1 }, type === t && puceActive]} onPress={() => setType(t)}>
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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {DUREES_MOIS.map(d => (
                    <TouchableOpacity
                      key={d}
                      style={[puce, duree === d && !finManuelle && puceActive]}
                      onPress={() => choisirDuree(d)}
                    >
                      <Text style={txtPuce(duree === d && !finManuelle)}>{LIBELLE_DUREE[d]}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[puce, dureeLibreChoisie && !finManuelle && puceActive]}
                    onPress={() => choisirDuree('autre')}
                  >
                    <Text style={txtPuce(dureeLibreChoisie && !finManuelle)}>Autre</Text>
                  </TouchableOpacity>
                </View>

                {dureeLibreChoisie && (
                  <TextInput
                    style={input}
                    placeholder="Nombre de mois (ex : 4)"
                    value={dureeLibre}
                    onChangeText={t => { setDureeLibre(t); setFinManuelle(false) }}
                    keyboardType="number-pad"
                    placeholderTextColor="#bbb"
                  />
                )}

                <Text style={label}>Date de fin *</Text>
                <TextInput
                  style={input}
                  placeholder="AAAA-MM-JJ"
                  value={dateFin}
                  onChangeText={t => { setDateFin(t); setFinManuelle(true) }}
                  placeholderTextColor="#bbb"
                />
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: -8, marginBottom: 14 }}>
                  {finManuelle
                    ? 'Date saisie à la main — la durée ne sera pas enregistrée.'
                    : dateFin
                      ? `Calculée : se termine le ${formatFR(dateFin)}.`
                      : 'Renseigne la date de début et la durée.'}
                </Text>
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
              <Text style={{ fontSize: 15, color: photoUrl ? colors.text : '#bbb' }}>
                {upload
                  ? 'Envoi en cours…'
                  : photo
                    ? `✓ ${photo.type === 'pdf' ? 'PDF' : 'Photo'} ajouté`
                    : contratEdite?.photo_url
                      ? `✓ ${contratEdite.photo_type === 'pdf' ? 'PDF' : 'Photo'} déjà enregistré — appuyer pour remplacer`
                      : 'Ajouter le contrat signé'}
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

Run: `npx eslint components/FormulaireContrat.js`
Expected: 0 erreur, 0 warning.

Le composant n'est pas encore branché sur le nouvel écran : rien à voir dans l'app à ce
stade. Le bloc de la fiche travailleur dans RH continue de fonctionner, la signature du
composant restant compatible (`contratEdite` est simplement absent).

- [x] **Step 3 : Commit**

```bash
git add components/FormulaireContrat.js
git commit -m "feat(contrats): durées libres, date de fin modifiable et mode correction"
```

---

### Task 4 : Sélecteur de travailleur

**Files:**
- Create: `components/SelecteurTravailleur.js`

**Interfaces:**
- Consumes : rien d'autre que React Native.
- Produces : composant par défaut
  `SelecteurTravailleur({ visible, travailleurs, restaurants, colors, onFermer, onChoisir })`.
  `travailleurs` sont des lignes de la table `travailleurs`, chacune avec `restaurants: { nom }`
  grâce à la jointure faite par l'écran. `onChoisir(travailleur)` est appelé au clic.

- [x] **Step 1 : Écrire le composant**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// Choix du travailleur à qui attribuer un contrat.
//
// Recherche par nom et filtre par restaurant : avec sept points de vente et une
// centaine de fiches, une simple liste déroulante ne suffit pas.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

export default function SelecteurTravailleur({
  visible, travailleurs, restaurants, colors, onFermer, onChoisir,
}) {
  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')

  const liste = (travailleurs || []).filter(t => {
    const matchNom = t.nom?.toLowerCase().includes(recherche.trim().toLowerCase())
    const matchResto = filtreResto === 'tous' || t.restaurant_id === filtreResto
    return matchNom && matchResto
  })

  const puce = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border }
  const puceActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }
  const txtPuce = actif => ({ fontSize: 12, color: actif ? '#fff' : colors.textMuted, fontWeight: actif ? '600' : '400' })

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Quel travailleur ?</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 22, color: colors.textMuted }}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={{ padding: 16, paddingBottom: 8 }}>
            <TextInput
              style={{ backgroundColor: colors.bg, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text }}
              placeholder="🔍 Rechercher un nom…"
              value={recherche}
              onChangeText={setRecherche}
              placeholderTextColor="#bbb"
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 46, paddingHorizontal: 16 }}>
            <TouchableOpacity style={[puce, { marginRight: 8 }, filtreResto === 'tous' && puceActive]} onPress={() => setFiltreResto('tous')}>
              <Text style={txtPuce(filtreResto === 'tous')}>Tous</Text>
            </TouchableOpacity>
            {(restaurants || []).map(r => (
              <TouchableOpacity
                key={r.id}
                style={[puce, { marginRight: 8 }, filtreResto === r.id && puceActive]}
                onPress={() => setFiltreResto(r.id)}
              >
                <Text style={txtPuce(filtreResto === r.id)}>{r.nom}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={{ padding: 16 }}>
            {liste.length === 0 && (
              <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: 30 }}>
                Aucun travailleur ne correspond.
              </Text>
            )}
            {liste.map(t => (
              <TouchableOpacity
                key={t.id}
                style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 8 }}
                onPress={() => onChoisir(t)}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{t.nom}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  {t.restaurants?.nom || 'Sans restaurant'} · {t.poste || 'Sans poste'}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 30 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
```

- [x] **Step 2 : Vérifier**

Run: `npx eslint components/SelecteurTravailleur.js`
Expected: 0 erreur, 0 warning.

- [x] **Step 3 : Commit**

```bash
git add components/SelecteurTravailleur.js
git commit -m "feat(contrats): sélecteur de travailleur pour l'ajout d'un contrat"
```

---

### Task 5 : Fiche d'un travailleur et ses quatre actions

**Files:**
- Create: `components/FicheContrat.js`

**Interfaces:**
- Consumes : `lib/contrats.js` (`contratAffiche`, `statutContrat`, `rangParType`, `ordinalFR`, `formatFR`, `joursRestants`, `aujourdhuiISO`, `MOTIFS_RUPTURE`, `validerCloture`).
- Produces : composant par défaut
  `FicheContrat({ visible, travailleur, contrats, colors, onFermer, onRenouveler, onCorriger, onSupprimer, onRompre })`.
  - `onRenouveler()` — sans argument : l'écran ouvre le formulaire en création.
  - `onCorriger(contrat)` — l'écran ouvre le formulaire en correction.
  - `onSupprimer(contrat)` — l'écran supprime après sa propre confirmation.
  - `onRompre(contrat, dateCloture, motif)` — la validation a déjà été faite ici.

- [x] **Step 1 : Écrire le composant**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// Tous les contrats d'un travailleur, du plus récent au plus ancien.
//
// Le contrat qui fait foi est mis en avant ; les précédents restent listés en
// dessous — ce sont eux la trace, et c'est souvent l'un d'eux qu'il faut
// corriger quand une date a été mal saisie.
//
// Rompre se fait ici, dans un panneau replié : c'est une action rare et lourde,
// elle ne mérite pas un bouton permanent au milieu des autres.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Alert, Linking, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  contratAffiche, statutContrat, rangParType, ordinalFR, formatFR,
  joursRestants, aujourdhuiISO, MOTIFS_RUPTURE, validerCloture,
} from '../lib/contrats'

const COULEUR_STATUT = {
  en_cours: { bg: '#EAF3DE', txt: '#3B6D11', libelle: 'en cours' },
  a_venir:  { bg: '#E6F1FB', txt: '#185FA5', libelle: 'à venir' },
  expire:   { bg: '#F1EFE8', txt: '#444441', libelle: 'terminé' },
  rompu:    { bg: '#FAECE7', txt: '#993C1D', libelle: 'rompu' },
}

export default function FicheContrat({
  visible, travailleur, contrats, colors, onFermer, onRenouveler, onCorriger, onSupprimer, onRompre,
}) {
  const [rupturePour, setRupturePour] = useState(null)   // id du contrat en cours de rupture
  const [dateRupture, setDateRupture] = useState('')
  const [motifRupture, setMotifRupture] = useState('Démission')
  const [motifAutre, setMotifAutre] = useState('')

  const jour = aujourdhuiISO()
  const liste = contrats || []
  const courant = contratAffiche(liste, jour)
  // Du plus récent au plus ancien : on lit un dossier en commençant par la fin.
  const ordonnes = [...liste].sort((a, b) => (a.date_debut < b.date_debut ? 1 : -1))

  function ouvrirRupture(c) {
    setRupturePour(c.id)
    setDateRupture(jour)
    setMotifRupture('Démission')
    setMotifAutre('')
  }

  function confirmerRupture(c) {
    const motif = motifRupture === 'Autre' ? motifAutre.trim() : motifRupture
    const v = validerCloture(c, dateRupture, motif)
    if (!v.ok) {
      Alert.alert('Rupture impossible', v.erreur)
      return
    }
    Alert.alert(
      'Rompre ce contrat',
      `Le ${c.type} de ${travailleur?.nom} sera marqué rompu au ${formatFR(dateRupture)}, motif « ${motif} ». Les alertes d'échéance s'arrêtent.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Rompre',
          style: 'destructive',
          onPress: () => { setRupturePour(null); onRompre(c, dateRupture, motif) },
        },
      ]
    )
  }

  function confirmerSuppression(c) {
    Alert.alert(
      '⚠️ Supprimer ce contrat',
      `Le ${c.type} du ${formatFR(c.date_debut)} sera effacé définitivement. À n'utiliser que pour une saisie erronée — pour un contrat qui s'arrête, choisis « Rompre ».`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => onSupprimer(c) },
      ]
    )
  }

  function renderContrat(c, estCourant) {
    const statut = statutContrat(c, jour)
    const st = COULEUR_STATUT[statut] || COULEUR_STATUT.expire
    const rang = rangParType(liste, c)
    const restants = joursRestants(c, jour)
    const peutRompre = statut === 'en_cours' || statut === 'a_venir'

    return (
      <View
        key={c.id}
        style={{
          backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
          borderWidth: estCourant ? 1.5 : 0.5, borderColor: estCourant ? '#185FA5' : colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
            {c.type}{rang > 0 ? ` · ${ordinalFR(rang)} contrat` : ''}
          </Text>
          <View style={{ backgroundColor: st.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 11, color: st.txt, fontWeight: '600' }}>{st.libelle}</Text>
          </View>
        </View>

        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          {c.date_fin
            ? `${formatFR(c.date_debut)} → ${formatFR(c.date_fin)}`
            : `depuis le ${formatFR(c.date_debut)}`}
          {c.duree_mois ? ` · ${c.duree_mois} mois` : ''}
        </Text>

        {statut === 'en_cours' && restants !== null && restants >= 0 && restants <= 30 && (
          <Text style={{ fontSize: 13, color: restants <= 7 ? '#993C1D' : '#854F0B', marginTop: 4, fontWeight: '600' }}>
            {restants === 0 ? 'Dernier jour' : `Expire dans ${restants} jours`}
          </Text>
        )}
        {statut === 'rompu' && (
          <Text style={{ fontSize: 13, color: '#993C1D', marginTop: 4 }}>
            Rompu le {formatFR(c.cloture_le)}{c.cloture_motif ? ` · ${c.cloture_motif}` : ''}
          </Text>
        )}

        {c.photo_url && (
          <TouchableOpacity onPress={() => Linking.openURL(c.photo_url)} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 13, color: '#185FA5' }}>
              📄 Voir le contrat signé{c.photo_type === 'pdf' ? ' (PDF)' : ''}
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {peutRompre && (
            <TouchableOpacity
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg }}
              onPress={() => ouvrirRupture(c)}
            >
              <Text style={{ fontSize: 12, color: '#993C1D', fontWeight: '600' }}>Rompre</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg }}
            onPress={() => onCorriger(c)}
          >
            <Text style={{ fontSize: 12, color: '#185FA5', fontWeight: '600' }}>Corriger</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg }}
            onPress={() => confirmerSuppression(c)}
          >
            <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '600' }}>Supprimer</Text>
          </TouchableOpacity>
        </View>

        {rupturePour === c.id && (
          <View style={{ marginTop: 14, padding: 14, borderRadius: 12, backgroundColor: colors.bg }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>
              Date de rupture
            </Text>
            <TextInput
              style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text, marginBottom: 12 }}
              placeholder="AAAA-MM-JJ"
              value={dateRupture}
              onChangeText={setDateRupture}
              placeholderTextColor="#bbb"
            />
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>
              Motif
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {MOTIFS_RUPTURE.map(m => (
                <TouchableOpacity
                  key={m}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
                    backgroundColor: motifRupture === m ? '#185FA5' : colors.surface,
                  }}
                  onPress={() => setMotifRupture(m)}
                >
                  <Text style={{ fontSize: 12, color: motifRupture === m ? '#fff' : colors.textMuted }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {motifRupture === 'Autre' && (
              <TextInput
                style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text, marginBottom: 12 }}
                placeholder="Préciser le motif"
                value={motifAutre}
                onChangeText={setMotifAutre}
                placeholderTextColor="#bbb"
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center' }}
                onPress={() => setRupturePour(null)}
              >
                <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#993C1D', alignItems: 'center' }}
                onPress={() => confirmerRupture(c)}
              >
                <Text style={{ fontSize: 13, color: '#fff', fontWeight: '700' }}>Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onFermer}>
            <Text style={{ fontSize: 16, color: colors.primaryText, fontWeight: '500' }}>✕ Fermer</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.surface }}>Contrats</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={{ padding: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{travailleur?.nom}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 18 }}>
            {travailleur?.restaurants?.nom || 'Sans restaurant'} · {travailleur?.poste || 'Sans poste'}
          </Text>

          <TouchableOpacity
            style={{ backgroundColor: '#185FA5', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 18 }}
            onPress={onRenouveler}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {liste.length === 0 ? '+ Enregistrer un contrat' : '+ Renouveler le contrat'}
            </Text>
          </TouchableOpacity>

          {liste.length === 0 && (
            <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: 20 }}>
              Aucun contrat enregistré pour ce travailleur.
            </Text>
          )}

          {ordonnes.map(c => renderContrat(c, c.id === courant?.id))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  )
}
```

- [x] **Step 2 : Vérifier**

Run: `npx eslint components/FicheContrat.js`
Expected: 0 erreur, 0 warning.

- [x] **Step 3 : Commit**

```bash
git add components/FicheContrat.js
git commit -m "feat(contrats): fiche travailleur avec historique et les quatre actions"
```

---

### Task 6 : L'écran `/contrats`

**Files:**
- Create: `app/contrats.js`

**Interfaces:**
- Consumes : `lib/contrats.js`, `components/FicheContrat.js`, `components/FormulaireContrat.js`, `components/SelecteurTravailleur.js`, `lib/supabase.js`, `lib/journal.js`, `lib/notificationsInterne.js`, `context/AppContext`, `context/ThemeContext`.
- Produces : la route `/contrats`, atteignable depuis la tuile d'accueil.

- [x] **Step 1 : Écrire l'écran**

```jsx
// ──────────────────────────────────────────────────────────────────────────────
// Écran Contrats — une ligne par travailleur, sur le contrat qui fait foi.
//
// Un travailleur qui a enchaîné trois stages n'apparaît qu'une fois, sur le
// stage en cours. Ses contrats précédents sont dans sa fiche : ils comptent
// comme historique, pas comme lignes à traiter.
//
// Le filtre « Sans contrat » est le seul à lister des travailleurs plutôt que
// des contrats — c'est la liste de ce qui reste à faire.
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native'

import FicheContrat from '../components/FicheContrat'
import FormulaireContrat from '../components/FormulaireContrat'
import SelecteurTravailleur from '../components/SelecteurTravailleur'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import {
  aujourdhuiISO, contratAffiche, formatFR, joursRestants, ordinalFR,
  rangParType, statutContrat,
} from '../lib/contrats'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'

const FILTRES = ['Expire bientôt', 'En cours', 'Expirés', 'Sans contrat']
const SEUIL_BADGE_JOURS = 30

export default function ContratsScreen() {
  const { colors } = useTheme()
  const { userId, userNom } = useApp() ?? {}
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [contrats, setContrats] = useState([])
  const [loading, setLoading] = useState(true)

  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')
  const [filtreEtat, setFiltreEtat] = useState('Expire bientôt')

  const [ficheVisible, setFicheVisible] = useState(false)
  const [travSelectionne, setTravSelectionne] = useState(null)
  const [selecteurVisible, setSelecteurVisible] = useState(false)
  const [formVisible, setFormVisible] = useState(false)
  const [contratEdite, setContratEdite] = useState(null)

  const jour = aujourdhuiISO()

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setLoading(true)
    const { data: restos } = await supabase
      .from('restaurants').select('id, nom').order('nom')
    setRestaurants(restos || [])

    // .range explicite : sans lui, PostgREST tronque silencieusement à 1000
    // lignes. Le piège a déjà coûté cher sur d'autres écrans.
    const { data: travs } = await supabase
      .from('travailleurs')
      .select('*, restaurants(nom)')
      .neq('statut', 'archive')
      .order('nom')
      .range(0, 4999)
    setTravailleurs(travs || [])

    const { data: ctrs } = await supabase
      .from('contrats_travailleurs')
      .select('*')
      .order('date_debut', { ascending: true })
      .range(0, 4999)
    setContrats(ctrs || [])

    setLoading(false)
  }

  function contratsDe(travailleurId) {
    return contrats.filter(c => c.travailleur_id === travailleurId)
  }

  // Une ligne par travailleur : son contrat courant, ou null s'il n'en a aucun.
  const lignes = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return travailleurs
      .filter(t => t.actif !== false)
      .filter(t => filtreResto === 'tous' || t.restaurant_id === filtreResto)
      .filter(t => !terme || t.nom?.toLowerCase().includes(terme))
      .map(t => {
        const siens = contrats.filter(c => c.travailleur_id === t.id)
        return { travailleur: t, contrat: contratAffiche(siens, jour), total: siens.length }
      })
  }, [travailleurs, contrats, filtreResto, recherche, jour])

  function badge(contrat) {
    if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
    if (statutContrat(contrat, jour) !== 'en_cours') return null
    const restants = joursRestants(contrat, jour)
    if (restants === null || restants < 0 || restants > SEUIL_BADGE_JOURS) return null
    if (restants === 0) return { texte: 'Dernier jour', couleur: '#993C1D' }
    return { texte: `Expire dans ${restants} j`, couleur: restants <= 7 ? '#993C1D' : '#854F0B' }
  }

  const compteurs = useMemo(() => {
    let expire = 0, enCours = 0, sans = 0
    for (const l of lignes) {
      if (!l.contrat) { if (l.travailleur.type_contrat !== 'Journalier') sans++; continue }
      const s = statutContrat(l.contrat, jour)
      if (s === 'en_cours' || s === 'a_venir') enCours++
      if (badge(l.contrat)) expire++
    }
    return { expire, enCours, sans }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, jour])

  const affichees = lignes.filter(l => {
    if (filtreEtat === 'Sans contrat') {
      // Les Journaliers n'ont pas de contrat par construction : les compter
      // noierait les fiches qui en attendent vraiment un.
      return !l.contrat && l.travailleur.type_contrat !== 'Journalier'
    }
    if (!l.contrat) return false
    const s = statutContrat(l.contrat, jour)
    if (filtreEtat === 'En cours') return s === 'en_cours' || s === 'a_venir'
    if (filtreEtat === 'Expirés') return s === 'expire' || s === 'rompu'
    return badge(l.contrat) !== null   // Expire bientôt
  })

  // Une carte « Sans contrat » ouvre la fiche du travailleur, d'où le bouton
  // « + Enregistrer un contrat » mène droit au formulaire : le sélecteur de
  // travailleur est bien sauté, puisqu'on sait déjà de qui il s'agit.
  function ouvrirFiche(travailleur) {
    setTravSelectionne(travailleur)
    setFicheVisible(true)
  }

  function nouveauContratPour(travailleur) {
    setTravSelectionne(travailleur)
    setContratEdite(null)
    setSelecteurVisible(false)
    setFormVisible(true)
  }

  const contexteJournal = { userId: userId || null, userNom: userNom || null }

  function messageErreur(error) {
    const txt = String(error?.message || '')
    if (txt.includes('contrats_sans_chevauchement')) {
      return 'Ce travailleur a déjà un contrat sur cette période. Vérifie les dates.'
    }
    if (txt.includes('contrat_duree_bornee')) {
      return 'La durée doit être comprise entre 1 et 60 mois.'
    }
    if (txt.includes('contrat_cdi_sans_fin')) {
      return "Un CDI n'a pas de date de fin, et un Stage ou un CDD doit en avoir une."
    }
    return "Impossible d'enregistrer. Vérifie ta connexion et réessaie."
  }

  async function enregistrerContrat(contrat) {
    const trav = travSelectionne
    if (!trav) return

    if (contratEdite) {
      const { error } = await supabase.from('contrats_travailleurs')
        .update({
          type: contrat.type,
          date_debut: contrat.date_debut,
          date_fin: contrat.date_fin,
          duree_mois: contrat.duree_mois,
          photo_url: contrat.photo_url,
          photo_type: contrat.photo_type,
        })
        .eq('id', contratEdite.id)
      if (error) { Alert.alert('Correction impossible', messageErreur(error)); return }

      journaliser('CONTRAT_CORRIGE', {
        travailleur: trav.nom,
        contrat_id: contratEdite.id,
        avant: { type: contratEdite.type, date_debut: contratEdite.date_debut, date_fin: contratEdite.date_fin },
        apres: { type: contrat.type, date_debut: contrat.date_debut, date_fin: contrat.date_fin },
      }, { ...contexteJournal, restaurantId: trav.restaurant_id || null }).catch(() => {})
    } else {
      const { error } = await supabase.from('contrats_travailleurs').insert({
        travailleur_id: trav.id,
        restaurant_id: trav.restaurant_id || null,
        type: contrat.type,
        date_debut: contrat.date_debut,
        date_fin: contrat.date_fin,
        duree_mois: contrat.duree_mois,
        photo_url: contrat.photo_url,
        photo_type: contrat.photo_type,
        cree_par: userId || null,
      })
      if (error) { Alert.alert('Contrat non enregistré', messageErreur(error)); return }

      // La colonne s'appelle `description` : documents_travailleurs n'a pas de
      // colonne fichier_type, c'est là que le reste de l'app range le format.
      await supabase.from('documents_travailleurs').insert({
        travailleur_id: trav.id,
        type_document: 'Contrat',
        fichier_url: contrat.photo_url,
        description: contrat.photo_type === 'pdf' ? 'pdf' : 'image',
      }).then(() => {}, () => {})

      await supabase.from('travailleurs')
        .update({ type_contrat: contrat.type })
        .eq('id', trav.id)

      creerNotification({
        type: 'contrat_ajoute',
        titre: '📝 Contrat enregistré',
        message: `${contrat.type} pour ${trav.nom}${contrat.date_fin ? ` — jusqu'au ${formatFR(contrat.date_fin)}` : ''}`,
        restaurant_id: trav.restaurant_id || null,
        cible_role: ['manager', 'directeur'],
        screen: 'contrats',
      }).catch(() => {})
    }

    setFormVisible(false)
    setContratEdite(null)
    await charger()
  }

  async function rompreContrat(contrat, dateCloture, motif) {
    const trav = travSelectionne
    const { error } = await supabase.from('contrats_travailleurs')
      .update({ cloture_le: dateCloture, cloture_motif: motif })
      .eq('id', contrat.id)
    if (error) {
      Alert.alert('Rupture impossible',
        `La date de rupture doit être comprise entre le ${formatFR(contrat.date_debut)} et le ${formatFR(contrat.date_fin)}.`)
      return
    }
    journaliser('CONTRAT_ROMPU', {
      travailleur: trav?.nom, contrat_id: contrat.id, type: contrat.type,
      cloture_le: dateCloture, motif,
    }, { ...contexteJournal, restaurantId: trav?.restaurant_id || null }).catch(() => {})

    creerNotification({
      type: 'contrat_rompu',
      titre: '⛔ Contrat rompu',
      message: `${contrat.type} de ${trav?.nom} rompu au ${formatFR(dateCloture)} — ${motif}`,
      restaurant_id: trav?.restaurant_id || null,
      cible_role: ['manager', 'directeur'],
      screen: 'contrats',
    }).catch(() => {})

    await charger()
  }

  async function supprimerContrat(contrat) {
    const trav = travSelectionne
    await supabase.from('contrats_travailleurs').delete().eq('id', contrat.id)
    // On efface la ligne de document qui pointe le même fichier. Le fichier
    // lui-même reste dans le stockage : une autre ligne pourrait le référencer.
    if (contrat.photo_url) {
      await supabase.from('documents_travailleurs')
        .delete()
        .eq('travailleur_id', contrat.travailleur_id)
        .eq('fichier_url', contrat.photo_url)
    }
    journaliser('CONTRAT_SUPPRIME', {
      travailleur: trav?.nom, contrat_id: contrat.id, type: contrat.type,
      date_debut: contrat.date_debut, date_fin: contrat.date_fin,
    }, { ...contexteJournal, restaurantId: trav?.restaurant_id || null }).catch(() => {})
    await charger()
  }

  function renderLigne(l) {
    const c = l.contrat
    const b = badge(c)
    const rang = c ? rangParType(contratsDe(l.travailleur.id), c) : 0
    const statut = c ? statutContrat(c, jour) : null

    return (
      <TouchableOpacity key={l.travailleur.id} style={styles.card} onPress={() => ouvrirFiche(l.travailleur)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.nom}>{l.travailleur.nom}</Text>
          <Text style={styles.sous}>
            {l.travailleur.restaurants?.nom || 'Sans restaurant'} · {l.travailleur.poste || 'Sans poste'}
          </Text>

          {c ? (
            <>
              <Text style={styles.contratLigne}>
                {c.type}{rang > 0 ? ` · ${ordinalFR(rang)} contrat` : ''}
                {c.date_fin
                  ? ` · ${formatFR(c.date_debut)} → ${formatFR(c.date_fin)}`
                  : ` · depuis le ${formatFR(c.date_debut)}`}
              </Text>
              {statut === 'a_venir' && (
                <Text style={styles.mention}>Débute le {formatFR(c.date_debut)}</Text>
              )}
              {(statut === 'expire' || statut === 'rompu') && (() => {
                const suivant = contratsDe(l.travailleur.id)
                  .filter(x => statutContrat(x, jour) === 'a_venir')
                  .sort((a, b2) => (a.date_debut < b2.date_debut ? -1 : 1))[0]
                return suivant
                  ? <Text style={styles.mention}>Suite prévue le {formatFR(suivant.date_debut)}</Text>
                  : <Text style={styles.mentionAlerte}>À renouveler</Text>
              })()}
              {l.total > 1 && (
                <Text style={styles.historique}>{l.total} contrats ›</Text>
              )}
            </>
          ) : (
            <Text style={styles.mentionAlerte}>Aucun contrat enregistré</Text>
          )}
        </View>

        {b && (
          <View style={[styles.badge, { backgroundColor: b.couleur }]}>
            <Text style={styles.badgeTxt}>{b.texte}</Text>
          </View>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Contrats</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Rechercher un travailleur…"
          value={recherche}
          onChangeText={setRecherche}
          placeholderTextColor="#bbb"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtreBar}>
        <TouchableOpacity
          style={[styles.filtreBtn, filtreResto === 'tous' && styles.filtreBtnActive]}
          onPress={() => setFiltreResto('tous')}
        >
          <Text style={[styles.filtreTxt, filtreResto === 'tous' && styles.filtreTxtActive]}>Tous</Text>
        </TouchableOpacity>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.filtreBtn, filtreResto === r.id && styles.filtreBtnActive]}
            onPress={() => setFiltreResto(r.id)}
          >
            <Text style={[styles.filtreTxt, filtreResto === r.id && styles.filtreTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#185FA5" />
          <Text style={styles.loadingTxt}>Chargement des contrats…</Text>
        </View>
      ) : (
        <ScrollView style={styles.body}>
          <Text style={styles.resume}>
            {compteurs.expire} expirent bientôt · {compteurs.enCours} en cours · {compteurs.sans} sans contrat
          </Text>

          <View style={styles.etatBar}>
            {FILTRES.map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.etatBtn, filtreEtat === f && styles.etatBtnActive]}
                onPress={() => setFiltreEtat(f)}
              >
                <Text style={[styles.etatTxt, filtreEtat === f && styles.etatTxtActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {affichees.length === 0 && (
            <Text style={styles.vide}>
              {filtreEtat === 'Expire bientôt'
                ? "Aucun contrat n'arrive à échéance dans les 30 jours."
                : filtreEtat === 'Sans contrat'
                  ? 'Tous les travailleurs ont un contrat.'
                  : 'Rien à afficher.'}
            </Text>
          )}

          {affichees.map(renderLigne)}
          <View style={{ height: 90 }} />
        </ScrollView>
      )}

      <TouchableOpacity style={styles.fab} onPress={() => setSelecteurVisible(true)}>
        <Text style={styles.fabTxt}>+ Nouveau contrat</Text>
      </TouchableOpacity>

      <SelecteurTravailleur
        visible={selecteurVisible}
        travailleurs={travailleurs}
        restaurants={restaurants}
        colors={colors}
        onFermer={() => setSelecteurVisible(false)}
        onChoisir={nouveauContratPour}
      />

      <FicheContrat
        visible={ficheVisible}
        travailleur={travSelectionne}
        contrats={travSelectionne ? contratsDe(travSelectionne.id) : []}
        colors={colors}
        onFermer={() => setFicheVisible(false)}
        onRenouveler={() => { setContratEdite(null); setFormVisible(true) }}
        onCorriger={c => { setContratEdite(c); setFormVisible(true) }}
        onSupprimer={supprimerContrat}
        onRompre={rompreContrat}
      />

      <FormulaireContrat
        visible={formVisible}
        travailleur={travSelectionne}
        contratsExistants={travSelectionne ? contratsDe(travSelectionne.id) : []}
        contratEdite={contratEdite}
        colors={colors}
        onFermer={() => { setFormVisible(false); setContratEdite(null) }}
        onEnregistrer={enregistrerContrat}
      />
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface },
  searchBar: { backgroundColor: colors.surface, padding: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  searchInput: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 14, color: colors.text },
  filtreBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  filtreBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  filtreBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  filtreTxt: { fontSize: 12, color: colors.textMuted },
  filtreTxtActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  resume: { fontSize: 13, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  etatBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  etatBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border },
  etatBtnActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  etatTxt: { fontSize: 12, color: colors.textMuted },
  etatTxtActive: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 0.5, borderColor: colors.border },
  nom: { fontSize: 14, fontWeight: '600', color: colors.text },
  sous: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  contratLigne: { fontSize: 13, color: colors.text, marginTop: 6 },
  mention: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  mentionAlerte: { fontSize: 12, color: '#993C1D', marginTop: 4, fontWeight: '600' },
  historique: { fontSize: 12, color: '#185FA5', marginTop: 4 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { fontSize: 11, color: '#fff', fontWeight: '600' },
  vide: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: 40 },
  fab: { position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: '#185FA5', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 14 },
  fabTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
}) }
```

- [x] **Step 2 : Vérifier**

Run: `npx eslint app/contrats.js`
Expected: 0 erreur.

- [ ] **Step 3 : Vérifier dans l'app**

Run: `npm start`

La migration de la Task 1 doit avoir été passée pour les points 4 et 5.

1. Accueil → tuile **Contrats** → l'écran s'ouvre sur « Expire bientôt ».
2. Filtre **Sans contrat** → la liste montre les travailleurs sans contrat, sans les Journaliers.
3. `+ Nouveau contrat` → choisir un travailleur → Stage, 3 mois, photo → enregistrer.
4. Rouvrir sa fiche → `+ Renouveler` → la date de début est le lendemain de la fin. Choisir **Autre** et taper `4` → la date de fin se cale 4 mois plus tard. Enregistrer.
5. Sa fiche affiche maintenant « Stage · 1er contrat » et « Stage · 2e contrat ». Dans la liste principale il n'apparaît **qu'une fois**.
6. Sur le contrat en cours : **Rompre** → date hors bornes → message citant les deux dates. Date valide + motif → le contrat passe « rompu ».
7. **Corriger** un contrat : la photo déjà enregistrée est indiquée, changer une date suffit.
8. **Supprimer** un contrat de test → double confirmation → il disparaît de la fiche.

- [x] **Step 4 : Commit**

```bash
git add app/contrats.js
git commit -m "feat(contrats): écran autonome avec filtres, fiche et actions"
```

---

### Task 7 : Retirer les contrats de l'écran RH

**Files:**
- Modify: `lib/menus.js` (la tuile `contrats`)
- Modify: `app/rh.js` (onglet, rendu, états, chargement, paramètre d'URL, bloc de la fiche)
- Modify: `components/BlocContrats.js` (`onAjouter` optionnel)

**Interfaces:**
- Consumes : `app/contrats.js` (Task 6) doit exister avant, sinon la tuile pointe dans le vide.
- Produces : plus aucune gestion de contrat dans `app/rh.js`.

- [x] **Step 1 : Faire pointer la tuile sur le nouvel écran**

Dans `lib/menus.js`, remplacer `route: '/rh?onglet=Contrats'` par `route: '/contrats'` sur
la ligne dont l'`id` est `contrats`. Ne pas toucher à l'`id` : il est stocké en base dans
`roles_acces`, le renommer ferait disparaître la tuile pour le rôle RH.

- [x] **Step 2 : Rendre `onAjouter` optionnel dans le bloc**

Dans `components/BlocContrats.js`, remplacer le bouton d'ajout par un rendu conditionnel :

```jsx
      {onAjouter ? (
        <TouchableOpacity
          style={{ marginTop: 10, alignSelf: 'flex-start', backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 0.5, borderColor: colors.border }}
          onPress={onAjouter}
        >
          <Text style={{ fontSize: 13, color: '#185FA5', fontWeight: '500' }}>+ Nouveau contrat</Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 10 }}>
          À gérer dans l'écran Contrats.
        </Text>
      )}
```

- [x] **Step 3 : Retirer l'onglet Contrats de `app/rh.js`**

Six suppressions, à faire dans cet ordre :

1. Constante des onglets — retirer `'Contrats'` :
```js
const ONGLETS = ['Dashboard', 'Travailleurs', 'Présences', 'Salaires', 'Archivés']
```

2. États — supprimer ces deux lignes :
```js
  const [tousContrats, setTousContrats] = useState([])
  const [filtreContrats, setFiltreContrats] = useState('Expire bientôt')
```

3. Chargement — supprimer la ligne `if (onglet === 'Contrats') chargerTousContrats()` et
   la fonction `chargerTousContrats()` entière, avec son commentaire.

4. Rendu — supprimer la fonction `renderContrats()` entière (de son commentaire
   `// ─── ONGLET CONTRATS ───` jusqu'à sa dernière accolade) et la ligne
   `{onglet === 'Contrats' && renderContrats()}`.

5. Paramètre d'URL — supprimer ces lignes et remettre l'état simple :
```js
  const [onglet, setOnglet] = useState('Dashboard')
```
   Supprimer aussi le `useEffect` qui écoute `ongletDemande`, la ligne
   `const { onglet: ongletDemande } = useLocalSearchParams()`, la ligne
   `const ongletInitial = ...`, et retirer `useLocalSearchParams` de l'import
   `expo-router` (qui redevient `import { router } from 'expo-router'`).

6. Bloc de la fiche — retirer la prop `onAjouter` pour passer en lecture seule :
```jsx
                <BlocContrats
                  travailleur={travailleurSelectionne}
                  contrats={contratsTravailleur}
                  colors={colors}
                />
```

Garder en revanche : l'import `BlocContrats`, l'état `contratsTravailleur`, la fonction
`chargerContrats` et son appel dans `ouvrirDetailTravailleur`. Le bloc en a besoin.

Supprimer enfin l'import devenu inutile `badgeEcheance` (l'import redevient
`import BlocContrats from '../components/BlocContrats'`), ainsi que
`import { aujourdhuiISO, statutContrat } from '../lib/contrats'` s'il n'est plus utilisé
ailleurs dans le fichier.

- [x] **Step 4 : Vérifier**

Run: `npx eslint app/rh.js lib/menus.js components/BlocContrats.js`
Expected: 0 erreur. Aucun avertissement `no-unused-vars` : s'il en reste un, c'est qu'un
import ou un état de la liste ci-dessus n'a pas été supprimé.

Run: `grep -n "Contrats\|contrats" app/rh.js`
Expected: seulement `BlocContrats`, `contratsTravailleur`, `chargerContrats` et la table
`contrats_travailleurs` dans l'archivage et la suppression. Aucune trace d'onglet.

- [ ] **Step 5 : Vérifier dans l'app**

Run: `npm start`

1. RH → la barre d'onglets affiche cinq onglets, plus de « Contrats ».
2. RH → Travailleurs → ouvrir une fiche → le bloc Contrat s'affiche, sans bouton d'ajout,
   avec la mention « À gérer dans l'écran Contrats ».
3. Accueil → tuile Contrats → ouvre bien `/contrats` et non l'écran RH.

- [x] **Step 6 : Commit**

```bash
git add lib/menus.js app/rh.js components/BlocContrats.js
git commit -m "refactor(rh): les contrats quittent l'écran RH pour leur écran dédié"
```

---

## Vérification finale

- [x] `npm test` — tous les fichiers `lib/*.test.mjs` verts.
- [x] `npm run lint` — aucune erreur nouvelle.
- [ ] Migration `supabase_contrats_duree_libre.sql` passée dans Supabase.
- [ ] Parcours complet : accueil → Contrats → nouveau Stage 3 mois → renouveler 4 mois →
      la fiche montre « 1er » et « 2e contrat de stage » → la liste ne montre le travailleur
      qu'une fois → rompre le contrat en cours → il passe dans « Expirés ».
- [ ] Passer un travailleur du Stage au CDD : le CDD s'affiche « CDD · 1er contrat ».
- [x] `grep -rn "onglet=Contrats" app lib components` — aucun résultat.
