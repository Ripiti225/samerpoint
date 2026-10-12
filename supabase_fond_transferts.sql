-- =====================================================================
--  FOND DE CAISSE NÉGATIF → REMIS À 0 (en tout ou en partie)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Le trou du fond part :
--   - en DETTE ADMINISTRATION : une dette de la Trésorerie (l'administration
--     doit cette somme au restaurant) ;
--   - chez le fournisseur « REPORT CAISSE » du restaurant (créé au premier
--     transfert) : une facture sans journée, son crédit monte d'autant.
--  Le fond remonte via points.ajustement_fond du dernier point validé
--  (même mécanique que les régularisations d'écart). reste_fc n'est jamais
--  touché.
--  Spéc : docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md
-- =====================================================================

do $$
begin
  if to_regclass('public.transactions_fournisseurs') is null or to_regclass('public.tresorerie_dus') is null then
    raise exception 'Mauvais projet Supabase : tables introuvables. Ce script est destiné à Samtrackly (wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

CREATE TABLE IF NOT EXISTS transferts_fond (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants(id),
  date            date NOT NULL DEFAULT current_date,
  montant         bigint NOT NULL CHECK (montant > 0),
  destination     text NOT NULL CHECK (destination IN ('dette_admin','report_caisse')),
  fond_avant      numeric NOT NULL,
  fond_point_id   uuid REFERENCES points(id) ON DELETE SET NULL,
  du_id           uuid REFERENCES tresorerie_dus(id) ON DELETE SET NULL,
  fournisseur_id  uuid REFERENCES fournisseurs(id) ON DELETE SET NULL,
  transaction_id  uuid REFERENCES transactions_fournisseurs(id) ON DELETE SET NULL,
  note            text,
  cree_par        text,
  cree_par_nom    text,
  annule_le       timestamptz,
  annule_par_nom  text,
  annule_point_id uuid REFERENCES points(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transferts_fond_resto ON transferts_fond (restaurant_id, created_at DESC);

ALTER TABLE transferts_fond ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON transferts_fond;
CREATE POLICY allow_all ON transferts_fond FOR ALL TO public USING (true) WITH CHECK (true);

-- ── Transfert ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transferer_fond_negatif(
  p_restaurant uuid, p_montant bigint, p_destination text, p_note text,
  p_user_id text, p_user_nom text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  pt     record;
  v_fond numeric;
  v_nom  text;
  v_du   uuid;
  v_four uuid;
  v_tx   uuid;
  v_id   uuid;
BEGIN
  IF p_destination NOT IN ('dette_admin','report_caisse') THEN
    RAISE EXCEPTION 'Choisissez où transférer : dette administration ou Report caisse.';
  END IF;
  IF coalesce(p_montant, 0) <= 0 THEN
    RAISE EXCEPTION 'Saisissez un montant supérieur à 0.';
  END IF;

  SELECT id, date, reste_fc, ajustement_fond INTO pt
    FROM points
   WHERE restaurant_id = p_restaurant AND valide
   ORDER BY date DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune journée validée pour ce restaurant.'; END IF;

  v_fond := coalesce(pt.reste_fc, 0) + coalesce(pt.ajustement_fond, 0);
  IF v_fond >= 0 THEN RAISE EXCEPTION 'Le fond de ce restaurant n''est pas négatif.'; END IF;
  IF p_montant > ceil(-v_fond) THEN
    RAISE EXCEPTION 'Le montant dépasse le fond négatif (% F maximum).',
      replace(to_char(ceil(-v_fond), 'FM999,999,999,999'), ',', ' ');
  END IF;

  SELECT trim(nom) INTO v_nom FROM restaurants WHERE id = p_restaurant;

  IF p_destination = 'dette_admin' THEN
    INSERT INTO tresorerie_dus (categorie, restaurant_id, libelle, creancier, montant_du, note, cree_par, cree_par_nom)
    VALUES ('dette', p_restaurant, 'Fond négatif repris par l''administration',
            'Fond de caisse – ' || coalesce(v_nom, 'restaurant'), p_montant, nullif(trim(p_note), ''),
            p_user_id, p_user_nom)
    RETURNING id INTO v_du;
  ELSE
    SELECT id INTO v_four FROM fournisseurs
     WHERE restaurant_id = p_restaurant AND lower(trim(nom)) = 'report caisse'
     ORDER BY created_at
     LIMIT 1;
    IF v_four IS NULL THEN
      INSERT INTO fournisseurs (nom, type, restaurant_id, actif)
      VALUES ('Report caisse', 'fournisseur', p_restaurant, true)
      RETURNING id INTO v_four;
      INSERT INTO fournisseurs_restaurants (fournisseur_id, restaurant_id, credit_actuel)
      VALUES (v_four, p_restaurant, 0)
      ON CONFLICT (fournisseur_id, restaurant_id) DO NOTHING;
    ELSE
      UPDATE fournisseurs SET actif = true WHERE id = v_four AND actif IS NOT TRUE;
    END IF;
    v_tx := inserer_transaction_hors_point(v_four, current_date, p_montant, 0, 'manager', 'report_caisse', p_user_nom);
  END IF;

  UPDATE points SET ajustement_fond = coalesce(ajustement_fond, 0) + p_montant WHERE id = pt.id;

  INSERT INTO transferts_fond (restaurant_id, montant, destination, fond_avant, fond_point_id,
                               du_id, fournisseur_id, transaction_id, note, cree_par, cree_par_nom)
  VALUES (p_restaurant, p_montant, p_destination, v_fond, pt.id,
          v_du, v_four, v_tx, nullif(trim(p_note), ''), p_user_id, p_user_nom)
  RETURNING id INTO v_id;

  INSERT INTO journal_activite (action, details, restaurant_id, point_id, user_id, user_nom)
  VALUES ('fond_transfert',
          jsonb_build_object('transfert_id', v_id, 'montant', p_montant, 'destination', p_destination,
                             'fond_avant', v_fond, 'fond_apres', v_fond + p_montant, 'note', p_note),
          p_restaurant, pt.id, p_user_id, p_user_nom);

  RETURN v_id;
END;
$$;

-- ── Annulation ─────────────────────────────────────────────────────────────
-- Le −montant va sur le dernier point validé AU MOMENT DE L'ANNULATION : si des
-- journées ont été validées depuis, le +montant est déjà passé dans leur FC de
-- la veille ; le retirer sur l'ancien point ne changerait plus le fond.
CREATE OR REPLACE FUNCTION annuler_transfert_fond(p_transfert uuid, p_user_id text, p_user_nom text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  tr record;
  pt record;
BEGIN
  SELECT * INTO tr FROM transferts_fond WHERE id = p_transfert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable.'; END IF;
  IF tr.annule_le IS NOT NULL THEN RAISE EXCEPTION 'Ce transfert est déjà annulé.'; END IF;

  SELECT id INTO pt
    FROM points
   WHERE restaurant_id = tr.restaurant_id AND valide
   ORDER BY date DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune journée validée pour ce restaurant.'; END IF;

  IF tr.destination = 'dette_admin' THEN
    IF tr.du_id IS NOT NULL AND EXISTS (SELECT 1 FROM tresorerie_paiements WHERE du_id = tr.du_id) THEN
      RAISE EXCEPTION 'Cette dette est déjà en partie remboursée : le transfert ne peut plus être annulé.';
    END IF;
    IF tr.du_id IS NOT NULL THEN DELETE FROM tresorerie_dus WHERE id = tr.du_id; END IF;
  ELSIF tr.fournisseur_id IS NOT NULL THEN
    PERFORM inserer_transaction_hors_point(tr.fournisseur_id, current_date, 0, tr.montant,
                                           'manager', 'report_caisse_annule', p_user_nom);
  END IF;

  UPDATE points SET ajustement_fond = coalesce(ajustement_fond, 0) - tr.montant WHERE id = pt.id;

  UPDATE transferts_fond
     SET annule_le = now(), annule_par_nom = p_user_nom, annule_point_id = pt.id
   WHERE id = tr.id;

  INSERT INTO journal_activite (action, details, restaurant_id, point_id, user_id, user_nom)
  VALUES ('fond_transfert_annule',
          jsonb_build_object('transfert_id', tr.id, 'montant', tr.montant, 'destination', tr.destination),
          tr.restaurant_id, pt.id, p_user_id, p_user_nom);
END;
$$;
