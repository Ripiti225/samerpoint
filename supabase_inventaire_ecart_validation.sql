-- =====================================================================
--  Inventaire → validation manager des écarts EXPLIQUÉS
--
--  Un écart avec explication (nombre + texte du caissier) n'est plus
--  déduit automatiquement : il passe « en_attente » et le manager décide
--  dans Vérification inventaire (quantité acceptée → déduction recalculée).
--
--  explication_statut : NULL (écart sans explication, déduction directe)
--                       | 'en_attente' | 'validee' | 'refusee'
--  quantite_acceptee  : quantité justifiée validée par le manager
--
--  Idempotent — rejouable sans risque.
-- =====================================================================

ALTER TABLE inventaire_lignes
  ADD COLUMN IF NOT EXISTS explication_statut       text,
  ADD COLUMN IF NOT EXISTS quantite_acceptee        numeric,
  ADD COLUMN IF NOT EXISTS explication_decidee_par  text,
  ADD COLUMN IF NOT EXISTS explication_decidee_at   timestamptz;

-- ── Vérif ────────────────────────────────────────────────────────────
SELECT explication_statut, count(*) AS nb
FROM inventaire_lignes
GROUP BY explication_statut;
