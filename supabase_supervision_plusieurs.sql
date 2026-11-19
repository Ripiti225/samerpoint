-- ════════════════════════════════════════════════════════════════════════════
-- À PASSER DANS LE SQL EDITOR DU PROJET « Samtrackly » — 19/11/2026.
-- Supervision par plusieurs personnes : chaque visite signée par la vraie
-- personne. À passer AVANT de publier l'app (Paramètres lit peut_superviser).
-- Idempotent : peut être relancé sans risque.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Qui peut faire des visites ───────────────────────────────────────
alter table public.utilisateurs
  add column if not exists peut_superviser boolean not null default false;
grant select (peut_superviser) on public.utilisateurs to anon, authenticated;

-- ── 2. Enregistrer un compte : + case « Peut faire des visites » ─────────
-- p_peut_superviser null = inchangé : l'app pas encore à jour continue de
-- marcher (elle n'envoie pas ce paramètre).
drop function if exists public.enregistrer_utilisateur(uuid, text, uuid, text, text, uuid, text);

create or replace function public.enregistrer_utilisateur(
  p_admin uuid, p_admin_pin text, p_id uuid, p_nom text, p_role text, p_restaurant uuid, p_pin text,
  p_peut_superviser boolean default null
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
    insert into public.utilisateurs (nom, role, pin, actif, restaurant_id, code_a_changer, peut_superviser)
    values (trim(p_nom), coalesce(p_role, 'caissier'), v_pin, true, p_restaurant, true, coalesce(p_peut_superviser, false))
    returning id into v_id;
  else
    update public.utilisateurs
       set nom = trim(p_nom), role = p_role, restaurant_id = p_restaurant,
           pin = coalesce(v_pin, pin),
           code_a_changer = case when v_pin is not null then true else code_a_changer end,
           code_version = case when v_pin is not null then code_version + 1 else code_version end,
           echecs_code = case when v_pin is not null then 0 else echecs_code end,
           bloque_jusqua = case when v_pin is not null then null else bloque_jusqua end,
           peut_superviser = coalesce(p_peut_superviser, peut_superviser)
     where id = v_id;
  end if;
  insert into public.journal_activite (action, details, restaurant_id, user_id, user_nom)
  values ('utilisateur_enregistre', jsonb_build_object('id', v_id, 'nom', trim(p_nom), 'role', p_role,
          'code_donne', v_pin is not null, 'peut_superviser', p_peut_superviser),
          p_restaurant, a.id::text, a.nom);
  return jsonb_build_object('statut', 'ok', 'id', v_id);
end $$;

grant execute on function public.enregistrer_utilisateur(uuid, text, uuid, text, text, uuid, text, boolean) to anon, authenticated;

-- ── 3. Le compte « Superviseur » n'est plus qu'une porte d'entrée ────────
-- Plus de code partagé (4321) : on choisit son nom puis on tape SON code.
-- changer_mon_code passe par connexion_utilisateur : refusé aussi.
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
  if u.role = 'superviseur' then
    return jsonb_build_object('statut', 'refuse');
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

grant execute on function public.connexion_utilisateur(uuid, text) to anon, authenticated;

update public.utilisateurs set pin = 'PORTE', code_a_changer = false
 where role = 'superviseur' and pin is distinct from 'PORTE';

-- ── 4. Un gérant ne note jamais son propre restaurant ────────────────────
create or replace function public.supervision_pas_son_resto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.utilisateurs u
              where u.id = new.superviseur_id and u.restaurant_id = new.restaurant_id) then
    raise exception 'Un gérant ne peut pas noter son propre restaurant.';
  end if;
  return new;
end $$;

drop trigger if exists supervision_visites_pas_son_resto on public.supervision_visites;
create trigger supervision_visites_pas_son_resto
  before insert on public.supervision_visites
  for each row execute function public.supervision_pas_son_resto();

-- ── 5. Les 5 personnes qui font des visites aujourd'hui ──────────────────
update public.utilisateurs set peut_superviser = true
 where trim(nom) in ('Administrateur', 'Manager General', 'Responsable RH', 'Zongo Lucien', 'Bonzou Michel')
   and not peut_superviser;

-- Vérification :
-- select nom, role, peut_superviser from utilisateurs where peut_superviser or role = 'superviseur' order by nom;
