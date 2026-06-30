-- =====================================================================
--  ALIGNEMENT RLS — tables laissées en RLS OFF
--  Les met au même niveau que le reste de l'app : RLS ON + politique
--  permissive `allow_all` (ALL pour le rôle public), comme toutes les
--  autres tables. Idempotent (rejouable). À exécuter dans le SQL Editor.
--
--  ⚠️ Ceci ALIGNE mais ne DURCIT PAS : la clé anon (publique) garde un
--  accès total. Un vrai durcissement = Edge Functions / Supabase Auth.
-- =====================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'demandes',
    'litiges_avis_clients',
    'litiges_glovo',
    'litiges_point_pas_fait',
    'litiges_responsables',
    'litiges_yango',
    'verifications_stock'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Vérif : ces 7 tables doivent maintenant être en RLS ON.
SELECT tablename, CASE WHEN rowsecurity THEN 'ON' ELSE 'OFF' END AS rls
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('demandes','litiges_avis_clients','litiges_glovo',
                    'litiges_point_pas_fait','litiges_responsables','litiges_yango','verifications_stock')
ORDER BY tablename;
