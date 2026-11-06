-- =====================================================================
--  CORRECTION DU STOCK INITIAL — reçue des caisses par le pont POS
--
--  Le caissier qui prend son shift corrige un stock initial faux. Si cela crée
--  un manquant, soit le litige est déjà réglé sur place (code du sortant ou d'un
--  manager), soit il attend une décision : Valider (le sortant paie) ou Annuler
--  (le caissier sur place paie).
--
--  Même recette que supabase_correction_entrees.sql : on recalcule la ligne, le
--  total du shift et le total du point. Le montant reste sur
--  inventaire_lignes.montant_deduit, car Litiges, Récap et rapport mensuel
--  additionnent cette colonne.
--
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase (Samtrackly)
--  AVANT de déployer le pont. Migration BASE DE DONNÉES : les gérants n'ont rien
--  à réinstaller pour ce script.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.corrections_stock_initial (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_correction_id      uuid NOT NULL UNIQUE,
  restaurant_id          uuid,
  pos_service_place_id   uuid NOT NULL,
  pos_service_sortant_id uuid,
  produit_id             text NOT NULL,
  produit_nom            text,
  prix                   numeric NOT NULL,
  stock_reporte          numeric NOT NULL,
  stock_corrige          numeric NOT NULL,
  stock_reel_origine     numeric,        -- le chiffre du sortant, avant recalcul
  explication            text NOT NULL,
  statut_pos             text NOT NULL,
  statut                 text NOT NULL
    CHECK (statut IN ('information', 'appliquee', 'en_attente', 'validee', 'annulee')),
  shift_intermediaire_debloque boolean NOT NULL DEFAULT false,
  caissier_place_nom     text,
  caissier_sortant_nom   text,
  saisi_par_nom          text,
  ancien_montant         numeric,
  nouveau_montant        numeric,
  decide_par             text,
  decide_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_stock_place
  ON public.corrections_stock_initial (pos_service_place_id);
CREATE INDEX IF NOT EXISTS idx_corrections_stock_sortant
  ON public.corrections_stock_initial (pos_service_sortant_id);
CREATE INDEX IF NOT EXISTS idx_corrections_stock_attente
  ON public.corrections_stock_initial (restaurant_id) WHERE statut = 'en_attente';

-- Même posture que corrections_entrees : lecture ouverte, écriture par fonction.
ALTER TABLE public.corrections_stock_initial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lecture corrections_stock_initial" ON public.corrections_stock_initial;
CREATE POLICY "lecture corrections_stock_initial"
  ON public.corrections_stock_initial FOR SELECT USING (true);

-- Le montant d'une ligne pour un nouvel écart. Même règle que
-- corriger_entree_inventaire, à un détail près : une explication écrite sur un
-- surplus n'excuse pas un manquant neuf.
CREATE OR REPLACE FUNCTION public._montant_correction_stock(
  p_ligne public.inventaire_lignes,
  p_ecart numeric,
  p_prix  numeric
) RETURNS numeric
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_expliquee numeric := 0;
BEGIN
  IF COALESCE(p_ligne.deduction_annulee, false) THEN
    RETURN COALESCE(p_ligne.montant_deduit, 0);    -- annulée définitivement : reste à 0
  END IF;
  IF p_ecart IS NULL OR p_ecart >= 0 THEN
    RETURN 0;                                      -- seul un manquant coûte
  END IF;
  IF COALESCE(p_prix, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PRIX_PRODUIT_INCONNU';
  END IF;
  IF COALESCE(p_ligne.ecart, 0) < 0 THEN
    v_expliquee := CASE
      WHEN p_ligne.explication_statut IN ('validee', 'refusee') THEN COALESCE(p_ligne.quantite_acceptee, 0)
      ELSE COALESCE(p_ligne.nombre_explique, 0)
    END;
  END IF;
  RETURN ROUND(GREATEST(0, ABS(p_ecart) - v_expliquee) * p_prix);
END;
$$;

-- Applique un nouvel écart à une ligne déjà verrouillée, et ajuste les totaux.
CREATE OR REPLACE FUNCTION public._appliquer_ecart_correction(
  p_ligne         public.inventaire_lignes,
  p_ecart         numeric,
  p_prix          numeric,
  p_stock_reel    numeric,
  p_stock_initial numeric,
  OUT ancien      numeric,
  OUT nouveau     numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_shift public.inventaires_shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM public.inventaires_shifts WHERE id = p_ligne.inventaire_id FOR UPDATE;
  ancien  := COALESCE(p_ligne.montant_deduit, 0);
  nouveau := public._montant_correction_stock(p_ligne, p_ecart, p_prix);

  UPDATE public.inventaire_lignes
     SET stock_reel = COALESCE(p_stock_reel, stock_reel),
         stock_initial = COALESCE(p_stock_initial, stock_initial),
         ecart = p_ecart,
         montant_deduit = nouveau,
         -- Plus d'écart, plus rien à expliquer. Une décision déjà prise reste.
         explication_statut = CASE
           WHEN ABS(COALESCE(p_ecart, 0)) < 0.01 AND explication_statut = 'en_attente' THEN NULL
           ELSE explication_statut
         END
   WHERE id = p_ligne.id;

  UPDATE public.inventaires_shifts
     SET montant_a_deduire = GREATEST(0, COALESCE(montant_a_deduire, 0) + (nouveau - ancien))
   WHERE id = v_shift.id;

  UPDATE public.points
     SET montant_inventaire = GREATEST(0, COALESCE(montant_inventaire, 0) + (nouveau - ancien))
   WHERE id = v_shift.point_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._id_ligne_de_service(p_service uuid, p_produit text)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT l.id
    FROM public.inventaire_lignes l
    JOIN public.inventaires_shifts s ON s.id = l.inventaire_id
   WHERE s.pos_service_id = p_service AND l.produit_id = p_produit
   ORDER BY l.created_at
   LIMIT 1;
$$;

-- Facture le sortant : sa ligne reprend le stock corrigé.
CREATE OR REPLACE FUNCTION public._imputer_sortant(
  p_c public.corrections_stock_initial,
  OUT ancien numeric,
  OUT nouveau numeric,
  OUT reel numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ligne public.inventaire_lignes%ROWTYPE;
BEGIN
  SELECT * INTO v_ligne FROM public.inventaire_lignes
   WHERE id = public._id_ligne_de_service(p_c.pos_service_sortant_id, p_c.produit_id)
   FOR UPDATE;
  IF NOT FOUND OR v_ligne.stock_reel IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SHIFT_SORTANT_ABSENT';
  END IF;
  reel := v_ligne.stock_reel;
  SELECT r.ancien, r.nouveau INTO ancien, nouveau
    FROM public._appliquer_ecart_correction(
      v_ligne,
      COALESCE(v_ligne.ecart, 0) + (p_c.stock_corrige - v_ligne.stock_reel),
      p_c.prix, p_c.stock_corrige, NULL
    ) r;
END;
$$;

-- Facture le caissier sur place : sa ligne repart du chiffre d'origine.
CREATE OR REPLACE FUNCTION public._imputer_place(
  p_c public.corrections_stock_initial,
  OUT ancien numeric,
  OUT nouveau numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ligne public.inventaire_lignes%ROWTYPE;
BEGIN
  SELECT * INTO v_ligne FROM public.inventaire_lignes
   WHERE id = public._id_ligne_de_service(p_c.pos_service_place_id, p_c.produit_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SHIFT_PLACE_ABSENT';
  END IF;
  SELECT r.ancien, r.nouveau INTO ancien, nouveau
    FROM public._appliquer_ecart_correction(
      v_ligne,
      COALESCE(v_ligne.ecart, 0) - (p_c.stock_reporte - p_c.stock_corrige),
      p_c.prix, NULL, p_c.stock_reporte
    ) r;
END;
$$;

-- Le pont appelle cette fonction après l'inventaire du service. Une correction
-- déjà connue est ignorée : rejouer ne facture pas deux fois et n'efface aucune
-- décision.
CREATE OR REPLACE FUNCTION public.transmettre_correction_stock_initial(p_correction jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c       public.corrections_stock_initial%ROWTYPE;
  v_id      uuid;
  v_present boolean;
  v_statut  text;
  v_ancien  numeric;
  v_nouveau numeric;
  v_reel    numeric;
BEGIN
  INSERT INTO public.corrections_stock_initial (
    pos_correction_id, restaurant_id, pos_service_place_id, pos_service_sortant_id,
    produit_id, produit_nom, prix, stock_reporte, stock_corrige, explication, statut_pos,
    statut, shift_intermediaire_debloque, caissier_place_nom, caissier_sortant_nom, saisi_par_nom
  ) VALUES (
    (p_correction->>'pos_correction_id')::uuid,
    (p_correction->>'restaurant_id')::uuid,
    (p_correction->>'pos_service_place_id')::uuid,
    (p_correction->>'pos_service_sortant_id')::uuid,
    p_correction->>'produit_id',
    p_correction->>'produit_nom',
    (p_correction->>'prix')::numeric,
    (p_correction->>'stock_reporte')::numeric,
    (p_correction->>'stock_corrige')::numeric,
    p_correction->>'explication',
    p_correction->>'statut_pos',
    'information',
    COALESCE((p_correction->>'shift_intermediaire_debloque')::boolean, false),
    p_correction->>'caissier_place_nom',
    p_correction->>'caissier_sortant_nom',
    p_correction->>'saisi_par_nom'
  )
  ON CONFLICT (pos_correction_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_c FROM public.corrections_stock_initial WHERE id = v_id;
  v_present := EXISTS (
    SELECT 1 FROM public.inventaire_lignes
     WHERE id = public._id_ligne_de_service(v_c.pos_service_sortant_id, v_c.produit_id)
       AND stock_reel IS NOT NULL
  );

  IF v_c.statut_pos = 'A_VALIDER' THEN
    v_statut := 'en_attente';
  ELSIF v_c.statut_pos = 'SANS_LITIGE' THEN
    v_statut := CASE WHEN v_present THEN 'appliquee' ELSE 'information' END;
  ELSIF v_c.statut_pos IN ('RECONNUE_SORTANT', 'VALIDEE_MANAGER') THEN
    v_statut := CASE WHEN v_present THEN 'appliquee' ELSE 'en_attente' END;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'STATUT_CORRECTION_INVALIDE';
  END IF;

  IF v_statut = 'appliquee' THEN
    SELECT r.ancien, r.nouveau, r.reel INTO v_ancien, v_nouveau, v_reel FROM public._imputer_sortant(v_c) r;
  END IF;

  UPDATE public.corrections_stock_initial
     SET statut = v_statut, ancien_montant = v_ancien, nouveau_montant = v_nouveau, stock_reel_origine = v_reel
   WHERE id = v_id;
END;
$$;

-- La première décision gagne. 'validee' : le sortant paie. 'annulee' : le
-- caissier sur place paie, et sa ligne repart du chiffre d'origine.
CREATE OR REPLACE FUNCTION public.decider_correction_stock_initial(
  p_id       uuid,
  p_decision text,
  p_par      text
)
RETURNS TABLE (statut text, nouveau_montant numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c       public.corrections_stock_initial%ROWTYPE;
  v_par     text := COALESCE(NULLIF(BTRIM(p_par), ''), 'Manager');
  v_ancien  numeric;
  v_nouveau numeric;
  v_reel    numeric;
BEGIN
  IF p_decision NOT IN ('validee', 'annulee') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DECISION_INVALIDE';
  END IF;

  SELECT * INTO v_c FROM public.corrections_stock_initial c WHERE c.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'LITIGE_INTROUVABLE';
  END IF;
  IF v_c.statut <> 'en_attente' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LITIGE_DEJA_TRAITE';
  END IF;

  IF p_decision = 'validee' THEN
    SELECT r.ancien, r.nouveau, r.reel INTO v_ancien, v_nouveau, v_reel FROM public._imputer_sortant(v_c) r;
  ELSE
    SELECT r.ancien, r.nouveau INTO v_ancien, v_nouveau FROM public._imputer_place(v_c) r;
  END IF;

  UPDATE public.corrections_stock_initial c
     SET statut = p_decision,
         ancien_montant = v_ancien,
         nouveau_montant = v_nouveau,
         stock_reel_origine = v_reel,
         decide_par = v_par,
         decide_at = NOW()
   WHERE c.id = p_id;

  INSERT INTO public.journal_activite (action, details, restaurant_id, user_nom)
  VALUES (
    'decision_litige_stock_initial',
    jsonb_build_object(
      'correction_id', p_id, 'decision', p_decision, 'produit', v_c.produit_nom,
      'stock_reporte', v_c.stock_reporte, 'stock_corrige', v_c.stock_corrige,
      'ancien_montant', v_ancien, 'nouveau_montant', v_nouveau
    ),
    v_c.restaurant_id,
    v_par
  );

  RETURN QUERY SELECT p_decision, v_nouveau;
END;
$$;

-- L'écran Vérification : les corrections d'un point, et les deux montants
-- possibles avant la décision.
CREATE OR REPLACE FUNCTION public.corrections_stock_initial_du_point(p_point_id uuid)
RETURNS TABLE (
  id uuid,
  produit_nom text,
  stock_reporte numeric,
  stock_corrige numeric,
  explication text,
  statut text,
  shift_intermediaire_debloque boolean,
  caissier_place_nom text,
  caissier_sortant_nom text,
  saisi_par_nom text,
  sortant_arrive boolean,
  montant_si_valide numeric,
  montant_si_annule numeric,
  nouveau_montant numeric,
  decide_par text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c         public.corrections_stock_initial%ROWTYPE;
  v_sortant public.inventaire_lignes%ROWTYPE;
  v_place   public.inventaire_lignes%ROWTYPE;
BEGIN
  FOR c IN
    SELECT k.*
      FROM public.corrections_stock_initial k
     WHERE EXISTS (
       SELECT 1 FROM public.inventaires_shifts s
        WHERE s.point_id = p_point_id
          AND s.pos_service_id IN (k.pos_service_place_id, k.pos_service_sortant_id)
     )
     ORDER BY k.created_at
  LOOP
    v_sortant := NULL;
    v_place := NULL;
    SELECT * INTO v_sortant FROM public.inventaire_lignes l
     WHERE l.id = public._id_ligne_de_service(c.pos_service_sortant_id, c.produit_id);
    SELECT * INTO v_place FROM public.inventaire_lignes l
     WHERE l.id = public._id_ligne_de_service(c.pos_service_place_id, c.produit_id);

    id := c.id;
    produit_nom := c.produit_nom;
    stock_reporte := c.stock_reporte;
    stock_corrige := c.stock_corrige;
    explication := c.explication;
    statut := c.statut;
    shift_intermediaire_debloque := c.shift_intermediaire_debloque;
    caissier_place_nom := c.caissier_place_nom;
    caissier_sortant_nom := c.caissier_sortant_nom;
    saisi_par_nom := c.saisi_par_nom;
    nouveau_montant := c.nouveau_montant;
    decide_par := c.decide_par;
    sortant_arrive := v_sortant.id IS NOT NULL AND v_sortant.stock_reel IS NOT NULL;
    montant_si_valide := CASE WHEN sortant_arrive THEN public._montant_correction_stock(
      v_sortant,
      COALESCE(v_sortant.ecart, 0) + (c.stock_corrige - v_sortant.stock_reel),
      c.prix
    ) END;
    montant_si_annule := CASE WHEN v_place.id IS NOT NULL THEN public._montant_correction_stock(
      v_place,
      COALESCE(v_place.ecart, 0) - (c.stock_reporte - c.stock_corrige),
      c.prix
    ) END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Les fonctions internes ne s'appellent jamais de l'extérieur. Le pont utilise
-- la clé service_role ; l'écran passe par les mêmes rôles que les autres décisions.
-- Révoquer PUBLIC ne suffit pas : Supabase accorde par défaut EXECUTE à anon,
-- authenticated et service_role sur toute nouvelle fonction du schéma public.
REVOKE ALL ON FUNCTION public._montant_correction_stock(public.inventaire_lignes, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._appliquer_ecart_correction(public.inventaire_lignes, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._id_ligne_de_service(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._imputer_sortant(public.corrections_stock_initial) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._imputer_place(public.corrections_stock_initial) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transmettre_correction_stock_initial(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transmettre_correction_stock_initial(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.decider_correction_stock_initial(uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.corrections_stock_initial_du_point(uuid) TO anon, authenticated, service_role;

-- Contrôle : doit renvoyer 1 ligne.
SELECT 'corrections_stock_initial OK' AS controle
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'corrections_stock_initial';
