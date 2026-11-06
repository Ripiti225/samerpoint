-- =====================================================================
--  LITIGE SUR UN SURPLUS DE STOCK (Vérification → Stock)
--
--  Un surplus sans explication n'avait aucune action possible. Le manager
--  peut maintenant y fixer un montant à la main, imputé au caissier du shift.
--  Le montant n'est jamais déduit du surplus × prix : les comptages contiennent
--  des erreurs de frappe (331 748 frites pour 33 180).
--
--  Montant > 0 : litige (statut 'refusee', lu par les écrans existants).
--  Montant = 0 : litige retiré, la ligne reprend son état d'avant.
--
--  Même recette que redecider_ecart_inventaire() : ligne, total du shift et
--  total du point recalculés par différence, refus si la ligne a changé depuis
--  son affichage. Le pont POS ne réécrit pas une ligne déjà transférée.
--
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase (Samtrackly).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fixer_litige_surplus(
  p_ligne_id UUID,
  p_statut_actuel TEXT,
  p_montant NUMERIC,
  p_par TEXT,
  p_commentaire TEXT DEFAULT NULL
)
RETURNS TABLE (
  statut TEXT,
  montant_deduit NUMERIC
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ligne public.inventaire_lignes%ROWTYPE;
  v_shift public.inventaires_shifts%ROWTYPE;
  v_statut TEXT;
  v_delta NUMERIC;
  v_par TEXT := COALESCE(NULLIF(BTRIM(p_par), ''), 'Manager');
BEGIN
  IF p_montant IS NULL OR p_montant < 0 OR p_montant <> TRUNC(p_montant) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MONTANT_LITIGE_INVALIDE';
  END IF;

  SELECT * INTO v_ligne FROM public.inventaire_lignes WHERE id = p_ligne_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'LIGNE_INTROUVABLE';
  END IF;
  IF COALESCE(v_ligne.ecart, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAS_UN_SURPLUS';
  END IF;
  IF v_ligne.explication_statut IS DISTINCT FROM p_statut_actuel THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DECISION_CHANGEE_ENTRE_TEMPS';
  END IF;
  IF COALESCE(v_ligne.deduction_annulee, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEDUCTION_ANNULEE';
  END IF;

  SELECT * INTO v_shift FROM public.inventaires_shifts WHERE id = v_ligne.inventaire_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTAIRE_INTROUVABLE';
  END IF;

  v_statut := CASE
    WHEN p_montant > 0 THEN 'refusee'
    WHEN NULLIF(BTRIM(COALESCE(v_ligne.explication, '')), '') IS NOT NULL THEN 'en_attente'
    ELSE NULL
  END;
  v_delta := p_montant - COALESCE(v_ligne.montant_deduit, 0);

  UPDATE public.inventaire_lignes
     SET montant_deduit = p_montant,
         quantite_acceptee = CASE WHEN p_montant > 0 THEN 0 ELSE NULL END,
         explication_statut = v_statut,
         explication_decidee_par = CASE WHEN p_montant > 0 THEN v_par ELSE NULL END,
         explication_decidee_at = CASE WHEN p_montant > 0 THEN NOW() ELSE NULL END
   WHERE id = p_ligne_id;

  UPDATE public.inventaires_shifts
     SET montant_a_deduire = GREATEST(0, COALESCE(montant_a_deduire, 0) + v_delta)
   WHERE id = v_ligne.inventaire_id;

  UPDATE public.points
     SET montant_inventaire = GREATEST(0, COALESCE(montant_inventaire, 0) + v_delta)
   WHERE id = v_shift.point_id;

  INSERT INTO public.journal_activite (action, details, restaurant_id, point_id, user_nom)
  VALUES (
    'litige_surplus_inventaire',
    jsonb_build_object(
      'ligne_id', p_ligne_id,
      'produit', v_ligne.produit_nom,
      'ecart', v_ligne.ecart,
      'ancien_statut', p_statut_actuel,
      'ancien_montant', v_ligne.montant_deduit,
      'statut', v_statut,
      'montant', p_montant,
      'commentaire', NULLIF(BTRIM(COALESCE(p_commentaire, '')), '')
    ),
    v_shift.restaurant_id, v_shift.point_id, v_par
  );

  RETURN QUERY SELECT v_statut, p_montant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fixer_litige_surplus(UUID, TEXT, NUMERIC, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- Contrôle : doit renvoyer 1 ligne.
SELECT 'fixer_litige_surplus OK' AS controle
  FROM pg_proc WHERE proname = 'fixer_litige_surplus';
