-- =====================================================================
--  TRÉSORERIE → RETENUE SUR LITIGES (salaires)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Sur les salaires d'un mois, le RH retient une partie des litiges du
--  restaurant (ex. 30 % de 200 000, ou 40 000) ; le reste est annulé.
--    · les salaires à payer baissent du montant retenu ;
--    · le résultat net garde la charge salaires entière, et compte le montant
--      retenu en revenu (le litige est un manque à gagner récupéré) ;
--    · la part annulée est seulement notée sur la ligne.
-- =====================================================================

ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS retenue_litiges bigint NOT NULL DEFAULT 0;
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS litiges_total bigint;
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS retenue_regle text;      -- « 30% » ou « 40000 »
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS retenue_par_nom text;
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS retenue_le timestamptz;

ALTER TABLE tresorerie_dus DROP CONSTRAINT IF EXISTS tresorerie_dus_retenue_positive;
ALTER TABLE tresorerie_dus ADD CONSTRAINT tresorerie_dus_retenue_positive CHECK (retenue_litiges >= 0);
