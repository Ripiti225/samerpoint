-- Index manquant sur inventaire_lignes.inventaire_id
--
-- Depuis l'import de l'historique Sheets (19/10/2026), inventaire_lignes compte
-- ~130 000 lignes. Sans index, chaque inventaire cherche ses lignes en lisant
-- toute la table : la requête de l'écran Vérificateur (dernier inventaire validé
-- + ses lignes) dépasse le délai de 3 s de la clé anon, l'app reçoit une erreur
-- et affiche « Aucun stock enregistré » (7 restaurants sur 8 le 22/10).
--
-- Ajout pur : aucune donnée modifiée. Quelques secondes à l'exécution.

CREATE INDEX IF NOT EXISTS idx_inventaire_lignes_inventaire_id
  ON public.inventaire_lignes (inventaire_id);

ANALYZE public.inventaire_lignes;
