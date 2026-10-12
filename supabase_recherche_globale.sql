-- =====================================================================
--  Recherche globale (loupe de l'accueil) — 12/10/2026
--  Projet Samtrackly (wlwotzxnzowbkbfcpnyi). Idempotente : se repasse sans risque.
--  Spéc : docs/superpowers/specs/2026-10-12-recherche-globale-design.md
--
--  recherche_globale(terme, restaurant, manager, limite) cherche le mot dans
--  les textes de toutes les tables (libellés, notes, motifs, noms,
--  explications…), sans tenir compte des accents ni des majuscules. Elle renvoie
--  pour chaque résultat la source, le champ trouvé, son texte complet, la date,
--  le montant éventuel et l'écran (+ onglet / paramètres) où l'ouvrir.
--  Au plus `limite` résultats par source (les plus récents).
--  Gérant (p_manager = false) : son restaurant, et seulement sa journée active
--  (p_date) pour tout ce qui a une date ; les fiches (fournisseurs, travailleurs,
--  documents) et les demandes encore en cours restent visibles. Jamais les
--  sources réservées au manager (trésorerie direction, coffre, journal, RH…).
--  Spéc gérant + params : docs/superpowers/specs/2026-10-12-recherche-globale-lot2a-design.md
--  et lot2b-design.md (seconde vague d'écrans).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Minuscules + accents retirés (même règle que normaliser() dans lib/rechercheGlobale.js).
CREATE OR REPLACE FUNCTION rg_norm(t text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- L'ancienne version (sans p_date) est remplacée.
DROP FUNCTION IF EXISTS recherche_globale(text, uuid, boolean, int);

CREATE OR REPLACE FUNCTION recherche_globale(
  p_terme text, p_restaurant_id uuid, p_manager boolean, p_limite int DEFAULT 25, p_date date DEFAULT NULL
)
RETURNS TABLE (
  source text, id uuid, restaurant_id uuid, restaurant_nom text, date date,
  champ text, texte text, montant numeric, ecran text, onglet text, params jsonb
)
LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_terme text := rg_norm(trim(coalesce(p_terme, '')));
  m text;
  g boolean := coalesce(p_manager, false);   -- vrai : manager (tout voir)
  r uuid := p_restaurant_id;                 -- restaurant du gérant
  v_jour date := p_date;                       -- journée active du gérant
  n int := least(greatest(coalesce(p_limite, 25), 1), 100);
BEGIN
  IF length(v_terme) < 2 THEN RETURN; END IF;
  -- Les % et _ tapés sont cherchés tels quels.
  m := '%' || replace(replace(replace(v_terme, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT x.source, x.id, x.restaurant_id, rs.nom::text, x.date, x.champ, x.texte, x.montant,
         x.ecran, x.onglet, x.params
  FROM (
    -- ── Points et journées ───────────────────────────────────────────────
    -- Manager : la journée s'ouvre dans « Modifier un point », sur le bon onglet.
    -- Gérant : sa journée active seulement, dans son écran du jour.
    (SELECT 'Dépenses du point'::text AS source, d.id, p.restaurant_id, p.date::date AS date,
            c.champ, c.texte, d.montant::numeric AS montant,
            CASE WHEN g THEN 'modifier-point' ELSE 'depenses' END::text AS ecran,
            NULL::text AS onglet,
            CASE WHEN g THEN jsonb_build_object('restaurant_id', p.restaurant_id, 'date', p.date, 'onglet', 'Dépenses', 'focus', d.id)
                 ELSE jsonb_build_object('focus', d.id) END AS params
       FROM depenses d JOIN points p ON p.id = d.point_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Libellé', d.libelle), ('Catégorie', d.categorie), ('Saisi par', d.saisi_par_nom), ('Caissier', d.caissier_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (p.restaurant_id = r AND p.date = v_jour)
      ORDER BY p.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Dépenses gérant', d.id, p.restaurant_id, p.date, c.champ, c.texte, d.montant,
            CASE WHEN g THEN 'modifier-point' ELSE 'deductions-gerant' END, NULL,
            CASE WHEN g THEN jsonb_build_object('restaurant_id', p.restaurant_id, 'date', p.date, 'onglet', 'Dép. Gérant', 'focus', d.id)
                 ELSE jsonb_build_object('focus', d.id) END
       FROM depenses_gerant_caisse d JOIN points p ON p.id = d.point_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Description', d.description), ('Catégorie', d.categorie), ('Facture', d.facture)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (p.restaurant_id = r AND p.date = v_jour)
      ORDER BY p.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Points (journée)', p.id, p.restaurant_id, p.date, c.champ, c.texte, NULL::numeric,
            CASE WHEN g THEN 'verification' ELSE 'point-caissier' END, NULL,
            CASE WHEN g THEN jsonb_build_object('restaurant_id', p.restaurant_id, 'point_id', p.id)
                 ELSE jsonb_build_object('restaurant_id', p.restaurant_id) END
       FROM points p
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Motif litige contacts', p.contact_litige_motif), ('Explication écart machine', p.explication_ecart_machine),
         ('Motif correction commandes', p.nb_commandes_correction_motif), ('Vérifié par', p.verifie_par)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (p.restaurant_id = r AND p.date = v_jour)
      ORDER BY p.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Points caissier', s.id, s.restaurant_id, s.date, c.champ, c.texte, NULL::numeric,
            'point-caissier', NULL, jsonb_build_object('restaurant_id', s.restaurant_id, 'focus', s.id)
       FROM points_shifts s
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Explication écart', s.explication_ecart), ('Caissier', s.caissier_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (s.restaurant_id = r AND s.date = v_jour)
      ORDER BY s.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Présences', pr.id, pr.restaurant_id, pr.date, 'Travailleur', pr.travailleur_nom, pr.paye,
            CASE WHEN g THEN 'modifier-point' ELSE 'presences' END, NULL,
            CASE WHEN g THEN jsonb_build_object('restaurant_id', pr.restaurant_id, 'date', pr.date, 'onglet', 'Présences', 'focus', pr.id)
                 ELSE jsonb_build_object('focus', pr.id) END
       FROM presences pr
      WHERE rg_norm(pr.travailleur_nom) LIKE m AND (g OR (pr.restaurant_id = r AND pr.date = v_jour))
      ORDER BY pr.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Commandes livraison', co.id, p.restaurant_id, p.date, c.champ, c.texte, NULL::numeric,
            'livraisons', NULL, '{}'::jsonb
       FROM commandes co JOIN points p ON p.id = co.point_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('N° commande', co.numero_commande), ('Contact client', co.contact_client)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (p.restaurant_id = r AND p.date = v_jour)
      ORDER BY p.date DESC LIMIT n)
    -- ── Fournisseurs et crédits ──────────────────────────────────────────
    UNION ALL
    -- Toutes ouvrent la fiche du fournisseur dans Crédits fournisseurs.
    (SELECT 'Factures fournisseurs', t.id, t.restaurant_id, coalesce(p.date, t.created_at::date),
            c.champ, c.texte, NULL::numeric, 'credits-fournisseurs', NULL,
            jsonb_strip_nulls(jsonb_build_object('fournisseur_id', t.fournisseur_id))
       FROM transactions_fournisseurs t LEFT JOIN points p ON p.id = t.point_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Fournisseur', t.fournisseur_nom), ('Raison de la correction', t.facture_correction_raison), ('Caissier', t.caissier_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (t.restaurant_id = r AND coalesce(p.date, t.created_at::date) = v_jour)
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Corrections de crédit', h.id, h.restaurant_id, coalesce(p.date, h.modified_at::date),
            c.champ, c.texte, NULL::numeric, 'credits-fournisseurs', NULL,
            jsonb_strip_nulls(jsonb_build_object('fournisseur_id', h.fournisseur_id))
       FROM historique_credit_fournisseurs h LEFT JOIN points p ON p.id = h.point_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Motif', h.motif), ('Modifié par', h.modified_by)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (h.restaurant_id = r AND coalesce(p.date, h.modified_at::date) = v_jour)
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Paiements fournisseurs', pf.id, pf.restaurant_id, pf.date, 'Note', pf.note, pf.montant,
            'credits-fournisseurs', NULL, jsonb_strip_nulls(jsonb_build_object('fournisseur_id', pf.fournisseur_id))
       FROM paiements_fournisseurs pf
      WHERE rg_norm(pf.note) LIKE m AND (g OR (pf.restaurant_id = r AND pf.date = v_jour))
      ORDER BY pf.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Fournisseurs', f.id, f.restaurant_id, f.created_at::date, c.champ, c.texte, f.credit_actuel,
            'credits-fournisseurs', NULL, jsonb_build_object('fournisseur_id', f.id)
       FROM fournisseurs f
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Nom', f.nom), ('Contact', f.contact), ('Identifiant', f.identifiant), ('Motif de départ', f.depart_motif)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR f.restaurant_id = r
      ORDER BY 4 DESC LIMIT n)
    -- ── Stock ────────────────────────────────────────────────────────────
    UNION ALL
    (SELECT 'Inventaire', i.id, i.restaurant_id, i.date, c.champ, c.texte, NULL::numeric,
            'gestion-stock', NULL,
            jsonb_strip_nulls(jsonb_build_object('restaurant_id', i.restaurant_id, 'date', i.date,
                                                 'produit_id', i.produit_id, 'produit_nom', i.produit_nom))
       FROM inventaires i
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Explication', i.explication), ('Explication écart', i.explication_ecart), ('Fournisseur', i.fournisseur_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (i.restaurant_id = r AND i.date = v_jour)
      ORDER BY i.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Déductions vérification', dv.id, dv.restaurant_id, dv.date, c.champ, c.texte, dv.montant,
            'verification', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', dv.restaurant_id, 'point_id', dv.point_id))
       FROM deductions_verification dv
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Explication', dv.explication), ('Produits', dv.produits_resume), ('Caissier', dv.caissier_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY dv.date DESC LIMIT n)
    -- ── Équipe ───────────────────────────────────────────────────────────
    UNION ALL
    (SELECT 'Travailleurs', tr.id, tr.restaurant_id, tr.created_at::date, c.champ, c.texte, NULL::numeric,
            'equipe', NULL,
            jsonb_strip_nulls(jsonb_build_object('restaurant_id', tr.restaurant_id, 'focus', tr.id))
       FROM travailleurs tr
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Nom', tr.nom), ('Poste', tr.poste), ('Contact', tr.contact), ('Identifiant', tr.identifiant),
         ('Motif d''archivage', tr.archive_motif)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR tr.restaurant_id = r
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Demandes', de.id, de.restaurant_id, de.created_at::date, c.champ, c.texte, de.montant,
            CASE WHEN g THEN 'demandes-admin' ELSE 'demandes' END, NULL,
            jsonb_strip_nulls(jsonb_build_object('restaurant_id', de.restaurant_id, 'focus', de.id))
       FROM demandes de
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Description', de.description), ('Motif du refus', de.motif_decline), ('Travailleur', de.travailleur_nom),
         ('Type', de.type)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      -- Gérant : celles du jour et celles encore en cours.
      WHERE g OR (de.restaurant_id = r AND (de.created_at::date = v_jour
                  OR coalesce(de.statut, '') NOT IN ('validee', 'declinee', 'annulee')))
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Demandes d''explication', e.id, e.restaurant_id, e.created_at::date, c.champ, c.texte, NULL::numeric,
            CASE WHEN g THEN 'demandes-explication-admin' ELSE 'demandes-explication' END, NULL,
            jsonb_strip_nulls(jsonb_build_object('restaurant_id', e.restaurant_id, 'focus', e.id))
       FROM demandes_explication e
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Motif', e.motif), ('Description', e.description), ('Réponse', e.reponse_note),
         ('Motif du refus', e.refus_motif), ('Travailleur', e.travailleur_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (e.restaurant_id = r AND (e.created_at::date = v_jour
                  OR coalesce(e.statut, '') NOT IN ('acceptee', 'refusee', 'annulee')))
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Permissions et congés', pc.id, pc.restaurant_id, pc.date_debut, c.champ, c.texte, NULL::numeric,
            'equipe', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', pc.restaurant_id, 'focus', pc.travailleur_id))
       FROM permissions_conges pc
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Motif', pc.motif), ('Travailleur', pc.travailleur_nom), ('Type', pc.type)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY pc.date_debut DESC LIMIT n)
    UNION ALL
    (SELECT 'Contrats', ct.id, ct.restaurant_id, ct.date_debut, c.champ, c.texte, NULL::numeric,
            'contrats', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', ct.restaurant_id, 'recherche', tr.nom))
       FROM contrats_travailleurs ct LEFT JOIN travailleurs tr ON tr.id = ct.travailleur_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Travailleur', tr.nom), ('Motif de clôture', ct.cloture_motif), ('Type', ct.type)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY ct.date_debut DESC LIMIT n)
    UNION ALL
    (SELECT 'Documents', doc.id, doc.restaurant_id, doc.created_at::date, c.champ, c.texte, NULL::numeric,
            'documents', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', doc.restaurant_id, 'focus', doc.id))
       FROM documents doc
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Titre', doc.titre), ('Description', doc.description), ('Type', doc.type)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR doc.restaurant_id = r
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Documents travailleur', dt.id, tr.restaurant_id, dt.created_at::date, c.champ, c.texte, NULL::numeric,
            'equipe', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', tr.restaurant_id, 'focus', dt.travailleur_id))
       FROM documents_travailleurs dt LEFT JOIN travailleurs tr ON tr.id = dt.travailleur_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Travailleur', tr.nom), ('Description', dt.description), ('Type', dt.type_document)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR tr.restaurant_id = r
      ORDER BY 4 DESC LIMIT n)
    -- ── Litiges et clients ───────────────────────────────────────────────
    UNION ALL
    (SELECT 'Litiges Glovo', l.id, l.restaurant_id, l.date, c.champ, c.texte, l.montant::numeric,
            'litiges', NULL,
            jsonb_build_object('restaurant_id', l.restaurant_id, 'date', l.date, 'onglet', 'glovo', 'focus', l.id)
       FROM litiges_glovo l
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Notes', l.notes), ('N° commande', l.numero_commande), ('Responsable', l.responsable_nom), ('Détail', l.detail::text)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (l.restaurant_id = r AND l.date = v_jour)
      ORDER BY l.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Litiges Yango', l.id, l.restaurant_id, l.date, c.champ, c.texte, l.montant::numeric,
            'litiges', NULL,
            jsonb_build_object('restaurant_id', l.restaurant_id, 'date', l.date, 'onglet', 'yango', 'focus', l.id)
       FROM litiges_yango l
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Notes', l.notes), ('N° commande', l.numero_commande), ('Responsable', l.responsable_nom), ('Détail', l.detail::text)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (l.restaurant_id = r AND l.date = v_jour)
      ORDER BY l.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Litiges avis clients', l.id, l.restaurant_id, l.date, c.champ, c.texte, l.montant,
            'litiges', NULL,
            jsonb_build_object('restaurant_id', l.restaurant_id, 'date', l.date, 'onglet', 'avis', 'focus', l.id)
       FROM litiges_avis_clients l
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Avis', l.contenu), ('Notes', l.notes), ('N° commande', l.numero_commande), ('Responsable', l.responsable_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (l.restaurant_id = r AND l.date = v_jour)
      ORDER BY l.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Point pas fait', l.id, l.restaurant_id, l.date, c.champ, c.texte, l.montant,
            'litiges', NULL,
            jsonb_build_object('restaurant_id', l.restaurant_id, 'date', l.date, 'onglet', 'point_pas_fait', 'focus', l.id)
       FROM litiges_point_pas_fait l
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Notes', l.notes), ('Responsable', l.responsable_nom)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (l.restaurant_id = r AND l.date = v_jour)
      ORDER BY l.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Contacts clients', cc.id, cc.restaurant_id, cc.date, 'Numéro', cc.numero, NULL::numeric,
            'contacts', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', cc.restaurant_id, 'date', cc.date, 'recherche', cc.numero))
       FROM contacts_clients cc
      WHERE rg_norm(cc.numero) LIKE m AND (g OR (cc.restaurant_id = r AND cc.date = v_jour))
      ORDER BY cc.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Avis plateformes', pv.id, pv.restaurant_id, pv.review_date, c.champ, c.texte, NULL::numeric,
            'avis-plateformes', NULL,
            jsonb_strip_nulls(jsonb_build_object('restaurant_id', pv.restaurant_id, 'date', pv.review_date, 'focus', pv.id))
       FROM platform_reviews pv
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Commentaire', pv.comment), ('Auteur', pv.author)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g OR (pv.restaurant_id = r AND pv.review_date = v_jour)
      ORDER BY pv.review_date DESC NULLS LAST LIMIT n)
    -- ── Trésorerie et administration (manager seulement) ─────────────────
    UNION ALL
    (SELECT 'Charges', ch.id, ch.restaurant_id, ch.created_at::date, 'Libellé', ch.libelle, ch.montant,
            'charges', NULL, jsonb_strip_nulls(jsonb_build_object('restaurant_id', ch.restaurant_id, 'mois', ch.mois, 'focus', ch.id))
       FROM charges ch
      WHERE g AND rg_norm(ch.libelle) LIKE m
      ORDER BY ch.created_at DESC LIMIT n)
    UNION ALL
    (SELECT 'À payer', du.id, du.restaurant_id, coalesce(du.mois, du.created_at::date), c.champ, c.texte,
            du.montant_du::numeric, 'tresorerie-a-payer', du.categorie,
            jsonb_strip_nulls(jsonb_build_object('onglet', du.categorie, 'focus', du.id))
       FROM tresorerie_dus du
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Libellé', du.libelle), ('Note', du.note), ('Créancier', du.creancier)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY 4 DESC LIMIT n)
    UNION ALL
    (SELECT 'Prévisions de paiement', pv.id, f.restaurant_id, pv.date_prevue, c.champ, c.texte, pv.montant::numeric,
            'tresorerie-a-payer', du.categorie, jsonb_strip_nulls(jsonb_build_object('onglet', du.categorie, 'focus', pv.du_id))
       FROM tresorerie_previsions pv LEFT JOIN fournisseurs f ON f.id = pv.fournisseur_id
       LEFT JOIN tresorerie_dus du ON du.id = pv.du_id
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Note', pv.note), ('Partenaire', pv.partenaire)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY pv.date_prevue DESC NULLS LAST LIMIT n)
    UNION ALL
    (SELECT 'Cotisations reçues', cr.id, cr.restaurant_id, cr.date, 'Note', cr.note, cr.montant::numeric,
            'tresorerie-a-payer', du.categorie, jsonb_strip_nulls(jsonb_build_object('onglet', du.categorie, 'focus', cr.du_id))
       FROM tresorerie_cotisations_recues cr LEFT JOIN tresorerie_dus du ON du.id = cr.du_id
      WHERE g AND rg_norm(cr.note) LIKE m
      ORDER BY cr.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Mouvements restaurant', mv.id, mv.restaurant_id, mv.date, 'Libellé', mv.libelle, mv.montant::numeric,
            'tresorerie-restaurant', NULL,
            jsonb_strip_nulls(jsonb_build_object('id', mv.restaurant_id, 'an', extract(year FROM mv.date)::int,
                                                 'mois', extract(month FROM mv.date)::int, 'focus', mv.id))
       FROM tresorerie_mouvements mv
      WHERE g AND rg_norm(mv.libelle) LIKE m
      ORDER BY mv.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Transferts de fond', tf.id, tf.restaurant_id, tf.date, c.champ, c.texte, tf.montant::numeric,
            'tresorerie-restaurant', NULL,
            jsonb_strip_nulls(jsonb_build_object('id', tf.restaurant_id, 'an', extract(year FROM tf.date)::int,
                                                 'mois', extract(month FROM tf.date)::int, 'focus', tf.id))
       FROM transferts_fond tf
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Note', tf.note), ('Destination', tf.destination)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY tf.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Dépenses direction', dd.id, dd.restaurant_id, dd.date, c.champ, c.texte, dd.montant::numeric,
            'tresorerie-direction', NULL, jsonb_build_object('focus', dd.id)
       FROM tresorerie_depenses_direction dd
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Note', dd.note), ('Catégorie', dd.categorie)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY dd.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Partenaires', pl.id, pl.restaurant_id, pl.date, c.champ, c.texte, pl.montant::numeric,
            'tresorerie-partenaires', NULL,
            jsonb_strip_nulls(jsonb_build_object('partenaire', pl.partenaire, 'periode', pl.periode_debut, 'focus', pl.id))
       FROM tresorerie_partenaire_lignes pl
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Note', pl.note), ('Partenaire', pl.partenaire)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY pl.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Coffre', cm.id, NULL::uuid, cm.date, 'Libellé', cm.libelle, cm.montant::numeric,
            'tresorerie-coffre', NULL, jsonb_build_object('focus', cm.id)
       FROM tresorerie_coffre_mouvements cm
      WHERE g AND rg_norm(cm.libelle) LIKE m
      ORDER BY cm.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Emprunts au coffre', ce.id, NULL::uuid, ce.date, c.champ, c.texte, ce.montant::numeric,
            'tresorerie-coffre', NULL, jsonb_build_object('focus', ce.id)
       FROM tresorerie_coffre_emprunts ce
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Note', ce.note), ('Partenaire', ce.rembourser_partenaire)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY ce.date DESC LIMIT n)
    UNION ALL
    (SELECT 'Journal', j.id, j.restaurant_id, j.created_at::date, c.champ, c.texte, NULL::numeric,
            'journal', NULL, jsonb_build_object('focus', j.id)
       FROM journal_activite j
       CROSS JOIN LATERAL (SELECT v.champ, v.texte FROM (VALUES
         ('Action', j.action), ('Par', j.user_nom), ('Détails', j.details::text)
       ) v(champ, texte) WHERE rg_norm(v.texte) LIKE m LIMIT 1) c
      WHERE g
      ORDER BY j.created_at DESC LIMIT n)
  ) x
  LEFT JOIN restaurants rs ON rs.id = x.restaurant_id
  ORDER BY x.date DESC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION recherche_globale(text, uuid, boolean, int, date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Contrôle : combien de résultats par source pour « paie » (vue manager).
SELECT source, count(*) FROM recherche_globale('paie', NULL, true) GROUP BY source ORDER BY 2 DESC;
-- Vue gérant (remplacer par un vrai restaurant et sa journée) :
-- SELECT source, date, texte FROM recherche_globale('paie', '<restaurant_id>', false, 25, current_date);
