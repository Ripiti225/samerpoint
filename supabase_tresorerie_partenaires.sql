-- =====================================================================
--  TRÉSORERIE — étape 2 : partenaires à recevoir (Yango, Glovo, Wave,
--  Orange Money, Djamo).
--
--  À exécuter dans le SQL Editor de Supabase (projet Samtrackly), APRÈS
--  supabase_tresorerie.sql. Idempotent : relançable sans dégât.
--  Montants en FCFA entiers.
-- =====================================================================

-- ── Réglages par partenaire ──────────────────────────────────────────
-- date_depart vide = partenaire pas encore suivi.
-- mode_versement : 'groupe' (un virement pour tous les restos, Yango) ou
-- 'restaurant' (un virement par restaurant).
CREATE TABLE IF NOT EXISTS tresorerie_partenaires (
  partenaire     text PRIMARY KEY CHECK (partenaire IN ('yango','glovo','wave','om','djamo')),
  date_depart    date,
  mode_versement text NOT NULL CHECK (mode_versement IN ('groupe','restaurant')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tresorerie_partenaires (partenaire, mode_versement) VALUES
  ('yango', 'groupe'), ('glovo', 'restaurant'), ('wave', 'restaurant'),
  ('om', 'restaurant'), ('djamo', 'restaurant')
ON CONFLICT (partenaire) DO NOTHING;

-- ── Code des exports (KMS, PALM, 7E…) → restaurant de l'app ─────────
CREATE TABLE IF NOT EXISTS tresorerie_alias (
  code          text PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Exports importés (un par partenaire et par période) ─────────────
CREATE TABLE IF NOT EXISTS tresorerie_partenaire_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partenaire    text NOT NULL CHECK (partenaire IN ('yango','glovo')),
  periode_debut date NOT NULL,
  periode_fin   date NOT NULL,
  fichier_nom   text,
  details       jsonb NOT NULL DEFAULT '{}',
  cree_par      text,
  cree_par_nom  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partenaire, periode_debut)
);

-- ── Montants d'une période ──────────────────────────────────────────
-- type 'reel' : montant de l'export pour un restaurant (remplace l'estimé)
-- type 'pub'  : pub payée, par restaurant, déduite après import
-- type 'recu' : argent reçu (restaurant_id vide = versement groupé Yango)
CREATE TABLE IF NOT EXISTS tresorerie_partenaire_lignes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partenaire    text NOT NULL CHECK (partenaire IN ('yango','glovo','wave','om','djamo')),
  periode_debut date NOT NULL,
  restaurant_id uuid REFERENCES restaurants(id),
  type          text NOT NULL CHECK (type IN ('reel','pub','recu')),
  montant       bigint NOT NULL,
  brut          bigint,
  import_id     uuid REFERENCES tresorerie_partenaire_imports(id) ON DELETE CASCADE,
  compte_id     uuid REFERENCES tresorerie_comptes(id),
  date          date,
  mouvement_id  uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL,
  note          text,
  photo_url     text,
  cree_par      text,
  cree_par_nom  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ligne_reel_import CHECK (type <> 'reel' OR (import_id IS NOT NULL AND restaurant_id IS NOT NULL)),
  CONSTRAINT ligne_pub_resto CHECK (type <> 'pub' OR (restaurant_id IS NOT NULL AND montant > 0)),
  CONSTRAINT ligne_recu_compte CHECK (type <> 'recu' OR (compte_id IS NOT NULL AND date IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_treso_part_lignes ON tresorerie_partenaire_lignes (partenaire, periode_debut);

-- Les réceptions de partenaires entrent en banque avec leur propre type.
ALTER TABLE tresorerie_mouvements DROP CONSTRAINT IF EXISTS tresorerie_mouvements_type_check;
ALTER TABLE tresorerie_mouvements ADD CONSTRAINT tresorerie_mouvements_type_check
  CHECK (type IN ('recalage','recu_banque','paiement','partenaire','autre'));

-- ── Import atomique : remplace l'import précédent de la même période ─
-- p_lignes : [{"restaurant_id": "...", "montant": 1000, "brut": 1300}, ...]
CREATE OR REPLACE FUNCTION tresorerie_importer(
  p_partenaire text, p_debut date, p_fin date, p_fichier text, p_details jsonb,
  p_lignes jsonb, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_import uuid;
BEGIN
  DELETE FROM tresorerie_partenaire_imports WHERE partenaire = p_partenaire AND periode_debut = p_debut;

  INSERT INTO tresorerie_partenaire_imports (partenaire, periode_debut, periode_fin, fichier_nom, details, cree_par, cree_par_nom)
  VALUES (p_partenaire, p_debut, p_fin, p_fichier, coalesce(p_details, '{}'), p_user_id, p_user_nom)
  RETURNING id INTO v_import;

  INSERT INTO tresorerie_partenaire_lignes (partenaire, periode_debut, restaurant_id, type, montant, brut, import_id, cree_par, cree_par_nom)
  SELECT p_partenaire, p_debut, (x->>'restaurant_id')::uuid, 'reel', (x->>'montant')::bigint,
         nullif(x->>'brut', '')::bigint, v_import, p_user_id, p_user_nom
  FROM jsonb_array_elements(p_lignes) x;

  RETURN v_import;
END $$;

-- ── Réception : la ligne « reçu » + l'entrée en banque ──────────────
CREATE OR REPLACE FUNCTION tresorerie_recevoir(
  p_partenaire text, p_debut date, p_restaurant_id uuid, p_montant bigint,
  p_compte_id uuid, p_date date, p_libelle text, p_note text, p_photo_url text,
  p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_ligne uuid;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN
    RAISE EXCEPTION 'Montant reçu manquant';
  END IF;

  INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
  VALUES (p_compte_id, p_date, p_montant, 'partenaire', p_libelle, p_photo_url, p_user_id, p_user_nom)
  RETURNING id INTO v_mvt;

  INSERT INTO tresorerie_partenaire_lignes (partenaire, periode_debut, restaurant_id, type, montant, compte_id, date, mouvement_id, note, photo_url, cree_par, cree_par_nom)
  VALUES (p_partenaire, p_debut, p_restaurant_id, 'recu', p_montant, p_compte_id, p_date, v_mvt, p_note, p_photo_url, p_user_id, p_user_nom)
  RETURNING id INTO v_ligne;

  RETURN v_ligne;
END $$;

CREATE OR REPLACE FUNCTION tresorerie_annuler_reception(p_ligne uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
BEGIN
  SELECT mouvement_id INTO v_mvt FROM tresorerie_partenaire_lignes WHERE id = p_ligne AND type = 'recu';
  DELETE FROM tresorerie_partenaire_lignes WHERE id = p_ligne AND type = 'recu';
  IF v_mvt IS NOT NULL THEN
    DELETE FROM tresorerie_mouvements WHERE id = v_mvt;
  END IF;
END $$;

-- ── RLS : même régime que le reste de l'app ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tresorerie_partenaires','tresorerie_alias',
                           'tresorerie_partenaire_imports','tresorerie_partenaire_lignes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_importer(text, date, date, text, jsonb, jsonb, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_recevoir(text, date, uuid, bigint, uuid, date, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_reception(uuid) TO anon, authenticated;
