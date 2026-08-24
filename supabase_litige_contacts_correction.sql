-- =====================================================================
--  CORRECTION DU NOMBRE DE COMMANDES YANGO/GLOVO
--  ET DU MONTANT DU LITIGE « CONTACTS »
--
--  Le gérant peut se tromper en saisissant le nombre de commandes
--  Yango / Glovo du jour. Ce nombre sert à calculer le litige
--  « contacts manquants » (écart entre commandes et contacts pris) :
--  une erreur de saisie crée donc un faux litige.
--
--  De plus, certains litiges contacts ne sont pas de la faute du
--  restaurant (ex. Al Kayan Yop : tablette en panne → impossible de
--  prendre les contacts). Le manager/directeur doit pouvoir forcer
--  le montant du litige (0 ou autre) avec un motif obligatoire.
--
--  On conserve les valeurs d'origine + qui/quand/pourquoi (audit).
--
--  Idempotent — rejouable sans risque.
-- =====================================================================

ALTER TABLE points
  -- ── Correction du nombre de commandes (Vérification + Litiges) ──────
  ADD COLUMN IF NOT EXISTS yango_nb_commandes_original   integer,
  ADD COLUMN IF NOT EXISTS glovo_nb_commandes_original   integer,
  ADD COLUMN IF NOT EXISTS nb_commandes_corrige_par      uuid,
  ADD COLUMN IF NOT EXISTS nb_commandes_corrige_par_nom  text,
  ADD COLUMN IF NOT EXISTS nb_commandes_corrige_at       timestamptz,
  ADD COLUMN IF NOT EXISTS nb_commandes_correction_motif text,

  -- ── Forçage du montant du litige contacts (onglet Litiges) ─────────
  --  NULL  = pas de correction, le montant calculé s'applique
  --  0..n  = montant forcé par le manager (remplace le calcul)
  ADD COLUMN IF NOT EXISTS contact_litige_override       numeric,
  ADD COLUMN IF NOT EXISTS contact_litige_calcule        numeric,
  ADD COLUMN IF NOT EXISTS contact_litige_motif          text,
  ADD COLUMN IF NOT EXISTS contact_litige_par            uuid,
  ADD COLUMN IF NOT EXISTS contact_litige_par_nom        text,
  ADD COLUMN IF NOT EXISTS contact_litige_at             timestamptz;

-- ── Vérif ─────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE nb_commandes_corrige_at IS NOT NULL) AS nb_commandes_corriges,
  count(*) FILTER (WHERE contact_litige_override IS NOT NULL) AS litiges_contacts_forces
FROM points;
