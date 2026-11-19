# Clôture du mois — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le manager clôture un mois terminé (tout le groupe) une fois toutes ses journées validées et vérifiées ; la base refuse ensuite toute modification des journées de ce mois, jusqu'à une réouverture motivée.

**Architecture:** Verrou dans Postgres (table `clotures_mois`, fonctions `cloturer_mois` / `rouvrir_mois`, trigger `verrou_mois_cloture` sur `points` et ses tables filles), même modèle que `supabase_import_sheets_lecture_seule.sql`. Logique d'état pure dans `lib/clotureMois.js` (testée sous node), écran `app/cloture-mois.js` rangé dans la bannière Comptabilité.

**Tech Stack:** Expo / React Native, Supabase (Postgres, RPC), tests `node:test`.

Spec : `docs/superpowers/specs/2026-11-19-cloture-du-mois-design.md`

## Global Constraints

- Interface et messages en français, sans code technique.
- Manager seulement (clôturer, rouvrir) ; contrôle refait côté SQL.
- Mois en cours jamais clôturable.
- Jours sans point : listés, jamais bloquants.
- Lectures Supabase paginées (limite silencieuse de 1 000 lignes).
- Alertes web : 2 boutons max → confirmation en ligne, pas d'`Alert` à 3 choix.
- Ne jamais lancer `expo start` ; vérifier par tests, lint, `npx expo export -p web`.
- Le SQL est passé par l'utilisateur ; pas de publication Vercel/EAS dans ce plan.

---

### Task 1: Logique pure `lib/clotureMois.js`

**Files:**
- Create: `lib/clotureMois.js`
- Test: `lib/clotureMois.test.mjs`

**Interfaces:**
- Produces:
  - `moisTermine(mois: 'YYYY-MM' | 'YYYY-MM-DD', aujourdhui: 'YYYY-MM-DD'): boolean`
  - `listeMois(aujourdhui: string, n = 12): string[]` — `'YYYY-MM'`, du plus récent au plus ancien, mois en cours exclu
  - `joursDuMois(mois: string): string[]` — `'YYYY-MM-DD'`
  - `etatMois({ mois, points, restaurants, aujourdhui }): { bloquants: {restaurantId, nom, date, raison: 'non_valide'|'non_verifie', pointId}[], joursVides: {restaurantId, nom, dates: string[]}[], peutCloturer: boolean }`
  - ré-export `libelleMois` de `lib/tresorerie.js` (`'2026-10'` → `'Octobre 2026'`)

- [ ] **Step 1: Écrire les tests** (`lib/clotureMois.test.mjs`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etatMois, joursDuMois, libelleMois, listeMois, moisTermine } from './clotureMois.js'

const restaurants = [{ id: 'y', nom: 'Samer Yop' }, { id: 'k', nom: 'Al Kayan KMS' }]
const tousLesJours = (rid, mois, sauf = []) => joursDuMois(mois)
  .filter(d => !sauf.includes(d))
  .map(date => ({ id: `${rid}${date}`, restaurant_id: rid, date, valide: true, verifie: true }))

test('mois terminé : seulement avant le mois en cours', () => {
  assert.equal(moisTermine('2026-10', '2026-11-19'), true)
  assert.equal(moisTermine('2026-11', '2026-11-19'), false)
  assert.equal(moisTermine('2026-12-01', '2026-11-19'), false)
})

test('liste des 3 derniers mois terminés, du plus récent au plus ancien, à cheval sur l’année', () => {
  assert.deepEqual(listeMois('2026-02-10', 3), ['2026-01', '2025-12', '2025-11'])
})

test('jours du mois, février bissextile compris', () => {
  assert.equal(joursDuMois('2026-10').length, 31)
  assert.equal(joursDuMois('2028-02').length, 29)
  assert.equal(joursDuMois('2026-10')[0], '2026-10-01')
})

test('tout validé et vérifié : clôture possible', () => {
  const points = [...tousLesJours('y', '2026-10'), ...tousLesJours('k', '2026-10')]
  const e = etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' })
  assert.deepEqual(e.bloquants, [])
  assert.deepEqual(e.joursVides, [])
  assert.equal(e.peutCloturer, true)
})

test('journée non validée ou non vérifiée : bloquante, triée par date', () => {
  const points = [...tousLesJours('y', '2026-10'), ...tousLesJours('k', '2026-10')].map(p => {
    if (p.restaurant_id === 'k' && p.date === '2026-10-20') return { ...p, valide: false, verifie: false }
    if (p.restaurant_id === 'y' && p.date === '2026-10-05') return { ...p, verifie: null }
    return p
  })
  const e = etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' })
  assert.deepEqual(e.bloquants.map(b => [b.nom, b.date, b.raison]), [
    ['Samer Yop', '2026-10-05', 'non_verifie'],
    ['Al Kayan KMS', '2026-10-20', 'non_valide'],
  ])
  assert.equal(e.bloquants[1].pointId, 'k2026-10-20')
  assert.equal(e.peutCloturer, false)
})

test('jours sans point : listés par restaurant, jamais bloquants', () => {
  const points = [...tousLesJours('y', '2026-10', ['2026-10-12', '2026-10-25']), ...tousLesJours('k', '2026-10')]
  const e = etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' })
  assert.deepEqual(e.joursVides, [{ restaurantId: 'y', nom: 'Samer Yop', dates: ['2026-10-12', '2026-10-25'] }])
  assert.equal(e.peutCloturer, true)
})

test('mois en cours : jamais clôturable', () => {
  const e = etatMois({ mois: '2026-11', points: [], restaurants: [], aujourdhui: '2026-11-19' })
  assert.equal(e.peutCloturer, false)
})

test('points d’un autre mois ignorés', () => {
  const points = [...tousLesJours('y', '2026-10'), ...tousLesJours('k', '2026-10'),
    { id: 'x', restaurant_id: 'y', date: '2026-11-01', valide: false, verifie: false }]
  assert.equal(etatMois({ mois: '2026-10', points, restaurants, aujourdhui: '2026-11-19' }).peutCloturer, true)
})

test('libellé du mois', () => {
  assert.equal(libelleMois('2026-10'), 'Octobre 2026')
})
```

- [ ] **Step 2: Vérifier l'échec** — `node lib/clotureMois.test.mjs` → FAIL (module introuvable).

- [ ] **Step 3: Implémenter** (`lib/clotureMois.js`)

```js
// Clôture du mois : état d'un mois avant clôture (logique pure, testée sous node).
// Un mois se clôture pour tout le groupe, une fois terminé et toutes ses journées
// validées ET vérifiées. Les jours sans point sont listés, jamais bloquants.
// Le verrou lui-même est dans la base : supabase_cloture_mois.sql.
// Tests : lib/clotureMois.test.mjs
import { libelleMois } from './tresorerie.js'

export { libelleMois }

const deux = n => String(n).padStart(2, '0')
const cleMois = mois => String(mois).slice(0, 7)

export function moisTermine(mois, aujourdhui) {
  return cleMois(mois) < cleMois(aujourdhui)
}

export function listeMois(aujourdhui, n = 12) {
  const t0 = Number(aujourdhui.slice(0, 4)) * 12 + Number(aujourdhui.slice(5, 7)) - 1
  return Array.from({ length: n }, (_, i) => {
    const t = t0 - i - 1
    return `${Math.floor(t / 12)}-${deux((t % 12) + 1)}`
  })
}

export function joursDuMois(mois) {
  const cle = cleMois(mois)
  const nb = new Date(Date.UTC(Number(cle.slice(0, 4)), Number(cle.slice(5, 7)), 0)).getUTCDate()
  return Array.from({ length: nb }, (_, i) => `${cle}-${deux(i + 1)}`)
}

const parDateEtNom = (a, b) => a.date.localeCompare(b.date) || a.nom.localeCompare(b.nom)

export function etatMois({ mois, points = [], restaurants = [], aujourdhui }) {
  const cle = cleMois(mois)
  const nomDe = id => restaurants.find(r => r.id === id)?.nom || '?'
  const duMois = (points || []).filter(p => String(p.date).slice(0, 7) === cle)

  const bloquants = duMois
    .filter(p => !p.valide || !p.verifie)
    .map(p => ({
      restaurantId: p.restaurant_id, nom: nomDe(p.restaurant_id), date: String(p.date).slice(0, 10),
      raison: p.valide ? 'non_verifie' : 'non_valide', pointId: p.id,
    }))
    .sort(parDateEtNom)

  const avecPoint = new Set(duMois.map(p => `${p.restaurant_id}|${String(p.date).slice(0, 10)}`))
  const jours = joursDuMois(cle)
  const joursVides = restaurants
    .map(r => ({ restaurantId: r.id, nom: r.nom, dates: jours.filter(j => !avecPoint.has(`${r.id}|${j}`)) }))
    .filter(r => r.dates.length)

  return { bloquants, joursVides, peutCloturer: moisTermine(cle, aujourdhui) && bloquants.length === 0 }
}
```

- [ ] **Step 4: Vérifier le succès** — `node lib/clotureMois.test.mjs` → `fail 0`.
- [ ] **Step 5: Commit** — `git add lib/clotureMois.js lib/clotureMois.test.mjs && git commit -m "feat(comptabilite): état d'un mois avant clôture"`

---

### Task 2: Verrou SQL `supabase_cloture_mois.sql`

**Files:**
- Create: `supabase_cloture_mois.sql`

**Interfaces:**
- Produces: table `public.clotures_mois(mois date pk, statut, cloture_le, cloture_par, rouvert_le, rouvert_par, motif_reouverture)` ; RPC `cloturer_mois(p_mois date, p_user uuid) → jsonb`, `rouvrir_mois(p_mois date, p_user uuid, p_motif text) → jsonb` ; trigger `trg_verrou_mois_cloture` sur `points`, `points_shifts`, `depenses`, `presences`, `transactions_fournisseurs`, `inventaires_shifts`.

- [ ] **Step 1: Écrire le fichier** (contenu complet ci-dessous, en transaction, avec bloc de contrôle commenté)

```sql
-- (en-tête explicatif : but, tables verrouillées, maintenance par disable trigger)
begin;

create table if not exists public.clotures_mois (
  mois date primary key check (extract(day from mois) = 1),
  statut text not null check (statut in ('cloture', 'rouvert')),
  cloture_le timestamptz,
  cloture_par uuid references public.utilisateurs(id),
  rouvert_le timestamptz,
  rouvert_par uuid references public.utilisateurs(id),
  motif_reouverture text
);
alter table public.clotures_mois enable row level security;
drop policy if exists clotures_mois_lecture on public.clotures_mois;
create policy clotures_mois_lecture on public.clotures_mois for select using (true);
revoke insert, update, delete, truncate on public.clotures_mois from anon, authenticated;
grant select on public.clotures_mois to anon, authenticated;

create or replace function public.libelle_mois_fr(p date) returns text
language sql immutable as $$
  select (array['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août',
                'Septembre','Octobre','Novembre','Décembre'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int
$$;

create or replace function public.mois_est_cloture(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clotures_mois
                  where mois = date_trunc('month', p_date)::date and statut = 'cloture')
$$;

create or replace function public.verrou_mois_cloture() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d date;
begin
  if tg_table_name = 'points' then
    if tg_op <> 'DELETE' and mois_est_cloture(new.date::date) then d := new.date::date; end if;
    if d is null and tg_op <> 'INSERT' and mois_est_cloture(old.date::date) then d := old.date::date; end if;
  else
    if tg_op <> 'DELETE' and new.point_id is not null then
      select p.date::date into d from points p where p.id = new.point_id and mois_est_cloture(p.date::date);
    end if;
    if d is null and tg_op <> 'INSERT' and old.point_id is not null then
      select p.date::date into d from points p where p.id = old.point_id and mois_est_cloture(p.date::date);
    end if;
  end if;
  if d is not null then
    raise exception '% est clôturé : cette journée ne peut plus être modifiée. Le manager peut rouvrir le mois depuis Comptabilité → Clôture du mois.', libelle_mois_fr(d);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- un « drop trigger / create trigger … before insert or update or delete … for each row
-- execute function public.verrou_mois_cloture() » par table :
-- points, points_shifts, depenses, presences, transactions_fournisseurs, inventaires_shifts

create or replace function public.cloturer_mois(p_mois date, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_mois)::date;
  n int;
begin
  if not exists (select 1 from utilisateurs where id = p_user and role = 'manager') then
    raise exception 'Seul le manager peut clôturer un mois.';
  end if;
  if m >= date_trunc('month', now() at time zone 'Africa/Abidjan')::date then
    raise exception '% n''est pas terminé : il ne peut pas encore être clôturé.', libelle_mois_fr(m);
  end if;
  select count(*) into n from points
   where date::date >= m and date::date < (m + interval '1 month')::date
     and (coalesce(valide, false) = false or coalesce(verifie, false) = false);
  if n > 0 then
    raise exception '% : % journée(s) pas encore validée(s) et vérifiée(s).', libelle_mois_fr(m), n;
  end if;
  insert into clotures_mois (mois, statut, cloture_le, cloture_par)
  values (m, 'cloture', now(), p_user)
  on conflict (mois) do update set statut = 'cloture', cloture_le = now(), cloture_par = p_user;
  return jsonb_build_object('mois', m, 'statut', 'cloture');
end;
$$;

create or replace function public.rouvrir_mois(p_mois date, p_user uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_mois)::date;
begin
  if not exists (select 1 from utilisateurs where id = p_user and role = 'manager') then
    raise exception 'Seul le manager peut rouvrir un mois.';
  end if;
  if coalesce(trim(p_motif), '') = '' then
    raise exception 'Écrivez pourquoi vous rouvrez le mois.';
  end if;
  update clotures_mois
     set statut = 'rouvert', rouvert_le = now(), rouvert_par = p_user, motif_reouverture = trim(p_motif)
   where mois = m and statut = 'cloture';
  if not found then
    raise exception '% n''est pas clôturé.', libelle_mois_fr(m);
  end if;
  return jsonb_build_object('mois', m, 'statut', 'rouvert');
end;
$$;

grant execute on function public.cloturer_mois(date, uuid) to anon, authenticated;
grant execute on function public.rouvrir_mois(date, uuid, text) to anon, authenticated;

commit;
```

- [ ] **Step 2: Relire** : chaque table a son trigger ; messages en français ; `revoke` présent.
- [ ] **Step 3: Commit** — `git add supabase_cloture_mois.sql && git commit -m "feat(comptabilite): verrou SQL de la clôture du mois"`

---

### Task 3: Écran, tuile et bannière

**Files:**
- Create: `app/cloture-mois.js`
- Modify: `lib/menus.js` (tuile après `rapports`), `lib/groupesAccueil.js` (`GROUPES_ADMIN.comptabilite.tuiles` + `ICONES_TUILES['cloture-mois'] = 'lock-check'`)
- Test: `lib/groupesAccueil.test.mjs`

**Interfaces:**
- Consumes: `etatMois`, `listeMois`, `libelleMois`, `moisTermine` (Task 1) ; RPC `cloturer_mois`, `rouvrir_mois`, table `clotures_mois` (Task 2) ; `journaliser(action, details, { userId, userNom })` (`lib/journal.js`) ; `nomCourtResto` (`lib/groupesAccueil.js`) ; `aujourdhuiISO`, `formatDateFR` (`lib/tresorerie.js`) ; `retour` (`lib/navigation.js`) ; `useApp()` → `userId`, `userNom`, `roleActif`.

- [ ] **Step 1: Tests** — dans le test « en tête, verte, avec exactement ses … écrans », attendre
  `['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports', 'cloture-mois']` ; ajouter :

```js
test('Clôture du mois : dans Comptabilité, avec son icône, au catalogue', () => {
  assert.ok(idsAdmin.includes('cloture-mois'))
  assert.equal(ICONES_TUILES['cloture-mois'], 'lock-check')
  assert.equal(groupeDeRoute('/cloture-mois')?.id, 'comptabilite')
})
```

- [ ] **Step 2: Vérifier l'échec** — `node lib/groupesAccueil.test.mjs` → FAIL.
- [ ] **Step 3: Catalogue + bannière**

`lib/menus.js`, après la ligne `rapports` :

```js
  { id: 'cloture-mois',               icon: '🔒',  titre: 'Clôture du mois',        sous: 'Figer les journées d’un mois vérifié',  route: '/cloture-mois',               admin: true },
```

`lib/groupesAccueil.js` : `tuiles: ['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports', 'cloture-mois']` et `'cloture-mois': 'lock-check',` dans `ICONES_TUILES`.

- [ ] **Step 4: Écran `app/cloture-mois.js`** — style de `app/corbeille.js` (en-tête `headerBg`, cartes `surface`) :
  - Réservé au manager (`roleActif === 'manager'`), sinon message « Réservé au manager ».
  - Charge `clotures_mois` (+ noms des auteurs via `utilisateurs.select('id, nom').in('id', …)`) et `restaurants.select('id, nom')`.
  - Liste `listeMois(aujourdhuiISO(), 12)` : libellé + état (🔒 Clôturé le … par … / 🔓 Rouvert le … : motif / Ouvert). Message clair si la table n'existe pas encore (SQL non passé).
  - Mois touché → points du mois paginés (`id, restaurant_id, date, valide, verifie`, `.order('date').order('id').range(...)` par 1 000) → `etatMois` (noms courts via `nomCourtResto`).
  - 🔴 Journées qui bloquent (toucher : non validée → `/modifier-point` `{ restaurant_id, date }` ; non vérifiée → `/verification` `{ restaurant_id, point_id }`), 🟡 Jours sans point (« Yop : 12, 25 »).
  - Bouton « Clôturer {Mois} » actif si `peutCloturer` et non clôturé → confirmation en ligne → `rpc('cloturer_mois', { p_mois: '{mois}-01', p_user: userId })` → `journaliser('cloture_mois', { mois }, …)` → rechargement.
  - Mois clôturé : « Rouvrir » → champ motif (obligatoire) → `rpc('rouvrir_mois', { …, p_motif })` → `journaliser('reouverture_mois', { mois, motif }, …)`.
  - Erreurs affichées telles quelles (messages SQL en français).

- [ ] **Step 5: Vérifier** — tous les `lib/*.test.mjs` (0 échec), `npm run lint` (0 erreur), `npx expo export -p web`.
- [ ] **Step 6: Commit + push** — `feat(comptabilite): écran Clôture du mois` ; `graphify update .` + commit ; `git push` (récupérer d'abord si le distant a avancé).
