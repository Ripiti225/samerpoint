-- ════════════════════════════════════════════════════════════════════════════
-- Heure de la commande sur les avis clients (projet Samtrackly).
--
-- Avec l'heure, l'avis est attribué automatiquement au caissier qui tenait la
-- caisse à ce moment (lib/attributionAvis.js) ; il compte ensuite dans sa note
-- (critère « Clients et plateformes »). Le manager peut toujours corriger le
-- responsable à la main dans Litiges.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.litiges_avis_clients add column if not exists heure_commande time;

comment on column public.litiges_avis_clients.heure_commande is
  'Heure de la commande (sert à retrouver le caissier présent). NULL = inconnue.';
