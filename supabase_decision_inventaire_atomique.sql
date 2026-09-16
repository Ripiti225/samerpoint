-- Décision atomique d'une explication d'écart d'inventaire.
-- Rejouable. À exécuter sur la base SamerTrackly.

CREATE OR REPLACE FUNCTION public.decider_ecart_inventaire_atomique(
  p_ligne_id UUID,
  p_statut TEXT,
  p_quantite_acceptee NUMERIC,
  p_prix NUMERIC,
  p_par TEXT
)
RETURNS TABLE (
  statut TEXT,
  quantite_acceptee NUMERIC,
  montant_deduit NUMERIC
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ligne public.inventaire_lignes%ROWTYPE;
  v_shift public.inventaires_shifts%ROWTYPE;
  v_quantite NUMERIC;
  v_nouveau NUMERIC;
  v_delta NUMERIC;
BEGIN
  IF p_statut NOT IN ('validee', 'refusee') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'STATUT_DECISION_INVALIDE';
  END IF;
  IF p_prix IS NULL OR p_prix < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PRIX_PRODUIT_INVALIDE';
  END IF;

  SELECT * INTO v_ligne
    FROM public.inventaire_lignes
   WHERE id = p_ligne_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EXPLICATION_INTROUVABLE';
  END IF;
  IF v_ligne.explication_statut IS DISTINCT FROM 'en_attente' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EXPLICATION_DEJA_TRAITEE';
  END IF;

  SELECT * INTO v_shift
    FROM public.inventaires_shifts
   WHERE id = v_ligne.inventaire_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTAIRE_INTROUVABLE';
  END IF;

  v_quantite := CASE
    WHEN p_statut = 'refusee' THEN 0
    ELSE LEAST(
      ABS(COALESCE(v_ligne.ecart, 0)),
      GREATEST(0, COALESCE(p_quantite_acceptee, v_ligne.nombre_explique, 0))
    )
  END;
  v_nouveau := ROUND(GREATEST(0, ABS(COALESCE(v_ligne.ecart, 0)) - v_quantite) * p_prix);
  v_delta := v_nouveau - COALESCE(v_ligne.montant_deduit, 0);

  UPDATE public.inventaire_lignes
     SET montant_deduit = v_nouveau,
         quantite_acceptee = v_quantite,
         explication_statut = p_statut,
         explication_decidee_par = COALESCE(NULLIF(BTRIM(p_par), ''), 'Manager'),
         explication_decidee_at = NOW()
   WHERE id = p_ligne_id;

  UPDATE public.inventaires_shifts
     SET montant_a_deduire = GREATEST(0, COALESCE(montant_a_deduire, 0) + v_delta)
   WHERE id = v_ligne.inventaire_id;

  UPDATE public.points
     SET montant_inventaire = GREATEST(0, COALESCE(montant_inventaire, 0) + v_delta)
   WHERE id = v_shift.point_id;

  INSERT INTO public.journal_activite (
    action, details, restaurant_id, point_id, user_nom
  ) VALUES (
    'decision_ecart_inventaire',
    jsonb_build_object(
      'ligne_id', p_ligne_id,
      'statut', p_statut,
      'quantite_acceptee', v_quantite,
      'montant', v_nouveau
    ),
    v_shift.restaurant_id,
    v_shift.point_id,
    COALESCE(NULLIF(BTRIM(p_par), ''), 'Manager')
  );

  RETURN QUERY SELECT p_statut, v_quantite, v_nouveau;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decider_ecart_inventaire_atomique(UUID, TEXT, NUMERIC, NUMERIC, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.decider_ecart_inventaire_atomique(UUID, TEXT, NUMERIC, NUMERIC, TEXT) IS
  'Première décision gagnante sur une explication inventaire, avec mise à jour atomique des totaux.';
