-- =====================================================================
--  TRÉSORERIE — étape 1 : comptes bancaires, dus (loyers, salaires, CNPS,
--  admin, dettes), paiements et droits par section.
--
--  À exécuter dans le SQL Editor de Supabase (projet Samtrackly).
--  Idempotent : relançable sans dégât.
--  Voir docs/superpowers/specs/2026-10-01-tresorerie-socle-design.md
--  Montants en FCFA entiers.
-- =====================================================================

-- ── Comptes bancaires ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tresorerie_comptes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text NOT NULL UNIQUE,
  ordre      int  NOT NULL DEFAULT 0,
  actif      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tresorerie_comptes (nom, ordre) VALUES ('BACI', 1), ('SIB', 2)
ON CONFLICT (nom) DO NOTHING;

-- Solde d'un compte = somme de ses mouvements (signés).
CREATE TABLE IF NOT EXISTS tresorerie_mouvements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compte_id    uuid NOT NULL REFERENCES tresorerie_comptes(id),
  date         date NOT NULL DEFAULT current_date,
  montant      bigint NOT NULL,
  type         text NOT NULL CHECK (type IN ('recalage','recu_banque','paiement','autre')),
  libelle      text,
  photo_url    text,
  cree_par     text,
  cree_par_nom text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treso_mvt_compte ON tresorerie_mouvements (compte_id, date DESC);

-- ── Loyers fixes par restaurant ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS tresorerie_loyers (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id),
  montant       bigint NOT NULL CHECK (montant > 0),
  jour_echeance int NOT NULL DEFAULT 5 CHECK (jour_echeance BETWEEN 1 AND 31),
  mois_depart   date NOT NULL CHECK (extract(day FROM mois_depart) = 1),
  actif         boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Tout ce qu'on doit ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tresorerie_dus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie     text NOT NULL CHECK (categorie IN ('loyer','salaire','cnps','admin','dette')),
  restaurant_id uuid REFERENCES restaurants(id),
  mois          date CHECK (mois IS NULL OR extract(day FROM mois) = 1),
  libelle       text,
  creancier     text,
  montant_du    bigint NOT NULL CHECK (montant_du >= 0),
  echeance      date,
  note          text,
  cree_par      text,
  cree_par_nom  text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT du_mensuel_complet CHECK (
    categorie NOT IN ('loyer','salaire','cnps') OR (restaurant_id IS NOT NULL AND mois IS NOT NULL)
  ),
  CONSTRAINT du_dette_creancier CHECK (categorie <> 'dette' OR coalesce(trim(creancier), '') <> '')
);
-- Un seul loyer / état de salaires / déclaration CNPS par restaurant et par mois.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_treso_du_mensuel
  ON tresorerie_dus (categorie, restaurant_id, mois)
  WHERE categorie IN ('loyer','salaire','cnps');
CREATE INDEX IF NOT EXISTS idx_treso_du_categorie ON tresorerie_dus (categorie, mois);

-- ── Paiements (partiels possibles) ───────────────────────────────────
-- Un versement couvrant plusieurs mois = plusieurs lignes du même `groupe`.
-- Payé depuis un compte : `mouvement_id` pointe la sortie de banque.
CREATE TABLE IF NOT EXISTS tresorerie_paiements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  du_id        uuid NOT NULL REFERENCES tresorerie_dus(id) ON DELETE CASCADE,
  groupe       uuid NOT NULL,
  montant      bigint NOT NULL CHECK (montant > 0),
  date         date NOT NULL DEFAULT current_date,
  source       text NOT NULL CHECK (source IN ('compte','especes')),
  compte_id    uuid REFERENCES tresorerie_comptes(id),
  mouvement_id uuid REFERENCES tresorerie_mouvements(id) ON DELETE SET NULL,
  photo_url    text,
  cree_par     text,
  cree_par_nom text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paiement_compte_coherent CHECK ((source = 'compte') = (compte_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_treso_paie_du ON tresorerie_paiements (du_id);
CREATE INDEX IF NOT EXISTS idx_treso_paie_groupe ON tresorerie_paiements (groupe);

-- ── Droits par section ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tresorerie_droits (
  user_id    text PRIMARY KEY,
  user_nom   text,
  niveau     text NOT NULL CHECK (niveau IN ('proprietaire','lecture','saisie_rh')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Paiement atomique : les lignes de paiement + la sortie de banque ─
-- p_parts : [{"du_id": "...", "montant": 1000}, ...]
CREATE OR REPLACE FUNCTION tresorerie_payer(
  p_parts     jsonb,
  p_source    text,
  p_compte_id uuid,
  p_date      date,
  p_libelle   text,
  p_photo_url text,
  p_user_id   text,
  p_user_nom  text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_groupe uuid := gen_random_uuid();
  v_total  bigint;
  v_mvt    uuid;
BEGIN
  SELECT coalesce(sum((x->>'montant')::bigint), 0) INTO v_total
  FROM jsonb_array_elements(p_parts) x;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Montant du paiement manquant';
  END IF;

  IF p_source = 'compte' THEN
    INSERT INTO tresorerie_mouvements (compte_id, date, montant, type, libelle, photo_url, cree_par, cree_par_nom)
    VALUES (p_compte_id, p_date, -v_total, 'paiement', p_libelle, p_photo_url, p_user_id, p_user_nom)
    RETURNING id INTO v_mvt;
  END IF;

  INSERT INTO tresorerie_paiements (du_id, groupe, montant, date, source, compte_id, mouvement_id, photo_url, cree_par, cree_par_nom)
  SELECT (x->>'du_id')::uuid, v_groupe, (x->>'montant')::bigint, p_date, p_source,
         CASE WHEN p_source = 'compte' THEN p_compte_id END, v_mvt, p_photo_url, p_user_id, p_user_nom
  FROM jsonb_array_elements(p_parts) x
  WHERE (x->>'montant')::bigint > 0;

  RETURN v_groupe;
END $$;

-- Annule un versement entier (toutes ses lignes + sa sortie de banque).
CREATE OR REPLACE FUNCTION tresorerie_annuler_paiement(p_groupe uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_mvts uuid[];
BEGIN
  SELECT array_agg(DISTINCT mouvement_id) FILTER (WHERE mouvement_id IS NOT NULL)
    INTO v_mvts FROM tresorerie_paiements WHERE groupe = p_groupe;
  DELETE FROM tresorerie_paiements WHERE groupe = p_groupe;
  IF v_mvts IS NOT NULL THEN
    DELETE FROM tresorerie_mouvements WHERE id = ANY (v_mvts);
  END IF;
END $$;

-- ── RLS : même régime que le reste de l'app (clé anon, accès ouvert) ─
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tresorerie_comptes','tresorerie_mouvements','tresorerie_loyers',
                           'tresorerie_dus','tresorerie_paiements','tresorerie_droits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION tresorerie_payer(jsonb, text, uuid, date, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tresorerie_annuler_paiement(uuid) TO anon, authenticated;
