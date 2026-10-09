-- =====================================================================
--  LITIGES YANGO / GLOVO AUTOMATIQUES
--  docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
--  Idempotent. À passer dans le SQL Editor du projet Samtrackly.
-- =====================================================================

-- Commandes lues sur les portails par le favori (une ligne par commande).
CREATE TABLE IF NOT EXISTS commandes_plateformes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme       TEXT NOT NULL CHECK (plateforme IN ('glovo', 'yango')),
  numero           TEXT NOT NULL,
  boutique         TEXT,
  restaurant_id    UUID REFERENCES restaurants(id),
  commande_le      TIMESTAMPTZ NOT NULL,
  jour             DATE NOT NULL,
  statut           TEXT NOT NULL CHECK (statut IN ('livree', 'annulee', 'autre')),
  montant_paye     INTEGER,
  rembourse        INTEGER NOT NULL DEFAULT 0,
  penalite_attente INTEGER NOT NULL DEFAULT 0,
  lignes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  recu_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plateforme, numero)
);
CREATE INDEX IF NOT EXISTS idx_cmd_plateformes_jour ON commandes_plateformes (restaurant_id, plateforme, jour);

-- Nom de plat plateforme → nom de plat POS (ou ignorer).
CREATE TABLE IF NOT EXISTS correspondances_plats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme     TEXT NOT NULL CHECK (plateforme IN ('glovo', 'yango')),
  nom_norm       TEXT NOT NULL,
  nom_plateforme TEXT NOT NULL,
  nom_pos        TEXT,
  ignorer        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plateforme, nom_norm),
  CHECK (ignorer OR nom_pos IS NOT NULL)
);

-- Noms de plats vus dans le POS sur les commandes partenaires.
CREATE TABLE IF NOT EXISTS plats_pos_vus (
  nom_norm TEXT PRIMARY KEY,
  nom      TEXT NOT NULL,
  ignorer  BOOLEAN NOT NULL DEFAULT false,
  vu_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Litiges auto annulés par le manager : jamais recréés.
CREATE TABLE IF NOT EXISTS litiges_auto_annules (
  cle_auto   TEXT PRIMARY KEY,
  plateforme TEXT NOT NULL,
  copie      JSONB NOT NULL,
  annule_par TEXT,
  annule_le  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- État du calcul par restaurant × plateforme × jour.
CREATE TABLE IF NOT EXISTS journees_litiges_plateformes (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  plateforme    TEXT NOT NULL,
  jour          DATE NOT NULL,
  statut        TEXT NOT NULL CHECK (statut IN ('calculee', 'a_relier', 'pos_manquant')),
  noms_inconnus TEXT[] NOT NULL DEFAULT '{}',
  calcule_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, plateforme, jour)
);

ALTER TABLE litiges_yango ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE litiges_yango ADD COLUMN IF NOT EXISTS cle_auto TEXT;
ALTER TABLE litiges_yango ADD COLUMN IF NOT EXISTS detail JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_litiges_yango_cle_auto ON litiges_yango (cle_auto) WHERE cle_auto IS NOT NULL;

ALTER TABLE litiges_glovo ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE litiges_glovo ADD COLUMN IF NOT EXISTS cle_auto TEXT;
ALTER TABLE litiges_glovo ADD COLUMN IF NOT EXISTS detail JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_litiges_glovo_cle_auto ON litiges_glovo (cle_auto) WHERE cle_auto IS NOT NULL;

-- Même posture que les autres tables de l'app (clé anon, RLS ouvert) :
-- l'app lit tout, écrit les correspondances, les plats ignorés et les annulations.
ALTER TABLE commandes_plateformes ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondances_plats ENABLE ROW LEVEL SECURITY;
ALTER TABLE plats_pos_vus ENABLE ROW LEVEL SECURITY;
ALTER TABLE litiges_auto_annules ENABLE ROW LEVEL SECURITY;
ALTER TABLE journees_litiges_plateformes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY lecture ON commandes_plateformes FOR SELECT USING (true);
  CREATE POLICY tout ON correspondances_plats FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY tout ON plats_pos_vus FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY tout ON litiges_auto_annules FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY lecture ON journees_litiges_plateformes FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
