-- =====================================================================
--  FOURNISSEURS ADMINISTRATIFS (TEE, ITS, Timbre, CNPS, bail, mairie…)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  • fournisseurs.type accepte « administratif » (colonne texte sans contrainte).
--  • La facture automatique devient mensuelle OU annuelle : facture_periodicite.
--    Annuelle = le mois de facture_mensuelle_depuis, puis tous les 12 mois.
--  • administratif_depuis : 1er du mois où la fiche est devenue administrative
--    (posé par trigger). Le résultat net ne compte un administratif qu'à partir
--    de ce mois : les mois passés ne bougent pas.
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
NOTIFY pgrst, 'reload schema';

-- Contrôle : fournisseurs administratifs.
SELECT f.nom, r.nom AS resto, f.facture_mensuelle, f.facture_periodicite, f.facture_mensuelle_depuis,
       f.administratif_depuis, f.credit_actuel
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.type = 'administratif'
 ORDER BY r.nom, f.nom;
