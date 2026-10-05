-- Rattrapage du 05/10/2026 : salaires absents de points.depense_total
--
-- Le pont POS n'écrit que les achats dans points_shifts.depenses (la paie part
-- en présences). recap-point.js additionnait cette colonne brute à la
-- validation : les salaires des caissiers manquaient dans depense_total.
-- Correctif applicatif : lib/depensesShift.js (commit aa2c64f).
--
-- Bon montant d'un shift (dépenses + salaires + fournisseurs) :
--   vente_shift − (kdo + retour + yango_cse + glovo_cse + wave + djamo + om + espece)
--
-- On ne touche QUE les points validés dont depense_total vaut encore
-- exactement la formule de validation (shifts bruts + caisse gérant) : un point
-- retouché à la main garde sa valeur. Anciennes valeurs sauvegardées avant.

begin;

create table if not exists sauvegarde_depense_total_0510 as
select p.id as point_id, p.date, p.restaurant_id, p.depense_total, now() as sauvegarde_le
from points p
where false;

-- Sauvegarde interne : invisible pour la clé anon de l'application.
alter table sauvegarde_depense_total_0510 enable row level security;

with sh as (
  select s.point_id,
    sum(s.vente_shift - (coalesce(s.kdo,0) + coalesce(s.retour,0) + coalesce(s.yango_cse,0)
      + coalesce(s.glovo_cse,0) + coalesce(s.wave,0) + coalesce(s.djamo,0)
      + coalesce(s.om,0) + coalesce(s.espece,0))) as bon,
    sum(s.depenses) as brut,
    bool_and(s.vente_shift is not null) as complet
  from points_shifts s
  group by s.point_id
),
cibles as (
  select p.id, p.date, p.restaurant_id, p.depense_total, sh.bon - sh.brut as a_ajouter
  from points p
  join sh on sh.point_id = p.id
  where p.valide
    and sh.complet
    and sh.bon - sh.brut > 0
    and p.date >= '2026-08-15'
    and p.depense_total = sh.brut + coalesce(p.depenses_gerant_caisse_total, 0)
),
sauvegarde as (
  insert into sauvegarde_depense_total_0510 (point_id, date, restaurant_id, depense_total, sauvegarde_le)
  select id, date, restaurant_id, depense_total, now() from cibles
  returning point_id
)
update points p
set depense_total = p.depense_total + c.a_ajouter
from cibles c
where p.id = c.id
  and p.id in (select point_id from sauvegarde);

commit;

-- Contrôle attendu : 191 points, 8 756 001 FCFA ajoutés.
-- select count(*), sum(p.depense_total - s.depense_total)
-- from sauvegarde_depense_total_0510 s join points p on p.id = s.point_id;
--
-- Retour arrière :
-- update points p set depense_total = s.depense_total
-- from sauvegarde_depense_total_0510 s where p.id = s.point_id;
