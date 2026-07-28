-- =====================================================================
--  CORRECTION DE FACTURE FOURNISSEUR (écran Vérification)
--
--  Le manager/directeur peut corriger le montant « facture » d'une
--  transaction fournisseur quand il ne correspond pas à la photo.
--  On conserve le montant d'origine + qui/quand/raison (badge + audit).
--  Sans impact sur le fond (seul « payé » sort de la caisse) ; le solde
--  du fournisseur (reste dû) est recalculé côté app.
--
--  Idempotent — rejouable sans risque.
-- =====================================================================

ALTER TABLE transactions_fournisseurs
  ADD COLUMN IF NOT EXISTS facture_original          numeric,
  ADD COLUMN IF NOT EXISTS facture_corrigee_par       uuid,
  ADD COLUMN IF NOT EXISTS facture_corrigee_par_nom   text,
  ADD COLUMN IF NOT EXISTS facture_corrigee_at        timestamptz,
  ADD COLUMN IF NOT EXISTS facture_correction_raison  text;

-- ── Vérif ─────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE facture_corrigee_at IS NOT NULL) AS factures_corrigees
FROM transactions_fournisseurs;
