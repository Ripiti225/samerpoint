-- =====================================================================
--  TRÉSORERIE — étape 5 : rappels automatiques à 9 h et 14 h.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS le déploiement
--  de l'Edge Function rappels-tresorerie. Idempotent.
--  Heure d'Abidjan = UTC : « 0 9 * * * » = 9 h à Abidjan.
--  Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
--
--  La clé ci-dessous est la clé PUBLIQUE (anon) déjà présente dans l'app :
--  elle autorise seulement l'appel de la fonction, qui ne renvoie jamais deux
--  fois le même rappel dans la journée.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule('rappels-tresorerie-9h', '0 9 * * *', $$
  SELECT net.http_post(
    url := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/rappels-tresorerie',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk"}'::jsonb,
    body := '{"moment": "matin"}'::jsonb
  )
$$);

SELECT cron.schedule('rappels-tresorerie-14h', '0 14 * * *', $$
  SELECT net.http_post(
    url := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/rappels-tresorerie',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk"}'::jsonb,
    body := '{"moment": "apres_midi"}'::jsonb
  )
$$);

-- Vérifier : SELECT jobname, schedule, active FROM cron.job;
-- Historique : SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
