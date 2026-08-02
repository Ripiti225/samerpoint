-- =====================================================================
--  LITIGES → AVIS CLIENTS : type « neutre »
--
--  Trois types d'avis désormais :
--    mauvais → +1000 FCFA (à la charge du restaurant)
--    bon     →  −500 FCFA (en sa faveur)
--    neutre  →     0 FCFA (tracé, mais sans impact sur les totaux)
--
--  Le montant est écrit par l'app (lib TYPES_AVIS dans app/litiges.js) ;
--  la base ne fait que stocker. Ce script sert uniquement à lever une
--  éventuelle contrainte CHECK qui n'autoriserait que 'mauvais' et 'bon'
--  et bloquerait l'insertion d'un avis neutre.
--
--  Si aucune contrainte de ce genre n'existe, le script ne fait rien.
--  On n'en recrée volontairement pas : la liste des types vit dans l'app.
--
--  Idempotent — rejouable sans risque.
-- =====================================================================

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'litiges_avis_clients'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%mauvais%'
  LOOP
    EXECUTE format('ALTER TABLE litiges_avis_clients DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Contrainte % supprimée (bloquait le type neutre)', c.conname;
  END LOOP;
END $$;

-- ── Vérif : répartition des avis par type ─────────────────────────────
SELECT type, count(*) AS nb, sum(montant) AS total_fcfa
FROM litiges_avis_clients
GROUP BY type
ORDER BY type;
