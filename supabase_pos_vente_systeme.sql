-- ════════════════════════════════════════════════════════════════════════════
--  Vente système du POS par shift → alimente points.vente_machine
--
--  Spéc : docs/superpowers/specs/2026-08-17-pos-samer-vers-samtrackly-design.md
--  À lancer dans SAMTRACKLY (pas le cloud POS). Rejouable sans risque.
--
--  POURQUOI
--  `points.vente_machine` (la vente réelle du système, lue sur l'écran de la
--  caisse) était tapée à la main par le gérant. Les 19 et 20 août 2026, sur un
--  site pourtant déjà alimenté par le POS, personne ne l'a saisie : l'écart
--  théorique/machine — le contrôle historique du groupe — a disparu en silence
--  ces deux jours-là.
--
--  Le POS connaît ce chiffre exactement. On le stocke par shift, puis le pont
--  somme les shifts d'une journée pour remplir `points.vente_machine`. Même
--  motif que `vente_total` : un cache recalculé à partir des lignes réelles,
--  jamais un nombre isolé qu'on pourrait oublier de mettre à jour.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS vente_systeme_pos NUMERIC;

COMMENT ON COLUMN public.points_shifts.vente_systeme_pos IS
  'Vente système du POS pour ce shift (rapport_z.total_ventes). NULL pour un shift '
  'saisi à la main. Sommée par le pont pour remplir points.vente_machine.';


-- ── Vérification ────────────────────────────────────────────────────────────
--
-- Après le prochain passage du pont, la vente machine doit se remplir seule :
--
--   SELECT p.date, p.vente_total AS theorique, p.vente_machine AS machine,
--          p.vente_total - COALESCE(p.vente_machine, 0) AS ecart,
--          SUM(s.ecart_pos) AS ecart_mesure_au_comptage
--     FROM points p
--     JOIN points_shifts s ON s.point_id = p.id
--    WHERE p.restaurant_id = '2f09688d-a4b9-4b14-8c45-943543953379'
--      AND p.date >= '2026-08-17'
--    GROUP BY p.date, p.vente_total, p.vente_machine
--    ORDER BY p.date;
--
-- `ecart` et `ecart_mesure_au_comptage` doivent désormais coïncider : depuis le
-- 2026-08-20, `espece` vient du comptage à l'aveugle, donc un manquant en
-- espèces se retrouve dans les DEUX. C'est le même fait vu de deux façons —
-- ne jamais déduire deux fois au vérificateur.

-- ════════════════════════════════════════════════════════════════════════════
--  AGRÉGATION — points.vente_machine = somme des vente_systeme_pos du point
--  (ajout du 2026-08-28 ; rejouable, à lancer dans SAMTRACKLY)
--
--  POURQUOI CE TRIGGER ALORS QUE LE PONT SAIT DÉJÀ SOMMER
--  Le pont ne repasse que lors d'une synchro. Tout ce qui bouge côté
--  Samtrackly — un shift corrigé, supprimé, ou déplacé vers un autre jour
--  depuis `app/modifier-point.js` — laissait `points.vente_machine` figé sur
--  l'ancienne somme, sans que rien ne le signale. La somme redevient ici ce
--  qu'elle aurait toujours dû être : un cache recalculé depuis les lignes,
--  au même titre que `vente_total`.
--
--  ⚠ RÈGLE DE SÛRETÉ — ON N'ÉCRIT JAMAIS NULL, ET JAMAIS 0 « PAR DÉFAUT ».
--  Tant qu'aucun shift du point ne porte de `vente_systeme_pos`, la fonction
--  ne touche pas à `points.vente_machine`. Sinon elle effacerait :
--    • la saisie manuelle des 6 sites encore sur SAMTRACKLY (tous leurs shifts
--      ont `vente_systeme_pos = NULL`, y compris les points déjà validés) ;
--    • le secours manuel d'un site POS dont la remontée n'est pas arrivée
--      (cf. `peutSaisirVenteMachineManuellement` dans lib/sourcePoint.js).
--  Conséquence assumée : si l'on supprime le DERNIER shift POS d'un point, la
--  somme précédente reste en place au lieu de repasser à NULL. Une valeur
--  périmée se voit et se corrige ; une valeur effacée ne se récupère pas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalculer_vente_machine_pos(p_point_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_mesures integer;
  v_somme   numeric;
BEGIN
  IF p_point_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE vente_systeme_pos IS NOT NULL),
         COALESCE(SUM(vente_systeme_pos), 0)
    INTO v_mesures, v_somme
    FROM public.points_shifts
   WHERE point_id = p_point_id;

  -- Aucune remontée POS sur ce point → absence, pas zéro. On ne touche à rien.
  IF v_mesures = 0 THEN
    RETURN;
  END IF;

  UPDATE public.points
     SET vente_machine = v_somme
   WHERE id = p_point_id
     AND vente_machine IS DISTINCT FROM v_somme;
END;
$$;

COMMENT ON FUNCTION public.recalculer_vente_machine_pos(uuid) IS
  'Recalcule points.vente_machine depuis la somme des points_shifts.vente_systeme_pos '
  'du point. N''écrit rien tant qu''aucun shift ne porte de vente_systeme_pos.';


CREATE OR REPLACE FUNCTION public.trg_points_shifts_vente_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculer_vente_machine_pos(OLD.point_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculer_vente_machine_pos(NEW.point_id);

  -- Shift déplacé vers un autre jour : les DEUX points changent de somme.
  IF TG_OP = 'UPDATE' AND OLD.point_id IS DISTINCT FROM NEW.point_id THEN
    PERFORM public.recalculer_vente_machine_pos(OLD.point_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS points_shifts_vente_machine ON public.points_shifts;
CREATE TRIGGER points_shifts_vente_machine
AFTER INSERT OR DELETE OR UPDATE OF vente_systeme_pos, point_id
ON public.points_shifts
FOR EACH ROW
EXECUTE FUNCTION public.trg_points_shifts_vente_machine();


-- ── Backfill : remet d'aplomb les points déjà en base ───────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT point_id
      FROM public.points_shifts
     WHERE vente_systeme_pos IS NOT NULL
       AND point_id IS NOT NULL
  LOOP
    PERFORM public.recalculer_vente_machine_pos(r.point_id);
  END LOOP;
END $$;


-- ── Contrôle d'après-coup : plus aucune ligne ne doit sortir ────────────────
--
--   SELECT p.date, p.vente_machine, s.somme_pos
--     FROM points p
--     JOIN (SELECT point_id,
--                  SUM(vente_systeme_pos) AS somme_pos,
--                  COUNT(*) FILTER (WHERE vente_systeme_pos IS NOT NULL) AS mesures
--             FROM points_shifts GROUP BY point_id) s ON s.point_id = p.id
--    WHERE s.mesures > 0
--      AND p.vente_machine IS DISTINCT FROM s.somme_pos
--    ORDER BY p.date;
