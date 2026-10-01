-- =====================================================================
--  TRÉSORERIE — étape 4 : alertes automatiques.
--
--  À exécuter dans le SQL Editor de Supabase (projet Samtrackly), APRÈS les
--  migrations des étapes 1 à 3. Idempotent : relançable sans dégât.
-- =====================================================================

-- Plafond de fond de caisse par restaurant : sous ce montant (« FC de la
-- veille » du dernier point), alerte « fond bas ».
CREATE TABLE IF NOT EXISTS tresorerie_plafonds_fond (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id),
  plafond       bigint NOT NULL CHECK (plafond >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Alertes déjà notifiées : une notification par clé, jamais deux.
CREATE TABLE IF NOT EXISTS tresorerie_alertes_envoyees (
  cle        text PRIMARY KEY,
  type       text NOT NULL,
  message    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tresorerie_plafonds_fond','tresorerie_alertes_envoyees'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
