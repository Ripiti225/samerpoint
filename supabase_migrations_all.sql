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
-- Supprime d'abord TOUTE version existante (évite un doublon de surcharge qui
-- rendrait l'appel RPC ambigu — erreur PGRST203). Rejouable sans risque.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT oid::regprocedure::text AS sig FROM pg_proc WHERE proname = 'upsert_transaction_fournisseur'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

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

-- ── 8. RLS sur les tables créées ci-dessus (secure-by-default) ──────
--    Aligne sur le motif de l'app : RLS ON + politique permissive `allow_all`
--    (ALL pour le rôle public). Idempotent. NB : ceci aligne mais ne durcit
--    pas — la clé anon garde un accès total (cf. note sécurité).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'erreurs_client','inventaires_shifts','inventaire_lignes','entrees_shift',
    'litiges_responsables','verifications_stock'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;


-- ── 9. Annulation d'une déduction d'inventaire (par produit) ────────
--    (manager/directeur — écrans app/verification.js et app/litiges.js)
--    On remet montant_deduit à 0 et on garde une trace ; les totaux
--    consommés en aval (inventaires_shifts.montant_a_deduire,
--    points.montant_inventaire) sont décrémentés côté app.
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS deduction_annulee      boolean DEFAULT false;
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS deduction_annulee_par  text;
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS deduction_annulee_at   timestamptz;
ALTER TABLE inventaire_lignes ADD COLUMN IF NOT EXISTS montant_deduit_annule  numeric;


-- ── 10. Demandes d'explication (workflow avec suivi + rappel J+3) ────
--    Écrans app/demandes-explication.js (gérant) et
--    app/demandes-explication-admin.js (manager/rh/directeur, 2 onglets).
--    Détail complet + bloc pg_cron dans supabase_demandes_explication.sql.
CREATE TABLE IF NOT EXISTS demandes_explication (
  id                     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id          uuid REFERENCES restaurants(id),
  travailleur_id         uuid REFERENCES travailleurs(id),
  travailleur_nom        text,
  motif                  text NOT NULL,
  description            text,
  statut                 text DEFAULT 'en_attente_acceptation',
  numero                 int  DEFAULT 1,
  relance_de             uuid REFERENCES demandes_explication(id),
  cree_par_id            uuid REFERENCES utilisateurs(id),
  cree_par_nom           text,
  cree_par_role          text,
  accepte_par_id         uuid REFERENCES utilisateurs(id),
  accepte_par_nom        text,
  accepte_at             timestamptz,
  refuse_par_nom         text,
  refus_motif            text,
  refuse_at              timestamptz,
  envoyee_par_id         uuid REFERENCES utilisateurs(id),
  envoyee_par_nom        text,
  envoyee_at             timestamptz,
  rappel_envoye_at       timestamptz,
  reponse_recuperee_par  text,
  reponse_recuperee_at   timestamptz,
  reponse_note           text,
  annule_par_nom         text,
  annule_at              timestamptz,
  created_at             timestamptz DEFAULT now()
);
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS numero           int  DEFAULT 1;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS relance_de       uuid REFERENCES demandes_explication(id);
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS rappel_envoye_at timestamptz;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS cree_par_role    text;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS reponse_fichier_url  text;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS reponse_fichier_type text;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS reponse_uploadee_at  timestamptz;
CREATE INDEX IF NOT EXISTS idx_demandes_explication_resto  ON demandes_explication(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_demandes_explication_statut ON demandes_explication(statut);
ALTER TABLE demandes_explication ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON demandes_explication;
CREATE POLICY allow_all ON demandes_explication FOR ALL TO public USING (true) WITH CHECK (true);


-- =====================================================================
--  FIN — vérifie le message « Success. No rows returned » après le Run.
-- =====================================================================
