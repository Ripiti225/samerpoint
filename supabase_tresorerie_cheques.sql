-- =====================================================================
--  TRÉSORERIE — chèques émis sur BACI et SIB.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS
--  supabase_tresorerie_previsions.sql et supabase_tresorerie_cotisations.sql.
--  Idempotent. Montants en FCFA entiers.
--
--  Un chèque émis et pas encore débité est une PRÉVISION : son montant est
--  retiré de la trésorerie nette réelle, le solde de la banque ne bouge pas.
--   - relié à une ligne d'À payer (dette, charge) : il porte une prévision
--     ordinaire de cette ligne (date prévue = date d'encaissement) ;
--   - sans lien (ordre libre) : l'app compte son montant à part.
--  « Encaissé » (coché à la main) : la sortie de banque est créée à la date
--  d'encaissement réelle ; relié, le paiement de la ligne aussi (la dette
--  baisse). Tout se fait ici, en une seule fois, ou rien.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tresorerie_cheques (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compte_id         uuid NOT NULL REFERENCES tresorerie_comptes(id),
  numero            text NOT NULL,
  banque            text NOT NULL,
  ordre             text NOT NULL,
  du_id             uuid REFERENCES tresorerie_dus(id) ON DELETE SET NULL,
  prevision_id      uuid REFERENCES tresorerie_previsions(id) ON DELETE SET NULL,
  montant           bigint NOT NULL CHECK (montant > 0),
  date_emission     date NOT NULL,
  date_encaissement date NOT NULL,
  statut            text NOT NULL DEFAULT 'emis' CHECK (statut IN ('emis','encaisse','annule')),
  encaisse_le       date,
  paiement_groupe   uuid,
  mouvement_id      uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL,
  annule_le         date,
  motif_annulation  text,
  note              text,
  photo_url         text,
  cree_par          text,
  cree_par_nom      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cheque_dates CHECK (date_encaissement >= date_emission)
);
-- Un numéro de chèque ne sert qu'une fois par compte (même annulé).
CREATE UNIQUE INDEX IF NOT EXISTS idx_treso_cheques_numero ON tresorerie_cheques (compte_id, numero);
CREATE INDEX IF NOT EXISTS idx_treso_cheques_statut ON tresorerie_cheques (statut, date_encaissement);

-- Nouveau type de mouvement : le débit d'un chèque.
ALTER TABLE tresorerie_mouvements DROP CONSTRAINT IF EXISTS tresorerie_mouvements_type_check;
ALTER TABLE tresorerie_mouvements ADD CONSTRAINT tresorerie_mouvements_type_check
  CHECK (type IN ('recalage','recu_banque','paiement','partenaire','coffre','direction','especes','virement','pret','autre','cotisation','cheque'));

-- ── Saisie et modification (tant que le chèque n'est pas encaissé) ──
-- Relié à une ligne : la prévision de la ligne suit (montant, date, ligne).
CREATE OR REPLACE FUNCTION tresorerie_enregistrer_cheque(
  p_id                uuid,
  p_compte_id         uuid,
  p_numero            text,
  p_banque            text,
  p_ordre             text,
  p_du_id             uuid,
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
  v_id     uuid := p_id;
  v_ancien tresorerie_cheques%ROWTYPE;
  v_prev   uuid;
  v_note   text := 'Chèque n° ' || trim(p_numero) || ' ' || trim(p_banque);
BEGIN
  IF coalesce(p_montant, 0) <= 0 THEN RAISE EXCEPTION 'Montant du chèque manquant'; END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_ancien FROM tresorerie_cheques WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chèque introuvable'; END IF;
    IF v_ancien.statut <> 'emis' THEN RAISE EXCEPTION 'Ce chèque est déjà encaissé ou annulé : il ne se modifie plus'; END IF;
    v_prev := v_ancien.prevision_id;
    -- Ligne changée ou retirée : l'ancienne prévision part.
    IF v_prev IS NOT NULL AND v_ancien.du_id IS DISTINCT FROM p_du_id THEN
      DELETE FROM tresorerie_previsions WHERE id = v_prev;
      v_prev := NULL;
    END IF;
  END IF;

  IF p_du_id IS NOT NULL THEN
    IF v_prev IS NULL THEN
      INSERT INTO tresorerie_previsions (du_id, montant, date_prevue, note, cree_par, cree_par_nom)
      VALUES (p_du_id, p_montant, p_date_encaissement, v_note, p_user_id, p_user_nom)
      RETURNING id INTO v_prev;
    ELSE
      UPDATE tresorerie_previsions SET montant = p_montant, date_prevue = p_date_encaissement, note = v_note
      WHERE id = v_prev;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO tresorerie_cheques (compte_id, numero, banque, ordre, du_id, prevision_id, montant,
      date_emission, date_encaissement, note, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, trim(p_numero), trim(p_banque), trim(p_ordre), p_du_id, v_prev, p_montant,
      p_date_emission, p_date_encaissement, nullif(p_note, ''), p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_id;
  ELSE
    UPDATE tresorerie_cheques SET compte_id = p_compte_id, numero = trim(p_numero), banque = trim(p_banque),
      ordre = trim(p_ordre), du_id = p_du_id, prevision_id = v_prev, montant = p_montant,
      date_emission = p_date_emission, date_encaissement = p_date_encaissement,
      note = nullif(p_note, ''), photo_url = coalesce(p_photo_url, photo_url)
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

-- ── Encaissé : sortie de banque (+ paiement de la ligne si relié) ──
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
BEGIN
  SELECT * INTO v_c FROM tresorerie_cheques WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chèque introuvable'; END IF;
  IF v_c.statut <> 'emis' THEN RAISE EXCEPTION 'Ce chèque est déjà encaissé ou annulé'; END IF;
  v_libelle := 'Chèque n° ' || v_c.numero || ' · ' || v_c.ordre;

  IF v_c.du_id IS NOT NULL THEN
    v_groupe := tresorerie_payer(
      jsonb_build_array(jsonb_build_object('du_id', v_c.du_id, 'montant', v_c.montant,
        'prevision_id', coalesce(v_c.prevision_id::text, ''))),
      'compte', v_c.compte_id, p_date, v_libelle, v_c.photo_url, p_user_id, p_user_nom);
    SELECT mouvement_id INTO v_mvt FROM tresorerie_paiements WHERE groupe = v_groupe AND mouvement_id IS NOT NULL LIMIT 1;
    UPDATE tresorerie_mouvements SET type = 'cheque' WHERE id = v_mvt;
  ELSE
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
    VALUES (v_c.compte_id, p_date, -v_c.montant, 'cheque', v_libelle, v_c.photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  END IF;

  UPDATE tresorerie_cheques SET statut = 'encaisse', encaisse_le = p_date, paiement_groupe = v_groupe, mouvement_id = v_mvt
  WHERE id = p_id;
END $$;

-- ── Encaissement coché par erreur : retour à « émis » ──
CREATE OR REPLACE FUNCTION tresorerie_annuler_encaissement_cheque(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c tresorerie_cheques%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM tresorerie_cheques WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_c.statut <> 'encaisse' THEN RAISE EXCEPTION 'Ce chèque n''est pas encaissé'; END IF;
  IF v_c.paiement_groupe IS NOT NULL THEN
    PERFORM tresorerie_annuler_paiement(v_c.paiement_groupe);
  ELSIF v_c.mouvement_id IS NOT NULL THEN
    DELETE FROM tresorerie_mouvements WHERE id = v_c.mouvement_id;
  END IF;
  UPDATE tresorerie_cheques SET statut = 'emis', encaisse_le = NULL, paiement_groupe = NULL, mouvement_id = NULL
  WHERE id = p_id;
END $$;

-- ── Chèque annulé (perdu, refait, jamais remis) : sa prévision part ──
CREATE OR REPLACE FUNCTION tresorerie_annuler_cheque(p_id uuid, p_motif text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c tresorerie_cheques%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM tresorerie_cheques WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_c.statut <> 'emis' THEN RAISE EXCEPTION 'Seul un chèque pas encore encaissé s''annule'; END IF;
  IF coalesce(trim(p_motif), '') = '' THEN RAISE EXCEPTION 'Motif de l''annulation manquant'; END IF;
  IF v_c.prevision_id IS NOT NULL THEN
    DELETE FROM tresorerie_previsions WHERE id = v_c.prevision_id;
  END IF;
  UPDATE tresorerie_cheques SET statut = 'annule', annule_le = current_date, motif_annulation = trim(p_motif), prevision_id = NULL
  WHERE id = p_id;
END $$;

ALTER TABLE tresorerie_cheques ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON tresorerie_cheques;
CREATE POLICY allow_all ON tresorerie_cheques FOR ALL TO public USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION tresorerie_enregistrer_cheque(uuid, uuid, text, text, text, uuid, bigint, date, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_encaisser_cheque(uuid, date, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_encaissement_cheque(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_cheque(uuid, text) TO anon, authenticated;
