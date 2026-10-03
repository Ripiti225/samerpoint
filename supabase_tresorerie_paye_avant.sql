-- =====================================================================
--  TRÉSORERIE — paiement « avant la trésorerie ».
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Une charge déjà payée avant la mise en place de la trésorerie (ex. loyer
--  d'août payé en septembre) doit compter dans le résultat net sans créer de
--  dette ni de mouvement en banque : on la solde par un paiement de source
--  « avant » (tresorerie_payer ne crée un mouvement que pour « compte »).
-- =====================================================================

ALTER TABLE tresorerie_paiements DROP CONSTRAINT IF EXISTS tresorerie_paiements_source_check;
ALTER TABLE tresorerie_paiements ADD CONSTRAINT tresorerie_paiements_source_check
  CHECK (source IN ('compte','especes','avant'));
