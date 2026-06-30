-- =====================================================================
--  STATUT DE DÉCISION — explication d'écart « vente machine »
--  Ajoute 3 colonnes sur `points` pour mémoriser la décision du manager
--  (validée / refusée / annulée) sur l'explication d'un écart de caisse.
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase.
--
--  ⚠️ Ceci est une migration BASE DE DONNÉES, pas un déploiement d'app.
--     Les gérants n'ont RIEN à réinstaller : la notification leur arrive
--     via la table `notifications` que leur app écoute déjà.
-- =====================================================================

ALTER TABLE points ADD COLUMN IF NOT EXISTS explication_machine_statut     text;
ALTER TABLE points ADD COLUMN IF NOT EXISTS explication_machine_statut_par  text;
ALTER TABLE points ADD COLUMN IF NOT EXISTS explication_machine_statut_at   timestamptz;

-- Le bouton « Annuler » régularise l'écart sur le fond via le MÊME mécanisme
-- que l'écran Litiges. Ces colonnes existent déjà si la régularisation Litiges
-- fonctionne ; on les (re)crée par sécurité (idempotent, ne touche pas les données).
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_regularisations JSONB;
ALTER TABLE points ADD COLUMN IF NOT EXISTS ajustement_fond NUMERIC NOT NULL DEFAULT 0;

-- Vérif : les 3 colonnes doivent exister.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'points'
  AND column_name LIKE 'explication_machine_statut%'
ORDER BY column_name;
