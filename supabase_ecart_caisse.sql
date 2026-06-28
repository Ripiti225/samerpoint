-- Écart de caisse (vente machine vs shifts déclarés) — colonnes sur points
-- Utilisé par app/ventes.js (saisie gérant) et app/litiges.js (régularisation manager)

-- Responsables imputés d'un manquant/surplus : [{ travailleur_id, nom, role, montant }]
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_responsables JSONB;

-- Photos justificatives de l'écart : ["url1", "url2", ...]
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_photos JSONB;

-- Régularisations d'écart par le manager (annulation/réduction avec preuve) :
-- [{ sens, montant, motif, photos:[...], par_id, par_nom, created_at }]
ALTER TABLE points ADD COLUMN IF NOT EXISTS ecart_regularisations JSONB;
