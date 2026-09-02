-- =====================================================================
--  AVIS PLATEFORMES — correspondance boutique → restaurant
--
--  Fourni par Ange le 02/09/2026 : 8 boutiques Glovo et 19 Yango pour
--  7 restaurants. Un restaurant porte plusieurs boutiques (marques S Burger,
--  S Pizza, Al Kayan Pizza… servies depuis la même cuisine) — c'est normal.
--
--  ⚠️ LE LIBELLÉ DOIT ÊTRE COMPLET, ADRESSE COMPRISE.
--  Chez Yango, le nom seul ne suffit pas à identifier le restaurant :
--    « Al Kayan (Abidjan, Côte d’Ivoire, ) »  → Al Kayan KMS
--    « Al Kayan (Abidjan, Rue S95, ) »        → Al Kayan Yop
--  L'extraction doit donc envoyer `external_store_label` tel qu'affiché par le
--  portail, parenthèses et adresse incluses. Un libellé tronqué ne matchera
--  aucune ligne et l'avis atterrira dans « À rattacher ».
--
--  Pour absorber les écarts inoffensifs (espace en trop, majuscules), la
--  correspondance se fait sur un libellé NORMALISÉ : espaces compactés,
--  minuscules. Les accents et la ponctuation, eux, restent significatifs.
--
--  À exécuter APRÈS supabase_avis_plateformes.sql. Idempotent.
-- =====================================================================


-- ── Normalisation du libellé ─────────────────────────────────────────
--  Volontairement minimale : on ne veut pas qu'« Al Kayan (Abidjan, Rue S95, ) »
--  et « Al Kayan (Abidjan, Côte d’Ivoire, ) » se retrouvent confondus.
CREATE OR REPLACE FUNCTION normaliser_label_boutique(p_label TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g'))
$$;

ALTER TABLE review_store_mapping
  ADD COLUMN IF NOT EXISTS label_norm TEXT
  GENERATED ALWAYS AS (normaliser_label_boutique(external_store_label)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mapping_label_norm
  ON review_store_mapping (platform, label_norm);


-- ── Résolution automatique à l'insertion d'un avis ───────────────────
--  Une seule source de vérité pour « quel restaurant ? » : ce trigger.
--  L'Edge Function n'a plus à connaître le mapping, elle insère l'avis et
--  lit le restaurant que le trigger a posé.
CREATE OR REPLACE FUNCTION resoudre_restaurant_avis()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.restaurant_id IS NULL AND NEW.external_store_label IS NOT NULL THEN
    SELECT m.restaurant_id INTO NEW.restaurant_id
      FROM review_store_mapping m
     WHERE m.platform = NEW.platform
       AND m.label_norm = normaliser_label_boutique(NEW.external_store_label);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resoudre_restaurant_avis ON platform_reviews;
CREATE TRIGGER trg_resoudre_restaurant_avis
  BEFORE INSERT ON platform_reviews
  FOR EACH ROW EXECUTE FUNCTION resoudre_restaurant_avis();


-- ── Rattachement manuel : même normalisation ─────────────────────────
--  Remplace la version de supabase_avis_plateformes.sql, qui comparait le
--  libellé au caractère près.
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
  ON CONFLICT (review_id) DO NOTHING;

  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION rattacher_avis(TEXT, TEXT, UUID, NUMERIC) TO anon, authenticated;


-- ── Les 27 correspondances ───────────────────────────────────────────
INSERT INTO review_store_mapping (platform, external_store_label, restaurant_id) VALUES
  -- GLOVO (8 boutiques)
  ('glovo', 'Al Kayan (Annaneraie) [YOP]', '268695fe-972e-468e-b2b7-4e7f268dec4f'),  -- AL KAYAN YOP
  ('glovo', 'Chez Samer (21 BP915 21) [YOP]', '99eb7f7e-baab-4159-872a-34a086374f49'),  -- SAMER LAVAGE
  ('glovo', 'Chez Samer (C323+24J) [ABN]', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  ('glovo', 'Chez Samer (L 155 - Voie de la 7e Tranche) [ABN]', '2f09688d-a4b9-4b14-8c45-943543953379'),  -- SAMER ANGRE 7E
  ('glovo', 'Chez Samer (Riviéra Palmeraie Abidjan CI) [ABN]', 'b862dfee-007f-413a-9de0-2c6e83b572ce'),  -- SAMER PALMERAIE
  ('glovo', 'Chez Samer (S 584) [YOP]', 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f'),  -- SAMER OASIS
  ('glovo', 'Chez Samer (S CI) [YOP]', 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'),  -- SAMER MAROC
  ('glovo', 'AL KAYAN -ABN - REMBLAIS', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  -- YANGO (19 boutiques)
  ('yango', 'Al Kayan (Abidjan, Côte d’Ivoire, )', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  ('yango', 'Al Kayan (Abidjan, Rue S95, )', '268695fe-972e-468e-b2b7-4e7f268dec4f'),  -- AL KAYAN YOP
  ('yango', 'Al Kayan (Quartier de la Angré, Quartier de la Angré, Quartier de la Angré)', 'b862dfee-007f-413a-9de0-2c6e83b572ce'),  -- SAMER PALMERAIE
  ('yango', 'Al Kayan Pizza (Abidjan, Côte d’Ivoire, )', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  ('yango', 'Al Kayan Pizza (Abidjan, Rue S95, La commune Yopougon, Abidjan, Côte d’Ivoire, )', '268695fe-972e-468e-b2b7-4e7f268dec4f'),  -- AL KAYAN YOP
  ('yango', 'Chez Samer (Quartier de la Angré, Quartier de la Angré, )', '2f09688d-a4b9-4b14-8c45-943543953379'),  -- SAMER ANGRE 7E
  ('yango', 'Chez Samer (Quartier de la Zone 4, Quartier de la Zone 4, Quartier de la Zone 4)', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  ('yango', 'Chez Samer (Абиджан, Côte d''Ivoire, Abidjan, Rond point Riviera Palmraie, Кот-д''Ивуар, Абиджан, Рон-пуэн-Ривьера-Пальнре, )', 'b862dfee-007f-413a-9de0-2c6e83b572ce'),  -- SAMER PALMERAIE
  ('yango', 'Chez Samer Ananeraie (Абиджан, коммуна Йопугон, улица С584)', 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f'),  -- SAMER OASIS
  ('yango', 'Chez Samer Yopougon Maroc (Abidjan, Côte d’Ivoire, )', 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'),  -- SAMER MAROC
  ('yango', 'Chez Samer Yopougon St André (Abidjan, Rue P239, )', '99eb7f7e-baab-4159-872a-34a086374f49'),  -- SAMER LAVAGE
  ('yango', 'S Burger By Samer Yopougon Maroc (Abidjan, Côte d’Ivoire, )', 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'),  -- SAMER MAROC
  ('yango', 'S Burger By Samer Yopougon St André (Abidjan, Côte d’Ivoire, )', '99eb7f7e-baab-4159-872a-34a086374f49'),  -- SAMER LAVAGE
  ('yango', 'S Burger By Samer Zone 4 (Abidjan, Кот-д''Ивуар, Абиджан, Rue du 7 Décembre, )', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  ('yango', 'S Burger Sodeci riviera Palmeraie en face de chez Samer (Абиджан, Кот-д''Ивуар, Абиджан, Rue I123, )', 'b862dfee-007f-413a-9de0-2c6e83b572ce'),  -- SAMER PALMERAIE
  ('yango', 'S Pizza Chez Samer Koumassi Kaira (Abidjan, Кот-д''Ивуар, Абиджан, Rue du 7 Décembre, )', 'c12f15b9-6149-4b56-be2b-6e82ab447216'),  -- AL KAYAN KMS
  ('yango', 'S Pizza Yopougon Ananeraie (Abidjan, Кот-д''Ивуар, Абиджан, коммуна Йопугон, улица С584, )', 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f'),  -- SAMER OASIS
  ('yango', 'S Pizza Yopougon Maroc (Abidjan, Côte d’Ivoire, )', 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9'),  -- SAMER MAROC
  ('yango', 'S Pizza Yopougon St André (Abidjan, Côte d’Ivoire, )', '99eb7f7e-baab-4159-872a-34a086374f49')  -- SAMER LAVAGE
ON CONFLICT (platform, label_norm) DO UPDATE SET restaurant_id = EXCLUDED.restaurant_id;


-- ── Rattrapage des avis déjà reçus avant ce mapping ──────────────────
UPDATE platform_reviews r
   SET restaurant_id = m.restaurant_id
  FROM review_store_mapping m
 WHERE r.restaurant_id IS NULL
   AND m.platform = r.platform
   AND m.label_norm = normaliser_label_boutique(r.external_store_label);


-- ── Vérif : combien de boutiques par restaurant ──────────────────────
SELECT COALESCE(res.nom, '?') AS restaurant,
       count(*) FILTER (WHERE m.platform = 'glovo') AS glovo,
       count(*) FILTER (WHERE m.platform = 'yango') AS yango
FROM review_store_mapping m
LEFT JOIN restaurants res ON res.id = m.restaurant_id
GROUP BY res.nom
ORDER BY restaurant;

-- Doit renvoyer 0 ligne : aucun avis orphelin dont la boutique est mappée.
SELECT r.platform, r.external_store_label, count(*)
FROM platform_reviews r
WHERE r.restaurant_id IS NULL
GROUP BY r.platform, r.external_store_label;
