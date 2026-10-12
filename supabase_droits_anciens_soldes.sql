-- =====================================================================
--  Droits des anciens travailleurs : archivés dès qu'ils sont soldés — 12/10/2026
--  Projet Samtrackly (wlwotzxnzowbkbfcpnyi). Idempotente : se repasse sans risque.
--  À passer APRÈS supabase_droits_anciens_travailleurs.sql.
--
--  Quand le reste dû (credit_actuel) d'un ancien travailleur tombe à 0 — payé
--  par le gérant, par la direction ou corrigé —, sa fiche est désactivée toute
--  seule : elle disparaît de Crédits fournisseurs et des Déductions gérant, et
--  ne se retrouve que dans Trésorerie → À payer → Anciens travailleurs (soldés).
--  Si une correction fait remonter le reste, la fiche se réactive.
--  Tous les paiements passent par credit_actuel (inserer_transaction_hors_point,
--  Déductions gérant, point du caissier) : le déclencheur les voit tous.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'fournisseurs' and column_name = 'depart_le') then
    raise exception 'Passez d''abord supabase_droits_anciens_travailleurs.sql.';
  end if;
end $$;

CREATE OR REPLACE FUNCTION fournisseurs_droit_solde()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.depart_le IS NOT NULL AND NEW.credit_actuel IS DISTINCT FROM OLD.credit_actuel THEN
    NEW.actif := coalesce(NEW.credit_actuel, 0) > 0;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fournisseurs_droit_solde ON fournisseurs;
CREATE TRIGGER trg_fournisseurs_droit_solde
  BEFORE UPDATE OF credit_actuel ON fournisseurs
  FOR EACH ROW EXECUTE FUNCTION fournisseurs_droit_solde();

-- Rattrapage : les droits déjà soldés sont archivés, ceux qui doivent encore restent actifs.
UPDATE fournisseurs SET actif = (coalesce(credit_actuel, 0) > 0)
 WHERE depart_le IS NOT NULL AND actif IS DISTINCT FROM (coalesce(credit_actuel, 0) > 0);

NOTIFY pgrst, 'reload schema';

-- Contrôle : droits et leur état.
SELECT f.nom, r.nom AS resto, f.credit_actuel, f.actif
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.depart_le IS NOT NULL
 ORDER BY f.actif DESC, r.nom, f.nom;
