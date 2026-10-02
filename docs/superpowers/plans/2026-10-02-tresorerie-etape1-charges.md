# Trésorerie étape 1 — Charges post-payées et retards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sept charges à échéance post-payées (loyer, salaires, CNPS, impôts, ITS, TEE, bail) avec classement automatique à payer → dette récente → dette, autres charges « à payer » dans les dépenses direction, et résultat net au mois de la date limite.

**Architecture:** Tout reste dans `tresorerie_dus` (une ligne par charge, paiements partiels dans `tresorerie_paiements`). Le classement est calculé en pur JS (`classerDu`) à partir des échéances et des paiements, jamais stocké. Deux nouvelles tables de réglage (`tresorerie_echeances`, `tresorerie_charges_fixes`) alimentent la création automatique à l'ouverture de la Trésorerie.

**Tech Stack:** Expo / React Native web, Supabase (PostgREST + SQL Editor), tests `node:test` (`lib/*.test.mjs`).

**Spec :** `docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md` (section « Étape 1 »).

## Global Constraints

- Interface et messages en français courant, montants en FCFA entiers (`bigint`), jamais de float.
- Dates en chaînes ISO `AAAA-MM-JJ`, sans fuseau (helpers de `lib/tresorerie.js`).
- Logique pure dans `lib/*.js` sans import React Native ; tests `node lib/<x>.test.mjs` ; un import entre fichiers `lib/` testés porte l'extension `.js`.
- Lectures Supabase paginées (`toutesLesLignes`) : la base coupe à 1 000 lignes en silence.
- Index unique partiel : jamais d'`upsert` avec `onConflict` sur `(categorie, restaurant_id, mois)` → `insert` des seules lignes absentes.
- Écritures journalisées via `journaliser()`, sans bloquer l'action.
- Migration SQL idempotente, à passer dans le SQL Editor ; l'app doit rester utilisable tant qu'elle n'est pas passée (réglages vides, message clair à l'écriture).
- Avant commit : `npm run lint` 0 erreur et `for f in lib/*.test.mjs; do node "$f"; done` 0 échec. Pas de publication (Vercel / EAS) dans ce plan.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase_tresorerie_charges.sql` (créé) | catégories, colonnes, index, tables de réglage, décalage des échéances de loyer |
| `lib/tresorerie.js` (modifié) | catégories, échéance post-payée, création auto, classement, mises à jour, droits |
| `lib/tresorerie.test.mjs` (modifié) | tests de ce qui précède |
| `lib/chargesMois.js` (modifié) | résultat net au mois de la date limite ; tableaux de bord avec les nouvelles catégories |
| `lib/chargesMois.test.mjs` (modifié) | tests correspondants |
| `lib/direction.js` (modifié) | catégories proposées pour une charge à payer (`divers` en plus) |
| `lib/tresorerieDb.js` (modifié) | chargement des réglages, création auto, écritures des réglages, passage en dette |
| `components/tresorerie/du.js` (créé) | `couleursStatut`, `Badge`, `titreDu`, `FeuilleDetail`, `FeuillePaiement` (sortis de l'écran À payer, réutilisés par Dépenses direction) |
| `components/tresorerie/reglagesCharges.js` (créé) | `FeuilleEcheance`, `FeuilleMontantsFixes`, `FeuilleBaux` |
| `app/tresorerie-a-payer.js` (modifié) | onglets, listes classées, réglages |
| `app/tresorerie-direction.js` (modifié) | section « À payer » des autres charges |
| `app/tresorerie.js` (modifié) | libellés, redirection RH, droits |
| `app/tresorerie-resultats.js` (modifié) | texte de la règle |

---

### Task 1: Migration SQL

**Files:**
- Create: `supabase_tresorerie_charges.sql`

**Interfaces:**
- Produces: `tresorerie_dus.categorie` ∈ {loyer, salaire, cnps, impot, its, tee, bail, autre, admin, dette} ; colonnes `categorie_direction text`, `en_dette_depuis date` ; tables `tresorerie_echeances(categorie PK, jour, updated_at)` et `tresorerie_charges_fixes(categorie, restaurant_id, montant, mois_depart, bail_mois, bail_jour, actif, updated_at, PK(categorie, restaurant_id))`.

- [ ] **Step 1: Écrire le fichier**

```sql
-- =====================================================================
--  TRÉSORERIE — étape 1 de la nouvelle trésorerie : charges post-payées.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS les migrations
--  supabase_tresorerie*.sql existantes. Idempotent. Montants en FCFA entiers.
--  Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
-- =====================================================================

ALTER TABLE tresorerie_dus DROP CONSTRAINT IF EXISTS tresorerie_dus_categorie_check;
ALTER TABLE tresorerie_dus ADD CONSTRAINT tresorerie_dus_categorie_check
  CHECK (categorie IN ('loyer','salaire','cnps','impot','its','tee','bail','autre','admin','dette'));

ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS categorie_direction text;
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS en_dette_depuis date;

ALTER TABLE tresorerie_dus DROP CONSTRAINT IF EXISTS du_mensuel_complet;
ALTER TABLE tresorerie_dus ADD CONSTRAINT du_mensuel_complet CHECK (
  categorie NOT IN ('loyer','salaire','cnps','impot','its','tee','bail')
  OR (restaurant_id IS NOT NULL AND mois IS NOT NULL)
);

DROP INDEX IF EXISTS uniq_treso_du_mensuel;
CREATE UNIQUE INDEX uniq_treso_du_mensuel ON tresorerie_dus (categorie, restaurant_id, mois)
  WHERE categorie IN ('loyer','salaire','cnps','impot','its','tee','bail');

CREATE TABLE IF NOT EXISTS tresorerie_echeances (
  categorie  text PRIMARY KEY CHECK (categorie IN ('salaire','cnps','impot','its','tee')),
  jour       int  NOT NULL CHECK (jour BETWEEN 1 AND 31),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tresorerie_echeances (categorie, jour)
VALUES ('salaire', 10), ('cnps', 15), ('impot', 15), ('its', 15), ('tee', 15)
ON CONFLICT (categorie) DO NOTHING;

CREATE TABLE IF NOT EXISTS tresorerie_charges_fixes (
  categorie     text NOT NULL CHECK (categorie IN ('impot','its','tee','bail')),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  montant       bigint NOT NULL CHECK (montant > 0),
  mois_depart   date NOT NULL CHECK (extract(day FROM mois_depart) = 1),
  bail_mois     int CHECK (bail_mois BETWEEN 1 AND 12),
  bail_jour     int CHECK (bail_jour BETWEEN 1 AND 31),
  actif         boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (categorie, restaurant_id),
  CONSTRAINT bail_date_complete CHECK (categorie <> 'bail' OR (bail_mois IS NOT NULL AND bail_jour IS NOT NULL))
);

-- Post-payé : un loyer créé avec son échéance dans le mois consommé passe au
-- mois suivant (jour du restaurant, borné à la fin du mois). Idempotent : une
-- échéance déjà au mois suivant n'est plus touchée.
UPDATE tresorerie_dus d SET echeance = make_date(
  extract(year  FROM d.mois + interval '1 month')::int,
  extract(month FROM d.mois + interval '1 month')::int,
  least(l.jour_echeance,
        extract(day FROM date_trunc('month', d.mois + interval '1 month') + interval '1 month - 1 day')::int)
)
FROM tresorerie_loyers l
WHERE d.categorie = 'loyer' AND d.restaurant_id = l.restaurant_id
  AND d.echeance IS NOT NULL
  AND date_trunc('month', d.echeance) = date_trunc('month', d.mois);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tresorerie_echeances','tresorerie_charges_fixes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
```

- [ ] **Step 2: Valider la syntaxe sans rien garder** — exécuter le fichier encadré de `BEGIN; … ROLLBACK;` (MCP `execute_sql`). Attendu : aucune erreur.

- [ ] **Step 3: Commit** — `git add supabase_tresorerie_charges.sql && git commit -m "feat(tresorerie): migration des charges post-payées"`

---

### Task 2: Catégories, échéance post-payée, création automatique

**Files:**
- Modify: `lib/tresorerie.js` (en-tête des constantes, section Loyers)
- Test: `lib/tresorerie.test.mjs`

**Interfaces:**
- Produces:
  - `CATEGORIES_SERIE = ['loyer','salaire','cnps','impot','its','tee','bail']`
  - `CATEGORIES_JOUR_COMMUN = ['salaire','cnps','impot','its','tee']`
  - `CATEGORIES_MONTANT_FIXE = ['impot','its','tee']`
  - `JOURS_ECHEANCE_DEFAUT = { salaire: 10, cnps: 15, impot: 15, its: 15, tee: 15 }`
  - `CATEGORIES_DU`, `LIBELLES_CATEGORIE` (+ impot 'Impôts', its 'ITS', tee 'TEE', bail 'Contrats de bail', autre 'Autres charges'), `CATEGORIES_MENSUELLES = CATEGORIES_SERIE`
  - `echeancePostPayee(moisIso, jour) → 'AAAA-MM-JJ'` (jour du mois suivant, borné)
  - `jourCommun(echeances, categorie) → number`
  - `moisLoyersACreer(loyers, dus, moisCourant)` : échéance post-payée
  - `chargesFixesACreer(fixes, echeances, dus, moisCourant) → du[]`
  - `bailsACreer(fixe, moisCourant) → du[]`

- [ ] **Step 1: Tests qui échouent** (ajouter à `lib/tresorerie.test.mjs`, et changer les échéances attendues du test « crée les mois manquants » : `'2026-10-05'` et `'2026-11-05'` ; celui de février : `moisLoyersACreer(loyers, [], '2026-01-01')[0].echeance === '2026-02-28'` avec `mois_depart: '2026-01-01'`, jour 31)

```js
describe('échéances post-payées', () => {
  test('la charge de septembre est due au jour limite d\'octobre', () => {
    assert.equal(echeancePostPayee('2026-09-01', 5), '2026-10-05')
  })
  test('un jour 31 devient le dernier jour d\'un mois court', () => {
    assert.equal(echeancePostPayee('2026-01-01', 31), '2026-02-28')
  })
  test('décembre → janvier de l\'année suivante', () => {
    assert.equal(echeancePostPayee('2026-12-01', 10), '2027-01-10')
  })
  test('jour commun : réglage en base, sinon valeur par défaut', () => {
    assert.equal(jourCommun([{ categorie: 'cnps', jour: 20 }], 'cnps'), 20)
    assert.equal(jourCommun([], 'salaire'), 10)
  })
})

describe('création des montants fixes et des baux', () => {
  const fixes = [
    { categorie: 'its', restaurant_id: 'r', montant: 180000, mois_depart: '2026-09-01', actif: true },
    { categorie: 'tee', restaurant_id: 'r', montant: 90000, mois_depart: '2026-10-01', actif: false },
  ]
  test('ITS : un mois par ligne, échéance au jour commun du mois suivant, mois existants écartés', () => {
    const existants = [{ categorie: 'its', restaurant_id: 'r', mois: '2026-09-01' }]
    assert.deepEqual(chargesFixesACreer(fixes, [{ categorie: 'its', jour: 15 }], existants, '2026-10-01'), [
      { categorie: 'its', restaurant_id: 'r', mois: '2026-10-01', montant_du: 180000, echeance: '2026-11-15' },
    ])
  })
  test('bail : créé à partir du 1er du mois qui précède sa date limite', () => {
    const bail = { categorie: 'bail', restaurant_id: 'r', montant: 2400000, mois_depart: '2026-10-01', bail_mois: 11, bail_jour: 20, actif: true }
    assert.deepEqual(bailsACreer(bail, '2026-09-01'), [])
    assert.deepEqual(bailsACreer(bail, '2026-10-01'), [
      { categorie: 'bail', restaurant_id: 'r', mois: '2026-11-01', montant_du: 2400000, echeance: '2026-11-20' },
    ])
  })
  test('bail dont la date de l\'année est déjà passée au réglage : l\'année suivante', () => {
    const bail = { categorie: 'bail', restaurant_id: 'r', montant: 1, mois_depart: '2026-10-01', bail_mois: 3, bail_jour: 15, actif: true }
    assert.deepEqual(bailsACreer(bail, '2027-01-01'), [])
    assert.equal(bailsACreer(bail, '2027-02-01')[0].echeance, '2027-03-15')
  })
})
```

Mettre à jour l'import du test : `echeancePostPayee, jourCommun, chargesFixesACreer, bailsACreer`.

- [ ] **Step 2: Lancer** `node lib/tresorerie.test.mjs` — attendu : échecs (fonctions absentes, échéances de loyer dans le mois).

- [ ] **Step 3: Implémenter** dans `lib/tresorerie.js`

```js
export const CATEGORIES_SERIE = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail']
export const CATEGORIES_JOUR_COMMUN = ['salaire', 'cnps', 'impot', 'its', 'tee']
export const CATEGORIES_MONTANT_FIXE = ['impot', 'its', 'tee']
export const JOURS_ECHEANCE_DEFAUT = { salaire: 10, cnps: 15, impot: 15, its: 15, tee: 15 }
export const CATEGORIES_DU = [...CATEGORIES_SERIE, 'autre', 'admin', 'dette']
export const LIBELLES_CATEGORIE = {
  loyer: 'Loyers', salaire: 'Salaires', cnps: 'CNPS', impot: 'Impôts', its: 'ITS', tee: 'TEE',
  bail: 'Contrats de bail', autre: 'Autres charges', admin: 'Admin', dette: 'Dettes',
}
export const CATEGORIES_MENSUELLES = CATEGORIES_SERIE

// Post-payé : la charge du mois M est due au jour limite du mois M+1.
export function echeancePostPayee(moisIso, jour) {
  return jourDuMois(decalerMois(premierDuMois(moisIso), 1), jour)
}

export function jourCommun(echeances = [], categorie) {
  const l = (echeances || []).find(e => e.categorie === categorie)
  return l ? n(l.jour) : JOURS_ECHEANCE_DEFAUT[categorie]
}
```

Dans `moisLoyersACreer` : `echeance: echeancePostPayee(mois, l.jour_echeance)`. Dans `planReglageLoyer` : `const echeance = echeancePostPayee(mois, jourEcheance)`.

```js
// Contrat de bail : une ligne par an, créée dès le 1er du mois qui précède sa
// date limite. Les années dont la date tombe avant le mois de départ sont ignorées.
export function bailsACreer(f, moisCourant) {
  if (!f?.actif || !f.mois_depart || !f.bail_mois || !f.bail_jour) return []
  const out = []
  const depart = premierDuMois(f.mois_depart)
  for (let an = Number(depart.slice(0, 4)); an <= Number(moisCourant.slice(0, 4)) + 1; an++) {
    const moisEch = `${an}-${String(f.bail_mois).padStart(2, '0')}-01`
    if (moisEch < depart || decalerMois(moisEch, -1) > moisCourant) continue
    out.push({ categorie: 'bail', restaurant_id: f.restaurant_id, mois: moisEch, montant_du: n(f.montant), echeance: jourDuMois(moisEch, f.bail_jour) })
  }
  return out
}

// Impôts, ITS, TEE (montant fixe) et baux : lignes manquantes jusqu'au mois courant.
export function chargesFixesACreer(fixes = [], echeances = [], dusExistants = [], moisCourant) {
  const existe = new Set((dusExistants || []).map(d => `${d.categorie}|${d.restaurant_id}|${d.mois}`))
  const out = []
  for (const f of fixes || []) {
    if (!f.actif || !f.mois_depart || !(n(f.montant) > 0)) continue
    const lignes = f.categorie === 'bail'
      ? bailsACreer(f, moisCourant)
      : CATEGORIES_MONTANT_FIXE.includes(f.categorie)
        ? moisEntre(f.mois_depart, moisCourant).map(mois => ({
          categorie: f.categorie, restaurant_id: f.restaurant_id, mois, montant_du: n(f.montant),
          echeance: echeancePostPayee(mois, jourCommun(echeances, f.categorie)),
        }))
        : []
    for (const l of lignes) if (!existe.has(`${l.categorie}|${l.restaurant_id}|${l.mois}`)) out.push(l)
  }
  return out
}
```

- [ ] **Step 4: Lancer** `node lib/tresorerie.test.mjs` — attendu : tout passe.
- [ ] **Step 5: Commit** `feat(tresorerie): échéances post-payées et création des montants fixes`

---

### Task 3: Classement, mises à jour, droits RH

**Files:**
- Modify: `lib/tresorerie.js`
- Test: `lib/tresorerie.test.mjs`

**Interfaces:**
- Consumes: `CATEGORIES_SERIE`, `echeancePostPayee`, `resteDu`, `paiementsParDu`.
- Produces:
  - `classerDu(du, dus, parDu, aujourdhui) → 'paye' | 'a_payer' | 'dette_recente' | 'dette'`
  - `classerTous(dus, paiements, aujourdhui) → { [du.id]: classement }`
  - `dusAMettreAJour({ categorie, restaurantId, montant, jour, bail, dus, paiements, aujourdhui }) → du[]` (lignes modifiées seulement ; `bail = { mois, jour }`)
  - `ONGLETS_A_PAYER`, `LIBELLES_ONGLET`, `categoriesVisibles(niveau)` (RH : les 7 séries)
  - permission `saisir_charges` (propriétaire, saisie_rh) ; `NIVEAUX.saisie_rh = 'Saisie des charges (RH)'`
  - `calculerTresorerieNette` : impot, its, tee, bail, autre comptent dans `admin`
  - `resumeLoyersParRestaurant` : total = mois consommés terminés (`mois < moisCourant`)
  - suppression de `statutLoyer`

- [ ] **Step 1: Tests qui échouent** (remplacer le bloc `describe('statut loyer'…)` et adapter le test du total par restaurant : `reste` attendu 400+1000 = 1400 pour mois < '2026-10-01' → avec les données existantes : sep reste 600 + août 0 → **600**)

```js
describe('classement : à payer, dette récente, dette', () => {
  const du = (id, mois, echeance, extra = {}) => ({ id, categorie: 'loyer', restaurant_id: 'lav', mois, echeance, montant_du: 1000, ...extra })
  const sept = du('sep', '2026-09-01', '2026-10-05')
  const oct = du('oct', '2026-10-01', '2026-11-05')
  test('jusqu\'au jour de la date limite inclus : à payer', () => {
    assert.equal(classerDu(sept, [sept, oct], {}, '2026-10-05'), 'a_payer')
  })
  test('le lendemain : dette récente', () => {
    assert.equal(classerDu(sept, [sept, oct], {}, '2026-10-06'), 'dette_recente')
  })
  test('quand octobre est en retard à son tour : septembre en dette, octobre en dette récente', () => {
    assert.equal(classerDu(sept, [sept, oct], {}, '2026-11-06'), 'dette')
    assert.equal(classerDu(oct, [sept, oct], {}, '2026-11-06'), 'dette_recente')
  })
  test('octobre payé à temps ne pousse pas septembre', () => {
    assert.equal(classerDu(sept, [sept, oct], { oct: [{ montant: 1000 }] }, '2026-11-06'), 'dette_recente')
  })
  test('une autre série (autre restaurant) ne pousse pas', () => {
    const autre = { ...oct, id: 'x', restaurant_id: 'kms' }
    assert.equal(classerDu(sept, [sept, autre], {}, '2026-11-06'), 'dette_recente')
  })
  test('payé : payé, même en retard', () => {
    assert.equal(classerDu(sept, [sept], { sep: [{ montant: 1000 }] }, '2026-12-01'), 'paye')
  })
  test('autre charge : à payer sans limite, dette seulement à la main', () => {
    const a = { id: 'a', categorie: 'autre', montant_du: 500 }
    assert.equal(classerDu(a, [a], {}, '2027-01-01'), 'a_payer')
    assert.equal(classerDu({ ...a, en_dette_depuis: '2026-10-02' }, [a], {}, '2026-10-02'), 'dette')
  })
  test('créancier : dette', () => {
    const c = { id: 'c', categorie: 'dette', creancier: 'Zabad', montant_du: 6000000 }
    assert.equal(classerDu(c, [c], {}, '2026-10-02'), 'dette')
  })
  test('classerTous', () => {
    assert.deepEqual(classerTous([sept, oct], [], '2026-10-06'), { sep: 'dette_recente', oct: 'a_payer' })
  })
})

describe('mise à jour des lignes non échues', () => {
  const dus = [
    { id: 'a', categorie: 'its', restaurant_id: 'r', mois: '2026-09-01', echeance: '2026-10-15', montant_du: 100 },
    { id: 'b', categorie: 'its', restaurant_id: 'r', mois: '2026-08-01', echeance: '2026-09-15', montant_du: 100 },
    { id: 'c', categorie: 'its', restaurant_id: 'r', mois: '2026-10-01', echeance: '2026-11-15', montant_du: 100 },
  ]
  test('nouveau jour : lignes non payées dont la date limite n\'est pas passée', () => {
    const r = dusAMettreAJour({ categorie: 'its', jour: 20, dus, paiements: [{ du_id: 'c', montant: 10 }], aujourdhui: '2026-10-02' })
    assert.deepEqual(r.map(d => [d.id, d.echeance]), [['a', '2026-10-20']])
  })
  test('nouveau montant pour un restaurant', () => {
    const r = dusAMettreAJour({ categorie: 'its', restaurantId: 'r', montant: 150, dus, paiements: [], aujourdhui: '2026-10-02' })
    assert.deepEqual(r.map(d => [d.id, d.montant_du]), [['a', 150], ['c', 150]])
  })
  test('nouvelle date de bail : mois et échéance suivent', () => {
    const bail = [{ id: 'z', categorie: 'bail', restaurant_id: 'r', mois: '2026-11-01', echeance: '2026-11-20', montant_du: 9 }]
    const r = dusAMettreAJour({ categorie: 'bail', restaurantId: 'r', bail: { mois: 12, jour: 5 }, dus: bail, paiements: [], aujourdhui: '2026-10-02' })
    assert.deepEqual(r.map(d => [d.mois, d.echeance]), [['2026-12-01', '2026-12-05']])
  })
})
```

Et dans le bloc `droits` :

```js
  test('le RH saisit les sept charges, ne paie pas, ne voit pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('saisie_rh'), ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail'])
    assert.equal(peut('saisie_rh', 'saisir_charges'), true)
    assert.equal(peut('saisie_rh', 'payer'), false)
  })
  test('lecture : les sept charges et la dette récente, pas les dettes', () => {
    assert.deepEqual(categoriesVisibles('lecture'), ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail', 'dette_recente'])
  })
```

(Remplacer l'ancien test `les catégories` par `assert.deepEqual(CATEGORIES_DU, ['loyer','salaire','cnps','impot','its','tee','bail','autre','admin','dette'])`.)

- [ ] **Step 2: Lancer** — attendu : échecs.

- [ ] **Step 3: Implémenter**

```js
// Classement d'une ligne (jamais stocké) :
//  - payé : plus de reste ;
//  - dette : passée à la main (en_dette_depuis), créancier, ou charge en série
//    en retard qu'une charge plus récente de la même série (catégorie +
//    restaurant), elle aussi en retard avec un reste, a « rejointe » ;
//  - dette récente : charge en série en retard, la plus récente de sa série ;
//  - à payer : le reste (date limite pas passée, autres charges).
export function classerDu(du, dus = [], parDu = {}, aujourdhui) {
  if (resteDu(du, parDu[du.id]) === 0) return 'paye'
  if (du.en_dette_depuis || du.categorie === 'dette') return 'dette'
  if (!CATEGORIES_SERIE.includes(du.categorie)) return 'a_payer'
  if (!du.echeance || aujourdhui <= du.echeance) return 'a_payer'
  const rejointe = (dus || []).some(x => x.id !== du.id
    && x.categorie === du.categorie && x.restaurant_id === du.restaurant_id
    && x.echeance && x.echeance > du.echeance && aujourdhui > x.echeance
    && resteDu(x, parDu[x.id]) > 0)
  return rejointe ? 'dette' : 'dette_recente'
}

export function classerTous(dus = [], paiements = [], aujourdhui) {
  const parDu = paiementsParDu(paiements)
  return Object.fromEntries((dus || []).map(d => [d.id, classerDu(d, dus, parDu, aujourdhui)]))
}

// Lignes qui suivent un nouveau réglage : non payées, date limite pas passée.
export function dusAMettreAJour({ categorie, restaurantId = null, montant = null, jour = null, bail = null, dus = [], paiements = [], aujourdhui }) {
  const parDu = paiementsParDu(paiements)
  const out = []
  for (const d of dus || []) {
    if (d.categorie !== categorie || (restaurantId && d.restaurant_id !== restaurantId)) continue
    if (parDu[d.id]?.length || (d.echeance && d.echeance < aujourdhui)) continue
    const maj = { ...d }
    if (montant !== null) maj.montant_du = n(montant)
    if (jour !== null && d.mois) maj.echeance = echeancePostPayee(d.mois, jour)
    if (bail && d.mois) {
      maj.mois = `${d.mois.slice(0, 4)}-${String(bail.mois).padStart(2, '0')}-01`
      maj.echeance = jourDuMois(maj.mois, bail.jour)
    }
    if (maj.montant_du !== d.montant_du || maj.echeance !== d.echeance || maj.mois !== d.mois) out.push(maj)
  }
  return out
}

export const ONGLETS_A_PAYER = [...CATEGORIES_SERIE, 'dette_recente', 'dette']
export const LIBELLES_ONGLET = { ...LIBELLES_CATEGORIE, bail: 'Bail', dette_recente: 'Dette récente' }

export function categoriesVisibles(niveau) {
  if (niveau === 'saisie_rh') return [...CATEGORIES_SERIE]
  if (!peut(niveau, 'voir_a_payer')) return []
  return ONGLETS_A_PAYER.filter(c => c !== 'dette' || peut(niveau, 'voir_dettes'))
}
```

Droits : ajouter `'saisir_charges'` à `proprietaire` et `saisie_rh` ; `NIVEAUX.saisie_rh = 'Saisie des charges (RH)'`.

`calculerTresorerieNette` : remplacer la clé par
```js
const cle = du.categorie in restes ? du.categorie
  : ['impot', 'its', 'tee', 'bail', 'autre'].includes(du.categorie) ? 'admin' : null
if (!cle || !estExigible(du, moisCourant)) continue
```
(et utiliser `restes[cle]`).

`resumeLoyersParRestaurant` : `if (!du.mois || du.mois < moisCourant) r.reste += reste` ; commentaire : « mois consommés terminés seulement : le loyer du mois en cours n'est dû que le mois prochain ».

Supprimer `statutLoyer` et ses tests.

- [ ] **Step 4: Lancer** `node lib/tresorerie.test.mjs` — attendu : tout passe.
- [ ] **Step 5: Commit** `feat(tresorerie): classement dette récente / dette et droits du RH`

---

### Task 4: Résultat net au mois de la date limite, tableaux de bord

**Files:**
- Modify: `lib/chargesMois.js`, `lib/direction.js`
- Test: `lib/chargesMois.test.mjs`

**Interfaces:**
- Produces:
  - `fusionnerChargesResultat(anciennes, dus, paiementsAutres) → lignes { restaurant_id, mois 'AAAA-MM', libelle, montant, source }`
  - `chargerChargesResultat(supabase, mois)` (signature inchangée)
  - `fusionnerCharges` / `chargerChargesMois` : + impot, its, tee, bail au mois consommé
  - `direction.js` : `CATEGORIES_CHARGE_A_PAYER` (réparation, matériel, équipement, investissement, `divers` « Autre », compte dans le résultat) ; `categorieDirection` cherche aussi `divers`

- [ ] **Step 1: Tests qui échouent** — remplacer le bloc `describe('résultat net : loyer, salaires, CNPS au mois du paiement'…)` par :

```js
describe('résultat net : au mois de la date limite', () => {
  const du = (categorie, mois, echeance, montant_du = 1000) => ({ categorie, restaurant_id: 'kms', mois, echeance, montant_du })

  test('le loyer de juin, dû début juillet, pèse sur juillet, payé ou non', () => {
    const r = fusionnerChargesResultat([], [du('loyer', '2026-06-01', '2026-07-05', 1100000)], [])
    assert.deepEqual(r.map(c => [c.mois, c.montant]), [['2026-07', 1100000]])
  })

  test('les sept catégories en série suivent la même règle', () => {
    const r = fusionnerChargesResultat([], ['salaire', 'cnps', 'impot', 'its', 'tee'].map(c => du(c, '2026-09-01', '2026-10-15')), [])
    assert.ok(r.every(c => c.mois === '2026-10'))
    assert.equal(r.length, 5)
  })

  test('l\'ancien loyer d\'un mois suivi dans la trésorerie n\'est pas compté deux fois', () => {
    const anciennes = [
      { restaurant_id: 'kms', mois: '2026-08', libelle: 'Loyer ', montant: 1100000 },
      { restaurant_id: 'kms', mois: '2026-08', libelle: 'Salaire ', montant: 500000 },
    ]
    const r = fusionnerChargesResultat(anciennes, [du('loyer', '2026-08-01', '2026-09-05', 1100000)], [])
    assert.deepEqual(r.map(c => [c.mois, c.libelle.trim(), c.montant]),
      [['2026-08', 'Salaire', 500000], ['2026-09', 'Loyer (2026-08)', 1100000]])
  })

  test('autre charge payée : au mois du paiement, si sa catégorie compte dans le résultat', () => {
    const paiements = [
      { montant: 300000, date: '2026-10-03', du: { categorie: 'autre', restaurant_id: 'kms', categorie_direction: 'reparation', libelle: 'Compresseur' } },
      { montant: 900000, date: '2026-10-04', du: { categorie: 'autre', restaurant_id: 'kms', categorie_direction: 'investissement', libelle: 'Travaux' } },
      { montant: 50000, date: '2026-10-04', du: { categorie: 'autre', restaurant_id: null, categorie_direction: 'divers', libelle: 'Comptable' } },
    ]
    const r = fusionnerChargesResultat([], [], paiements)
    assert.deepEqual(r.map(c => [c.mois, c.libelle, c.montant]), [['2026-10', 'Compresseur', 300000]])
  })

  test('les dettes ne sont jamais des charges', () => {
    assert.deepEqual(fusionnerChargesResultat([], [{ categorie: 'dette', creancier: 'Z', montant_du: 5 }], []), [])
  })
})

describe('tableaux de bord : nouvelles catégories au mois consommé', () => {
  test('impôts, ITS, TEE et bail', () => {
    const dus = ['impot', 'its', 'tee', 'bail'].map(c => ({ categorie: c, restaurant_id: 'kms', mois: '2026-09-01', montant_du: 10 }))
    const r = fusionnerCharges([], dus)
    assert.deepEqual(r.map(c => c.libelle), ['Impôts', 'ITS', 'TEE', 'Contrat de bail'])
  })
})
```

- [ ] **Step 2: Lancer** `node lib/chargesMois.test.mjs` — attendu : échecs.

- [ ] **Step 3: Implémenter** dans `lib/chargesMois.js`

```js
import { compteDansResultat } from './direction.js'

const LIBELLES = { loyer: 'Loyer', salaire: 'Salaires', cnps: 'CNPS', impot: 'Impôts', its: 'ITS', tee: 'TEE', bail: 'Contrat de bail' }
const CATEGORIES = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail', 'admin']
export const CATEGORIES_SERIE_RESULTAT = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail']

export function categorieAncienne(libelle) { /* inchangé */ }

// Résultat net : une charge en série pèse sur le mois de sa DATE LIMITE, payée
// ou non (loyer de juin, dû début juillet → juillet). Une ligne de l'ancien
// tableau `charges` est écartée quand la trésorerie suit déjà ce mois consommé
// pour ce restaurant et cette catégorie. Les autres charges payées comptent au
// mois du paiement si leur catégorie de dépense direction compte.
export function fusionnerChargesResultat(anciennes = [], dus = [], paiementsAutres = []) {
  const lignes = []
  const suivis = new Set()
  const cle = (r, m, c) => `${r || null}|${m}|${c}`
  for (const du of dus || []) {
    if (CATEGORIES_SERIE_RESULTAT.includes(du.categorie)) {
      if (du.mois) suivis.add(cle(du.restaurant_id, du.mois.slice(0, 7), du.categorie))
      if (!du.echeance) continue
      lignes.push({
        restaurant_id: du.restaurant_id || null, mois: du.echeance.slice(0, 7),
        libelle: `${LIBELLES[du.categorie]}${du.mois ? ` (${du.mois.slice(0, 7)})` : ''}`,
        montant: Number(du.montant_du) || 0, source: 'tresorerie',
      })
    } else if (du.categorie === 'admin') {
      const mois = moisDuDu(du)
      if (!mois) continue
      suivis.add(cle(du.restaurant_id, mois, 'autre'))
      lignes.push({ restaurant_id: du.restaurant_id || null, mois, libelle: du.libelle || 'Charge admin', montant: Number(du.montant_du) || 0, source: 'tresorerie' })
    }
  }
  for (const p of paiementsAutres || []) {
    const du = p.du
    if (!du || du.categorie !== 'autre' || !p.date) continue
    if (!compteDansResultat({ categorie: du.categorie_direction, restaurant_id: du.restaurant_id })) continue
    lignes.push({ restaurant_id: du.restaurant_id, mois: p.date.slice(0, 7), libelle: du.libelle || 'Autre charge', montant: Number(p.montant) || 0, source: 'tresorerie' })
  }
  const gardees = (anciennes || [])
    .filter(c => !suivis.has(cle(c.restaurant_id, c.mois, categorieAncienne(c.libelle))))
    .map(c => ({ ...c, source: 'ancien' }))
  return [...gardees, ...lignes]
}

export async function chargerChargesResultat(supabase, mois) {
  if (!mois?.length) return []
  const tries = [...mois].sort()
  const debut = `${tries[0]}-01`
  const [a0, m0] = tries[tries.length - 1].split('-').map(Number)
  const finExclue = `${m0 === 12 ? a0 + 1 : a0}-${String(m0 === 12 ? 1 : m0 + 1).padStart(2, '0')}-01`
  const dansPlage = col => `and(${col}.gte.${debut},${col}.lt.${finExclue})`
  const [a, t, p] = await Promise.all([
    supabase.from('charges').select('id, restaurant_id, libelle, montant, mois').in('mois', mois).range(0, 9999),
    supabase.from('tresorerie_dus').select('id, categorie, restaurant_id, mois, echeance, libelle, montant_du')
      .in('categorie', CATEGORIES)
      .or(`${dansPlage('mois')},${dansPlage('echeance')}`)
      .range(0, 9999),
    supabase.from('tresorerie_paiements')
      .select('montant, date, du:tresorerie_dus(categorie, restaurant_id, categorie_direction, libelle)')
      .gte('date', debut).lt('date', finExclue).order('date').order('id').range(0, 9999),
  ])
  const voulus = new Set(mois)
  return fusionnerChargesResultat(a.data || [], t.error ? [] : (t.data || []), p.error ? [] : (p.data || []))
    .filter(c => voulus.has(c.mois))
}
```

(`CATEGORIES_AU_PAIEMENT` disparaît.) `fusionnerCharges` utilise déjà `CATEGORIES` et `LIBELLES` : rien d'autre à changer.

Dans `lib/direction.js` :

```js
// Catégories proposées pour une « autre charge » notée avant d'être payée.
export const CATEGORIES_CHARGE_A_PAYER = [
  ...CATEGORIES_DIRECTION.filter(c => ['reparation', 'materiel', 'equipement', 'investissement'].includes(c.id)),
  { id: 'divers', label: 'Autre', compteDansResultat: true, aide: 'Électricité, comptable, entretien…' },
]

export function categorieDirection(id) {
  return CATEGORIES_DIRECTION.find(c => c.id === id) || CATEGORIES_CHARGE_A_PAYER.find(c => c.id === id) || null
}
```

- [ ] **Step 4: Lancer** `for f in lib/*.test.mjs; do node "$f"; done` — attendu : 0 échec.
- [ ] **Step 5: Commit** `feat(tresorerie): résultat net au mois de la date limite`

---

### Task 5: Couche base de données

**Files:**
- Modify: `lib/tresorerieDb.js`

**Interfaces:**
- Consumes: `chargesFixesACreer`, `moisLoyersACreer`, `premierDuMois`, `aujourdhuiISO`.
- Produces:
  - `chargerTresorerie()` renvoie en plus `echeances` (array) et `chargesFixes` (array), vides si la migration n'est pas passée ; crée les impôts / ITS / TEE / baux manquants en plus des loyers.
  - `enregistrerDu(du, user)` écrit aussi `categorie_direction`.
  - `mettreAJourDus(dus)` : met à jour `montant_du`, `echeance`, `mois`.
  - `enregistrerEcheance({ categorie, jour }, majDus, user)`
  - `enregistrerChargeFixe({ categorie, restaurantId, montant, moisDepart, bailMois, bailJour, actif }, majDus, user)`
  - `basculerDette(du, enDette, user)` : `en_dette_depuis` = aujourd'hui ou `null`.

- [ ] **Step 1: Implémenter**

Chargement tolérant :
```js
async function lireReglage(table, ordre) {
  const { data, error } = await supabase.from(table).select('*').order(ordre).range(0, 999)
  return error ? [] : (data || [])
}
```
Dans `chargerTresorerie`, ajouter au `Promise.all` : `lireReglage('tresorerie_echeances', 'categorie')`, `lireReglage('tresorerie_charges_fixes', 'restaurant_id')`. La création :
```js
const mc = premierDuMois(aujourdhuiISO())
const aCreer = [...moisLoyersACreer(loyers, dus, mc), ...chargesFixesACreer(chargesFixes, echeances, dus, mc)]
// insert : cree_par_nom 'Automatique'
```
Retourner `echeances, chargesFixes`.

Écritures :
```js
export async function mettreAJourDus(dus = []) {
  for (const d of dus) {
    const { error } = await supabase.from('tresorerie_dus')
      .update({ montant_du: d.montant_du, echeance: d.echeance, mois: d.mois }).eq('id', d.id)
    if (error) throw verifierTable(error)
  }
}

export async function enregistrerEcheance({ categorie, jour }, majDus, user) {
  const { error } = await supabase.from('tresorerie_echeances')
    .upsert({ categorie, jour, updated_at: new Date().toISOString() }, { onConflict: 'categorie' })
  if (error) throw verifierTable(error)
  await mettreAJourDus(majDus)
  journaliser('tresorerie_echeance_reglee', { categorie, jour, lignes: majDus.length }, contexte(user))
}

export async function enregistrerChargeFixe({ categorie, restaurantId, montant, moisDepart, bailMois = null, bailJour = null, actif = true }, majDus, user) {
  const { error } = await supabase.from('tresorerie_charges_fixes').upsert({
    categorie, restaurant_id: restaurantId, montant, mois_depart: moisDepart,
    bail_mois: bailMois, bail_jour: bailJour, actif, updated_at: new Date().toISOString(),
  }, { onConflict: 'categorie,restaurant_id' })
  if (error) throw verifierTable(error)
  await mettreAJourDus(majDus)
  journaliser('tresorerie_charge_fixe_reglee', { categorie, montant, bail_mois: bailMois, bail_jour: bailJour, actif }, { ...contexte(user), restaurantId })
}

export async function basculerDette(du, enDette, user) {
  const { error } = await supabase.from('tresorerie_dus')
    .update({ en_dette_depuis: enDette ? aujourdhuiISO() : null }).eq('id', du.id)
  if (error) throw verifierTable(error)
  journaliser(enDette ? 'tresorerie_du_en_dette' : 'tresorerie_du_hors_dette', { categorie: du.categorie, libelle: du.libelle, montant_du: du.montant_du }, { ...contexte(user), restaurantId: du.restaurant_id })
}
```
`verifierTable` : message de migration générique « … il faut passer les fichiers supabase_tresorerie*.sql dans Supabase ». Dans `enregistrerDu`, ajouter `categorie_direction: du.categorie_direction || null` à `ligne` **seulement si** `du.categorie === 'autre'` (sinon la colonne absente avant migration ferait échouer toute saisie).

- [ ] **Step 2: Vérifier** `npx eslint lib/tresorerieDb.js` (0 erreur) et les tests `lib/*.test.mjs`.
- [ ] **Step 3: Commit** `feat(tresorerie): réglages des échéances et montants fixes en base`

---

### Task 6: Feuilles partagées (détail, paiement) et réglages

**Files:**
- Create: `components/tresorerie/du.js`, `components/tresorerie/reglagesCharges.js`
- Modify: `app/tresorerie-a-payer.js` (retrait des définitions déplacées)

**Interfaces:**
- Produces (`du.js`): `couleursStatut(colors) → { paye, a_payer, dette_recente, dette }` (chacun `{ trait, fond, texte, label }`), `Badge({ c })`, `titreDu(du, nomResto)`, `FeuilleDetail({ du, paiements, classement, donnees, niveau, aujourdhui, nomResto, user, onFermer, onPayer, onModifier, apres })`, `FeuillePaiement({ demande, donnees, parDu, nomResto, user, onFermer, apres })`.
- Produces (`reglagesCharges.js`): `FeuilleEcheance({ categorie, donnees, user, onFermer, apres })` (rendue si `categorie`), `FeuilleMontantsFixes({ categorie, donnees, user, onFermer, apres })`, `FeuilleBaux({ visible, donnees, user, onFermer, apres })`.

- [ ] **Step 1: Déplacer** `couleursStatut`, `Badge`, `titreDu`, `FeuilleDetail`, `FeuillePaiement` de `app/tresorerie-a-payer.js` vers `components/tresorerie/du.js` (mêmes imports), avec ces changements :
  - `couleursStatut` : `paye` (success), `a_payer` (warning), `dette_recente` (error, label « dette récente »), `dette` (fond `errorLight`, trait/texte `errorDark`, label « dette »).
  - `titreDu` : `autre` → `${du.libelle || 'Autre charge'} · ${du.restaurant_id ? nomResto(du.restaurant_id) : 'Groupe'}`.
  - `FeuilleDetail` : prop `classement` → badge sous le reste ; bouton « Passer en Dette » (si `reste > 0`, `peut(niveau,'payer')`, catégorie `autre` ou `dette`… sans `en_dette_depuis`) / « Remettre à payer » (si `en_dette_depuis`) → `basculerDette`. `peutModifier` : séries → `peut(niveau,'saisir_charges')` ; `dette`/`autre` → `peut(niveau,'saisir_dus')`.
  - `FeuillePaiement` : échéance d'un mois de loyer payé d'avance = `echeancePostPayee(moisChoisi, loyer?.jour_echeance || 5)`.

- [ ] **Step 2: Écrire** `components/tresorerie/reglagesCharges.js`
  - `FeuilleEcheance` : champ « Jour limite (1 à 31) dans le mois suivant », valeur de départ `jourCommun(donnees.echeances, categorie)` ; enregistrer → `enregistrerEcheance({ categorie, jour }, dusAMettreAJour({ categorie, jour, dus: donnees.dus, paiements: donnees.paiements, aujourdhui }), user)`.
  - `FeuilleMontantsFixes` : un `ChampMontant` par restaurant (valeur actuelle de `donnees.chargesFixes`) ; enregistrer : pour chaque restaurant dont la valeur change, montant > 0 → `enregistrerChargeFixe({ categorie, restaurantId, montant, moisDepart: existant?.mois_depart || mois courant, actif: true }, dusAMettreAJour({ categorie, restaurantId, montant, … }), user)` ; champ vidé alors qu'un réglage existait → `actif: false` avec l'ancien montant, aucune mise à jour de lignes. Texte : « Une ligne par mois est créée toute seule, due le {jour} du mois suivant. Champ vide = plus de ligne pour ce restaurant. »
  - `FeuilleBaux` : liste des restaurants (montant · date ou « non réglé ») ; restaurant choisi → `ChampMontant` « Montant annuel », `Champ` « Jour limite (1 à 31) », `Puces` des 12 mois ; enregistrer → `enregistrerChargeFixe({ categorie: 'bail', restaurantId, montant, moisDepart: existant?.mois_depart || mois courant, bailMois, bailJour, actif: true }, dusAMettreAJour({ categorie: 'bail', restaurantId, montant, bail: { mois: bailMois, jour: bailJour }, … }), user)`.
  - Erreurs : `Alert.alert('Non enregistré', e?.message || 'Réessayez.')`.

- [ ] **Step 3: Vérifier** `npx eslint components/tresorerie app/tresorerie-a-payer.js` (0 erreur).
- [ ] **Step 4: Commit** `refactor(tresorerie): feuilles détail / paiement partagées, réglages des charges`

---

### Task 7: Écran À payer

**Files:**
- Modify: `app/tresorerie-a-payer.js`

**Interfaces:**
- Consumes: `categoriesVisibles`, `LIBELLES_ONGLET`, `classerTous`, `CATEGORIES_SERIE`, `CATEGORIES_JOUR_COMMUN`, `CATEGORIES_MONTANT_FIXE`, `jourCommun`, `echeancePostPayee`, `resumeLoyersParRestaurant`, feuilles de la tâche 6.

- [ ] **Step 1: Implémenter**
  - `classement = useMemo(() => classerTous(donnees.dus, donnees.paiements, aujourdhui))`.
  - `dusOnglet` : série → `dus.filter(d => d.categorie === onglet)` ; `dette_recente` / `dette` → `dus.filter(d => classement[d.id] === onglet)`.
  - En-tête : `${LIBELLES_ONGLET[onglet]} · reste ${fmt(resteOnglet)} F` ; `resteOnglet` = somme des restes ; pour une série, seulement `mois < moisCourant` ou classement ≠ `a_payer` (le mois en cours n'est pas encore dû).
  - `ListeLoyers` : badge = `cs[classement[d.id]]` ; jours de retard affichés si classement ∈ {dette_recente, dette} ; mois courant marqué « (en cours) », futur « (d'avance) ».
  - `ListeDus` (séries hors loyer) : regroupement par mois consommé comme aujourd'hui, badge = classement ; « Restants seulement » conservé.
  - `ListeDettes` (onglets `dette_recente`, `dette`) : liste plate triée par échéance (créanciers à la fin), titre `${LIBELLES_CATEGORIE[d.categorie]} · ${titreDu(d)}${d.mois ? ' · ' + libelleMoisCourt(d.mois) : ''}`, « en retard depuis le {lendemain de l'échéance} », total en tête.
  - Bas de page, selon l'onglet :
    - `CATEGORIES_JOUR_COMMUN` : texte « Date limite : le {jour} du mois suivant » + bouton « Changer la date limite » (`saisir_charges`) → `FeuilleEcheance`.
    - `CATEGORIES_MONTANT_FIXE` : « Régler les montants par restaurant » → `FeuilleMontantsFixes`.
    - `bail` : « Régler les contrats de bail » → `FeuilleBaux`.
    - `loyer` : « Régler les loyers des restaurants » si `saisir_charges`.
    - ajout manuel : `salaire` « + État de salaires », `cnps` « + Déclaration CNPS », `impot`/`its`/`tee` « + Une ligne (exceptionnelle) », `dette` « + Dette » (`saisir_dus`).
  - `FeuilleEdition` : catégories en série → restaurant, mois, montant ; échéance calculée (`echeancePostPayee(mois, jourCommun(...))`, ou jour du loyer du restaurant) et affichée en lecture seule ; plus de branche `admin` à la création ; `dette` inchangé.
  - Restaurer `peutSaisirCategorie` : séries → `saisir_charges` ; `dette` → `saisir_dus`.

- [ ] **Step 2: Vérifier** lint (0 erreur), tests, `npx expo export -p web --output-dir <scratchpad>/web` (compile).
- [ ] **Step 3: Commit** `feat(tresorerie): à payer — sept charges, dette récente, dettes`

---

### Task 8: Dépenses direction, vue d'ensemble, résultat, droits

**Files:**
- Modify: `app/tresorerie-direction.js`, `app/tresorerie.js`, `app/tresorerie-resultats.js`

- [ ] **Step 1: Dépenses direction** — section « À payer » en tête : lignes `categorie === 'autre'` avec reste > 0 (badge classement, reste, restaurant ou Groupe), total ; bouton « + Charge à payer » → feuille : catégorie (`CATEGORIES_CHARGE_A_PAYER`), restaurant ou Groupe, libellé (obligatoire), montant, note → `enregistrerDu({ categorie: 'autre', restaurant_id, libelle, categorie_direction, montant_du, note }, user)`. Toucher une ligne → `FeuilleDetail` (payer → `FeuillePaiement({ du })`, modifier → même feuille préremplie, passer en Dette).
- [ ] **Step 2: Vue d'ensemble** (`app/tresorerie.js`) : libellé « − Impôts, ITS, TEE, bail et autres charges » ; tuile À payer « Loyers · salaires · CNPS · impôts… » ; redirection RH vers `?onglet=loyer` ; droits : option « RH (charges) », texte « RH en saisie des charges (loyers, salaires, CNPS, impôts, ITS, TEE, bail) ».
- [ ] **Step 3: Résultat net** : note « Loyer, salaires, CNPS, impôts, ITS, TEE et bail comptent au mois de leur date limite (le loyer de juin, dû début juillet, pèse sur juillet). » ; en-tête du fichier mis à jour.
- [ ] **Step 4: Vérifier** lint, tests, export web.
- [ ] **Step 5: Commit** `feat(tresorerie): autres charges à payer, libellés et droits du RH`

---

## Après le plan

- Passer `supabase_tresorerie_charges.sql` (avec l'accord de l'utilisateur), puis vérifier à l'écran : un loyer de septembre affiché « à payer » jusqu'au 05/10, les réglages ITS créant la ligne d'octobre.
- `graphify update .`
- Mettre à jour `handoff.md` si un compactage approche.
