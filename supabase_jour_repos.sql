-- =====================================================================
--  JOUR DE REPOS DES TRAVAILLEURS
--
--  Le POS ne transmet que les présences (« Présent ») : un jour non pointé
--  peut être une absence ou le jour de repos. Le jour de repos hebdomadaire
--  permet à Équipe globale de trancher (calcul à l'affichage, rien n'est
--  écrit dans `presences`).
--
--    jour_repos            1 = lundi … 7 = dimanche (ISO), NULL = inconnu
--    jour_repos_source     'auto'   : déduit par l'analyse des 12 dernières
--                                     semaines (lib/joursRepos.js)
--                          'manuel' : choisi dans le formulaire ; l'analyse
--                                     ne l'écrase jamais
--    jour_repos_analyse_le date de la dernière analyse ayant fixé le jour
--
--  Idempotent — rejouable sans risque.
-- =====================================================================

ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS jour_repos smallint;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS jour_repos_source text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS jour_repos_analyse_le timestamptz;

ALTER TABLE travailleurs DROP CONSTRAINT IF EXISTS travailleurs_jour_repos_check;
ALTER TABLE travailleurs ADD CONSTRAINT travailleurs_jour_repos_check
  CHECK (jour_repos IS NULL OR jour_repos BETWEEN 1 AND 7);

ALTER TABLE travailleurs DROP CONSTRAINT IF EXISTS travailleurs_jour_repos_source_check;
ALTER TABLE travailleurs ADD CONSTRAINT travailleurs_jour_repos_source_check
  CHECK (jour_repos_source IS NULL OR jour_repos_source IN ('auto', 'manuel'));
