-- Index de performance sur les colonnes les plus filtrées par l'app (05/11/2026)
--
-- Sans eux, la base relit toute la table : charger les dépenses d'un point lisait
-- 59 153 lignes pour en garder 6 (1,1 s). Sur une clé anon limitée à 3 s, cela peut
-- finir en écran vide (voir supabase_index_inventaire_lignes.sql).
--
-- Ajout pur : aucune donnée modifiée. CONCURRENTLY évite de bloquer les saisies,
-- mais interdit toute transaction : lancer chaque ligne séparément.
-- Annulation : DROP INDEX CONCURRENTLY public.<nom_de_l_index>;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depenses_point ON public.depenses (point_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depenses_gerant_caisse_point ON public.depenses_gerant_caisse (point_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_fournisseurs_point ON public.transactions_fournisseurs (point_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_points_shifts_point ON public.points_shifts (point_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_points_shifts_resto_date ON public.points_shifts (restaurant_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commandes_point ON public.commandes (point_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_historique_credit_fournisseur ON public.historique_credit_fournisseurs (fournisseur_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_historique_credit_resto ON public.historique_credit_fournisseurs (restaurant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entrees_shift_inventaire ON public.entrees_shift (inventaire_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventaires_point ON public.inventaires (point_id);
