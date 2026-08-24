-- Le comptage physique du vérificateur devient le stock initial de l'inventaire
-- (écran app/verificateur.js → app/inventaire.js), et reste corrigeable après coup
-- depuis le récap (components/RecapVerifications.js).
--
-- Pourquoi une colonne d'override plutôt qu'un simple UPDATE des lignes :
-- app/inventaire.js supprime puis réinsère TOUTES les lignes à chaque sauvegarde,
-- à partir de l'état React de l'écran du caissier. Un UPDATE direct de
-- inventaire_lignes.stock_initial serait donc écrasé à la sauvegarde suivante.
-- L'override est porté par le shift : l'écran le relit et le réapplique à chaque
-- chargement, donc il survit aux sauvegardes.

-- ── Override de stock initial porté par le shift d'inventaire ────────────────
ALTER TABLE inventaires_shifts
  ADD COLUMN IF NOT EXISTS stock_initial_verif JSONB,      -- { produit_id: nombre compté }
  ADD COLUMN IF NOT EXISTS verif_lot_id TEXT,              -- lot du comptage appliqué
  ADD COLUMN IF NOT EXISTS verif_applique_at TIMESTAMP;

-- ── Traçabilité des corrections de comptage ─────────────────────────────────
ALTER TABLE verifications_stock
  ADD COLUMN IF NOT EXISTS inventaire_id UUID REFERENCES inventaires_shifts(id),
  ADD COLUMN IF NOT EXISTS stock_compte_origine NUMERIC,   -- valeur saisie à l'origine
  ADD COLUMN IF NOT EXISTS corrige_par_id UUID REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS corrige_par_nom TEXT,
  ADD COLUMN IF NOT EXISTS corrige_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_verif_stock_inventaire ON verifications_stock (inventaire_id);
CREATE INDEX IF NOT EXISTS idx_inv_shifts_resto_valide ON inventaires_shifts (restaurant_id, valide);
