-- =====================================================================
--  Droits des anciens travailleurs — 12/10/2026
--  Projet Samtrackly (wlwotzxnzowbkbfcpnyi). Idempotente : se repasse sans risque.
--
--  Une fiche par travailleur parti = un fournisseur administratif sans
--  échéance, marqué par sa date de départ (depart_le). Le montant dû est une
--  écriture « ajustement_manager » ; le gérant paie en caisse, la direction
--  avec tresorerie_payer_fournisseur_admin(). On peut prévoir un paiement
--  (tresorerie_previsions.fournisseur_id), comme sur une dette.
--  Spéc : docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'fournisseurs' and column_name = 'administratif_depuis') then
    raise exception 'Passez d''abord supabase_fournisseurs_administratifs.sql.';
  end if;
end $$;

ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS depart_le date;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS depart_motif text;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS travailleur_id uuid REFERENCES travailleurs(id) ON DELETE SET NULL;

-- Un droit d'ancien travailleur est toujours administratif.
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_depart_administratif_check
    CHECK (depart_le IS NULL OR type = 'administratif');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS fournisseurs_droits_anciens_idx
  ON fournisseurs (restaurant_id) WHERE depart_le IS NOT NULL;

-- Prévisions : une prévision porte soit sur un dû de la Trésorerie, soit sur
-- un droit d'ancien travailleur (fournisseur). Réalisée par tout paiement du
-- droit fait à partir de ce jour-là (calcul côté app, lib/droitsAnciensTravailleurs.js).
do $$
begin
  if to_regclass('public.tresorerie_previsions') is null then
    raise notice 'tresorerie_previsions absente : prévisions des droits ignorées.';
    return;
  end if;
  ALTER TABLE tresorerie_previsions ALTER COLUMN du_id DROP NOT NULL;
  ALTER TABLE tresorerie_previsions ADD COLUMN IF NOT EXISTS fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE CASCADE;
  BEGIN
    ALTER TABLE tresorerie_previsions ADD CONSTRAINT prevision_une_ligne
      CHECK ((du_id IS NULL) <> (fournisseur_id IS NULL));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  CREATE INDEX IF NOT EXISTS idx_treso_prev_fournisseur ON tresorerie_previsions (fournisseur_id) WHERE fournisseur_id IS NOT NULL;
end $$;

NOTIFY pgrst, 'reload schema';

-- Contrôle : droits enregistrés.
SELECT f.nom, r.nom AS resto, f.depart_le, f.depart_motif, f.credit_actuel
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.depart_le IS NOT NULL
 ORDER BY r.nom, f.depart_le DESC;
