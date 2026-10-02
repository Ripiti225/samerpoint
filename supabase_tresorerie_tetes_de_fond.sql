-- =====================================================================
--  TRÉSORERIE — têtes de fond OM, Wave, Djamo.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS
--  supabase_tresorerie_partenaires.sql et supabase_tresorerie_especes.sql.
--  Idempotent. Montants en FCFA entiers.
--
--  L'argent de chaque restaurant arrive sur la tête de fond du partenaire.
--  « Marquer reçu » note le reçu de chaque restaurant (il peut dépasser
--  l'attendu) ; leur total entre sur la tête de fond en UN mouvement. Un
--  virement (Banque et espèces) l'envoie ensuite vers BACI ou SIB.
-- =====================================================================

-- ── Les trois comptes ────────────────────────────────────────────────
INSERT INTO tresorerie_comptes (nom, ordre) VALUES
  ('Tête de fond OM', 4), ('Tête de fond Wave', 5), ('Tête de fond Djamo', 6)
ON CONFLICT (nom) DO NOTHING;

-- ── Nouveau mode de versement ────────────────────────────────────────
ALTER TABLE tresorerie_partenaires DROP CONSTRAINT IF EXISTS tresorerie_partenaires_mode_versement_check;
ALTER TABLE tresorerie_partenaires ADD CONSTRAINT tresorerie_partenaires_mode_versement_check
  CHECK (mode_versement IN ('groupe','restaurant','tete_de_fond'));

-- Aucune réception OM / Wave / Djamo n'était encore saisie au 02/10/2026.
UPDATE tresorerie_partenaires SET mode_versement = 'tete_de_fond', updated_at = now()
WHERE partenaire IN ('om','wave','djamo') AND mode_versement = 'groupe';

-- ── Réception détaillée : une ligne « reçu » par restaurant, un mouvement ──
-- p_parts : [{"restaurant_id": "...", "montant": 1200}, ...]
CREATE OR REPLACE FUNCTION tresorerie_recevoir_detaille(
  p_partenaire text, p_debut date, p_parts jsonb, p_compte_id uuid, p_date date,
  p_libelle text, p_note text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_total bigint;
  v_mvt   uuid;
BEGIN
  SELECT coalesce(sum((x->>'montant')::bigint), 0) INTO v_total
  FROM jsonb_array_elements(p_parts) x WHERE (x->>'montant')::bigint > 0;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Montant reçu manquant'; END IF;

  INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
  VALUES (p_compte_id, p_date, v_total, 'partenaire', p_libelle, p_user_id, p_user_nom)
  RETURNING id INTO v_mvt;

  INSERT INTO tresorerie_partenaire_lignes (partenaire, periode_debut, restaurant_id, type, montant, compte_id, date,
    mouvement_id, note, cree_par, cree_par_nom)
  SELECT p_partenaire, p_debut, (x->>'restaurant_id')::uuid, 'recu', (x->>'montant')::bigint, p_compte_id, p_date,
    v_mvt, p_note, p_user_id, p_user_nom
  FROM jsonb_array_elements(p_parts) x WHERE (x->>'montant')::bigint > 0;

  RETURN v_mvt;
END $$;

-- Annuler une réception : toute la réception (les lignes qui partagent son
-- mouvement) et l'entrée sur le compte.
CREATE OR REPLACE FUNCTION tresorerie_annuler_reception(p_ligne uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
BEGIN
  SELECT mouvement_id INTO v_mvt FROM tresorerie_partenaire_lignes WHERE id = p_ligne AND type = 'recu';
  DELETE FROM tresorerie_partenaire_lignes
  WHERE type = 'recu' AND (id = p_ligne OR (v_mvt IS NOT NULL AND mouvement_id = v_mvt));
  IF v_mvt IS NOT NULL THEN
    DELETE FROM tresorerie_mouvements WHERE id = v_mvt;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_recevoir_detaille(text, date, jsonb, uuid, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_reception(uuid) TO anon, authenticated;
