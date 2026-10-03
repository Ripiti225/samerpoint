-- =====================================================================
--  TRÉSORERIE → COTISATIONS DES RESTAURANTS
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Un restaurant met de côté, jour après jour dans son point, une part de ses
--  salaires, CNPS, impôts… (fournisseurs « Cotisation salaire », « CNPS »,
--  « IMPÔT ET TIMBRE »…). Quand il remet cet argent au RH, le RH note la
--  « cotisation reçue » sur la charge (Trésorerie → À payer) :
--    1. l'argent entre dans le compte Espèces (mouvement de type 'cotisation') ;
--    2. le solde de la cotisation du restaurant baisse d'autant
--       (transaction fournisseur, comme « Remettre à 0 ») ;
--    3. la charge reste à payer en entier ;
--    4. le résultat net du restaurant ne déduit plus que le reste.
--  Annuler une cotisation reçue défait les trois écritures.
--  Proposition validée : https://claude.ai/artifact/FFuRnz1nBbvPDuNy1u4wbm
-- =====================================================================

CREATE TABLE IF NOT EXISTS tresorerie_cotisations_recues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  du_id uuid NOT NULL REFERENCES tresorerie_dus(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES restaurants(id),
  fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE SET NULL,
  montant bigint NOT NULL CHECK (montant > 0),
  date date NOT NULL DEFAULT current_date,
  mouvement_id uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES transactions_fournisseurs(id) ON DELETE SET NULL,
  note text,
  cree_par text,
  cree_par_nom text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treso_cotis_du ON tresorerie_cotisations_recues (du_id);
CREATE INDEX IF NOT EXISTS idx_treso_cotis_resto ON tresorerie_cotisations_recues (restaurant_id, date);

ALTER TABLE tresorerie_cotisations_recues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON tresorerie_cotisations_recues;
CREATE POLICY allow_all ON tresorerie_cotisations_recues FOR ALL TO public USING (true) WITH CHECK (true);

-- Nouveau type de mouvement : l'argent cotisé remis au RH, entré en Espèces.
ALTER TABLE tresorerie_mouvements DROP CONSTRAINT IF EXISTS tresorerie_mouvements_type_check;
ALTER TABLE tresorerie_mouvements ADD CONSTRAINT tresorerie_mouvements_type_check
  CHECK (type IN ('recalage','recu_banque','paiement','partenaire','coffre','direction','especes','virement','pret','autre','cotisation'));

-- ITS et TEE ont désormais leur propre cotisation dans chaque restaurant,
-- séparée d'« IMPÔT ET TIMBRE ». Créées à 0, seulement là où elles manquent.
INSERT INTO fournisseurs (restaurant_id, nom, actif, credit_actuel)
SELECT r.id, c.nom, true, 0
FROM restaurants r
CROSS JOIN (VALUES ('ITS'), ('TEE')) AS c(nom)
WHERE NOT EXISTS (
  SELECT 1 FROM fournisseurs f WHERE f.restaurant_id = r.id AND upper(trim(f.nom)) = c.nom
);

-- Vérification : une ligne ITS et une ligne TEE par restaurant.
-- SELECT r.nom, f.nom, f.credit_actuel FROM fournisseurs f JOIN restaurants r ON r.id = f.restaurant_id
--  WHERE upper(trim(f.nom)) IN ('ITS', 'TEE') ORDER BY 1, 2;
