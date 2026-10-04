-- =====================================================================
--  CORRECTION D'UNE ENTRÉE DE STOCK MAL SAISIE — écran Vérification
--  Exemple : le caissier a fait entrer 10 pains, le reçu en montre 20.
--
--  La correction recalcule, pour ce produit et ce shift : l'entrée, l'écart,
--  le montant à déduire, puis les totaux du shift (montant_a_deduire) et du
--  point (montant_inventaire). Une décision déjà prise sur l'explication est
--  gardée : la quantité acceptée reste acceptée, seul le reste de l'écart
--  change le montant.
--
--  Pourquoi une table à part : quand le POS rejoue un service, il efface et
--  réécrit `entrees_shift`, mais garde `inventaire_lignes`. La quantité
--  affichée = réceptions du POS + corrections enregistrées ici.
--
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase (Samtrackly).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.corrections_entrees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventaire_id      uuid NOT NULL REFERENCES public.inventaires_shifts(id) ON DELETE CASCADE,
  point_id           uuid REFERENCES public.points(id) ON DELETE SET NULL,
  produit_id         text NOT NULL,
  produit_nom        text,
  fournisseur_nom    text,          -- NULL = « Sans fournisseur »
  ancienne_quantite  numeric NOT NULL,
  nouvelle_quantite  numeric NOT NULL,
  delta              numeric NOT NULL,
  ligne_id           uuid REFERENCES public.inventaire_lignes(id) ON DELETE SET NULL,
  ancien_montant     numeric,
  nouveau_montant    numeric,
  raison             text NOT NULL,
  par                text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_entrees_inventaire
  ON public.corrections_entrees (inventaire_id);

-- Même posture que le reste du projet.
ALTER TABLE public.corrections_entrees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lecture corrections_entrees" ON public.corrections_entrees;
CREATE POLICY "lecture corrections_entrees"
  ON public.corrections_entrees FOR SELECT USING (true);
-- Pas d'écriture directe : tout passe par corriger_entree_inventaire().

CREATE OR REPLACE FUNCTION public.corriger_entree_inventaire(
  p_inventaire_id   uuid,
  p_produit_id      text,
  p_produit_nom     text,
  p_fournisseur_nom text,
  p_nouvelle        numeric,
  p_prix            numeric,
  p_raison          text,
  p_par             text
)
RETURNS TABLE (
  ancienne_quantite numeric,
  ligne_trouvee     boolean,
  ancien_montant    numeric,
  nouveau_montant   numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift    public.inventaires_shifts%ROWTYPE;
  v_ligne    public.inventaire_lignes%ROWTYPE;
  v_fourn    text := NULLIF(BTRIM(p_fournisseur_nom), '');
  v_par      text := COALESCE(NULLIF(BTRIM(p_par), ''), 'Vérificateur');
  v_ancienne numeric;
  v_delta    numeric;
  v_ecart    numeric;
  v_ancien   numeric := 0;
  v_montant  numeric := 0;
  v_trouvee  boolean := false;
BEGIN
  IF p_nouvelle IS NULL OR p_nouvelle < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'QUANTITE_INVALIDE';
  END IF;
  IF COALESCE(BTRIM(p_raison), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RAISON_OBLIGATOIRE';
  END IF;

  -- Verrou sur le shift : deux corrections simultanées s'enchaînent.
  SELECT * INTO v_shift FROM public.inventaires_shifts WHERE id = p_inventaire_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INVENTAIRE_INTROUVABLE';
  END IF;

  -- Quantité actuelle = réceptions du POS + corrections déjà faites.
  SELECT COALESCE((
           SELECT SUM(e.quantite) FROM public.entrees_shift e
            WHERE e.inventaire_id = p_inventaire_id AND e.produit_id = p_produit_id
              AND NULLIF(BTRIM(e.fournisseur_nom), '') IS NOT DISTINCT FROM v_fourn), 0)
       + COALESCE((
           SELECT SUM(c.delta) FROM public.corrections_entrees c
            WHERE c.inventaire_id = p_inventaire_id AND c.produit_id = p_produit_id
              AND c.fournisseur_nom IS NOT DISTINCT FROM v_fourn), 0)
    INTO v_ancienne;

  v_delta := p_nouvelle - v_ancienne;
  IF v_delta = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'QUANTITE_IDENTIQUE';
  END IF;

  SELECT * INTO v_ligne FROM public.inventaire_lignes
   WHERE inventaire_id = p_inventaire_id AND produit_id = p_produit_id
   ORDER BY created_at LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    v_trouvee := true;
    v_ancien  := COALESCE(v_ligne.montant_deduit, 0);
    -- écart = réel − (initial + entrées − sorties) : +delta en entrée = −delta d'écart.
    v_ecart := CASE WHEN v_ligne.ecart IS NULL THEN NULL ELSE v_ligne.ecart - v_delta END;

    IF COALESCE(v_ligne.deduction_annulee, false) THEN
      v_montant := v_ancien;                       -- annulée définitivement : reste à 0
    ELSIF v_ecart IS NULL OR v_ecart >= 0 THEN
      v_montant := 0;                              -- seul un manquant coûte
    ELSE
      IF COALESCE(p_prix, 0) <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PRIX_PRODUIT_INCONNU';
      END IF;
      v_montant := ROUND(GREATEST(0, ABS(v_ecart) - CASE
        WHEN v_ligne.explication_statut IN ('validee', 'refusee') THEN COALESCE(v_ligne.quantite_acceptee, 0)
        ELSE COALESCE(v_ligne.nombre_explique, 0)   -- même formule que le POS
      END) * p_prix);
    END IF;

    UPDATE public.inventaire_lignes
       SET entrees = GREATEST(0, COALESCE(entrees, 0) + v_delta),
           ecart = v_ecart,
           montant_deduit = v_montant
     WHERE id = v_ligne.id;

    UPDATE public.inventaires_shifts
       SET montant_a_deduire = GREATEST(0, COALESCE(montant_a_deduire, 0) + (v_montant - v_ancien))
     WHERE id = p_inventaire_id;

    UPDATE public.points
       SET montant_inventaire = GREATEST(0, COALESCE(montant_inventaire, 0) + (v_montant - v_ancien))
     WHERE id = v_shift.point_id;
  END IF;

  INSERT INTO public.corrections_entrees (
    inventaire_id, point_id, produit_id, produit_nom, fournisseur_nom,
    ancienne_quantite, nouvelle_quantite, delta, ligne_id,
    ancien_montant, nouveau_montant, raison, par
  ) VALUES (
    p_inventaire_id, v_shift.point_id, p_produit_id, p_produit_nom, v_fourn,
    v_ancienne, p_nouvelle, v_delta, CASE WHEN v_trouvee THEN v_ligne.id END,
    CASE WHEN v_trouvee THEN v_ancien END, CASE WHEN v_trouvee THEN v_montant END,
    BTRIM(p_raison), v_par
  );

  INSERT INTO public.journal_activite (action, details, restaurant_id, point_id, user_nom)
  VALUES (
    'correction_entree_stock',
    jsonb_build_object(
      'inventaire_id', p_inventaire_id, 'produit_id', p_produit_id, 'produit', p_produit_nom,
      'fournisseur', v_fourn, 'ancienne_quantite', v_ancienne, 'nouvelle_quantite', p_nouvelle,
      'ancien_montant', v_ancien, 'nouveau_montant', v_montant, 'raison', BTRIM(p_raison)
    ),
    v_shift.restaurant_id, v_shift.point_id, v_par
  );

  RETURN QUERY SELECT v_ancienne, v_trouvee, v_ancien, v_montant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.corriger_entree_inventaire(uuid, text, text, text, numeric, numeric, text, text)
  TO anon, authenticated, service_role;

-- Contrôle : doit renvoyer 1 ligne.
SELECT 'corrections_entrees OK' AS controle
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'corrections_entrees';
