-- =====================================================================
--  CODES PERSONNELS VÉRIFIÉS PAR LE SERVEUR — ÉTAPE 1 (02/11/2026)
--  À exécuter dans le SQL Editor du projet SAMTRACKLY. Idempotent.
--
--  Avant : l'écran de connexion téléchargeait les codes de tous les comptes
--  d'un restaurant, en clair, et comparait sur le téléphone ; le blocage
--  s'effaçait en rechargeant la page.
--  Maintenant : le serveur vérifie le code (connexion_utilisateur), compte les
--  erreurs et bloque (5 erreurs → 1 min, 10 → 15 min, 15 et plus → 60 min).
--  Nouveaux codes : 6 chiffres, pas trop simples (code_trop_simple).
--  Tous les comptes doivent changer leur code à la prochaine connexion.
--  Le manager voit les codes dans Paramètres après avoir retapé le sien.
--
--  Cette étape ne casse rien pour l'application pas encore mise à jour.
--  L'ÉTAPE 2 (supabase_codes_securises_etape2.sql) ferme la lecture et
--  l'écriture directes des codes : à passer APRÈS la publication.
-- =====================================================================

alter table public.utilisateurs
  add column if not exists code_a_changer boolean not null default false,
  add column if not exists code_change_le timestamptz,
  add column if not exists echecs_code    integer not null default 0,
  add column if not exists bloque_jusqua  timestamptz,
  add column if not exists code_version   integer not null default 1;
-- Lisibles par l'app sans révéler le code : sa longueur et « compte technique ».
alter table public.utilisateurs
  add column if not exists pin_longueur   integer generated always as (length(pin)) stored,
  add column if not exists sans_connexion boolean generated always as (pin = 'SANS_CONNEXION') stored;

-- Tous les vrais comptes actifs changent leur code à la prochaine connexion
-- (une seule fois : relancer ce fichier ne les force pas de nouveau).
update public.utilisateurs set code_a_changer = true
where actif and pin <> 'SANS_CONNEXION' and code_change_le is null and not code_a_changer;

-- ── Règle d'un nouveau code (la même que lib/codes.js) ──
create or replace function public.code_trop_simple(p text) returns boolean
language sql immutable as $$
  select p is null
      or p !~ '^[0-9]{6}$'
      or p ~ '^([0-9])\1{5}$'
      or p ~ '^([0-9]{2})\1\1$'
      or p ~ '^([0-9]{3})\1$'
      or strpos('01234567890123', p) > 0
      or strpos('98765432109876', p) > 0
$$;

-- ── Vérification d'un code ──
-- Rend { statut: 'ok' | 'faux' | 'bloque' | 'inconnu', essais_restants,
--        bloque_jusqua, code_a_changer, code_version }.
create or replace function public.connexion_utilisateur(p_user uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u public.utilisateurs%rowtype;
  v_echecs integer;
  v_bloque timestamptz;
begin
  select * into u from public.utilisateurs where id = p_user and actif for update;
  if not found or u.pin = 'SANS_CONNEXION' then
    return jsonb_build_object('statut', 'inconnu');
  end if;
  if u.bloque_jusqua is not null and u.bloque_jusqua > now() then
    return jsonb_build_object('statut', 'bloque', 'bloque_jusqua', u.bloque_jusqua);
  end if;
  if u.pin is distinct from coalesce(p_pin, '') then
    v_echecs := u.echecs_code + 1;
    if v_echecs % 5 = 0 then
      v_bloque := now() + case when v_echecs >= 15 then interval '60 minutes'
                               when v_echecs >= 10 then interval '15 minutes'
                               else interval '1 minute' end;
      insert into public.journal_activite (action, details, restaurant_id, user_id, user_nom)
      values ('code_bloque', jsonb_build_object('echecs', v_echecs, 'bloque_jusqua', v_bloque), u.restaurant_id, u.id::text, u.nom);
    end if;
    update public.utilisateurs set echecs_code = v_echecs, bloque_jusqua = coalesce(v_bloque, bloque_jusqua) where id = u.id;
    return jsonb_build_object(
      'statut', case when v_bloque is null then 'faux' else 'bloque' end,
      'essais_restants', 5 - (v_echecs % 5),
      'bloque_jusqua', v_bloque);
  end if;
  update public.utilisateurs set echecs_code = 0, bloque_jusqua = null where id = u.id;
  return jsonb_build_object('statut', 'ok', 'code_a_changer', u.code_a_changer, 'code_version', u.code_version);
end $$;

-- ── Changer son propre code (ancien code obligatoire) ──
create or replace function public.changer_mon_code(p_user uuid, p_ancien text, p_nouveau text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  u public.utilisateurs%rowtype;
begin
  v := public.connexion_utilisateur(p_user, p_ancien);
  if v->>'statut' <> 'ok' then return v; end if;
  if p_nouveau = p_ancien then
    return jsonb_build_object('statut', 'invalide', 'message', 'Le nouveau code doit être différent de l''ancien.');
  end if;
  if public.code_trop_simple(p_nouveau) then
    return jsonb_build_object('statut', 'invalide', 'message', 'Choisissez 6 chiffres pas trop simples (pas 123456, 111111, 121212…).');
  end if;
  update public.utilisateurs
     set pin = p_nouveau, code_a_changer = false, code_change_le = now(), code_version = code_version + 1
   where id = p_user
  returning * into u;
  insert into public.journal_activite (action, details, restaurant_id, user_id, user_nom)
  values ('code_change', '{}'::jsonb, u.restaurant_id, u.id::text, u.nom);
  return jsonb_build_object('statut', 'ok', 'code_version', u.code_version);
end $$;

-- Le compte qui gère les utilisateurs (manager, directeur), code vérifié.
create or replace function public.verifier_admin_codes(p_admin uuid, p_admin_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_role text;
begin
  v := public.connexion_utilisateur(p_admin, p_admin_pin);
  if v->>'statut' <> 'ok' then return v; end if;
  select role into v_role from public.utilisateurs where id = p_admin;
  if v_role not in ('manager', 'directeur') then
    return jsonb_build_object('statut', 'refuse');
  end if;
  return v;
end $$;

-- ── Voir les codes (Paramètres → Utilisateurs), après le code du manager ──
create or replace function public.codes_utilisateurs(p_admin uuid, p_admin_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  a public.utilisateurs%rowtype;
begin
  v := public.verifier_admin_codes(p_admin, p_admin_pin);
  if v->>'statut' <> 'ok' then return v; end if;
  select * into a from public.utilisateurs where id = p_admin;
  insert into public.journal_activite (action, details, user_id, user_nom)
  values ('codes_consultes', '{}'::jsonb, a.id::text, a.nom);
  return jsonb_build_object('statut', 'ok', 'codes', coalesce((
    select jsonb_object_agg(id::text, pin) from public.utilisateurs where pin <> 'SANS_CONNEXION'), '{}'::jsonb));
end $$;

-- ── Créer ou modifier un compte (Paramètres), après le code du manager ──
-- p_pin vide en modification = code inchangé. Un code donné par le manager
-- doit être changé par la personne à sa prochaine connexion.
create or replace function public.enregistrer_utilisateur(
  p_admin uuid, p_admin_pin text, p_id uuid, p_nom text, p_role text, p_restaurant uuid, p_pin text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  a public.utilisateurs%rowtype;
  v_id uuid := p_id;
  v_pin text := nullif(trim(coalesce(p_pin, '')), '');
begin
  v := public.verifier_admin_codes(p_admin, p_admin_pin);
  if v->>'statut' <> 'ok' then return v; end if;
  if coalesce(trim(p_nom), '') = '' then
    return jsonb_build_object('statut', 'invalide', 'message', 'Le nom est obligatoire.');
  end if;
  if v_pin is not null and v_pin !~ '^[0-9]{6}$' then
    return jsonb_build_object('statut', 'invalide', 'message', 'Le code doit faire exactement 6 chiffres.');
  end if;
  if v_id is null and v_pin is null then
    return jsonb_build_object('statut', 'invalide', 'message', 'Donnez un code de 6 chiffres au nouveau compte.');
  end if;
  select * into a from public.utilisateurs where id = p_admin;
  if v_id is null then
    insert into public.utilisateurs (nom, role, pin, actif, restaurant_id, code_a_changer)
    values (trim(p_nom), coalesce(p_role, 'caissier'), v_pin, true, p_restaurant, true)
    returning id into v_id;
  else
    update public.utilisateurs
       set nom = trim(p_nom), role = p_role, restaurant_id = p_restaurant,
           pin = coalesce(v_pin, pin),
           code_a_changer = case when v_pin is not null then true else code_a_changer end,
           code_version = case when v_pin is not null then code_version + 1 else code_version end,
           echecs_code = case when v_pin is not null then 0 else echecs_code end,
           bloque_jusqua = case when v_pin is not null then null else bloque_jusqua end
     where id = v_id;
  end if;
  insert into public.journal_activite (action, details, restaurant_id, user_id, user_nom)
  values ('utilisateur_enregistre', jsonb_build_object('id', v_id, 'nom', trim(p_nom), 'role', p_role, 'code_donne', v_pin is not null),
          p_restaurant, a.id::text, a.nom);
  return jsonb_build_object('statut', 'ok', 'id', v_id);
end $$;

grant execute on function public.code_trop_simple(text) to anon, authenticated;
grant execute on function public.connexion_utilisateur(uuid, text) to anon, authenticated;
grant execute on function public.changer_mon_code(uuid, text, text) to anon, authenticated;
grant execute on function public.codes_utilisateurs(uuid, text) to anon, authenticated;
grant execute on function public.enregistrer_utilisateur(uuid, text, uuid, text, text, uuid, text) to anon, authenticated;
revoke execute on function public.verifier_admin_codes(uuid, text) from public, anon, authenticated;

-- Contrôle : comptes qui devront changer leur code / comptes techniques.
select count(*) filter (where code_a_changer) as a_changer,
       count(*) filter (where sans_connexion) as techniques,
       count(*) filter (where actif) as actifs
from public.utilisateurs;
