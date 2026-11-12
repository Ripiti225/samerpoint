-- ─────────────────────────────────────────────────────────────────────────────
-- Contrats envoyés par lot (12/11/2026)
--
-- Un stage commencé il y a longtemps est découpé en plusieurs contrats qui se
-- suivent (ex. embauche le 25/01, stage de 6 mois : du 25/01 au 24/07 déjà
-- passé, puis du 25/07 au 24/01 en cours). Ils partent ENSEMBLE au gérant.
--
-- Avant : un seul contrat en attente de signature par travailleur (index
-- unique contrat_un_seul_en_attente).
-- Après : un seul LOT en attente par travailleur ; les contrats d'un même lot
-- peuvent être plusieurs. Un contrat seul forme son propre lot.
--
-- À passer une fois dans Supabase → SQL Editor (projet Samtrackly).
-- Rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Le lot : chaque contrat existant reçoit le sien.
ALTER TABLE contrats_travailleurs
  ADD COLUMN IF NOT EXISTS lot text NOT NULL DEFAULT gen_random_uuid()::text;

-- 2. Un seul lot en circuit par travailleur (remplace l'index unique).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contrat_un_seul_lot_en_attente' AND conrelid = 'contrats_travailleurs'::regclass
  ) THEN
    ALTER TABLE contrats_travailleurs
      ADD CONSTRAINT contrat_un_seul_lot_en_attente
      EXCLUDE USING gist (travailleur_id WITH =, lot WITH <>)
      WHERE (statut IN ('a_signer', 'signe_a_verifier', 'refuse'));
  END IF;
END $$;

DROP INDEX IF EXISTS contrat_un_seul_en_attente;

-- Vérification (doit renvoyer true, true, false) :
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contrats_travailleurs' AND column_name = 'lot') AS colonne_lot,
--   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contrat_un_seul_lot_en_attente') AS un_lot,
--   to_regclass('public.contrat_un_seul_en_attente') IS NOT NULL AS ancien_index;
