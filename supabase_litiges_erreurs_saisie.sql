-- Litiges Yango / Glovo automatiques : erreurs de saisie signalées (11/10/2026).
-- Un plat en moins et un plat en trop sur la même commande = le caissier a tapé
-- le mauvais plat : aucun litige, seulement signalé à l'écran Litiges.
-- [{ commande, heure, vendu, prix_vendu, tape, prix_tape, caissier_id, caissier_nom }]
ALTER TABLE journees_litiges_plateformes
  ADD COLUMN IF NOT EXISTS erreurs_saisie JSONB NOT NULL DEFAULT '[]'::jsonb;
