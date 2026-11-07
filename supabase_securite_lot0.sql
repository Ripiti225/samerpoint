-- =====================================================================
--  SÉCURITÉ — LOT 0 : fermer les comptes et les codes à la clé publique.
--  À exécuter dans le SQL Editor de SAMTRACKLY. Idempotent.
--  Reprend supabase_codes_securises_etape2.sql (jamais passé d'après l'audit
--  du 07/11/2026) et ajoute ce qu'il oubliait : la suppression de comptes et
--  l'ancienne vérification de code sans limite d'essais.
--
--  Après ce fichier, la clé publique ne peut plus :
--   - lire les codes (pin) ni le compteur d'erreurs ;
--   - créer ou supprimer un compte ;
--   - changer un nom, un rôle, un restaurant ou un code directement ;
--   - essayer des codes sans blocage (verifier_pin_utilisateur).
--  La connexion, le changement de code et la gestion des comptes continuent
--  par connexion_utilisateur, changer_mon_code et enregistrer_utilisateur.
--  Les Edge Functions ne changent pas : elles utilisent la clé de service.
--
--  Retour en arrière, seulement si la connexion est cassée :
--    grant select, insert, update, delete on public.utilisateurs to anon, authenticated;
--    grant execute on function public.verifier_pin_utilisateur(uuid, text) to anon, authenticated;
--    notify pgrst, 'reload schema';
-- =====================================================================

revoke all on public.utilisateurs from anon, authenticated;

-- Tout sauf pin et echecs_code.
grant select (id, nom, role, restaurant_id, photo_url, type_contrat, poste, date_embauche, actif,
              created_at, travailleur_id, code_a_changer, code_change_le, code_version,
              pin_longueur, sans_connexion, bloque_jusqua)
  on public.utilisateurs to anon, authenticated;

-- Seules modifications directes encore permises : activer / désactiver, photo.
grant update (actif, photo_url) on public.utilisateurs to anon, authenticated;

-- Ancienne vérification, sans blocage après plusieurs essais. Plus appelée par l'application.
revoke execute on function public.verifier_pin_utilisateur(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Contrôle : les 5 premières colonnes doivent valoir false, les 2 dernières true.
select
  has_column_privilege('anon', 'public.utilisateurs', 'pin', 'SELECT') as lit_les_codes,
  has_column_privilege('anon', 'public.utilisateurs', 'pin', 'UPDATE') as change_les_codes,
  has_column_privilege('anon', 'public.utilisateurs', 'role', 'UPDATE') as change_les_roles,
  has_table_privilege('anon', 'public.utilisateurs', 'DELETE') as supprime_des_comptes,
  has_function_privilege('anon', 'public.verifier_pin_utilisateur(uuid, text)', 'EXECUTE') as essaie_des_codes,
  has_column_privilege('anon', 'public.utilisateurs', 'nom', 'SELECT') as lit_les_noms,
  has_function_privilege('anon', 'public.connexion_utilisateur(uuid, text)', 'EXECUTE') as peut_se_connecter;
