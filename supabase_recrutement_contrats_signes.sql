-- =====================================================================
--  RECRUTEMENT + CONTRATS SIGNÉS DANS L'APPLICATION
--
--  À exécuter dans le SQL Editor du projet Samtrackly (wlwotzxnzowbkbfcpnyi).
--  Idempotent : relançable sans dégât.
--  Voir docs/superpowers/specs/2026-10-14-recrutement-contrats-signes-design.md
--
--  1. Identité complète sur la fiche travailleur (reprise par les contrats).
--  2. demandes_travailleurs : le gérant demande une embauche, la RH valide.
--  3. baremes_postes : montants du contrat mémorisés par poste.
--  4. contrats_travailleurs : statut du circuit de signature. Les contrats
--     déjà saisis (photo d'un papier) deviennent « signe » et ne changent pas.
--  5. Tuile « Nouveau travailleur » dans le menu du gérant.
-- =====================================================================

-- ── 1. Fiche travailleur ────────────────────────────────────────────────
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS civilite text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS nom_famille text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS prenoms text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS date_naissance date;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS lieu_naissance text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS nationalite text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS situation_famille text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS lieu_residence text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS cni_numero text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS nni_numero text;
ALTER TABLE travailleurs ADD COLUMN IF NOT EXISTS piece_identite_urls text[] NOT NULL DEFAULT '{}';

-- ── 2. Demandes de nouveau travailleur ──────────────────────────────────
CREATE TABLE IF NOT EXISTS demandes_travailleurs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid REFERENCES restaurants(id),
  civilite           text,
  nom_famille        text NOT NULL,
  prenoms            text NOT NULL,
  date_naissance     date,
  lieu_naissance     text,
  nationalite        text,
  situation_famille  text,
  lieu_residence     text,
  cni_numero         text,
  nni_numero         text,
  contact            text,
  poste              text NOT NULL,
  salaire_journalier int,
  date_embauche      date,
  -- La photo du travailleur est obligatoire ; les papiers ne le sont pas.
  photo_url          text NOT NULL,
  papiers_urls       text[] NOT NULL DEFAULT '{}',
  statut             text NOT NULL DEFAULT 'envoyee' CHECK (statut IN ('envoyee','acceptee','refusee')),
  motif_refus        text,
  historique_refus   jsonb NOT NULL DEFAULT '[]',
  doublon_travailleur_id uuid REFERENCES travailleurs(id) ON DELETE SET NULL,
  travailleur_id     uuid REFERENCES travailleurs(id) ON DELETE SET NULL,
  cree_par           uuid,
  cree_par_nom       text,
  traite_par         uuid,
  traite_par_nom     text,
  traite_le          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demandes_trav_statut ON demandes_travailleurs (statut, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demandes_trav_resto ON demandes_travailleurs (restaurant_id, created_at DESC);

ALTER TABLE demandes_travailleurs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON demandes_travailleurs;
CREATE POLICY allow_all ON demandes_travailleurs FOR ALL TO public USING (true) WITH CHECK (true);

-- ── 3. Barème par poste ─────────────────────────────────────────────────
-- cle_poste : poste normalisé (« Caissière », « Caissier/re » → « caissier »),
-- calculé par lib/baremes.js. famille : 'stage' (prime journalière) ou
-- 'contrat' (CDD et CDI : catégorie, salaire, tenue, transport).
CREATE TABLE IF NOT EXISTS baremes_postes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle_poste           text NOT NULL,
  poste               text NOT NULL,
  famille             text NOT NULL CHECK (famille IN ('stage','contrat')),
  categorie           text,
  salaire_categoriel  int,
  prime_tenue         int,
  indemnite_transport int,
  prime_journaliere   int,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cle_poste, famille)
);
ALTER TABLE baremes_postes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON baremes_postes;
CREATE POLICY allow_all ON baremes_postes FOR ALL TO public USING (true) WITH CHECK (true);

-- ── 4. Contrats : circuit de signature ──────────────────────────────────
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'signe';
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS demande_id uuid REFERENCES demandes_travailleurs(id) ON DELETE SET NULL;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS modele text;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS donnees jsonb;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS signature_traits jsonb;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS pdf_signe_url text;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS papier_signe_url text;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS envoye_le timestamptz;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS signe_le timestamptz;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS presente_par uuid;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS presente_par_nom text;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS motif_refus text;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS historique_refus jsonb NOT NULL DEFAULT '[]';
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS valide_par uuid;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS valide_par_nom text;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS valide_le timestamptz;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS annule_le timestamptz;
ALTER TABLE contrats_travailleurs ADD COLUMN IF NOT EXISTS annule_motif text;

-- Un contrat généré n'a pas de photo tant qu'il n'est pas signé.
ALTER TABLE contrats_travailleurs ALTER COLUMN photo_url DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contrat_statut_valide' AND conrelid = 'contrats_travailleurs'::regclass) THEN
    ALTER TABLE contrats_travailleurs ADD CONSTRAINT contrat_statut_valide
      CHECK (statut IN ('a_signer','signe_a_verifier','signe','refuse','annule'));
  END IF;

  -- Un contrat « signé » a toujours sa preuve : photo du papier, PDF signé
  -- à l'appareil, ou photo du papier signé (plan B).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contrat_preuve_si_signe' AND conrelid = 'contrats_travailleurs'::regclass) THEN
    ALTER TABLE contrats_travailleurs ADD CONSTRAINT contrat_preuve_si_signe
      CHECK (statut <> 'signe' OR photo_url IS NOT NULL OR pdf_signe_url IS NOT NULL OR papier_signe_url IS NOT NULL);
  END IF;

  -- L'anti-chevauchement ne vaut que pour les contrats signés : un contrat à
  -- signer, refusé ou annulé ne bloque jamais des dates.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contrats_sans_chevauchement' AND conrelid = 'contrats_travailleurs'::regclass
       AND pg_get_constraintdef(oid) NOT ILIKE '%statut%'
  ) THEN
    ALTER TABLE contrats_travailleurs DROP CONSTRAINT contrats_sans_chevauchement;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contrats_sans_chevauchement' AND conrelid = 'contrats_travailleurs'::regclass) THEN
    ALTER TABLE contrats_travailleurs
      ADD CONSTRAINT contrats_sans_chevauchement
      EXCLUDE USING gist (
        travailleur_id WITH =,
        daterange(date_debut, (COALESCE(cloture_le, date_fin) + 1), '[)') WITH &&
      ) WHERE (statut = 'signe');
  END IF;
END $$;

-- Un seul contrat en cours de circuit par travailleur.
CREATE UNIQUE INDEX IF NOT EXISTS contrat_un_seul_en_attente
  ON contrats_travailleurs (travailleur_id)
  WHERE statut IN ('a_signer','signe_a_verifier','refuse');

CREATE INDEX IF NOT EXISTS idx_contrats_statut ON contrats_travailleurs (statut) WHERE statut <> 'signe';

-- ── 5. Menu du gérant : tuile « Nouveau travailleur » ───────────────────
UPDATE roles_acces
   SET tuiles = '["recrutement"]'::jsonb || tuiles, updated_at = now()
 WHERE role = 'gerant' AND NOT (tuiles ? 'recrutement');

-- =====================================================================
--  VÉRIFICATION (à lancer après) — doit renvoyer 1 ligne, tout à true :
-- =====================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='travailleurs' AND column_name='piece_identite_urls') = 1 AS fiche,
--   to_regclass('public.demandes_travailleurs') IS NOT NULL AS demandes,
--   to_regclass('public.baremes_postes') IS NOT NULL AS baremes,
--   (SELECT pg_get_constraintdef(oid) ILIKE '%statut%' FROM pg_constraint WHERE conname='contrats_sans_chevauchement') AS chevauchement,
--   (SELECT tuiles ? 'recrutement' FROM roles_acces WHERE role='gerant') AS tuile_gerant;
