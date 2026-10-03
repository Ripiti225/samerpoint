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
