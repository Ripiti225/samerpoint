-- ════════════════════════════════════════════════════════════════════════════
-- À PASSER DANS LE SQL EDITOR DU PROJET « pos-samer-cloud » (PAS Samtrackly).
-- ════════════════════════════════════════════════════════════════════════════
--
-- Détail des KDO (commandes offertes) de plusieurs services de caisse, pour
-- l'écran « Point caissier » de Samtrackly : produits offerts et motif saisi
-- par le caissier (« chef ali », « Invité de la maison »…).
--
-- Seules les commandes offertes PAYÉES comptent : leur somme est exactement
-- le montant KDO du shift transmis par le pont (points_shifts.kdo). Les
-- articles annulés en cuisine sont écartés.
--
-- SECURITY DEFINER, comme stats_dashboard : Samtrackly la lit avec la clé
-- publique du POS sans ouvrir les tables. Il faut connaître l'identifiant du
-- service (uuid) pour obtenir quoi que ce soit.
-- Idempotent — rejouable sans risque.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.kdo_services(p_services uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.heure), '[]') from (
    select c.service_id as service, c.numero_ticket as ticket, c.created_at as heure,
           c.total, c.motif_offert as motif,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'nom', i.nom_snapshot, 'qte', i.quantite, 'prix', i.prix_unitaire,
                     'supplements', i.supplements) order by i.nom_snapshot), '[]')
              from commande_items i
             where i.commande_id = c.id and i.restaurant_id = c.restaurant_id
               and coalesce(i.statut_cuisine, '') <> 'ANNULE') as articles
      from commandes c
     where c.service_id = any(p_services) and c.offert and c.statut = 'PAYEE'
  ) x;
$$;

grant execute on function public.kdo_services(uuid[]) to anon;
