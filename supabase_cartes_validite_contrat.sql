-- =====================================================================
--  CARTES : validité = le temps du contrat en cours (29/10/2026)
--  À exécuter UNE fois dans le SQL Editor du projet SAMTRACKLY, APRÈS
--  supabase_cartes_travailleurs.sql.
--
--  Un CDI n'a pas de date de fin : sa carte est valable jusqu'à l'archivage.
--  On autorise donc une validité vide (NULL). verifier_carte n'a pas à changer :
--  une validité vide n'est jamais « expirée » (NULL < date → faux), et un
--  travailleur archivé reste « parti ».
--  Relancer le script ne casse rien.
-- =====================================================================
alter table public.cartes_travailleurs alter column valide_jusqua drop not null;

-- Contrôle : doit renvoyer YES.
select is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'cartes_travailleurs' and column_name = 'valide_jusqua';
