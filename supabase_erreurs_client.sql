-- Journal des erreurs techniques côté client (monitoring)
-- Écrit par lib/logErreur.js, consulté dans l'onglet « ⚠️ Erreurs » de app/journal.js

CREATE TABLE IF NOT EXISTS erreurs_client (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contexte TEXT,
  message TEXT,
  details TEXT,
  meta JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erreurs_client_created ON erreurs_client (created_at DESC);
