-- =====================================================================
--  Groupes de restaurants — 22/10/2026
--  Projet Samtrackly (wlwotzxnzowbkbfcpnyi). Idempotente : se repasse sans risque.
--
--  Un groupe (Groupe Samer, Groupe Al Kayan) porte des fiches administratives
--  qui n'appartiennent à aucun restaurant : arriérés CNPS (un compte CNPS par
--  marque), anciens travailleurs d'un site fermé (Zone 4). Seule la direction
--  les paie ; le paiement compte au résultat « tous restaurants » seulement.
--  Spéc : docs/superpowers/specs/2026-10-22-groupes-cnps-anciens-travailleurs-design.md
-- =====================================================================

do $$
begin
  if to_regclass('public.tresorerie_depenses_direction') is null
     or not exists (select 1 from information_schema.columns
                    where table_name = 'fournisseurs' and column_name = 'depart_le') then
    raise exception 'Mauvais projet ou migrations manquantes : passez d''abord supabase_droits_anciens_travailleurs.sql (projet Samtrackly wlwotzxnzowbkbfcpnyi).';
  end if;
end $$;

CREATE TABLE IF NOT EXISTS groupes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE groupes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON groupes;
CREATE POLICY allow_all ON groupes FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE SET NULL;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE RESTRICT;
ALTER TABLE tresorerie_depenses_direction ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE SET NULL;

-- Une fiche de groupe est administrative et n'a pas de restaurant.
DO $$ BEGIN
  ALTER TABLE fournisseurs ADD CONSTRAINT fournisseurs_groupe_check
    CHECK (groupe_id IS NULL OR (restaurant_id IS NULL AND type = 'administratif'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS fournisseurs_groupe_idx ON fournisseurs (groupe_id) WHERE groupe_id IS NOT NULL;

INSERT INTO groupes (nom) VALUES ('Groupe Samer'), ('Groupe Al Kayan') ON CONFLICT (nom) DO NOTHING;

UPDATE restaurants SET groupe_id = (SELECT id FROM groupes WHERE nom = 'Groupe Samer')
 WHERE id IN ('2f09688d-a4b9-4b14-8c45-943543953379', '99eb7f7e-baab-4159-872a-34a086374f49',
              'f4550ccf-fa52-4e56-b4bb-9cea4a155df9', 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f',
              'b862dfee-007f-413a-9de0-2c6e83b572ce');
UPDATE restaurants SET groupe_id = (SELECT id FROM groupes WHERE nom = 'Groupe Al Kayan')
 WHERE id IN ('c12f15b9-6149-4b56-be2b-6e82ab447216', '268695fe-972e-468e-b2b7-4e7f268dec4f');

-- Paiement direction : identique à la version en service (lue en base le
-- 22/10), plus le groupe de la fiche sur la dépense.
CREATE OR REPLACE FUNCTION tresorerie_payer_fournisseur_admin(
  p_fournisseur uuid, p_date date, p_montant bigint, p_source text, p_compte_id uuid,
  p_note text, p_user_id text, p_user_nom text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  fo record;
  v_libelle text;
  v_mvt uuid;
  v_coffre uuid;
  v_tx uuid;
  v_id uuid;
BEGIN
  SELECT id, nom, type, restaurant_id, groupe_id INTO fo FROM fournisseurs WHERE id = p_fournisseur;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable.'; END IF;
  IF fo.type IS DISTINCT FROM 'administratif' THEN
    RAISE EXCEPTION 'Seul un fournisseur administratif se paie depuis la direction.';
  END IF;
  IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Montant manquant'; END IF;
  IF p_source = 'compte' AND p_compte_id IS NULL THEN RAISE EXCEPTION 'Choisissez le compte.'; END IF;

  v_libelle := 'Administratif · ' || fo.nom || coalesce(' · ' || nullif(trim(p_note), ''), '');
  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -p_montant, 'direction', v_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  ELSIF p_source = 'coffre' THEN
    INSERT INTO tresorerie_coffre_mouvements (date, montant, type, source, libelle, cree_par, cree_par_nom)
    VALUES (p_date, -p_montant, 'depense', 'coffre', v_libelle, p_user_id, p_user_nom)
    RETURNING id INTO v_coffre;
  END IF;

  v_tx := inserer_transaction_hors_point(fo.id, p_date, 0, p_montant, 'direction', 'paiement_direction', p_user_nom);

  INSERT INTO tresorerie_depenses_direction (date, categorie, restaurant_id, groupe_id, montant, source, compte_id, mouvement_id,
    coffre_mouvement_id, note, fournisseur_id, transaction_id, cree_par, cree_par_nom)
  VALUES (p_date, 'administratif', fo.restaurant_id, fo.groupe_id, p_montant, p_source,
    CASE WHEN p_source = 'compte' THEN p_compte_id END, v_mvt, v_coffre,
    coalesce(fo.nom || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_note), fo.id, v_tx, p_user_id, p_user_nom)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';

-- Contrôle : 5 restaurants Samer, 2 Al Kayan, À la Braise sans groupe.
SELECT coalesce(g.nom, '(aucun groupe)') AS groupe, string_agg(trim(r.nom), ', ' ORDER BY r.nom) AS restaurants
  FROM restaurants r LEFT JOIN groupes g ON g.id = r.groupe_id
 GROUP BY g.nom ORDER BY g.nom;
