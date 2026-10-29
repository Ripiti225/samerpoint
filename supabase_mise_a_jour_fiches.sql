-- =====================================================================
--  MISE À JOUR DES FICHES PAR LES GÉRANTS (29/10/2026)
--  À exécuter UNE fois dans le SQL Editor du projet SAMTRACKLY.
--  Une mise à jour = une demande_travailleurs de type 'mise_a_jour'
--  rattachée au travailleur (travailleur_id). Les demandes existantes
--  restent des embauches. Une seule mise à jour en attente par travailleur.
--  Relancer le script ne casse rien.
-- =====================================================================
alter table public.demandes_travailleurs add column if not exists type text not null default 'embauche';

alter table public.demandes_travailleurs drop constraint if exists demandes_travailleurs_type_check;
alter table public.demandes_travailleurs add constraint demandes_travailleurs_type_check
  check (type in ('embauche', 'mise_a_jour'));

create unique index if not exists demandes_trav_une_maj_en_attente
  on public.demandes_travailleurs (travailleur_id)
  where type = 'mise_a_jour' and statut in ('envoyee', 'refusee');

-- Contrôle : 1 colonne, 1 index.
select (select count(*) from information_schema.columns where table_name = 'demandes_travailleurs' and column_name = 'type') as colonne_ok,
       (select count(*) from pg_indexes where indexname = 'demandes_trav_une_maj_en_attente') as index_ok;
