-- ─────────────────────────────────────────────────────────────────────────
--  JOURNAL D'ACTIVITÉ — rattacher les entrées à leur restaurant
--
--  Problème corrigé
--  ────────────────
--  10 591 entrées sur 12 965 (82 %) n'ont aucun `restaurant_id`. Or l'écran
--  Journal filtre par restaurant : pour un gérant, l'historique est donc
--  quasiment vide, et le nom du restaurant ne peut pas s'afficher.
--
--  La cause est côté application : plusieurs appels à journaliser() ne
--  transmettaient pas le contexte du restaurant. Corrigé pour les nouvelles
--  entrées (validations, dépenses, fournisseurs, inventaire) ; ce script
--  répare l'existant.
--
--  10 201 des 10 591 entrées portent un `point_id` et peuvent donc retrouver
--  leur restaurant. Les 390 restantes n'ont aucun rattachement possible :
--  elles resteront visibles uniquement en vue globale (manager, directeur).
--
--  ⚠️ À exécuter sur le projet Samtrackly (wlwotzxnzowbkbfcpnyi), pas sur
--     celui du POS. Le script s'arrête tout seul si la table est absente.
--
--  Idempotent — rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 0. Garde-fou ────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.journal_activite') is null then
    raise exception
      'Mauvais projet Supabase : public.journal_activite est introuvable sur la base "%". Vérifiez le sélecteur de projet.',
      current_database();
  end if;
end $$;

-- ── 1. Rattrapage via le point ──────────────────────────────────────────
--  On ne touche jamais une entrée qui a déjà un restaurant.

update public.journal_activite j
   set restaurant_id = p.restaurant_id
  from public.points p
 where j.point_id = p.id
   and j.restaurant_id is null
   and p.restaurant_id is not null;

-- ── 2. Index : l'écran filtre sur restaurant + date, et sur l'action ────

create index if not exists idx_journal_restaurant_date
  on public.journal_activite (restaurant_id, created_at desc);

create index if not exists idx_journal_action_date
  on public.journal_activite (action, created_at desc);

-- ── 3. Contrôle ─────────────────────────────────────────────────────────

do $$
declare
  total      bigint;
  orphelines bigint;
  sans_point bigint;
begin
  select count(*) into total from public.journal_activite;
  select count(*) into orphelines
    from public.journal_activite where restaurant_id is null;
  select count(*) into sans_point
    from public.journal_activite where restaurant_id is null and point_id is null;
  raise notice 'Journal : % entrées au total, % encore sans restaurant (dont % sans point rattachable)',
    total, orphelines, sans_point;
end $$;
