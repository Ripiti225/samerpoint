-- =====================================================================
--  TRÉSORERIE — étape 4 de la nouvelle trésorerie : prévisions de paiement.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS
--  supabase_tresorerie_especes.sql. Idempotent. Montants en FCFA entiers.
--  Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
-- =====================================================================

-- Une prévision : combien on compte payer sur une ligne, et quand (date, ou
-- prochaine réception d'un partenaire). Son « réalisé » = les paiements qui la
-- portent ; elle n'est jamais marquée à la main.
CREATE TABLE IF NOT EXISTS tresorerie_previsions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  du_id        uuid NOT NULL REFERENCES tresorerie_dus(id) ON DELETE CASCADE,
  montant      bigint NOT NULL CHECK (montant > 0),
  date_prevue  date,
  partenaire   text CHECK (partenaire IN ('yango','glovo','wave','om','djamo')),
  note         text,
  cree_par     text,
  cree_par_nom text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prevision_quand CHECK (date_prevue IS NOT NULL OR partenaire IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_treso_prev_du ON tresorerie_previsions (du_id);

ALTER TABLE tresorerie_paiements ADD COLUMN IF NOT EXISTS prevision_id uuid
  REFERENCES tresorerie_previsions(id) ON DELETE SET NULL;

-- p_parts : [{"du_id": "...", "montant": 1000, "prevision_id": "..." (facultatif)}, ...]
CREATE OR REPLACE FUNCTION tresorerie_payer(
  p_parts     jsonb,
  p_source    text,
  p_compte_id uuid,
  p_date      date,
  p_libelle   text,
  p_photo_url text,
  p_user_id   text,
  p_user_nom  text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_groupe uuid := gen_random_uuid();
  v_total  bigint;
  v_mvt    uuid;
BEGIN
  SELECT coalesce(sum((x->>'montant')::bigint), 0) INTO v_total
  FROM jsonb_array_elements(p_parts) x;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Montant du paiement manquant';
  END IF;

  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -v_total, 'paiement', p_libelle, p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  END IF;

  INSERT INTO tresorerie_paiements (du_id, groupe, montant, date, source, compte_id, mouvement_id, photo_url,
    prevision_id, cree_par, cree_par_nom)
  SELECT (x->>'du_id')::uuid, v_groupe, (x->>'montant')::bigint, p_date, p_source,
         CASE WHEN p_source = 'compte' THEN p_compte_id END, v_mvt, p_photo_url,
         nullif(x->>'prevision_id', '')::uuid, p_user_id, p_user_nom
  FROM jsonb_array_elements(p_parts) x
  WHERE (x->>'montant')::bigint > 0;

  RETURN v_groupe;
END $$;

ALTER TABLE tresorerie_previsions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON tresorerie_previsions;
CREATE POLICY allow_all ON tresorerie_previsions FOR ALL TO public USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION tresorerie_payer(jsonb, text, uuid, date, text, text, text, text) TO anon, authenticated;
