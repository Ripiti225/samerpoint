-- =====================================================================
--  TRÉSORERIE — étape 2 de la nouvelle trésorerie : espèces, virements,
--  prêts en espèces, emprunts au coffre.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS
--  supabase_tresorerie_charges.sql. Idempotent. Montants en FCFA entiers.
--  Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
-- =====================================================================

-- ── Espèces : un compte comme BACI et SIB ────────────────────────────
INSERT INTO tresorerie_comptes (nom, ordre) VALUES ('Espèces', 3)
ON CONFLICT (nom) DO NOTHING;

ALTER TABLE tresorerie_mouvements DROP CONSTRAINT IF EXISTS tresorerie_mouvements_type_check;
ALTER TABLE tresorerie_mouvements ADD CONSTRAINT tresorerie_mouvements_type_check
  CHECK (type IN ('recalage','recu_banque','paiement','partenaire','coffre','direction','especes','virement','pret','autre'));

-- Origine d'une entrée d'espèces (restaurant) et lien entre les deux moitiés d'un virement.
ALTER TABLE tresorerie_mouvements ADD COLUMN IF NOT EXISTS restaurant_id uuid REFERENCES restaurants(id);
ALTER TABLE tresorerie_mouvements ADD COLUMN IF NOT EXISTS groupe uuid;
CREATE INDEX IF NOT EXISTS idx_treso_mvt_groupe ON tresorerie_mouvements (groupe) WHERE groupe IS NOT NULL;

-- ── Prêt en espèces : une dette liée à son entrée ────────────────────
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS est_pret boolean NOT NULL DEFAULT false;
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS pret_mouvement_id uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION tresorerie_entree_pret(
  p_compte_id uuid, p_montant bigint, p_date date, p_creancier text, p_note text,
  p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_du  uuid;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF coalesce(trim(p_creancier), '') = '' THEN RAISE EXCEPTION 'Prêteur manquant'; END IF;

  INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
  VALUES (p_compte_id, p_date, p_montant, 'pret', 'Prêt · ' || trim(p_creancier), p_user_id, p_user_nom)
  RETURNING id INTO v_mvt;

  INSERT INTO tresorerie_dus (categorie, creancier, montant_du, note, est_pret, pret_mouvement_id, cree_par, cree_par_nom)
  VALUES ('dette', trim(p_creancier), p_montant, p_note, true, v_mvt, p_user_id, p_user_nom)
  RETURNING id INTO v_du;
  RETURN v_du;
END $$;

-- Annuler une entrée de prêt : la dette part avec, tant qu'aucun remboursement n'existe.
CREATE OR REPLACE FUNCTION tresorerie_annuler_pret(p_mouvement uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_du uuid;
BEGIN
  SELECT id INTO v_du FROM tresorerie_dus WHERE pret_mouvement_id = p_mouvement;
  IF v_du IS NOT NULL AND EXISTS (SELECT 1 FROM tresorerie_paiements WHERE du_id = v_du) THEN
    RAISE EXCEPTION 'Ce prêt a déjà des remboursements : annulez-les d''abord depuis la dette.';
  END IF;
  IF v_du IS NOT NULL THEN DELETE FROM tresorerie_dus WHERE id = v_du; END IF;
  DELETE FROM tresorerie_mouvements WHERE id = p_mouvement AND type = 'pret';
END $$;

-- ── Virement entre deux comptes ──────────────────────────────────────
CREATE OR REPLACE FUNCTION tresorerie_virement(
  p_de uuid, p_vers uuid, p_montant bigint, p_date date, p_libelle text,
  p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_groupe uuid := gen_random_uuid();
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF p_de IS NULL OR p_vers IS NULL OR p_de = p_vers THEN RAISE EXCEPTION 'Choisissez deux comptes différents'; END IF;

  INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, groupe, cree_par, cree_par_nom)
  VALUES (p_de, p_date, -p_montant, 'virement', p_libelle, v_groupe, p_user_id, p_user_nom),
         (p_vers, p_date, p_montant, 'virement', p_libelle, v_groupe, p_user_id, p_user_nom);
  RETURN v_groupe;
END $$;

-- ── Emprunts au coffre ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tresorerie_coffre_emprunts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  date NOT NULL DEFAULT current_date,
  montant               bigint NOT NULL CHECK (montant > 0),
  compte_id             uuid NOT NULL REFERENCES tresorerie_comptes(id),
  coffre_mouvement_id   uuid REFERENCES tresorerie_coffre_mouvements(id) ON DELETE SET NULL,
  rembourser_le         date,
  rembourser_partenaire text CHECK (rembourser_partenaire IN ('yango','glovo','wave','om','djamo')),
  rembourse_le          date,
  remboursement_coffre_id uuid REFERENCES tresorerie_coffre_mouvements(id) ON DELETE SET NULL,
  note                  text,
  cree_par              text,
  cree_par_nom          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emprunt_quand CHECK (rembourser_le IS NOT NULL OR rembourser_partenaire IS NOT NULL)
);

-- Emprunter : sortie du coffre vers le compte choisi (mouvement de banque inverse).
CREATE OR REPLACE FUNCTION tresorerie_coffre_emprunter(
  p_montant bigint, p_compte_id uuid, p_date date, p_rembourser_le date, p_rembourser_partenaire text,
  p_note text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_coffre uuid;
  v_id uuid;
BEGIN
  v_coffre := tresorerie_coffre_operation('retrait', p_montant, 'compte', p_compte_id, p_date,
    'Emprunt au coffre' || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_user_id, p_user_nom);
  INSERT INTO tresorerie_coffre_emprunts (date, montant, compte_id, coffre_mouvement_id, rembourser_le,
    rembourser_partenaire, note, cree_par, cree_par_nom)
  VALUES (p_date, p_montant, p_compte_id, v_coffre, p_rembourser_le, p_rembourser_partenaire, p_note, p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Rembourser : le montant revient au coffre depuis le compte choisi.
CREATE OR REPLACE FUNCTION tresorerie_coffre_rembourser(
  p_emprunt uuid, p_compte_id uuid, p_date date, p_user_id text, p_user_nom text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_montant bigint;
  v_coffre uuid;
BEGIN
  SELECT montant INTO v_montant FROM tresorerie_coffre_emprunts WHERE id = p_emprunt AND rembourse_le IS NULL;
  IF v_montant IS NULL THEN RAISE EXCEPTION 'Emprunt introuvable ou déjà remboursé'; END IF;
  v_coffre := tresorerie_coffre_operation('depot', v_montant, 'compte', p_compte_id, p_date,
    'Remboursement du coffre', p_user_id, p_user_nom);
  UPDATE tresorerie_coffre_emprunts SET rembourse_le = p_date, remboursement_coffre_id = v_coffre WHERE id = p_emprunt;
END $$;

-- Annuler un emprunt pas encore remboursé : l'argent revient au coffre (les
-- deux mouvements sont retirés).
CREATE OR REPLACE FUNCTION tresorerie_coffre_emprunt_annuler(p_emprunt uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_coffre uuid;
  v_mvt uuid;
BEGIN
  SELECT coffre_mouvement_id INTO v_coffre FROM tresorerie_coffre_emprunts WHERE id = p_emprunt AND rembourse_le IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Un emprunt remboursé ne s''annule pas.'; END IF;
  DELETE FROM tresorerie_coffre_emprunts WHERE id = p_emprunt;
  IF v_coffre IS NOT NULL THEN
    SELECT mouvement_id INTO v_mvt FROM tresorerie_coffre_mouvements WHERE id = v_coffre;
    DELETE FROM tresorerie_coffre_mouvements WHERE id = v_coffre;
    IF v_mvt IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = v_mvt; END IF;
  END IF;
END $$;

-- Un mouvement du coffre lié à un emprunt ne s'annule que par l'emprunt.
CREATE OR REPLACE FUNCTION tresorerie_coffre_annuler(p_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_mvt uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM tresorerie_coffre_mouvements WHERE id = p_id AND type = 'depense') THEN
    RAISE EXCEPTION 'Cette sortie vient d''une dépense direction : supprimez la dépense.';
  END IF;
  IF EXISTS (SELECT 1 FROM tresorerie_coffre_emprunts WHERE coffre_mouvement_id = p_id OR remboursement_coffre_id = p_id) THEN
    RAISE EXCEPTION 'Ce mouvement vient d''un emprunt : gérez-le depuis la liste des emprunts.';
  END IF;
  SELECT mouvement_id INTO v_mvt FROM tresorerie_coffre_mouvements WHERE id = p_id;
  DELETE FROM tresorerie_coffre_mouvements WHERE id = p_id;
  IF v_mvt IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = v_mvt; END IF;
END $$;

-- ── RLS et droits d'exécution : même régime que le reste de l'app ───
ALTER TABLE tresorerie_coffre_emprunts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON tresorerie_coffre_emprunts;
CREATE POLICY allow_all ON tresorerie_coffre_emprunts FOR ALL TO public USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION tresorerie_entree_pret(uuid, bigint, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_pret(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_virement(uuid, uuid, bigint, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_coffre_emprunter(bigint, uuid, date, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_coffre_rembourser(uuid, uuid, date, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_coffre_emprunt_annuler(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_coffre_annuler(uuid) TO anon, authenticated;
