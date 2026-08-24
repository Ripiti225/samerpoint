-- =====================================================================
--  RÔLES & ACCÈS — configuration des menus par rôle (data-driven)
--
--  Objectif : piloter « quel rôle voit quelles tuiles » depuis Paramètres,
--  sans reprogrammer ni rebuild. La colonne `tuiles` est un tableau d'IDs
--  de tuiles (voir lib/menus.js → TUILES).
--
--  • Rôles configurables : rh, gerant, caissier.
--  • Manager & directeur  : accès total non configurable (pas de ligne ici).
--  • Vérificateur         : écran dédié, pas de menu d'accueil.
--
--  RLS ON + politique permissive `allow_all` (comme le reste des tables :
--  la clé anon garde un accès total — aligne, ne durcit pas).
--  Idempotent — rejouable sans risque.
-- =====================================================================

CREATE TABLE IF NOT EXISTS roles_acces (
  role       text PRIMARY KEY,
  tuiles     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- ── RLS aligné sur le reste de l'app ──────────────────────────────────
ALTER TABLE roles_acces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON roles_acces;
CREATE POLICY allow_all ON roles_acces FOR ALL TO public USING (true) WITH CHECK (true);

-- ── Seed des défauts (= menus historiques à l'identique) ──────────────
--  ON CONFLICT DO NOTHING : ne réécrase pas une config déjà personnalisée.
INSERT INTO roles_acces (role, tuiles) VALUES
  ('rh', '["rh","demandes-admin","demandes-explication-admin","recap-verifications","equipe","contacts","charges","documents","credits-fournisseurs"]'::jsonb),
  ('gerant', '["ventes","dashboard","documents","livraisons","gerant-caissier","deductions-gerant","credits-fournisseurs","demandes","demandes-explication","contacts"]'::jsonb),
  ('caissier', '["point-shift","depenses","fournisseurs","inventaire","presences","livraisons"]'::jsonb)
ON CONFLICT (role) DO NOTHING;

-- ── Vérif ─────────────────────────────────────────────────────────────
SELECT role, jsonb_array_length(tuiles) AS nb_tuiles, updated_at
FROM roles_acces
ORDER BY role;
