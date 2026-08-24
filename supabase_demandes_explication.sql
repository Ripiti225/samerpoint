-- =====================================================================
--  DEMANDES D'EXPLICATION — workflow avec suivi
--  Flux : le gérant (ou un admin) demande une explication à un travailleur.
--   • Gérant            : crée → statut 'en_attente_acceptation'
--   • Manager/RH/Directeur : crée → auto-accepté → statut 'acceptee'
--                          (saute l'étape acceptation)
--   • Acceptation par admin  → 'acceptee'
--   • « Marquer envoyée »     → 'envoyee' (envoyee_at = now)
--   • +3 jours sans réponse   → rappel push (rappel_envoye_at)
--   • « Réponse récupérée »   → 'reponse_recuperee' (terminal)
--   • « Relancer »            → l'originale passe 'relancee' (terminal) et
--                               une 2e demande (numero=2) est créée en 'envoyee'
--   • Admin peut « Refuser »  → 'refusee' / « Annuler » → 'annulee'
--
--  Idempotent — rejouable sans risque.
-- =====================================================================

CREATE TABLE IF NOT EXISTS demandes_explication (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id            uuid REFERENCES restaurants(id),
  travailleur_id           uuid REFERENCES travailleurs(id),
  travailleur_nom          text,
  travailleur_poste        text,

  motif                    text NOT NULL,          -- sujet de la demande
  description              text,                   -- détails / contexte

  statut                   text DEFAULT 'en_attente_acceptation',
  numero                   int  DEFAULT 1,         -- 1 = originale, 2 = relance
  relance_de               uuid REFERENCES demandes_explication(id),

  -- Demandeur
  cree_par_id              uuid REFERENCES utilisateurs(id),
  cree_par_nom             text,
  cree_par_role            text,

  -- Acceptation (null si auto-accepté par admin)
  accepte_par_id           uuid REFERENCES utilisateurs(id),
  accepte_par_nom          text,
  accepte_at               timestamptz,

  -- Refus de la demande (avant envoi)
  refuse_par_nom           text,
  refus_motif              text,
  refuse_at                timestamptz,

  -- Envoi au travailleur
  envoyee_par_id           uuid REFERENCES utilisateurs(id),
  envoyee_par_nom          text,
  envoyee_at               timestamptz,

  -- Rappel J+3
  rappel_envoye_at         timestamptz,

  -- Réponse récupérée
  reponse_recuperee_par    text,
  reponse_recuperee_at     timestamptz,
  reponse_note             text,

  -- Annulation
  annule_par_nom           text,
  annule_at                timestamptz,

  created_at               timestamptz DEFAULT now()
);

-- Colonnes ajoutées après coup (idempotent si la table préexiste)
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS numero            int  DEFAULT 1;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS relance_de        uuid REFERENCES demandes_explication(id);
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS rappel_envoye_at  timestamptz;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS cree_par_role     text;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS travailleur_poste text;
-- Réponse du travailleur uploadée par le gérant (photo ou PDF, bucket `photos`)
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS reponse_fichier_url   text;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS reponse_fichier_type  text;
ALTER TABLE demandes_explication ADD COLUMN IF NOT EXISTS reponse_uploadee_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_demandes_explication_resto  ON demandes_explication(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_demandes_explication_statut ON demandes_explication(statut);

-- RLS aligné sur le motif de l'app (permissif — cf. note sécurité)
ALTER TABLE demandes_explication ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON demandes_explication;
CREATE POLICY allow_all ON demandes_explication FOR ALL TO public USING (true) WITH CHECK (true);

-- =====================================================================
--  RAPPEL PUSH J+3 (automatisation serveur — pg_cron + pg_net + Edge Function)
--  Nécessite : extensions pg_cron et pg_net activées (Database → Extensions),
--  et l'Edge Function `rappel-explications` déployée (voir supabase/functions/).
--  Remplace <PROJECT_REF> et <SERVICE_ROLE_KEY> avant d'exécuter ce bloc.
-- =====================================================================
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.schedule(
--   'rappel-explications-quotidien',
--   '0 8 * * *',                       -- tous les jours à 08:00 UTC
--   $$
--   SELECT net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/rappel-explications',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
-- Pour supprimer la tâche : SELECT cron.unschedule('rappel-explications-quotidien');

-- =====================================================================
--  FIN
-- =====================================================================
