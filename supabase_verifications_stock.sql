-- Comptages physiques du vérificateur (écran app/verificateur.js).
-- Une ligne par produit compté. L'écran fonctionne même sans cette table
-- (l'enregistrement est best-effort), mais la créer permet d'historiser les
-- comptages et de retrouver les écarts constatés.

CREATE TABLE IF NOT EXISTS verifications_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id TEXT,                    -- regroupe les lignes d'un même comptage (1 validation)
  restaurant_id UUID REFERENCES restaurants(id),
  date DATE,
  verificateur_id UUID REFERENCES utilisateurs(id),
  verificateur_nom TEXT,
  produit_id TEXT,
  produit_nom TEXT,
  stock_reel NUMERIC DEFAULT 0,   -- dernier stock réel enregistré (caissier)
  stock_compte NUMERIC DEFAULT 0, -- stock compté par le vérificateur
  ecart NUMERIC DEFAULT 0,        -- stock_compte - stock_reel
  created_at TIMESTAMP DEFAULT now()
);

-- Si la table existe déjà (créée avant l'ajout de lot_id) : ajoute la colonne.
ALTER TABLE verifications_stock ADD COLUMN IF NOT EXISTS lot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_verif_stock_resto_date ON verifications_stock (restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_verif_stock_lot ON verifications_stock (lot_id);
