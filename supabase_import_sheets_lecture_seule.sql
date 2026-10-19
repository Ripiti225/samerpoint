-- ─────────────────────────────────────────────────────────────────────────────
-- Historique Google Sheets importé (lot import_sheets_2026_10, 1er nov. 2025 →
-- 10 mai 2026) : journées en LECTURE SEULE.
--
-- Pourquoi : modifier les ventes d'une journée validée reporte l'écart de fond
-- sur TOUTES les journées suivantes (app/modifier-point.js, reporterFondPointValide).
-- Corriger une journée de décembre décalerait le fond de toutes les vraies
-- journées jusqu'à aujourd'hui.
--
-- Bloque, pour les journées importées : modification et suppression de la
-- journée (sauf la case « vérifié »), et ajout / modification / suppression de
-- leurs dépenses, présences, transactions fournisseurs et inventaires.
-- Les vraies journées (depuis le 10-11 mai 2026) ne sont pas concernées.
--
-- Pour une maintenance volontaire (ex. scripts/import-sheets/rollback.sql),
-- couper d'abord le garde-fou :
--   alter table public.points disable trigger trg_lecture_seule_import_sheets;
--   (idem sur depenses, presences, transactions_fournisseurs, inventaires_shifts)
-- puis le remettre avec « enable trigger ».
-- À lancer dans Supabase > SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

create or replace function public.lecture_seule_import_sheets()
returns trigger
language plpgsql
as $$
declare
  lot constant text := 'import_sheets_2026_10';
  message constant text := 'Journée importée des anciens sheets (avant le 11 mai 2026) : lecture seule, elle ne peut pas être modifiée.';
  libres constant text[] := array['verifie', 'verifie_par', 'verifie_at', 'updated_at'];
begin
  if tg_table_name = 'points' then
    if tg_op = 'UPDATE' and old.source = lot then
      if (to_jsonb(new) - libres) = (to_jsonb(old) - libres) then
        return new;  -- seule la vérification change
      end if;
      raise exception '%', message;
    elsif tg_op = 'DELETE' and old.source = lot then
      raise exception '%', message;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Tables rattachées à une journée (point_id).
  if tg_op <> 'DELETE' then
    if exists (select 1 from public.points p where p.id = new.point_id and p.source = lot) then
      raise exception '%', message;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    if exists (select 1 from public.points p where p.id = old.point_id and p.source = lot) then
      raise exception '%', message;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lecture_seule_import_sheets on public.points;
create trigger trg_lecture_seule_import_sheets
  before update or delete on public.points
  for each row execute function public.lecture_seule_import_sheets();

drop trigger if exists trg_lecture_seule_import_sheets on public.depenses;
create trigger trg_lecture_seule_import_sheets
  before insert or update or delete on public.depenses
  for each row execute function public.lecture_seule_import_sheets();

drop trigger if exists trg_lecture_seule_import_sheets on public.presences;
create trigger trg_lecture_seule_import_sheets
  before insert or update or delete on public.presences
  for each row execute function public.lecture_seule_import_sheets();

drop trigger if exists trg_lecture_seule_import_sheets on public.transactions_fournisseurs;
create trigger trg_lecture_seule_import_sheets
  before insert or update or delete on public.transactions_fournisseurs
  for each row execute function public.lecture_seule_import_sheets();

drop trigger if exists trg_lecture_seule_import_sheets on public.inventaires_shifts;
create trigger trg_lecture_seule_import_sheets
  before insert or update or delete on public.inventaires_shifts
  for each row execute function public.lecture_seule_import_sheets();

commit;

-- Contrôle (doit échouer avec le message « lecture seule ») :
-- update public.points set vente_total = vente_total + 1
--  where id = (select id from public.points where source = 'import_sheets_2026_10' limit 1);
