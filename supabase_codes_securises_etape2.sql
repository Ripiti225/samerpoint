-- =====================================================================
--  CODES PERSONNELS — ÉTAPE 2 : fermer l'accès direct aux codes (02/11/2026)
--  À exécuter dans le SQL Editor de SAMTRACKLY, SEULEMENT APRÈS :
--    1. supabase_codes_securises.sql (étape 1),
--    2. la publication du site ET de la mise à jour de l'application
--       (une application pas encore à jour ne pourrait plus se connecter).
--  Idempotent.
--
--  Après ce fichier, la clé publique de l'app ne peut plus :
--   - lire la colonne pin (ni les compteurs d'erreurs) ;
--   - créer un compte, ni changer un nom, un rôle, un restaurant ou un code
--     sans passer par enregistrer_utilisateur / changer_mon_code (qui
--     vérifient le code du manager ou l'ancien code).
--  Les fonctions du serveur (SECURITY DEFINER, Edge Functions) ne changent pas.
-- =====================================================================

revoke select, insert, update on public.utilisateurs from anon, authenticated;

grant select (id, nom, role, restaurant_id, photo_url, type_contrat, poste, date_embauche, actif,
              created_at, travailleur_id, code_a_changer, code_change_le, code_version,
              pin_longueur, sans_connexion, bloque_jusqua)
  on public.utilisateurs to anon, authenticated;

-- Seules modifications directes encore permises : activer / désactiver, photo.
grant update (actif, photo_url) on public.utilisateurs to anon, authenticated;

-- Contrôle : doit renvoyer false (la clé publique ne lit plus les codes).
select has_column_privilege('anon', 'public.utilisateurs', 'pin', 'SELECT') as anon_lit_les_codes;
