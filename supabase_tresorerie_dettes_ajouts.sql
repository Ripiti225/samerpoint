-- =====================================================================
--  TRÉSORERIE — ajouter une nouvelle dette à une dette existante.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS
--  supabase_tresorerie.sql. Idempotent. Montants en FCFA entiers.
--
--  Ex. : on doit 5 000 000 F à Ali sable, on reprend 500 000 F à crédit.
--  Au lieu de corriger le montant, on « ajoute une dette » : la ligne
--  garde son historique (montant de départ + chaque ajout, sa date, qui),
--  et tresorerie_dus.montant_du monte du même montant. Tous les calculs
--  existants (reste à payer, totaux, prévisions) lisent toujours montant_du.
--  Montant de départ = montant_du − somme des ajouts.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tresorerie_dus_ajouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  du_id        uuid NOT NULL REFERENCES tresorerie_dus(id) ON DELETE CASCADE,
  montant      bigint NOT NULL CHECK (montant > 0),
  date         date NOT NULL DEFAULT current_date,
  note         text,
  cree_par     text,
  cree_par_nom text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treso_dus_ajouts_du ON tresorerie_dus_ajouts (du_id);

-- L'ajout et la hausse du montant dû ensemble, ou rien.
CREATE OR REPLACE FUNCTION tresorerie_ajouter_a_du(
  p_du_id    uuid,
  p_montant  bigint,
  p_date     date,
  p_note     text,
  p_user_id  text,
  p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  IF coalesce(p_montant, 0) <= 0 THEN
    RAISE EXCEPTION 'Montant de la nouvelle dette manquant';
  END IF;
  UPDATE tresorerie_dus SET montant_du = montant_du + p_montant WHERE id = p_du_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dette introuvable';
  END IF;
  INSERT INTO tresorerie_dus_ajouts (du_id, montant, date, note, cree_par, cree_par_nom)
  VALUES (p_du_id, p_montant, coalesce(p_date, current_date), nullif(p_note, ''), p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Retire un ajout saisi par erreur : le montant dû redescend d'autant.
CREATE OR REPLACE FUNCTION tresorerie_retirer_ajout_du(p_ajout_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_du_id   uuid;
  v_montant bigint;
BEGIN
  DELETE FROM tresorerie_dus_ajouts WHERE id = p_ajout_id RETURNING du_id, montant INTO v_du_id, v_montant;
  IF v_du_id IS NULL THEN
    RAISE EXCEPTION 'Ajout introuvable';
  END IF;
  UPDATE tresorerie_dus SET montant_du = greatest(0, montant_du - v_montant) WHERE id = v_du_id;
END $$;

ALTER TABLE tresorerie_dus_ajouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON tresorerie_dus_ajouts;
CREATE POLICY allow_all ON tresorerie_dus_ajouts FOR ALL TO public USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION tresorerie_ajouter_a_du(uuid, bigint, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_retirer_ajout_du(uuid) TO anon, authenticated;
