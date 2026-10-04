-- ════════════════════════════════════════════════════════════════════
--  Avis plateformes — heure de la commande
--
--  Le bouton avis lit l'heure de chaque commande sur le portail Glovo ou
--  Yango. Elle sert à retrouver le caissier qui tenait la caisse
--  (lib/attributionAvis.js) et date le litige au jour de la commande.
--  Idempotent, rejouable.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE platform_reviews ADD COLUMN IF NOT EXISTS commande_le TIMESTAMPTZ;

COMMENT ON COLUMN platform_reviews.commande_le IS
  'Date-heure de la commande (lue sur le portail). NULL = inconnue.';

-- Complète l'heure des avis DÉJÀ connus (relus par le bouton) et de leur
-- litige s'il n'en a pas : heure_commande + date = date de la commande.
-- Rien d'autre n'est modifié. Renvoie les avis complétés.
CREATE OR REPLACE FUNCTION completer_heures_avis(p_heures JSONB)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH h AS (
    SELECT e->>'dedup_hash' AS dedup_hash, (e->>'commande_le')::timestamptz AS commande_le
      FROM jsonb_array_elements(p_heures) AS e
  ), maj AS (
    UPDATE platform_reviews r
       SET commande_le = h.commande_le
      FROM h
     WHERE r.dedup_hash = h.dedup_hash
       AND r.commande_le IS NULL
    RETURNING r.id, r.commande_le
  ), lit AS (
    UPDATE litiges_avis_clients l
       SET heure_commande = (maj.commande_le AT TIME ZONE 'UTC')::time,
           date = (maj.commande_le AT TIME ZONE 'UTC')::date
      FROM maj
     WHERE l.review_id = maj.id
       AND l.heure_commande IS NULL
    RETURNING l.review_id
  )
  SELECT id FROM maj
$$;

REVOKE ALL ON FUNCTION completer_heures_avis(JSONB) FROM PUBLIC, anon, authenticated;
