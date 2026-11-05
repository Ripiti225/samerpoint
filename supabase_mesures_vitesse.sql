-- Temps d'attente réels des utilisateurs (écrite par lib/mesuresVitesseDb.js).
-- L'app peut écrire mais pas relire : les chiffres se consultent ici, côté Supabase.
-- Ni nom ni montant : une durée, un écran, le type d'appareil, le rôle et le restaurant.
--
-- Lecture type (médiane et 9 mesures sur 10, 7 derniers jours) :
--   select ecran, plateforme, count(*) as n,
--          percentile_cont(0.5) within group (order by duree_ms) as mediane_ms,
--          percentile_cont(0.9) within group (order by duree_ms) as p90_ms
--   from mesures_vitesse where created_at > now() - interval '7 days'
--   group by 1, 2 order by 1, 2;

CREATE TABLE IF NOT EXISTS public.mesures_vitesse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ecran TEXT NOT NULL CHECK (char_length(ecran) <= 40),
  duree_ms INTEGER NOT NULL CHECK (duree_ms BETWEEN 0 AND 300000),
  plateforme TEXT CHECK (char_length(plateforme) <= 20),
  connexion TEXT CHECK (char_length(connexion) <= 10),
  role TEXT CHECK (char_length(role) <= 20),
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mesures_vitesse_ecran_date
  ON public.mesures_vitesse (ecran, created_at DESC);

ALTER TABLE public.mesures_vitesse ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mesures_vitesse_ecriture ON public.mesures_vitesse;
CREATE POLICY mesures_vitesse_ecriture ON public.mesures_vitesse
  FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT INSERT ON public.mesures_vitesse TO anon, authenticated;
