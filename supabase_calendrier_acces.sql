-- Qui voit quoi dans le calendrier. Sans ligne pour un rôle, les réglages par
-- défaut de lib/accesCalendrier.js s'appliquent.
-- Conception : docs/superpowers/specs/2026-11-07-calendrier-dates-design.md

create table if not exists public.calendrier_acces (
  role text primary key check (role in ('manager', 'directeur', 'rh', 'gerant')),
  types jsonb not null default '[]'::jsonb,
  modifie_par_nom text,
  updated_at timestamptz not null default now()
);

-- Mêmes règles d'accès que roles_acces.
alter table public.calendrier_acces enable row level security;
drop policy if exists allow_all on public.calendrier_acces;
create policy allow_all on public.calendrier_acces for all to public using (true) with check (true);
grant select, insert, update on public.calendrier_acces to anon, authenticated;

-- Contrôle : 1 table.
select count(*) as table_ok from information_schema.tables where table_schema = 'public' and table_name = 'calendrier_acces';
