-- ════════════════════════════════════════════════════════════════════════════
--  Vente système du POS par shift → alimente points.vente_machine
--
--  Spéc : docs/superpowers/specs/2026-08-17-pos-samer-vers-samtrackly-design.md
--  À lancer dans SAMTRACKLY (pas le cloud POS). Rejouable sans risque.
--
--  POURQUOI
--  `points.vente_machine` (la vente réelle du système, lue sur l'écran de la
--  caisse) était tapée à la main par le gérant. Les 19 et 20 août 2026, sur un
--  site pourtant déjà alimenté par le POS, personne ne l'a saisie : l'écart
--  théorique/machine — le contrôle historique du groupe — a disparu en silence
--  ces deux jours-là.
--
--  Le POS connaît ce chiffre exactement. On le stocke par shift, puis le pont
--  somme les shifts d'une journée pour remplir `points.vente_machine`. Même
--  motif que `vente_total` : un cache recalculé à partir des lignes réelles,
--  jamais un nombre isolé qu'on pourrait oublier de mettre à jour.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.points_shifts
  ADD COLUMN IF NOT EXISTS vente_systeme_pos NUMERIC;

COMMENT ON COLUMN public.points_shifts.vente_systeme_pos IS
  'Vente système du POS pour ce shift (rapport_z.total_ventes). NULL pour un shift '
  'saisi à la main. Sommée par le pont pour remplir points.vente_machine.';


-- ── Vérification ────────────────────────────────────────────────────────────
--
-- Après le prochain passage du pont, la vente machine doit se remplir seule :
--
--   SELECT p.date, p.vente_total AS theorique, p.vente_machine AS machine,
--          p.vente_total - COALESCE(p.vente_machine, 0) AS ecart,
--          SUM(s.ecart_pos) AS ecart_mesure_au_comptage
--     FROM points p
--     JOIN points_shifts s ON s.point_id = p.id
--    WHERE p.restaurant_id = '2f09688d-a4b9-4b14-8c45-943543953379'
--      AND p.date >= '2026-08-17'
--    GROUP BY p.date, p.vente_total, p.vente_machine
--    ORDER BY p.date;
--
-- `ecart` et `ecart_mesure_au_comptage` doivent désormais coïncider : depuis le
-- 2026-08-20, `espece` vient du comptage à l'aveugle, donc un manquant en
-- espèces se retrouve dans les DEUX. C'est le même fait vu de deux façons —
-- ne jamais déduire deux fois au vérificateur.
