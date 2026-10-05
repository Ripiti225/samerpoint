-- =====================================================================
--  SALAIRES PAYÉS PAR LE GÉRANT → FICHE DU TRAVAILLEUR
--
--  Les salaires payés depuis « Déductions gérant » sont enregistrés dans
--  `depenses` (categorie 'Paie', saisi_par 'gerant') avec le NOM seulement :
--  la fiche du travailleur (Équipe globale) ne pouvait pas les retrouver,
--  ni les compter dans son total.
--
--  Ce script :
--   1. ajoute `travailleur_id` à `depenses` (et à `depenses_gerant_caisse`,
--      où l'app l'envoyait déjà : l'enregistrement de ces lignes échouait) ;
--   2. rattache les paies déjà enregistrées à leur fiche par le nom : d'abord
--      dans le même restaurant, sinon partout si le nom n'existe qu'une fois.
--
--  Idempotent (rejouable). À exécuter dans le SQL Editor Supabase (Samtrackly).
-- =====================================================================

ALTER TABLE public.depenses
  ADD COLUMN IF NOT EXISTS travailleur_id uuid REFERENCES public.travailleurs(id) ON DELETE SET NULL;
ALTER TABLE public.depenses_gerant_caisse
  ADD COLUMN IF NOT EXISTS travailleur_id uuid REFERENCES public.travailleurs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_depenses_travailleur
  ON public.depenses (travailleur_id) WHERE travailleur_id IS NOT NULL;

-- Même restaurant, nom identique (casse et espaces ignorés), une seule fiche.
UPDATE public.depenses d
   SET travailleur_id = (
     SELECT t.id FROM public.travailleurs t
      WHERE UPPER(BTRIM(t.nom)) = UPPER(BTRIM(d.libelle)) AND t.restaurant_id = p.restaurant_id
   )
  FROM public.points p
 WHERE p.id = d.point_id
   AND d.categorie = 'Paie' AND d.saisi_par = 'gerant' AND d.travailleur_id IS NULL
   AND (SELECT COUNT(*) FROM public.travailleurs t
         WHERE UPPER(BTRIM(t.nom)) = UPPER(BTRIM(d.libelle)) AND t.restaurant_id = p.restaurant_id) = 1;

-- Sinon (travailleur transféré) : nom unique dans toute l'équipe.
UPDATE public.depenses d
   SET travailleur_id = (
     SELECT t.id FROM public.travailleurs t WHERE UPPER(BTRIM(t.nom)) = UPPER(BTRIM(d.libelle))
   )
 WHERE d.categorie = 'Paie' AND d.saisi_par = 'gerant' AND d.travailleur_id IS NULL
   AND (SELECT COUNT(*) FROM public.travailleurs t WHERE UPPER(BTRIM(t.nom)) = UPPER(BTRIM(d.libelle))) = 1;

-- Contrôle : paies du gérant rattachées / sans fiche.
SELECT
  COUNT(*) FILTER (WHERE travailleur_id IS NOT NULL) AS paies_rattachees,
  COUNT(*) FILTER (WHERE travailleur_id IS NULL)     AS paies_sans_fiche
  FROM public.depenses
 WHERE categorie = 'Paie' AND saisi_par = 'gerant';
