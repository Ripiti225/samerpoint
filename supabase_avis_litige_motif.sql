-- ════════════════════════════════════════════════════════════════════
--  Avis plateformes — pas de litige pour un avis négatif muet
--
--  Un avis négatif ne crée un litige (1000 FCFA à la charge du
--  restaurant) que s'il dit pourquoi : un commentaire, ou au moins un
--  tag Yango (raw.raw.tag) / thème Glovo (raw.raw.theme). Le pouce rouge
--  muet reste compté dans les KPI de l'écran Avis clients.
--
--  Même règle à trois endroits, à garder alignés :
--    - aUnMotif            lib/avisPlateformes.js (+ tests)
--    - aUnMotif            supabase/functions/ingest-reviews/index.ts
--    - avis_a_un_motif()   ici, utilisé par rattacher_avis()
--
--  `platform_reviews.raw` contient l'avis tel qu'envoyé par l'extraction :
--  ses tags sont donc un niveau plus bas, dans raw -> 'raw'.
--  Idempotent, rejouable.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION avis_a_un_motif(p_comment TEXT, p_raw JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(btrim(p_comment), '') <> ''
      OR EXISTS (
           SELECT 1
             FROM unnest(ARRAY['tag', 'theme']) AS k(cle),
                  LATERAL (
                    SELECT CASE jsonb_typeof(p_raw -> 'raw' -> k.cle)
                             WHEN 'array'  THEN p_raw -> 'raw' -> k.cle
                             WHEN 'string' THEN jsonb_build_array(p_raw -> 'raw' -> k.cle)
                             ELSE '[]'::jsonb
                           END AS valeurs
                  ) v,
                  jsonb_array_elements(v.valeurs) AS e(val)
            WHERE btrim(e.val #>> '{}') <> ''
         )
$$;


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
  v_norm TEXT := normaliser_label_boutique(p_label);
BEGIN
  IF p_platform NOT IN ('yango','glovo') THEN
    RAISE EXCEPTION 'Plateforme inconnue : %', p_platform;
  END IF;

  INSERT INTO review_store_mapping (platform, external_store_label, restaurant_id)
  VALUES (p_platform, p_label, p_restaurant_id)
  ON CONFLICT (platform, label_norm)
  DO UPDATE SET restaurant_id = EXCLUDED.restaurant_id;

  UPDATE platform_reviews
     SET restaurant_id = p_restaurant_id
   WHERE platform = p_platform
     AND normaliser_label_boutique(external_store_label) = v_norm
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
     AND normaliser_label_boutique(r.external_store_label) = v_norm
     AND r.restaurant_id = p_restaurant_id
     AND r.classification = 'negatif'
     AND avis_a_un_motif(r.comment, r.raw)
  ON CONFLICT (review_id) DO NOTHING;

  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION rattacher_avis(TEXT, TEXT, UUID, NUMERIC) TO anon, authenticated;


-- ── Libellés courts envoyés par la tâche Cowork ──────────────────────
--  Le prompt de la tâche quotidienne nomme les boutiques par un libellé
--  court (« Chez Samer Yopougon Maroc ») alors que le mapping ne connaissait
--  que leurs identifiants (2028607) et les longs libellés du portail : tous
--  les avis Yango seraient partis dans « À rattacher ». Chaque libellé court
--  reprend le restaurant déjà associé à l'identifiant de la même boutique —
--  rien n'est deviné.
INSERT INTO review_store_mapping (platform, external_store_label, restaurant_id)
SELECT c.platform, c.label, m.restaurant_id
  FROM (VALUES
    ('yango', 'Chez Samer (Rond point Riviera Palmeraie, Abidjan)', '1969340'),
    ('yango', 'Chez Samer (Quartier de la Angré, Abidjan)',         '1969345'),
    ('yango', 'Chez Samer (Quartier de la Zone 4, Abidjan)',        '1969365'),
    ('yango', 'Chez Samer Yopougon St André',                       '2028462'),
    ('yango', 'Chez Samer Yopougon Maroc',                          '2028607'),
    ('glovo', 'Al Kayan - ABN - Remblais',                          'GV_CI;315921')
  ) AS c(platform, label, id_boutique)
  JOIN review_store_mapping m
    ON m.platform = c.platform
   AND m.label_norm = normaliser_label_boutique(c.id_boutique)
ON CONFLICT (platform, label_norm) DO NOTHING;


-- ── Contrôle : les avis du 05/09 doivent donner le même partage que les
--  litiges réellement conservés (muets sans litige, motivés avec).
SELECT avis_a_un_motif(r.comment, r.raw) AS a_un_motif,
       count(*)                          AS negatifs,
       count(l.id)                       AS avec_litige
  FROM platform_reviews r
  LEFT JOIN litiges_avis_clients l ON l.review_id = r.id
 WHERE r.classification = 'negatif'
 GROUP BY 1;
