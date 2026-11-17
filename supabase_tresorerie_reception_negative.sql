-- ──────────────────────────────────────────────────────────────────────────────
-- Trésorerie — réceptions partenaires négatives (17/11/2026).
--
-- Une période peut être débitrice : pub ou commissions plus fortes que les
-- ventes, le partenaire prélève au lieu de verser. La réception se note alors
-- avec un montant négatif : la ligne « reçu » est négative et le mouvement
-- sort du compte. Seul zéro reste refusé.
--
-- Remplace tresorerie_recevoir (supabase_tresorerie_partenaires.sql) et
-- tresorerie_recevoir_detaille (supabase_tresorerie_tetes_de_fond.sql) ; mêmes
-- signatures, rien d'autre ne change. À exécuter une fois dans l'éditeur SQL
-- de Supabase.
-- ──────────────────────────────────────────────────────────────────────────────

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
  IF p_montant IS NULL OR p_montant = 0 THEN
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

-- p_parts : [{"restaurant_id": "...", "montant": 1200}, {"restaurant_id": "...", "montant": -300}, ...]
-- Les parts à zéro sont ignorées ; le mouvement porte le total (qui peut être négatif).
CREATE OR REPLACE FUNCTION tresorerie_recevoir_detaille(
  p_partenaire text, p_debut date, p_parts jsonb, p_compte_id uuid, p_date date,
  p_libelle text, p_note text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_total bigint;
  v_nb    int;
  v_mvt   uuid;
BEGIN
  SELECT coalesce(sum((x->>'montant')::bigint), 0), count(*) INTO v_total, v_nb
  FROM jsonb_array_elements(p_parts) x WHERE coalesce((x->>'montant')::bigint, 0) <> 0;
  IF v_nb = 0 THEN RAISE EXCEPTION 'Montant reçu manquant'; END IF;

  INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
  VALUES (p_compte_id, p_date, v_total, 'partenaire', p_libelle, p_user_id, p_user_nom)
  RETURNING id INTO v_mvt;

  INSERT INTO tresorerie_partenaire_lignes (partenaire, periode_debut, restaurant_id, type, montant, compte_id, date,
    mouvement_id, note, cree_par, cree_par_nom)
  SELECT p_partenaire, p_debut, (x->>'restaurant_id')::uuid, 'recu', (x->>'montant')::bigint, p_compte_id, p_date,
    v_mvt, p_note, p_user_id, p_user_nom
  FROM jsonb_array_elements(p_parts) x WHERE coalesce((x->>'montant')::bigint, 0) <> 0;

  RETURN v_mvt;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_recevoir(text, date, uuid, bigint, uuid, date, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_recevoir_detaille(text, date, jsonb, uuid, date, text, text, text, text) TO anon, authenticated;
