-- =====================================================================
--  FOURNISSEURS ADMINISTRATIFS (TEE, ITS, Timbre, CNPS, bail, mairie…)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  • fournisseurs.type accepte « administratif » (colonne texte sans contrainte).
--  • La facture automatique devient mensuelle OU annuelle : facture_periodicite.
--    Annuelle = le mois de facture_mensuelle_depuis, puis tous les 12 mois.
--  • administratif_depuis : 1er du mois où la fiche est devenue administrative
--    (posé par trigger). Le résultat net écarte un administratif de la
--    variation du crédit à partir de ce mois (son montant dû n'est pas une
--    charge, seul son paiement l'est) : les mois passés ne bougent pas.
--  • Payé par la direction (banque, espèces de la trésorerie, coffre) :
--    tresorerie_payer_fournisseur_admin() crée en une fois la dépense direction
--    « administratif » (charge du restaurant dans le résultat net), sa sortie
--    et le paiement sur le crédit du fournisseur. Supprimer la dépense retire
--    aussi le paiement ; la modifier est refusé (supprimer puis ressaisir).
--  Spéc : docs/superpowers/specs/2026-10-12-fournisseurs-administratifs-design.md
-- =====================================================================

do $$
begin
  if to_regclass('public.factures_mensuelles_fournisseurs') is null then
    raise exception 'Passez d''abord supabase_factures_mensuelles.sql (projet Samtrackly wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS facture_periodicite text NOT NULL DEFAULT 'mensuel';
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_facture_periodicite_check
    CHECK (facture_periodicite IN ('mensuel', 'annuel'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS administratif_depuis date;

-- Date de bascule : posée quand la fiche devient administrative, gardée tant
-- qu'elle le reste, effacée si elle redevient un fournisseur normal.
CREATE OR REPLACE FUNCTION fournisseurs_administratif_depuis()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'administratif' THEN
    IF TG_OP = 'UPDATE' AND OLD.type = 'administratif' THEN
      NEW.administratif_depuis := coalesce(NEW.administratif_depuis, OLD.administratif_depuis,
                                           date_trunc('month', current_date)::date);
    ELSE
      NEW.administratif_depuis := date_trunc('month', current_date)::date;
    END IF;
  ELSE
    NEW.administratif_depuis := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fournisseurs_administratif_depuis ON fournisseurs;
CREATE TRIGGER trg_fournisseurs_administratif_depuis
  BEFORE INSERT OR UPDATE OF type, administratif_depuis ON fournisseurs
  FOR EACH ROW EXECUTE FUNCTION fournisseurs_administratif_depuis();

-- Facture automatique : mensuelle ou annuelle (même table de marques, unique par mois).
CREATE OR REPLACE FUNCTION appliquer_factures_mensuelles()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  f record;
  m date;
  marque uuid;
  tx uuid;
  nb integer := 0;
BEGIN
  FOR f IN
    SELECT id, nom, restaurant_id, facture_mensuelle AS montant,
           CASE WHEN facture_periodicite = 'annuel' THEN 12 ELSE 1 END AS pas,
           date_trunc('month', coalesce(facture_mensuelle_depuis, current_date))::date AS depuis
      FROM fournisseurs
     WHERE facture_mensuelle > 0 AND coalesce(actif, true)
     ORDER BY id
     FOR UPDATE                       -- deux appels simultanés : le second attend
  LOOP
    m := f.depuis;
    WHILE m <= date_trunc('month', current_date)::date LOOP
      INSERT INTO factures_mensuelles_fournisseurs (fournisseur_id, mois, montant)
      VALUES (f.id, m, f.montant)
      ON CONFLICT (fournisseur_id, mois) DO NOTHING
      RETURNING id INTO marque;

      IF marque IS NOT NULL THEN
        tx := inserer_transaction_hors_point(f.id, m, f.montant, 0, 'mensuel', 'facture_mensuelle');
        UPDATE factures_mensuelles_fournisseurs SET transaction_id = tx WHERE id = marque;
        INSERT INTO journal_activite (action, details, restaurant_id, user_nom)
        VALUES ('facture_mensuelle_fournisseur',
                jsonb_build_object('fournisseur', f.nom, 'mois', to_char(m, 'YYYY-MM'), 'montant', f.montant,
                                   'periodicite', CASE WHEN f.pas = 12 THEN 'annuel' ELSE 'mensuel' END),
                f.restaurant_id, 'Facture automatique');
        nb := nb + 1;
      END IF;

      m := (m + make_interval(months => f.pas))::date;
    END LOOP;
  END LOOP;
  RETURN nb;
END;
$$;

GRANT EXECUTE ON FUNCTION appliquer_factures_mensuelles() TO anon, authenticated;

-- ── Payé par la direction ───────────────────────────────────────────────────
ALTER TABLE tresorerie_depenses_direction DROP CONSTRAINT IF EXISTS tresorerie_depenses_direction_categorie_check;
ALTER TABLE tresorerie_depenses_direction ADD CONSTRAINT tresorerie_depenses_direction_categorie_check
  CHECK (categorie IN ('fond','fond_nature','reparation','materiel','equipement','investissement','retrait_perso','administratif'));
ALTER TABLE tresorerie_depenses_direction
  ADD COLUMN IF NOT EXISTS fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE SET NULL;
ALTER TABLE tresorerie_depenses_direction
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES transactions_fournisseurs(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION tresorerie_payer_fournisseur_admin(
  p_fournisseur uuid, p_date date, p_montant bigint, p_source text, p_compte_id uuid,
  p_note text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  fo record;
  v_libelle text;
  v_mvt uuid;
  v_coffre uuid;
  v_tx uuid;
  v_id uuid;
BEGIN
  SELECT id, nom, type, restaurant_id INTO fo FROM fournisseurs WHERE id = p_fournisseur;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable.'; END IF;
  IF fo.type IS DISTINCT FROM 'administratif' THEN
    RAISE EXCEPTION 'Seul un fournisseur administratif se paie depuis la direction.';
  END IF;
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF p_source = 'compte' AND p_compte_id IS NULL THEN RAISE EXCEPTION 'Choisissez le compte.'; END IF;

  v_libelle := 'Administratif · ' || fo.nom || coalesce(' · ' || nullif(trim(p_note), ''), '');
  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -p_montant, 'direction', v_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  ELSIF p_source = 'coffre' THEN
    INSERT INTO tresorerie_coffre_mouvements (date, montant, type, source, libelle, cree_par, cree_par_nom)
    VALUES (p_date, -p_montant, 'depense', 'coffre', v_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_coffre;
  END IF;

  v_tx := inserer_transaction_hors_point(fo.id, p_date, 0, p_montant, 'direction', 'paiement_direction', p_user_nom);

  INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, montant, source, compte_id, mouvement_id,
    coffre_mouvement_id, note, fournisseur_id, transaction_id, cree_par, cree_par_nom)
  VALUES (p_date, 'administratif', fo.restaurant_id, p_montant, p_source,
    CASE WHEN p_source = 'compte' THEN p_compte_id END, v_mvt, v_coffre,
    coalesce(fo.nom || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_note), fo.id, v_tx, p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Supprimer une dépense direction : sa sortie, et le paiement du fournisseur administratif.
CREATE OR REPLACE FUNCTION tresorerie_depense_direction_supprimer(p_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt uuid;
  v_coffre uuid;
  v_tx uuid;
BEGIN
  SELECT mouvement_id, coffre_mouvement_id, transaction_id INTO v_mvt, v_coffre, v_tx
    FROM tresorerie_depenses_direction WHERE id = p_id;
  DELETE FROM tresorerie_depenses_direction WHERE id = p_id;
  IF v_mvt IS NOT NULL THEN DELETE FROM tresorerie_mouvements WHERE id = v_mvt; END IF;
  IF v_coffre IS NOT NULL THEN DELETE FROM tresorerie_coffre_mouvements WHERE id = v_coffre; END IF;
  IF v_tx IS NOT NULL THEN PERFORM retirer_transaction_hors_point(v_tx); END IF;
END $$;

-- Un paiement de fournisseur administratif ne se modifie pas (son crédit suivrait mal).
CREATE OR REPLACE FUNCTION tresorerie_depense_admin_figee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.categorie = 'administratif' AND OLD.transaction_id IS NOT NULL
     AND (NEW.categorie, NEW.montant, NEW.date, NEW.restaurant_id, NEW.fournisseur_id)
         IS DISTINCT FROM (OLD.categorie, OLD.montant, OLD.date, OLD.restaurant_id, OLD.fournisseur_id) THEN
    RAISE EXCEPTION 'Paiement d''un fournisseur administratif : supprimez-le puis ressaisissez-le.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tresorerie_depense_admin_figee ON tresorerie_depenses_direction;
CREATE TRIGGER trg_tresorerie_depense_admin_figee
  BEFORE UPDATE ON tresorerie_depenses_direction
  FOR EACH ROW EXECUTE FUNCTION tresorerie_depense_admin_figee();

GRANT EXECUTE ON FUNCTION tresorerie_payer_fournisseur_admin(uuid, date, bigint, text, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_depense_direction_supprimer(uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Contrôle : fournisseurs administratifs.
SELECT f.nom, r.nom AS resto, f.facture_mensuelle, f.facture_periodicite, f.facture_mensuelle_depuis,
       f.administratif_depuis, f.credit_actuel
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.type = 'administratif'
 ORDER BY r.nom, f.nom;
