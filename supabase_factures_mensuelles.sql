-- =====================================================================
--  FOURNISSEURS → FACTURE MENSUELLE AUTOMATIQUE
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Exemple : « App et logiciel » — chaque restaurant doit 20 000 F par mois
--  (A la Braise 10 000 F). Le montant est réglé sur la fiche du fournisseur
--  (Paramètres → Fournisseurs). Le 1er de chaque mois, il s'ajoute au reste dû.
--
--  Comment :
--    • Pas de tâche programmée (aucun pg_cron sur ce projet) : l'application
--      appelle appliquer_factures_mensuelles() avant de calculer un crédit
--      veille. Le premier appel du mois ajoute la facture ; les suivants ne
--      font rien. Un mois sans aucune ouverture de l'app est rattrapé.
--    • Chaque mois facturé est noté dans factures_mensuelles_fournisseurs
--      (unique par fournisseur et mois) → jamais deux fois, même si deux
--      téléphones appellent en même temps.
--    • La facture est une vraie ligne de transactions_fournisseurs
--      (saisi_par = 'mensuel', sans journée, date_point = le 1er du mois) :
--      c'est le reste de la dernière transaction que le gérant voit comme
--      crédit veille, pas fournisseurs.credit_actuel.
--    • Si des transactions existent déjà à partir du 1er (mois activé en
--      cours de route), leur reste est décalé du montant : la chaîne reste juste.
--
--  Le même mécanisme (inserer_transaction_hors_point / retirer_…) sert à la
--  « cotisation reçue » de la Trésorerie : jusqu'ici sa transaction, sans
--  journée, était ignorée par le crédit veille du gérant et le solde revenait
--  le lendemain comme avant la remise.
-- =====================================================================

do $$
begin
  if to_regclass('public.transactions_fournisseurs') is null then
    raise exception 'Mauvais projet Supabase : transactions_fournisseurs introuvable. Ce script est destiné à Samtrackly (wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS facture_mensuelle bigint NOT NULL DEFAULT 0;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS facture_mensuelle_depuis date;
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_facture_mensuelle_positive CHECK (facture_mensuelle >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS factures_mensuelles_fournisseurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fournisseur_id uuid NOT NULL REFERENCES fournisseurs(id) ON DELETE CASCADE,
  mois date NOT NULL CHECK (extract(day FROM mois) = 1),
  montant bigint NOT NULL CHECK (montant > 0),
  transaction_id uuid REFERENCES transactions_fournisseurs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fournisseur_id, mois)
);

ALTER TABLE factures_mensuelles_fournisseurs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON factures_mensuelles_fournisseurs;
CREATE POLICY allow_all ON factures_mensuelles_fournisseurs FOR ALL TO public USING (true) WITH CHECK (true);

-- ── Écritures hors journée (facture mensuelle, cotisation reçue au RH) ─────
-- Le crédit veille du gérant = le reste de la dernière transaction (date de
-- journée, puis rang dans la journée, puis heure de saisie) — voir
-- lib/derniersRestesFournisseurs.js. Une écriture sans journée se place EN TÊTE
-- de sa date : la saisie du gérant ce jour-là part de son reste. Si des
-- transactions existent déjà après cette place, leur reste est décalé d'autant.

CREATE OR REPLACE FUNCTION rang_transaction_fournisseur(p_point uuid, p_saisi_par text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_point IS NULL THEN -1
              WHEN p_saisi_par = 'gerant_caissier' THEN 3
              WHEN p_saisi_par = 'gerant' THEN 2
              WHEN p_saisi_par = 'caissier' THEN 1
              ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION inserer_transaction_hors_point(
  p_fournisseur uuid, p_date date, p_facture numeric, p_paye numeric,
  p_saisi_par text, p_source text, p_caissier_nom text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  fo record;
  avant numeric;
  delta numeric := coalesce(p_facture, 0) - coalesce(p_paye, 0);
  tx uuid;
BEGIN
  SELECT id, nom, restaurant_id, credit_actuel INTO fo
    FROM fournisseurs WHERE id = p_fournisseur FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable.'; END IF;

  -- Reste juste avant la place : dernière transaction d'avant cette date, ou
  -- écriture hors journée déjà posée ce jour-là ; sinon le solde de la fiche
  -- moins tout ce qui viendra après.
  SELECT t.reste INTO avant
    FROM transactions_fournisseurs t
   WHERE t.fournisseur_id = p_fournisseur
     AND (coalesce(t.date_point, t.created_at::date) < p_date
          OR (coalesce(t.date_point, t.created_at::date) = p_date AND t.point_id IS NULL))
   ORDER BY coalesce(t.date_point, t.created_at::date) DESC,
            rang_transaction_fournisseur(t.point_id, t.saisi_par) DESC,
            t.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT coalesce(fo.credit_actuel, 0) - coalesce(sum(coalesce(t.facture, 0) - coalesce(t.paye, 0)), 0)
      INTO avant
      FROM transactions_fournisseurs t
     WHERE t.fournisseur_id = p_fournisseur
       AND (coalesce(t.date_point, t.created_at::date) > p_date
            OR (coalesce(t.date_point, t.created_at::date) = p_date AND t.point_id IS NOT NULL));
  END IF;
  avant := coalesce(avant, 0);

  UPDATE transactions_fournisseurs t
     SET reste = coalesce(t.reste, 0) + delta,
         credit = coalesce(t.credit, 0) + delta
   WHERE t.fournisseur_id = p_fournisseur
     AND (coalesce(t.date_point, t.created_at::date) > p_date
          OR (coalesce(t.date_point, t.created_at::date) = p_date AND t.point_id IS NOT NULL));

  INSERT INTO transactions_fournisseurs
    (fournisseur_id, fournisseur_nom, restaurant_id, point_id, date_point,
     credit, facture, paye, reste, saisi_par, source, caissier_nom)
  VALUES
    (fo.id, fo.nom, fo.restaurant_id, NULL, p_date,
     avant, coalesce(p_facture, 0), coalesce(p_paye, 0), avant + delta, p_saisi_par, p_source, p_caissier_nom)
  RETURNING id INTO tx;

  UPDATE fournisseurs SET credit_actuel = coalesce(credit_actuel, 0) + delta WHERE id = fo.id;
  RETURN tx;
END;
$$;

-- Défait inserer_transaction_hors_point : retire la ligne et redécale la suite.
CREATE OR REPLACE FUNCTION retirer_transaction_hors_point(p_transaction uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  t0 record;
  d0 date;
  delta numeric;
BEGIN
  SELECT * INTO t0 FROM transactions_fournisseurs WHERE id = p_transaction;
  IF NOT FOUND THEN RETURN; END IF;
  IF t0.point_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cette transaction appartient à une journée : elle ne se retire pas ici.';
  END IF;
  PERFORM 1 FROM fournisseurs WHERE id = t0.fournisseur_id FOR UPDATE;

  d0 := coalesce(t0.date_point, t0.created_at::date);
  delta := coalesce(t0.facture, 0) - coalesce(t0.paye, 0);

  UPDATE transactions_fournisseurs t
     SET reste = coalesce(t.reste, 0) - delta,
         credit = coalesce(t.credit, 0) - delta
   WHERE t.fournisseur_id = t0.fournisseur_id
     AND t.id <> t0.id
     AND (coalesce(t.date_point, t.created_at::date) > d0
          OR (coalesce(t.date_point, t.created_at::date) = d0
              AND (t.point_id IS NOT NULL OR t.created_at > t0.created_at)));

  DELETE FROM transactions_fournisseurs WHERE id = t0.id;
  UPDATE fournisseurs SET credit_actuel = coalesce(credit_actuel, 0) - delta WHERE id = t0.fournisseur_id;
END;
$$;

-- ── Factures mensuelles ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION appliquer_factures_mensuelles()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  f record;
  m date;
  marque uuid;
  tx uuid;
  nb integer := 0;
BEGIN
  FOR f IN
    SELECT id, nom, restaurant_id, facture_mensuelle AS montant,
           date_trunc('month', coalesce(facture_mensuelle_depuis, current_date))::date AS depuis
      FROM fournisseurs
     WHERE facture_mensuelle > 0 AND coalesce(actif, true)
     ORDER BY id
     FOR UPDATE                       -- deux appels simultanés : le second attend
  LOOP
    m := f.depuis;
    WHILE m <= date_trunc('month', current_date)::date LOOP
      INSERT INTO factures_mensuelles_fournisseurs (fournisseur_id, mois, montant)
      VALUES (f.id, m, f.montant)
      ON CONFLICT (fournisseur_id, mois) DO NOTHING
      RETURNING id INTO marque;

      IF marque IS NOT NULL THEN
        tx := inserer_transaction_hors_point(f.id, m, f.montant, 0, 'mensuel', 'facture_mensuelle');
        UPDATE factures_mensuelles_fournisseurs SET transaction_id = tx WHERE id = marque;
        INSERT INTO journal_activite (action, details, restaurant_id, user_nom)
        VALUES ('facture_mensuelle_fournisseur',
                jsonb_build_object('fournisseur', f.nom, 'mois', to_char(m, 'YYYY-MM'), 'montant', f.montant),
                f.restaurant_id, 'Facture mensuelle automatique');
        nb := nb + 1;
      END IF;

      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
  RETURN nb;
END;
$$;

GRANT EXECUTE ON FUNCTION inserer_transaction_hors_point(uuid, date, numeric, numeric, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION retirer_transaction_hors_point(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION appliquer_factures_mensuelles() TO anon, authenticated;

-- Contrôle : fournisseurs à facture mensuelle et mois déjà facturés.
SELECT f.nom, r.nom AS resto, f.facture_mensuelle, f.facture_mensuelle_depuis, f.credit_actuel,
       (SELECT string_agg(to_char(x.mois, 'MM/YYYY'), ', ' ORDER BY x.mois)
          FROM factures_mensuelles_fournisseurs x WHERE x.fournisseur_id = f.id) AS mois_factures
  FROM fournisseurs f LEFT JOIN restaurants r ON r.id = f.restaurant_id
 WHERE f.facture_mensuelle > 0
 ORDER BY f.nom, r.nom;
