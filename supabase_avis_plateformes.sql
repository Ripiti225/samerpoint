-- =====================================================================
--  AVIS CLIENTS DES PLATEFORMES (Yango & Glovo) — schéma complet
--
--  Ingestion quotidienne par l'Edge Function `ingest-reviews`
--  (supabase/functions/ingest-reviews) alimentée par Cowork + Chrome.
--  Voir docs/AVIS_PLATEFORMES.md pour le déroulé opérationnel.
--
--  Ce fichier regroupe REV-1, REV-2, REV-3 et REV-6 du brief : ils sont
--  dépendants entre eux (clés étrangères), on les exécute donc d'un bloc
--  pour éviter tout ordre d'exécution hasardeux dans le SQL Editor.
--
--  ADAPTATIONS AU SCHÉMA RÉEL (vérifié le 02/09/2026 sur wlwotzxnzowbkbfcpnyi) :
--    • table des restaurants           = `restaurants` (id uuid)
--    • table des litiges « avis »      = `litiges_avis_clients`
--      colonnes réelles : id, restaurant_id, date, numero_commande, contenu,
--      statut, created_by, created_at, responsable_id, responsable_nom,
--      notes, modified_at, type, montant, canal
--    • l'app se connecte avec la clé ANON (login par PIN, pas Supabase Auth) :
--      les politiques de lecture visent donc `public`, pas `authenticated`,
--      sinon les écrans back-office ne verraient aucune ligne.
--
--  Idempotent — rejouable sans risque.
-- =====================================================================


-- ── REV-1 · Avis bruts des plateformes ───────────────────────────────
CREATE TABLE IF NOT EXISTS platform_reviews (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform             TEXT NOT NULL CHECK (platform IN ('yango','glovo')),
  restaurant_id        UUID REFERENCES restaurants(id),
  external_store_label TEXT,                       -- nom de la boutique côté plateforme
  external_ref         TEXT,                       -- n° de commande (clé de dédoublonnage)
  rating_raw           NUMERIC,                    -- étoiles Yango (1-5) ; NULL chez Glovo (pouce)
  rating_scale         NUMERIC NOT NULL DEFAULT 5 CHECK (rating_scale > 0),
  rating_normalized    NUMERIC GENERATED ALWAYS AS (
    CASE WHEN rating_raw IS NULL THEN NULL
         ELSE round((rating_raw / rating_scale) * 5, 2) END
  ) STORED,
  classification       TEXT NOT NULL DEFAULT 'bon' CHECK (classification IN ('bon','negatif')),
  comment              TEXT,
  author               TEXT,
  review_date          DATE,
  dedup_hash           TEXT NOT NULL UNIQUE,       -- calculé côté serveur par l'Edge Function
  raw                  JSONB,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_resto     ON platform_reviews (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_date      ON platform_reviews (review_date);
CREATE INDEX IF NOT EXISTS idx_reviews_platform  ON platform_reviews (platform);
CREATE INDEX IF NOT EXISTS idx_reviews_class     ON platform_reviews (classification);
-- Onglet « À rattacher » : avis dont la boutique n'est pas encore mappée.
CREATE INDEX IF NOT EXISTS idx_reviews_non_mappes ON platform_reviews (platform, external_store_label)
  WHERE restaurant_id IS NULL;


-- ── REV-1 · Correspondance boutique plateforme → restaurant ──────────
--  9 établissements Glovo et 17 restaurants Yango pour 7 restaurants
--  SamerTrackly : le mapping est indispensable, il se remplit depuis
--  l'onglet « À rattacher » de l'écran Avis clients (RPC rattacher_avis).
CREATE TABLE IF NOT EXISTS review_store_mapping (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform             TEXT NOT NULL CHECK (platform IN ('yango','glovo')),
  external_store_label TEXT NOT NULL,
  restaurant_id        UUID NOT NULL REFERENCES restaurants(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_store_label)
);


-- ── REV-2 · Raccord avec les litiges « avis clients » existants ──────
--  Un avis négatif ingéré crée UNE ligne litiges_avis_clients (type
--  'mauvais', canal 'yango'/'glovo'). L'index unique garantit qu'un avis
--  ne génère jamais deux litiges, même si l'extraction repasse dessus.
ALTER TABLE litiges_avis_clients ADD COLUMN IF NOT EXISTS review_id UUID REFERENCES platform_reviews(id);
ALTER TABLE litiges_avis_clients ADD COLUMN IF NOT EXISTS source    TEXT;  -- 'avis_plateforme' | NULL (saisie manuelle)

CREATE UNIQUE INDEX IF NOT EXISTS uq_litiges_avis_review
  ON litiges_avis_clients (review_id) WHERE review_id IS NOT NULL;


-- ── REV-3 · Journal des extractions du jour ──────────────────────────
--  Sert au « skip si déjà fait aujourd'hui » : les créneaux de 12h et 13h
--  interrogent cette table (GET sur l'Edge Function) et s'arrêtent net si
--  le créneau de 11h a déjà réussi.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date      DATE NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'ok',
  received      INT DEFAULT 0,
  inserted      INT DEFAULT 0,
  duplicates    INT DEFAULT 0,
  unmapped      INT DEFAULT 0,
  litiges_crees INT DEFAULT 0,
  finished_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── RLS ──────────────────────────────────────────────────────────────
--  Lecture ouverte (comme le reste de l'app, clé anon publique) mais
--  AUCUNE politique d'écriture : seule l'Edge Function, qui utilise la
--  clé service_role, insère des avis. Le rattachement d'une boutique
--  passe par la fonction rattacher_avis() (SECURITY DEFINER) — l'app n'a
--  donc jamais besoin du secret d'ingestion.
ALTER TABLE platform_reviews    ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_store_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_runs          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_select ON platform_reviews;
CREATE POLICY reviews_select ON platform_reviews FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS mapping_select ON review_store_mapping;
CREATE POLICY mapping_select ON review_store_mapping FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS runs_select ON ingest_runs;
CREATE POLICY runs_select ON ingest_runs FOR SELECT TO public USING (true);


-- ── Rattachement d'une boutique à un restaurant ──────────────────────
--  Appelée par l'écran « Avis clients » → onglet « À rattacher ».
--  1. enregistre (ou corrige) la correspondance,
--  2. rattache tous les avis orphelins portant ce libellé,
--  3. crée les litiges manquants pour les négatifs ainsi rattachés
--     (sinon un avis négatif arrivé avant le mapping n'aurait pas de litige).
--  Renvoie le nombre d'avis rattachés.
CREATE OR REPLACE FUNCTION rattacher_avis(
  p_platform      TEXT,
  p_label         TEXT,
  p_restaurant_id UUID,
  p_montant       NUMERIC DEFAULT 1000
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
BEGIN
  IF p_platform NOT IN ('yango','glovo') THEN
    RAISE EXCEPTION 'Plateforme inconnue : %', p_platform;
  END IF;

  INSERT INTO review_store_mapping (platform, external_store_label, restaurant_id)
  VALUES (p_platform, p_label, p_restaurant_id)
  ON CONFLICT (platform, external_store_label)
  DO UPDATE SET restaurant_id = EXCLUDED.restaurant_id;

  UPDATE platform_reviews
     SET restaurant_id = p_restaurant_id
   WHERE platform = p_platform
     AND external_store_label = p_label
     AND restaurant_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO litiges_avis_clients
    (restaurant_id, date, numero_commande, notes, type, montant, canal, source, review_id, created_by)
  SELECT r.restaurant_id,
         COALESCE(r.review_date, current_date),
         r.external_ref,
         COALESCE(NULLIF(r.comment, ''), 'Avis négatif sans commentaire'),
         'mauvais',
         p_montant,
         r.platform,
         'avis_plateforme',
         r.id,
         'Avis plateforme'
    FROM platform_reviews r
   WHERE r.platform = p_platform
     AND r.external_store_label = p_label
     AND r.restaurant_id = p_restaurant_id
     AND r.classification = 'negatif'
  ON CONFLICT (review_id) WHERE review_id IS NOT NULL DO NOTHING;

  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION rattacher_avis(TEXT, TEXT, UUID, NUMERIC) TO anon, authenticated;


-- ── REV-6 · Vue de synthèse hebdomadaire ─────────────────────────────
--  restaurant × semaine × plateforme → note moyenne, nb d'avis, nb de négatifs.
CREATE OR REPLACE VIEW review_weekly_stats AS
SELECT r.restaurant_id,
       date_trunc('week', r.review_date)::date AS semaine,
       r.platform,
       count(*)                                                   AS nb_avis,
       count(*) FILTER (WHERE r.classification = 'negatif')       AS nb_negatifs,
       round(avg(r.rating_normalized), 2)                         AS note_moyenne
FROM platform_reviews r
WHERE r.review_date IS NOT NULL
GROUP BY r.restaurant_id, date_trunc('week', r.review_date), r.platform;


-- ── Vérif ────────────────────────────────────────────────────────────
SELECT tablename, CASE WHEN rowsecurity THEN 'ON' ELSE 'OFF' END AS rls
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('platform_reviews','review_store_mapping','ingest_runs')
ORDER BY tablename;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'litiges_avis_clients' AND column_name IN ('review_id','source');
