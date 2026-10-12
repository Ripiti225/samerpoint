-- =====================================================================
--  CORRECTION PONCTUELLE — réceptions partenaires du 05/10/2026
--
--  Les réceptions ont été validées avec la case « Montant réellement reçu »
--  préremplie avec l'attendu ; le vrai montant du relevé a été tapé dans la
--  NOTE. Ce script remet le montant de la note sur la réception ET sur
--  l'entrée en banque liée (Glovo 22/09, Wave 28/09, Yango 25/09).
--  Les réceptions OM (pas de montant en note) ne sont pas touchées.
--
--  Puis il supprime le « Reçu banque » de 370 429 F ajouté à la main sur
--  BACI à 13h30 : doublon du Glovo 22/09 d'Al Kayan Yop.
--
--  À passer UNE fois dans le SQL Editor (Samtrackly). Sans effet si rejoué :
--  une réception déjà corrigée a son montant = sa note et est ignorée.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE corr ON COMMIT DROP AS
SELECT l.id, l.mouvement_id, l.restaurant_id, l.partenaire, l.periode_debut,
       l.montant AS ancien, (l.note)::bigint AS nouveau
  FROM tresorerie_partenaire_lignes l
 WHERE l.type = 'recu'
   AND l.note ~ '^-?[0-9]+$' AND (l.note)::bigint <> l.montant
   AND l.id IN (
     'd426ab77-c2e0-48fd-bdce-8ce4cd873c72',  -- Glovo 22/09 · Al Kayan KMS     174 755 → 166 512
     'b84abc9b-5b8e-4550-82f4-b5067958de60',  -- Glovo 22/09 · Samer Lavage     132 614 → 127 481
     '27d61002-dd93-4efe-8263-5db31c983624',  -- Glovo 22/09 · Samer Maroc      142 953 → 138 576
     'bf52c9f1-6aa7-43e5-a3b3-e5016437362f',  -- Glovo 22/09 · Samer Oasis        2 996 →    −236
     '22f05924-9fe5-44be-b4da-bb656ddb6b83',  -- Glovo 22/09 · Samer Palmeraie 1 064 732 → 1 018 290
     'a3077d68-384f-4e73-9536-3e4899f7e9b7',  -- Wave 28/09 · Al Kayan Yop      100 485 → 132 165
     '37cd806d-5e5e-48a3-b8d8-9886c41ad054',  -- Wave 28/09 · Samer Maroc       354 420 → 354 421
     'd43c0f50-4083-4678-95ed-a09c17e8f077',  -- Wave 28/09 · Samer Palmeraie   170 775 → 198 495
     'b61e4720-1a65-4c6b-845f-81fcc8bd7db7'   -- Yango 25/09 · groupe         1 742 202 → 1 778 534
   );

UPDATE tresorerie_partenaire_lignes l SET montant = c.nouveau FROM corr c WHERE l.id = c.id;

-- Chaque entrée en banque = somme des réceptions qui lui sont liées
-- (fonctionne aussi pour une entrée groupée sur une tête de fond).
UPDATE tresorerie_mouvements m SET montant = s.total
  FROM (SELECT l.mouvement_id, SUM(l.montant) AS total
          FROM tresorerie_partenaire_lignes l
         WHERE l.mouvement_id IN (SELECT mouvement_id FROM corr)
         GROUP BY 1) s
 WHERE m.id = s.mouvement_id;

INSERT INTO journal_activite (action, details, restaurant_id, user_nom)
SELECT 'tresorerie_partenaire_recu_corrige',
       jsonb_build_object('partenaire', c.partenaire, 'periode_debut', c.periode_debut,
                          'ancien', c.ancien, 'nouveau', c.nouveau,
                          'motif', 'Montant du relevé tapé dans la note (case préremplie avec l''attendu validée telle quelle)'),
       c.restaurant_id, 'Script SQL (correction 05/10)'
  FROM corr c;

-- Doublon BACI : « Reçu banque » 370 429 F sans libellé, ajouté à la main.
INSERT INTO journal_activite (action, details, user_nom)
SELECT 'tresorerie_mouvement_supprime',
       jsonb_build_object('compte', 'BACI', 'type', m.type, 'montant', m.montant, 'date', m.date,
                          'motif', 'Doublon du Glovo 22/09 Al Kayan Yop (déjà enregistré par la réception partenaire)'),
       'Script SQL (correction 05/10)'
  FROM tresorerie_mouvements m
 WHERE m.id = '5affaad3-d231-492c-b5f4-cf2f53c3bd26' AND m.type = 'recu_banque' AND m.montant = 370429;
DELETE FROM tresorerie_mouvements
 WHERE id = '5affaad3-d231-492c-b5f4-cf2f53c3bd26' AND type = 'recu_banque' AND montant = 370429;

COMMIT;

-- Contrôle : chaque réception doit être égale à sa note, et à son entrée en banque.
SELECT l.partenaire, l.periode_debut, COALESCE(r.nom, '(groupe)') AS resto,
       l.montant AS recu, l.note, m.montant AS banque, c.nom AS compte
  FROM tresorerie_partenaire_lignes l
  LEFT JOIN restaurants r ON r.id = l.restaurant_id
  LEFT JOIN tresorerie_mouvements m ON m.id = l.mouvement_id
  LEFT JOIN tresorerie_comptes c ON c.id = l.compte_id
 WHERE l.type = 'recu' AND l.created_at >= '2026-10-01'
 ORDER BY l.partenaire, r.nom;
