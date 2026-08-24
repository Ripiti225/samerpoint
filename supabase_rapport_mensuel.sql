-- ─────────────────────────────────────────────────────────────────────────
--  RAPPORT MENSUEL — objectifs de chiffre d'affaires par restaurant
--
--  À passer dans Supabase → SQL Editor, une seule fois.
--
--  Seule migration nécessaire pour le rapport mensuel : les départs de
--  travailleurs sont DÉJÀ tracés par travailleurs.archived_at / archive_motif
--  (écrits par app/rh.js à l'archivage), aucune colonne à ajouter côté RH.
-- ─────────────────────────────────────────────────────────────────────────

-- Objectif de CA mensuel, en FCFA. NULL = pas d'objectif fixé pour ce
-- restaurant : le rapport affiche alors « — » au lieu d'un taux d'atteinte.
alter table restaurants
  add column if not exists objectif_mensuel numeric;

comment on column restaurants.objectif_mensuel is
  'Objectif de chiffre d''affaires mensuel en FCFA. NULL = aucun objectif fixé. Saisi depuis l''écran Restaurants, utilisé par le rapport mensuel.';
