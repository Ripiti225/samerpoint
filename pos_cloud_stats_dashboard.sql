-- ════════════════════════════════════════════════════════════════════════════
-- À PASSER DANS LE SQL EDITOR DU PROJET « pos-samer-cloud » (PAS Samtrackly).
-- ════════════════════════════════════════════════════════════════════════════
--
-- Statistiques du POS pour le Dashboard global de Samtrackly : heures de
-- pointe, jours forts, canaux, modes de paiement, plats les plus vendus,
-- annulations et remises.
--
-- La fonction ne renvoie QUE des totaux (aucune commande, aucun client, aucun
-- nom de caissier). Elle passe outre les règles d'accès (SECURITY DEFINER)
-- pour que Samtrackly puisse la lire avec la clé publique du POS, sans ouvrir
-- les tables elles-mêmes.
--
-- Journée d'exploitation : de 6 h à 6 h le lendemain (une commande de 1 h du
-- matin compte pour la veille, comme le service qui l'a encaissée).
-- Abidjan est à l'heure UTC toute l'année : pas de décalage horaire.
--
-- p_restaurant : id Samtrackly du restaurant (restaurants.samtrackly_id), ou
-- NULL pour tous les restaurants.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.stats_dashboard(p_debut date, p_fin date, p_restaurant uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
-- Indispensable : dans une fonction, PostgreSQL prépare la requête sans
-- connaître les dates et choisit des boucles imbriquées (8 s pour 7 jours,
-- au-delà des 3 s permises par la clé publique). Sans elles : 0,2 s pour un mois.
set enable_nestloop = off
as $$
with c as (
  select c.id, c.statut, c.type, c.partenaire, c.origine, c.total, c.remise_montant, c.promo_montant,
         c.offert, c.created_at, r.samtrackly_id,
         (c.created_at - interval '6 hours')::date as jour_service
  from commandes c
  join restaurants r on r.restaurant_id = c.restaurant_id
  where c.created_at >= ((p_debut + time '06:00') at time zone 'UTC')
    and c.created_at <  ((p_fin + 1 + time '06:00') at time zone 'UTC')
    and (p_restaurant is null or r.samtrackly_id = p_restaurant)
),
payees as (select * from c where statut = 'PAYEE')
select jsonb_build_object(
  'totaux', (select jsonb_build_object(
      'nb', (select count(*) from payees),
      'ca', (select coalesce(sum(total), 0) from payees),
      'annulees', (select count(*) from c where statut = 'ANNULEE'),
      'remises', (select coalesce(sum(remise_montant), 0) from payees),
      'nb_remises', (select count(*) from payees where remise_montant > 0),
      'promos', (select coalesce(sum(promo_montant), 0) from payees),
      'offerts', (select count(*) from c where offert))),
  'par_heure', (select coalesce(jsonb_agg(x order by x.h), '[]') from (
      select extract(hour from created_at)::int as h, count(*) as nb, sum(total) as ca
      from payees group by 1) x),
  -- Même découpage, canal par canal : la bulle « Heures de pointe » montre
  -- par où sont sorties les commandes de chaque heure.
  'par_heure_type', (select coalesce(jsonb_agg(x), '[]') from (
      select extract(hour from created_at)::int as h, type, partenaire, origine, count(*) as nb, sum(total) as ca
      from payees group by 1, 2, 3, 4) x),
  'semaine', (select coalesce(jsonb_agg(x), '[]') from (
      select extract(isodow from jour_service)::int as j, extract(hour from created_at)::int as h, count(*) as nb
      from payees group by 1, 2) x),
  'par_jour', (select coalesce(jsonb_agg(x order by x.d), '[]') from (
      select jour_service as d, count(*) as nb, sum(total) as ca from payees group by 1) x),
  'par_type', (select coalesce(jsonb_agg(x), '[]') from (
      select type, partenaire, origine, count(*) as nb, sum(total) as ca from payees group by 1, 2, 3) x),
  'paiements', (select coalesce(jsonb_agg(x), '[]') from (
      select p.mode, count(*) as nb, sum(p.montant) as montant
      from paiements p join payees on payees.id = p.commande_id group by 1) x),
  'top', (select coalesce(jsonb_agg(x order by x.qte desc), '[]') from (
      select i.nom_snapshot as nom, sum(i.quantite) as qte, sum(i.quantite * i.prix_unitaire) as ca
      from commande_items i join payees on payees.id = i.commande_id
      where coalesce(i.statut_cuisine, '') <> 'ANNULE'
      group by 1 order by 2 desc limit 10) x),
  -- Les mêmes plats, canal par canal : la jauge « Plats les plus vendus »
  -- montre par où chacun est sorti (sur place, Glovo, Yango…).
  'top_type', (select coalesce(jsonb_agg(x), '[]') from (
      select i.nom_snapshot as nom, payees.type, payees.partenaire, payees.origine,
             sum(i.quantite) as qte, sum(i.quantite * i.prix_unitaire) as ca
      from commande_items i join payees on payees.id = i.commande_id
      where coalesce(i.statut_cuisine, '') <> 'ANNULE'
        and i.nom_snapshot in (
          select i2.nom_snapshot from commande_items i2 join payees p2 on p2.id = i2.commande_id
          where coalesce(i2.statut_cuisine, '') <> 'ANNULE'
          group by 1 order by sum(i2.quantite) desc limit 10)
      group by 1, 2, 3, 4) x),
  'annulations_cuisine', (select jsonb_build_object('nb', count(*), 'montant', coalesce(sum(i.quantite * i.prix_unitaire), 0))
      from commande_items i join c on c.id = i.commande_id
      where i.statut_cuisine = 'ANNULE' and i.envoye_le is not null),
  'par_resto', (select coalesce(jsonb_agg(x), '[]') from (
      select samtrackly_id as id, count(*) as nb, sum(total) as ca,
             mode() within group (order by extract(hour from created_at)::int) as pic
      from payees group by 1) x)
);
$$;

grant execute on function public.stats_dashboard(date, date, uuid) to anon, authenticated;

-- Vérification : doit renvoyer un objet JSON avec « totaux », « par_heure »…
-- select public.stats_dashboard(current_date - 7, current_date);

-- ════════════════════════════════════════════════════════════════════════════
-- Ventes par service de caisse (un service = le shift d'un caissier) : nombre
-- de commandes payées, montant, et l'identifiant POS du caissier (u) — qui
-- servira à renvoyer sa note au bon caissier dans le POS. Samtrackly retrouve le caissier par
-- points_shifts.pos_service_id et en tire son ticket moyen, comparé à celui de
-- son restaurant (bonus « ventes additionnelles » de la note des caissiers).
-- Aucun nom ni client : seulement l'identifiant du service et deux totaux.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.stats_services(p_debut date, p_fin date)
returns jsonb
language sql
stable
security definer
set search_path = public
set enable_nestloop = off
as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select c.service_id as s, sc.caissier_id as u, count(*) as nb, sum(c.total) as ca
    from commandes c
    left join services_caisse sc on sc.id = c.service_id
    where c.statut = 'PAYEE' and c.service_id is not null
      and c.created_at >= ((p_debut + time '06:00') at time zone 'UTC')
      and c.created_at <  ((p_fin + 1 + time '06:00') at time zone 'UTC')
    group by 1, 2
  ) x;
$$;

grant execute on function public.stats_services(date, date) to anon, authenticated;

-- Vérification : une liste de { s, u, nb, ca }.
-- select public.stats_services(current_date - 7, current_date);
