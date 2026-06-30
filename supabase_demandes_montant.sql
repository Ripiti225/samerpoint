-- Montant demandé pour les demandes financières (Aide financière, Avance sur
-- salaire, Demande d'augmentation). Saisi dans app/demandes.js, affiché côté
-- travailleur (demandes.js) et admin (demandes-admin.js).
ALTER TABLE demandes ADD COLUMN IF NOT EXISTS montant NUMERIC;
