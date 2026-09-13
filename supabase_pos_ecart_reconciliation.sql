-- Écart global officiel d'une clôture POS.
--
-- Le pont POS doit copier `rapport_z.diff` TEL QUEL dans cette colonne lors de
-- l'upsert de `points_shifts`. Samtrackly ne recalcule pas ce montant et ne le
-- remplace jamais par `ecart_pos` (`services_caisse.ecart`, tiroir espèces).

ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS ecart_reconciliation BIGINT;

COMMENT ON COLUMN public.points_shifts.ecart_reconciliation IS
  'Copie exacte de rapport_z.diff (vente_totale - total_systeme), en FCFA. '
  'NULL = rapport Z historique indisponible. Ne jamais recalculer ni remplacer '
  'par ecart_pos, qui est uniquement l''écart espèces du tiroir.';
