# Groupes de restaurants, arriérés CNPS et import des anciens travailleurs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer les groupes « Groupe Samer » / « Groupe Al Kayan » qui portent des fiches administratives sans restaurant, y mettre les arriérés CNPS, et importer les 75 droits d'anciens travailleurs depuis les fichiers Excel.

**Architecture:** Une table `groupes` + `groupe_id` sur `restaurants`, `fournisseurs` et `tresorerie_depenses_direction`. Une fiche de groupe = fournisseur `administratif` avec `restaurant_id` NULL. Les écrans affichent le groupe là où ils affichaient le restaurant (helper pur `lib/groupes.js`). Le résultat net « tous restaurants » retire les paiements direction des fiches de groupe. L'import = module pur testé (`lib/importDroitsCnps.js`) + script qui lit les .xlsx (exceljs en flux) et génère un fichier de contrôle puis un `import.sql` idempotent qui passe par `inserer_transaction_hors_point` (même chemin que l'app).

**Tech Stack:** Expo / React Native web, Supabase (Postgres, RPC plpgsql), `node:test`, `exceljs` (déjà dans package.json).

Spéc : `docs/superpowers/specs/2026-10-22-groupes-cnps-anciens-travailleurs-design.md`

## Global Constraints

- Projet Supabase Samtrackly : `wlwotzxnzowbkbfcpnyi`. Les migrations `supabase_*.sql` sont **passées par l'utilisateur** (pas par l'agent), idempotentes, avec un contrôle de mauvais projet en tête.
- Toute l'interface et les messages en **français**, montants en FCFA entiers.
- Un montant dû n'est **jamais** une charge ; seul le paiement l'est (règle M. Zreik du 12/10).
- Paiement d'une fiche de groupe : **direction seulement** ; compte au résultat **« tous restaurants » seulement**.
- Les gérants ne voient jamais une fiche de groupe.
- Pas d'écriture en base par l'agent sans accord explicite de l'utilisateur (QCM AskUserQuestion).
- Pas de `expo start` / localhost lancé par l'agent ; vérifier par tests, lint, export web.
- Pas de publication (Vercel / EAS) dans ce plan : seulement commit + push (règle « publier à la fin »).
- Git : `DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant les commandes git ; commits conventionnels en français ; ne pas inclure `scripts/import-sheets/` ni `.gitignore` déjà modifiés hors de ce chantier.
- Tests : `for f in lib/*.test.mjs; do node "$f"; done` (0 échec) ; `npm run lint` (0 erreur).
- Données personnelles (noms, montants des anciens travailleurs) : jamais commitées — `scripts/import-cnps-anciens/out/` est ignoré par git.

## Identifiants (lus en base le 22/10)

| Restaurant | id | Groupe |
|---|---|---|
| Samer Angré 7E | `2f09688d-a4b9-4b14-8c45-943543953379` | Groupe Samer |
| Samer Lavage | `99eb7f7e-baab-4159-872a-34a086374f49` | Groupe Samer |
| Samer Maroc | `f4550ccf-fa52-4e56-b4bb-9cea4a155df9` | Groupe Samer |
| Samer Oasis | `ce8a00d8-0908-46b7-ad2f-c9b29d54f03f` | Groupe Samer |
| Samer Palmeraie | `b862dfee-007f-413a-9de0-2c6e83b572ce` | Groupe Samer |
| Al Kayan KMS | `c12f15b9-6149-4b56-be2b-6e82ab447216` | Groupe Al Kayan |
| Al Kayan Yop | `268695fe-972e-468e-b2b7-4e7f268dec4f` | Groupe Al Kayan |
| À la Braise | `0f05b4c4-2ed3-4ad8-a754-2139ad0f4823` | aucun |

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase_groupes_restaurants.sql` (créé) | table `groupes`, colonnes `groupe_id`, contrainte, rattachement des restaurants, RPC de paiement direction qui note le groupe |
| `lib/groupes.js` (créé) + `lib/groupes.test.mjs` | clé et nom de rattachement (restaurant ou groupe) |
| `lib/groupesDb.js` (créé) | `chargerGroupes()` |
| `lib/droitsAnciensTravailleurs.js` (modifié) | regroupe par rattachement |
| `components/tresorerie/anciensTravailleurs.js` (modifié) | nom du groupe, texte de paiement |
| `lib/tresorerieDb.js` (modifié) | `donnees.groupes` |
| `app/tresorerie-a-payer.js` (modifié) | passe `groupes` à l'onglet anciens |
| `app/credits-fournisseurs.js` (modifié) | nom du groupe sur les fiches, `groupes` aux feuilles |
| `components/fournisseurs/FeuilleFournisseurAdmin.js` (modifié) | création d'une fiche de groupe |
| `components/fournisseurs/FeuillePaiementDirection.js` (modifié) | texte « résultat du groupe » |
| `lib/direction.js` (modifié) + `lib/direction.test.mjs` | `depensesGroupeParMois()` |
| `app/tresorerie-resultats.js` (modifié) | total « Groupe » retire les arriérés payés |
| `lib/importDroitsCnps.js` (créé) + `lib/importDroitsCnps.test.mjs` | lecture des lignes, rattachement, CSV de contrôle, SQL |
| `scripts/import-cnps-anciens/preparer.mjs` (créé) | lit les .xlsx, écrit `out/controle.csv`, `out/resume.txt`, `out/import.sql` |
| `scripts/import-cnps-anciens/.gitignore` (créé) | `out/` |

---

### Task 1 : Migration des groupes

**Files:**
- Create: `supabase_groupes_restaurants.sql`

**Interfaces:**
- Produces: table `groupes(id uuid, nom text unique)` avec les lignes `Groupe Samer`, `Groupe Al Kayan` ; colonnes `restaurants.groupe_id`, `fournisseurs.groupe_id`, `tresorerie_depenses_direction.groupe_id` ; contrainte `fournisseurs_groupe_check` ; RPC `tresorerie_payer_fournisseur_admin` (même signature) qui remplit `groupe_id` de la dépense.

- [ ] **Step 1 : Écrire la migration**

```sql
-- =====================================================================
--  Groupes de restaurants — 22/10/2026
--  Projet Samtrackly (wlwotzxnzowbkbfcpnyi). Idempotente : se repasse sans risque.
--
--  Un groupe (Groupe Samer, Groupe Al Kayan) porte des fiches administratives
--  qui n'appartiennent à aucun restaurant : arriérés CNPS (un compte CNPS par
--  marque), anciens travailleurs d'un site fermé (Zone 4). Seule la direction
--  les paie ; le paiement compte au résultat « tous restaurants » seulement.
--  Spéc : docs/superpowers/specs/2026-10-22-groupes-cnps-anciens-travailleurs-design.md
-- =====================================================================

do $$
begin
  if to_regclass('public.tresorerie_depenses_direction') is null
     or not exists (select 1 from information_schema.columns
                    where table_name = 'fournisseurs' and column_name = 'depart_le') then
    raise exception 'Mauvais projet ou migrations manquantes : passez d''abord supabase_droits_anciens_travailleurs.sql (projet Samtrackly wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

CREATE TABLE IF NOT EXISTS groupes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE groupes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON groupes;
CREATE POLICY allow_all ON groupes FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE SET NULL;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE RESTRICT;
ALTER TABLE tresorerie_depenses_direction ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE SET NULL;

-- Une fiche de groupe est administrative et n'a pas de restaurant.
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_groupe_check
    CHECK (groupe_id IS NULL OR (restaurant_id IS NULL AND type = 'administratif'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS fournisseurs_groupe_idx ON fournisseurs (groupe_id) WHERE groupe_id IS NOT NULL;

INSERT INTO groupes (nom) VALUES ('Groupe Samer'), ('Groupe Al Kayan') ON CONFLICT (nom) DO NOTHING;

UPDATE restaurants SET groupe_id = (SELECT id FROM groupes WHERE nom = 'Groupe Samer')
 WHERE id IN ('2f09688d-a4b9-4b14-8c45-943543953379', '99eb7f7e-baab-4159-872a-34a086374f49',
              'f4550ccf-fa52-4e56-b4bb-9cea4a155df9', 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f',
              'b862dfee-007f-413a-9de0-2c6e83b572ce');
UPDATE restaurants SET groupe_id = (SELECT id FROM groupes WHERE nom = 'Groupe Al Kayan')
 WHERE id IN ('c12f15b9-6149-4b56-be2b-6e82ab447216', '268695fe-972e-468e-b2b7-4e7f268dec4f');

-- Paiement direction : identique à la version en service (lue en base le
-- 22/10), plus le groupe de la fiche sur la dépense.
CREATE OR REPLACE FUNCTION tresorerie_payer_fournisseur_admin(
  p_fournisseur uuid, p_date date, p_montant bigint, p_source text, p_compte_id uuid,
  p_note text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  fo record;
  v_libelle text;
  v_mvt uuid;
  v_coffre uuid;
  v_tx uuid;
  v_id uuid;
BEGIN
  SELECT id, nom, type, restaurant_id, groupe_id INTO fo FROM fournisseurs WHERE id = p_fournisseur;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable.'; END IF;
  IF fo.type IS DISTINCT FROM 'administratif' THEN
    RAISE EXCEPTION 'Seul un fournisseur administratif se paie depuis la direction.';
  END IF;
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF p_source = 'compte' AND p_compte_id IS NULL THEN RAISE EXCEPTION 'Choisissez le compte.'; END IF;

  v_libelle := 'Administratif · ' || fo.nom || coalesce(' · ' || nullif(trim(p_note), ''), '');
  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -p_montant, 'direction', v_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  ELSIF p_source = 'coffre' THEN
    INSERT INTO tresorerie_coffre_mouvements (date, montant, type, source, libelle, cree_par, cree_par_nom)
    VALUES (p_date, -p_montant, 'depense', 'coffre', v_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_coffre;
  END IF;

  v_tx := inserer_transaction_hors_point(fo.id, p_date, 0, p_montant, 'direction', 'paiement_direction', p_user_nom);

  INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, groupe_id, montant, source, compte_id, mouvement_id,
    coffre_mouvement_id, note, fournisseur_id, transaction_id, cree_par, cree_par_nom)
  VALUES (p_date, 'administratif', fo.restaurant_id, fo.groupe_id, p_montant, p_source,
    CASE WHEN p_source = 'compte' THEN p_compte_id END, v_mvt, v_coffre,
    coalesce(fo.nom || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_note), fo.id, v_tx, p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';

-- Contrôle : 5 restaurants Samer, 2 Al Kayan, À la Braise sans groupe.
SELECT coalesce(g.nom, '(aucun groupe)') AS groupe, string_agg(trim(r.nom), ', ' ORDER BY r.nom) AS restaurants
  FROM restaurants r LEFT JOIN groupes g ON g.id = r.groupe_id
 GROUP BY g.nom ORDER BY g.nom;
```

- [ ] **Step 2 : Comparer la fonction à la version en base avant de livrer**

Lire la version en service (lecture seule, MCP Supabase `execute_sql`) :
```sql
select pg_get_functiondef(p.oid) from pg_proc p where proname = 'tresorerie_payer_fournisseur_admin';
```
Expected : le corps est identique à celui de la migration, sauf `groupe_id` (SELECT et INSERT). S'il diffère (autre migration passée entre-temps), reporter la différence dans la migration avant de continuer.

- [ ] **Step 3 : Commit**

```bash
git add supabase_groupes_restaurants.sql
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(groupes): migration groupes de restaurants (Samer, Al Kayan)"
```

- [ ] **Step 4 : Demander à l'utilisateur de passer la migration**

AskUserQuestion : « Passe `supabase_groupes_restaurants.sql` dans Supabase (SQL Editor, projet Samtrackly). Le contrôle final doit montrer Groupe Samer (5 restos), Groupe Al Kayan (2), À la Braise sans groupe. » Options : « C'est passé » / « Erreur (je colle le message) ».

- [ ] **Step 5 : Vérifier (lecture seule)**

```sql
select g.nom, count(r.id) from groupes g left join restaurants r on r.groupe_id = g.id group by g.nom order by g.nom;
```
Expected : `Groupe Al Kayan | 2`, `Groupe Samer | 5`.

---

### Task 2 : Rattachement restaurant ou groupe (logique pure)

**Files:**
- Create: `lib/groupes.js`, `lib/groupes.test.mjs`, `lib/groupesDb.js`
- Modify: `lib/droitsAnciensTravailleurs.js` (fonction `resumeDroitsParResto`, ~ligne 60)
- Test: `lib/droitsAnciensTravailleurs.test.mjs`

**Interfaces:**
- Produces :
  - `cleRattachement(f) → string | null` : `f.restaurant_id`, sinon `'groupe:<groupe_id>'`, sinon `null`.
  - `nomRattachement(cle, restaurants = [], groupes = []) → string` : nom du restaurant (sans espaces finaux), nom du groupe, `'Groupe'` si groupe inconnu, `'—'` si rien.
  - `estFicheGroupe(f) → boolean`.
  - `chargerGroupes() → Promise<[{ id, nom }]>` (vide si la table n'existe pas encore).
  - `resumeDroitsParResto` range désormais par `cleRattachement(f)`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`lib/groupes.test.mjs` :
```js
// Tests de lib/groupes.js — rattachement d'une fiche à un restaurant ou à un groupe.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cleRattachement, estFicheGroupe, nomRattachement } from './groupes.js'

const restaurants = [{ id: 'r1', nom: 'Samer Maroc ' }]
const groupes = [{ id: 'g1', nom: 'Groupe Samer' }]

describe('cleRattachement', () => {
  test('restaurant d\'abord', () => assert.equal(cleRattachement({ restaurant_id: 'r1', groupe_id: null }), 'r1'))
  test('groupe sinon', () => assert.equal(cleRattachement({ restaurant_id: null, groupe_id: 'g1' }), 'groupe:g1'))
  test('rien', () => assert.equal(cleRattachement({}), null))
})

describe('nomRattachement', () => {
  test('restaurant, sans espace final', () => assert.equal(nomRattachement('r1', restaurants, groupes), 'Samer Maroc'))
  test('groupe', () => assert.equal(nomRattachement('groupe:g1', restaurants, groupes), 'Groupe Samer'))
  test('groupe inconnu', () => assert.equal(nomRattachement('groupe:zz', restaurants, groupes), 'Groupe'))
  test('vide', () => assert.equal(nomRattachement(null, restaurants, groupes), '—'))
  test('restaurant inconnu', () => assert.equal(nomRattachement('zz', restaurants, groupes), '—'))
})

describe('estFicheGroupe', () => {
  test('groupe sans restaurant', () => assert.equal(estFicheGroupe({ groupe_id: 'g1', restaurant_id: null }), true))
  test('restaurant', () => assert.equal(estFicheGroupe({ groupe_id: null, restaurant_id: 'r1' }), false))
})
```

Ajouter à `lib/droitsAnciensTravailleurs.test.mjs` (dans le fichier, après les tests existants de `resumeDroitsParResto`) :
```js
describe('resumeDroitsParResto — fiche de groupe', () => {
  test('rangée sous groupe:<id>', () => {
    const fiches = [{ id: 'f1', restaurant_id: null, groupe_id: 'g1', depart_le: '2024-09-30' }]
    const out = resumeDroitsParResto(fiches, [tx('f1', '2026-10-22', 17647, 0, 'ajustement_manager')])
    assert.deepEqual(Object.keys(out), ['groupe:g1'])
    assert.equal(out['groupe:g1'].reste, 17647)
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node lib/groupes.test.mjs; node lib/droitsAnciensTravailleurs.test.mjs`
Expected : FAIL (`Cannot find module './groupes.js'`, puis clé `null` au lieu de `groupe:g1`).

- [ ] **Step 3 : Implémenter**

`lib/groupes.js` :
```js
// ──────────────────────────────────────────────────────────────────────────────
// Groupes de restaurants (supabase_groupes_restaurants.sql, 22/10/2026).
// Une fiche administrative appartient à un restaurant OU à un groupe (Groupe
// Samer, Groupe Al Kayan : arriérés CNPS, anciens d'un site fermé). Ces
// helpers donnent une clé et un nom uniques pour les deux cas.
// Pur : testé par lib/groupes.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const PREFIXE = 'groupe:'

export function cleRattachement(f) {
  if (f?.restaurant_id) return f.restaurant_id
  return f?.groupe_id ? `${PREFIXE}${f.groupe_id}` : null
}

export function nomRattachement(cle, restaurants = [], groupes = []) {
  if (!cle) return '—'
  const c = String(cle)
  if (c.startsWith(PREFIXE)) {
    const id = c.slice(PREFIXE.length)
    return groupes.find(g => g.id === id)?.nom || 'Groupe'
  }
  return String(restaurants.find(r => r.id === c)?.nom || '').trim() || '—'
}

export function estFicheGroupe(f) {
  return !!f?.groupe_id && !f?.restaurant_id
}
```

`lib/groupesDb.js` :
```js
// Groupes de restaurants — accès Supabase (logique pure : lib/groupes.js).
import { supabase } from './supabase'

// Vide tant que supabase_groupes_restaurants.sql n'est pas passée.
export async function chargerGroupes() {
  const { data, error } = await supabase.from('groupes').select('id, nom').order('nom')
  return error ? [] : data || []
}
```

Dans `lib/droitsAnciensTravailleurs.js`, en tête des imports (le fichier n'en a pas : ajouter après le bloc de commentaire d'en-tête) :
```js
import { cleRattachement } from './groupes.js'
```
et dans `resumeDroitsParResto`, remplacer :
```js
    const g = (out[f.restaurant_id] ||= { fiches: [], du: 0, paye: 0, reste: 0 })
```
par :
```js
    // Restaurant, ou groupe pour une fiche sans restaurant (Zone 4).
    const g = (out[cleRattachement(f)] ||= { fiches: [], du: 0, paye: 0, reste: 0 })
```
Vérifier que les autres imports relatifs de `lib/*.js` utilisés par les tests portent l'extension `.js` (sinon `node` ne les résout pas) : `grep -n "^import" lib/droitsAnciensTravailleurs.js`.

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node lib/groupes.test.mjs && node lib/droitsAnciensTravailleurs.test.mjs`
Expected : tous PASS.

- [ ] **Step 5 : Commit**

```bash
git add lib/groupes.js lib/groupes.test.mjs lib/groupesDb.js lib/droitsAnciensTravailleurs.js lib/droitsAnciensTravailleurs.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(groupes): rattachement d'une fiche à un restaurant ou à un groupe"
```

---

### Task 3 : Écrans — afficher et créer les fiches de groupe

**Files:**
- Modify: `lib/tresorerieDb.js` (`chargerTresorerie`, Promise.all ~ligne 86 et `return` ~ligne 152)
- Modify: `app/tresorerie-a-payer.js` (~ligne 137, `<OngletAnciensTravailleurs`)
- Modify: `components/tresorerie/anciensTravailleurs.js` (lignes 29, 49, 59, 82, 237, 309, 316)
- Modify: `app/credits-fournisseurs.js` (lignes 106, 163-188, 1476-1478)
- Modify: `components/fournisseurs/FeuilleFournisseurAdmin.js` (lignes 34, 53, 63-64, 72-85, 156-166)
- Modify: `components/fournisseurs/FeuillePaiementDirection.js` (lignes 70, 104)

**Interfaces:**
- Consumes : `cleRattachement`, `nomRattachement`, `estFicheGroupe` (`lib/groupes.js`), `chargerGroupes` (`lib/groupesDb.js`).
- Produces : `donnees.groupes` dans `chargerTresorerie()` ; prop `groupes` sur `OngletAnciensTravailleurs` et `FeuilleFournisseurAdmin` ; `restaurant_nom` d'une fiche de groupe = nom du groupe.

- [ ] **Step 1 : Trésorerie charge les groupes**

Dans `lib/tresorerieDb.js`, ajouter `groupes` à la fin de la déstructuration du `Promise.all` de `chargerTresorerie` et la requête correspondante en dernière position du tableau :
```js
      // Groupes (22/10/2026) : vides tant que supabase_groupes_restaurants.sql n'est pas passée.
      toutesLesLignes(() => supabase.from('groupes').select('id, nom').order('nom').order('id')).catch(() => []),
```
et dans l'objet retourné, juste après `restaurants,` :
```js
      groupes,
```

- [ ] **Step 2 : Onglet Anciens travailleurs**

`app/tresorerie-a-payer.js` : sur `<OngletAnciensTravailleurs ... restaurants={donnees.restaurants}` ajouter `groupes={donnees.groupes || []}`.

`components/tresorerie/anciensTravailleurs.js` :
- import : `import { cleRattachement, estFicheGroupe, nomRattachement } from '../../lib/groupes'`
- signature : `export function OngletAnciensTravailleurs({ niveau, user, restaurants = [], groupes = [], onPrevoir, onModifie, rafraichir })`
- remplacer `const nomResto = id => restaurants.find(r => r.id === id)?.nom || '—'` par :
```js
  // Clé = restaurant ou « groupe:<id> » (fiche sans restaurant, ex. Zone 4).
  const nomResto = cle => nomRattachement(cle, restaurants, groupes)
```
- dans `FeuilleDetailDroit` (ligne ~237) et `FeuillePayerDroit` (ligne ~309) : `nomResto(fiche.restaurant_id)` → `nomResto(cleRattachement(fiche))`. Dans `AnciennesFiches` (lignes ~332, ~352) on garde `f.restaurant_id` (ces fiches ont toujours un restaurant).
- texte de `FeuillePayerDroit` (ligne ~316) :
```jsx
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        {estFicheGroupe(fiche)
          ? 'Noté dans Dépenses direction ; compte dans le résultat de tous les restaurants (pas d\'un restaurant seul).'
          : 'Noté dans Dépenses direction ; compte comme une charge du restaurant ce mois-ci.'}
      </Text>
```
`FeuilleDroit` (création manuelle) ne change pas : une fiche par travailleur se crée toujours sur un restaurant.

- [ ] **Step 3 : Crédits fournisseurs**

`app/credits-fournisseurs.js` :
- import : `import { chargerGroupes } from '../lib/groupesDb'`
- état, après `const [restaurants, setRestaurants] = useState([])` : `const [groupes, setGroupes] = useState([])`
- dans `charger()`, dans le bloc `if (peutVoirRestaurants) { ... }`, après `setRestaurants(restos)` :
```js
        const grp = await chargerGroupes()
        setGroupes(grp)
        grp.forEach(g => { groupeMap[g.id] = g.nom })
```
  avec `const groupeMap = {}` déclaré juste avant `let restos = []`.
- remplacer la ligne `setFournisseurs((fourn || []).map(f => ({ ...f, restaurant_nom: restoMap[f.restaurant_id] || '' })))` par :
```js
      // Fiche de groupe (sans restaurant) : le nom du groupe à la place du restaurant.
      setFournisseurs((fourn || []).map(f => ({ ...f, restaurant_nom: restoMap[f.restaurant_id] || groupeMap[f.groupe_id] || '' })))
```
  (le gérant filtre déjà `.eq('restaurant_id', restaurantId)` : il ne reçoit jamais de fiche de groupe.)
- `<FeuilleFournisseurAdmin ... restaurants={restaurants}` → ajouter `groupes={groupes}`.

- [ ] **Step 4 : Créer une fiche de groupe (RH, manager)**

`components/fournisseurs/FeuilleFournisseurAdmin.js` :
- props : ajouter `groupes = []` après `restaurants = []` (et dans le commentaire d'en-tête : « groupes : [{ id, nom }] — une fiche de groupe n'a ni restaurant ni échéance »).
- `restaurantId` peut maintenant valoir `'groupe:<id>'`. Dans le `useEffect` : `setRestaurantId(f.restaurant_id || (f.groupe_id ? \`groupe:${f.groupe_id}\` : null) || restaurantParDefaut || null)`.
- remplacer `const nomResto = id => restaurants.find(r => r.id === id)?.nom || ''` par :
```js
  const nomResto = cle => nomRattachement(cle, restaurants, groupes)
  const choixGroupe = String(restaurantId || '').startsWith('groupe:')
```
  (import : `import { cleRattachement, nomRattachement } from '../../lib/groupes'`).
- dans `enregistrer()`, remplacer le calcul de `champs` / `resto` et le bloc `else { insert ... }` par :
```js
      // Fiche de groupe : pas d'échéance automatique (arriérés, payés par la direction).
      const champs = { nom: nom.trim(), type: TYPE_ADMIN, ...champsEcheance({ montant: choixGroupe ? 0 : montant, periodicite, depuis: moisChoisi }, aujourdhui) }
      const resto = fournisseur?.restaurant_id || (choixGroupe ? null : restaurantId)
      const groupeId = fournisseur ? fournisseur.groupe_id || null : (choixGroupe ? restaurantId.slice('groupe:'.length) : null)
      let nouveauId = null
      if (fournisseur?.id) {
        const { error } = await supabase.from('fournisseurs').update(champs).eq('id', fournisseur.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('fournisseurs')
          .insert({ ...champs, restaurant_id: resto, groupe_id: groupeId, actif: true }).select('id').single()
        if (error) throw error
        nouveauId = data.id
        if (resto) {
          await supabase.from('fournisseurs_restaurants').upsert(
            { fournisseur_id: data.id, restaurant_id: resto, credit_actuel: 0 },
            { onConflict: 'fournisseur_id,restaurant_id' })
        }
      }
```
  Vérifier dans `champsEcheance` (`lib/fournisseursAdmin.js:81`) qu'un montant 0 rend `facture_mensuelle: 0` ; sinon passer `facture_mensuelle: 0` explicitement pour un groupe.
- affichage du rattachement (ligne ~159) : `nomResto(fournisseur.restaurant_id)` → `nomResto(cleRattachement(fournisseur))`.
- puces de choix (ligne ~162), après la boucle des restaurants :
```jsx
                {groupes.map(g => (
                  <Puce key={g.id} styles={styles} actif={restaurantId === `groupe:${g.id}`} label={g.nom}
                    onPress={() => setRestaurantId(`groupe:${g.id}`)} />
                ))}
```
- masquer les champs d'échéance (montant, mensuel/annuel, mois de départ) quand `choixGroupe || estFicheGroupe(fournisseur)` et afficher à la place :
```jsx
            <Text style={[styles.formLabel, { marginBottom: 12 }]}>
              Fiche du groupe : pas d'échéance automatique, payée par la direction seulement.
            </Text>
```
  (repérer le bloc des champs d'échéance par `periodicite` dans le JSX et l'envelopper dans `{!(choixGroupe || estFicheGroupe(fournisseur)) && ( ... )}` ; importer aussi `estFicheGroupe`).
- journal : `{ restaurantId: resto, userId, userNom }` reste valable (null pour un groupe).

- [ ] **Step 5 : Paiement direction**

`components/fournisseurs/FeuillePaiementDirection.js` ligne ~104, remplacer le texte par :
```jsx
                {fournisseur.groupe_id && !fournisseur.restaurant_id
                  ? 'Le paiement est noté dans Dépenses direction et compte dans le résultat de tous les restaurants, pas d\'un restaurant seul.'
                  : 'Le paiement est noté dans Dépenses direction et compte comme une charge du restaurant ce mois-là.'}
```
(La ligne ~70 affiche déjà `fournisseur.restaurant_nom`, qui vaut le nom du groupe depuis le Step 3.)

- [ ] **Step 6 : Lint + tests + export web**

Run: `npm run lint && for f in lib/*.test.mjs; do node "$f" || exit 1; done && npx expo export -p web --output-dir /private/tmp/claude-501/-Users-macbookpro-samtrackly/ceb5b963-5abc-434d-8d1c-4cdf30e58853/scratchpad/export-web`
Expected : 0 erreur de lint, tous les tests PASS, export terminé sans erreur.

- [ ] **Step 7 : Commit**

```bash
git add lib/tresorerieDb.js app/tresorerie-a-payer.js components/tresorerie/anciensTravailleurs.js app/credits-fournisseurs.js components/fournisseurs/FeuilleFournisseurAdmin.js components/fournisseurs/FeuillePaiementDirection.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(groupes): fiches de groupe visibles et créables (Crédits, À payer)"
```

---

### Task 4 : Résultat net « tous restaurants »

**Files:**
- Modify: `lib/direction.js` (après `resultatsParRestoMois`, ~ligne 215)
- Test: `lib/direction.test.mjs`
- Modify: `app/tresorerie-resultats.js` (lignes 18, 46-51, 77-80, 85, ~132)

**Interfaces:**
- Produces : `depensesGroupeParMois(depenses = [], mois = []) → { [AAAA-MM]: number }` — somme des dépenses direction comptées dont `restaurant_id` est NULL et `groupe_id` renseigné.
- `compteDansResultat()` ne change pas (sans restaurant → false) : un restaurant seul n'est jamais touché.

- [ ] **Step 1 : Tests qui échouent** (ajouter à `lib/direction.test.mjs`, et `depensesGroupeParMois` à l'import existant de `./direction.js`)

```js
describe('depensesGroupeParMois', () => {
  const mois = ['2026-10', '2026-11']
  test('paiement direction d\'une fiche de groupe compté au mois', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: null, groupe_id: 'g1', montant: 500000 }]
    assert.deepEqual(depensesGroupeParMois(d, mois), { '2026-10': 500000 })
  })
  test('ignore les dépenses d\'un restaurant', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: 'r1', groupe_id: 'g1', montant: 1 }]
    assert.deepEqual(depensesGroupeParMois(d, mois), {})
  })
  test('ignore une dépense sans restaurant ni groupe', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: null, groupe_id: null, montant: 1 }]
    assert.deepEqual(depensesGroupeParMois(d, mois), {})
  })
  test('ignore une catégorie hors résultat et un mois non demandé', () => {
    const d = [
      { date: '2026-10-25', categorie: 'retrait_perso', restaurant_id: null, groupe_id: 'g1', montant: 1 },
      { date: '2026-09-25', categorie: 'administratif', restaurant_id: null, groupe_id: 'g1', montant: 1 },
    ]
    assert.deepEqual(depensesGroupeParMois(d, mois), {})
  })
  test('resultatsParRestoMois ne voit pas la dépense de groupe', () => {
    const d = [{ date: '2026-10-25', categorie: 'administratif', restaurant_id: null, groupe_id: 'g1', montant: 500000 }]
    assert.deepEqual(resultatsParRestoMois({ depenses: d, mois }), {})
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node lib/direction.test.mjs`
Expected : FAIL (`depensesGroupeParMois is not a function` / export manquant).

- [ ] **Step 3 : Implémenter** (dans `lib/direction.js`, juste après la fin de `resultatsParRestoMois`)

```js
// Paiements direction d'une fiche de GROUPE (arriérés CNPS, anciens travailleurs
// sans restaurant) : comptent au résultat « tous restaurants » seulement, jamais
// dans un restaurant pris seul (choix du 22/10/2026). Rend { [AAAA-MM]: montant }.
export function depensesGroupeParMois(depenses = [], mois = []) {
  const voulu = new Set(mois)
  const out = {}
  for (const d of depenses) {
    const m = moisDe(d.date)
    if (!voulu.has(m) || d.restaurant_id || !d.groupe_id) continue
    if (!categorieDirection(d.categorie)?.compteDansResultat) continue
    out[m] = (out[m] || 0) + n(d.montant)
  }
  return out
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node lib/direction.test.mjs`
Expected : PASS.

- [ ] **Step 5 : Écran Résultats**

`app/tresorerie-resultats.js` :
- import : `import { depensesGroupeParMois, derniersMois, resultatsParRestoMois } from '../lib/direction'`
- après `const r = useMemo(...)` :
```js
  // Arriérés du groupe payés par la direction : dans le total, dans aucun restaurant.
  const groupeParMois = useMemo(() => (brut ? depensesGroupeParMois(brut.depenses, mois) : {}), [brut, mois])
  const arrieresGroupe = groupeParMois[moisChoisi] || 0
```
- `const total = lignes.reduce((s, l) => s + (l.c?.net || 0), 0)` → `const total = lignes.reduce((s, l) => s + (l.c?.net || 0), 0) - arrieresGroupe`
- `sous` du Hero : remplacer `'Somme des résultats nets des restaurants'` par
  `arrieresGroupe ? 'Restaurants, moins les arriérés du groupe payés par la direction' : 'Somme des résultats nets des restaurants'`
- juste avant `<TitreSection icone="storefront-outline" titre="Par restaurant" ...`, ajouter :
```jsx
              {arrieresGroupe > 0 && (
                <View style={styles.carte}>
                  <Detail point="#7C3AED" label="Arriérés du groupe payés par la direction (CNPS, anciens travailleurs)"
                    valeur={`− ${fmt(arrieresGroupe)}`} />
                </View>
              )}
```
- texte d'aide (paragraphe ~ligne 132), ajouter à la fin : ` Les arriérés d'un groupe (CNPS d'avant octobre 2026, anciens d'un site fermé) payés par la direction ne comptent que dans le total de tous les restaurants.`

- [ ] **Step 6 : Lint + tests**

Run: `npm run lint && for f in lib/*.test.mjs; do node "$f" || exit 1; done`
Expected : 0 erreur, tous PASS.

- [ ] **Step 7 : Commit**

```bash
git add lib/direction.js lib/direction.test.mjs app/tresorerie-resultats.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(resultats): arriérés de groupe payés par la direction au total seulement"
```

---

### Task 5 : Module d'import (logique pure)

**Files:**
- Create: `lib/importDroitsCnps.js`, `lib/importDroitsCnps.test.mjs`

**Interfaces:**
- Entrée commune : `feuilles = { [nomFeuille]: lignes }`, `lignes` = tableaux de cellules **0-indexés** (A = 0), dates déjà converties en `'AAAA-MM-JJ'` par le script.
- Produces :
  - `nomImport(s) → string` (majuscules, accents gardés, ’ → ', espaces simples).
  - `lireDroits(feuilles) → [{ nom, rattachement: { restaurant_id } | { groupe: 'Groupe Samer' }, feuille, depart_le, motif, observation, montant, regle, reste }]` (75 lignes attendues).
  - `lireCnps(lignes) → [{ libelle, date, montant }]` (61 lignes).
  - `csvControle(droits) → string` ; `resumeImport(droits, cnps) → string`.
  - `sqlImport(droits, cnps) → string`.

- [ ] **Step 1 : Tests qui échouent** — `lib/importDroitsCnps.test.mjs`

```js
// Tests de lib/importDroitsCnps.js — import des anciens travailleurs et des arriérés CNPS (22/10/2026).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { csvControle, lireCnps, lireDroits, nomImport, sqlImport } from './importDroitsCnps.js'

const ENTETE = ['N°', 'NOM ET PRENOM', 'DATE de cessation', 'RESTAURANT', 'MONTANT', 'montant réglé', 'MOTIF de Départ', 'OBSERVATION']
const PALM = 'b862dfee-007f-413a-9de0-2c6e83b572ce'
const MAROC = 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'
const YOP = '268695fe-972e-468e-b2b7-4e7f268dec4f'

describe('nomImport', () => {
  test('majuscules, accents gardés, apostrophe droite, espaces simples', () => {
    assert.equal(nomImport(' N’GAZA Oi  N’gaza Noel '), "N'GAZA OI N'GAZA NOEL")
    assert.equal(nomImport('ACHI Amemou Cédric'), 'ACHI AMEMOU CÉDRIC')
  })
})

describe('lireDroits', () => {
  const feuilles = {
    maroc: [ENTETE,
      [4, 'DOH SEBASTIEN', '2024-07-31', 'MAROC', 167770, 100000, 'Démission', 'reclame le reste'],
      [],
      [null, null, 'TOTAL', null, 1219922, 0, 'RESTE à PAYER', 1219922]],
    autres: [ENTETE, [1, 'OGOUDIKPE', '2024-09-30', 'ZONE 4', 17647, null, 'Fin de contrat', 'pas reclamer']],
    Feuil1: [['N°', 'NOM ET PRENOM', 'DATE de cessation', 'RESTAURANT', 'MONTANT', 'montant réglé', 'MOTIF de Départ', 'CONTACT', 'reste'],
      [64, 'TAPE BARRY BATESTI', '2025-06-30', 'PALMERAIE', 328971, 50000, 'licenciement', null, 278971],
      [69, "ETTIEN N'DA", '2025-04-10', 'MAROC', 1000000],
      [73, 'LAGO AUDREY', '2025-07-12', 'AL KAYAN', 129345, null, 'Démission'],
      [1, 'ACHI Amemou Cédric', '2022-03-31', 'MAROC', 65975, 0, 'Démission']],
  }
  const d = lireDroits(feuilles)
  test('réglé lu ligne par ligne, ligne TOTAL ignorée', () => {
    const doh = d.find(x => x.nom === 'DOH SEBASTIEN')
    assert.equal(doh.regle, 100000)
    assert.equal(doh.reste, 67770)
    assert.deepEqual(doh.rattachement, { restaurant_id: MAROC })
    assert.equal(d.filter(x => x.feuille === 'maroc').length, 1)
  })
  test('Zone 4 sur le Groupe Samer', () => {
    assert.deepEqual(d.find(x => x.nom === 'OGOUDIKPE').rattachement, { groupe: 'Groupe Samer' })
  })
  test('Feuil1 : seulement les trois ajouts, avec leur rattachement', () => {
    assert.deepEqual(d.filter(x => x.feuille === 'Feuil1').map(x => x.nom).sort(), ["ETTIEN N'DA", 'LAGO AUDREY', 'TAPE BARRY BATESTI'])
    const tape = d.find(x => x.nom === 'TAPE BARRY BATESTI')
    assert.deepEqual(tape.rattachement, { restaurant_id: PALM })
    assert.equal(tape.reste, 278971)
    assert.equal(tape.observation, 'réclame toujours')
    assert.deepEqual(d.find(x => x.nom === 'LAGO AUDREY').rattachement, { restaurant_id: YOP })
  })
  test('motif mis en forme', () => {
    assert.equal(d.find(x => x.nom === 'TAPE BARRY BATESTI').motif, 'Licenciement')
    assert.equal(d.find(x => x.nom === "ETTIEN N'DA").motif, '')
  })
})

describe('lireCnps', () => {
  const lignes = [['PERIODE', 'COTISATION'],
    ['REDRESSEMENT 2015', 250845], ['2020-06-03', 385864], ['2025-11-01', 570563.5], ['DISA 2024', 232493], ['DISA 2025', null]]
  const c = lireCnps(lignes)
  test('libellés, dates, montants arrondis, ligne vide ignorée', () => {
    assert.deepEqual(c, [
      { libelle: 'Redressement 2015', date: '2015-12-31', montant: 250845 },
      { libelle: 'CNPS juin 2020', date: '2020-06-01', montant: 385864 },
      { libelle: 'CNPS novembre 2025', date: '2025-11-01', montant: 570564 },
      { libelle: 'DISA 2024', date: '2024-12-31', montant: 232493 },
    ])
  })
})

describe('csvControle / sqlImport', () => {
  const droits = [{ nom: "N'GAZA OI", rattachement: { groupe: 'Groupe Samer' }, feuille: 'autres', depart_le: '2023-04-30',
    motif: 'Démission', observation: 'pas de trace', montant: 100, regle: 40, reste: 60 }]
  test('CSV : séparateur ; et apostrophes gardées', () => {
    const csv = csvControle(droits)
    assert.match(csv.split('\n')[0], /^Rattachement;Nom;/)
    assert.match(csv, /Groupe Samer;N'GAZA OI;30\/04\/2023;Démission — pas de trace;100;40;60/)
  })
  test('SQL : transaction, apostrophes doublées, marqueur d\'import', () => {
    const sql = sqlImport(droits, [{ libelle: 'CNPS juin 2020', date: '2020-06-01', montant: 385864 }])
    assert.match(sql, /^BEGIN;/)
    assert.match(sql, /COMMIT;\s*$/)
    assert.match(sql, /'N''GAZA OI'/)
    assert.match(sql, /\[import 22\/10\]/)
    assert.match(sql, /'CNPS juin 2020'/)
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node lib/importDroitsCnps.test.mjs`
Expected : FAIL (`Cannot find module './importDroitsCnps.js'`).

- [ ] **Step 3 : Implémenter** — `lib/importDroitsCnps.js`

```js
// ──────────────────────────────────────────────────────────────────────────────
// Import du 22/10/2026 : droits des anciens travailleurs (« depart par
// restaurant.xlsx ») et arriérés CNPS du Groupe Samer (« DETTE CNPS.xlsx »).
// Spéc : docs/superpowers/specs/2026-10-22-groupes-cnps-anciens-travailleurs-design.md
// Le script scripts/import-cnps-anciens/preparer.mjs lit les fichiers et appelle
// ces fonctions ; le SQL produit passe par inserer_transaction_hors_point (même
// chemin que « Modifier » dans l'app) et se repasse sans doublon.
// Pur : testé par lib/importDroitsCnps.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const MARQUE = '[import 22/10]'

// Onglets par restaurant (version à jour) → rattachement. Feuil2/3/4 = brouillons.
const FEUILLES = {
  palmeraie: { restaurant_id: 'b862dfee-007f-413a-9de0-2c6e83b572ce' },
  angre: { restaurant_id: '2f09688d-a4b9-4b14-8c45-943543953379' },
  maroc: { restaurant_id: 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9' },
  OASIS: { restaurant_id: 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f' },
  lavage: { restaurant_id: '99eb7f7e-baab-4159-872a-34a086374f49' },
  'AL KAYAN': { restaurant_id: '268695fe-972e-468e-b2b7-4e7f268dec4f' },
  koum: { restaurant_id: 'c12f15b9-6149-4b56-be2b-6e82ab447216' },
  autres: { groupe: 'Groupe Samer' },
}

// Absents des onglets par restaurant, ajoutés depuis Feuil1 (choix du 22/10).
// Feuil1 n'a pas d'observation (colonne H = contact).
const AJOUTS_FEUIL1 = {
  'TAPE BARRY BATESTI': { feuille: 'palmeraie', observation: 'réclame toujours' },
  "ETTIEN N'DA": { feuille: 'maroc', observation: '' },
  'LAGO AUDREY': { feuille: 'AL KAYAN', observation: '' },
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

const entier = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)
const texte = v => String(v ?? '').replace(/\s+/g, ' ').trim()

export function nomImport(s) {
  return texte(s).replace(/[’‘`]/g, "'").toLocaleUpperCase('fr-FR')
}

const motifPropre = m => {
  const t = texte(m).toLocaleLowerCase('fr-FR')
  return t ? t[0].toLocaleUpperCase('fr-FR') + t.slice(1) : ''
}

function ligneDroit(feuille, rattachement, l, observation) {
  const montant = entier(l[4])
  const regle = entier(l[5])
  return {
    nom: nomImport(l[1]), rattachement, feuille, depart_le: l[2] || null,
    motif: motifPropre(l[6]), observation, montant, regle, reste: montant - regle,
  }
}

const estLigne = l => Array.isArray(l) && typeof l[0] === 'number' && texte(l[1])

export function lireDroits(feuilles = {}) {
  const out = []
  for (const [feuille, rattachement] of Object.entries(FEUILLES)) {
    for (const l of feuilles[feuille] || []) {
      if (estLigne(l)) out.push(ligneDroit(feuille, rattachement, l, texte(l[7])))
    }
  }
  for (const l of feuilles.Feuil1 || []) {
    if (!estLigne(l)) continue
    const ajout = AJOUTS_FEUIL1[nomImport(l[1])]
    if (ajout) out.push(ligneDroit('Feuil1', FEUILLES[ajout.feuille], l, ajout.observation))
  }
  return out
}

export function lireCnps(lignes = []) {
  const out = []
  for (const l of lignes) {
    const [periode, montant] = l || []
    if (typeof montant !== 'number') continue
    const p = texte(periode)
    const iso = /^(\d{4})-(\d{2})-\d{2}$/.exec(p)
    const annuel = /^(REDRESSEMENT|DISA)\s+(\d{4})$/i.exec(p)
    if (iso) out.push({ libelle: `CNPS ${MOIS[Number(iso[2]) - 1]} ${iso[1]}`, date: `${iso[1]}-${iso[2]}-01`, montant: Math.round(montant) })
    else if (annuel) {
      const nature = annuel[1].toUpperCase() === 'DISA' ? 'DISA' : 'Redressement'
      out.push({ libelle: `${nature} ${annuel[2]}`, date: `${annuel[2]}-12-31`, montant: Math.round(montant) })
    } else throw new Error(`Période CNPS non reconnue : « ${p} »`)
  }
  return out
}

const NOMS_RESTOS = {
  'b862dfee-007f-413a-9de0-2c6e83b572ce': 'Samer Palmeraie',
  '2f09688d-a4b9-4b14-8c45-943543953379': 'Samer Angré 7E',
  'f4550ccf-fa52-4e56-b4bb-9cea4a155df9': 'Samer Maroc',
  'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f': 'Samer Oasis',
  '99eb7f7e-baab-4159-872a-34a086374f49': 'Samer Lavage',
  '268695fe-972e-468e-b2b7-4e7f268dec4f': 'Al Kayan Yop',
  'c12f15b9-6149-4b56-be2b-6e82ab447216': 'Al Kayan KMS',
}
export const nomRattachementImport = r => (r.groupe ? r.groupe : NOMS_RESTOS[r.restaurant_id] || r.restaurant_id)

const dateFR = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
export const motifComplet = d => [d.motif, d.observation].filter(Boolean).join(' — ')

export function csvControle(droits = []) {
  const lignes = [['Rattachement', 'Nom', 'Départ', 'Motif', 'Montant', 'Déjà payé', 'Reste', 'Onglet'].join(';')]
  const tries = [...droits].sort((a, b) =>
    nomRattachementImport(a.rattachement).localeCompare(nomRattachementImport(b.rattachement)) || a.nom.localeCompare(b.nom))
  for (const d of tries) {
    lignes.push([nomRattachementImport(d.rattachement), d.nom, dateFR(d.depart_le), motifComplet(d),
      d.montant, d.regle, d.reste, d.feuille].map(v => String(v).replace(/;/g, ',')).join(';'))
  }
  return lignes.join('\n') + '\n'
}

const fr = v => Number(v).toLocaleString('fr-FR').replace(/ | /g, ' ')

export function resumeImport(droits = [], cnps = []) {
  const par = {}
  for (const d of droits) {
    const k = nomRattachementImport(d.rattachement)
    const g = (par[k] ||= { n: 0, montant: 0, regle: 0, reste: 0 })
    g.n += 1; g.montant += d.montant; g.regle += d.regle; g.reste += d.reste
  }
  const out = ['ANCIENS TRAVAILLEURS']
  let tot = { n: 0, montant: 0, regle: 0, reste: 0 }
  for (const [k, g] of Object.entries(par).sort()) {
    out.push(`${k.padEnd(18)} ${String(g.n).padStart(3)} pers.  dû ${fr(g.montant).padStart(11)}  payé ${fr(g.regle).padStart(9)}  reste ${fr(g.reste).padStart(11)}`)
    tot = { n: tot.n + g.n, montant: tot.montant + g.montant, regle: tot.regle + g.regle, reste: tot.reste + g.reste }
  }
  out.push(`${'TOTAL'.padEnd(18)} ${String(tot.n).padStart(3)} pers.  dû ${fr(tot.montant).padStart(11)}  payé ${fr(tot.regle).padStart(9)}  reste ${fr(tot.reste).padStart(11)}`)
  const parAn = {}
  for (const c of cnps) parAn[c.libelle.replace(/^CNPS \S+ /, '')] = (parAn[c.libelle.replace(/^CNPS \S+ /, '')] || 0) + c.montant
  out.push('', 'CNPS GROUPE SAMER (arriérés)')
  for (const [k, v] of Object.entries(parAn)) out.push(`${k.padEnd(18)} ${fr(v).padStart(11)}`)
  out.push(`${'TOTAL'.padEnd(18)} ${fr(cnps.reduce((s, c) => s + c.montant, 0)).padStart(11)}  (${cnps.length} lignes)`)
  return out.join('\n') + '\n'
}

const q = v => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

// SQL d'import : une transaction ; fonctions pg_temp (disparaissent à la fin de
// la session). Se repasse sans doublon : une fiche existante (même nom en
// majuscules, même restaurant ou groupe, avec date de départ) est corrigée à la
// différence près ; une ligne CNPS déjà posée (même raison) est sautée.
export function sqlImport(droits = [], cnps = []) {
  const l = []
  l.push('BEGIN;', '')
  l.push(`CREATE FUNCTION pg_temp.ecrire(p_f uuid, p_date date, p_delta numeric, p_raison text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_tx uuid;
BEGIN
  IF p_delta = 0 THEN RETURN; END IF;
  v_tx := inserer_transaction_hors_point(p_f, p_date, greatest(p_delta, 0), greatest(-p_delta, 0), 'manager', 'ajustement_manager', 'Import 22/10');
  UPDATE transactions_fournisseurs SET facture_correction_raison = p_raison WHERE id = v_tx;
END $$;`, '')
  l.push(`CREATE FUNCTION pg_temp.groupe(p_nom text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM groupes WHERE nom = p_nom;
  IF v IS NULL THEN RAISE EXCEPTION 'Groupe introuvable : % (passez supabase_groupes_restaurants.sql)', p_nom; END IF;
  RETURN v;
END $$;`, '')
  l.push(`CREATE FUNCTION pg_temp.droit(p_nom text, p_resto uuid, p_groupe text, p_depart date, p_motif text, p_montant bigint, p_regle bigint)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_g uuid; v_id uuid; v_du numeric; v_delta numeric;
BEGIN
  IF p_groupe IS NOT NULL THEN v_g := pg_temp.groupe(p_groupe); END IF;
  SELECT id INTO v_id FROM fournisseurs
   WHERE depart_le IS NOT NULL AND upper(trim(nom)) = upper(p_nom)
     AND restaurant_id IS NOT DISTINCT FROM p_resto AND groupe_id IS NOT DISTINCT FROM v_g
   LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO fournisseurs (nom, type, restaurant_id, groupe_id, actif, facture_mensuelle, depart_le, depart_motif)
    VALUES (p_nom, 'administratif', p_resto, v_g, true, 0, p_depart, nullif(p_motif, '')) RETURNING id INTO v_id;
    IF p_resto IS NOT NULL THEN
      INSERT INTO fournisseurs_restaurants (fournisseur_id, restaurant_id, credit_actuel) VALUES (v_id, p_resto, 0)
      ON CONFLICT (fournisseur_id, restaurant_id) DO NOTHING;
    END IF;
    PERFORM pg_temp.ecrire(v_id, current_date, p_montant, 'Droits à la sortie ${MARQUE}');
    PERFORM pg_temp.ecrire(v_id, current_date, -p_regle, 'Déjà payé avant l''app ${MARQUE}');
    RETURN 'créé';
  END IF;
  UPDATE fournisseurs SET depart_le = p_depart, depart_motif = nullif(p_motif, '') WHERE id = v_id;
  SELECT coalesce(sum(coalesce(facture, 0)), 0)
       - coalesce(sum(CASE WHEN source = 'ajustement_manager' THEN coalesce(paye, 0) ELSE 0 END), 0)
    INTO v_du FROM transactions_fournisseurs WHERE fournisseur_id = v_id;
  v_delta := (p_montant - p_regle) - v_du;
  PERFORM pg_temp.ecrire(v_id, current_date, v_delta, 'Montant dû corrigé selon le fichier ${MARQUE}');
  RETURN CASE WHEN v_delta = 0 THEN 'inchangé' ELSE 'corrigé' END;
END $$;`, '')

  l.push('CREATE TEMP TABLE resultat_import (nom text, action text) ON COMMIT DROP;', '')
  l.push('-- Anciens travailleurs')
  for (const d of droits) {
    const r = d.rattachement
    l.push(`INSERT INTO resultat_import SELECT ${q(d.nom)}, pg_temp.droit(${q(d.nom)}, ${r.restaurant_id ? `${q(r.restaurant_id)}::uuid` : 'NULL'}, ${q(r.groupe || null)}, ${q(d.depart_le)}::date, ${q(motifComplet(d))}, ${d.montant}, ${d.regle});`)
  }

  l.push('', '-- Fiches « CNPS — arriérés » des deux groupes, puis les lignes du Groupe Samer')
  l.push(`DO $$
DECLARE v_s uuid; v_a uuid; v_f uuid;
BEGIN
  v_s := pg_temp.groupe('Groupe Samer');
  v_a := pg_temp.groupe('Groupe Al Kayan');
  FOREACH v_f IN ARRAY ARRAY[v_s, v_a] LOOP
    IF NOT EXISTS (SELECT 1 FROM fournisseurs WHERE groupe_id = v_f AND nom = 'CNPS — arriérés') THEN
      INSERT INTO fournisseurs (nom, type, restaurant_id, groupe_id, actif, facture_mensuelle)
      VALUES ('CNPS — arriérés', 'administratif', NULL, v_f, true, 0);
    END IF;
  END LOOP;
END $$;`)
  l.push(`CREATE FUNCTION pg_temp.cnps(p_date date, p_montant bigint, p_raison text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_f uuid;
BEGIN
  SELECT id INTO v_f FROM fournisseurs WHERE groupe_id = pg_temp.groupe('Groupe Samer') AND nom = 'CNPS — arriérés';
  IF EXISTS (SELECT 1 FROM transactions_fournisseurs WHERE fournisseur_id = v_f AND facture_correction_raison = p_raison) THEN RETURN; END IF;
  PERFORM pg_temp.ecrire(v_f, p_date, p_montant, p_raison);
END $$;`)
  for (const c of cnps) l.push(`SELECT pg_temp.cnps(${q(c.date)}::date, ${c.montant}, ${q(`${c.libelle} ${MARQUE}`)});`)

  l.push('', '-- Anciennes fiches globales « ANCIEN TRAVAILLEURS » / « Salaire ancien » : remise à 0 tracée puis désactivation')
  l.push(`DO $$
DECLARE f record; v_reste numeric;
BEGIN
  FOR f IN SELECT id, credit_actuel FROM fournisseurs
            WHERE actif AND depart_le IS NULL
              AND (lower(nom) LIKE '%ancien travailleur%' OR lower(nom) LIKE '%salaire ancien%') LOOP
    SELECT t.reste INTO v_reste FROM transactions_fournisseurs t WHERE t.fournisseur_id = f.id
     ORDER BY coalesce(t.date_point, t.created_at::date) DESC,
              rang_transaction_fournisseur(t.point_id, t.saisi_par) DESC, t.created_at DESC
     LIMIT 1;
    IF NOT FOUND THEN v_reste := coalesce(f.credit_actuel, 0); END IF;
    PERFORM pg_temp.ecrire(f.id, current_date, -coalesce(v_reste, 0), 'Remplacée par une fiche par ancien travailleur ${MARQUE}');
    UPDATE fournisseurs SET actif = false WHERE id = f.id;
  END LOOP;
END $$;`)

  l.push('', 'SELECT action, count(*) FROM resultat_import GROUP BY action ORDER BY action;')
  l.push('', 'COMMIT;')
  return l.join('\n') + '\n'
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node lib/importDroitsCnps.test.mjs`
Expected : PASS. (Si `nomImport('ACHI Amemou Cédric')` ne donne pas `CÉDRIC`, vérifier `toLocaleUpperCase('fr-FR')`.)

- [ ] **Step 5 : Commit**

```bash
git add lib/importDroitsCnps.js lib/importDroitsCnps.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(import): lecture des anciens travailleurs et des arriérés CNPS"
```

---

### Task 6 : Script de préparation et fichier de contrôle

**Files:**
- Create: `scripts/import-cnps-anciens/preparer.mjs`, `scripts/import-cnps-anciens/.gitignore`

**Interfaces:**
- Consumes : `lireDroits`, `lireCnps`, `csvControle`, `resumeImport`, `sqlImport` (Task 5).
- Usage : `node scripts/import-cnps-anciens/preparer.mjs "<depart par restaurant.xlsx>" "<DETTE CNPS.xlsx>"` → `out/controle.csv`, `out/resume.txt`, `out/import.sql`.

- [ ] **Step 1 : `.gitignore`**

```
# Noms et montants des anciens travailleurs : jamais dans git.
out/
```

- [ ] **Step 2 : Script**

```js
// Préparation de l'import du 22/10/2026 (anciens travailleurs + arriérés CNPS).
// Usage : node scripts/import-cnps-anciens/preparer.mjs "<depart par restaurant.xlsx>" "<DETTE CNPS.xlsx>"
// Écrit out/controle.csv (à faire valider), out/resume.txt et out/import.sql.
// N'écrit RIEN en base : import.sql se passe ensuite dans Supabase.
//
// Le fichier des départs pèse 144 Mo (mises en forme sur un million de lignes) :
// lecture en flux avec exceljs, ~50 s. NE JAMAIS sortir d'une boucle de
// lignes avant la fin (break) : la feuille suivante est alors perdue (« angre »
// disparaissait lors de l'essai du 22/10).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

import { csvControle, lireCnps, lireDroits, resumeImport, sqlImport } from '../../lib/importDroitsCnps.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const [fichierDeparts, fichierCnps] = process.argv.slice(2)
if (!fichierDeparts || !fichierCnps) {
  console.error('Usage : node scripts/import-cnps-anciens/preparer.mjs "<depart par restaurant.xlsx>" "<DETTE CNPS.xlsx>"')
  process.exit(1)
}

const valeur = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (v && typeof v === 'object' && 'result' in v) return valeur(v.result)   // formule
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map(t => t.text).join('')
  return v ?? null
}

async function lireClasseur(fichier) {
  const feuilles = {}
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(fichier, {
    sharedStrings: 'cache', worksheets: 'emit', styles: 'ignore', hyperlinks: 'ignore',
  })
  for await (const ws of reader) {
    const lignes = []
    for await (const row of ws) {
      const cellules = (row.values || []).slice(1).map(valeur)   // values est 1-indexé
      if (cellules.some(v => v !== null && v !== '')) lignes.push(cellules)
    }
    feuilles[ws.name] = lignes
  }
  return feuilles
}

const departs = await lireClasseur(fichierDeparts)
const cnpsFeuilles = await lireClasseur(fichierCnps)
const attendues = ['Feuil1', 'autres', 'palmeraie', 'AL KAYAN', 'angre', 'koum', 'lavage', 'maroc', 'OASIS']
const manquantes = attendues.filter(f => !departs[f])
if (manquantes.length) { console.error(`Feuilles introuvables : ${manquantes.join(', ')}`); process.exit(1) }
if (!cnpsFeuilles.SAMER) { console.error('Feuille SAMER introuvable dans le fichier CNPS'); process.exit(1) }

const droits = lireDroits(departs)
const cnps = lireCnps(cnpsFeuilles.SAMER.slice(1))

fs.mkdirSync(path.join(DIR, 'out'), { recursive: true })
fs.writeFileSync(path.join(DIR, 'out', 'controle.csv'), '﻿' + csvControle(droits))   // BOM : accents justes dans Excel
const resume = resumeImport(droits, cnps)
fs.writeFileSync(path.join(DIR, 'out', 'resume.txt'), resume)
fs.writeFileSync(path.join(DIR, 'out', 'import.sql'), sqlImport(droits, cnps))
console.log(resume)
console.log(`Écrit : ${path.join(DIR, 'out')}/controle.csv, resume.txt, import.sql — rien n'a été écrit en base.`)
```

- [ ] **Step 3 : Lancer sur les vrais fichiers**

Run (timeout 10 min) : `node scripts/import-cnps-anciens/preparer.mjs ~/Downloads/"depart par restaurant.xlsx" ~/Downloads/"DETTE CNPS.xlsx"`
Expected (dans `resume.txt`) :

| Rattachement | pers. | reste |
|---|---|---|
| Al Kayan KMS | 7 | 1 105 702 |
| Al Kayan Yop | 6 | 660 662 |
| Groupe Samer | 2 | 35 294 |
| Samer Angré 7E | 15 | 1 666 527 |
| Samer Lavage | 7 | 617 937 |
| Samer Maroc | 13 | 2 119 922 |
| Samer Oasis | 6 | 536 527 |
| Samer Palmeraie | 19 | 1 948 810 |
| **TOTAL** | **75** | **8 691 381** (dû 9 361 381, payé 670 000) |

CNPS : 61 lignes, total **43 440 750** (le fichier affiche 43 440 751 : les centimes des lignes 2025 sont arrondis au franc, écart de 1 F).
Si un chiffre diffère : s'arrêter et comprendre avant d'aller plus loin.

- [ ] **Step 4 : Commit**

```bash
git add scripts/import-cnps-anciens/preparer.mjs scripts/import-cnps-anciens/.gitignore
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(import): script de préparation (contrôle + SQL) anciens travailleurs et CNPS"
```

- [ ] **Step 5 : Point d'arrêt — validation par l'utilisateur**

Montrer `resume.txt` en clair et donner le chemin complet de `out/controle.csv`. AskUserQuestion : « Le fichier de contrôle est juste ? » — « Oui, on importe » / « Non, je corrige (Other) ». Ne rien écrire en base avant le « Oui ».

---

### Task 7 : Import en base et vérification

**Files:** aucun (exécution de `scripts/import-cnps-anciens/out/import.sql`).

**Interfaces:**
- Consumes : migration (Task 1) passée, `out/import.sql` (Task 6) validé.

- [ ] **Step 1 : Accord explicite**

AskUserQuestion : « Je passe import.sql moi-même (MCP Supabase), ou tu le passes dans le SQL Editor ? » — « Passe-le toi-même » / « Je le passe moi-même ». Sans réponse « Passe-le », ne pas exécuter.

- [ ] **Step 2 : Exécuter**

Avant : compter les écritures d'import (doit donner 0) :
```sql
select count(*) from transactions_fournisseurs where facture_correction_raison like '%[import 22/10]%';
```
Puis contenu de `out/import.sql` en un seul appel `execute_sql` (projet `wlwotzxnzowbkbfcpnyi`) — ou par l'utilisateur dans le SQL Editor (qui affiche le décompte avant COMMIT : `corrigé | 2` (BAMBA, BOUDA), `créé | 72`, `inchangé | 1` (YANKINE)).
Expected : aucune erreur. L'outil MCP peut ne renvoyer que le résultat du COMMIT : le contrôle se fait au Step 3.

- [ ] **Step 3 : Vérifier (lecture seule)**

```sql
-- Droits par rattachement
select coalesce(trim(r.nom), g.nom) as rattachement, count(*) as fiches, sum(f.credit_actuel) as reste
  from fournisseurs f left join restaurants r on r.id = f.restaurant_id left join groupes g on g.id = f.groupe_id
 where f.depart_le is not null group by 1 order by 1;
-- CNPS
select g.nom, f.nom, f.credit_actuel, (select count(*) from transactions_fournisseurs t where t.fournisseur_id = f.id) as lignes
  from fournisseurs f join groupes g on g.id = f.groupe_id where f.nom = 'CNPS — arriérés';
-- Anciennes fiches globales
select trim(r.nom), f.nom, f.actif, f.credit_actuel from fournisseurs f left join restaurants r on r.id = f.restaurant_id
 where f.depart_le is null and (lower(f.nom) like '%ancien travailleur%' or lower(f.nom) like '%salaire ancien%');
```
Expected : restes par rattachement = tableau de la Task 6 ; `Groupe Samer | CNPS — arriérés | 43440750 | 61` ; `Groupe Al Kayan | CNPS — arriérés | 0 | 0` ; anciennes fiches toutes `actif = false`, `credit_actuel = 0`.
Si `credit_actuel` d'un droit ≠ reste attendu : le déclencheur `trg_fournisseurs_droit_solde` ou une transaction antérieure peut l'expliquer — comparer avec `transactions_fournisseurs` de la fiche avant toute correction.

- [ ] **Step 4 : Rejouer pour prouver l'idempotence**

Noter le nombre d'écritures `[import 22/10]` (requête du Step 2), ré-exécuter le même `import.sql`, recompter.
Expected : même nombre d'écritures (aucune nouvelle), toujours 61 lignes CNPS, totaux du Step 3 identiques.

---

### Task 8 : Clôture

- [ ] **Step 1 : Lint + tests complets**

Run: `npm run lint && for f in lib/*.test.mjs; do node "$f" || exit 1; done`
Expected : 0 erreur, 0 échec.

- [ ] **Step 2 : Graphe**

Run: `graphify update .`

- [ ] **Step 3 : Push**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```
(Pas de Vercel / EAS : publication seulement quand l'utilisateur le demande.)

- [ ] **Step 4 : Mémoire**

Mettre à jour `cnps-par-marque.md` (groupes créés, fiche « CNPS — arriérés », import fait, rien publié) et `droits-anciens-travailleurs.md` (75 fiches importées le 22/10, anciennes fiches globales remplacées). Ligne d'index correspondante dans `MEMORY.md`.

- [ ] **Step 5 : Résumé en français simple** pour l'utilisateur (ce qui change à l'écran, ce qui reste à faire : publier ; saisir la dette CNPS Al Kayan ; passer les fiches CNPS des restaurants en administratif avec échéance mensuelle dès octobre 2026).
