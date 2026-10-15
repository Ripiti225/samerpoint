-- =====================================================================
--  SUPERVISION DES RESTAURANTS
--
--  À exécuter dans le SQL Editor du projet Samtrackly (wlwotzxnzowbkbfcpnyi).
--  Idempotent : relançable sans dégât.
--
--  Le superviseur (rôle « superviseur », global) passe dans les restaurants :
--   1. supervision_criteres     grille de points notés (modifiable par le manager)
--   2. supervision_visites      une visite : heure + position d'arrivée et de départ,
--                               note /20, remarques, réponse / contestation du
--                               gérant, décision du manager
--   3. supervision_notes        la note (1 à 5 étoiles) de chaque point, photo, point grave
--   4. supervision_travailleurs les travailleurs vus : étoiles, retard, absence
--   5. supervision_taches       tâches à cocher : le gérant signale « faite » avec
--                               une photo, le superviseur confirme à sa visite
--   6. Tuile « Supervision » dans les menus du gérant et du RH.
--   7. supervision_pannes       matériel en panne (jusqu'à réparé / remplacé)
--   8. supervision_achats       suggestions d'achats (acceptées / refusées par le manager)
--
--  Calculs : lib/supervision.js ; lectures/écritures : lib/supervisionDb.js.
-- =====================================================================

-- ── 1. Grille ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_criteres (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  libelle     text NOT NULL,
  aide        text,                                -- ce qu'il faut regarder
  poids       int  NOT NULL DEFAULT 1 CHECK (poids BETWEEN 1 AND 10),
  ordre       int  NOT NULL DEFAULT 0,
  actif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO supervision_criteres (libelle, aide, poids, ordre)
SELECT * FROM (VALUES
  ('Propreté et hygiène',       'Salle, cuisine, toilettes, frigos, tenue des travailleurs', 3, 1),
  ('Documents à jour',          'Registres, contrats, autorisations, extincteurs',           2, 2),
  ('Ponctualité et présence',   'Travailleurs à l''heure et à leur poste',                   2, 3),
  ('Accueil et service client', 'Rapidité, politesse, présentation des plats',               3, 4)
) AS v(libelle, aide, poids, ordre)
WHERE NOT EXISTS (SELECT 1 FROM supervision_criteres);

-- ── 2. Visites ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_visites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES restaurants(id),
  superviseur_id      uuid,
  superviseur_nom     text,
  debut_at            timestamptz NOT NULL DEFAULT now(),
  fin_at              timestamptz,
  position_debut      jsonb,          -- { lat, lng, precision } ou { erreur }
  position_fin        jsonb,
  statut              text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','terminee','annulee')),
  note                numeric(4,1),   -- /20, calculée à la fin
  points_graves       int NOT NULL DEFAULT 0,
  remarques           text,           -- suggestions, compliments
  -- Le gérant a ouvert la visite (accusé de lecture)
  lu_gerant_at        timestamptz,
  lu_gerant_nom       text,
  -- Réponse du gérant ; conteste = il demande au manager de revoir la note
  reponse_gerant      text,
  reponse_gerant_nom  text,
  reponse_gerant_at   timestamptz,
  conteste            boolean NOT NULL DEFAULT false,
  -- Décision du manager sur une contestation
  decision            text CHECK (decision IN ('maintenue','corrigee')),
  note_corrigee       numeric(4,1),
  decision_motif      text,
  decision_par_nom    text,
  decision_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Saisie en cours (brouillon de l'écran), pour reprendre après une déconnexion
-- ou sur un autre téléphone. Vidée quand la visite est terminée ou abandonnée.
ALTER TABLE supervision_visites ADD COLUMN IF NOT EXISTS brouillon jsonb;
CREATE INDEX IF NOT EXISTS idx_sup_visites_resto ON supervision_visites (restaurant_id, debut_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_visites_statut ON supervision_visites (statut, debut_at DESC);

-- ── 3. Notes des points ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visite_id        uuid NOT NULL REFERENCES supervision_visites(id) ON DELETE CASCADE,
  critere_id       uuid REFERENCES supervision_criteres(id) ON DELETE SET NULL,
  critere_libelle  text NOT NULL,     -- copie : la grille peut changer ensuite
  poids            int  NOT NULL,
  note             int  NOT NULL CHECK (note BETWEEN 1 AND 5),
  commentaire      text,
  photo_url        text,
  grave            boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_notes_visite ON supervision_notes (visite_id);

-- ── 4. Travailleurs vus ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_travailleurs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visite_id        uuid NOT NULL REFERENCES supervision_visites(id) ON DELETE CASCADE,
  restaurant_id    uuid REFERENCES restaurants(id),
  travailleur_id   uuid REFERENCES travailleurs(id) ON DELETE SET NULL,
  travailleur_nom  text NOT NULL,
  poste            text,
  note             int CHECK (note BETWEEN 1 AND 5),   -- null si absent
  en_retard        boolean NOT NULL DEFAULT false,
  absent           boolean NOT NULL DEFAULT false,
  commentaire      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_trav_visite ON supervision_travailleurs (visite_id);
CREATE INDEX IF NOT EXISTS idx_sup_trav_travailleur ON supervision_travailleurs (travailleur_id, created_at DESC);

-- ── 5. Tâches ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_taches (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id               uuid NOT NULL REFERENCES restaurants(id),
  visite_id                   uuid REFERENCES supervision_visites(id) ON DELETE SET NULL,
  titre                       text NOT NULL,
  details                     text,
  importante                  boolean NOT NULL DEFAULT false,
  echeance                    date,
  responsable_nom             text,
  responsable_travailleur_id  uuid REFERENCES travailleurs(id) ON DELETE SET NULL,
  photo_constat_url           text,                   -- ce que le superviseur a vu
  statut                      text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire','signalee','faite','annulee')),
  -- Le gérant signale « faite » (photo obligatoire)
  signalee_par_nom            text,
  signalee_at                 timestamptz,
  signalee_photo_url          text,
  signalee_commentaire        text,
  -- Contrôles du superviseur
  nb_non_faite                int NOT NULL DEFAULT 0,  -- visites où elle n'était pas faite
  derniere_verif_at           timestamptz,
  derniere_verif_refus        text,                    -- pourquoi « pas faite » (ou photo refusée)
  faite_visite_id             uuid REFERENCES supervision_visites(id) ON DELETE SET NULL,
  faite_at                    timestamptz,
  faite_par_nom               text,
  faite_photo_url             text,
  demande_explication_id      uuid REFERENCES demandes_explication(id) ON DELETE SET NULL,
  cree_par_id                 uuid,
  cree_par_nom                text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_taches_resto ON supervision_taches (restaurant_id, statut, created_at DESC);

-- ── 7. Matériel en panne ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_pannes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES restaurants(id),
  visite_id           uuid REFERENCES supervision_visites(id) ON DELETE SET NULL,
  objet               text NOT NULL,                  -- « Friteuse 2 », « Clim salle »
  description         text,
  urgente             boolean NOT NULL DEFAULT false,
  photo_url           text,
  statut              text NOT NULL DEFAULT 'en_panne' CHECK (statut IN ('en_panne','reparee','remplacee','annulee')),
  signale_par_nom     text,
  repare_at           timestamptz,
  repare_par_nom      text,
  repare_commentaire  text,
  repare_photo_url    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_pannes_resto ON supervision_pannes (restaurant_id, statut, created_at DESC);

-- ── 8. Suggestions d'achats ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervision_achats (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES restaurants(id),
  visite_id           uuid REFERENCES supervision_visites(id) ON DELETE SET NULL,
  objet               text NOT NULL,                  -- « 2 chaises terrasse »
  raison              text,
  quantite            int NOT NULL DEFAULT 1 CHECK (quantite > 0),
  prix_estime         int,                            -- FCFA, si connu
  urgente             boolean NOT NULL DEFAULT false,
  photo_url           text,
  statut              text NOT NULL DEFAULT 'proposee' CHECK (statut IN ('proposee','acceptee','refusee','achetee')),
  propose_par_nom     text,
  decision_par_nom    text,
  decision_at         timestamptz,
  decision_motif      text,
  achete_at           timestamptz,
  achete_par_nom      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_achats_resto ON supervision_achats (restaurant_id, statut, created_at DESC);

-- RLS aligné sur le reste de l'app (permissif — cf. note sécurité)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supervision_criteres','supervision_visites','supervision_notes','supervision_travailleurs','supervision_taches','supervision_pannes','supervision_achats'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I', t);
    EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ── 6. Menus : tuile « Supervision » pour le gérant et le RH ────────────
UPDATE roles_acces
   SET tuiles = tuiles || '["supervision"]'::jsonb, updated_at = now()
 WHERE role IN ('gerant', 'rh') AND NOT (tuiles ? 'supervision');

-- =====================================================================
--  VÉRIFICATION (à lancer après) — doit renvoyer 1 ligne, tout à true :
-- =====================================================================
-- SELECT
--   (SELECT count(*) FROM supervision_criteres) >= 4 AS grille,
--   to_regclass('public.supervision_visites') IS NOT NULL AS visites,
--   to_regclass('public.supervision_taches') IS NOT NULL AS taches,
--   (SELECT tuiles ? 'supervision' FROM roles_acces WHERE role='gerant') AS tuile_gerant,
--   to_regclass('public.supervision_pannes') IS NOT NULL AS pannes,
--   to_regclass('public.supervision_achats') IS NOT NULL AS achats;
