-- =====================================================================
--  ANNULATION D'UNE DÉDUCTION D'INVENTAIRE — par produit
--  Permet au manager/directeur d'annuler DÉFINITIVEMENT la déduction
--  d'un produit présentant un écart (écran Vérification ET écran Litiges).
--
--  Mécanisme : on remet `montant_deduit` à 0 (les totaux consommés en aval
--  — inventaires_shifts.montant_a_deduire, points.montant_inventaire — sont
--  décrémentés d'autant), et on garde une trace dans les colonnes ci-dessous.
--
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase.
--  ⚠️ Migration BASE DE DONNÉES — les gérants n'ont rien à réinstaller.
-- =====================================================================

ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS deduction_annulee      boolean DEFAULT false;
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS deduction_annulee_par  text;
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS deduction_annulee_at   timestamptz;
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS montant_deduit_annule  numeric;  -- montant d'origine, conservé pour l'historique

-- Vérif : les 4 colonnes doivent exister.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'inventaire_lignes'
  AND column_name LIKE 'deduction_annulee%' OR column_name = 'montant_deduit_annule'
ORDER BY column_name;
