-- Responsables des écarts (manquant/surplus) — table relationnelle filtrable
-- Remplie depuis app/ventes.js (delete + insert par point) et consultée dans
-- l'onglet Écarts de app/litiges.js (filtres : responsable, type, restaurant, période).

CREATE TABLE IF NOT EXISTS litiges_responsables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id UUID REFERENCES points(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id),
  date DATE,
  responsable_id UUID REFERENCES utilisateurs(id),
  responsable_nom TEXT,
  role TEXT,
  montant NUMERIC DEFAULT 0,
  type TEXT, -- 'manquant' | 'surplus'
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_litiges_resp_resto_date ON litiges_responsables (restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_litiges_resp_personne ON litiges_responsables (responsable_id);
