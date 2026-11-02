-- ════════════════════════════════════════════════════════════════════════════
-- À PASSER DANS LE SQL EDITOR DU PROJET « pos-samer-cloud » (PAS Samtrackly).
-- 02/11/2026 — Analyse et conseils du rapport mensuel de Samtrackly.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tous les plats ACTIFS de la carte avec ce qu'ils ont vendu sur la période
-- (0 s'ils n'ont rien vendu) : repère les plats qui ne se vendent pas.
-- Fonction à part de stats_dashboard pour ne pas ralentir le Dashboard.
-- Seulement des totaux par plat (aucune commande, aucun client).
-- Journée d'exploitation : de 6 h à 6 h, comme stats_dashboard.
-- p_restaurant : id Samtrackly du restaurant (restaurants.samtrackly_id), ou
-- NULL pour tous (les plats de même nom sont alors additionnés).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.stats_plats(p_debut date, p_fin date, p_restaurant uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
set enable_nestloop = off
as $$
with r as (
  select restaurant_id from restaurants where p_restaurant is null or samtrackly_id = p_restaurant
),
c as (
  select c.id from commandes c
  where c.restaurant_id in (select restaurant_id from r) and c.statut = 'PAYEE'
    and c.created_at >= ((p_debut + time '06:00') at time zone 'UTC')
    and c.created_at <  ((p_fin + 1 + time '06:00') at time zone 'UTC')
),
v as (
  select i.article_id, sum(i.quantite) as qte, sum(i.quantite * i.prix_unitaire) as ca
  from commande_items i join c on c.id = i.commande_id
  where coalesce(i.statut_cuisine, '') <> 'ANNULE' and i.article_id is not null
  group by 1
),
a as (
  select a.id, a.nom, a.prix_base, cat.nom as categorie
  from articles a left join categories cat on cat.id = a.categorie_id
  where a.restaurant_id in (select restaurant_id from r) and a.actif
)
select coalesce(jsonb_agg(x order by x.qte, x.nom), '[]') from (
  select a.nom, max(a.categorie) as categorie, max(a.prix_base) as prix,
         coalesce(sum(v.qte), 0) as qte, coalesce(sum(v.ca), 0) as ca
  from a left join v on v.article_id = a.id
  group by a.nom
) x;
$$;

grant execute on function public.stats_plats(date, date, uuid) to anon, authenticated;

-- Vérification : la liste des plats, les moins vendus d'abord.
-- select public.stats_plats(current_date - 30, current_date);
