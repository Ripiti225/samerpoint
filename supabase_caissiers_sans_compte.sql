-- =====================================================================
--  CAISSIERS SANS COMPTE SAMTRACKLY — reconnus par leur fiche RH
--
--  Le pont POS → Samtrackly reconnaît un caissier par la chaîne
--  compte POS → fiche RH (travailleurs) → compte Samtrackly (utilisateurs,
--  via utilisateurs.travailleur_id). Sans compte relié, le shift arrive avec
--  caissier_id vide : Vérification affiche « Caissier », Litiges ne
--  rattache la déduction à personne, la note et les déductions l'ignorent.
--
--  Ce script :
--   1. relie 6 comptes existants à leur fiche (correspondances validées par
--      le propriétaire le 05/10/2026) ;
--   2. crée un COMPTE TECHNIQUE (PIN 'SANS_CONNEXION' : aucune connexion
--      possible, caché de l'écran de connexion) pour chaque fiche RH
--      caissier/gérant/sous-gérant active qui n'a toujours pas de compte ;
--   3. fait pareil automatiquement pour les fiches créées ou modifiées
--      ensuite (déclencheur) ;
--   4. rattache les shifts et inventaires POS déjà reçus sans caissier.
--
--  Le pont n'est pas modifié : il suit la chaîne, qui est maintenant complète.
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase (Samtrackly).
-- =====================================================================

-- ── 1. Comptes existants à relier (validé le 05/10/2026) ───────────────
WITH liens(utilisateur_id, nom_fiche) AS (VALUES
  ('0af0cb79-1857-421b-84fb-75ff715c2e5d'::uuid, 'Bonzou Michel'),
  ('75bb0581-b9ad-47c4-9f1c-283b4b9242ba'::uuid, 'GAHIE CONSTANT'),
  ('f7453ab0-cd6f-497c-a5c4-9eff3bcbb6ed'::uuid, 'KAZEM RAISSA SOPHIA'),
  ('8f458cf0-1555-4cba-ae1e-0f294af658a8'::uuid, 'KOUAME KOUADIO PATRICK'),
  ('5672bdcc-84fa-4066-bfd2-be9679fb1fad'::uuid, 'DJE ANGE WILFRIED DORGELEX'),
  ('8d6efd38-296c-4235-9a5a-8c38c6842f44'::uuid, 'Siriki Amara')
)
UPDATE public.utilisateurs u
   SET travailleur_id = t.id
  FROM liens l
  JOIN public.travailleurs t
    ON UPPER(BTRIM(t.nom)) = UPPER(BTRIM(l.nom_fiche)) AND t.archived_at IS NULL
 WHERE u.id = l.utilisateur_id
   AND u.travailleur_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.utilisateurs x WHERE x.travailleur_id = t.id);

-- ── 2. Compte technique pour une fiche sans compte ─────────────────────
CREATE OR REPLACE FUNCTION public.assurer_compte_technique(p_travailleur_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t    public.travailleurs%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.utilisateurs WHERE travailleur_id = p_travailleur_id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO t FROM public.travailleurs WHERE id = p_travailleur_id;
  IF NOT FOUND OR NOT COALESCE(t.actif, true) OR t.archived_at IS NOT NULL THEN RETURN NULL; END IF;
  -- Seuls ceux qui tiennent la caisse au POS.
  IF NOT (t.poste ILIKE 'caiss%' OR t.poste ILIKE 'g_rant%' OR t.poste ILIKE 'sous-g%') THEN RETURN NULL; END IF;

  INSERT INTO public.utilisateurs (nom, role, pin, restaurant_id, actif, travailleur_id, poste, type_contrat, date_embauche)
  VALUES (
    BTRIM(t.nom),
    CASE WHEN t.poste ILIKE 'caiss%' THEN 'caissier' ELSE 'gerant' END,
    'SANS_CONNEXION',          -- jamais égal à un PIN tapé : pas de connexion possible
    t.restaurant_id, true, t.id, BTRIM(t.poste), t.type_contrat, t.date_embauche
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Fiches existantes.
SELECT public.assurer_compte_technique(t.id)
  FROM public.travailleurs t
 WHERE COALESCE(t.actif, true) AND t.archived_at IS NULL
   AND (t.poste ILIKE 'caiss%' OR t.poste ILIKE 'g_rant%' OR t.poste ILIKE 'sous-g%')
   AND NOT EXISTS (SELECT 1 FROM public.utilisateurs u WHERE u.travailleur_id = t.id);

-- ── 3. Fiches à venir (ajout dans Équipe, changement de poste) ──────────
CREATE OR REPLACE FUNCTION public.trg_travailleur_compte_technique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.assurer_compte_technique(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Ne jamais bloquer l'enregistrement d'une fiche RH.
    RAISE WARNING 'compte technique non créé pour % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS travailleur_compte_technique ON public.travailleurs;
CREATE TRIGGER travailleur_compte_technique
  AFTER INSERT OR UPDATE OF poste, actif, archived_at ON public.travailleurs
  FOR EACH ROW EXECUTE FUNCTION public.trg_travailleur_compte_technique();

-- ── 4. Rattrapage des shifts et inventaires POS déjà reçus ──────────────
-- Le nom envoyé par le POS (points_shifts.caissier_nom) est le nom de la fiche RH.
UPDATE public.points_shifts ps
   SET caissier_id = u.id
  FROM public.travailleurs t
  JOIN public.utilisateurs u ON u.travailleur_id = t.id
 WHERE ps.caissier_id IS NULL
   AND ps.pos_service_id IS NOT NULL
   AND t.archived_at IS NULL
   AND UPPER(BTRIM(t.nom)) = UPPER(BTRIM(ps.caissier_nom));

UPDATE public.inventaires_shifts i
   SET caissier_id = ps.caissier_id
  FROM public.points_shifts ps
 WHERE i.caissier_id IS NULL
   AND i.pos_service_id IS NOT NULL
   AND ps.pos_service_id = i.pos_service_id
   AND ps.caissier_id IS NOT NULL;

INSERT INTO public.journal_activite (action, details, user_nom)
VALUES ('caissiers_sans_compte_rattaches', jsonb_build_object('script', 'supabase_caissiers_sans_compte.sql'), 'Script SQL');

-- ── Contrôle : il doit rester 0 shift POS sans caissier reconnaissable ──
SELECT
  (SELECT COUNT(*) FROM public.points_shifts WHERE caissier_id IS NULL AND pos_service_id IS NOT NULL)      AS shifts_pos_sans_caissier,
  (SELECT COUNT(*) FROM public.inventaires_shifts WHERE caissier_id IS NULL AND pos_service_id IS NOT NULL) AS inventaires_pos_sans_caissier,
  (SELECT COUNT(*) FROM public.utilisateurs WHERE pin = 'SANS_CONNEXION')                                   AS comptes_techniques;
