-- =====================================================================
--  TRÉSORERIE → POINT : le fond donné à un restaurant remplit tout seul le
--  « FC reçu » de son point.
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Un fond donné (Dépenses direction, catégorie « Fond ») s'ajoute au FC reçu ;
--  une entrée d'espèces venant du restaurant s'en déduit. À la validation du
--  point, ces lignes y sont rattachées (point_id) : elles ne comptent plus
--  jamais dans un autre point.
-- =====================================================================

ALTER TABLE tresorerie_depenses_direction ADD COLUMN IF NOT EXISTS point_id uuid REFERENCES points(id) ON DELETE SET NULL;
ALTER TABLE tresorerie_mouvements ADD COLUMN IF NOT EXISTS point_id uuid REFERENCES points(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treso_dir_fond_resto ON tresorerie_depenses_direction (restaurant_id, date) WHERE categorie = 'fond';
CREATE INDEX IF NOT EXISTS idx_treso_mvt_especes_resto ON tresorerie_mouvements (restaurant_id, date) WHERE type = 'especes';
