-- ════════════════════════════════════════════════════════════════════════════
--  Note des caissiers → caisse (POS) : calcul toutes les heures
--
--  À lancer dans SAMTRACKLY (pas le cloud POS). Rejouable sans risque.
--
--  La fonction `publier-notes-pos` calcule la note de chaque caissier avec le
--  même code que l'écran « Note des caissiers », puis l'écrit dans le cloud
--  POS (table `notes_caissiers`). Chaque caisse la reçoit à la synchronisation
--  suivante et l'affiche en haut de l'accueil du caissier.
--
--  Toutes les heures et pas seulement à l'arrivée d'un shift : la note bouge
--  aussi quand un manager tranche un écart dans Vérification, saisit un
--  litige Yango/Glovo ou une absence.
--
--  Prérequis :
--   1. Cloud POS : migration 20261015010000_notes_caissiers.sql passée.
--   2. Fonction déployée :
--        npx supabase functions deploy publier-notes-pos --project-ref wlwotzxnzowbkbfcpnyi
--      (secrets POS_URL et POS_CLE_SERVICE déjà posés pour import-contacts-pos)
--   3. Extensions pg_cron et pg_net actives (Database → Extensions).
-- ════════════════════════════════════════════════════════════════════════════

-- Rejouable : on retire l'ancienne planification avant de la reposer.
SELECT cron.unschedule('publier-notes-pos')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publier-notes-pos');

SELECT cron.schedule(
  'publier-notes-pos',
  '7 * * * *',   -- à h+07 : après la vague de clôtures de l'heure pile
  $$
  SELECT net.http_post(
    url     := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/publier-notes-pos',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ── Vérification ────────────────────────────────────────────────────────────
--
-- Lancer une fois à la main, puis regarder le résultat de l'appel :
--
--   SELECT net.http_post(
--     url := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/publier-notes-pos',
--     headers := '{"Content-Type": "application/json", "Authorization": "Bearer <clé anon>"}'::jsonb,
--     body := '{}'::jsonb);
--   SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 1;
--
-- Attendu : {"ok":true, "caissiers": …, "lignes": …}. Côté cloud POS :
--   SELECT restaurant_id, id, note, nb_shifts, calcule_le FROM notes_caissiers ORDER BY calcule_le DESC;
