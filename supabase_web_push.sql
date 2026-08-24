-- =====================================================================
--  WEB PUSH — abonnements navigateur (PWA) pour notifications hors-app
--
--  Un enregistrement = un appareil (endpoint unique). Clé de routage :
--    • gérant / caissier  → restaurant_id renseigné (le tel du resto)
--    • manager/directeur/rh → user_id renseigné (tel perso, restaurant_id NULL)
--
--  L'Edge Function `send-web-push` lit cette table (service_role) pour
--  résoudre les destinataires. RLS ON + policy permissive `allow_all`,
--  alignée sur le reste de l'app (la clé anon garde un accès total).
--  Idempotent — rejouable sans risque.
-- =====================================================================

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  endpoint      text PRIMARY KEY,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_id       uuid,
  restaurant_id uuid,
  role          text,
  user_agent    text,
  updated_at    timestamptz DEFAULT now()
);

-- Index pour les lookups de ciblage de l'Edge Function.
CREATE INDEX IF NOT EXISTS idx_wps_restaurant ON web_push_subscriptions (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_wps_user       ON web_push_subscriptions (user_id);

-- ── RLS aligné sur le reste de l'app ──────────────────────────────────
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON web_push_subscriptions;
CREATE POLICY allow_all ON web_push_subscriptions
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ── Vérif ─────────────────────────────────────────────────────────────
SELECT count(*) AS abonnements FROM web_push_subscriptions;
