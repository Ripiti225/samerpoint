-- Test LOCAL de supabase_correction_stock_initial.sql.
-- À lancer depuis la racine du dépôt, sur un cluster PostgreSQL JETABLE : ce
-- script crée des rôles et des tables réduites. Jamais sur une base réelle.
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE points (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), montant_inventaire numeric DEFAULT 0);
CREATE TABLE inventaires_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id uuid REFERENCES points(id),
  restaurant_id uuid,
  montant_a_deduire numeric DEFAULT 0,
  pos_service_id uuid UNIQUE
);
CREATE TABLE inventaire_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventaire_id uuid REFERENCES inventaires_shifts(id),
  produit_id text,
  produit_nom text,
  stock_initial numeric,
  entrees numeric,
  sorties numeric,
  stock_reel numeric,
  ecart numeric,
  nombre_explique numeric,
  montant_deduit numeric DEFAULT 0,
  explication text,
  explication_statut text,
  quantite_acceptee numeric,
  deduction_annulee boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE journal_activite (
  id serial PRIMARY KEY, action text, details jsonb, restaurant_id uuid, point_id uuid, user_nom text
);

\i supabase_correction_stock_initial.sql

CREATE TABLE sc (
  nom text PRIMARY KEY, correction uuid, service_sortant uuid, service_place uuid,
  ligne_sortant uuid, ligne_place uuid, point_sortant uuid, point_place uuid, shift_sortant uuid, shift_place uuid
);

-- Un sortant et un caissier sur place, chacun sur son point.
CREATE FUNCTION scenario(p_nom text, p_ecart_sortant numeric, p_reel_sortant numeric, p_explique numeric DEFAULT 0, p_ecart_place numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  p1 uuid; p2 uuid; s1 uuid; s2 uuid; l1 uuid; l2 uuid;
  ss uuid := gen_random_uuid(); sp uuid := gen_random_uuid();
BEGIN
  INSERT INTO points DEFAULT VALUES RETURNING id INTO p1;
  INSERT INTO points DEFAULT VALUES RETURNING id INTO p2;
  INSERT INTO inventaires_shifts (point_id, pos_service_id) VALUES (p1, ss) RETURNING id INTO s1;
  INSERT INTO inventaires_shifts (point_id, pos_service_id) VALUES (p2, sp) RETURNING id INTO s2;
  INSERT INTO inventaire_lignes (inventaire_id, produit_id, stock_reel, ecart, nombre_explique)
    VALUES (s1, 'po8', p_reel_sortant, p_ecart_sortant, p_explique) RETURNING id INTO l1;
  INSERT INTO inventaire_lignes (inventaire_id, produit_id, stock_initial, stock_reel, ecart)
    VALUES (s2, 'po8', 12, 12, p_ecart_place) RETURNING id INTO l2;
  INSERT INTO sc VALUES (p_nom, gen_random_uuid(), ss, sp, l1, l2, p1, p2, s1, s2);
END $$;

CREATE FUNCTION transmettre(p_nom text, p_statut text, p_reporte numeric, p_corrige numeric, p_service_sortant uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r sc%ROWTYPE;
BEGIN
  SELECT * INTO r FROM sc WHERE nom = p_nom;
  PERFORM transmettre_correction_stock_initial(jsonb_build_object(
    'pos_correction_id', r.correction, 'restaurant_id', gen_random_uuid(),
    'pos_service_place_id', r.service_place,
    'pos_service_sortant_id', COALESCE(p_service_sortant, r.service_sortant),
    'produit_id', 'po8', 'produit_nom', 'Total poulet', 'prix', 8000,
    'stock_reporte', p_reporte, 'stock_corrige', p_corrige, 'explication', 'Recompté',
    'statut_pos', p_statut, 'shift_intermediaire_debloque', false,
    'caissier_place_nom', 'Caissier B', 'caissier_sortant_nom', 'Caissier A', 'saisi_par_nom', 'Caissier B'
  ));
END $$;

CREATE FUNCTION id_correction(p_nom text) RETURNS uuid LANGUAGE sql AS $$
  SELECT c.id FROM corrections_stock_initial c JOIN sc ON sc.correction = c.pos_correction_id WHERE sc.nom = p_nom;
$$;

CREATE FUNCTION egal(p_obtenu anycompatible, p_attendu anycompatible, p_nom text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_obtenu IS DISTINCT FROM p_attendu THEN
    RAISE EXCEPTION 'ÉCHEC % : obtenu %, attendu %', p_nom, p_obtenu, p_attendu;
  END IF;
  RAISE NOTICE 'ok : %', p_nom;
END $$;

-- 1. Reconnu sur place : le sortant paie. Le rejeu ne facture pas deux fois.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('reconnu', 0, 14);
  PERFORM transmettre('reconnu', 'RECONNUE_SORTANT', 14, 12);
  PERFORM transmettre('reconnu', 'RECONNUE_SORTANT', 14, 12);
  SELECT * INTO r FROM sc WHERE nom = 'reconnu';
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 16000::numeric, 'reconnu : montant de la ligne');
  PERFORM egal((SELECT ecart FROM inventaire_lignes WHERE id = r.ligne_sortant), -2::numeric, 'reconnu : écart recalculé');
  PERFORM egal((SELECT stock_reel FROM inventaire_lignes WHERE id = r.ligne_sortant), 12::numeric, 'reconnu : stock réel corrigé');
  PERFORM egal((SELECT montant_a_deduire FROM inventaires_shifts WHERE id = r.shift_sortant), 16000::numeric, 'reconnu : total shift sans doublon');
  PERFORM egal((SELECT montant_inventaire FROM points WHERE id = r.point_sortant), 16000::numeric, 'reconnu : total point sans doublon');
  PERFORM egal((SELECT stock_reel_origine FROM corrections_stock_initial WHERE id = id_correction('reconnu')), 14::numeric, 'reconnu : chiffre d''origine conservé');
END $$;

-- 2. Litige : rien ne bouge, puis Annuler fait payer le caissier sur place.
DO $$ DECLARE r sc%ROWTYPE; v_ok boolean := false; BEGIN
  PERFORM scenario('annule', 0, 14);
  PERFORM transmettre('annule', 'A_VALIDER', 14, 12);
  SELECT * INTO r FROM sc WHERE nom = 'annule';
  PERFORM egal((SELECT statut FROM corrections_stock_initial WHERE id = id_correction('annule')), 'en_attente'::text, 'annule : en attente');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 0::numeric, 'annule : sortant non facturé avant décision');
  PERFORM decider_correction_stock_initial(id_correction('annule'), 'annulee', 'Samer');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_place), 16000::numeric, 'annule : caissier sur place facturé');
  PERFORM egal((SELECT stock_initial FROM inventaire_lignes WHERE id = r.ligne_place), 14::numeric, 'annule : chiffre d''origine');
  PERFORM egal((SELECT montant_inventaire FROM points WHERE id = r.point_place), 16000::numeric, 'annule : total point');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 0::numeric, 'annule : sortant jamais facturé');
  PERFORM egal((SELECT decide_par FROM corrections_stock_initial WHERE id = id_correction('annule')), 'Samer'::text, 'annule : décideur');
  PERFORM egal((SELECT count(*)::int FROM journal_activite WHERE action = 'decision_litige_stock_initial'), 1, 'annule : journal');
  BEGIN
    PERFORM decider_correction_stock_initial(id_correction('annule'), 'validee', 'Autre');
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%LITIGE_DEJA_TRAITE%';
  END;
  PERFORM egal(v_ok, true, 'annule : la première décision gagne');
END $$;

-- 3. Valider 10 / 12 / 9 : le sortant paie 1, malgré une explication de surplus.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('surplus_manque', 2, 12, 2);
  PERFORM transmettre('surplus_manque', 'A_VALIDER', 12, 9);
  SELECT * INTO r FROM sc WHERE nom = 'surplus_manque';
  PERFORM decider_correction_stock_initial(id_correction('surplus_manque'), 'validee', 'Samer');
  PERFORM egal((SELECT ecart FROM inventaire_lignes WHERE id = r.ligne_sortant), -1::numeric, 'surplus_manque : écart');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 8000::numeric, 'surplus_manque : 1 × prix');
END $$;

-- 3 bis. Annuler le même litige : le caissier sur place paie 3.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('surplus_annule', 2, 12);
  PERFORM transmettre('surplus_annule', 'A_VALIDER', 12, 9);
  SELECT * INTO r FROM sc WHERE nom = 'surplus_annule';
  PERFORM decider_correction_stock_initial(id_correction('surplus_annule'), 'annulee', 'Samer');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_place), 24000::numeric, 'surplus_annule : 3 × prix');
END $$;

-- 4. Surplus annulé : écart à zéro, explication en attente retirée.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('surplus_nul', 2, 12);
  SELECT * INTO r FROM sc WHERE nom = 'surplus_nul';
  UPDATE inventaire_lignes SET explication_statut = 'en_attente', explication = 'Livraison' WHERE id = r.ligne_sortant;
  PERFORM transmettre('surplus_nul', 'SANS_LITIGE', 12, 10);
  PERFORM egal((SELECT ecart FROM inventaire_lignes WHERE id = r.ligne_sortant), 0::numeric, 'surplus_nul : écart nul');
  PERFORM egal((SELECT explication_statut FROM inventaire_lignes WHERE id = r.ligne_sortant), NULL::text, 'surplus_nul : explication retirée');
  PERFORM egal((SELECT statut FROM corrections_stock_initial WHERE id = id_correction('surplus_nul')), 'appliquee'::text, 'surplus_nul : appliquée');
END $$;

-- 5. Manquant remonté : la retenue déjà appliquée est reprise.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('remonte', -2, 8);
  SELECT * INTO r FROM sc WHERE nom = 'remonte';
  UPDATE inventaire_lignes SET montant_deduit = 16000 WHERE id = r.ligne_sortant;
  UPDATE inventaires_shifts SET montant_a_deduire = 16000 WHERE id = r.shift_sortant;
  UPDATE points SET montant_inventaire = 16000 WHERE id = r.point_sortant;
  PERFORM transmettre('remonte', 'SANS_LITIGE', 8, 10);
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 0::numeric, 'remonte : ligne à zéro');
  PERFORM egal((SELECT montant_a_deduire FROM inventaires_shifts WHERE id = r.shift_sortant), 0::numeric, 'remonte : shift à zéro');
  PERFORM egal((SELECT montant_inventaire FROM points WHERE id = r.point_sortant), 0::numeric, 'remonte : point à zéro');
END $$;

-- 6. Déduction annulée définitivement : elle reste à zéro.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('deduction_annulee', 0, 14);
  SELECT * INTO r FROM sc WHERE nom = 'deduction_annulee';
  UPDATE inventaire_lignes SET deduction_annulee = true WHERE id = r.ligne_sortant;
  PERFORM transmettre('deduction_annulee', 'RECONNUE_SORTANT', 14, 12);
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 0::numeric, 'deduction_annulee : reste à zéro');
END $$;

-- 7. Shift du sortant absent : passe en manuel, Valider refusé clairement.
DO $$ DECLARE v_ok boolean := false; BEGIN
  PERFORM scenario('absent', 0, 14);
  PERFORM transmettre('absent', 'VALIDEE_MANAGER', 14, 12, gen_random_uuid());
  PERFORM egal((SELECT statut FROM corrections_stock_initial WHERE id = id_correction('absent')), 'en_attente'::text, 'absent : décision manuelle');
  BEGIN
    PERFORM decider_correction_stock_initial(id_correction('absent'), 'validee', 'Samer');
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%SHIFT_SORTANT_ABSENT%';
  END;
  PERFORM egal(v_ok, true, 'absent : Valider refusé');
  PERFORM egal((SELECT statut FROM corrections_stock_initial WHERE id = id_correction('absent')), 'en_attente'::text, 'absent : toujours en attente');
END $$;

-- 7 bis. Sans litige et sortant absent : simple trace.
DO $$ BEGIN
  PERFORM scenario('absent_sans_litige', 2, 12);
  PERFORM transmettre('absent_sans_litige', 'SANS_LITIGE', 12, 10, gen_random_uuid());
  PERFORM egal((SELECT statut FROM corrections_stock_initial WHERE id = id_correction('absent_sans_litige')), 'information'::text, 'absent_sans_litige : information');
END $$;

-- 8. Inventaire sur place sans écart enregistré (débloqué) : facturé quand même.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('debloque', 0, 14);
  SELECT * INTO r FROM sc WHERE nom = 'debloque';
  UPDATE inventaire_lignes SET ecart = NULL, stock_reel = NULL WHERE id = r.ligne_place;
  PERFORM transmettre('debloque', 'A_VALIDER', 14, 12);
  PERFORM decider_correction_stock_initial(id_correction('debloque'), 'annulee', 'Samer');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_place), 16000::numeric, 'debloque : 2 × prix');
END $$;

-- 9. Aperçu : les deux montants avant décision, vus depuis chaque point.
DO $$ DECLARE r sc%ROWTYPE; a record; BEGIN
  PERFORM scenario('apercu', 2, 12);
  PERFORM transmettre('apercu', 'A_VALIDER', 12, 9);
  SELECT * INTO r FROM sc WHERE nom = 'apercu';
  SELECT * INTO a FROM corrections_stock_initial_du_point(r.point_place);
  PERFORM egal(a.montant_si_valide, 8000::numeric, 'apercu : si Valider');
  PERFORM egal(a.montant_si_annule, 24000::numeric, 'apercu : si Annuler');
  SELECT * INTO a FROM corrections_stock_initial_du_point(r.point_sortant);
  PERFORM egal(a.sortant_arrive, true, 'apercu : visible depuis le point du sortant');
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 0::numeric, 'apercu : ne change rien');
END $$;

-- 10. Une décision ultérieure sur l'explication garde le montant cohérent.
DO $$ DECLARE r sc%ROWTYPE; BEGIN
  PERFORM scenario('explique', -2, 8, 1);
  SELECT * INTO r FROM sc WHERE nom = 'explique';
  UPDATE inventaire_lignes SET montant_deduit = 8000 WHERE id = r.ligne_sortant;
  PERFORM transmettre('explique', 'RECONNUE_SORTANT', 8, 7);
  PERFORM egal((SELECT montant_deduit FROM inventaire_lignes WHERE id = r.ligne_sortant), 16000::numeric, 'explique : −3 moins 1 expliqué');
END $$;

SELECT 'TOUS LES TESTS PASSENT' AS resultat;
