-- =====================================================================
--  TRÉSORERIE — étape 3 : coffre de sécurité et dépenses direction.
--
--  À exécuter dans le SQL Editor de Supabase (projet Samtrackly), APRÈS
--  supabase_tresorerie.sql et supabase_tresorerie_partenaires.sql.
--  Idempotent : relançable sans dégât. Montants en FCFA entiers.
-- =====================================================================

-- Les opérations du coffre et les dépenses direction sortent / entrent en banque.
ALTER TABLE tresorerie_mouvements DROP CONSTRAINT IF EXISTS tresorerie_mouvements_type_check;
ALTER TABLE tresorerie_mouvements ADD CONSTRAINT tresorerie_mouvements_type_check
  CHECK (type IN ('recalage','recu_banque','paiement','partenaire','coffre','direction','autre'));

-- ── Coffre ───────────────────────────────────────────────────────────
-- montant signé : + dépôt, − retrait ou dépense payée depuis le coffre.
CREATE TABLE IF NOT EXISTS tresorerie_coffre_mouvements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL DEFAULT current_date,
  montant      bigint NOT NULL CHECK (montant <> 0),
  type         text NOT NULL CHECK (type IN ('depot','retrait','depense')),
  source       text NOT NULL CHECK (source IN ('compte','especes','coffre')),
  compte_id    uuid REFERENCES tresorerie_comptes(id),
  mouvement_id uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL,
  libelle      text,
  cree_par     text,
  cree_par_nom text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treso_coffre_date ON tresorerie_coffre_mouvements (date DESC);

CREATE TABLE IF NOT EXISTS tresorerie_coffre_objectifs (
  mois       date PRIMARY KEY CHECK (extract(day FROM mois) = 1),
  montant    bigint NOT NULL CHECK (montant >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Dépenses direction (M. Zreik) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tresorerie_depenses_direction (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL DEFAULT current_date,
  categorie           text NOT NULL CHECK (categorie IN ('fond','reparation','materiel','equipement','investissement','retrait_perso')),
  restaurant_id       uuid REFERENCES restaurants(id),
  montant             bigint NOT NULL CHECK (montant > 0),
  source              text NOT NULL CHECK (source IN ('compte','especes','coffre')),
  compte_id           uuid REFERENCES tresorerie_comptes(id),
  mouvement_id        uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL,
  coffre_mouvement_id uuid REFERENCES tresorerie_coffre_mouvements(id) ON DELETE SET NULL,
  note                text,
  photo_url           text,
  cree_par            text,
  cree_par_nom        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depense_compte_coherent CHECK ((source = 'compte') = (compte_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_treso_dir_date ON tresorerie_depenses_direction (date DESC);

-- ── Dépôt / retrait du coffre, avec le mouvement de banque inverse ──
-- p_type 'depot' : l'argent quitte BACI / SIB (ou vient d'espèces) et entre au coffre.
-- p_type 'retrait' : l'argent sort du coffre vers BACI / SIB (ou en espèces).
CREATE OR REPLACE FUNCTION tresorerie_coffre_operation(
  p_type text, p_montant bigint, p_source text, p_compte_id uuid, p_date date,
  p_libelle text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_id uuid;
  v_signe int := CASE WHEN p_type = 'depot' THEN 1 ELSE -1 END;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF p_type NOT IN ('depot','retrait') THEN RAISE EXCEPTION 'Opération inconnue'; END IF;

  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -v_signe * p_montant, 'coffre', p_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  END IF;

  INSERT INTO tresorerie_coffre_mouvements (date, montant, type, source, compte_id, mouvement_id, libelle, cree_par, cree_par_nom)
  VALUES (p_date, v_signe * p_montant, p_type, p_source, CASE WHEN p_source = 'compte' THEN p_compte_id END,
          v_mvt, p_libelle, p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION tresorerie_coffre_annuler(p_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_mvt uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM tresorerie_coffre_mouvements WHERE id = p_id AND type = 'depense') THEN
    RAISE EXCEPTION 'Cette sortie vient d''une dépense direction : supprimez la dépense.';
  END IF;
  SELECT mouvement_id INTO v_mvt FROM tresorerie_coffre_mouvements WHERE id = p_id;
  DELETE FROM tresorerie_coffre_mouvements WHERE id = p_id;
  IF v_mvt IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = v_mvt; END IF;
END $$;

-- ── Dépense direction, avec sa sortie (banque ou coffre) ─────────────
CREATE OR REPLACE FUNCTION tresorerie_depense_direction(
  p_date date, p_categorie text, p_restaurant_id uuid, p_montant bigint, p_source text,
  p_compte_id uuid, p_libelle text, p_note text, p_photo_url text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_coffre uuid;
  v_id uuid;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;

  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -p_montant, 'direction', p_libelle, p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  ELSIF p_source = 'coffre' THEN
    INSERT INTO tresorerie_coffre_mouvements (date, montant, type, source, libelle, cree_par, cree_par_nom)
    VALUES (p_date, -p_montant, 'depense', 'coffre', p_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_coffre;
  END IF;

  INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, montant, source, compte_id, mouvement_id,
    coffre_mouvement_id, note, photo_url, cree_par, cree_par_nom)
  VALUES (p_date, p_categorie, p_restaurant_id, p_montant, p_source, CASE WHEN p_source = 'compte' THEN p_compte_id END,
    v_mvt, v_coffre, p_note, p_photo_url, p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION tresorerie_depense_direction_supprimer(p_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_coffre uuid;
BEGIN
  SELECT mouvement_id, coffre_mouvement_id INTO v_mvt, v_coffre FROM tresorerie_depenses_direction WHERE id = p_id;
  DELETE FROM tresorerie_depenses_direction WHERE id = p_id;
  IF v_mvt IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = v_mvt; END IF;
  IF v_coffre IS NOT NULL THEN DELETE FROM tresorerie_coffre_mouvements WHERE id = v_coffre; END IF;
END $$;

-- ── RLS : même régime que le reste de l'app ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tresorerie_coffre_mouvements','tresorerie_coffre_objectifs','tresorerie_depenses_direction'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_coffre_operation(text, bigint, text, uuid, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_coffre_annuler(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_depense_direction(date, text, uuid, bigint, text, uuid, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_depense_direction_supprimer(uuid) TO anon, authenticated;
