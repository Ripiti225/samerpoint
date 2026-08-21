-- ════════════════════════════════════════════════════════════════════════════
--  Pont inventaire POS → Samtrackly — colonne d'idempotence
--
--  Spéc : docs/superpowers/specs/2026-08-20-pos-inventaire-vers-samtrackly-design.md
--  À lancer dans SAMTRACKLY (pas le cloud POS). Rejouable sans risque.
--
--  Même patron que points_shifts.pos_service_id (supabase_pos_bascule.sql) :
--  un renvoi après coupure retombe sur la même ligne au lieu d'en créer une
--  seconde.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.inventaires_shifts
  ADD COLUMN IF NOT EXISTS pos_service_id UUID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'un_inventaires_shifts_pos_service') THEN
    DROP INDEX public.un_inventaires_shifts_pos_service;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'un_inventaires_shifts_pos_service'
  ) THEN
    ALTER TABLE public.inventaires_shifts
      ADD CONSTRAINT un_inventaires_shifts_pos_service UNIQUE (pos_service_id);
  END IF;
END $$;

COMMENT ON COLUMN public.inventaires_shifts.pos_service_id IS
  'Id du service POS d''origine (clé d''idempotence du pont). NULL pour un inventaire saisi à la main.';


-- ── Vérification ────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'inventaires_shifts' AND column_name = 'pos_service_id';
--
--   SELECT conname FROM pg_constraint WHERE conname = 'un_inventaires_shifts_pos_service';
