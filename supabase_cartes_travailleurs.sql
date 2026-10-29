-- =====================================================================
--  CARTES TRAVAILLEURS : QR de vérification + badge rendu au départ
--  (29/10/2026). À exécuter UNE fois dans le SQL Editor du projet SAMTRACKLY.
--
--  • cartes_travailleurs : une ligne par carte imprimée. Son `id` est le code
--    secret mis dans le QR du verso. Une nouvelle carte rend la précédente
--    « remplacée ». Validité : 6 mois (calculée par l'application).
--  • verifier_carte(jeton) : seule porte ouverte à la page publique
--    /verifier.html. Ne renvoie que nom, poste, photo, restaurant, validité
--    et l'état — jamais la CNI, la naissance, le téléphone ni le salaire.
--      valide     = travailleur non archivé (actif ou inactif), carte la plus
--                   récente, pas expirée
--      parti      = travailleur archivé
--      remplacee  = une carte plus récente a été imprimée
--      expiree    = date de validité dépassée
--  • travailleurs.badge_rendu : demandé à l'archivage. NULL = archivé avant
--    cette version (on ne sait pas).
--  Relancer le script ne casse rien (if not exists / or replace).
-- =====================================================================

create table if not exists public.cartes_travailleurs (
  id             uuid primary key default gen_random_uuid(),
  travailleur_id uuid not null references public.travailleurs(id) on delete cascade,
  emise_le       timestamptz not null default now(),
  valide_jusqua  date not null,
  emise_par      text
);
create index if not exists cartes_travailleurs_trav_idx
  on public.cartes_travailleurs (travailleur_id, emise_le desc);

alter table public.cartes_travailleurs enable row level security;
drop policy if exists "lecture cartes_travailleurs" on public.cartes_travailleurs;
create policy "lecture cartes_travailleurs" on public.cartes_travailleurs for select using (true);
drop policy if exists "emission cartes_travailleurs" on public.cartes_travailleurs;
create policy "emission cartes_travailleurs" on public.cartes_travailleurs for insert with check (true);

alter table public.travailleurs add column if not exists badge_rendu    boolean;
alter table public.travailleurs add column if not exists badge_rendu_le date;

create or replace function public.verifier_carte(p_jeton uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'nom',           t.nom,
    'poste',         t.poste,
    'photo_url',     t.photo_url,
    'restaurant',    trim(r.nom),
    'couleur',       r.couleur,
    'valide_jusqua', c.valide_jusqua,
    'emise_le',      c.emise_le,
    'etat', case
      when t.statut = 'archive' then 'parti'
      when exists (
        select 1 from public.cartes_travailleurs c2
        where c2.travailleur_id = c.travailleur_id and c2.emise_le > c.emise_le
      ) then 'remplacee'
      when c.valide_jusqua < (now() at time zone 'Africa/Abidjan')::date then 'expiree'
      else 'valide'
    end)
  from public.cartes_travailleurs c
  join public.travailleurs t on t.id = c.travailleur_id
  left join public.restaurants r on r.id = t.restaurant_id
  where c.id = p_jeton
$$;

grant execute on function public.verifier_carte(uuid) to anon, authenticated;

-- Contrôle : doit renvoyer 1 ligne (table) et 2 colonnes (badge_rendu, badge_rendu_le).
select (select count(*) from information_schema.tables where table_name = 'cartes_travailleurs') as table_ok,
       (select count(*) from information_schema.columns where table_name = 'travailleurs' and column_name like 'badge_rendu%') as colonnes_ok;
