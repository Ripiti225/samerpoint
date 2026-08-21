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

--    Rejouable : ADD CONSTRAINT n'a pas de IF NOT EXISTS, d'où le DO.
--
--    ⚠ L'ordre des deux tests compte. Une contrainte UNIQUE crée un index qui
--    PORTE SON NOM : au rejeu, cet index apparaît dans pg_indexes, mais
--    DROP INDEX le refuse (« constraint ... requires it »). On sort donc dès
--    que la contrainte est là, AVANT de regarder les index. Le patron copié de
--    supabase_pos_bascule.sql testait les index en premier — là-bas un index
--    simple préexistait vraiment et devait être converti ; ici il n'y en a
--    jamais eu, et l'ordre hérité faisait échouer tout second passage.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'un_inventaires_shifts_pos_service'
  ) THEN
    RETURN;
  END IF;

  -- Un index simple du même nom (jamais constaté ici) empêcherait l'ADD.
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'un_inventaires_shifts_pos_service') THEN
    DROP INDEX public.un_inventaires_shifts_pos_service;
  END IF;

  ALTER TABLE public.inventaires_shifts
    ADD CONSTRAINT un_inventaires_shifts_pos_service UNIQUE (pos_service_id);
END $$;

COMMENT ON COLUMN public.inventaires_shifts.pos_service_id IS
  'Id du service POS d''origine (clé d''idempotence du pont). NULL pour un inventaire saisi à la main.';


-- ── Vérification ────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'inventaires_shifts' AND column_name = 'pos_service_id';
--
--   SELECT conname FROM pg_constraint WHERE conname = 'un_inventaires_shifts_pos_service';
