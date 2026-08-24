-- =====================================================================
--  Litiges → Avis clients : canal du client à l'origine de l'avis
--  Valeurs : 'sur_place' | 'yango' | 'glovo'  (défaut : 'sur_place')
--  Idempotent — rejouable sans risque.
-- =====================================================================

ALTER TABLE litiges_avis_clients
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'sur_place';

-- ── Vérif ────────────────────────────────────────────────────────────
SELECT canal, count(*) AS nb
FROM litiges_avis_clients
GROUP BY canal
ORDER BY nb DESC;
