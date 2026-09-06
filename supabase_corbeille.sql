-- Corbeille : filet de sécurité avant la suppression d'un shift.
--
-- Le 10/08/2026, la suppression d'un shift à Samer Angré 7E a détruit d'un seul
-- clic : le shift (127 000 de ventes, avec ses photos kdo et Yango), 3 dépenses,
-- 5 présences et 2 factures fournisseurs — dont une qui appartenait à une autre
-- caissière. Rien n'était récupérable dans l'app : le journal n'enregistre que
-- le nom de la caissière et le total avant/après, et la sauvegarde OneDrive ne
-- contient que les totaux du point. Il a fallu cloner une sauvegarde Supabase.
--
-- Pourquoi archiver plutôt que marquer les lignes « supprimées » : un marquage
-- obligerait à filtrer les lignes effacées dans TOUTES les lectures de l'app
-- (rapports, tableaux de bord, litiges, exports, déductions). En oublier une
-- seule ferait compter des ventes deux fois. L'archive, elle, ne change aucune
-- requête existante.

CREATE TABLE IF NOT EXISTS suppressions_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contexte, pour retrouver et filtrer sans ouvrir le contenu
  point_id        UUID REFERENCES points(id),
  restaurant_id   UUID REFERENCES restaurants(id),
  date_point      DATE,
  type            TEXT NOT NULL DEFAULT 'shift',
  resume          TEXT,          -- « Hilary Sea · 08:00→16:00 · 127 000 »

  -- Photo intégrale de ce qui a été détruit :
  -- { shift: {...}, presences: [...], depenses: [...], transactions_fournisseurs: [...] }
  contenu         JSONB NOT NULL,

  supprime_par_id   UUID REFERENCES utilisateurs(id),
  supprime_par_nom  TEXT,
  restaure_at       TIMESTAMP,
  restaure_par_nom  TEXT,
  created_at        TIMESTAMP DEFAULT now()
);

-- L'écran Corbeille liste par date décroissante et purge au-delà de la
-- rétention (RETENTION_JOURS dans lib/corbeille.js).
CREATE INDEX IF NOT EXISTS idx_suppressions_archive_date
  ON suppressions_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suppressions_archive_resto
  ON suppressions_archive (restaurant_id, created_at DESC);

-- L'app utilise la clé Supabase anon avec sa propre authentification par PIN.
-- Sans politique, activer RLS bloque silencieusement toutes les archives et
-- rend donc toute suppression de shift impossible.
ALTER TABLE suppressions_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON suppressions_archive;
CREATE POLICY allow_all ON suppressions_archive
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON suppressions_archive
  TO anon, authenticated, service_role;
