-- Paie : la validation d'un état ajoute la CNPS et l'ITS du mois sur les
-- fiches administratives « CNPS » et « ITS » du restaurant (31/10/2026).
-- On garde les écritures pour les retirer si l'état est rouvert.
-- À passer dans le SQL Editor de Samtrackly, APRÈS supabase_paie.sql.

alter table public.etats_salaire
  add column if not exists cnps_transaction_id uuid references public.transactions_fournisseurs(id) on delete set null,
  add column if not exists its_transaction_id  uuid references public.transactions_fournisseurs(id) on delete set null;

-- Contrôle : 2 colonnes.
select count(*) as colonnes from information_schema.columns
where table_schema = 'public' and table_name = 'etats_salaire'
  and column_name in ('cnps_transaction_id', 'its_transaction_id');
