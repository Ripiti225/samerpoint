-- Montant alloué (accordé) à la validation d'une demande financière par le
-- manager/RH. Saisi dans app/demandes-admin.js, affiché côté admin et travailleur.
ALTER TABLE demandes ADD COLUMN IF NOT EXISTS montant_alloue NUMERIC;
