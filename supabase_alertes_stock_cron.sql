-- =====================================================================
--  ALERTES DE STOCK : tâche quotidienne à 9 h (Abidjan = UTC).
--  À exécuter APRÈS le déploiement de l'Edge Function alertes-stock et
--  après supabase_jours_feries.sql. Idempotent.
--  La clé est la clé PUBLIQUE (anon) déjà présente dans l'app : elle autorise
--  seulement l'appel de la fonction, qui n'envoie jamais deux fois une alerte.
-- =====================================================================

SELECT cron.schedule('alertes-stock-9h', '0 9 * * *', $$
  SELECT net.http_post(
    url := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/alertes-stock',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
$$);

-- Vérifier : SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'alertes-stock-9h';
