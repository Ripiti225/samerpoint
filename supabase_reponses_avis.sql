-- =====================================================================
--  RÉPONSES AUX AVIS GLOVO
--  docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
--  Idempotent. À passer dans le SQL Editor du projet Samtrackly.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reponses_avis (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  UUID NOT NULL UNIQUE REFERENCES platform_reviews(id) ON DELETE CASCADE,
  texte      TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 250),
  modele     TEXT,
  statut     TEXT NOT NULL CHECK (statut IN ('validee', 'envoyee', 'refusee', 'ignoree')),
  erreur     TEXT,
  valide_par TEXT,
  valide_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  envoye_le  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reponses_avis_statut ON reponses_avis (statut);

-- Même posture que les autres tables de l'app (clé anon, RLS ouvert).
ALTER TABLE reponses_avis ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY tout ON reponses_avis FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
