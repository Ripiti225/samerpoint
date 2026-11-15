-- ════════════════════════════════════════════════════════════════════════════
-- À PASSER DANS LE SQL EDITOR DU PROJET « pos-samer-cloud » (PAS Samtrackly).
-- 15/11/2026 — Vérification → Stock : quels plats ont consommé chaque produit.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Plats vendus (commandes PAYÉES, articles non annulés) de plusieurs services
-- de caisse : un total par service et par plat. Aucune commande, aucun client,
-- aucun montant. Même modèle que kdo_services (pos_cloud_kdo_services.sql).
-- Les suppléments payants sont renvoyés à part (« Fromage » +1 000 F…).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.plats_services(p_services uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with it as (
    select c.service_id, i.nom_snapshot, i.quantite, i.supplements
      from commandes c
      join commande_items i on i.commande_id = c.id and i.restaurant_id = c.restaurant_id
     where c.service_id = any(p_services) and c.statut = 'PAYEE'
       and coalesce(i.statut_cuisine, '') <> 'ANNULE'
  ),
  plats as (
    select service_id as s, nom_snapshot as nom, false as supplement, sum(quantite) as qte
      from it group by 1, 2
  ),
  supps as (
    select it.service_id as s, x->>'nom' as nom, true as supplement, sum(it.quantite) as qte
      from it, jsonb_array_elements(case when jsonb_typeof(it.supplements) = 'array' then it.supplements else '[]'::jsonb end) x
     where coalesce((x->>'prix')::numeric, 0) > 0
     group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('s', s, 'nom', nom, 'supplement', supplement, 'qte', qte) order by s, nom), '[]')
    from (select * from plats union all select * from supps) t;
$$;

grant execute on function public.plats_services(uuid[]) to anon, authenticated;

-- Vérification :
-- select public.plats_services(array(select id from services_caisse order by ouvert_le desc limit 2));
