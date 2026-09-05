-- Métadonnées d'identité propres à chaque restaurant.
-- Migration additive et rejouable : aucune ligne existante n'est modifiée.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS nom_complet TEXT,
  ADD COLUMN IF NOT EXISTS marque TEXT,
  ADD COLUMN IF NOT EXISTS couleur_principale TEXT,
  ADD COLUMN IF NOT EXISTS couleur_secondaire TEXT,
  ADD COLUMN IF NOT EXISTS couleur_fond TEXT,
  ADD COLUMN IF NOT EXISTS statut TEXT,
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS adresse TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(13, 10),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(13, 10),
  ADD COLUMN IF NOT EXISTS coordonnees TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT,
  ADD COLUMN IF NOT EXISTS ouvert_24h BOOLEAN,
  ADD COLUMN IF NOT EXISTS ouvert_7j BOOLEAN,
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS facebook TEXT,
  ADD COLUMN IF NOT EXISTS tiktok TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_code_unique
  ON public.restaurants (code)
  WHERE code IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.restaurants'::regclass
       AND conname = 'restaurants_statut_check'
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_statut_check
      CHECK (statut IS NULL OR statut IN ('actif', 'inactif'));
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.code IS
  'Code interne stable et unique du restaurant.';
COMMENT ON COLUMN public.restaurants.marque IS
  'Marque indépendante portée par le restaurant.';
COMMENT ON COLUMN public.restaurants.statut IS
  'Statut métier du restaurant : actif ou inactif.';
