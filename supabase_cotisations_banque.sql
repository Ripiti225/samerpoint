-- =====================================================================
--  TRÉSORERIE → COTISATIONS REÇUES DANS BANQUE (24/10/2026)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--  Prérequis : supabase_tresorerie_cotisations.sql déjà passé.
--
--  Chaque remise d'un restaurant se note dans Banque, le jour où elle arrive,
--  sur l'un de deux comptes :
--    • « Cotisation salaire » ;
--    • « Cotisations autres » (CNPS, impôt, ITS, TEE, loyer, bail).
--  L'argent entre dans ce compte (plus dans Espèces), la fiche de cotisation
--  du restaurant baisse, et le résultat du restaurant déduit la remise de ses
--  charges du mois de réception. Ces remises ne sont rattachées à aucune
--  charge : du_id vide, categorie remplie. Les anciennes lignes (avec du_id)
--  ne changent pas.
-- =====================================================================

ALTER TABLE tresorerie_cotisations_recues ALTER COLUMN du_id DROP NOT NULL;
ALTER TABLE tresorerie_cotisations_recues ADD COLUMN IF NOT EXISTS categorie text;

ALTER TABLE tresorerie_cotisations_recues DROP CONSTRAINT IF EXISTS tresorerie_cotisations_recues_categorie_check;
ALTER TABLE tresorerie_cotisations_recues ADD CONSTRAINT tresorerie_cotisations_recues_categorie_check
  CHECK (categorie IS NULL OR categorie IN ('salaire', 'cnps', 'impot', 'its', 'tee', 'loyer', 'bail'));

-- Une remise sans charge doit dire de quelle cotisation il s'agit.
ALTER TABLE tresorerie_cotisations_recues DROP CONSTRAINT IF EXISTS tresorerie_cotisations_recues_rattachement_check;
ALTER TABLE tresorerie_cotisations_recues ADD CONSTRAINT tresorerie_cotisations_recues_rattachement_check
  CHECK (du_id IS NOT NULL OR (categorie IS NOT NULL AND restaurant_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_treso_cotis_banque_date
  ON tresorerie_cotisations_recues (date) WHERE du_id IS NULL;

-- Les deux comptes de Banque, seulement s'ils manquent.
INSERT INTO tresorerie_comptes (nom, ordre)
SELECT v.nom, v.ordre FROM (VALUES ('Cotisation salaire', 10), ('Cotisations autres', 11)) AS v(nom, ordre)
WHERE NOT EXISTS (SELECT 1 FROM tresorerie_comptes c WHERE c.nom = v.nom);

-- Vérification :
-- SELECT nom, ordre, actif FROM tresorerie_comptes ORDER BY ordre;
