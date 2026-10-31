-- Paie : taux d'accident du travail par société + en-tête Al Kayan (31/10/2026).
-- D'après les bulletins Sage de juillet 2026 : Chez Samer 2 %, Al Kayan 3 %.
-- À passer dans le SQL Editor de Samtrackly, APRÈS supabase_paie.sql.

alter table public.employeurs_paie
  add column if not exists taux_accident_travail integer
  check (taux_accident_travail is null or taux_accident_travail between 1 and 1000);
comment on column public.employeurs_paie.taux_accident_travail is
  'Accident du travail en pour dix mille (300 = 3 %). Vide = taux des paramètres (2 %).';

-- M. Adou est responsable administratif des deux sociétés.
update public.employeurs_paie set
  responsable           = 'M. ADOU ERIC JC',
  telephone             = '07 79 69 63 70 / 05 66 96 86 72',
  taux_accident_travail = 200,
  updated_at            = now()
where marque = 'samer';

update public.employeurs_paie set
  raison_sociale        = 'AL KAYAN',
  adresse               = '21 BP 915 ABIDJAN 21',
  ville                 = 'ABIDJAN YOPOUGON',
  responsable           = 'M. ADOU ERIC JC',
  telephone             = '07 79 69 63 70 / 05 66 96 86 72',
  taux_accident_travail = 300,
  updated_at            = now()
where marque = 'alkayan';

-- Contrôle : samer 200, alkayan 300, M. ADOU ERIC JC sur les deux.
select marque, raison_sociale, adresse, ville, responsable, taux_accident_travail
from public.employeurs_paie order by marque;
