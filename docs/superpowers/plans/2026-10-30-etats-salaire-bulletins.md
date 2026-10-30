# États de salaire et bulletins de paie — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** sortir chaque mois, par restaurant, l'état de salaire (jours pointés × montant par jour − déjà versé) et les bulletins de paie légaux des CDD/CDI, au format des bulletins Sage, via un circuit RH → manager → Trésorerie.

**Architecture :** trois modules purs testés (`lib/paie.js` calcul du bulletin, `lib/etatSalaire.js` lignes de l'état, `lib/bulletin.js` en-tête + congés + cumuls), un module PDF (`lib/pdfBulletin.js`, jsPDF), une couche base (`lib/paieDb.js`), puis les écrans (`app/salaires.js`, `components/salaires/*`, section « Paie » de la fiche). Le calcul validé est figé en jsonb ; les PDF sont régénérés depuis ce jsonb.

**Tech Stack :** Expo / React Native (web + iOS), Supabase (supabase-js), jsPDF + jspdf-autotable, tests `node:test`.

Conception : `docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md` (commit e4cbaa8).

## Global Constraints

- Interface, messages d'erreur et libellés **en français courant** ; montants en **F CFA entiers** (jamais de flottant pour l'argent : taux en pour dix mille, `Math.round`).
- Taux et barèmes **jamais en dur dans les écrans** : `PARAMETRES_DEFAUT` de `lib/paie.js`, surchargés par `parametres_paie` (par date d'effet).
- Le calcul doit reproduire **au franc près** les 5 bulletins Sage de juillet 2026 (tests de la tâche 2). Les données personnelles de ces bulletins (`~/Downloads/07_juillet`) ne sont **jamais** copiées dans le dépôt : noms, matricules, n° CNPS fictifs dans les tests.
- Modules purs : aucune lecture de l'horloge, imports **avec l'extension `.js`** (exécutables par `node`).
- Lectures de présences paginées (`chargerPresences` de `lib/equipeDb.js` le fait déjà : limite des 1 000 lignes Supabase).
- PDF : **jsPDF**, jamais `expo-print` ; texte passé par `normaliserPourPdf` (`lib/pdfTexte.js`) ; espaces simples dans les nombres.
- Dates choisies au calendrier (`ChampDate`), jamais tapées. Boutons tactiles ≥ 48 px.
- Pas de `localhost` / `expo start` lancé par l'agent : vérifier par `node lib/*.test.mjs`, `npm run lint` et `npx expo export -p web`.
- Commits conventionnels en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, puis `git push`. Préfixer les commandes git par `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
- **Ne pas publier** (ni Vercel ni EAS) : la publication se fait une seule fois à la fin, sur demande de l'utilisateur.
- Après modification de code : `graphify update .`

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase_paie.sql` (créé) | colonnes pointeuse de `presences`, tables `fiches_paie`, `parametres_paie`, `employeurs_paie`, `etats_salaire`, `lignes_etat_salaire`, tuile RH |
| `docs/correctif-pont-pointeuse.md` (créé) | fiche à appliquer sur le master Windows (pont POS) |
| `lib/paie.js` + `.test.mjs` (créés) | calcul pur du bulletin ivoirien |
| `lib/etatSalaire.js` + `.test.mjs` (créés) | lignes de l'état, saisies RH, règles de soumission |
| `lib/bulletin.js` + `.test.mjs` (créés) | bulletin complet figé : en-tête, congés, cumuls |
| `lib/pdfBulletin.js` + `.test.mjs` (créés) | PDF bulletins (format Sage) et état |
| `lib/paieDb.js` (créé) | lectures/écritures Supabase, circuit, dû Trésorerie |
| `components/equipe/SectionPaie.js` (créé) | section « Paie » + bulletins dans la fiche |
| `components/equipe/FicheTravailleur.js` (modifié) | affiche `SectionPaie` pour un CDD/CDI (RH, manager) |
| `app/salaires.js` (créé) | écran « Salaires du mois » |
| `components/salaires/DetailEtat.js`, `FeuilleLigne.js`, `FeuilleEmployeurs.js` (créés) | détail, saisies RH, employeurs |
| `lib/menus.js`, `lib/groupesAccueil.js`, `app/_layout.tsx`, `components/accueil/AccueilManager.js` (modifiés) | tuile, groupe, route, badge |

---

### Task 1 : Migration SQL et fiche du correctif pont

**Files :**
- Create : `supabase_paie.sql`
- Create : `docs/correctif-pont-pointeuse.md`

**Interfaces :**
- Produces : tables et colonnes utilisées par toutes les tâches suivantes (noms exacts ci-dessous) ; tuile `salaires` dans `roles_acces` (RH).

- [ ] **Step 1 : écrire `supabase_paie.sql`**

```sql
-- =====================================================================
--  ÉTATS DE SALAIRE ET BULLETINS DE PAIE (30/10/2026)
--  À exécuter UNE fois dans le SQL Editor du projet SAMTRACKLY.
--  Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md
--  Relancer le script ne casse rien.
-- =====================================================================

-- ── 1. Heures réelles de la pointeuse (remplies par le pont POS) ─────
alter table public.presences add column if not exists pointe_arrivee timestamptz;
alter table public.presences add column if not exists pointe_depart  timestamptz;

-- ── 2. Fiche paie : une ligne par CDD / CDI ──────────────────────────
create table if not exists public.fiches_paie (
  travailleur_id        uuid primary key references public.travailleurs(id) on delete cascade,
  matricule             text,
  coefficient           numeric,
  categorie             text,
  salaire_categoriel    int,
  sursalaire            int not null default 0,
  prime_transport       int not null default 30000,
  prime_tenue           int not null default 0,
  numero_cnps           text,
  parts_fiscales        numeric check (parts_fiscales is null or (parts_fiscales >= 1 and parts_fiscales <= 5 and parts_fiscales * 2 = floor(parts_fiscales * 2))),
  personnes_cmu         int check (personnes_cmu is null or personnes_cmu >= 1),
  mode_paiement         text check (mode_paiement is null or mode_paiement in ('especes', 'virement')),
  cumuls_reprise        jsonb,
  cumuls_reprise_au     date,
  conges_acquis_reprise numeric,
  conges_reste_reprise  numeric,
  modifie_par_nom       text,
  updated_at            timestamptz not null default now()
);
alter table public.fiches_paie enable row level security;
drop policy if exists allow_all on public.fiches_paie;
create policy allow_all on public.fiches_paie for all to public using (true) with check (true);

-- ── 3. Paramètres légaux, par date d'effet ───────────────────────────
--  Une loi qui change = une NOUVELLE ligne (jamais modifier une ligne passée).
--  Valeurs vides ({}) = valeurs par défaut de lib/paie.js (PARAMETRES_DEFAUT).
create table if not exists public.parametres_paie (
  id            uuid primary key default gen_random_uuid(),
  applicable_du date not null unique,
  valeurs       jsonb not null default '{}',
  note          text,
  created_at    timestamptz not null default now()
);
alter table public.parametres_paie enable row level security;
drop policy if exists allow_all on public.parametres_paie;
create policy allow_all on public.parametres_paie for all to public using (true) with check (true);
insert into public.parametres_paie (applicable_du, valeurs, note)
values ('2026-11-01', '{}', 'Valeurs de lib/paie.js. Fin de CDD, congés payés et seuils ITS > 240 000 à valider par le comptable.')
on conflict (applicable_du) do nothing;

-- ── 4. Employeur par marque (en-tête du bulletin) ────────────────────
create table if not exists public.employeurs_paie (
  marque              text primary key check (marque in ('samer', 'alkayan', 'alabraise')),
  raison_sociale      text,
  adresse             text,
  ville               text,
  numero_cnps         text,
  numero_contribuable text,
  responsable         text,
  telephone           text,
  updated_at          timestamptz not null default now()
);
alter table public.employeurs_paie enable row level security;
drop policy if exists allow_all on public.employeurs_paie;
create policy allow_all on public.employeurs_paie for all to public using (true) with check (true);
insert into public.employeurs_paie (marque, raison_sociale, adresse, ville)
values ('samer', 'CHEZ SAMER', '21 BP 915 ABIDJAN 21', 'ABIDJAN COCODY'),
       ('alkayan', 'AL KAYAN', null, null),
       ('alabraise', 'A LA BRAISE', null, null)
on conflict (marque) do nothing;

-- ── 5. États de salaire et leurs lignes ──────────────────────────────
create table if not exists public.etats_salaire (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id),
  mois              date not null check (extract(day from mois) = 1),
  statut            text not null default 'brouillon' check (statut in ('brouillon', 'soumis', 'valide')),
  totaux            jsonb not null default '{}',
  prepare_par_nom   text,
  prepare_le        timestamptz,
  soumis_par_nom    text,
  soumis_le         timestamptz,
  valide_par_nom    text,
  valide_le         timestamptz,
  renvoi_motif      text,
  du_id             uuid references public.tresorerie_dus(id) on delete set null,
  du_cree_par_etat  boolean not null default false,
  du_montant_avant  bigint,
  created_at        timestamptz not null default now(),
  unique (restaurant_id, mois)
);
alter table public.etats_salaire enable row level security;
drop policy if exists allow_all on public.etats_salaire;
create policy allow_all on public.etats_salaire for all to public using (true) with check (true);

create table if not exists public.lignes_etat_salaire (
  id                       uuid primary key default gen_random_uuid(),
  etat_id                  uuid not null references public.etats_salaire(id) on delete cascade,
  travailleur_id           uuid not null,
  nom                      text not null,
  poste                    text,
  type_contrat             text,
  salaire_journalier       int not null default 0,
  jours_attendus           int not null default 0,
  jours_pointes            int not null default 0,
  absences_non_justifiees  int not null default 0,
  absences_justifiees      jsonb not null default '[]',
  elements_variables       jsonb not null default '[]',
  avances                  jsonb not null default '[]',
  du                       bigint not null default 0,
  deja_verse               bigint not null default 0,
  total_avances            bigint not null default 0,
  reste_a_payer            bigint not null default 0,
  trop_verse               bigint not null default 0,
  bulletin                 jsonb,
  unique (etat_id, travailleur_id)
);
create index if not exists idx_lignes_etat_trav on public.lignes_etat_salaire (travailleur_id);
alter table public.lignes_etat_salaire enable row level security;
drop policy if exists allow_all on public.lignes_etat_salaire;
create policy allow_all on public.lignes_etat_salaire for all to public using (true) with check (true);

-- ── 6. Tuile « Salaires du mois » pour la RH ─────────────────────────
update public.roles_acces
set tuiles = tuiles || '["salaires"]'::jsonb, updated_at = now()
where role = 'rh' and not (tuiles @> '["salaires"]'::jsonb);

-- Contrôle : 2 colonnes, 5 tables, 1 ligne de paramètres, 3 employeurs, tuile RH.
select
  (select count(*) from information_schema.columns where table_name = 'presences' and column_name in ('pointe_arrivee', 'pointe_depart')) as colonnes_presences,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('fiches_paie', 'parametres_paie', 'employeurs_paie', 'etats_salaire', 'lignes_etat_salaire')) as tables,
  (select count(*) from public.parametres_paie) as parametres,
  (select count(*) from public.employeurs_paie) as employeurs,
  (select tuiles @> '["salaires"]'::jsonb from public.roles_acces where role = 'rh') as tuile_rh;
```

- [ ] **Step 2 : écrire `docs/correctif-pont-pointeuse.md`**

````markdown
# Correctif pont POS → Samtrackly : heures réelles de la pointeuse

À appliquer sur le **master Windows** (le code POS du Mac est périmé), puis redéployer
la fonction `samtrackly-points` sur le projet **pos-samer-cloud**.
Prérequis : `supabase_paie.sql` passé sur Samtrackly (colonnes `presences.pointe_arrivee`
et `presences.pointe_depart`).

## Pourquoi

Depuis le 27/10/2026, la pointeuse remplit `equipe_service.pointe_le` / `depart_le`
(source `POINTEUSE`). Le pont ne copie que la présence ; l'état de salaire a besoin des
vraies heures d'arrivée et de départ.

## 1. `samtrackly-points/index.ts` : lire aussi le départ et la source

```ts
// avant
.select('utilisateur_id, poste_jour, pointe_le, reste')
// après
.select('utilisateur_id, poste_jour, pointe_le, depart_le, source, reste')
```

Ajouter `depart_le?: string | null; source?: string | null;` au type `EquipeService`
(`_shared/samtrackly-detail.ts`).

## 2. `_shared/samtrackly-detail.ts` : deux champs de plus par présence

Dans `LignePresence` :

```ts
pointe_arrivee: string | null;
pointe_depart: string | null;
```

Dans la boucle `for (const membre of equipe || [])` de `construirePresences()`, dans
l'objet poussé :

```ts
pointe_arrivee: membre.source === 'POINTEUSE' ? membre.pointe_le ?? null : null,
pointe_depart: membre.source === 'POINTEUSE' ? membre.depart_le ?? null : null,
```

Et `pointe_arrivee: null, pointe_depart: null` dans la boucle des personnes payées hors
équipe (correctif du 15/10), si elle est déjà appliquée.

## 3. Tests (`samtrackly-detail.test.ts`)

- membre source `POINTEUSE` avec `pointe_le` et `depart_le` → la présence porte les deux heures ;
- membre source `OUVERTURE` → `pointe_arrivee` et `pointe_depart` à `null` ;
- départ oublié (`depart_le` null) → `pointe_depart` null, présence quand même créée.

## Après déploiement

Dans le SQL Editor de **Samtrackly** :

```sql
select date, count(*) filter (where pointe_arrivee is not null) as avec_pointeuse, count(*) as presences
from presences where date >= current_date - 3 group by date order by date;
```
````

- [ ] **Step 3 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add supabase_paie.sql docs/correctif-pont-pointeuse.md
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): migration états de salaire + fiche du correctif pont pointeuse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

L'utilisateur passe `supabase_paie.sql` dans le SQL Editor de Samtrackly (contrôle attendu : 2, 5, 1, 3, true) et applique la fiche du pont sur Windows. **Ne pas exécuter la migration soi-même.**

---

### Task 2 : calcul du bulletin (`lib/paie.js`)

**Files :**
- Create : `lib/paie.test.mjs`
- Create : `lib/paie.js`

**Interfaces :**
- Produces :
  - `PARAMETRES_DEFAUT` (objet, taux en pour dix mille)
  - `anciennete(dateEmbauche, au) → { ans, mois }`
  - `tauxAnciennete(ans, p?) → number`
  - `impotBrutITS(brut, p?) → number` ; `ricf(parts, p?) → number`
  - `calculerBulletin({ fiche, dateEmbauche, finPeriode, absences?, variables?, avances? }, p?) → { joursPayes, anciennete, gains[], brut, retenues: { cmu, cnps, impotBrut, ricf, its }, chargesSalariales, patronal[], chargesPatronales, transport, tenue, avance, avanceNonCouverte, arrondi, net, salaireBrutCumul, heures }`
  - `propositionGratification(salaireCategoriel, moisPresence, p?)`, `propositionFeries(salaireCategoriel, nombre, p?)`, `propositionFinCdd(brutContrat, p?)`, `propositionConges(brutDouzeMois, nbMois, jours, p?)`
  - `parametresPour(lignes, finPeriode) → paramètres`

- [ ] **Step 1 : écrire le test**

```js
// Tests de lib/paie.js — les 5 bulletins Sage de juillet 2026, au franc près.
// Cas anonymisés (A–E) : seuls les montants comptent.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  anciennete, tauxAnciennete, impotBrutITS, ricf, calculerBulletin, parametresPour,
  propositionGratification, propositionFeries, propositionFinCdd, propositionConges, PARAMETRES_DEFAUT,
} from './paie.js'

const FIN = '2026-07-31'
const fiche = (x) => ({ sursalaire: 0, prime_transport: 30000, prime_tenue: 3031, ...x })

const CAS = {
  A: { // cuisinier, 8 ans 8 mois, 3 parts, 3 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 88007, sursalaire: 15000, parts_fiscales: 3, personnes_cmu: 3 }), dateEmbauche: '2017-11-01' },
    brut: 110048, anc: 7041, cmu: 1500, cnps: 6933, impotBrut: 5608, ricf: 22000, its: 0, sal: 8433, pat: 18868, arrondi: 54, net: 134700,
  },
  B: { // assistante comptable, 3 ans 1 mois, 1 part, 2 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 81693, sursalaire: 54500, parts_fiscales: 1, personnes_cmu: 2 }), dateEmbauche: '2023-06-15' },
    brut: 138644, anc: 2451, cmu: 1000, cnps: 8735, impotBrut: 10183, ricf: 0, its: 10183, sal: 19918, pat: 21372, arrondi: 43, net: 151800,
  },
  C: { // gérant adjoint, 15 ans 2 mois, 3,5 parts, 5 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 81693, sursalaire: 20000, parts_fiscales: 3.5, personnes_cmu: 5 }), dateEmbauche: '2011-05-10' },
    brut: 113947, anc: 12254, cmu: 2500, cnps: 7179, impotBrut: 6232, ricf: 27500, its: 0, sal: 9679, pat: 20278, arrondi: 1, net: 137300,
  },
  D: { // serveur, 3 ans 8 mois, 2 parts, 2 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 75000, parts_fiscales: 2, personnes_cmu: 2 }), dateEmbauche: '2022-11-01' },
    brut: 77250, anc: 2250, cmu: 1000, cnps: 4867, impotBrut: 360, ricf: 11000, its: 0, sal: 5867, pat: 14925, arrondi: 86, net: 104500,
  },
  E: { // caissière, 8 mois, avance 91 400
    e: { fiche: fiche({ salaire_categoriel: 75000, parts_fiscales: 1, personnes_cmu: 1 }), dateEmbauche: '2025-11-01', avances: 91400 },
    brut: 75000, anc: 0, cmu: 500, cnps: 4725, impotBrut: 0, ricf: 0, its: 0, sal: 5225, pat: 14188, arrondi: 94, net: 11500,
  },
}

describe('bulletins Sage de juillet 2026 (au franc près)', () => {
  for (const [nom, c] of Object.entries(CAS)) {
    test(`cas ${nom}`, () => {
      const b = calculerBulletin({ ...c.e, finPeriode: FIN })
      assert.equal(b.brut, c.brut, 'brut')
      assert.equal(b.gains.find(g => g.code === 100)?.gain ?? 0, c.anc, 'ancienneté')
      assert.equal(b.retenues.cmu, c.cmu, 'CMU')
      assert.equal(b.retenues.cnps, c.cnps, 'CNPS')
      assert.equal(b.retenues.impotBrut, c.impotBrut, 'impôt brut')
      assert.equal(b.retenues.ricf, c.ricf, 'RICF')
      assert.equal(b.retenues.its, c.its, 'ITS')
      assert.equal(b.chargesSalariales, c.sal, 'charges salariales')
      assert.equal(b.chargesPatronales, c.pat, 'charges patronales')
      assert.equal(b.arrondi, c.arrondi, 'arrondi')
      assert.equal(b.net, c.net, 'net')
      assert.equal(b.salaireBrutCumul, c.brut + 30000, 'salaire brut des cumuls')
    })
  }

  test('cas A : part patronale ligne par ligne', () => {
    const b = calculerBulletin({ ...CAS.A.e, finPeriode: FIN })
    const m = Object.fromEntries(b.patronal.map(l => [l.code, l.montant]))
    assert.deepEqual(m, { 415: 1500, 470: 8474, 480: 3750, 481: 563, 490: 1500, 500: 1321, 520: 440, 530: 660, 531: 660 })
  })
})

describe('ancienneté', () => {
  test('années et mois complets', () => {
    assert.deepEqual(anciennete('2017-11-01', '2026-07-31'), { ans: 8, mois: 8 })
    assert.deepEqual(anciennete('2026-07-31', '2026-07-31'), { ans: 0, mois: 0 })
    assert.deepEqual(anciennete('', '2026-07-31'), { ans: 0, mois: 0 })
  })
  test('taux : 0 avant 2 ans, 1 % par an, plafond 25 %', () => {
    assert.equal(tauxAnciennete(1), 0)
    assert.equal(tauxAnciennete(2), 200)
    assert.equal(tauxAnciennete(15), 1500)
    assert.equal(tauxAnciennete(30), 2500)
  })
  test('1 an 11 mois → pas de prime', () => {
    const b = calculerBulletin({ ...CAS.D.e, dateEmbauche: '2024-08-15', finPeriode: FIN })
    assert.equal(b.gains.find(g => g.code === 100), undefined)
  })
})

describe('ITS', () => {
  test('tranches', () => {
    assert.equal(impotBrutITS(75000), 0)
    assert.equal(impotBrutITS(240000), 26400)
    assert.equal(impotBrutITS(300000), 26400 + 12600)
  })
  test('RICF par demi-part, plafond 5 parts', () => {
    assert.equal(ricf(1), 0)
    assert.equal(ricf(1.5), 5500)
    assert.equal(ricf(5), 44000)
    assert.equal(ricf(7), 44000)
    assert.equal(ricf(null), 0)
  })
})

describe('absences et avances', () => {
  test('2 jours d\'absence : base, sursalaire et transport au prorata de 28/30', () => {
    const b = calculerBulletin({ ...CAS.A.e, finPeriode: FIN, absences: 2 })
    assert.equal(b.joursPayes, 28)
    assert.equal(b.gains[0].gain, Math.round(88007 * 28 / 30))
    assert.equal(b.transport, 28000)
    assert.equal(b.tenue, 3031)
  })
  test('avance plus grande que le net : net 0 et reste signalé', () => {
    const b = calculerBulletin({ ...CAS.E.e, avances: 200000, finPeriode: FIN })
    assert.equal(b.net, 0)
    assert.equal(b.arrondi, 0)
    assert.ok(b.avanceNonCouverte > 0)
  })
})

describe('éléments variables', () => {
  test('entrent dans le brut imposable', () => {
    const b = calculerBulletin({ ...CAS.D.e, finPeriode: FIN, variables: [{ code: 300, libelle: 'GRATIFICATION', montant: 56250 }] })
    assert.equal(b.brut, 77250 + 56250)
    assert.equal(b.retenues.cnps, Math.round((77250 + 56250) * 630 / 10000))
  })
  test('propositions', () => {
    assert.equal(propositionGratification(75000, 12), 56250)
    assert.equal(propositionGratification(75000, 6), 28125)
    assert.equal(propositionFeries(75000, 2), 5000)
    assert.equal(propositionFinCdd(1000000), 30000)
    assert.equal(propositionConges(1200000, 12, 3), 10000)
  })
})

describe('parametresPour', () => {
  test('la ligne la plus récente applicable au mois', () => {
    const lignes = [
      { applicable_du: '2026-11-01', valeurs: { smig: 75000 } },
      { applicable_du: '2027-01-01', valeurs: { smig: 80000 } },
    ]
    assert.equal(parametresPour(lignes, '2026-11-30').smig, 75000)
    assert.equal(parametresPour(lignes, '2027-01-31').smig, 80000)
    assert.equal(parametresPour([], '2026-11-30'), PARAMETRES_DEFAUT)
  })
})
```

- [ ] **Step 2 : lancer le test, il doit échouer**

Run : `node lib/paie.test.mjs`
Attendu : échec `Cannot find module '.../lib/paie.js'`.

- [ ] **Step 3 : écrire `lib/paie.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Bulletin de paie ivoirien — calcul pur (aucune lecture de l'horloge ni de la
// base). Reproduit au franc près les bulletins Sage de juillet 2026 :
// lib/paie.test.mjs. Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md
//
// Les taux sont en POUR DIX MILLE (630 = 6,30 %) : calcul entier, sans flottant
// (0,75 % × 75 000 = 562,5 doit donner 563, comme Sage).
// ──────────────────────────────────────────────────────────────────────────────

/** Valeurs légales au 01/11/2026. Copiées dans parametres_paie (applicable_du). */
export const PARAMETRES_DEFAUT = {
  smig: 75000,
  jours_base: 30,
  heures_mois: 173.33,
  cnps_salarie: 630,
  its_tranches: [
    { jusqua: 75000, taux: 0 },
    { jusqua: 240000, taux: 1600 },
    { jusqua: 800000, taux: 2100 },
    { jusqua: 2400000, taux: 2400 },
    { jusqua: 8000000, taux: 2800 },
    { jusqua: null, taux: 3200 },
  ],
  ricf_demi_part: 5500,
  parts_max: 5,
  cmu_par_personne: 500,
  plafond_pf_am_at: 75000,
  patronal: [
    { code: 470, libelle: 'RETRAITE GENERALE', taux: 770, plafonne: false },
    { code: 480, libelle: 'PRESTATION FAMILIALE', taux: 500, plafonne: true },
    { code: 481, libelle: 'ASSURANCE MATERNITE', taux: 75, plafonne: true },
    { code: 490, libelle: 'ACCIDENT DE TRAVAIL', taux: 200, plafonne: true },
    { code: 500, libelle: 'PART PATRONALE CN', taux: 120, plafonne: false },
    { code: 520, libelle: "TAXE D'APPRENTISSAGE", taux: 40, plafonne: false },
    { code: 530, libelle: 'TAXE F.P.C', taux: 60, plafonne: false },
    { code: 531, libelle: 'TFC à régulariser au 31/12', taux: 60, plafonne: false },
  ],
  anciennete_des_ans: 2,
  anciennete_par_an: 100,
  anciennete_max: 2500,
  arrondi: 100,
  conges_par_mois: 2.2,
  gratification: 7500,
  fin_cdd: 300,            // À VALIDER PAR LE COMPTABLE (3 % ou 6 %)
}

const taux = (montant, t) => Math.round((montant * t) / 10000)
const ent = v => Math.round(Number(v) || 0)

/** Années et mois complets entre l'embauche et `au` (AAAA-MM-JJ). */
export function anciennete(dateEmbauche, au) {
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateEmbauche || ''))
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(au || ''))
  if (!e || !a) return { ans: 0, mois: 0 }
  let mois = (Number(a[1]) - Number(e[1])) * 12 + (Number(a[2]) - Number(e[2]))
  if (Number(a[3]) < Number(e[3])) mois -= 1
  mois = Math.max(0, mois)
  return { ans: Math.floor(mois / 12), mois: mois % 12 }
}

/** Taux d'ancienneté (pour dix mille) : 1 % par année complète dès 2 ans, plafond 25 %. */
export function tauxAnciennete(ans, p = PARAMETRES_DEFAUT) {
  if (ans < p.anciennete_des_ans) return 0
  return Math.min(ans * p.anciennete_par_an, p.anciennete_max)
}

/** Impôt brut ITS (avant RICF) sur le brut imposable mensuel. */
export function impotBrutITS(brut, p = PARAMETRES_DEFAUT) {
  let reste = 0
  let bas = 0
  for (const t of p.its_tranches) {
    const haut = t.jusqua ?? Infinity
    if (brut > bas) reste += (Math.min(brut, haut) - bas) * t.taux
    bas = haut
  }
  return Math.round(reste / 10000)
}

/** Réduction pour charges de famille : 5 500 F par demi-part au-delà d'une part. */
export function ricf(parts, p = PARAMETRES_DEFAUT) {
  const pp = Math.min(Math.max(Number(parts) || 1, 1), p.parts_max)
  return Math.round((pp - 1) * 2) * p.ricf_demi_part
}

/**
 * Calcule un bulletin.
 * @param {object} e
 * @param {object} e.fiche  { salaire_categoriel, sursalaire, prime_transport, prime_tenue, parts_fiscales, personnes_cmu }
 * @param {string} e.dateEmbauche  AAAA-MM-JJ
 * @param {string} e.finPeriode    AAAA-MM-JJ (dernier jour du mois)
 * @param {number} [e.absences]    jours d'absence non justifiée
 * @param {Array}  [e.variables]   [{ code, libelle, montant }] — imposables
 * @param {number} [e.avances]     avances sur salaire du mois
 * @param {object} [p]             paramètres (PARAMETRES_DEFAUT)
 */
export function calculerBulletin({ fiche, dateEmbauche, finPeriode, absences = 0, variables = [], avances = 0 }, p = PARAMETRES_DEFAUT) {
  const joursPayes = Math.max(0, p.jours_base - Math.max(0, ent(absences)))
  const prorata = m => Math.round((ent(m) * joursPayes) / p.jours_base)

  const base = prorata(fiche.salaire_categoriel)
  const sursalaire = prorata(fiche.sursalaire)
  const anc = anciennete(dateEmbauche, finPeriode)
  const tauxAnc = tauxAnciennete(anc.ans, p)
  const primeAnciennete = taux(base, tauxAnc)

  const gains = [
    { code: 10, libelle: 'SALAIRE DE BASE', nombre: joursPayes, base: ent(fiche.salaire_categoriel), gain: base },
  ]
  if (sursalaire) gains.push({ code: 20, libelle: 'SURSALAIRE', nombre: joursPayes, base: ent(fiche.sursalaire), gain: sursalaire })
  if (primeAnciennete) gains.push({ code: 100, libelle: "PRIME D'ANCIENNETE", base, taux: tauxAnc, gain: primeAnciennete })
  for (const v of variables || []) {
    if (ent(v.montant)) gains.push({ code: v.code, libelle: v.libelle, gain: ent(v.montant) })
  }
  const brut = gains.reduce((s, g) => s + g.gain, 0)

  const cmu = p.cmu_par_personne * Math.max(1, ent(fiche.personnes_cmu))
  const cnps = taux(brut, p.cnps_salarie)
  const impotBrut = impotBrutITS(brut, p)
  const reduction = ricf(fiche.parts_fiscales, p)
  const its = Math.max(0, impotBrut - reduction)
  const chargesSalariales = cmu + cnps + its

  const plafonne = Math.min(brut, p.plafond_pf_am_at)
  const patronal = [
    { code: 415, libelle: 'CMU', base: null, taux: null, montant: cmu },
    ...p.patronal.map(l => {
      const b = l.plafonne ? plafonne : brut
      return { code: l.code, libelle: l.libelle, base: b, taux: l.taux, montant: taux(b, l.taux) }
    }),
  ]
  const chargesPatronales = patronal.reduce((s, l) => s + l.montant, 0)

  const transport = prorata(fiche.prime_transport)
  const tenue = ent(fiche.prime_tenue)
  const avance = Math.max(0, ent(avances))
  const avantArrondi = brut - chargesSalariales + transport + tenue - avance
  const net = avantArrondi <= 0 ? 0 : Math.ceil(avantArrondi / p.arrondi) * p.arrondi
  const arrondi = avantArrondi <= 0 ? 0 : net - avantArrondi

  return {
    joursPayes,
    anciennete: anc,
    gains,
    brut,
    retenues: { cmu, cnps, impotBrut, ricf: reduction, its },
    chargesSalariales,
    patronal,
    chargesPatronales,
    transport,
    tenue,
    avance,
    avanceNonCouverte: avantArrondi < 0 ? -avantArrondi : 0,
    arrondi,
    net,
    salaireBrutCumul: brut + transport,
    heures: Math.round(p.heures_mois * joursPayes / p.jours_base),
  }
}

// ── Éléments variables : propositions (la RH peut toujours modifier) ──────────

/** Gratification : 75 % du salaire catégoriel, au prorata des mois de présence dans l'année. */
export function propositionGratification(salaireCategoriel, moisPresence, p = PARAMETRES_DEFAUT) {
  const m = Math.min(12, Math.max(0, ent(moisPresence)))
  return Math.round((taux(ent(salaireCategoriel), p.gratification) * m) / 12)
}

/** Jours fériés payés : nombre × salaire catégoriel / 30. */
export function propositionFeries(salaireCategoriel, nombre, p = PARAMETRES_DEFAUT) {
  return Math.round((ent(salaireCategoriel) * Math.max(0, ent(nombre))) / p.jours_base)
}

/** Indemnité de fin de CDD : taux paramétré × brut total perçu pendant le contrat. */
export function propositionFinCdd(brutContrat, p = PARAMETRES_DEFAUT) {
  return taux(ent(brutContrat), p.fin_cdd)
}

/** Congés payés : brut moyen mensuel des 12 derniers mois / 30 × jours pris. */
export function propositionConges(brutDouzeMois, nbMois, jours, p = PARAMETRES_DEFAUT) {
  const mois = Math.max(1, Math.min(12, ent(nbMois)))
  return Math.round((ent(brutDouzeMois) / mois / p.jours_base) * Math.max(0, Number(jours) || 0))
}

/** Les paramètres applicables à un mois : la ligne la plus récente dont applicable_du ≤ fin du mois. */
export function parametresPour(lignes, finPeriode) {
  const ok = (lignes || [])
    .filter(l => String(l.applicable_du) <= String(finPeriode))
    .sort((a, b) => String(b.applicable_du).localeCompare(String(a.applicable_du)))
  return ok[0] ? { ...PARAMETRES_DEFAUT, ...ok[0].valeurs } : PARAMETRES_DEFAUT
}
```

- [ ] **Step 4 : lancer le test, il doit passer**

Run : `node lib/paie.test.mjs`
Attendu : `ℹ pass 16`, `ℹ fail 0`.

- [ ] **Step 5 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/paie.js lib/paie.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): calcul du bulletin ivoirien, au franc près des bulletins Sage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 : lignes de l'état (`lib/etatSalaire.js`)

**Files :**
- Create : `lib/etatSalaire.test.mjs`
- Create : `lib/etatSalaire.js`

**Interfaces :**
- Consumes : `jourIso(date)` de `lib/joursRepos.js` (1 = lundi … 7 = dimanche).
- Produces :
  - `TYPES_BULLETIN = ['CDD', 'CDI']`, `ELEMENTS_VARIABLES` (`{ code, cle, libelle }` : 300 gratification, 310 congés, 320 fériés, 330 fin_cdd), `MOTIFS_ABSENCE`
  - `estContractuel(type)`, `bornesMois(mois) → { debut, fin, nbJours }`
  - `joursAttendus({ dateEmbauche, finActivite, jourRepos }, mois) → string[]`, `joursPointes(presences, travailleurId) → Set`
  - `saisiesVides()`, `fusionnerSaisies(ancienne)`
  - `ligneEtat({ trav, presences, paiesGerant, mois, finContrat?, saisies? })` → ligne aux colonnes **exactes** de `lignes_etat_salaire` (sans `id`, `etat_id`, `bulletin`)
  - `construireEtat({ travailleurs, presences, paiesGerant, mois, anciennes?, finsContrat? }) → lignes[]`
  - `totauxEtat(lignes) → { du, deja_verse, reste_a_payer, brut, net, charges_patronales }` (lit `ligne.bulletin.calcul`)
  - `manquesFichePaie(fiche) → string[]`, `raisonsRefusSoumission({ lignes, fichesParTrav, mois, aujourdhui }) → string[]`

- [ ] **Step 1 : écrire le test**

```js
// Tests de lib/etatSalaire.js — qui figure dans l'état et combien il reste à payer.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  bornesMois, joursAttendus, joursPointes, ligneEtat, construireEtat, fusionnerSaisies,
  manquesFichePaie, raisonsRefusSoumission, totauxEtat, saisiesVides,
} from './etatSalaire.js'

const MOIS = '2026-11-01'
const pres = (travailleur_id, date, paye = 0, point_id = `${date}-p`) => ({ travailleur_id, date, paye, statut: 'Présent', point_id })

describe('bornesMois', () => {
  test('novembre et février', () => {
    assert.deepEqual(bornesMois('2026-11-01'), { debut: '2026-11-01', fin: '2026-11-30', nbJours: 30 })
    assert.deepEqual(bornesMois('2028-02'), { debut: '2028-02-01', fin: '2028-02-29', nbJours: 29 })
  })
})

describe('joursAttendus', () => {
  test('tout le mois sans repos : 30 jours', () => {
    assert.equal(joursAttendus({}, MOIS).length, 30)
  })
  test('repos le dimanche (7) : 30 − 5 dimanches = 25', () => {
    assert.equal(joursAttendus({ jourRepos: 7 }, MOIS).length, 25)
  })
  test('embauché le 16, parti le 25', () => {
    const j = joursAttendus({ dateEmbauche: '2026-11-16', finActivite: '2026-11-25' }, MOIS)
    assert.equal(j[0], '2026-11-16')
    assert.equal(j.at(-1), '2026-11-25')
    assert.equal(j.length, 10)
  })
  test('embauché après le mois : aucun jour', () => {
    assert.deepEqual(joursAttendus({ dateEmbauche: '2026-12-02' }, MOIS), [])
  })
})

describe('joursPointes', () => {
  test('deux shifts le même jour = un jour ; statut autre que Présent ignoré', () => {
    const p = [pres('t1', '2026-11-02'), pres('t1', '2026-11-02', 0, 'autre'), { ...pres('t1', '2026-11-03'), statut: 'Absent' }]
    assert.equal(joursPointes(p, 't1').size, 1)
  })
})

describe('ligneEtat', () => {
  const trav = { id: 't1', nom: 'Awa', type_contrat: 'CDI', salaire_journalier: 3000, jour_repos: 7 }
  test('dû, déjà versé, reste', () => {
    const presences = [pres('t1', '2026-11-02', 3000), pres('t1', '2026-11-03', 0), pres('t1', '2026-11-04', 1000)]
    const paiesGerant = [{ travailleur_id: 't1', montant: 2000 }]
    const l = ligneEtat({ trav, presences, paiesGerant, mois: MOIS })
    assert.equal(l.jours_pointes, 3)
    assert.equal(l.du, 9000)
    assert.equal(l.deja_verse, 6000)
    assert.equal(l.reste_a_payer, 3000)
    assert.equal(l.absences_non_justifiees, 25 - 3)
  })
  test('avance et absence justifiée saisies par la RH', () => {
    const saisies = { ...saisiesVides(), avances: [{ montant: 5000, motif: 'Avance du 10' }], absences_justifiees: [{ date: '2026-11-05', motif: 'Maladie' }] }
    const l = ligneEtat({ trav, presences: [pres('t1', '2026-11-02')], paiesGerant: [], mois: MOIS, saisies })
    assert.equal(l.deja_verse, 5000)
    assert.equal(l.reste_a_payer, 0)
    assert.equal(l.trop_verse, 2000)
    assert.equal(l.absences_non_justifiees, 25 - 1 - 1)
  })
  test('fin de contrat le 10 : jours attendus arrêtés au 10', () => {
    const l = ligneEtat({ trav: { ...trav, jour_repos: null }, presences: [], paiesGerant: [], mois: MOIS, finContrat: '2026-11-10' })
    assert.equal(l.jours_attendus, 10)
  })
})

describe('construireEtat', () => {
  const travailleurs = [
    { id: 'c', nom: 'Contrat', type_contrat: 'CDD', salaire_journalier: 3000 },
    { id: 's1', nom: 'Stagiaire payé', type_contrat: 'Stage', salaire_journalier: 2500 },
    { id: 's2', nom: 'Stagiaire pas payé', type_contrat: 'Journalier', salaire_journalier: 2500 },
  ]
  const presences = [pres('s1', '2026-11-02', 2500), pres('s2', '2026-11-02', 0)]

  test('CDD toujours là ; stagiaire seulement s\'il reste un dû', () => {
    const l = construireEtat({ travailleurs, presences, paiesGerant: [], mois: MOIS })
    assert.deepEqual(l.map(x => x.travailleur_id), ['c', 's2'])
  })
  test('recalcul : les saisies RH sont gardées', () => {
    const anciennes = [{ travailleur_id: 'c', avances: [{ montant: 1000, motif: 'x' }], absences_justifiees: [], elements_variables: [{ code: 300, montant: 56250 }] }]
    const l = construireEtat({ travailleurs, presences, paiesGerant: [], mois: MOIS, anciennes })
    const c = l.find(x => x.travailleur_id === 'c')
    assert.equal(c.total_avances, 1000)
    assert.equal(c.elements_variables[0].montant, 56250)
  })
  test('fusionnerSaisies sans ligne : vide', () => {
    assert.deepEqual(fusionnerSaisies(null), saisiesVides())
  })
  test('totaux', () => {
    const t = totauxEtat([{ du: 10, deja_verse: 4, reste_a_payer: 6, bulletin: { calcul: { brut: 100, net: 90, chargesPatronales: 20 } } }, { du: 5, deja_verse: 5, reste_a_payer: 0 }])
    assert.deepEqual(t, { du: 15, deja_verse: 9, reste_a_payer: 6, brut: 100, net: 90, charges_patronales: 20 })
  })
})

describe('soumission', () => {
  const fiche = { matricule: 'T02', categorie: '1', salaire_categoriel: 88007, numero_cnps: '000000000002', parts_fiscales: 3, personnes_cmu: 3, mode_paiement: 'especes' }
  test('fiche complète', () => assert.deepEqual(manquesFichePaie(fiche), []))
  test('fiche absente : tout manque', () => assert.equal(manquesFichePaie(null).length, 7))
  test('refus : mois pas fini et n° CNPS manquant', () => {
    const r = raisonsRefusSoumission({
      lignes: [{ travailleur_id: 't', nom: 'Koné', type_contrat: 'CDI' }, { travailleur_id: 's', nom: 'Stagiaire', type_contrat: 'Stage' }],
      fichesParTrav: { t: { ...fiche, numero_cnps: '' } },
      mois: MOIS, aujourdhui: '2026-11-30',
    })
    assert.deepEqual(r, ['Le mois n\'est pas encore terminé.', 'Il manque le n° CNPS de Koné.'])
  })
  test('accepté le 1er décembre avec fiches complètes', () => {
    const r = raisonsRefusSoumission({ lignes: [{ travailleur_id: 't', nom: 'Koné', type_contrat: 'CDI' }], fichesParTrav: { t: fiche }, mois: MOIS, aujourdhui: '2026-12-01' })
    assert.deepEqual(r, [])
  })
})
```

- [ ] **Step 2 : lancer le test, il doit échouer**

Run : `node lib/etatSalaire.test.mjs`
Attendu : échec `Cannot find module '.../lib/etatSalaire.js'`.

- [ ] **Step 3 : écrire `lib/etatSalaire.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// État de salaire du mois — logique pure (aucune lecture de l'horloge ni de la base).
//
// Une ligne par CDD/CDI du restaurant, plus les stagiaires (Stage, Journalier,
// sans type) à qui il reste quelque chose à payer.
//   dû          = jours pointés × salaire_journalier
//   déjà versé  = paies des présences + paies du gérant + avances saisies par la RH
//   reste       = max(0, dû − déjà versé)
// Les saisies de la RH (absences justifiées, éléments variables, avances) sont
// gardées d'un recalcul à l'autre (fusionnerSaisies).
// Tests : lib/etatSalaire.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { jourIso } from './joursRepos.js'

export const TYPES_BULLETIN = ['CDD', 'CDI']

export const ELEMENTS_VARIABLES = [
  { code: 300, cle: 'gratification', libelle: 'GRATIFICATION' },
  { code: 310, cle: 'conges', libelle: 'CONGES PAYES' },
  { code: 320, cle: 'feries', libelle: 'JOURS FERIES' },
  { code: 330, cle: 'fin_cdd', libelle: 'INDEMNITE DE FIN DE CDD' },
]

export const MOTIFS_ABSENCE = ['Congé', 'Maladie', 'Permission', 'Autre']

const n = v => Number(v) || 0
const somme = (l, f) => (l || []).reduce((s, x) => s + n(f(x)), 0)

export function estContractuel(type) {
  return TYPES_BULLETIN.includes(type)
}

/** '2026-11-01' (ou '2026-11') → { debut, fin, nbJours }. */
export function bornesMois(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  const nbJours = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { debut: `${a}-${mm}-01`, fin: `${a}-${mm}-${String(nbJours).padStart(2, '0')}`, nbJours }
}

function datesEntre(debut, fin) {
  const out = []
  for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Jours où le travailleur devait venir : du max(1er du mois, embauche) au
 * min(fin du mois, fin d'activité), sans son jour de repos (1 = lundi … 7 = dimanche).
 */
export function joursAttendus({ dateEmbauche, finActivite, jourRepos }, mois) {
  const { debut, fin } = bornesMois(mois)
  const de = dateEmbauche && dateEmbauche > debut ? dateEmbauche.slice(0, 10) : debut
  const a = finActivite && finActivite.slice(0, 10) < fin ? finActivite.slice(0, 10) : fin
  if (de > a) return []
  return datesEntre(de, a).filter(d => !(jourRepos >= 1 && jourRepos <= 7 && jourIso(d) === jourRepos))
}

/** Dates (AAAA-MM-JJ) où le travailleur est « Présent ». Plusieurs shifts le même jour = un jour. */
export function joursPointes(presences, travailleurId) {
  return new Set((presences || [])
    .filter(p => p.travailleur_id === travailleurId && p.statut === 'Présent' && p.date)
    .map(p => p.date))
}

/** Saisies RH vides. */
export function saisiesVides() {
  return { absences_justifiees: [], elements_variables: [], avances: [] }
}

/** Les saisies RH d'une ligne existante, à garder au recalcul. */
export function fusionnerSaisies(ancienne) {
  const v = saisiesVides()
  if (!ancienne) return v
  return {
    absences_justifiees: Array.isArray(ancienne.absences_justifiees) ? ancienne.absences_justifiees : v.absences_justifiees,
    elements_variables: Array.isArray(ancienne.elements_variables) ? ancienne.elements_variables : v.elements_variables,
    avances: Array.isArray(ancienne.avances) ? ancienne.avances : v.avances,
  }
}

/**
 * Une ligne d'état.
 * @param {object} e
 * @param {object} e.trav  travailleur (id, nom, poste, type_contrat, salaire_journalier, date_embauche, jour_repos, archived_at)
 * @param {Array}  e.presences   présences du restaurant sur le mois (avec `date`, `paye`, `statut`)
 * @param {Array}  e.paiesGerant paies du gérant rattachées (travailleur_id, montant)
 * @param {string} e.mois        '2026-11-01'
 * @param {string} [e.finContrat] fin du contrat en cours (AAAA-MM-JJ)
 * @param {object} [e.saisies]    saisies RH (fusionnerSaisies)
 */
export function ligneEtat({ trav, presences, paiesGerant, mois, finContrat = null, saisies = saisiesVides() }) {
  const finActivite = [trav.archived_at, finContrat].filter(Boolean).map(d => String(d).slice(0, 10)).sort()[0] || null
  const attendus = joursAttendus({ dateEmbauche: trav.date_embauche, finActivite, jourRepos: trav.jour_repos }, mois)
  const pointes = joursPointes(presences, trav.id)
  const justifiees = new Set((saisies.absences_justifiees || []).map(a => a.date))
  const absences = attendus.filter(d => !pointes.has(d) && !justifiees.has(d)).length

  const du = pointes.size * n(trav.salaire_journalier)
  const payePresences = somme((presences || []).filter(p => p.travailleur_id === trav.id && p.statut === 'Présent'), p => p.paye)
  const payeGerant = somme((paiesGerant || []).filter(d => d.travailleur_id === trav.id), d => d.montant)
  const avances = somme(saisies.avances, a => a.montant)
  const dejaVerse = payePresences + payeGerant + avances

  return {
    travailleur_id: trav.id,
    nom: trav.nom,
    poste: trav.poste || '',
    type_contrat: trav.type_contrat || null,
    salaire_journalier: n(trav.salaire_journalier),
    jours_attendus: attendus.length,
    jours_pointes: pointes.size,
    absences_non_justifiees: absences,
    ...saisies,
    du,
    deja_verse: dejaVerse,
    total_avances: avances,
    reste_a_payer: Math.max(0, du - dejaVerse),
    trop_verse: Math.max(0, dejaVerse - du),
  }
}

/**
 * Lignes de l'état d'un restaurant : CDD/CDI toujours, stagiaires seulement
 * s'il leur reste quelque chose. `anciennes` : lignes du brouillon précédent
 * (saisies RH conservées). `finsContrat` : { travailleur_id: 'AAAA-MM-JJ' }.
 */
export function construireEtat({ travailleurs, presences, paiesGerant, mois, anciennes = [], finsContrat = {} }) {
  const parTrav = Object.fromEntries((anciennes || []).map(l => [l.travailleur_id, l]))
  return (travailleurs || [])
    .map(trav => ligneEtat({
      trav, presences, paiesGerant, mois,
      finContrat: finsContrat[trav.id] || null,
      saisies: fusionnerSaisies(parTrav[trav.id]),
    }))
    .filter(l => estContractuel(l.type_contrat) || l.reste_a_payer > 0)
    .sort((a, b) => Number(estContractuel(b.type_contrat)) - Number(estContractuel(a.type_contrat)) || a.nom.localeCompare(b.nom))
}

export function totauxEtat(lignes) {
  return {
    du: somme(lignes, l => l.du),
    deja_verse: somme(lignes, l => l.deja_verse),
    reste_a_payer: somme(lignes, l => l.reste_a_payer),
    brut: somme(lignes, l => l.bulletin?.calcul?.brut),
    net: somme(lignes, l => l.bulletin?.calcul?.net),
    charges_patronales: somme(lignes, l => l.bulletin?.calcul?.chargesPatronales),
  }
}

const CHAMPS_FICHE = [
  ['matricule', 'le matricule'],
  ['categorie', 'la catégorie'],
  ['salaire_categoriel', 'le salaire catégoriel'],
  ['numero_cnps', 'le n° CNPS'],
  ['parts_fiscales', 'le nombre de parts'],
  ['personnes_cmu', 'les personnes CMU'],
  ['mode_paiement', 'le mode de paiement'],
]

/** Ce qui manque à une fiche paie (liste de libellés, vide = complète). */
export function manquesFichePaie(fiche) {
  if (!fiche) return CHAMPS_FICHE.map(([, l]) => l)
  return CHAMPS_FICHE.filter(([c]) => fiche[c] === null || fiche[c] === undefined || String(fiche[c]).trim() === '' || (c === 'salaire_categoriel' && n(fiche[c]) <= 0))
    .map(([, l]) => l)
}

/**
 * Peut-on soumettre l'état au manager ? Le mois doit être terminé et chaque
 * CDD/CDI doit avoir une fiche paie complète.
 * @returns {string[]} raisons du refus (vide = OK), en français courant
 */
export function raisonsRefusSoumission({ lignes, fichesParTrav, mois, aujourdhui }) {
  const raisons = []
  if (aujourdhui <= bornesMois(mois).fin) raisons.push('Le mois n\'est pas encore terminé.')
  for (const l of lignes || []) {
    if (!estContractuel(l.type_contrat)) continue
    const manques = manquesFichePaie(fichesParTrav[l.travailleur_id])
    if (manques.length) raisons.push(`Il manque ${manques.join(', ')} de ${l.nom}.`)
  }
  return raisons
}
```

- [ ] **Step 4 : lancer le test, il doit passer**

Run : `node lib/etatSalaire.test.mjs`
Attendu : `ℹ pass 17`, `ℹ fail 0`.

- [ ] **Step 5 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/etatSalaire.js lib/etatSalaire.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): lignes de l'état de salaire et règles de soumission

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 : bulletin complet (`lib/bulletin.js`)

**Files :**
- Create : `lib/bulletin.test.mjs`
- Create : `lib/bulletin.js`

**Interfaces :**
- Consumes : `calculerBulletin`, `PARAMETRES_DEFAUT` (tâche 2) ; `bornesMois` (tâche 3).
- Produces :
  - `VERSION_BULLETIN = 1`
  - `cumulsAnnee({ calcul, fiche, mois, precedents? }) → { periode, annee }` (clés `brut, net_imposable, charges_salariales, charges_patronales, heures`)
  - `congesBulletin({ fiche, mois, precedents?, joursPrisCeMois?, parMois? }) → { acquis, pris, pris_ce_mois, reste }`
  - `assemblerBulletin({ ligne, fiche, trav, resto, employeur, mois, parametres, precedents? }) → { version, periode: { debut, fin, paiement_le, mode_paiement }, employeur, salarie: { nom, matricule, coefficient, categorie, emploi, numero_cnps, adresse, affectation, type_contrat, date_embauche }, calcul, conges, cumuls }` — c'est l'objet figé dans `lignes_etat_salaire.bulletin`.

- [ ] **Step 1 : écrire le test**

```js
// Tests de lib/bulletin.js — en-tête, congés et cumuls de l'année.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { assemblerBulletin, cumulsAnnee, congesBulletin } from './bulletin.js'
import { PARAMETRES_DEFAUT } from './paie.js'

const fiche = {
  matricule: 'T01', coefficient: 1.5, categorie: '1', numero_cnps: '000000000001', mode_paiement: 'especes',
  salaire_categoriel: 75000, sursalaire: 0, prime_transport: 30000, prime_tenue: 3031, parts_fiscales: 2, personnes_cmu: 2,
}
const trav = { nom: 'Serveur D', poste: 'SERVEUR', date_embauche: '2023-03-01', lieu_residence: 'COCODY', type_contrat: 'CDI' }
const ligne = { absences_non_justifiees: 0, elements_variables: [], total_avances: 0 }
const base = { ligne, fiche, trav, resto: { nom: 'Angré 7E' }, employeur: { raison_sociale: 'CHEZ SAMER' }, parametres: PARAMETRES_DEFAUT }

describe('assemblerBulletin', () => {
  test('novembre 2026 sans reprise : cumuls = la période', () => {
    const b = assemblerBulletin({ ...base, mois: '2026-11-01' })
    assert.equal(b.periode.debut, '2026-11-01')
    assert.equal(b.periode.fin, '2026-11-30')
    assert.equal(b.salarie.matricule, 'T01')
    assert.equal(b.salarie.affectation, 'Angré 7E')
    assert.equal(b.calcul.net, 104500)
    assert.deepEqual(b.cumuls.annee, b.cumuls.periode)
    assert.equal(b.cumuls.periode.brut, 107250)
  })

  test('congés payés : les jours saisis comptent en « pris »', () => {
    const l = { ...ligne, elements_variables: [{ code: 310, libelle: 'CONGES PAYES', montant: 10000, jours: 3 }] }
    const b = assemblerBulletin({ ...base, ligne: l, mois: '2026-11-01' })
    assert.equal(b.conges.pris_ce_mois, 3)
    assert.equal(b.calcul.brut, 77250 + 10000)
  })
})

describe('cumulsAnnee', () => {
  const calcul = { salaireBrutCumul: 107250, brut: 77250, chargesSalariales: 5867, chargesPatronales: 14925, heures: 173 }
  test('reprise Sage au 31/10 + novembre validé + décembre', () => {
    const f = { ...fiche, cumuls_reprise_au: '2026-10-31', cumuls_reprise: { brut: 1000000, net_imposable: 700000, charges_salariales: 50000, charges_patronales: 140000, heures: 1730 } }
    const precedents = [{ periode: { debut: '2026-11-01' }, calcul }]
    const c = cumulsAnnee({ calcul, fiche: f, mois: '2026-12-01', precedents })
    assert.equal(c.annee.brut, 1000000 + 107250 * 2)
    assert.equal(c.annee.heures, 1730 + 173 * 2)
  })
  test('janvier 2027 : la reprise 2026 ne compte plus', () => {
    const f = { ...fiche, cumuls_reprise_au: '2026-10-31', cumuls_reprise: { brut: 1000000 } }
    const precedents = [{ periode: { debut: '2026-12-01' }, calcul }]
    const c = cumulsAnnee({ calcul, fiche: f, mois: '2027-01-01', precedents })
    assert.equal(c.annee.brut, 107250)
  })
})

describe('congesBulletin', () => {
  test('sans reprise en novembre : 11 mois depuis janvier ne sont pas connus → 1 mois compté', () => {
    const c = congesBulletin({ fiche, mois: '2026-11-01' })
    assert.deepEqual(c, { acquis: 2.2, pris: 0, pris_ce_mois: 0, reste: 2.2 })
  })
  test('reprise au 31/10 (acquis 22, reste 11) puis novembre et décembre, 3 jours pris en décembre', () => {
    const f = { ...fiche, cumuls_reprise_au: '2026-10-31', conges_acquis_reprise: 22, conges_reste_reprise: 11 }
    const precedents = [{ periode: { debut: '2026-11-01' }, conges: { pris_ce_mois: 0 } }]
    const c = congesBulletin({ fiche: f, mois: '2026-12-01', precedents, joursPrisCeMois: 3 })
    assert.deepEqual(c, { acquis: 26.4, pris: 3, pris_ce_mois: 3, reste: 12.4 })
  })
})
```

- [ ] **Step 2 : lancer le test, il doit échouer**

Run : `node lib/bulletin.test.mjs`
Attendu : échec `Cannot find module '.../lib/bulletin.js'`.

- [ ] **Step 3 : écrire `lib/bulletin.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Bulletin complet, prêt à figer dans lignes_etat_salaire.bulletin (jsonb) :
// calcul (lib/paie.js) + en-tête + congés + cumuls de l'année.
// Module pur. Tests : lib/bulletin.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { calculerBulletin } from './paie.js'
import { bornesMois } from './etatSalaire.js'

export const VERSION_BULLETIN = 1

const n = v => Number(v) || 0
const moisDe = iso => String(iso || '').slice(0, 7)

/** Reprise Sage applicable : même année que le mois, arrêtée avant ce mois. */
function repriseApplicable(fiche, mois) {
  const au = fiche?.cumuls_reprise_au
  if (!au || au.slice(0, 4) !== mois.slice(0, 4) || moisDe(au) >= moisDe(mois)) return null
  return au
}

/**
 * Cumuls de l'année : reprise Sage + bulletins validés de l'année (après la
 * reprise, avant ce mois) + ce mois.
 * `precedents` : bulletins figés ({ periode: { debut }, calcul }) du travailleur.
 */
export function cumulsAnnee({ calcul, fiche, mois, precedents = [] }) {
  const reprise = repriseApplicable(fiche, mois)
  const r = reprise ? fiche.cumuls_reprise || {} : {}
  const anterieurs = (precedents || []).filter(b => {
    const m = moisDe(b?.periode?.debut)
    return m.slice(0, 4) === mois.slice(0, 4) && m < moisDe(mois) && (!reprise || m > moisDe(reprise))
  })
  const somme = f => anterieurs.reduce((s, b) => s + n(f(b.calcul)), 0)
  const periode = {
    brut: calcul.salaireBrutCumul,
    net_imposable: calcul.brut,
    charges_salariales: calcul.chargesSalariales,
    charges_patronales: calcul.chargesPatronales,
    heures: calcul.heures,
  }
  return {
    periode,
    annee: {
      brut: n(r.brut) + somme(c => c.salaireBrutCumul) + periode.brut,
      net_imposable: n(r.net_imposable) + somme(c => c.brut) + periode.net_imposable,
      charges_salariales: n(r.charges_salariales) + somme(c => c.chargesSalariales) + periode.charges_salariales,
      charges_patronales: n(r.charges_patronales) + somme(c => c.chargesPatronales) + periode.charges_patronales,
      heures: n(r.heures) + somme(c => c.heures) + periode.heures,
    },
  }
}

/**
 * Congés (jours ouvrables) : acquis = reprise + 2,2 par mois depuis la reprise
 * (ou depuis janvier) ; pris = jours des congés payés saisis ; reste = reprise
 * du reste + acquis depuis − pris depuis.
 */
export function congesBulletin({ fiche, mois, precedents = [], joursPrisCeMois = 0, parMois = 2.2 }) {
  const reprise = repriseApplicable(fiche, mois)
  const debutComptage = reprise ? moisDe(reprise) : `${mois.slice(0, 4)}-00`
  const anterieurs = (precedents || []).filter(b => {
    const m = moisDe(b?.periode?.debut)
    return m > debutComptage && m < moisDe(mois)
  })
  const nbMois = anterieurs.length + 1
  const pris = anterieurs.reduce((s, b) => s + n(b?.conges?.pris_ce_mois), 0) + n(joursPrisCeMois)
  const acquisDepuis = Math.round(nbMois * parMois * 1000) / 1000
  return {
    acquis: Math.round(((reprise ? n(fiche.conges_acquis_reprise) : 0) + acquisDepuis) * 1000) / 1000,
    pris,
    pris_ce_mois: n(joursPrisCeMois),
    reste: Math.round(((reprise ? n(fiche.conges_reste_reprise) : 0) + acquisDepuis - pris) * 1000) / 1000,
  }
}

/**
 * Bulletin figé d'une ligne d'état.
 * @param {object} e
 * @param {object} e.ligne      ligne d'état (absences_non_justifiees, elements_variables, total_avances)
 * @param {object} e.fiche      fiche paie
 * @param {object} e.trav       travailleur (nom, poste, date_embauche, lieu_residence)
 * @param {object} e.resto      restaurant (nom)
 * @param {object} e.employeur  { raison_sociale, adresse, ville, numero_cnps, responsable, telephone }
 * @param {string} e.mois       '2026-11-01'
 * @param {object} e.parametres paramètres de paie (parametresPour)
 * @param {Array}  [e.precedents] bulletins figés de l'année
 */
export function assemblerBulletin({ ligne, fiche, trav, resto, employeur, mois, parametres, precedents = [] }) {
  const { debut, fin } = bornesMois(mois)
  const variables = (ligne.elements_variables || []).filter(v => n(v.montant) > 0)
  const calcul = calculerBulletin({
    fiche,
    dateEmbauche: trav.date_embauche,
    finPeriode: fin,
    absences: ligne.absences_non_justifiees,
    variables,
    avances: ligne.total_avances,
  }, parametres)
  const joursPrisCeMois = variables.filter(v => v.code === 310).reduce((s, v) => s + n(v.jours), 0)
  return {
    version: VERSION_BULLETIN,
    periode: { debut, fin, paiement_le: fin, mode_paiement: fiche.mode_paiement },
    employeur: employeur || {},
    salarie: {
      nom: trav.nom,
      matricule: fiche.matricule,
      coefficient: fiche.coefficient ?? null,
      categorie: fiche.categorie,
      emploi: trav.poste || '',
      numero_cnps: fiche.numero_cnps,
      adresse: trav.lieu_residence || '',
      affectation: resto?.nom || '',
      type_contrat: trav.type_contrat,
      date_embauche: trav.date_embauche,
    },
    calcul,
    conges: congesBulletin({ fiche, mois, precedents, joursPrisCeMois, parMois: parametres?.conges_par_mois ?? 2.2 }),
    cumuls: cumulsAnnee({ calcul, fiche, mois, precedents }),
  }
}
```

- [ ] **Step 4 : lancer le test, il doit passer**

Run : `node lib/bulletin.test.mjs`
Attendu : `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 5 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/bulletin.js lib/bulletin.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): bulletin figé — en-tête, congés et cumuls de l'année

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 : PDF des bulletins et de l'état (`lib/pdfBulletin.js`)

**Files :**
- Create : `lib/pdfBulletin.test.mjs`
- Create : `lib/pdfBulletin.js`

**Interfaces :**
- Consumes : objet `bulletin` de `assemblerBulletin` (tâche 4) ; `normaliserPourPdf` (`lib/pdfTexte.js`) ; `enregistrer(nomFichier, { base64 }, mime)` (`lib/exportRapportMensuel.js`, import dynamique seulement à l'exécution).
- Produces :
  - `nb(v)`, `tx(t)`, `dateCourte(iso)` (formats)
  - `lignesTableau(bulletin) → string[][]` (9 colonnes)
  - `documentBulletins(jsPDF, autoTable, bulletins) → jsPDF` (une page A4 par bulletin)
  - `telechargerBulletins(bulletins, nomFichier) → Promise`
  - `telechargerEtat({ resto, etat, lignes }) → Promise`

- [ ] **Step 1 : écrire le test**

```js
// Tests de lib/pdfBulletin.js — lignes du bulletin et génération du PDF sous Node.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { documentBulletins, lignesTableau, nb, tx, dateCourte } from './pdfBulletin.js'
import { assemblerBulletin } from './bulletin.js'
import { PARAMETRES_DEFAUT } from './paie.js'

const fiche = {
  matricule: 'T01', coefficient: 1.5, categorie: '1', numero_cnps: '000000000001', mode_paiement: 'especes',
  salaire_categoriel: 88007, sursalaire: 15000, prime_transport: 30000, prime_tenue: 3031, parts_fiscales: 3, personnes_cmu: 3,
}
const trav = { nom: 'Cuisinier A', poste: 'CUISINIER', date_embauche: '2018-03-01', lieu_residence: 'COCODY', type_contrat: 'CDI' }
const b = assemblerBulletin({
  ligne: { absences_non_justifiees: 0, elements_variables: [], total_avances: 0 },
  fiche, trav, resto: { nom: 'Angré 7E' }, employeur: { raison_sociale: 'CHEZ SAMER', adresse: '21 BP 915 ABIDJAN 21' },
  mois: '2026-11-01', parametres: PARAMETRES_DEFAUT,
})

describe('formats', () => {
  test('nombres, taux, dates', () => {
    assert.equal(nb(134700), '134 700')
    assert.equal(nb(null), '')
    assert.equal(tx(630), '6,30')
    assert.equal(tx(75), '0,75')
    assert.equal(dateCourte('2026-11-30'), '30/11/26')
  })
})

describe('lignesTableau', () => {
  const lignes = lignesTableau(b)
  const parLib = Object.fromEntries(lignes.map(l => [l[1], l]))
  test('gains, cotisations et arrondi dans l\'ordre du bulletin Sage', () => {
    assert.equal(lignes[0][1], 'SALAIRE DE BASE')
    assert.equal(parLib['Total Brut'][5], nb(b.calcul.brut))
    assert.equal(parLib['C.N.P.S'][6], nb(b.calcul.retenues.cnps))
    assert.equal(parLib['RETRAITE GENERALE'][7], '7,70')
    assert.equal(parLib['PRIME DE TRANSPORT'][5], '30 000')
    assert.ok(parLib['ARRONDI'])
  })
  test('pas de ligne ITS quand l\'ITS vaut 0', () => {
    assert.equal(parLib['ITS'], undefined)
  })
})

describe('documentBulletins', () => {
  test('une page par bulletin', () => {
    const doc = documentBulletins(jsPDF, autoTable, [b, b])
    assert.equal(doc.getNumberOfPages(), 2)
    assert.ok(doc.output('arraybuffer').byteLength > 1000)
  })
})
```

- [ ] **Step 2 : lancer le test, il doit échouer**

Run : `node lib/pdfBulletin.test.mjs`
Attendu : échec `Cannot find module '.../lib/pdfBulletin.js'`.

- [ ] **Step 3 : écrire `lib/pdfBulletin.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// PDF des bulletins (format des bulletins Sage) et de l'état de salaire.
// jsPDF (jamais expo-print : il ignore le HTML sur le web). Rien n'est stocké :
// tout est régénéré depuis le jsonb figé (lignes_etat_salaire.bulletin).
// Le découpage en lignes (lignesTableau) est pur et testé : lib/pdfBulletin.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { normaliserPourPdf as T } from './pdfTexte.js'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** 134700 → « 134 700 » (espace simple : les espaces fines cassent jsPDF). */
export const nb = v => (v === null || v === undefined || v === '' ? '' : Math.round(Number(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '))
/** 630 (pour dix mille) → « 6,30 ». */
export const tx = t => (t === null || t === undefined ? '' : (Number(t) / 100).toFixed(2).replace('.', ','))
/** '2026-11-30' → '30/11/26'. */
export const dateCourte = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '')

/**
 * Lignes du tableau central du bulletin :
 * [N°, Désignation, Nombre, Base, Taux sal., Gain, Retenue, Taux pat., Retenue pat.]
 */
export function lignesTableau(b) {
  const c = b.calcul
  const L = (code, lib, o = {}) => [code ?? '', lib, o.nombre ?? '', o.base ?? '', o.taux ?? '', o.gain ?? '', o.retenue ?? '', o.tauxPat ?? '', o.pat ?? '']
  const out = []
  for (const g of c.gains) {
    out.push(L(g.code, g.libelle, { nombre: g.nombre ? g.nombre.toFixed(2).replace('.', ',') : '', base: nb(g.base), taux: g.taux ? tx(g.taux) : '', gain: nb(g.gain) }))
  }
  out.push(L('', 'Total Brut', { gain: nb(c.brut) }))
  if (c.retenues.its) out.push(L(414, 'ITS', { retenue: nb(c.retenues.its), pat: '0' }))
  out.push(L(415, 'CMU', { retenue: nb(c.retenues.cmu), pat: nb(c.retenues.cmu) }))
  out.push(L(452, 'C.N.P.S', { base: nb(c.brut), taux: '6,30', retenue: nb(c.retenues.cnps) }))
  for (const p of c.patronal.filter(x => x.code !== 415)) {
    out.push(L(p.code, p.libelle, { base: nb(p.base), tauxPat: tx(p.taux), pat: nb(p.montant) }))
  }
  out.push(L('', 'Total Cotisations', { retenue: nb(c.chargesSalariales), pat: nb(c.chargesPatronales) }))
  out.push(L(412, 'Impôt brut avant RICF', { retenue: nb(c.retenues.impotBrut) }))
  if (c.retenues.ricf) out.push(L(413, 'RICF', { gain: nb(c.retenues.ricf) }))
  if (c.avance) out.push(L(661, 'AVANCE SUR SALAIRE', { retenue: nb(c.avance) }))
  if (c.transport) out.push(L(708, 'PRIME DE TRANSPORT', { nombre: c.joursPayes.toFixed(2).replace('.', ','), base: nb(Math.round(c.transport * 30 / Math.max(1, c.joursPayes))), gain: nb(c.transport) }))
  if (c.tenue) out.push(L(716, 'PRIME DE TENUE DE TRAVAIL', { gain: nb(c.tenue) }))
  if (c.arrondi) out.push(L(781, 'ARRONDI', { gain: nb(c.arrondi) }))
  return out
}

function moisLong(iso) {
  return `${NOMS_MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

function dessinerBulletin(doc, autoTable, b) {
  const M = 10
  const W = 210 - 2 * M
  const e = b.employeur || {}
  const s = b.salarie || {}
  doc.setDrawColor(120).setLineWidth(0.2)

  // Bandeau
  doc.setFillColor(225, 225, 225).rect(M, M, 60, 8, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0)
  doc.text('BULLETIN DE PAIE', M + 3, M + 6)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(`Période du : ${dateCourte(b.periode.debut)}   au : ${dateCourte(b.periode.fin)}`), M + 64, M + 5)
  doc.text(T(`Paiement le : ${dateCourte(b.periode.paiement_le)}   par : ${b.periode.mode_paiement === 'virement' ? 'Virement' : 'Espèces'}`), M + 130, M + 5)

  // Employeur
  doc.setFont('helvetica', 'bold').setFontSize(9)
  doc.text(T(e.raison_sociale || ''), M, M + 14)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(e.adresse || ''), M, M + 18)
  doc.text(T(e.ville || ''), M, M + 22)
  if (e.numero_cnps) doc.text(T(`N° CNPS employeur : ${e.numero_cnps}`), M, M + 26)

  // Identification
  const anc = b.calcul.anciennete
  autoTable(doc, {
    startY: M + 11, margin: { left: M + 64 }, tableWidth: W - 64, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['Matricule', 'Coefficient', 'Catégorie', 'Ancienneté', 'N° de Sécurité Sociale']],
    body: [[T(s.matricule || ''), T(String(s.coefficient ?? '').replace('.', ',')), T(s.categorie || ''), T(`${anc.ans} an(s) et ${anc.mois} mois`), T(s.numero_cnps || '')]],
  })
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY, margin: { left: M + 64 }, tableWidth: W - 64, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['Emploi occupé', 'Horaire', 'Convention']],
    body: [[T(s.emploi || ''), '173,330', 'CCN CONVENTION COLLECTIVE INTERPROFESSIONNELLE']],
  })

  // Salarié
  let y = doc.lastAutoTable.finalY + 4
  doc.setFillColor(235, 235, 235).rect(M + 64, y, W - 64, 16, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(10)
  doc.text(T(s.nom || ''), M + 68, y + 6)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(`${s.adresse || ''}${s.affectation ? `  ·  Affectation : ${s.affectation}` : ''}`), M + 68, y + 12)

  // Congés
  autoTable(doc, {
    startY: y, margin: { left: M }, tableWidth: 60, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'right' }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['', 'Acquis', 'Reste', 'Pris']],
    body: [['Congés', b.conges.acquis.toFixed(3).replace('.', ','), b.conges.reste.toFixed(3).replace('.', ','), b.conges.pris.toFixed(3).replace('.', ',')]],
  })

  // Lignes
  y = Math.max(doc.lastAutoTable.finalY, y + 16) + 5
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [225, 225, 225], textColor: 0 },
    head: [['N°', 'Désignation', 'Nombre', 'Base', 'Taux', 'Gain', 'Retenue', 'Taux pat.', 'Retenue pat.'].map(T)],
    body: lignesTableau(b).map(l => l.map(v => T(String(v)))),
    columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 55 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  })

  // Cumuls + net
  const cu = b.cumuls
  autoTable(doc, {
    startY: Math.max(doc.lastAutoTable.finalY + 6, 235), margin: { left: M, right: M + 40 }, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'right' }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['Cumuls', 'Salaire brut', 'Net imposable', 'Charges salariales', 'Charges patronales', 'Heures travaillées'].map(T)],
    body: [
      [T('Période'), nb(cu.periode.brut), nb(cu.periode.net_imposable), nb(cu.periode.charges_salariales), nb(cu.periode.charges_patronales), nb(cu.periode.heures)],
      [T('Année'), nb(cu.annee.brut), nb(cu.annee.net_imposable), nb(cu.annee.charges_salariales), nb(cu.annee.charges_patronales), nb(cu.annee.heures)],
    ],
  })
  const yNet = doc.lastAutoTable.finalY
  doc.setFillColor(225, 225, 225).rect(210 - M - 38, yNet - 16, 38, 16, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(8).text('NET A PAYER', 210 - M - 19, yNet - 11, { align: 'center' })
  doc.setFontSize(12).text(nb(b.calcul.net), 210 - M - 19, yNet - 3, { align: 'center' })

  doc.setFont('helvetica', 'normal').setFontSize(7)
  doc.text(T('Pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.'), M, yNet + 5)
  if (e.responsable) doc.text(T(`${e.responsable}${e.telephone ? ` · ${e.telephone}` : ''} — Responsable administratif`), M, yNet + 10)
}

async function enregistrerPdf(doc, nomFichier) {
  const { enregistrer } = await import('./exportRapportMensuel')
  return enregistrer(nomFichier, { base64: doc.output('datauristring').split(',')[1] }, 'application/pdf')
}

/** Document jsPDF, une page A4 par bulletin (séparé pour être testé sous Node). */
export function documentBulletins(jsPDF, autoTable, bulletins) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  bulletins.forEach((b, i) => {
    if (i > 0) doc.addPage()
    dessinerBulletin(doc, autoTable, b)
  })
  return doc
}

/** Télécharge un PDF, une page par bulletin. */
export async function telechargerBulletins(bulletins, nomFichier) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  return enregistrerPdf(documentBulletins(jsPDF, autoTable, bulletins), nomFichier)
}

/** État de salaire d'un restaurant (A4 paysage). */
export async function telechargerEtat({ resto, etat, lignes }) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold').setFontSize(14)
  doc.text(T(`État de salaire — ${resto.nom} — ${moisLong(etat.mois)}`), 10, 14)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(`Statut : ${etat.statut}${etat.valide_par_nom ? ` · validé par ${etat.valide_par_nom}` : ''}`), 10, 20)
  autoTable(doc, {
    startY: 25, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.2 }, headStyles: { fillColor: [47, 127, 216] },
    head: [['Travailleur', 'Contrat', 'Jours', 'Absences', 'Dû', 'Déjà versé', 'Reste à payer', 'Brut bulletin', 'Net bulletin'].map(T)],
    body: lignes.map(l => [T(l.nom), T(l.type_contrat || ''), l.jours_pointes, l.absences_non_justifiees, nb(l.du), nb(l.deja_verse), nb(l.reste_a_payer), nb(l.bulletin?.calcul?.brut), nb(l.bulletin?.calcul?.net)]),
    foot: [[T('Total'), '', '', '', nb(etat.totaux?.du), nb(etat.totaux?.deja_verse), nb(etat.totaux?.reste_a_payer), nb(etat.totaux?.brut), nb(etat.totaux?.net)]],
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  })
  return enregistrerPdf(doc, `Etat-salaire-${resto.nom}-${etat.mois.slice(0, 7)}.pdf`.replace(/\s+/g, '-'))
}
```

- [ ] **Step 4 : lancer le test, il doit passer**

Run : `node lib/pdfBulletin.test.mjs`
Attendu : `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 5 : contrôle visuel**

Générer un PDF d'essai et l'ouvrir (Read sur le fichier) : en-tête employeur, bloc matricule / ancienneté / n° CNPS, tableau dans l'ordre Sage (10, 20, 100, Total Brut, 414 si ITS, 415, 452, 470…531, Total Cotisations, 412, 413, 661, 708, 716, 781), cumuls période/année, encadré NET A PAYER.

```bash
node -e "
import('jspdf').then(async ({ jsPDF }) => {
  const { default: autoTable } = await import('jspdf-autotable')
  const { documentBulletins } = await import('./lib/pdfBulletin.js')
  const { assemblerBulletin } = await import('./lib/bulletin.js')
  const { PARAMETRES_DEFAUT } = await import('./lib/paie.js')
  const b = assemblerBulletin({ ligne: { absences_non_justifiees: 2, elements_variables: [], total_avances: 20000 },
    fiche: { matricule: 'T01', coefficient: 1.5, categorie: '1', numero_cnps: '000000000001', mode_paiement: 'especes', salaire_categoriel: 88007, sursalaire: 15000, prime_transport: 30000, prime_tenue: 3031, parts_fiscales: 1, personnes_cmu: 3 },
    trav: { nom: 'CUISINIER EXEMPLE', poste: 'CUISINIER', date_embauche: '2018-03-01', lieu_residence: 'COCODY', type_contrat: 'CDI' },
    resto: { nom: 'Angré 7E' }, employeur: { raison_sociale: 'CHEZ SAMER', adresse: '21 BP 915 ABIDJAN 21', ville: 'ABIDJAN COCODY' },
    mois: '2026-11-01', parametres: PARAMETRES_DEFAUT })
  require('fs').writeFileSync(process.env.TMPDIR + 'essai-bulletin.pdf', Buffer.from(documentBulletins(jsPDF, autoTable, [b]).output('arraybuffer')))
})"
```

- [ ] **Step 6 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/pdfBulletin.js lib/pdfBulletin.test.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): PDF des bulletins au format Sage et de l'état de salaire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 : couche base et circuit (`lib/paieDb.js`)

**Files :**
- Create : `lib/paieDb.js`

**Interfaces :**
- Consumes : `chargerPresences(plage, restoId)`, `chargerPaiesGerant(plage, restoId)` (`lib/equipeDb.js`) ; `dedupPresences`, `rattacherPaiesGerant` (`lib/equipe.js`) ; `contratEnCours`, `contratsSignes`, `finEffective` (`lib/contrats.js`) ; `marquePourResto(resto).id` ∈ `samer | alkayan | alabraise` (`lib/logos.js`) ; `journaliser` ; `creerNotification` ; tâches 2–4.
- Produces (utilisés par les tâches 7–8) :
  - `libelleMois(mois) → 'novembre 2026'`
  - `chargerFichesPaie(ids) → { travailleur_id: fiche }`, `enregistrerFichePaie(travailleurId, champs, ctx)`, `montantsDuContrat(contrats, aujourdhui) → { categorie, salaire_categoriel, prime_tenue, prime_transport }`, `compterFichesPaieIncompletes() → number`
  - `chargerParametresPaie()`, `chargerEmployeurs() → { marque: employeur }`, `enregistrerEmployeur(marque, champs, ctx)`
  - `chargerEtatsDuMois(mois) → { restaurant_id: etat }`, `chargerLignes(etatId)`, `chargerBulletinsTravailleur(travailleurId)`
  - `preparerEtat({ resto, mois, saisies? }, ctx) → { etat, lignes, fiches }`
  - `soumettreEtat({ etat, lignes, resto }, ctx, aujourdhui)`, `renvoyerEtat({ etat, resto }, motif, ctx)`
  - `validerEtat({ etat, resto }, ctx) → { avertissement }`, `rouvrirEtat({ etat, resto }, ctx)`
- Règles : un état non `brouillon` ne se recalcule pas ; la validation met à jour le dû `tresorerie_dus` (categorie `salaire`, un seul par restaurant et par mois — index unique `uniq_treso_du_mensuel`) **sans toucher un dû déjà payé** (avertissement) ; la réouverture est refusée si le dû a un paiement et remet le dû comme avant.

- [ ] **Step 1 : écrire `lib/paieDb.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Lectures / écritures de la paie (fiches paie, paramètres, employeurs, états
// de salaire, dû Trésorerie). Les calculs sont dans lib/paie.js,
// lib/etatSalaire.js et lib/bulletin.js (modules purs, testés).
// Migration : supabase_paie.sql
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { journaliser } from './journal'
import { creerNotification } from './notificationsInterne'
import { chargerPaiesGerant, chargerPresences } from './equipeDb'
import { dedupPresences, rattacherPaiesGerant } from './equipe'
import { contratEnCours, contratsSignes, finEffective } from './contrats'
import { marquePourResto } from './logos'
import { parametresPour } from './paie'
import { assemblerBulletin } from './bulletin'
import {
  TYPES_BULLETIN, bornesMois, construireEtat, estContractuel, manquesFichePaie, raisonsRefusSoumission, totauxEtat,
} from './etatSalaire'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-11-01' → « novembre 2026 ». */
export function libelleMois(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  return `${NOMS_MOIS[m - 1]} ${a}`
}

const ctxJournal = (ctx, restaurantId) => ({ userId: ctx?.userId || null, userNom: ctx?.userNom || null, restaurantId })

function erreur(error, message) {
  if (!error) return
  if (error.code === '42P01' || /does not exist/.test(error.message || '')) {
    throw new Error('La migration supabase_paie.sql n\'est pas encore passée.')
  }
  throw new Error(message)
}

// ── Fiches paie ──────────────────────────────────────────────────────────────

/** { travailleur_id: fiche } pour ces travailleurs. */
export async function chargerFichesPaie(travailleurIds) {
  if (!travailleurIds?.length) return {}
  const { data, error } = await supabase.from('fiches_paie').select('*').in('travailleur_id', travailleurIds)
  erreur(error, 'Impossible de lire les fiches paie.')
  return Object.fromEntries((data || []).map(f => [f.travailleur_id, f]))
}

const CHAMPS_FICHE = [
  'matricule', 'coefficient', 'categorie', 'salaire_categoriel', 'sursalaire', 'prime_transport', 'prime_tenue',
  'numero_cnps', 'parts_fiscales', 'personnes_cmu', 'mode_paiement',
  'cumuls_reprise', 'cumuls_reprise_au', 'conges_acquis_reprise', 'conges_reste_reprise',
]

export async function enregistrerFichePaie(travailleurId, champs, ctx) {
  const ligne = { travailleur_id: travailleurId, modifie_par_nom: ctx?.userNom || null, updated_at: new Date().toISOString() }
  for (const c of CHAMPS_FICHE) if (c in champs) ligne[c] = champs[c] === '' ? null : champs[c]
  const { error } = await supabase.from('fiches_paie').upsert(ligne, { onConflict: 'travailleur_id' })
  erreur(error, 'La fiche paie n\'a pas pu être enregistrée.')
  journaliser('fiche_paie_modifiee', { travailleur_id: travailleurId, champs: Object.keys(champs) }, ctxJournal(ctx, null))
}

/** Montants du contrat signé en cours, pour pré-remplir la fiche paie. */
export function montantsDuContrat(contrats, aujourdhui) {
  const c = contratEnCours(contratsSignes(contrats), aujourdhui)
  const d = c?.donnees || {}
  return {
    categorie: d.categorie ?? null,
    salaire_categoriel: d.salaire_categoriel ?? null,
    prime_tenue: d.prime_tenue ?? null,
    prime_transport: d.indemnite_transport ?? null,
  }
}

/** Nombre de CDD/CDI actifs dont la fiche paie est incomplète (badge de la tuile). */
export async function compterFichesPaieIncompletes() {
  const { data: travs, error } = await supabase.from('travailleurs').select('id')
    .in('type_contrat', TYPES_BULLETIN).neq('statut', 'archive').range(0, 999)
  if (error) return 0
  const fiches = await chargerFichesPaie((travs || []).map(t => t.id)).catch(() => null)
  if (!fiches) return 0
  return (travs || []).filter(t => manquesFichePaie(fiches[t.id]).length > 0).length
}

// ── Paramètres et employeurs ─────────────────────────────────────────────────

export async function chargerParametresPaie() {
  const { data, error } = await supabase.from('parametres_paie').select('applicable_du, valeurs').order('applicable_du')
  erreur(error, 'Impossible de lire les paramètres de paie.')
  return data || []
}

export async function chargerEmployeurs() {
  const { data, error } = await supabase.from('employeurs_paie').select('*')
  erreur(error, 'Impossible de lire les employeurs.')
  return Object.fromEntries((data || []).map(e => [e.marque, e]))
}

export async function enregistrerEmployeur(marque, champs, ctx) {
  const { error } = await supabase.from('employeurs_paie')
    .upsert({ marque, ...champs, updated_at: new Date().toISOString() }, { onConflict: 'marque' })
  erreur(error, 'L\'employeur n\'a pas pu être enregistré.')
  journaliser('employeur_paie_modifie', { marque }, ctxJournal(ctx, null))
}

// ── États ────────────────────────────────────────────────────────────────────

/** États d'un mois, tous restaurants : { restaurant_id: etat }. */
export async function chargerEtatsDuMois(mois) {
  const { data, error } = await supabase.from('etats_salaire').select('*').eq('mois', mois)
  erreur(error, 'Impossible de lire les états de salaire.')
  return Object.fromEntries((data || []).map(e => [e.restaurant_id, e]))
}

export async function chargerLignes(etatId) {
  const { data, error } = await supabase.from('lignes_etat_salaire').select('*').eq('etat_id', etatId).order('nom')
  erreur(error, 'Impossible de lire les lignes de l\'état.')
  return data || []
}

/** Bulletins figés de l'année avant `mois`, par travailleur : { id: [bulletin] }. */
async function chargerPrecedents(travailleurIds, mois) {
  if (!travailleurIds.length) return {}
  const { data, error } = await supabase.from('lignes_etat_salaire')
    .select('travailleur_id, bulletin, etats_salaire!inner(mois, statut)')
    .in('travailleur_id', travailleurIds)
    .eq('etats_salaire.statut', 'valide')
    .gte('etats_salaire.mois', `${mois.slice(0, 4)}-01-01`)
    .lt('etats_salaire.mois', mois)
  erreur(error, 'Impossible de lire les bulletins précédents.')
  const out = {}
  for (const l of data || []) if (l.bulletin) (out[l.travailleur_id] = out[l.travailleur_id] || []).push(l.bulletin)
  return out
}

/** Bulletins validés d'un travailleur (onglet de la fiche), du plus récent au plus ancien. */
export async function chargerBulletinsTravailleur(travailleurId) {
  const { data, error } = await supabase.from('lignes_etat_salaire')
    .select('id, bulletin, etats_salaire!inner(mois, statut)')
    .eq('travailleur_id', travailleurId).eq('etats_salaire.statut', 'valide')
  erreur(error, 'Impossible de lire les bulletins.')
  return (data || []).filter(l => l.bulletin)
    .sort((a, b) => String(b.etats_salaire.mois).localeCompare(String(a.etats_salaire.mois)))
}

/** Travailleurs de l'état : non archivés du restaurant + archivés pendant le mois. */
async function travailleursDuMois(restaurantId, mois) {
  const { debut } = bornesMois(mois)
  const { data, error } = await supabase.from('travailleurs').select('*')
    .eq('restaurant_id', restaurantId)
    .or(`statut.neq.archive,archived_at.gte.${debut}`)
    .range(0, 999)
  erreur(error, 'Impossible de lire l\'équipe.')
  return data || []
}

/**
 * Crée ou recalcule le brouillon d'un restaurant. Les saisies de la RH
 * (absences justifiées, éléments variables, avances) sont conservées.
 * `saisies` (facultatif) : { travailleur_id: saisies } à appliquer d'abord.
 */
export async function preparerEtat({ resto, mois, saisies = {} }, ctx) {
  const { debut, fin } = bornesMois(mois)
  const { data: existant, error: e1 } = await supabase.from('etats_salaire').select('*')
    .eq('restaurant_id', resto.id).eq('mois', mois).maybeSingle()
  erreur(e1, 'Impossible de lire l\'état.')
  if (existant && existant.statut !== 'brouillon') {
    throw new Error(existant.statut === 'valide'
      ? 'Cet état est validé : il ne peut plus être modifié.'
      : 'Cet état attend la validation du manager.')
  }

  const plage = { debut, fin }
  const [travailleurs, presencesBrutes, paiesBrutes, anciennes, parametres, employeurs] = await Promise.all([
    travailleursDuMois(resto.id, mois),
    chargerPresences(plage, resto.id),
    chargerPaiesGerant(plage, resto.id),
    existant ? chargerLignes(existant.id) : [],
    chargerParametresPaie(),
    chargerEmployeurs(),
  ])
  const ids = travailleurs.map(t => t.id)
  const { data: contrats } = await supabase.from('contrats_travailleurs').select('*').in('travailleur_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const finsContrat = {}
  for (const id of ids) {
    const c = contratEnCours(contratsSignes((contrats || []).filter(x => x.travailleur_id === id)), debut)
    if (c && finEffective(c)) finsContrat[id] = finEffective(c)
  }

  const anciennesAvecSaisies = anciennes.map(l => (saisies[l.travailleur_id] ? { ...l, ...saisies[l.travailleur_id] } : l))
  for (const [id, s] of Object.entries(saisies)) {
    if (!anciennes.some(l => l.travailleur_id === id)) anciennesAvecSaisies.push({ travailleur_id: id, ...s })
  }

  const lignes = construireEtat({
    travailleurs,
    presences: dedupPresences(presencesBrutes),
    paiesGerant: rattacherPaiesGerant(paiesBrutes, travailleurs),
    mois,
    anciennes: anciennesAvecSaisies,
    finsContrat,
  })

  const contractuels = lignes.filter(l => estContractuel(l.type_contrat)).map(l => l.travailleur_id)
  const [fiches, precedents] = await Promise.all([chargerFichesPaie(contractuels), chargerPrecedents(contractuels, mois)])
  const p = parametresPour(parametres, fin)
  const employeur = employeurs[marquePourResto(resto).id] || {}
  const travParId = Object.fromEntries(travailleurs.map(t => [t.id, t]))
  for (const l of lignes) {
    const fiche = fiches[l.travailleur_id]
    l.bulletin = estContractuel(l.type_contrat) && manquesFichePaie(fiche).length === 0
      ? assemblerBulletin({ ligne: l, fiche, trav: travParId[l.travailleur_id], resto, employeur, mois, parametres: p, precedents: precedents[l.travailleur_id] || [] })
      : null
  }

  const ligneEtat = {
    restaurant_id: resto.id, mois, statut: 'brouillon', totaux: totauxEtat(lignes),
    prepare_par_nom: ctx?.userNom || null, prepare_le: new Date().toISOString(),
  }
  const { data: etat, error: e2 } = existant
    ? await supabase.from('etats_salaire').update(ligneEtat).eq('id', existant.id).select().single()
    : await supabase.from('etats_salaire').insert(ligneEtat).select().single()
  erreur(e2, 'L\'état n\'a pas pu être enregistré.')

  const { error: e3 } = await supabase.from('lignes_etat_salaire').delete().eq('etat_id', etat.id)
  erreur(e3, 'L\'état n\'a pas pu être recalculé.')
  if (lignes.length) {
    const { error: e4 } = await supabase.from('lignes_etat_salaire').insert(lignes.map(l => ({ ...l, etat_id: etat.id })))
    erreur(e4, 'Les lignes de l\'état n\'ont pas pu être enregistrées.')
  }
  journaliser('etat_salaire_prepare', { mois, lignes: lignes.length, reste_a_payer: ligneEtat.totaux.reste_a_payer }, ctxJournal(ctx, resto.id))
  return { etat, lignes, fiches }
}

export async function soumettreEtat({ etat, lignes, resto }, ctx, aujourdhui) {
  const contractuels = lignes.filter(l => estContractuel(l.type_contrat)).map(l => l.travailleur_id)
  const fiches = await chargerFichesPaie(contractuels)
  const raisons = raisonsRefusSoumission({ lignes, fichesParTrav: fiches, mois: etat.mois, aujourdhui })
  if (raisons.length) throw new Error(raisons.join('\n'))
  const { error } = await supabase.from('etats_salaire').update({
    statut: 'soumis', soumis_par_nom: ctx?.userNom || null, soumis_le: new Date().toISOString(), renvoi_motif: null,
  }).eq('id', etat.id).eq('statut', 'brouillon')
  erreur(error, 'L\'état n\'a pas pu être envoyé.')
  creerNotification({
    type: 'etat_salaire', titre: `💰 État de salaire à valider — ${resto.nom}`,
    message: `${libelleMois(etat.mois)} : ${lignes.length} personnes, reste à payer ${Number(etat.totaux?.reste_a_payer || 0).toLocaleString('fr-FR')} F.`,
    restaurant_id: resto.id, cible_role: ['manager'], created_by: ctx?.userId || null, screen: '/salaires', params: { mois: etat.mois },
  }).catch(() => {})
  journaliser('etat_salaire_soumis', { mois: etat.mois }, ctxJournal(ctx, resto.id))
}

export async function renvoyerEtat({ etat, resto }, motif, ctx) {
  if (!String(motif || '').trim()) throw new Error('Dites à la RH ce qu\'il faut corriger.')
  const { error } = await supabase.from('etats_salaire').update({ statut: 'brouillon', renvoi_motif: motif.trim() })
    .eq('id', etat.id).eq('statut', 'soumis')
  erreur(error, 'L\'état n\'a pas pu être renvoyé.')
  creerNotification({
    type: 'etat_salaire', titre: `↩️ État de salaire renvoyé — ${resto.nom}`, message: `${libelleMois(etat.mois)} : ${motif.trim()}`,
    restaurant_id: resto.id, cible_role: ['rh'], created_by: ctx?.userId || null, screen: '/salaires', params: { mois: etat.mois },
  }).catch(() => {})
  journaliser('etat_salaire_renvoye', { mois: etat.mois, motif }, ctxJournal(ctx, resto.id))
}

async function paiementsDu(duId) {
  const { data } = await supabase.from('tresorerie_paiements').select('id').eq('du_id', duId).limit(1)
  return (data || []).length > 0
}

/**
 * Valide l'état : il se fige, et le reste à payer devient le dû « Salaires »
 * du restaurant pour ce mois (un seul par restaurant et par mois). Un dû déjà
 * payé en partie n'est pas modifié : on le signale.
 * @returns {{ avertissement: string|null }}
 */
export async function validerEtat({ etat, resto }, ctx) {
  const reste = Number(etat.totaux?.reste_a_payer || 0)
  const { data: du } = await supabase.from('tresorerie_dus').select('*')
    .eq('categorie', 'salaire').eq('restaurant_id', resto.id).eq('mois', etat.mois).maybeSingle()
  let duId = du?.id || null
  let creeParEtat = false
  let montantAvant = null
  let avertissement = null
  const note = `État de salaire validé par ${ctx?.userNom || 'le manager'}`
  if (!du) {
    const { data, error } = await supabase.from('tresorerie_dus').insert({
      categorie: 'salaire', restaurant_id: resto.id, mois: etat.mois, montant_du: reste, note,
      cree_par: ctx?.userId || null, cree_par_nom: ctx?.userNom || null,
    }).select('id').single()
    erreur(error, 'Le dû Trésorerie n\'a pas pu être créé.')
    duId = data.id
    creeParEtat = true
  } else if (await paiementsDu(du.id)) {
    avertissement = `Le dû « Salaires ${libelleMois(etat.mois)} » de ${resto.nom} a déjà reçu un paiement : son montant n'a pas été changé (${Number(du.montant_du).toLocaleString('fr-FR')} F au lieu de ${reste.toLocaleString('fr-FR')} F). Corrigez-le dans Trésorerie si besoin.`
  } else {
    montantAvant = du.montant_du
    const { error } = await supabase.from('tresorerie_dus').update({ montant_du: reste, note }).eq('id', du.id)
    erreur(error, 'Le dû Trésorerie n\'a pas pu être mis à jour.')
  }
  const { error } = await supabase.from('etats_salaire').update({
    statut: 'valide', valide_par_nom: ctx?.userNom || null, valide_le: new Date().toISOString(),
    du_id: duId, du_cree_par_etat: creeParEtat, du_montant_avant: montantAvant,
  }).eq('id', etat.id).eq('statut', 'soumis')
  erreur(error, 'L\'état n\'a pas pu être validé.')
  journaliser('etat_salaire_valide', { mois: etat.mois, reste_a_payer: reste, du_id: duId, avertissement }, ctxJournal(ctx, resto.id))
  return { avertissement }
}

/** Rouvre un état validé, seulement si son dû n'a reçu aucun paiement. */
export async function rouvrirEtat({ etat, resto }, ctx) {
  if (etat.du_id && await paiementsDu(etat.du_id)) {
    throw new Error('Les salaires de cet état ont déjà reçu un paiement dans Trésorerie : il ne peut plus être rouvert.')
  }
  if (etat.du_id && etat.du_cree_par_etat) {
    const { error } = await supabase.from('tresorerie_dus').delete().eq('id', etat.du_id)
    erreur(error, 'Le dû Trésorerie n\'a pas pu être retiré.')
  } else if (etat.du_id && etat.du_montant_avant !== null) {
    const { error } = await supabase.from('tresorerie_dus').update({ montant_du: etat.du_montant_avant }).eq('id', etat.du_id)
    erreur(error, 'Le dû Trésorerie n\'a pas pu être remis comme avant.')
  }
  const { error } = await supabase.from('etats_salaire').update({
    statut: 'brouillon', valide_par_nom: null, valide_le: null, du_id: null, du_cree_par_etat: false, du_montant_avant: null,
  }).eq('id', etat.id).eq('statut', 'valide')
  erreur(error, 'L\'état n\'a pas pu être rouvert.')
  journaliser('etat_salaire_rouvert', { mois: etat.mois }, ctxJournal(ctx, resto.id))
}
```

- [ ] **Step 2 : lint**

Run : `npm run lint`
Attendu : 0 erreur.

- [ ] **Step 3 : contrôle des requêtes en lecture (sans écrire)**

Une fois `supabase_paie.sql` passé par l'utilisateur, vérifier dans le SQL Editor de Samtrackly que la jointure des bulletins précédents est acceptée :

```sql
select l.travailleur_id, e.mois from lignes_etat_salaire l join etats_salaire e on e.id = l.etat_id
where e.statut = 'valide' limit 1;
```

Attendu : 0 ligne, sans erreur.

- [ ] **Step 4 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add lib/paieDb.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): préparation, soumission, validation des états et dû Trésorerie

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 : section « Paie » de la fiche travailleur

**Files :**
- Create : `components/equipe/SectionPaie.js`
- Modify : `components/equipe/FicheTravailleur.js` (imports, `useApp`, avant le bloc `{/* ─── Papiers ─── */}`)

**Interfaces :**
- Consumes : `chargerFichesPaie`, `enregistrerFichePaie`, `montantsDuContrat`, `chargerBulletinsTravailleur`, `libelleMois` (tâche 6) ; `manquesFichePaie` (tâche 3) ; `telechargerBulletins` (tâche 5) ; `contrats` déjà chargés par `FicheTravailleur` (`chargerContratsTravailleur`).
- Produces : `<SectionPaie trav contrats ctx colors accent />`.

- [ ] **Step 1 : écrire `components/equipe/SectionPaie.js`**

```js
// Section « Paie » de la fiche d'un CDD/CDI (RH et manager) : les champs du
// bulletin, pré-remplis depuis le contrat signé en cours, et les bulletins
// validés (PDF régénéré depuis le calcul figé).
// Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md § 4.2
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { manquesFichePaie } from '../../lib/etatSalaire'
import { chargerBulletinsTravailleur, chargerFichesPaie, enregistrerFichePaie, libelleMois, montantsDuContrat } from '../../lib/paieDb'
import { telechargerBulletins } from '../../lib/pdfBulletin'

const CHAMPS = [
  ['matricule', 'Matricule', 'default'],
  ['coefficient', 'Coefficient', 'decimal-pad'],
  ['categorie', 'Catégorie', 'default'],
  ['salaire_categoriel', 'Salaire catégoriel (F)', 'number-pad'],
  ['sursalaire', 'Sursalaire (F)', 'number-pad'],
  ['prime_transport', 'Prime de transport (F)', 'number-pad'],
  ['prime_tenue', 'Prime de tenue (F)', 'number-pad'],
  ['numero_cnps', 'N° CNPS', 'number-pad'],
  ['parts_fiscales', 'Parts fiscales (1 à 5, par demi-part)', 'decimal-pad'],
  ['personnes_cmu', 'Personnes couvertes CMU', 'number-pad'],
]
const NUMERIQUES = ['coefficient', 'salaire_categoriel', 'sursalaire', 'prime_transport', 'prime_tenue', 'parts_fiscales', 'personnes_cmu']

const versTexte = v => (v === null || v === undefined ? '' : String(v))
const versValeur = (cle, v) => {
  const t = String(v ?? '').trim().replace(',', '.')
  if (!NUMERIQUES.includes(cle)) return t || null
  return t === '' ? null : Number(t)
}

export default function SectionPaie({ trav, contrats, ctx, colors, accent }) {
  const [form, setForm] = useState(null)
  const [bulletins, setBulletins] = useState([])
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    let vivant = true
    setForm(null)
    Promise.all([chargerFichesPaie([trav.id]), chargerBulletinsTravailleur(trav.id)])
      .then(([fiches, b]) => {
        if (!vivant) return
        const fiche = fiches[trav.id] || {}
        const contrat = montantsDuContrat(contrats || [], aujourdhuiISO())
        const f = {}
        for (const [cle] of CHAMPS) f[cle] = versTexte(fiche[cle] ?? contrat[cle] ?? null)
        f.mode_paiement = fiche.mode_paiement || ''
        setForm(f)
        setBulletins(b)
      })
      .catch(e => vivant && Alert.alert('Paie', e.message))
    return () => { vivant = false }
  }, [trav.id, contrats])

  if (!form) return <ActivityIndicator color={accent} style={{ marginVertical: 16 }} />

  const valeurs = Object.fromEntries([...CHAMPS.map(([c]) => [c, versValeur(c, form[c])]), ['mode_paiement', form.mode_paiement || null]])
  const manques = manquesFichePaie(valeurs)

  async function enregistrer() {
    setOccupe(true)
    try {
      await enregistrerFichePaie(trav.id, valeurs, ctx)
      Alert.alert('Fiche paie', manques.length ? `Enregistrée. Il manque encore ${manques.join(', ')}.` : 'Fiche paie complète.')
    } catch (e) {
      Alert.alert('Fiche paie', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.text, backgroundColor: colors.surface, minHeight: 48 }
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>💼 Paie</Text>
      <Text style={{ color: manques.length ? '#C2410C' : '#047857', marginBottom: 10 }}>
        {manques.length ? `À compléter : ${manques.join(', ')}` : 'Fiche paie complète'}
      </Text>
      {CHAMPS.map(([cle, label, clavier]) => (
        <View key={cle} style={{ marginBottom: 8 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 3 }}>{label}</Text>
          <TextInput value={form[cle]} keyboardType={clavier} style={input}
            onChangeText={v => setForm(f => ({ ...f, [cle]: v }))} />
        </View>
      ))}
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 3 }}>Mode de paiement</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {[['especes', 'Espèces'], ['virement', 'Virement']].map(([cle, label]) => (
          <TouchableOpacity key={cle} onPress={() => setForm(f => ({ ...f, mode_paiement: cle }))}
            style={{ flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: accent, backgroundColor: form.mode_paiement === cle ? accent : 'transparent' }}>
            <Text style={{ color: form.mode_paiement === cle ? '#fff' : accent, fontWeight: '700' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={enregistrer} disabled={occupe}
        style={{ minHeight: 48, borderRadius: 12, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', opacity: occupe ? 0.5 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>{occupe ? 'Enregistrement…' : 'Enregistrer la fiche paie'}</Text>
      </TouchableOpacity>

      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginTop: 18, marginBottom: 6 }}>🧾 Bulletins</Text>
      {bulletins.length === 0
        ? <Text style={{ color: colors.textMuted }}>Aucun bulletin validé pour l'instant.</Text>
        : bulletins.map(l => (
          <TouchableOpacity key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
            onPress={() => telechargerBulletins([l.bulletin], `Bulletin-${trav.nom}-${l.etats_salaire.mois.slice(0, 7)}.pdf`.replace(/\s+/g, '-')).catch(e => Alert.alert('PDF', e.message))}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{libelleMois(l.etats_salaire.mois)}</Text>
            <Text style={{ color: accent, fontWeight: '800' }}>Net {Number(l.bulletin.calcul.net).toLocaleString('fr-FR')} F · PDF ›</Text>
          </TouchableOpacity>
        ))}
    </View>
  )
}
```

- [ ] **Step 2 : brancher dans `FicheTravailleur.js`**

Ajouter l'import après `import Avatar from './Avatar'` :

```js
import SectionPaie from './SectionPaie'
```

Remplacer `const { userNom } = useApp()` par :

```js
const { userId, userNom } = useApp()
```

Insérer juste avant `{/* ─── Papiers ─── */}` :

```jsx
          {peutEditer && !archive && ['CDD', 'CDI'].includes(trav.type_contrat) && contrats !== null && (
            <SectionPaie trav={trav} contrats={contrats} ctx={{ userId: userId || null, userNom: userNom || null }} colors={colors} accent={BLEU} />
          )}
```

- [ ] **Step 3 : lint et export web**

Run : `npm run lint && npx expo export -p web`
Attendu : 0 erreur de lint, export terminé sans erreur.

- [ ] **Step 4 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add components/equipe/SectionPaie.js components/equipe/FicheTravailleur.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(equipe): section Paie et bulletins dans la fiche des CDD/CDI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 : écran « Salaires du mois », tuile et badge

**Files :**
- Create : `app/salaires.js`
- Create : `components/salaires/DetailEtat.js`, `components/salaires/FeuilleLigne.js`, `components/salaires/FeuilleEmployeurs.js`
- Modify : `lib/menus.js` (TUILES + `ACCES_DEFAUT.rh`), `lib/groupesAccueil.js` (groupe `personnel` + `ICONES_TUILES`), `app/_layout.tsx` (Stack.Screen), `components/accueil/AccueilManager.js` (badge)

**Interfaces :**
- Consumes : tâche 6 (toutes les fonctions du circuit) ; tâches 3 et 2 (`ELEMENTS_VARIABLES`, `MOTIFS_ABSENCE`, `bornesMois`, `estContractuel`, propositions) ; tâche 5 (PDF) ; `EnTete, Pastille, Puces, Bouton, Champ, Feuille, Info, Libelle, useEcranModerne` (`components/ui/EcranModerne.js`) ; `ChampDate` (`components/ChampDate.js`) ; `chargerRestaurants` (`lib/equipeDb.js`) ; `useApp()` → `{ userId, userNom, roleActif }`.
- Produces : route `/salaires` (paramètre facultatif `mois=AAAA-MM-01`, utilisé par les notifications) ; tuile `salaires`.

- [ ] **Step 1 : écrire `app/salaires.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Salaires du mois — écran RH / manager.
//
// Une carte par restaurant : statut de l'état (à préparer, brouillon, soumis,
// validé) et ses totaux. Toucher une carte ouvre le détail (DetailEtat).
//   RH       prépare / recalcule, corrige une ligne, soumet au manager.
//   Manager  valide (l'état se fige, dû Trésorerie) ou renvoie avec un motif.
// Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import DetailEtat from '../components/salaires/DetailEtat'
import FeuilleEmployeurs from '../components/salaires/FeuilleEmployeurs'
import { EnTete, Pastille, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { chargerRestaurants } from '../lib/equipeDb'
import { chargerEtatsDuMois, libelleMois } from '../lib/paieDb'

export const STATUTS_ETAT = {
  aucun: { label: 'À préparer', couleur: '#64748B' },
  brouillon: { label: 'Brouillon RH', couleur: '#C2410C' },
  soumis: { label: 'À valider', couleur: '#2F6FD8' },
  valide: { label: 'Validé', couleur: '#047857' },
}

/** Mois précédent le mois en cours : c'est celui qu'on paie. */
function moisParDefaut(aujourdhui = new Date()) {
  const d = new Date(Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth() - 1, 1))
  return d.toISOString().slice(0, 10)
}
function decaler(mois, n) {
  const [a, m] = mois.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10)
}
const F = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`

export default function SalairesScreen() {
  const { userId, userNom, roleActif } = useApp() ?? {}
  const ctx = { userId: userId || null, userNom: userNom || null }
  const estManager = roleActif === 'manager' || roleActif === 'directeur'
  const { styles, colors, accent } = useEcranModerne('orange')
  const params = useLocalSearchParams()

  const [mois, setMois] = useState(typeof params.mois === 'string' ? params.mois : moisParDefaut())
  const [restaurants, setRestaurants] = useState([])
  const [etats, setEtats] = useState({})
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState('')
  const [ouvert, setOuvert] = useState(null)
  const [employeurs, setEmployeurs] = useState(false)

  useEffect(() => { charger() }, [mois])

  async function charger() {
    setLoading(true)
    setErreur('')
    try {
      const [r, e] = await Promise.all([chargerRestaurants(), chargerEtatsDuMois(mois)])
      setRestaurants(r)
      setEtats(e)
    } catch (e) {
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }

  const total = Object.values(etats).reduce((s, e) => s + Number(e.totaux?.reste_a_payer || 0), 0)

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Salaires du mois" sous={`Reste à payer : ${F(total)}`} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 10 }}>
        <TouchableOpacity onPress={() => setMois(decaler(mois, -1))} hitSlop={12} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, color: accent }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, textTransform: 'capitalize' }}>{libelleMois(mois)}</Text>
        <TouchableOpacity onPress={() => setMois(decaler(mois, 1))} hitSlop={12} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, color: accent }}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {erreur ? <Text style={[styles.infoTxt, { color: '#B91C1C', flex: 0, marginBottom: 12 }]}>{erreur}</Text> : null}
          {restaurants.map(r => {
            const e = etats[r.id]
            const cfg = STATUTS_ETAT[e?.statut || 'aucun']
            return (
              <TouchableOpacity key={r.id} style={styles.carte} activeOpacity={0.8} onPress={() => setOuvert(r)}>
                <View style={styles.carteTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.carteTitre}>{r.nom}</Text>
                    <Text style={styles.carteSous}>
                      {e ? `Reste à payer ${F(e.totaux?.reste_a_payer)} · brut bulletins ${F(e.totaux?.brut)}` : 'Aucun état pour ce mois'}
                    </Text>
                  </View>
                  <Text style={{ color: accent, fontWeight: '800' }}>Ouvrir ›</Text>
                </View>
                <Pastille cfg={cfg} styles={styles} />
                {e?.statut === 'brouillon' && e.renvoi_motif
                  ? <Text style={[styles.infoTxt, { color: '#C2410C', marginTop: 6, flex: 0 }]}>Renvoyé : {e.renvoi_motif}</Text>
                  : null}
              </TouchableOpacity>
            )
          })}
          {estManager && (
            <TouchableOpacity onPress={() => setEmployeurs(true)} style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: accent, fontWeight: '700' }}>🏢 Employeurs (en-tête des bulletins)</Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      <DetailEtat visible={!!ouvert} resto={ouvert} mois={mois} ctx={ctx} estManager={estManager}
        onFermer={() => { setOuvert(null); charger() }} />
      <FeuilleEmployeurs visible={employeurs} ctx={ctx} onFermer={() => setEmployeurs(false)} />
    </SafeAreaView>
  )
}
```

- [ ] **Step 2 : écrire `components/salaires/DetailEtat.js`**

```js
// Détail de l'état de salaire d'un restaurant pour un mois : lignes, actions
// selon le rôle et le statut, PDF. Les règles (fiches complètes, mois terminé,
// dû Trésorerie, réouverture) sont dans lib/paieDb.js.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'

import FeuilleLigne from './FeuilleLigne'
import { Bouton, Champ, Feuille, Info, useEcranModerne } from '../ui/EcranModerne'
import { aujourdhuiISO } from '../../lib/contrats'
import { estContractuel } from '../../lib/etatSalaire'
import { chargerEtatsDuMois, chargerLignes, libelleMois, preparerEtat, renvoyerEtat, rouvrirEtat, soumettreEtat, validerEtat } from '../../lib/paieDb'
import { telechargerBulletins, telechargerEtat } from '../../lib/pdfBulletin'

const F = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`

export default function DetailEtat({ visible, resto, mois, ctx, estManager, onFermer }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [etat, setEtat] = useState(null)
  const [lignes, setLignes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [occupe, setOccupe] = useState(false)
  const [ligneOuverte, setLigneOuverte] = useState(null)
  const [renvoi, setRenvoi] = useState(false)
  const [motif, setMotif] = useState('')

  useEffect(() => { if (visible && resto) charger() }, [visible, resto?.id, mois])

  async function charger() {
    setChargement(true)
    setRenvoi(false); setMotif('')
    try {
      const e = (await chargerEtatsDuMois(mois))[resto.id] || null
      setEtat(e)
      setLignes(e ? await chargerLignes(e.id) : [])
    } catch (e) {
      Alert.alert('Salaires', e.message)
    } finally {
      setChargement(false)
    }
  }

  async function agir(action, succes) {
    setOccupe(true)
    try {
      const r = await action()
      await charger()
      if (r?.avertissement) Alert.alert('Attention', r.avertissement)
      else if (succes) Alert.alert('Salaires', succes)
    } catch (e) {
      Alert.alert('Salaires', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const preparer = (saisies = {}) => agir(() => preparerEtat({ resto, mois, saisies }, ctx))
  const statut = etat?.statut || null
  const bulletins = lignes.filter(l => l.bulletin).map(l => l.bulletin)

  if (!resto) return null
  return (
    <>
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={resto.nom}
      sous={`État de salaire — ${libelleMois(mois)}${etat?.valide_par_nom ? ` · validé par ${etat.valide_par_nom}` : ''}`}>
      {chargement ? <ActivityIndicator size="large" color={accent} /> : (
        <>
          {etat && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {[['Reste à payer', etat.totaux?.reste_a_payer], ['Déjà versé', etat.totaux?.deja_verse], ['Brut bulletins', etat.totaux?.brut], ['Charges patronales', etat.totaux?.charges_patronales]].map(([l, v]) => (
                <View key={l} style={{ minWidth: 140, flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>{l}</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{F(v)}</Text>
                </View>
              ))}
            </View>
          )}
          {etat?.renvoi_motif && statut === 'brouillon'
            ? <Info icone="↩️" styles={styles} couleur="#C2410C">Renvoyé par le manager : {etat.renvoi_motif}</Info>
            : null}

          {lignes.map(l => (
            <TouchableOpacity key={l.id} disabled={statut !== 'brouillon' || estManager} onPress={() => setLigneOuverte(l)}
              style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
                  {l.nom} <Text style={{ color: colors.textMuted, fontWeight: '400' }}>· {l.type_contrat || 'Stage'}</Text>
                </Text>
                <Text style={{ color: l.reste_a_payer > 0 ? accent : colors.textMuted, fontWeight: '800' }}>{F(l.reste_a_payer)}</Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {l.jours_pointes} j pointés · {l.absences_non_justifiees} absence(s) · dû {F(l.du)} · versé {F(l.deja_verse)}
                {l.bulletin ? ` · net bulletin ${F(l.bulletin.calcul.net)}` : ''}
              </Text>
              {estContractuel(l.type_contrat) && !l.bulletin
                ? <Text style={{ color: '#C2410C', fontSize: 12, marginTop: 2 }}>⚠ Fiche paie incomplète : pas de bulletin</Text>
                : null}
            </TouchableOpacity>
          ))}

          <View style={{ gap: 10, marginTop: 16 }}>
            {!estManager && (statut === null || statut === 'brouillon') && (
              <Bouton styles={styles} grand couleur={accent} variante="teinte" disabled={occupe}
                label={statut ? '🔄 Recalculer' : '🧮 Préparer l\'état'} onPress={() => preparer()} />
            )}
            {!estManager && statut === 'brouillon' && (
              <Bouton styles={styles} grand couleur={accent} variante="plein" disabled={occupe} label="📤 Soumettre au manager"
                onPress={() => agir(() => soumettreEtat({ etat, lignes, resto }, ctx, aujourdhuiISO()), 'État envoyé au manager.')} />
            )}
            {estManager && statut === 'soumis' && !renvoi && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Bouton styles={styles} flex couleur="#B91C1C" variante="contour" disabled={occupe} label="↩️ Renvoyer" onPress={() => setRenvoi(true)} />
                <Bouton styles={styles} flex couleur="#047857" variante="plein" disabled={occupe} label="✅ Valider"
                  onPress={() => agir(() => validerEtat({ etat, resto }, ctx), 'État validé : le reste à payer est dans Trésorerie.')} />
              </View>
            )}
            {renvoi && (
              <>
                <Champ styles={styles} colors={colors} multiline value={motif} onChangeText={setMotif} placeholder="Ce qu'il faut corriger" />
                <Bouton styles={styles} grand couleur="#B91C1C" variante="plein" disabled={occupe} label="Renvoyer à la RH"
                  onPress={() => agir(() => renvoyerEtat({ etat, resto }, motif, ctx), 'État renvoyé à la RH.')} />
              </>
            )}
            {statut === 'valide' && (
              <>
                <Bouton styles={styles} grand couleur={accent} variante="plein" disabled={occupe || !bulletins.length} label={`🧾 Bulletins PDF (${bulletins.length})`}
                  onPress={() => telechargerBulletins(bulletins, `Bulletins-${resto.nom}-${mois.slice(0, 7)}.pdf`.replace(/\s+/g, '-')).catch(e => Alert.alert('PDF', e.message))} />
                <Bouton styles={styles} grand couleur={accent} variante="teinte" disabled={occupe} label="📄 État PDF"
                  onPress={() => telechargerEtat({ resto, etat, lignes }).catch(e => Alert.alert('PDF', e.message))} />
                {estManager && (
                  <Bouton styles={styles} couleur="#B91C1C" variante="contour" disabled={occupe} label="Rouvrir l'état"
                    onPress={() => agir(() => rouvrirEtat({ etat, resto }, ctx), 'État rouvert : la RH peut le corriger.')} />
                )}
              </>
            )}
            {statut === 'soumis' && !estManager && <Info icone="⏳" styles={styles}>En attente de validation par le manager.</Info>}
          </View>
        </>
      )}

    </Feuille>
    <FeuilleLigne visible={!!ligneOuverte} ligne={ligneOuverte} mois={mois} onFermer={() => setLigneOuverte(null)}
      onEnregistrer={async saisies => {
        const id = ligneOuverte.travailleur_id
        setLigneOuverte(null)
        await preparer({ [id]: saisies })
      }} />
    </>
  )
}
```

- [ ] **Step 3 : écrire `components/salaires/FeuilleLigne.js`**

```js
// Saisies de la RH sur une ligne d'état : absences justifiées, éléments
// variables du brut (avec proposition calculée), avances. Chaque saisie porte
// un motif. Enregistrer = recalcul de l'état (les saisies sont conservées).
import { useEffect, useState } from 'react'
import { Alert, Text, TouchableOpacity, View } from 'react-native'

import ChampDate from '../ChampDate'
import { Bouton, Champ, Feuille, Libelle, Puces, useEcranModerne } from '../ui/EcranModerne'
import { ELEMENTS_VARIABLES, MOTIFS_ABSENCE, bornesMois } from '../../lib/etatSalaire'
import { PARAMETRES_DEFAUT, propositionConges, propositionFeries, propositionFinCdd, propositionGratification } from '../../lib/paie'

const F = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`
const entier = v => Math.max(0, parseInt(String(v).replace(/\D/g, ''), 10) || 0)

/** Proposition pour un élément variable, depuis le bulletin brouillon de la ligne. */
function proposer(cle, ligne, jours) {
  const b = ligne.bulletin
  const categoriel = b?.calcul?.gains?.find(g => g.code === 10)?.base || 0
  const moisDuMois = Number(String(b?.periode?.debut || '').slice(5, 7)) || 12
  const brutAnnee = b?.cumuls?.annee?.net_imposable || 0
  if (cle === 'gratification') return propositionGratification(categoriel, Math.min(12, moisDuMois), PARAMETRES_DEFAUT)
  if (cle === 'feries') return propositionFeries(categoriel, jours, PARAMETRES_DEFAUT)
  if (cle === 'fin_cdd') return propositionFinCdd(brutAnnee, PARAMETRES_DEFAUT)
  if (cle === 'conges') return propositionConges(brutAnnee, moisDuMois, jours, PARAMETRES_DEFAUT)
  return 0
}

export default function FeuilleLigne({ visible, ligne, mois, onFermer, onEnregistrer }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [absences, setAbsences] = useState([])
  const [variables, setVariables] = useState([])
  const [avances, setAvances] = useState([])
  const [ajout, setAjout] = useState(null) // { type: 'absence'|'variable'|'avance', ... }

  useEffect(() => {
    if (!visible || !ligne) return
    setAbsences(ligne.absences_justifiees || [])
    setVariables(ligne.elements_variables || [])
    setAvances(ligne.avances || [])
    setAjout(null)
  }, [visible, ligne])

  if (!ligne) return null
  const { debut, fin } = bornesMois(mois)
  const aBulletin = !!ligne.bulletin

  function valider() {
    if (!ajout) return
    if (!String(ajout.motif || '').trim()) { Alert.alert('Motif', 'Le motif est obligatoire.'); return }
    if (ajout.type === 'absence') {
      if (!ajout.date) { Alert.alert('Absence', 'Choisissez la date.'); return }
      setAbsences(a => [...a.filter(x => x.date !== ajout.date), { date: ajout.date, motif: ajout.motif.trim() }])
    }
    if (ajout.type === 'variable') {
      const def = ELEMENTS_VARIABLES.find(e => e.cle === ajout.cle)
      if (!def || !entier(ajout.montant)) { Alert.alert('Élément', 'Choisissez l\'élément et son montant.'); return }
      setVariables(v => [...v.filter(x => x.code !== def.code), { code: def.code, libelle: def.libelle, montant: entier(ajout.montant), jours: entier(ajout.jours) || undefined, motif: ajout.motif.trim() }])
    }
    if (ajout.type === 'avance') {
      if (!entier(ajout.montant)) { Alert.alert('Avance', 'Saisissez le montant.'); return }
      setAvances(a => [...a, { montant: entier(ajout.montant), motif: ajout.motif.trim() }])
    }
    setAjout(null)
  }

  const retirer = (setter, i) => setter(l => l.filter((_, j) => j !== i))
  const ligneListe = (texte, onRetirer, i) => (
    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ flex: 1, color: colors.text }}>{texte}</Text>
      <TouchableOpacity onPress={onRetirer} hitSlop={10} style={{ minWidth: 48, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#B91C1C', fontWeight: '800' }}>Retirer</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={ligne.nom}
      sous={`${ligne.jours_pointes} jours pointés · ${ligne.absences_non_justifiees} absence(s) non justifiée(s) · reste ${F(ligne.reste_a_payer)}`}>
      <Libelle styles={styles}>Absences justifiées</Libelle>
      {absences.length ? absences.map((a, i) => ligneListe(`${a.date.slice(8, 10)}/${a.date.slice(5, 7)} — ${a.motif}`, () => retirer(setAbsences, i), i))
        : <Text style={{ color: colors.textMuted }}>Aucune.</Text>}

      {aBulletin && (
        <>
          <Libelle styles={styles}>Éléments variables du brut</Libelle>
          {variables.length ? variables.map((v, i) => ligneListe(`${v.libelle}${v.jours ? ` (${v.jours} j)` : ''} — ${F(v.montant)} — ${v.motif}`, () => retirer(setVariables, i), i))
            : <Text style={{ color: colors.textMuted }}>Aucun.</Text>}
        </>
      )}

      <Libelle styles={styles}>Avances sur salaire</Libelle>
      {avances.length ? avances.map((a, i) => ligneListe(`${F(a.montant)} — ${a.motif}`, () => retirer(setAvances, i), i))
        : <Text style={{ color: colors.textMuted }}>Aucune.</Text>}

      {!ajout ? (
        <View style={{ gap: 8, marginTop: 14 }}>
          <Bouton styles={styles} couleur={accent} label="+ Absence justifiée" onPress={() => setAjout({ type: 'absence', motif: MOTIFS_ABSENCE[0] })} />
          {aBulletin && <Bouton styles={styles} couleur={accent} label="+ Élément variable" onPress={() => setAjout({ type: 'variable', cle: 'gratification', montant: '', jours: '', motif: '' })} />}
          <Bouton styles={styles} couleur={accent} label="+ Avance" onPress={() => setAjout({ type: 'avance', montant: '', motif: '' })} />
        </View>
      ) : (
        <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceAlt, gap: 8 }}>
          {ajout.type === 'absence' && (
            <>
              <ChampDate label="Date de l'absence" valeur={ajout.date} minDate={debut} maxDate={fin} couleur={accent}
                onChange={d => setAjout(a => ({ ...a, date: d }))} />
              <Puces styles={styles} actif={ajout.motif} onChoisir={m => setAjout(a => ({ ...a, motif: m }))}
                elements={MOTIFS_ABSENCE.map(m => ({ cle: m, label: m }))} />
            </>
          )}
          {ajout.type === 'variable' && (
            <>
              <Puces styles={styles} actif={ajout.cle} onChoisir={c => setAjout(a => ({ ...a, cle: c, montant: '' }))}
                elements={ELEMENTS_VARIABLES.map(e => ({ cle: e.cle, label: e.libelle.toLowerCase() }))} />
              {(ajout.cle === 'conges' || ajout.cle === 'feries') && (
                <Champ styles={styles} colors={colors} keyboardType="number-pad" value={ajout.jours} placeholder="Nombre de jours"
                  onChangeText={j => setAjout(a => ({ ...a, jours: j }))} />
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Champ styles={styles} colors={colors} keyboardType="number-pad" value={String(ajout.montant)} placeholder="Montant (F)"
                    onChangeText={m => setAjout(a => ({ ...a, montant: m }))} />
                </View>
                <Bouton styles={styles} couleur={accent} label="Proposer" onPress={() => setAjout(a => ({ ...a, montant: String(proposer(a.cle, ligne, entier(a.jours))) }))} />
              </View>
              <Champ styles={styles} colors={colors} value={ajout.motif} placeholder="Motif (obligatoire)" onChangeText={m => setAjout(a => ({ ...a, motif: m }))} />
            </>
          )}
          {ajout.type === 'avance' && (
            <>
              <Champ styles={styles} colors={colors} keyboardType="number-pad" value={ajout.montant} placeholder="Montant (F)"
                onChangeText={m => setAjout(a => ({ ...a, montant: m }))} />
              <Champ styles={styles} colors={colors} value={ajout.motif} placeholder="Motif (obligatoire)" onChangeText={m => setAjout(a => ({ ...a, motif: m }))} />
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton styles={styles} flex couleur={colors.textMuted} variante="contour" label="Annuler" onPress={() => setAjout(null)} />
            <Bouton styles={styles} flex couleur={accent} variante="plein" label="Ajouter" onPress={valider} />
          </View>
        </View>
      )}

      <View style={{ marginTop: 18 }}>
        <Bouton styles={styles} grand couleur={accent} variante="plein" label="Enregistrer et recalculer"
          onPress={() => onEnregistrer({ absences_justifiees: absences, elements_variables: variables, avances })} />
      </View>
    </Feuille>
  )
}
```

- [ ] **Step 4 : écrire `components/salaires/FeuilleEmployeurs.js`**

```js
// En-tête des bulletins : l'employeur de chaque marque (manager).
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'

import { Bouton, Champ, Feuille, Libelle, Puces, useEcranModerne } from '../ui/EcranModerne'
import { chargerEmployeurs, enregistrerEmployeur } from '../../lib/paieDb'

const MARQUES = [['samer', 'Chez Samer'], ['alkayan', 'Al Kayan'], ['alabraise', 'À la Braise']]
const CHAMPS = [
  ['raison_sociale', 'Raison sociale'], ['adresse', 'Adresse (BP)'], ['ville', 'Ville, commune'],
  ['numero_cnps', 'N° CNPS employeur'], ['numero_contribuable', 'N° compte contribuable'],
  ['responsable', 'Responsable administratif'], ['telephone', 'Téléphone'],
]

export default function FeuilleEmployeurs({ visible, ctx, onFermer }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [tous, setTous] = useState(null)
  const [marque, setMarque] = useState('samer')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible) return
    setTous(null)
    chargerEmployeurs().then(setTous).catch(e => { Alert.alert('Employeurs', e.message); onFermer() })
  }, [visible])

  const e = tous?.[marque] || {}
  const changer = (c, v) => setTous(t => ({ ...t, [marque]: { ...(t?.[marque] || {}), [c]: v } }))

  async function enregistrer() {
    setOccupe(true)
    try {
      const champs = Object.fromEntries(CHAMPS.map(([c]) => [c, String(e[c] || '').trim() || null]))
      await enregistrerEmployeur(marque, champs, ctx)
      Alert.alert('Employeurs', 'Enregistré. Les prochains états préparés utiliseront ces informations.')
    } catch (err) {
      Alert.alert('Employeurs', err.message)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre="Employeurs" sous="En-tête des bulletins de paie">
      {!tous ? <ActivityIndicator color={accent} /> : (
        <>
          <Puces styles={styles} actif={marque} onChoisir={setMarque} elements={MARQUES.map(([cle, label]) => ({ cle, label }))} />
          {CHAMPS.map(([c, label]) => (
            <View key={c} style={{ marginTop: 6 }}>
              <Libelle styles={styles}>{label}</Libelle>
              <Champ styles={styles} colors={colors} value={e[c] || ''} onChangeText={v => changer(c, v)} />
            </View>
          ))}
          <Bouton styles={styles} grand couleur={accent} variante="plein" disabled={occupe} label="Enregistrer" onPress={enregistrer} />
        </>
      )}
    </Feuille>
  )
}
```

- [ ] **Step 5 : tuile, groupe, route**

`lib/menus.js`, dans `TUILES`, après la ligne `embauches` :

```js
  { id: 'salaires',                   icon: '💰',  titre: 'Salaires du mois',       sous: 'États de salaire & bulletins',          route: '/salaires',                   admin: true },
```

`lib/menus.js`, `ACCES_DEFAUT.rh` : ajouter `'salaires'` après `'embauches'`.

`lib/groupesAccueil.js`, groupe `personnel` :

```js
    tuiles: ['equipe', 'contrats', 'embauches', 'salaires', 'demandes-admin', 'demandes-explication-admin', 'documents'],
```

`lib/groupesAccueil.js`, `ICONES_TUILES`, après `'embauches': 'account-plus',` :

```js
  'salaires': 'cash-multiple',
```

`app/_layout.tsx`, à côté des autres écrans :

```tsx
        <Stack.Screen name="salaires" />
```

- [ ] **Step 6 : badge « fiches paie incomplètes »**

`components/accueil/AccueilManager.js` : importer `compterFichesPaieIncompletes` depuis `'../../lib/paieDb'` ; ajouter `fichesPaie` à la fin du tableau déstructuré du `Promise.all` du manager (après `embauches`) et l'appel correspondant à la fin de la liste :

```js
        // CDD/CDI dont la fiche paie est incomplète (tuile « Salaires du mois »).
        compterFichesPaieIncompletes().catch(() => 0),
```

Dans `setEtat({ … })`, après `embauches,` : `fichesPaie,`. Dans l'objet `badges`, après `'embauches'` :

```js
    'salaires': etat?.fichesPaie ? `${etat.fichesPaie} fiche${etat.fichesPaie > 1 ? 's' : ''} paie à compléter` : null,
```

- [ ] **Step 7 : tests existants, lint, export web**

Run : `for f in lib/*.test.mjs; do node "$f" > /dev/null || echo "ÉCHEC $f"; done; npm run lint && npx expo export -p web`
Attendu : aucune ligne « ÉCHEC » (notamment `lib/groupesAccueil.test.mjs` : chaque tuile admin dans un seul groupe et avec une icône), 0 erreur de lint, export sans erreur.

- [ ] **Step 8 : commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add app/salaires.js components/salaires lib/menus.js lib/groupesAccueil.js app/_layout.tsx components/accueil/AccueilManager.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(paie): écran Salaires du mois — préparation RH, validation manager, PDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

---

### Task 9 : vérification d'ensemble et passation

**Files :**
- Modify : `handoff.md` (section du chantier)

- [ ] **Step 1 : toute la suite**

Run : `for f in lib/*.test.mjs; do node "$f" > /dev/null || echo "ÉCHEC $f"; done; npm run lint; npx expo export -p web`
Attendu : aucune ligne « ÉCHEC », 0 erreur de lint, export sans erreur.

- [ ] **Step 2 : graphe**

Run : `graphify update .`

- [ ] **Step 3 : `handoff.md`**

Ajouter une section « États de salaire et bulletins (30/10/2026) » : fichiers créés, migration `supabase_paie.sql` à passer, fiche `docs/correctif-pont-pointeuse.md` à appliquer sur Windows, points à faire valider par le comptable (taux fin de CDD, méthode congés payés, seuils ITS au-delà de 240 000), novembre à faire en double avec Sage, publication pas encore faite. Noter aussi que la **reprise des cumuls Sage** (colonnes `cumuls_reprise`, `cumuls_reprise_au`, `conges_acquis_reprise`, `conges_reste_reprise` de `fiches_paie`) n'a pas d'écran de saisie : à importer par SQL depuis Sage si l'utilisateur veut des cumuls 2026 complets.

- [ ] **Step 4 : commit et push**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add handoff.md graphify-out
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "docs(paie): passation du chantier états de salaire et bulletins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
```

- [ ] **Step 5 : résumé à l'utilisateur, en français simple**

Ce qui est prêt, ce qu'il doit faire (migration, pont Windows, saisir les fiches paie et les employeurs Al Kayan / À la Braise, faire valider les taux par le comptable), et rappeler que rien n'est publié tant qu'il ne le demande pas.
