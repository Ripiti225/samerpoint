-- ════════════════════════════════════════════════════════════════════════════
--  « Payé en points » — achats réglés avec les points fidélité au POS
--
--  À lancer dans SAMTRACKLY (pas le cloud POS). Rejouable sans risque.
--  À PASSER AVANT de déployer l'app et le pont POS qui écrivent cette colonne :
--  sinon l'enregistrement d'un shift ou d'un point échoue (colonne inconnue).
--
--  POURQUOI
--  Depuis le 2026-10-15, un client peut régler TOUT son ticket avec ses points
--  fidélité au POS. Aucun argent n'entre : le montant compte dans la vente du
--  shift (sinon le point afficherait un faux écart avec la vente machine), mais
--  jamais dans les espèces ni dans la trésorerie. Exactement comme le KDO.
--
--  Formule de la vente d'un shift, désormais :
--    vente = dépenses + paies + kdo + points_fidelite + yango + glovo
--          + wave + djamo + om + espèces
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS points_fidelite NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.points_shifts.points_fidelite IS
  'Achats réglés avec les points fidélité au POS (rapport_z.paye_points.total). '
  'Dans la vente du shift, hors espèces et hors trésorerie, comme le KDO.';

ALTER TABLE public.points
  ADD COLUMN IF NOT EXISTS points_fidelite NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.points.points_fidelite IS
  'Somme des points_shifts.points_fidelite de la journée. Déduit du reste '
  'espèces comme le KDO ; n''entre pas dans le bénéfice.';


-- ── Vérification ────────────────────────────────────────────────────────────
--
-- Après le premier shift POS contenant un paiement en points :
--
--   SELECT date, caissier_nom, vente_shift, vente_systeme_pos, kdo, points_fidelite
--     FROM points_shifts
--    WHERE points_fidelite > 0
--    ORDER BY created_at DESC LIMIT 10;
--
-- `vente_shift` et `vente_systeme_pos` doivent rester alignés : sans la
-- colonne, le shift aurait manqué exactement du montant payé en points.
