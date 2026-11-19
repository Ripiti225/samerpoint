-- ─────────────────────────────────────────────────────────────────────────────
-- CLÔTURE DU MOIS — à passer dans Supabase > SQL Editor (projet Samtrackly).
-- 19/11/2026 · Comptabilité → Clôture du mois (app/cloture-mois.js).
--
-- Une fois un mois clôturé (tout le groupe), plus personne ne peut ajouter,
-- modifier ni supprimer une journée de ce mois : le point et ses shifts,
-- dépenses, présences, transactions fournisseurs et inventaires. Les lignes
-- sans journée (factures mensuelles fournisseurs) ne sont pas concernées.
--
-- Pourquoi dans la base : la clé de l'app est publique, et une dizaine d'écrans
-- (Modifier un point, Correction, Corbeille, déplacement de shift…) plus le pont
-- POS écrivent dans les journées. Seul un trigger les arrête tous.
--
-- Clôturer : cloturer_mois(mois, manager) — refusé si le mois n'est pas terminé
-- ou si une journée n'est pas validée ET vérifiée.
-- Rouvrir : rouvrir_mois(mois, manager, motif) — motif obligatoire.
-- La table ne s'écrit que par ces deux fonctions (aucun droit d'écriture direct).
--
-- Maintenance volontaire : couper le verrou d'une table puis le remettre :
--   alter table public.points disable trigger trg_verrou_mois_cloture;
--   …  alter table public.points enable trigger trg_verrou_mois_cloture;
-- ─────────────────────────────────────────────────────────────────────────────
begin;

create table if not exists public.clotures_mois (
  mois date primary key check (extract(day from mois) = 1),
  statut text not null check (statut in ('cloture', 'rouvert')),
  cloture_le timestamptz,
  cloture_par uuid references public.utilisateurs(id),
  rouvert_le timestamptz,
  rouvert_par uuid references public.utilisateurs(id),
  motif_reouverture text
);

alter table public.clotures_mois enable row level security;
drop policy if exists clotures_mois_lecture on public.clotures_mois;
create policy clotures_mois_lecture on public.clotures_mois for select using (true);
revoke insert, update, delete, truncate on public.clotures_mois from anon, authenticated;
grant select on public.clotures_mois to anon, authenticated;

-- « 2026-10-01 » → « Octobre 2026 » (messages d'erreur).
create or replace function public.libelle_mois_fr(p date) returns text
language sql immutable as $$
  select (array['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août',
                'Septembre', 'Octobre', 'Novembre', 'Décembre'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int
$$;

create or replace function public.mois_est_cloture(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clotures_mois
                  where mois = date_trunc('month', p_date)::date and statut = 'cloture')
$$;

-- Verrou : sur points (par sa date) et sur ses tables filles (par point_id).
create or replace function public.verrou_mois_cloture() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d date;
begin
  if tg_table_name = 'points' then
    if tg_op <> 'DELETE' and mois_est_cloture(new.date::date) then
      d := new.date::date;
    end if;
    if d is null and tg_op <> 'INSERT' and mois_est_cloture(old.date::date) then
      d := old.date::date;
    end if;
  else
    if tg_op <> 'DELETE' and new.point_id is not null then
      select p.date::date into d from points p
       where p.id = new.point_id and mois_est_cloture(p.date::date);
    end if;
    if d is null and tg_op <> 'INSERT' and old.point_id is not null then
      select p.date::date into d from points p
       where p.id = old.point_id and mois_est_cloture(p.date::date);
    end if;
  end if;

  if d is not null then
    raise exception '% est clôturé : cette journée ne peut plus être modifiée. Le manager peut rouvrir le mois depuis Comptabilité → Clôture du mois.',
      libelle_mois_fr(d);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verrou_mois_cloture on public.points;
create trigger trg_verrou_mois_cloture
  before insert or update or delete on public.points
  for each row execute function public.verrou_mois_cloture();

drop trigger if exists trg_verrou_mois_cloture on public.points_shifts;
create trigger trg_verrou_mois_cloture
  before insert or update or delete on public.points_shifts
  for each row execute function public.verrou_mois_cloture();

drop trigger if exists trg_verrou_mois_cloture on public.depenses;
create trigger trg_verrou_mois_cloture
  before insert or update or delete on public.depenses
  for each row execute function public.verrou_mois_cloture();

drop trigger if exists trg_verrou_mois_cloture on public.presences;
create trigger trg_verrou_mois_cloture
  before insert or update or delete on public.presences
  for each row execute function public.verrou_mois_cloture();

drop trigger if exists trg_verrou_mois_cloture on public.transactions_fournisseurs;
create trigger trg_verrou_mois_cloture
  before insert or update or delete on public.transactions_fournisseurs
  for each row execute function public.verrou_mois_cloture();

drop trigger if exists trg_verrou_mois_cloture on public.inventaires_shifts;
create trigger trg_verrou_mois_cloture
  before insert or update or delete on public.inventaires_shifts
  for each row execute function public.verrou_mois_cloture();

-- Clôturer un mois terminé dont toutes les journées sont validées et vérifiées.
create or replace function public.cloturer_mois(p_mois date, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_mois)::date;
  n int;
begin
  if not exists (select 1 from utilisateurs where id = p_user and role = 'manager') then
    raise exception 'Seul le manager peut clôturer un mois.';
  end if;
  if m >= date_trunc('month', now() at time zone 'Africa/Abidjan')::date then
    raise exception '% n''est pas terminé : il ne peut pas encore être clôturé.', libelle_mois_fr(m);
  end if;
  select count(*) into n from points
   where date::date >= m and date::date < (m + interval '1 month')::date
     and (coalesce(valide, false) = false or coalesce(verifie, false) = false);
  if n > 0 then
    raise exception '% : % journée(s) pas encore validée(s) et vérifiée(s).', libelle_mois_fr(m), n;
  end if;

  insert into clotures_mois (mois, statut, cloture_le, cloture_par)
  values (m, 'cloture', now(), p_user)
  on conflict (mois) do update set statut = 'cloture', cloture_le = now(), cloture_par = p_user;
  return jsonb_build_object('mois', m, 'statut', 'cloture');
end;
$$;

-- Rouvrir un mois clôturé, motif obligatoire.
create or replace function public.rouvrir_mois(p_mois date, p_user uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_mois)::date;
begin
  if not exists (select 1 from utilisateurs where id = p_user and role = 'manager') then
    raise exception 'Seul le manager peut rouvrir un mois.';
  end if;
  if coalesce(trim(p_motif), '') = '' then
    raise exception 'Écrivez pourquoi vous rouvrez le mois.';
  end if;
  update clotures_mois
     set statut = 'rouvert', rouvert_le = now(), rouvert_par = p_user, motif_reouverture = trim(p_motif)
   where mois = m and statut = 'cloture';
  if not found then
    raise exception '% n''est pas clôturé.', libelle_mois_fr(m);
  end if;
  return jsonb_build_object('mois', m, 'statut', 'rouvert');
end;
$$;

revoke execute on function public.cloturer_mois(date, uuid) from public;
revoke execute on function public.rouvrir_mois(date, uuid, text) from public;
grant execute on function public.cloturer_mois(date, uuid) to anon, authenticated;
grant execute on function public.rouvrir_mois(date, uuid, text) to anon, authenticated;

commit;

-- ── Contrôle (après avoir clôturé un mois, ex. octobre 2026) ────────────────
-- Doit échouer avec « Octobre 2026 est clôturé : … » :
-- update public.points set valide = valide
--  where id = (select id from public.points where date >= '2026-10-01' and date < '2026-11-01' limit 1);
-- État des clôtures :
-- select * from public.clotures_mois order by mois desc;
