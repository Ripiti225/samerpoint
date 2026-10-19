-- ─────────────────────────────────────────────────────────────────────────────
-- Historique Google Sheets importé le 19/10/2026 (lot import_sheets_2026_10,
-- 1er nov. 2025 → 10 mai 2026) : les 1 335 journées importées arrivaient
-- validées mais NON vérifiées, et remplissaient la liste « À vérifier » (en
-- retard) de l'écran Vérification. Ce sont des archives : on les marque vérifiées.
--
-- Ne touche que les journées du lot importé ; « Vérifié par Import Sheets »
-- les distingue d'une vraie vérification. Aucun autre effet : la vérification
-- n'est qu'un drapeau sur la journée (app/verification.js, marquerVerifie).
-- À lancer dans Supabase > SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

update public.points
   set verifie = true,
       verifie_par = 'Import Sheets',
       verifie_at = now()
 where source = 'import_sheets_2026_10'
   and verifie is not true;

-- Contrôle : doit rendre 0.
select count(*) as journees_importees_non_verifiees
  from public.points
 where source = 'import_sheets_2026_10' and verifie is not true;

commit;

-- Retour arrière (seulement si besoin) :
-- update public.points set verifie = false, verifie_par = null, verifie_at = null
--  where source = 'import_sheets_2026_10' and verifie_par = 'Import Sheets';
