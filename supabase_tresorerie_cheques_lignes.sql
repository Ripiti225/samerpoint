-- =====================================================================
--  TRÉSORERIE — un chèque paie plusieurs lignes (02/11/2026).
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS
--  supabase_tresorerie_cheques.sql et supabase_groupes_restaurants.sql.
--  Idempotent. Montants en FCFA entiers.
--
--  Une ligne de chèque paie :
--   - une ligne d'À payer (loyer, dette, salaire, autre) : elle porte une
--     prévision de cette ligne tant que le chèque n'est pas encaissé ;
--   - ou un fournisseur ADMINISTRATIF (CNPS, ITS, TEE, impôts, droits des
--     anciens travailleurs…) : à l'encaissement, paiement sur son crédit +
--     dépense direction « administratif », comme « Payé par la direction ».
--  Le montant du chèque = la somme de ses lignes (ou un montant libre s'il
--  n'en a aucune). L'encaissement fait UNE sortie de banque, comme le relevé.
--  Les anciennes fonctions gardent leur nom : l'app installée pas encore mise
--  à jour continue de marcher pour les chèques à une seule ligne.
-- =====================================================================

do $$
begin
  if to_regclass('public.tresorerie_cheques') is null then
    raise exception 'Il faut d''abord passer supabase_tresorerie_cheques.sql.';
  end if;
end $$;

CREATE TABLE IF NOT EXISTS tresorerie_cheques_lignes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id      uuid NOT NULL REFERENCES tresorerie_cheques(id) ON DELETE CASCADE,
  du_id          uuid REFERENCES tresorerie_dus(id) ON DELETE SET NULL,
  fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE SET NULL,
  montant        bigint NOT NULL CHECK (montant > 0),
  prevision_id   uuid REFERENCES tresorerie_previsions(id) ON DELETE SET NULL,
  depense_id     uuid REFERENCES tresorerie_depenses_direction(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cheque_ligne_une_cible CHECK (du_id IS NULL OR fournisseur_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_treso_cheques_lignes_cheque ON tresorerie_cheques_lignes (cheque_id);

ALTER TABLE tresorerie_cheques_lignes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON tresorerie_cheques_lignes;
CREATE POLICY allow_all ON tresorerie_cheques_lignes FOR ALL TO public USING (true) WITH CHECK (true);

-- Reprise : les chèques déjà reliés à une ligne d'À payer.
INSERT INTO tresorerie_cheques_lignes (cheque_id, du_id, montant, prevision_id)
SELECT c.id, c.du_id, c.montant, c.prevision_id
FROM tresorerie_cheques c
WHERE c.du_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tresorerie_cheques_lignes l WHERE l.cheque_id = c.id);

-- ── Saisie et modification (tant que le chèque n'est pas encaissé) ──
-- p_lignes : [{ "du_id": "…" } ou { "fournisseur_id": "…" }, "montant": 123]
-- Les lignes sont refaites à chaque enregistrement (prévisions comprises).
CREATE OR REPLACE FUNCTION tresorerie_enregistrer_cheque_lignes(
  p_id                uuid,
  p_compte_id         uuid,
  p_numero            text,
  p_banque            text,
  p_ordre             text,
  p_lignes            jsonb,
  p_montant           bigint,
  p_date_emission     date,
  p_date_encaissement date,
  p_note              text,
  p_photo_url         text,
  p_user_id           text,
  p_user_nom          text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id      uuid := p_id;
  v_statut  text;
  v_total   bigint;
  v_nb      int;
  v_montant bigint;
  v_note    text := 'Chèque n° ' || trim(p_numero) || ' ' || trim(p_banque);
  x         jsonb;
  v_du      uuid;
  v_fo      uuid;
  v_prev    uuid;
  v_type    text;
  v_seul_du uuid;
  v_seule_prev uuid;
BEGIN
  SELECT coalesce(sum((e->>'montant')::bigint), 0), count(*) INTO v_total, v_nb
  FROM jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) e;
  v_montant := CASE WHEN v_nb > 0 THEN v_total ELSE p_montant END;
  IF coalesce(v_montant, 0) <= 0 THEN RAISE EXCEPTION 'Montant du chèque manquant'; END IF;
  IF v_nb > 0 AND p_montant IS NOT NULL AND p_montant <> v_total THEN
    RAISE EXCEPTION 'Le montant du chèque doit être égal au total des lignes payées';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT statut INTO v_statut FROM tresorerie_cheques WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chèque introuvable'; END IF;
    IF v_statut <> 'emis' THEN RAISE EXCEPTION 'Ce chèque est déjà encaissé ou annulé : il ne se modifie plus'; END IF;
    DELETE FROM tresorerie_previsions
    WHERE id IN (SELECT prevision_id FROM tresorerie_cheques_lignes WHERE cheque_id = v_id AND prevision_id IS NOT NULL)
       OR id = (SELECT prevision_id FROM tresorerie_cheques WHERE id = v_id);
    DELETE FROM tresorerie_cheques_lignes WHERE cheque_id = v_id;
    UPDATE tresorerie_cheques SET compte_id = p_compte_id, numero = trim(p_numero), banque = trim(p_banque),
      ordre = trim(p_ordre), du_id = NULL, prevision_id = NULL, montant = v_montant,
      date_emission = p_date_emission, date_encaissement = p_date_encaissement,
      note = nullif(p_note, ''), photo_url = coalesce(p_photo_url, photo_url)
    WHERE id = v_id;
  ELSE
    INSERT INTO tresorerie_cheques (compte_id, numero, banque, ordre, montant,
      date_emission, date_encaissement, note, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, trim(p_numero), trim(p_banque), trim(p_ordre), v_montant,
      p_date_emission, p_date_encaissement, nullif(p_note, ''), p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_id;
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) LOOP
    v_du := nullif(x->>'du_id', '')::uuid;
    v_fo := nullif(x->>'fournisseur_id', '')::uuid;
    v_prev := NULL;
    IF (x->>'montant')::bigint IS NULL OR (x->>'montant')::bigint <= 0 THEN
      RAISE EXCEPTION 'Chaque ligne payée doit avoir un montant';
    END IF;
    IF (v_du IS NULL) = (v_fo IS NULL) THEN RAISE EXCEPTION 'Ligne de chèque invalide'; END IF;
    IF v_fo IS NOT NULL THEN
      SELECT type INTO v_type FROM fournisseurs WHERE id = v_fo;
      IF v_type IS DISTINCT FROM 'administratif' THEN
        RAISE EXCEPTION 'Seul un fournisseur administratif se paie par chèque';
      END IF;
    ELSE
      INSERT INTO tresorerie_previsions (du_id, montant, date_prevue, note, cree_par, cree_par_nom)
      VALUES (v_du, (x->>'montant')::bigint, p_date_encaissement, v_note, p_user_id, p_user_nom)
      RETURNING id INTO v_prev;
    END IF;
    INSERT INTO tresorerie_cheques_lignes (cheque_id, du_id, fournisseur_id, montant, prevision_id)
    VALUES (v_id, v_du, v_fo, (x->>'montant')::bigint, v_prev);
  END LOOP;

  -- Une seule ligne d'À payer : recopiée sur le chèque (lue par l'app pas encore à jour).
  IF v_nb = 1 THEN
    SELECT du_id, prevision_id INTO v_seul_du, v_seule_prev FROM tresorerie_cheques_lignes WHERE cheque_id = v_id;
    UPDATE tresorerie_cheques SET du_id = v_seul_du, prevision_id = v_seule_prev WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

-- Ancienne signature (une ligne au plus) : passe par la nouvelle.
CREATE OR REPLACE FUNCTION tresorerie_enregistrer_cheque(
  p_id uuid, p_compte_id uuid, p_numero text, p_banque text, p_ordre text, p_du_id uuid, p_montant bigint,
  p_date_emission date, p_date_encaissement date, p_note text, p_photo_url text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  IF p_id IS NOT NULL AND (SELECT count(*) FROM tresorerie_cheques_lignes WHERE cheque_id = p_id) > 1 THEN
    RAISE EXCEPTION 'Ce chèque paie plusieurs lignes : mettez l''application à jour pour le modifier';
  END IF;
  RETURN tresorerie_enregistrer_cheque_lignes(p_id, p_compte_id, p_numero, p_banque, p_ordre,
    CASE WHEN p_du_id IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('du_id', p_du_id, 'montant', p_montant)) END,
    p_montant, p_date_emission, p_date_encaissement, p_note, p_photo_url, p_user_id, p_user_nom);
END $$;

-- ── Encaissé : une sortie de banque, puis chaque ligne est payée ──
CREATE OR REPLACE FUNCTION tresorerie_encaisser_cheque(
  p_id       uuid,
  p_date     date,
  p_user_id  text,
  p_user_nom text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c       tresorerie_cheques%ROWTYPE;
  v_libelle text;
  v_groupe  uuid;
  v_mvt     uuid;
  l         record;
  fo        record;
  v_tx      uuid;
  v_dep     uuid;
BEGIN
  SELECT * INTO v_c FROM tresorerie_cheques WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chèque introuvable'; END IF;
  IF v_c.statut <> 'emis' THEN RAISE EXCEPTION 'Ce chèque est déjà encaissé ou annulé'; END IF;
  v_libelle := 'Chèque n° ' || v_c.numero || ' · ' || v_c.ordre;

  INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
  VALUES (v_c.compte_id, p_date, -v_c.montant, 'cheque', v_libelle, v_c.photo_url, p_user_id, p_user_nom)
  RETURNING id INTO v_mvt;

  IF EXISTS (SELECT 1 FROM tresorerie_cheques_lignes WHERE cheque_id = p_id AND du_id IS NOT NULL) THEN
    v_groupe := gen_random_uuid();
    INSERT INTO tresorerie_paiements (du_id, groupe, montant, date, source, compte_id, mouvement_id, photo_url,
      prevision_id, note, cree_par, cree_par_nom)
    SELECT l2.du_id, v_groupe, l2.montant, p_date, 'compte', v_c.compte_id, v_mvt, v_c.photo_url,
      l2.prevision_id, v_libelle, p_user_id, p_user_nom
    FROM tresorerie_cheques_lignes l2
    WHERE l2.cheque_id = p_id AND l2.du_id IS NOT NULL;
  END IF;

  FOR l IN SELECT * FROM tresorerie_cheques_lignes WHERE cheque_id = p_id AND fournisseur_id IS NOT NULL ORDER BY created_at, id LOOP
    SELECT id, nom, restaurant_id, groupe_id INTO fo FROM fournisseurs WHERE id = l.fournisseur_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable sur ce chèque'; END IF;
    v_tx := inserer_transaction_hors_point(fo.id, p_date, 0, l.montant, 'direction', 'paiement_direction', p_user_nom);
    -- Pas de mouvement propre : la sortie de banque est celle du chèque.
    INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, groupe_id, montant, source, compte_id,
      note, fournisseur_id, transaction_id, cree_par, cree_par_nom)
    VALUES (p_date, 'administratif', fo.restaurant_id, fo.groupe_id, l.montant, 'compte', v_c.compte_id,
      fo.nom || ' · ' || v_libelle, fo.id, v_tx, p_user_id, p_user_nom)
    RETURNING id INTO v_dep;
    UPDATE tresorerie_cheques_lignes SET depense_id = v_dep WHERE id = l.id;
  END LOOP;

  UPDATE tresorerie_cheques SET statut = 'encaisse', encaisse_le = p_date, paiement_groupe = v_groupe, mouvement_id = v_mvt
  WHERE id = p_id;
END $$;

-- ── Encaissement coché par erreur : tout est défait, retour à « émis » ──
CREATE OR REPLACE FUNCTION tresorerie_annuler_encaissement_cheque(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c tresorerie_cheques%ROWTYPE;
  l   record;
  v_tx uuid;
BEGIN
  SELECT * INTO v_c FROM tresorerie_cheques WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_c.statut <> 'encaisse' THEN RAISE EXCEPTION 'Ce chèque n''est pas encaissé'; END IF;

  FOR l IN SELECT * FROM tresorerie_cheques_lignes WHERE cheque_id = p_id AND depense_id IS NOT NULL LOOP
    SELECT transaction_id INTO v_tx FROM tresorerie_depenses_direction WHERE id = l.depense_id;
    DELETE FROM tresorerie_depenses_direction WHERE id = l.depense_id;
    IF v_tx IS NOT NULL THEN PERFORM retirer_transaction_hors_point(v_tx); END IF;
    UPDATE tresorerie_cheques_lignes SET depense_id = NULL WHERE id = l.id;
  END LOOP;

  IF v_c.paiement_groupe IS NOT NULL THEN
    PERFORM tresorerie_annuler_paiement(v_c.paiement_groupe);
  END IF;
  IF v_c.mouvement_id IS NOT NULL THEN
    DELETE FROM tresorerie_mouvements WHERE id = v_c.mouvement_id;
  END IF;
  UPDATE tresorerie_cheques SET statut = 'emis', encaisse_le = NULL, paiement_groupe = NULL, mouvement_id = NULL
  WHERE id = p_id;
END $$;

-- ── Chèque annulé (perdu, refait, jamais remis) : ses prévisions partent ──
CREATE OR REPLACE FUNCTION tresorerie_annuler_cheque(p_id uuid, p_motif text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c tresorerie_cheques%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM tresorerie_cheques WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_c.statut <> 'emis' THEN RAISE EXCEPTION 'Seul un chèque pas encore encaissé s''annule'; END IF;
  IF coalesce(trim(p_motif), '') = '' THEN RAISE EXCEPTION 'Motif de l''annulation manquant'; END IF;
  DELETE FROM tresorerie_previsions
  WHERE id IN (SELECT prevision_id FROM tresorerie_cheques_lignes WHERE cheque_id = p_id AND prevision_id IS NOT NULL)
     OR id = v_c.prevision_id;
  UPDATE tresorerie_cheques SET statut = 'annule', annule_le = current_date, motif_annulation = trim(p_motif), prevision_id = NULL
  WHERE id = p_id;
END $$;

-- Une dépense direction créée par un chèque se défait par le chèque
-- (« Annuler l'encaissement »), jamais seule : sinon la banque et le crédit
-- du fournisseur ne correspondraient plus.
CREATE OR REPLACE FUNCTION tresorerie_depense_direction_supprimer(p_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_coffre uuid;
  v_tx uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM tresorerie_cheques_lignes WHERE depense_id = p_id) THEN
    RAISE EXCEPTION 'Cette dépense vient d''un chèque : annulez l''encaissement du chèque dans Chèques émis.';
  END IF;
  SELECT mouvement_id, coffre_mouvement_id, transaction_id INTO v_mvt, v_coffre, v_tx
    FROM tresorerie_depenses_direction WHERE id = p_id;
  DELETE FROM tresorerie_depenses_direction WHERE id = p_id;
  IF v_mvt IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = v_mvt; END IF;
  IF v_coffre IS NOT NULL THEN DELETE FROM tresorerie_coffre_mouvements WHERE id = v_coffre; END IF;
  IF v_tx IS NOT NULL THEN PERFORM retirer_transaction_hors_point(v_tx); END IF;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_enregistrer_cheque_lignes(uuid, uuid, text, text, text, jsonb, bigint, date, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_enregistrer_cheque(uuid, uuid, text, text, text, uuid, bigint, date, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_encaisser_cheque(uuid, date, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_encaissement_cheque(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_cheque(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_depense_direction_supprimer(uuid) TO anon, authenticated;

-- Contrôle : chèques reliés repris en lignes (doit égaler le nombre de chèques avec du_id).
SELECT (SELECT count(*) FROM tresorerie_cheques WHERE du_id IS NOT NULL) AS cheques_relies,
       (SELECT count(DISTINCT cheque_id) FROM tresorerie_cheques_lignes) AS cheques_avec_lignes;
