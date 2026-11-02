-- =====================================================================
--  OBJECTIFS DE VENTE PAR MOIS (02/11/2026)
--  À exécuter dans le SQL Editor (projet Samtrackly). Idempotent.
--
--  Un objectif par restaurant et par mois (décembre et janvier plus grands).
--  Un mois sans ligne reprend le dernier mois fixé avant lui ; avant toute
--  ligne, l'ancien objectif unique (restaurants.objectif_mensuel) s'applique.
--  montant NULL = objectif retiré à partir de ce mois.
--  Saisi dans Dashboard global → Objectifs → Fixer ; lu par l'accueil du
--  gérant, le Dashboard global, Rapports → Mensuel et Analyse.
-- =====================================================================

create table if not exists public.objectifs_restaurants (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  mois          date not null check (extract(day from mois) = 1),
  montant       numeric check (montant is null or montant >= 0),
  modifie_par   text,
  updated_at    timestamptz not null default now(),
  primary key (restaurant_id, mois)
);

alter table public.objectifs_restaurants enable row level security;
drop policy if exists allow_all on public.objectifs_restaurants;
create policy allow_all on public.objectifs_restaurants for all to public using (true) with check (true);

-- Contrôle : la table existe (0 ligne au départ, l'objectif actuel reste la base).
select count(*) as lignes from public.objectifs_restaurants;
