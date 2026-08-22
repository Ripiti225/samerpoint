-- =====================================================================
--  CONTRATS — durées libres (1 à 60 mois)
--
--  À exécuter dans le SQL Editor de Supabase.
--  Idempotent : relançable sans dégât.
--
--  La contrainte d'origine n'acceptait que 3, 6 et 12 mois. Un stage
--  renouvelé 4 mois était refusé par la base. Tous les contrats déjà
--  saisis restent valides : 3, 6 et 12 sont dans le nouvel intervalle.
-- =====================================================================

DO $$
BEGIN
  -- L'ancienne contrainte porte le nom auto-généré par Postgres.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contrats_travailleurs_duree_mois_check'
       AND conrelid = 'contrats_travailleurs'::regclass
  ) THEN
    ALTER TABLE contrats_travailleurs
      DROP CONSTRAINT contrats_travailleurs_duree_mois_check;
    RAISE NOTICE 'Ancienne contrainte duree_mois supprimée.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contrat_duree_bornee'
       AND conrelid = 'contrats_travailleurs'::regclass
  ) THEN
    ALTER TABLE contrats_travailleurs
      ADD CONSTRAINT contrat_duree_bornee
      CHECK (duree_mois IS NULL OR (duree_mois >= 1 AND duree_mois <= 60));
    RAISE NOTICE 'Contrainte contrat_duree_bornee ajoutée (1 à 60 mois).';
  END IF;
END $$;

-- =====================================================================
--  FIN
-- =====================================================================
