-- ─────────────────────────────────────────────────────────────────────────
--  Bascule du menu gérant : « Espace Caissier » → « Point caissier ».
--
--  Les menus réellement servis viennent de la table `roles_acces` :
--  lib/menus.js → ACCES_DEFAUT n'est qu'un repli quand la base est
--  indisponible. Sans cette migration, les gérants continuent de voir
--  « Espace Caissier » et ne voient jamais « Point caissier ».
--
--  `tuiles` est de type jsonb : `tuiles - 'x'` retire l'élément « x » du
--  tableau. Migration idempotente, rejouable sans risque.
--
--  Manager et directeur ne passent pas par cette table (tuiles marquées
--  `admin: true` dans lib/menus.js) : rien à migrer pour eux.
-- ─────────────────────────────────────────────────────────────────────────

--  1. Ajouter la nouvelle tuile si elle n'y est pas déjà.
UPDATE public.roles_acces
SET tuiles = tuiles || '["point-caissier"]'::jsonb,
    updated_at = NOW()
WHERE role = 'gerant'
  AND NOT (tuiles @> '["point-caissier"]'::jsonb);

--  2. Retirer l'ancienne. L'écran /gerant-caissier reste dans le code :
--     un manager peut le remettre depuis Paramètres → Accès par rôle.
UPDATE public.roles_acces
SET tuiles = tuiles - 'gerant-caissier',
    updated_at = NOW()
WHERE role = 'gerant'
  AND tuiles @> '["gerant-caissier"]'::jsonb;

--  3. Contrôle : le gérant doit avoir point-caissier et plus gerant-caissier.
SELECT role,
       tuiles @> '["point-caissier"]'::jsonb  AS a_point_caissier,
       tuiles @> '["gerant-caissier"]'::jsonb AS a_encore_espace_caissier,
       tuiles
FROM public.roles_acces
WHERE role = 'gerant';
