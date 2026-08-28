-- ════════════════════════════════════════════════════════════════════════════
--  TEST du trigger points_shifts_vente_machine (supabase_pos_vente_systeme.sql)
--
--  À coller tel quel dans Supabase → SQL Editor → Run, APRÈS la migration.
--  Le script se termine par un ROLLBACK : il n'écrit RIEN en base. Il travaille
--  sur une date bidon (2099-01-01/02) pour ne croiser aucun point réel.
--
--  Sortie attendue : la dernière ligne affiche « TOUS LES SCÉNARIOS PASSENT ».
--  Le premier scénario qui échoue lève une exception et annule tout.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_resto   uuid;
  v_point_a uuid;
  v_point_b uuid;
  v_shift1  uuid;
  v_shift2  uuid;
  v_lu      numeric;
BEGIN
  SELECT id INTO v_resto FROM public.restaurants ORDER BY created_at LIMIT 1;
  IF v_resto IS NULL THEN
    RAISE EXCEPTION 'Aucun restaurant en base : test impossible';
  END IF;

  INSERT INTO public.points (restaurant_id, date) VALUES (v_resto, DATE '2099-01-01')
    RETURNING id INTO v_point_a;
  INSERT INTO public.points (restaurant_id, date) VALUES (v_resto, DATE '2099-01-02')
    RETURNING id INTO v_point_b;

  -- ── 1. Aucun shift : la vente machine reste vierge ────────────────────────
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS NOT NULL THEN
    RAISE EXCEPTION '1. point neuf : attendu NULL, lu %', v_lu;
  END IF;

  -- ── 2. Shift saisi à la main (vente_systeme_pos NULL) : on ne touche à rien
  INSERT INTO public.points_shifts (point_id, restaurant_id, date, caissier_nom, vente_shift)
    VALUES (v_point_a, v_resto, DATE '2099-01-01', 'Test manuel', 90000);
  UPDATE public.points SET vente_machine = 90000 WHERE id = v_point_a;  -- saisie gérant
  UPDATE public.points_shifts SET vente_shift = 91000
    WHERE point_id = v_point_a AND caissier_nom = 'Test manuel';
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 90000 THEN
    RAISE EXCEPTION '2. site sans POS : la saisie manuelle a été écrasée (lu %)', v_lu;
  END IF;
  DELETE FROM public.points_shifts WHERE point_id = v_point_a;
  UPDATE public.points SET vente_machine = NULL WHERE id = v_point_a;

  -- ── 3. Premier shift POS reçu ─────────────────────────────────────────────
  INSERT INTO public.points_shifts (point_id, restaurant_id, date, caissier_nom, vente_shift, vente_systeme_pos)
    VALUES (v_point_a, v_resto, DATE '2099-01-01', 'Test 1', 100000, 100000)
    RETURNING id INTO v_shift1;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 100000 THEN
    RAISE EXCEPTION '3. premier shift : attendu 100000, lu %', v_lu;
  END IF;

  -- ── 4. Deuxième shift ajouté ──────────────────────────────────────────────
  INSERT INTO public.points_shifts (point_id, restaurant_id, date, caissier_nom, vente_shift, vente_systeme_pos)
    VALUES (v_point_a, v_resto, DATE '2099-01-01', 'Test 2', 50000, 50000)
    RETURNING id INTO v_shift2;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 150000 THEN
    RAISE EXCEPTION '4. deuxième shift : attendu 150000, lu %', v_lu;
  END IF;

  -- ── 5. Shift corrigé (resynchro du POS) ───────────────────────────────────
  UPDATE public.points_shifts SET vente_systeme_pos = 60000 WHERE id = v_shift2;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 160000 THEN
    RAISE EXCEPTION '5. shift corrigé : attendu 160000, lu %', v_lu;
  END IF;

  -- ── 6. Vente POS égale à zéro : reçue, pas absente ────────────────────────
  UPDATE public.points_shifts SET vente_systeme_pos = 0 WHERE id = v_shift2;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 100000 THEN
    RAISE EXCEPTION '6. shift à 0 : attendu 100000, lu %', v_lu;
  END IF;
  UPDATE public.points_shifts SET vente_systeme_pos = 0 WHERE id = v_shift1;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '6bis. journée à 0 : attendu 0 (jamais NULL), lu %', v_lu;
  END IF;
  UPDATE public.points_shifts SET vente_systeme_pos = 100000 WHERE id = v_shift1;
  UPDATE public.points_shifts SET vente_systeme_pos = 60000  WHERE id = v_shift2;

  -- ── 7. Shift déplacé vers un autre jour : les deux points suivent ─────────
  UPDATE public.points_shifts
     SET point_id = v_point_b, date = DATE '2099-01-02'
   WHERE id = v_shift2;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_a;
  IF v_lu IS DISTINCT FROM 100000 THEN
    RAISE EXCEPTION '7. point d''origine après déplacement : attendu 100000, lu %', v_lu;
  END IF;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_b;
  IF v_lu IS DISTINCT FROM 60000 THEN
    RAISE EXCEPTION '7bis. point d''arrivée après déplacement : attendu 60000, lu %', v_lu;
  END IF;

  -- ── 8. Suppression du shift déplacé ───────────────────────────────────────
  DELETE FROM public.points_shifts WHERE id = v_shift2;
  SELECT vente_machine INTO v_lu FROM public.points WHERE id = v_point_b;
  IF v_lu IS DISTINCT FROM 60000 THEN
    RAISE EXCEPTION '8. dernier shift POS supprimé : la somme connue doit rester (lu %)', v_lu;
  END IF;

  RAISE NOTICE 'TOUS LES SCÉNARIOS PASSENT';
END $$;

ROLLBACK;
