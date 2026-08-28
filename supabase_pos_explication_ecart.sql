-- Explication donnée par le caissier dans le POS pour l'écart de son shift.
-- À lancer dans la base Samtrackly. Migration rejouable sans risque.
ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS explication_ecart TEXT;

COMMENT ON COLUMN public.points_shifts.explication_ecart IS
  'Explication facultative donnée par le caissier dans le POS pour ecart_pos.';

-- Contrat du pont POS : avant tout upsert tardif, lire points.valide.
-- Si TRUE, considérer la remontée comme annulée/réglée et ne modifier ni le
-- point ni ses shifts. Une saisie manuelle Samtrackly déjà validée fait foi.
