-- =====================================================================
--  TRÉSORERIE — modifier et répartir une dépense direction.
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Modifier : la dépense garde son id ; sa sortie (banque ou coffre) est
--  refaite avec le nouveau montant / compte. Un fond en espèces déjà compté
--  dans un point validé (point_id) ne change plus de montant, de catégorie,
--  de restaurant ni de date : on passe par « Répartir ».
--
--  Répartir un fond (même total) en une part espèces + une part nature
--  (règle M. Zreik, 12/10/2026) : la part en espèces ajoutée par la
--  correction est datée du jour de la modification, donc elle tombe dans le
--  FC reçu du point de ce jour-là (et le gérant est prévenu par l'app).
--   - Fond pas encore compté : la ligne d'origine garde la part nature (sa
--     date, sa sortie réduite) ; une nouvelle ligne Fond espèces datée du jour,
--     avec sa propre sortie, prend le reste. Les deux restent indépendantes.
--   - Fond espèces déjà compté dans un point : il ne bouge pas. Deux lignes
--     de correction s'y rattachent (origine_id), sans sortie : Fond en nature
--     + (date d'origine) et Fond espèces − (date du jour, retiré du FC reçu).
-- =====================================================================

ALTER TABLE tresorerie_depenses_direction
  ADD COLUMN IF NOT EXISTS origine_id uuid REFERENCES tresorerie_depenses_direction(id) ON DELETE CASCADE;

-- Seule une correction de fond espèces peut être négative.
ALTER TABLE tresorerie_depenses_direction DROP CONSTRAINT IF EXISTS tresorerie_depenses_direction_montant_check;
ALTER TABLE tresorerie_depenses_direction ADD CONSTRAINT tresorerie_depenses_direction_montant_check
  CHECK (montant > 0 OR (montant < 0 AND categorie = 'fond' AND origine_id IS NOT NULL));

-- ── Sortie d'une dépense : création (banque, coffre ou rien) ─────────
CREATE OR REPLACE FUNCTION tresorerie_depense_direction_sortie(
  p_source text, p_compte_id uuid, p_date date, p_montant bigint, p_libelle text, p_photo_url text,
  p_user_id text, p_user_nom text, OUT o_mvt uuid, OUT o_coffre uuid
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -p_montant, 'direction', p_libelle, p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO o_mvt;
  ELSIF p_source = 'coffre' THEN
    INSERT INTO tresorerie_coffre_mouvements (date, montant, type, source, libelle, cree_par, cree_par_nom)
    VALUES (p_date, -p_montant, 'depense', 'coffre', p_libelle, p_user_id, p_user_nom)
    RETURNING id INTO o_coffre;
  END IF;
END $$;

-- Date de la sortie existante (sinon la date de la dépense).
CREATE OR REPLACE FUNCTION tresorerie_depense_direction_date_sortie(r tresorerie_depenses_direction)
RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT date FROM tresorerie_mouvements WHERE id = r.mouvement_id),
    (SELECT date FROM tresorerie_coffre_mouvements WHERE id = r.coffre_mouvement_id),
    r.date)
$$;

-- ── Modifier ─────────────────────────────────────────────────────────
-- p_date_sortie : date de la sortie banque/coffre ; NULL = garder l'actuelle.
CREATE OR REPLACE FUNCTION tresorerie_depense_direction_modifier(
  p_id uuid, p_date date, p_date_sortie date, p_categorie text, p_restaurant_id uuid, p_montant bigint,
  p_source text, p_compte_id uuid, p_libelle text, p_note text, p_photo_url text, p_user_id text, p_user_nom text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r tresorerie_depenses_direction;
  v_date_sortie date;
  v_mvt uuid;
  v_coffre uuid;
BEGIN
  SELECT * INTO r FROM tresorerie_depenses_direction WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable (déjà supprimée ?)'; END IF;
  IF r.origine_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne de correction : modifiez ou supprimez la dépense d''origine.';
  END IF;
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF r.point_id IS NOT NULL AND (p_categorie <> r.categorie OR p_montant <> r.montant
      OR p_restaurant_id IS DISTINCT FROM r.restaurant_id OR p_date <> r.date) THEN
    RAISE EXCEPTION 'Ce fond est déjà compté dans un point validé : utilisez « Répartir espèces / nature ».';
  END IF;
  IF EXISTS (SELECT 1 FROM tresorerie_depenses_direction WHERE origine_id = p_id)
      AND (p_categorie <> r.categorie OR p_montant <> r.montant OR p_restaurant_id IS DISTINCT FROM r.restaurant_id) THEN
    RAISE EXCEPTION 'Ce fond a déjà été réparti : supprimez-le et ressaisissez-le pour changer son montant.';
  END IF;

  v_date_sortie := COALESCE(p_date_sortie, tresorerie_depense_direction_date_sortie(r));
  IF r.mouvement_id IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = r.mouvement_id; END IF;
  IF r.coffre_mouvement_id IS NOT NULL THEN DELETE FROM tresorerie_coffre_mouvements WHERE id = r.coffre_mouvement_id; END IF;
  SELECT o_mvt, o_coffre INTO v_mvt, v_coffre FROM tresorerie_depense_direction_sortie(
    p_source, p_compte_id, v_date_sortie, p_montant, p_libelle, p_photo_url, p_user_id, p_user_nom);

  UPDATE tresorerie_depenses_direction SET
    date = p_date, categorie = p_categorie, restaurant_id = p_restaurant_id, montant = p_montant,
    source = p_source, compte_id = CASE WHEN p_source = 'compte' THEN p_compte_id END,
    mouvement_id = v_mvt, coffre_mouvement_id = v_coffre, note = p_note, photo_url = p_photo_url
  WHERE id = p_id;
END $$;

-- ── Répartir un fond en espèces + nature (même total) ────────────────
-- Rend la variation des espèces données au restaurant (+ ajouté au FC reçu,
-- − retiré), datée de p_date_jour.
CREATE OR REPLACE FUNCTION tresorerie_depense_direction_repartir(
  p_id uuid, p_especes bigint, p_date_jour date, p_user_id text, p_user_nom text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  r tresorerie_depenses_direction;
  v_nature bigint;
  v_delta bigint;
  v_libelle text;
  v_mvt uuid;
  v_coffre uuid;
BEGIN
  SELECT * INTO r FROM tresorerie_depenses_direction WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable (déjà supprimée ?)'; END IF;
  IF r.categorie NOT IN ('fond', 'fond_nature') OR r.restaurant_id IS NULL OR r.origine_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seul un fond donné à un restaurant se répartit.';
  END IF;
  IF p_especes IS NULL OR p_especes < 0 OR p_especes > r.montant THEN
    RAISE EXCEPTION 'La part en espèces doit être entre 0 et %.', r.montant;
  END IF;
  IF EXISTS (SELECT 1 FROM tresorerie_depenses_direction WHERE origine_id = p_id) THEN
    RAISE EXCEPTION 'Ce fond a déjà été réparti une fois.';
  END IF;

  v_nature := r.montant - p_especes;
  v_delta := p_especes - CASE WHEN r.categorie = 'fond' THEN r.montant ELSE 0 END;
  IF v_delta = 0 THEN RAISE EXCEPTION 'Rien à changer : c''est déjà la bonne répartition.'; END IF;
  v_libelle := 'Correction du fond du ' || to_char(r.date, 'DD/MM/YYYY');

  -- Déjà compté dans un point : la ligne ne bouge pas, on ajoute les corrections.
  IF r.point_id IS NOT NULL THEN
    INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, montant, source, compte_id, note,
      origine_id, cree_par, cree_par_nom)
    VALUES (r.date, 'fond_nature', r.restaurant_id, v_nature, r.source, r.compte_id, v_libelle, r.id, p_user_id, p_user_nom);
    INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, montant, source, compte_id, note,
      origine_id, cree_par, cree_par_nom)
    VALUES (p_date_jour, 'fond', r.restaurant_id, v_delta, r.source, r.compte_id, v_libelle, r.id, p_user_id, p_user_nom);
    RETURN v_delta;
  END IF;

  -- Tout en espèces : la ligne passe en Fond espèces, datée du jour.
  IF v_nature = 0 THEN
    UPDATE tresorerie_depenses_direction SET categorie = 'fond', date = p_date_jour WHERE id = p_id;
    RETURN v_delta;
  END IF;
  -- Tout en nature : la ligne garde sa date.
  IF p_especes = 0 THEN
    UPDATE tresorerie_depenses_direction SET categorie = 'fond_nature' WHERE id = p_id;
    RETURN v_delta;
  END IF;

  -- Les deux : la ligne d'origine garde la nature, une nouvelle ligne les espèces.
  SELECT o_mvt, o_coffre INTO v_mvt, v_coffre FROM tresorerie_depense_direction_sortie(
    r.source, r.compte_id, tresorerie_depense_direction_date_sortie(r), p_especes,
    'Fond espèces · ' || v_libelle, r.photo_url, p_user_id, p_user_nom);
  INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, montant, source, compte_id, mouvement_id,
    coffre_mouvement_id, note, photo_url, cree_par, cree_par_nom)
  VALUES (p_date_jour, 'fond', r.restaurant_id, p_especes, r.source, r.compte_id, v_mvt, v_coffre,
    v_libelle, r.photo_url, p_user_id, p_user_nom);

  UPDATE tresorerie_depenses_direction SET categorie = 'fond_nature', montant = v_nature WHERE id = p_id;
  IF r.mouvement_id IS NOT NULL THEN UPDATE tresorerie_mouvements SET montant = -v_nature WHERE id = r.mouvement_id; END IF;
  IF r.coffre_mouvement_id IS NOT NULL THEN UPDATE tresorerie_coffre_mouvements SET montant = -v_nature WHERE id = r.coffre_mouvement_id; END IF;
  RETURN v_delta;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_depense_direction_modifier(uuid, date, date, text, uuid, bigint, text, uuid, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_depense_direction_repartir(uuid, bigint, date, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
