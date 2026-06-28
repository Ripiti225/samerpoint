-- =====================================================================
--  MIGRATIONS SAMTRACKLY — SCRIPT UNIQUE CONSOLIDÉ
--  Regroupe les 8 migrations de la branche feature/pos-system.
--  100% idempotent (IF NOT EXISTS / OR REPLACE) → rejouable sans risque.
--  À exécuter UNE FOIS dans Supabase → SQL Editor → Run.
--
--  Ne dépend que de tables déjà existantes : demandes, points,
--  transactions_fournisseurs, restaurants, utilisateurs, fournisseurs.
-- =====================================================================


-- ── 1. Demandes financières : montant demandé / montant alloué ──────
--    (app/demandes.js, app/demandes-admin.js)
ALTER TABLE demandes ADD COLUMN IF NOT EXISTS montant NUMERIC;
ALTER TABLE demandes ADD COLUMN IF NOT EXISTS montant_alloue NUMERIC;


-- ── 2. Écart de caisse — colonnes sur points ────────────────────────
--    (app/ventes.js saisie gérant, app/litiges.js régularisation manager)
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_responsables   JSONB;  -- [{travailleur_id, nom, role, montant}]
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_photos         JSONB;  -- ["url1", ...]
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_regularisations JSONB; -- [{sens, montant, motif, photos, par_id, par_nom, created_at}]


-- ── 3. Monitoring : journal des erreurs client ──────────────────────
--    (lib/logErreur.js → onglet « ⚠️ Erreurs » de app/journal.js)
CREATE TABLE IF NOT EXISTS erreurs_client (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contexte TEXT,
  message TEXT,
  details TEXT,
  meta JSONB,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erreurs_client_created ON erreurs_client (created_at DESC);


-- ── 4. Inventaires par shift (nouveau format) ───────────────────────
--    inventaires_shifts → inventaire_lignes / entrees_shift (FK)
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

ALTER TABLE points ADD COLUMN IF NOT EXISTS montant_inventaire NUMERIC DEFAULT 0;


-- ── 5. Responsables des écarts (table relationnelle filtrable) ──────
--    (app/ventes.js → onglet Écarts de app/litiges.js)
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
CREATE INDEX IF NOT EXISTS idx_litiges_resp_personne   ON litiges_responsables (responsable_id);


-- ── 6. Comptages physiques du vérificateur ──────────────────────────
--    (app/verificateur.js + composant Récap)
CREATE TABLE IF NOT EXISTS verifications_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id TEXT,                    -- regroupe les lignes d'un même comptage
  restaurant_id UUID REFERENCES restaurants(id),
  date DATE,
  verificateur_id UUID REFERENCES utilisateurs(id),
  verificateur_nom TEXT,
  produit_id TEXT,
  produit_nom TEXT,
  stock_reel NUMERIC DEFAULT 0,
  stock_compte NUMERIC DEFAULT 0,
  ecart NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
-- Si la table existait déjà sans lot_id (créée avant cette session) :
ALTER TABLE verifications_stock ADD COLUMN IF NOT EXISTS lot_id TEXT;
CREATE INDEX IF NOT EXISTS idx_verif_stock_resto_date ON verifications_stock (restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_verif_stock_lot        ON verifications_stock (lot_id);


-- ── 7. RPC atomique upsert transaction fournisseur ──────────────────
--    (lib/api.js saveOneTransactionFournisseur — sinon fallback non atomique)
CREATE OR REPLACE FUNCTION upsert_transaction_fournisseur(
  p_point_id        UUID,
  p_fournisseur_id  UUID,
  p_saisi_par       TEXT,
  p_caissier_nom    TEXT,
  p_facture         NUMERIC,
  p_paye            NUMERIC,
  p_reste           NUMERIC,
  p_fournisseur_nom TEXT,
  p_restaurant_id   UUID,
  p_caissier_id     UUID,
  p_photo_url       TEXT,
  p_source          TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM transactions_fournisseurs
  WHERE point_id = p_point_id
    AND fournisseur_id = p_fournisseur_id
    AND saisi_par = p_saisi_par
    AND (p_caissier_nom IS NULL OR caissier_nom = p_caissier_nom);

  IF COALESCE(p_facture, 0) = 0 AND COALESCE(p_paye, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO transactions_fournisseurs (
    point_id, fournisseur_id, fournisseur_nom, source, restaurant_id,
    caissier_id, facture, paye, reste, photo_url, saisi_par, caissier_nom
  ) VALUES (
    p_point_id, p_fournisseur_id, p_fournisseur_nom, p_source, p_restaurant_id,
    p_caissier_id, p_facture, p_paye, p_reste, p_photo_url, p_saisi_par, p_caissier_nom
  );
END;
$$;

-- =====================================================================
--  FIN — vérifie le message « Success. No rows returned » après le Run.
-- =====================================================================
