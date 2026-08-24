-- =====================================================================
--  CONTRATS DE TRAVAIL — Stage / CDD / CDI
--
--  À exécuter dans le SQL Editor de Supabase.
--  Idempotent : relançable sans dégât.
--  Voir docs/superpowers/specs/2026-08-18-contrats-travailleurs-design.md
-- =====================================================================

-- Nécessaire pour la contrainte anti-chevauchement (uuid + daterange).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS contrats_travailleurs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  travailleur_id uuid NOT NULL REFERENCES travailleurs(id) ON DELETE CASCADE,
  restaurant_id  uuid REFERENCES restaurants(id),
  type           text NOT NULL CHECK (type IN ('Stage','CDD','CDI')),
  date_debut     date NOT NULL,
  date_fin       date,
  duree_mois     int CHECK (duree_mois IN (3,6,12)),
  photo_url      text NOT NULL,
  photo_type     text NOT NULL DEFAULT 'photo' CHECK (photo_type IN ('photo','pdf')),
  cloture_le     date,
  cloture_motif  text,
  rappels_envoyes int[] NOT NULL DEFAULT '{}',
  desactivation_faite_le date,
  cree_par       uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contrat_cdi_sans_fin CHECK (
    (type = 'CDI' AND date_fin IS NULL) OR (type <> 'CDI' AND date_fin IS NOT NULL)
  ),
  CONSTRAINT contrat_fin_apres_debut CHECK (date_fin IS NULL OR date_fin >= date_debut),
  CONSTRAINT contrat_cloture_coherente CHECK (cloture_le IS NULL OR (cloture_le >= date_debut AND (date_fin IS NULL OR cloture_le <= date_fin)))
);

-- Un travailleur n'a qu'un seul contrat à la fois. La borne haute est exclusive
-- et décalée d'un jour : le dernier jour du contrat est un jour travaillé.
-- Un CDI (fin NULL) occupe l'intervalle jusqu'à l'infini — impossible d'ouvrir
-- un contrat par-dessus sans clôturer le CDI d'abord.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contrats_sans_chevauchement' AND conrelid = 'contrats_travailleurs'::regclass
  ) THEN
    ALTER TABLE contrats_travailleurs
      ADD CONSTRAINT contrats_sans_chevauchement
      EXCLUDE USING gist (
        travailleur_id WITH =,
        daterange(date_debut, (COALESCE(cloture_le, date_fin) + 1), '[)') WITH &&
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contrats_travailleur
  ON contrats_travailleurs (travailleur_id, date_debut DESC);
CREATE INDEX IF NOT EXISTS idx_contrats_echeance
  ON contrats_travailleurs (date_fin) WHERE cloture_le IS NULL;

ALTER TABLE contrats_travailleurs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON contrats_travailleurs;
CREATE POLICY allow_all ON contrats_travailleurs
  FOR ALL TO public USING (true) WITH CHECK (true);

-- 'Stage' rejoint les valeurs acceptées sur la fiche travailleur.
-- Ce bloc détecte la contrainte CHECK existante sur type_contrat et l'enrichit si nécessaire.
-- Il refuse (RAISE EXCEPTION) plutôt que de supprimer silencieusement une règle complexe qui
-- pourrait coupler type_contrat avec d'autres colonnes. Idempotent : si Stage est déjà accepté,
-- le bloc n'agit pas.
DO $$
DECLARE
  v_conname text;
  v_conndef text;
  v_count int;
  v_col_pattern text;
BEGIN
  -- Chercher les contraintes CHECK mentionnant type_contrat.
  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'travailleurs'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type_contrat%';

  IF v_count = 0 THEN
    RETURN;  -- Aucune contrainte à mettre à jour.
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'Migration contrats: plusieurs contraintes CHECK mentionnent type_contrat sur travailleurs. '
      'Impossible de procéder sans risque de suppression silencieuse. Modifiez manuellement.';
  END IF;

  -- Une seule contrainte trouvée.
  SELECT conname, pg_get_constraintdef(oid) INTO v_conname, v_conndef
    FROM pg_constraint
   WHERE conrelid = 'travailleurs'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type_contrat%';

  -- Si elle accepte déjà Stage, rien à faire.
  IF v_conndef ILIKE '%Stage%' THEN
    RAISE NOTICE 'Migration contrats: % accepte déjà Stage, aucune modification.', v_conname;
    RETURN;
  END IF;

  -- Construire un motif pour chercher d'autres colonnes.
  -- Tous les noms de colonnes de travailleurs sauf type_contrat.
  SELECT string_agg(column_name, '|') INTO v_col_pattern
    FROM information_schema.columns
   WHERE table_name = 'travailleurs'
     AND column_name <> 'type_contrat';

  -- Si la définition mentionne une autre colonne, refuser.
  IF v_col_pattern IS NOT NULL AND v_conndef ~ ('(' || v_col_pattern || ')')::text THEN
    RAISE EXCEPTION
      'Migration contrats: % couvre plus que type_contrat (mention d''autres colonnes). '
      'Impossible de modifier. Vérifiez et agissez manuellement.',
      v_conname;
  END IF;

  -- La contrainte est simple sur type_contrat. Procéder à la mise à jour.
  EXECUTE format('ALTER TABLE travailleurs DROP CONSTRAINT %I', v_conname);
  ALTER TABLE travailleurs ADD CONSTRAINT travailleurs_type_contrat_check
    CHECK (type_contrat IN ('Stage','CDD','CDI','Journalier'));
  RAISE NOTICE 'Migration contrats: % mise à jour pour accepter Stage.', v_conname;
END $$;

-- =====================================================================
--  CRON QUOTIDIEN (alertes J-15/7/3 + désactivation à l'échéance)
--  Nécessite pg_cron et pg_net activées, et l'Edge Function
--  `rappel-contrats` déployée. Remplace <PROJECT_REF> et
--  <SERVICE_ROLE_KEY> avant d'exécuter ce bloc.
--  Abidjan est à UTC+0 : 07:00 UTC = 07:00 heure locale.
-- =====================================================================
-- SELECT cron.schedule(
--   'rappel-contrats-quotidien',
--   '0 7 * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/rappel-contrats',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
-- Pour supprimer la tâche : SELECT cron.unschedule('rappel-contrats-quotidien');

-- =====================================================================
--  FIN
-- =====================================================================
