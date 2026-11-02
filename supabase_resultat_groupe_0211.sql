-- =====================================================================
--  RÉSULTAT DU GROUPE — corrections validées le 02/11/2026
--  À exécuter dans le SQL Editor de SAMTRACKLY. Idempotent.
--
--  1. Nouvelle catégorie de dépense direction « Autre dépense » (divers) :
--     une vraie dépense qui n'est ni réparation, ni matériel, ni équipement.
--  2. Cinq « Retrait perso · Groupe » d'octobre qui n'étaient pas des
--     retraits du patron passent en « Autre dépense » (1 et 2 ci-dessous).
--  3. Dettes du groupe dont les paiements comptent dans le résultat du
--     groupe : Alios Fronx, Alios Swift, Ali sable, ZABAD, mr adou, mme dali.
--  4. Dettes notées « Groupe » mais qui concernent un restaurant : posées
--     sur leur restaurant et comptées dans son résultat.
--  5. Marcel électricien « Plm 7em mrc » (120 000, payé le 12/10) : divisé
--     en trois dettes de 40 000 (Palmeraie, 7E, Maroc). Le paiement est
--     divisé de même, sur la même sortie de banque (un seul mouvement).
-- =====================================================================

-- ── 1. Catégorie « Autre dépense » ───────────────────────────────────
ALTER TABLE tresorerie_depenses_direction DROP CONSTRAINT IF EXISTS tresorerie_depenses_direction_categorie_check;
ALTER TABLE tresorerie_depenses_direction ADD CONSTRAINT tresorerie_depenses_direction_categorie_check
  CHECK (categorie IN ('fond','fond_nature','reparation','materiel','equipement','investissement','retrait_perso','administratif','divers'));

-- ── 2. Retraits perso qui sont de vraies dépenses du groupe ──────────
-- Police cadeau, Apk, Cheq impayé, djidji_octobre26, nicaise 7ème yako.
UPDATE tresorerie_mouvements m SET libelle = replace(m.libelle, 'Retrait perso · ', 'Autre dépense · ')
FROM tresorerie_depenses_direction d
WHERE d.mouvement_id = m.id AND d.categorie = 'retrait_perso'
  AND d.id IN ('645fff24-5c59-4417-b1d5-33c803b52d06', 'c5c22ef6-2dfb-414c-8d41-08fb582edc68',
               '386fa430-aa9b-4cea-9619-cedb0266e29e', 'a1daaa78-a347-42a5-89df-5f22cb857925',
               '02acd1e3-9f78-4bf7-b35b-2297eb3047ab');
UPDATE tresorerie_depenses_direction SET categorie = 'divers'
WHERE categorie = 'retrait_perso'
  AND id IN ('645fff24-5c59-4417-b1d5-33c803b52d06', 'c5c22ef6-2dfb-414c-8d41-08fb582edc68',
             '386fa430-aa9b-4cea-9619-cedb0266e29e', 'a1daaa78-a347-42a5-89df-5f22cb857925',
             '02acd1e3-9f78-4bf7-b35b-2297eb3047ab');

-- ── 3. Dettes du groupe cochées « Compte dans le résultat » ──────────
UPDATE tresorerie_dus SET categorie_direction = 'divers'
WHERE categorie = 'dette' AND id IN (
  '8262accc-f43e-4666-9953-66a6283fe947',  -- alios fronx
  '98f35cbb-8f29-4b9b-b501-2bdc701fd201',  -- alios swift
  'f4799673-bcb7-4e0a-ba7b-d51f3b2a7f03',  -- Ali sable
  'f160d4b8-df45-4b81-a4ec-3c9cdb6b023e',  -- ZABAD
  '60cf8a28-27fe-4d10-a081-86852e888a8d',  -- mr adou
  '8c490172-7deb-46eb-a759-59eb7ff5d074'   -- mme dali 2026
);

-- ── 4. Dettes d'un restaurant, saisies sur « Groupe » ────────────────
UPDATE tresorerie_dus SET restaurant_id = '0f05b4c4-2ed3-4ad8-a754-2139ad0f4823', categorie_direction = 'divers'  -- À la Braise
WHERE categorie = 'dette' AND id IN (
  '4ed07815-33e9-4550-b9cc-cc284b8346f7',  -- Marcel électricien (A la Braise)
  'ad5c3d0f-a80e-4853-8492-689a3905aa4b',  -- Romuald (a la braise)
  'cf9b30a5-47eb-482a-96ae-06d72ee3e573'   -- Soul (A la Braise)
);
UPDATE tresorerie_dus SET restaurant_id = 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9', categorie_direction = 'divers'  -- Samer Maroc
WHERE categorie = 'dette' AND id = '3b9c6b93-0300-49c1-8489-238f48aeb998';  -- Romuald (maroc)
UPDATE tresorerie_dus SET restaurant_id = '2f09688d-a4b9-4b14-8c45-943543953379', categorie_direction = 'divers'  -- Samer Angré 7E
WHERE categorie = 'dette' AND id = '5f4c4f52-bfbe-4b10-b3c5-cb29c794088d';  -- alpha (pour 7ème)

-- ── 5. Marcel électricien « Plm 7em mrc » : 3 × 40 000 ──────────────
DO $$
DECLARE
  v_du    uuid := 'da3fc639-3d7b-4d1a-b576-a0232d96482a';
  v_paie  uuid := 'f173aae1-59ac-4bc8-bea2-cd589efb445e';
  v_resto uuid;
  v_nouv  uuid;
  d tresorerie_dus;
  p tresorerie_paiements;
BEGIN
  SELECT * INTO d FROM tresorerie_dus WHERE id = v_du FOR UPDATE;
  -- Déjà fait (ou modifié depuis) : on ne touche à rien.
  IF NOT FOUND OR d.restaurant_id IS NOT NULL OR d.montant_du <> 120000 THEN RETURN; END IF;
  SELECT * INTO p FROM tresorerie_paiements WHERE id = v_paie AND du_id = v_du AND montant = 120000;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement de 120 000 introuvable : rien n''est changé.'; END IF;

  -- La fiche d'origine devient la part de Palmeraie.
  UPDATE tresorerie_dus SET restaurant_id = 'b862dfee-007f-413a-9de0-2c6e83b572ce', montant_du = 40000,
    categorie_direction = 'divers', note = 'Plm 7em mrc (part Palmeraie, 120 000 ÷ 3)'
  WHERE id = v_du;
  UPDATE tresorerie_paiements SET montant = 40000 WHERE id = v_paie;

  FOREACH v_resto IN ARRAY ARRAY['2f09688d-a4b9-4b14-8c45-943543953379', 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9']::uuid[] LOOP
    INSERT INTO tresorerie_dus (categorie, restaurant_id, creancier, montant_du, note, cree_par, cree_par_nom, created_at, categorie_direction)
    VALUES ('dette', v_resto, d.creancier, 40000,
            CASE WHEN v_resto = '2f09688d-a4b9-4b14-8c45-943543953379' THEN 'Plm 7em mrc (part 7E, 120 000 ÷ 3)'
                 ELSE 'Plm 7em mrc (part Maroc, 120 000 ÷ 3)' END,
            d.cree_par, d.cree_par_nom, d.created_at, 'divers')
    RETURNING id INTO v_nouv;
    -- Même versement (groupe) et même sortie de banque : la banque ne bouge pas.
    INSERT INTO tresorerie_paiements (du_id, groupe, montant, date, source, compte_id, mouvement_id, photo_url,
                                      cree_par, cree_par_nom, created_at, note)
    VALUES (v_nouv, p.groupe, 40000, p.date, p.source, p.compte_id, p.mouvement_id, p.photo_url,
            p.cree_par, p.cree_par_nom, p.created_at, p.note);
  END LOOP;
END $$;

-- ── Contrôles ─────────────────────────────────────────────────────────
-- Retraits du patron restants sur « Groupe » en octobre (doit faire 3 102 500 F, 12 lignes).
SELECT count(*) AS retraits_patron_oct, sum(montant) AS total
FROM tresorerie_depenses_direction
WHERE restaurant_id IS NULL AND categorie = 'retrait_perso' AND date >= '2026-10-01' AND date < '2026-11-01';
-- Marcel « Plm 7em mrc » : 3 lignes de 40 000, toujours un seul mouvement de banque de 120 000.
SELECT d.restaurant_id, d.montant_du, p.montant, p.mouvement_id
FROM tresorerie_dus d JOIN tresorerie_paiements p ON p.du_id = d.id
WHERE d.creancier = 'Marcel électricien' AND d.note LIKE 'Plm 7em mrc%';
