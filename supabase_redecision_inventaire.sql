-- =====================================================================
--  MODIFIER UNE DÉCISION DÉJÀ PRISE sur un écart d'inventaire
--  (« ✏️ Modifier la décision » dans Vérification → Stock).
--
--  decider_ecart_inventaire_atomique() n'accepte que la PREMIÈRE décision
--  (explication en_attente) : la modification était donc toujours refusée
--  (« Cette explication a déjà été traitée »).
--
--  Ici, la modification passe si la ligne est toujours dans l'état que
--  l'écran a affiché (p_statut_actuel) : si quelqu'un a changé la décision
--  entre-temps, on refuse plutôt que d'écraser sa décision.
--  Le montant déduit et les totaux (shift, point) sont recalculés par
--  différence, comme pour la première décision.
--
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase (Samtrackly).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.redecider_ecart_inventaire(
  p_ligne_id UUID,
  p_statut_actuel TEXT,
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

  SELECT * INTO v_ligne FROM public.inventaire_lignes WHERE id = p_ligne_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EXPLICATION_INTROUVABLE';
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

  -- Même calcul que decider_ecart_inventaire_atomique().
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

  INSERT INTO public.journal_activite (action, details, restaurant_id, point_id, user_nom)
  VALUES (
    'modification_decision_ecart_inventaire',
    jsonb_build_object(
      'ligne_id', p_ligne_id,
      'ancien_statut', p_statut_actuel,
      'ancienne_quantite_acceptee', v_ligne.quantite_acceptee,
      'ancien_montant', v_ligne.montant_deduit,
      'statut', p_statut,
      'quantite_acceptee', v_quantite,
      'montant', v_nouveau
    ),
    v_shift.restaurant_id, v_shift.point_id,
    COALESCE(NULLIF(BTRIM(p_par), ''), 'Manager')
  );

  RETURN QUERY SELECT p_statut, v_quantite, v_nouveau;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redecider_ecart_inventaire(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT)
  TO anon, authenticated, service_role;

-- Contrôle : doit renvoyer 1 ligne.
SELECT 'redecider_ecart_inventaire OK' AS controle
  FROM pg_proc WHERE proname = 'redecider_ecart_inventaire';
