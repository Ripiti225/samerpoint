-- =====================================================================
--  TRÉSORERIE → POINT : le fond donné à un restaurant remplit tout seul le
--  « FC reçu » de son point.
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Un fond en espèces (Dépenses direction, « Fond », passe par le point)
--  s'ajoute au FC reçu ; une entrée d'espèces venant du restaurant s'en
--  déduit. À la validation du point, ces lignes y sont rattachées (point_id) :
--  elles ne comptent plus jamais dans un autre point.
--  Un fond en nature (« fond_nature », marchandise) ne passe pas par le point :
--  il est déduit du résultat du restaurant comme une charge.
-- =====================================================================

ALTER TABLE tresorerie_depenses_direction ADD COLUMN IF NOT EXISTS point_id uuid REFERENCES points(id) ON DELETE SET NULL;
ALTER TABLE tresorerie_mouvements ADD COLUMN IF NOT EXISTS point_id uuid REFERENCES points(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treso_dir_fond_resto ON tresorerie_depenses_direction (restaurant_id, date) WHERE categorie = 'fond';
CREATE INDEX IF NOT EXISTS idx_treso_mvt_especes_resto ON tresorerie_mouvements (restaurant_id, date) WHERE type = 'especes';

-- Fond en nature : nouvelle catégorie de dépense direction.
ALTER TABLE tresorerie_depenses_direction DROP CONSTRAINT IF EXISTS tresorerie_depenses_direction_categorie_check;
ALTER TABLE tresorerie_depenses_direction ADD CONSTRAINT tresorerie_depenses_direction_categorie_check
  CHECK (categorie IN ('fond','fond_nature','reparation','materiel','equipement','investissement','retrait_perso'));
