-- =====================================================================
--  TRÉSORERIE — étape 1 de la nouvelle trésorerie : charges post-payées.
--  À exécuter dans le SQL Editor (projet Samtrackly), APRÈS les migrations
--  supabase_tresorerie*.sql existantes. Idempotent. Montants en FCFA entiers.
--  Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
-- =====================================================================

ALTER TABLE tresorerie_dus DROP CONSTRAINT IF EXISTS tresorerie_dus_categorie_check;
ALTER TABLE tresorerie_dus ADD CONSTRAINT tresorerie_dus_categorie_check
  CHECK (categorie IN ('loyer','salaire','cnps','impot','its','tee','bail','autre','admin','dette'));

ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS categorie_direction text;
ALTER TABLE tresorerie_dus ADD COLUMN IF NOT EXISTS en_dette_depuis date;

ALTER TABLE tresorerie_dus DROP CONSTRAINT IF EXISTS du_mensuel_complet;
ALTER TABLE tresorerie_dus ADD CONSTRAINT du_mensuel_complet CHECK (
  categorie NOT IN ('loyer','salaire','cnps','impot','its','tee','bail')
  OR (restaurant_id IS NOT NULL AND mois IS NOT NULL)
);

DROP INDEX IF EXISTS uniq_treso_du_mensuel;
CREATE UNIQUE INDEX uniq_treso_du_mensuel ON tresorerie_dus (categorie, restaurant_id, mois)
  WHERE categorie IN ('loyer','salaire','cnps','impot','its','tee','bail');

CREATE TABLE IF NOT EXISTS tresorerie_echeances (
  categorie  text PRIMARY KEY CHECK (categorie IN ('salaire','cnps','impot','its','tee')),
  jour       int  NOT NULL CHECK (jour BETWEEN 1 AND 31),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tresorerie_echeances (categorie, jour)
VALUES ('salaire', 10), ('cnps', 15), ('impot', 15), ('its', 15), ('tee', 15)
ON CONFLICT (categorie) DO NOTHING;

CREATE TABLE IF NOT EXISTS tresorerie_charges_fixes (
  categorie     text NOT NULL CHECK (categorie IN ('impot','its','tee','bail')),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  montant       bigint NOT NULL CHECK (montant > 0),
  mois_depart   date NOT NULL CHECK (extract(day FROM mois_depart) = 1),
  bail_mois     int CHECK (bail_mois BETWEEN 1 AND 12),
  bail_jour     int CHECK (bail_jour BETWEEN 1 AND 31),
  actif         boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (categorie, restaurant_id),
  CONSTRAINT bail_date_complete CHECK (categorie <> 'bail' OR (bail_mois IS NOT NULL AND bail_jour IS NOT NULL))
);

-- Post-payé : un loyer créé avec son échéance dans le mois consommé passe au
-- mois suivant (jour du restaurant, borné à la fin du mois). Idempotent : une
-- échéance déjà au mois suivant n'est plus touchée.
UPDATE tresorerie_dus d SET echeance = make_date(
  extract(year  FROM d.mois + interval '1 month')::int,
  extract(month FROM d.mois + interval '1 month')::int,
  least(l.jour_echeance,
        extract(day FROM date_trunc('month', d.mois + interval '1 month') + interval '1 month - 1 day')::int)
)
FROM tresorerie_loyers l
WHERE d.categorie = 'loyer' AND d.restaurant_id = l.restaurant_id
  AND d.echeance IS NOT NULL
  AND date_trunc('month', d.echeance) = date_trunc('month', d.mois);

-- Le réglage des loyers du 01/10/2026 fixait le premier mois automatique au
-- mois SUIVANT (novembre). En post-payé, le mois en cours se crée tout de suite
-- (loyer d'octobre, dû en novembre) : ces réglages repartent d'octobre.
UPDATE tresorerie_loyers SET mois_depart = '2026-10-01'
WHERE mois_depart = '2026-11-01' AND updated_at < '2026-10-03';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tresorerie_echeances','tresorerie_charges_fixes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
