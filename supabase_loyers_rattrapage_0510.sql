-- =====================================================================
--  CORRECTION PONCTUELLE — loyers impayés oubliés (05/10/2026)
--
--  Le dernier loyer réellement impayé est :
--    • Samer Palmeraie : février 2026 → ajoute février et mars 2026
--      (avril → octobre existent déjà) ;
--    • Al Kayan KMS    : mars 2026    → ajoute mars et avril 2026
--      (mai → octobre existent déjà).
--  Montant = celui du réglage loyer du restaurant (tresorerie_loyers) ;
--  date limite = le jour réglé (25) du mois suivant, comme les autres mois.
--  Les autres champs (libellé, créancier…) sont copiés du plus ancien mois
--  déjà présent, pour que les nouveaux mois s'affichent pareil.
--
--  À passer UNE fois dans le SQL Editor (Samtrackly). Sans effet si rejoué :
--  un mois qui existe déjà n'est pas recréé.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE a_ajouter ON COMMIT DROP AS
SELECT l.restaurant_id, m.mois::date AS mois, l.montant, l.jour_echeance
  FROM (VALUES
          ('b862dfee-007f-413a-9de0-2c6e83b572ce'::uuid, '2026-02-01'::date),  -- Samer Palmeraie
          ('b862dfee-007f-413a-9de0-2c6e83b572ce'::uuid, '2026-03-01'::date),
          ('c12f15b9-6149-4b56-be2b-6e82ab447216'::uuid, '2026-03-01'::date),  -- Al Kayan KMS
          ('c12f15b9-6149-4b56-be2b-6e82ab447216'::uuid, '2026-04-01'::date)
       ) AS m(restaurant_id, mois)
  JOIN tresorerie_loyers l ON l.restaurant_id = m.restaurant_id
 WHERE NOT EXISTS (SELECT 1 FROM tresorerie_dus d
                    WHERE d.categorie = 'loyer' AND d.restaurant_id = m.restaurant_id AND d.mois = m.mois);

INSERT INTO tresorerie_dus
  (categorie, restaurant_id, mois, montant_du, echeance, libelle, creancier, categorie_direction, cree_par_nom)
SELECT 'loyer', a.restaurant_id, a.mois, a.montant,
       (a.mois + interval '1 month' + make_interval(days => a.jour_echeance - 1))::date,
       modele.libelle, modele.creancier, modele.categorie_direction,
       'Script SQL (rattrapage loyers 05/10)'
  FROM a_ajouter a
  LEFT JOIN LATERAL (
    SELECT d.libelle, d.creancier, d.categorie_direction
      FROM tresorerie_dus d
     WHERE d.categorie = 'loyer' AND d.restaurant_id = a.restaurant_id
     ORDER BY d.mois
     LIMIT 1) modele ON true;

INSERT INTO journal_activite (action, details, restaurant_id, user_nom)
SELECT 'tresorerie_loyer_regle',
       jsonb_build_object('mois_ajoutes', jsonb_agg(to_char(a.mois, 'YYYY-MM') ORDER BY a.mois),
                          'montant', max(a.montant),
                          'motif', 'Loyers impayés oubliés au réglage (dernier impayé réel)'),
       a.restaurant_id, 'Script SQL (rattrapage loyers 05/10)'
  FROM a_ajouter a
 GROUP BY a.restaurant_id;

COMMIT;

-- Contrôle : tous les loyers de Palmeraie et KMS, avec ce qui reste à payer.
SELECT r.nom AS resto, to_char(d.mois, 'MM/YYYY') AS mois, d.montant_du, d.echeance,
       d.montant_du - coalesce((SELECT sum(p.montant) FROM tresorerie_paiements p WHERE p.du_id = d.id), 0) AS reste
  FROM tresorerie_dus d JOIN restaurants r ON r.id = d.restaurant_id
 WHERE d.categorie = 'loyer'
   AND d.restaurant_id IN ('b862dfee-007f-413a-9de0-2c6e83b572ce', 'c12f15b9-6149-4b56-be2b-6e82ab447216')
 ORDER BY r.nom, d.mois;
