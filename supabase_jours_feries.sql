-- Jours fériés ivoiriens et alertes de stock. À passer après supabase_evenements.sql.
-- Conception : docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md

alter table public.evenements_groupe add column if not exists ferie_cle text;
alter table public.evenements_groupe add column if not exists ferie_annee integer;
alter table public.evenements_groupe add column if not exists date_estimee boolean not null default false;
alter table public.evenements_groupe add column if not exists alerte_stock boolean not null default false;

-- Une fête par année. Les événements saisis à la main ont ces colonnes vides :
-- deux valeurs vides ne sont jamais en conflit.
create unique index if not exists evenements_groupe_ferie_unique
  on public.evenements_groupe (ferie_cle, ferie_annee);

-- Une alerte déjà envoyée ne repart pas. Écrite seulement par l'Edge Function
-- (clé de service) : aucun accès depuis l'application.
create table if not exists public.alertes_stock_envoyees (
  cle text primary key,
  message text,
  created_at timestamptz not null default now()
);
alter table public.alertes_stock_envoyees enable row level security;
revoke all on public.alertes_stock_envoyees from anon, authenticated;

-- Contrôle : 4 colonnes, 1 index, 1 table.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'evenements_groupe' and column_name in ('ferie_cle', 'ferie_annee', 'date_estimee', 'alerte_stock')) as colonnes,
  (select count(*) from pg_indexes where indexname = 'evenements_groupe_ferie_unique') as index_ok,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'alertes_stock_envoyees') as table_ok;
