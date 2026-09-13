-- ════════════════════════════════════════════════════════════════════════════
--  Bascule POS Samer → Samtrackly
--  Spéc : docs/superpowers/specs/2026-08-17-pos-samer-vers-samtrackly-design.md
--
--  Rejouable sans risque (tout est IF NOT EXISTS / idempotent).
--
--  ⚠ LE POINT LE PLUS IMPORTANT DE CE FICHIER
--  `restaurants.source_point` vaut 'SAMTRACKLY' par défaut, pour TOUS les
--  restaurants existants. Passer cette migration ne change donc RIEN au
--  comportement d'un seul site. La bascule d'un site est un UPDATE explicite,
--  fait à la main, un site à la fois (voir la fin du fichier).
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Qui alimente le point d'un restaurant ────────────────────────────────
--
--    ⚠⚠ CE DRAPEAU NE DIT PAS SI LE SITE A LE POS. ⚠⚠
--    Il dit si le point de ce site ARRIVE du POS. Deux faits différents :
--      • Angré 7E a le POS installé et il tourne — depuis des semaines.
--      • Et pourtant ses caissières tapent encore leur point ICI, à la main
--        (vérifié le 2026-08-17 : 3 shifts/jour, tous saisis à la main).
--
--    Mettre un site en 'POS' AVANT que le POS ne pousse réellement, c'est faire
--    disparaître ses caissières de l'écran de connexion sans que rien ne les
--    remplace : le point de la journée n'atterrit NULLE PART. Trois shifts de
--    recette perdus par jour, sans message d'erreur.
--
--    RÈGLE ABSOLUE : on ne bascule un site qu'après avoir vu au moins un shift
--    arriver du POS pour ce site (pos_service_id non nul, cf. section 6).
--
--    'SAMTRACKLY' : le caissier fait son point dans Samtrackly (comportement
--                   historique, défaut de toute nouvelle ligne, et état correct
--                   d'un site qui a le POS mais dont la remontée n'existe pas).
--    'POS'        : le point de ce site arrive du POS, qui pousse ici.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS source_point TEXT NOT NULL DEFAULT 'SAMTRACKLY';

-- La contrainte est posée à part : ADD COLUMN IF NOT EXISTS ne rejoue pas le
-- CHECK, et on veut que le fichier soit rejouable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_source_point_check'
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_source_point_check
      CHECK (source_point IN ('SAMTRACKLY', 'POS'));
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.source_point IS
  'SAMTRACKLY = le caissier saisit son point dans Samtrackly. POS = le POS le pousse. '
  'Se retire en un UPDATE : c''est la sortie de secours quand la caisse d''un site tombe.';


-- ── 2. Le pont entre le login Samtrackly et la RH ───────────────────────────
--    `points_shifts.caissier_id` référence utilisateurs(id), or le POS ne
--    connaît que l'id `travailleurs` (via son propre `utilisateurs.externe_id`).
--    Les deux tables n'avaient AUCUN lien. Sans ce pont, un shift poussé par le
--    POS est anonyme, et tout ce qui filtre par caissier devient aveugle
--    (déductions de vérification, stats caissiers, litiges).
ALTER TABLE public.utilisateurs
  ADD COLUMN IF NOT EXISTS travailleur_id UUID REFERENCES public.travailleurs(id);

CREATE INDEX IF NOT EXISTS idx_utilisateurs_travailleur
  ON public.utilisateurs (travailleur_id)
  WHERE travailleur_id IS NOT NULL;

COMMENT ON COLUMN public.utilisateurs.travailleur_id IS
  'Fiche RH correspondante. Le POS envoie un id travailleurs ; c''est par ici qu''on '
  'retrouve le compte utilisateurs attendu par points_shifts.caissier_id.';


-- ── 3. Ce que le POS ajoute sur un shift ────────────────────────────────────

--    Clé d'idempotence : l'id du service POS d'origine. Un renvoi après
--    coupure réseau retombe sur la même ligne au lieu d'en créer une seconde.
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS pos_service_id UUID;

--    Contrainte UNIQUE simple, pas d'index partiel. Deux NULL ne sont jamais
--    égaux en SQL : les shifts saisis à la main (pos_service_id NULL) restent
--    donc illimités et sans contrainte, exactement comme avec un WHERE — sauf
--    qu'une contrainte simple est aussi la seule forme que PostgREST sait
--    utiliser comme cible d'un ON CONFLICT (pos_service_id) lors de l'upsert
--    du pont. Un index partiel produit l'erreur 42P10 « no unique or
--    exclusion constraint matching the ON CONFLICT specification » — trouvé
--    en production le 2026-08-18, sur les 4 premiers shifts du pont.
--
--    Rejouable : une contrainte UNIQUE crée elle-même un index du même nom.
--    Il faut donc tester la contrainte AVANT l'index, sinon un second passage
--    tente de supprimer l'index requis par la contrainte et échoue en 2BP01.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'un_points_shifts_pos_service'
      AND conrelid = 'public.points_shifts'::regclass
  ) THEN
    RETURN;
  END IF;

  -- Un ancien index autonome du même nom empêcherait l'ADD CONSTRAINT.
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'un_points_shifts_pos_service') THEN
    DROP INDEX public.un_points_shifts_pos_service;
  END IF;

  ALTER TABLE public.points_shifts
    ADD CONSTRAINT un_points_shifts_pos_service UNIQUE (pos_service_id);
END $$;

--    Les retours : articles envoyés en cuisine puis supprimés par un
--    responsable. Colonne SÉPARÉE de `retour`, et volontairement.
--    `calculerVenteShift()` (app/modifier-point.js:181) somme `retour`. Si le
--    montant y était écrit, la première correction d'un manager le ferait
--    rentrer dans la vente et l'écart bougerait tout seul, des semaines plus
--    tard. Aucune formule ne doit sommer `retour_pos`.
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS retour_pos NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.points_shifts.retour_pos IS
  'Montant des articles envoyés en cuisine puis annulés. INFORMATION SEULE : '
  'ne jamais l''additionner dans vente_shift (cf. retour, qui reste à 0).';

--    L'écart mesuré par le POS au comptage à l'aveugle, pour CE caissier.
--    Négatif = manquant. Un shift = un caissier, donc la liste « Marie Paule
--    +2500 / Hilary −2500 » se déduit des shifts du jour, sans colonne JSONB.
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS ecart_pos NUMERIC;

COMMENT ON COLUMN public.points_shifts.ecart_pos IS
  'Écart espèces du tiroir fourni par services_caisse.ecart (comptées − théorique), '
  'négatif = manquant. Ne jamais l''utiliser comme écart global de réconciliation.';

--    L'écart global officiel, déjà figé dans le rapport Z du POS. Le pont copie
--    `rapport_z.diff` exactement : aucune formule et aucun repli sur ecart_pos.
--    BIGINT garantit un montant entier en FCFA. NULL signale une ancienne
--    clôture dont le rapport Z ne contenait pas encore cette donnée.
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS ecart_reconciliation BIGINT;

COMMENT ON COLUMN public.points_shifts.ecart_reconciliation IS
  'Copie exacte de rapport_z.diff (vente_totale - total_systeme), en FCFA. '
  'NULL = rapport Z historique indisponible. Ne jamais recalculer ni remplacer '
  'par ecart_pos, qui est uniquement l''écart espèces du tiroir.';

--    Les deux comptes de commandes partenaires vus par le POS. Le gérant garde
--    sa propre saisie dans points.yango_nb_commandes : l'écart entre les deux
--    est un contrôle croisé volontaire avec les apps partenaires.
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS pos_nb_yango INTEGER;
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS pos_nb_glovo INTEGER;
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS pos_nb_contacts INTEGER;


-- ── 4. Vérification ─────────────────────────────────────────────────────────
--    À exécuter après la migration. Doit lister les 7 restaurants, tous en
--    'SAMTRACKLY'. Si un seul est déjà en 'POS', quelqu'un a basculé un site
--    sans le dire.
--
--      SELECT id, nom, source_point FROM public.restaurants ORDER BY nom;
--
--    État vérifié le 2026-08-17 : les 7 sites en 'SAMTRACKLY', migration passée.


-- ── 5. Basculer un site — À FAIRE À LA MAIN, UN SITE À LA FOIS ──────────────
--
--    ⚠ NE JAMAIS CHERCHER UN RESTAURANT PAR SON NOM.
--    Quatre des sept noms portent une ESPACE FINALE en base ('Al Kayan KMS ',
--    'Samer Lavage ', 'Samer Maroc ', 'Samer Oasis '), et un nom mal orthographié
--    ne provoque AUCUNE erreur : l'UPDATE renvoie « 0 rows » et on croit le site
--    basculé alors que rien n'a bougé. Pire, une faute peut viser le mauvais
--    site. On passe donc toujours par l'id.
--
--    Identifiants relevés en production le 2026-08-17 :
--      c12f15b9-6149-4b56-be2b-6e82ab447216   Al Kayan KMS
--      268695fe-972e-468e-b2b7-4e7f268dec4f   Al Kayan Yop
--      2f09688d-a4b9-4b14-8c45-943543953379   Samer Angré 7E    ← PILOTE
--      99eb7f7e-baab-4159-872a-34a086374f49   Samer Lavage
--      f4550ccf-fa52-4e56-b4bb-9cea4a155df9   Samer Maroc
--      ce8a00d8-0908-46b7-ad2f-c9b29d54f03f   Samer Oasis
--      b862dfee-007f-413a-9de0-2c6e83b572ce   Samer Palmeraie   ← 2e site
--
--    Ne PAS décommenter ici : la bascule se fait au SQL Editor, quand le site est
--    prêt. Pilote = Samer Angré 7E, une semaine minimum d'observation avant
--    d'ouvrir Samer Palmeraie.
--
--    BASCULER (le RETURNING affiche le résultat : si rien ne s'affiche, rien
--    n'a été modifié — ne pas supposer que c'est passé) :
--
--      UPDATE public.restaurants SET source_point = 'POS'
--       WHERE id = '2f09688d-a4b9-4b14-8c45-943543953379'
--      RETURNING nom, source_point;
--
--    RETOUR ARRIÈRE (panne de la caisse, un soir, en urgence) :
--
--      UPDATE public.restaurants SET source_point = 'SAMTRACKLY'
--       WHERE id = '2f09688d-a4b9-4b14-8c45-943543953379'
--      RETURNING nom, source_point;
--
--    Les comptes caissiers ne sont jamais désactivés ni supprimés : ils sont
--    seulement masqués à la connexion. Cet UPDATE les fait réapparaître
--    immédiatement, au prochain chargement de l'app.


-- ── 6. LE FEU VERT — à passer AVANT de basculer un site ─────────────────────
--    Un site ne se bascule pas parce que la caisse est installée, mais parce
--    qu'on a VU un shift arriver du POS. Cette requête est le contrôle :
--
--      SELECT r.nom,
--             r.source_point,
--             COUNT(s.pos_service_id)                        AS shifts_du_pos,
--             COUNT(*) - COUNT(s.pos_service_id)             AS shifts_saisis_main,
--             MAX(s.date)                                    AS dernier_shift
--        FROM public.restaurants r
--        LEFT JOIN public.points_shifts s ON s.restaurant_id = r.id
--                                       AND s.date > current_date - 7
--       GROUP BY r.nom, r.source_point
--       ORDER BY r.nom;
--
--    Lecture :
--      • shifts_du_pos = 0        → NE PAS BASCULER. La remontée ne marche pas.
--      • shifts_du_pos > 0        → la remontée fonctionne, on peut basculer.
--      • les deux colonnes > 0    → normal pendant la journée de bascule (une
--                                   partie des shifts saisie à la main avant le
--                                   changement, le reste venu du POS après).
--                                   Anormal les jours SUIVANTS : quelqu'un
--                                   saisit encore à la main un site basculé.
--
--    État au 2026-08-17 : Angré 7E a le POS installé, et shifts_du_pos = 0.
--    Ce site doit donc rester en 'SAMTRACKLY'.
