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
