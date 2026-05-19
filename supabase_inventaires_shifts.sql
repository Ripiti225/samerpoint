-- Tables nouvelles inventaires par shift
CREATE TABLE IF NOT EXISTS inventaires_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id UUID REFERENCES points(id),
  caissier_id UUID REFERENCES utilisateurs(id),
  restaurant_id UUID REFERENCES restaurants(id),
  date DATE NOT NULL,
  type_shift TEXT NOT NULL,
  heure_debut TIME,
  heure_fin TIME,
  valide BOOLEAN DEFAULT false,
  montant_a_deduire NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventaire_lignes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventaire_id UUID REFERENCES inventaires_shifts(id) ON DELETE CASCADE,
  produit_id TEXT NOT NULL,
  produit_nom TEXT,
  stock_initial NUMERIC DEFAULT 0,
  entrees NUMERIC DEFAULT 0,
  sorties NUMERIC DEFAULT 0,
  stock_reel NUMERIC,
  ecart NUMERIC,
  nombre_explique NUMERIC,
  explication TEXT,
  montant_deduit NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entrees_shift (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventaire_id UUID REFERENCES inventaires_shifts(id) ON DELETE CASCADE,
  fournisseur_id UUID REFERENCES fournisseurs(id),
  fournisseur_nom TEXT,
  produit_id TEXT NOT NULL,
  produit_nom TEXT,
  quantite NUMERIC NOT NULL,
  source TEXT DEFAULT 'reception',
  created_at TIMESTAMP DEFAULT now()
);

-- Colonne montant_inventaire dans points (si pas déjà là)
ALTER TABLE points ADD COLUMN IF NOT EXISTS montant_inventaire NUMERIC DEFAULT 0;
