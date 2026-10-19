-- ─────────────────────────────────────────────────────────────────────────────
-- Historique Google Sheets importé le 19/10/2026 (lot import_sheets_2026_10,
-- 1er nov. 2025 → 10 mai 2026) : AFFICHAGE SEULEMENT.
--
-- Les 14 522 lignes fournisseurs importées portaient leur propre reste et leur
-- crédit veille. L'application lit le crédit d'un fournisseur dans le reste de
-- sa dernière ligne : 26 fournisseurs sans saisie depuis (Viande qualité Lavage
-- 94 000, CNPS Maroc 50 000…) affichaient un faux crédit, et le crédit
-- fournisseurs des Résultats (mai 2026 et avant) bougeait.
--
-- Ici : reste = 0 et crédit veille = 0 sur ces lignes, comme si facture = payé.
-- Facture et payé du sheet restent visibles tels quels. Aucune autre ligne,
-- aucun compteur officiel (credit_actuel) n'est touché.
--
-- Les valeurs d'origine sont d'abord copiées dans import_sheets_2026_10_sauvegarde
-- (pour revenir en arrière : voir en bas). À lancer dans Supabase > SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

create table if not exists public.import_sheets_2026_10_sauvegarde as
  select id, reste, credit
  from public.transactions_fournisseurs
  where source = 'import_sheets_2026_10';

update public.transactions_fournisseurs
   set reste = 0, credit = 0
 where source = 'import_sheets_2026_10'
   and (reste <> 0 or credit <> 0);

-- Contrôle : doit rendre 0 ligne restante avec un reste ou un crédit.
select count(*) as lignes_encore_non_nulles
  from public.transactions_fournisseurs
 where source = 'import_sheets_2026_10' and (reste <> 0 or credit <> 0);

commit;

-- Retour arrière (seulement si besoin) :
-- update public.transactions_fournisseurs t
--    set reste = s.reste, credit = s.credit
--   from public.import_sheets_2026_10_sauvegarde s
--  where t.id = s.id;
