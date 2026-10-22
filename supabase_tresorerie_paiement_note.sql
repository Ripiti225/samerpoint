-- =====================================================================
--  TRÉSORERIE — une note sur chaque paiement d'un dû (dette, loyer, charge).
--  À exécuter dans le SQL Editor (projet Samtrackly wlwotzxnzowbkbfcpnyi),
--  APRÈS supabase_tresorerie_previsions.sql. Idempotent.
--  La note se lit sous le paiement dans la fiche, et s'ajoute au libellé de la
--  sortie en banque (historique du compte).
-- =====================================================================

ALTER TABLE tresorerie_paiements ADD COLUMN IF NOT EXISTS note text;

-- p_note en dernier, avec défaut : les appels à 8 valeurs (encaissement d'un
-- chèque, anciennes versions de l'app) marchent toujours. On retire l'ancienne
-- signature pour qu'il n'y ait qu'une seule fonction à choisir.
DROP FUNCTION IF EXISTS tresorerie_payer(jsonb, text, uuid, date, text, text, text, text);

-- p_parts : [{"du_id": "...", "montant": 1000, "prevision_id": "..." (facultatif)}, ...]
CREATE OR REPLACE FUNCTION tresorerie_payer(
  p_parts     jsonb,
  p_source    text,
  p_compte_id uuid,
  p_date      date,
  p_libelle   text,
  p_photo_url text,
  p_user_id   text,
  p_user_nom  text,
  p_note      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_groupe uuid := gen_random_uuid();
  v_total  bigint;
  v_mvt    uuid;
  v_note   text := nullif(trim(p_note), '');
BEGIN
  SELECT coalesce(sum((x->>'montant')::bigint), 0) INTO v_total
  FROM jsonb_array_elements(p_parts) x;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Montant du paiement manquant';
  END IF;

  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -v_total, 'paiement',
            coalesce(p_libelle || coalesce(' · ' || v_note, ''), v_note), p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  END IF;

  INSERT INTO tresorerie_paiements (du_id, groupe, montant, date, source, compte_id, mouvement_id, photo_url,
    prevision_id, note, cree_par, cree_par_nom)
  SELECT (x->>'du_id')::uuid, v_groupe, (x->>'montant')::bigint, p_date, p_source,
         CASE WHEN p_source = 'compte' THEN p_compte_id END, v_mvt, p_photo_url,
         nullif(x->>'prevision_id', '')::uuid, v_note, p_user_id, p_user_nom
  FROM jsonb_array_elements(p_parts) x
  WHERE (x->>'montant')::bigint > 0;

  RETURN v_groupe;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_payer(jsonb, text, uuid, date, text, text, text, text, text) TO anon, authenticated;
