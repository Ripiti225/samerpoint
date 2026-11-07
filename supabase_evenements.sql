-- Espace « Événements » : calendrier du groupe et tuile pour la RH et les gérants.
-- Conception : docs/superpowers/specs/2026-11-07-evenements-design.md
-- Les anniversaires et l'ancienneté ne sont pas stockés : ils se calculent depuis les fiches.

create table if not exists public.evenements_groupe (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (char_length(trim(titre)) between 1 and 120),
  date_evenement date not null,
  note text,
  restaurant_id uuid references public.restaurants(id) on delete cascade, -- vide = tout le groupe
  chaque_annee boolean not null default false,
  cree_par_nom text,
  created_at timestamptz not null default now()
);

create index if not exists idx_evenements_groupe_date on public.evenements_groupe (date_evenement);

-- Mêmes règles d'accès que le reste de la base.
alter table public.evenements_groupe enable row level security;
drop policy if exists allow_all on public.evenements_groupe;
create policy allow_all on public.evenements_groupe for all to public using (true) with check (true);
grant select, insert, update, delete on public.evenements_groupe to anon, authenticated;

-- Les tuiles du RH et du gérant sont lues dans roles_acces : sans cet ajout, ils ne verraient pas l'écran.
update public.roles_acces
set tuiles = tuiles || '["evenements"]'::jsonb, updated_at = now()
where role in ('rh', 'gerant') and not (tuiles @> '["evenements"]'::jsonb);

-- Contrôle : 1 table, 2 rôles avec la tuile.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'evenements_groupe') as table_ok,
  (select count(*) from public.roles_acces where tuiles @> '["evenements"]'::jsonb) as roles_avec_tuile;
