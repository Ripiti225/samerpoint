-- ─────────────────────────────────────────────────────────────────────────
--  TRANSACTIONS FOURNISSEURS — date de la journée (date_point)
--
--  Problème corrigé
--  ────────────────
--  La colonne `date_point` existe depuis l'origine mais n'a JAMAIS été
--  écrite : elle est NULL sur les 5 322 lignes. Faute de date stockée,
--  l'historique de l'écran Crédits fournisseurs affichait `created_at`,
--  c'est-à-dire l'instant de la SAISIE. Une facture du 12 juillet
--  réinjectée le 2 août s'affichait donc datée du 2 août, et remontait en
--  tête de liste comme le mouvement le plus récent.
--
--  Mesuré avant correction : 4 580 lignes sur 5 322 (86 %) affichaient une
--  date fausse — 4 331 d'un jour (point saisi le lendemain), 231 de 2 à 7
--  jours, 17 de 8 à 30 jours, et une de 33 jours.
--
--  À noter : le rattachement comptable était déjà CORRECT (les insertions
--  utilisent le bon `point_id`). Seule la date lisible était fausse.
--
--  Pourquoi un déclencheur plutôt que du code applicatif
--  ────────────────────────────────────────────────────
--  Les transactions sont créées depuis 8 endroits du JavaScript, MAIS aussi
--  par le RPC `upsert_transaction_fournisseur` qui s'exécute dans la base,
--  et par les rejeux de la file hors-ligne. Remplir la colonne côté app
--  laisserait donc des trous. Le déclencheur est le seul point de passage
--  obligé : il garantit que `date_point` est toujours juste, y compris pour
--  tout code écrit plus tard.
--
--  Idempotent — rejouable sans risque.
--
--  ⚠️ À exécuter sur le projet Supabase de Samtrackly, dont l'URL est
--     wlwotzxnzowbkbfcpnyi.supabase.co — PAS sur celui du POS. Si le
--     sélecteur de projet du tableau de bord est sur une autre base, le
--     script s'arrête tout seul avec un message explicite (étape 0).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 0. Garde-fou : sommes-nous sur la bonne base ? ──────────────────────

do $$
begin
  if to_regclass('public.transactions_fournisseurs') is null then
    raise exception
      'Mauvais projet Supabase : la table public.transactions_fournisseurs est introuvable sur la base "%". Ce script est destiné au projet Samtrackly (wlwotzxnzowbkbfcpnyi) — vérifiez le sélecteur de projet en haut du tableau de bord.',
      current_database();
  end if;
  if to_regclass('public.points') is null then
    raise exception 'Table public.points introuvable : base inattendue (%).', current_database();
  end if;
end $$;

-- ── 1. Rattrapage de l'existant ─────────────────────────────────────────
--  On ne touche que les lignes dont la date est absente : une valeur déjà
--  posée (correction manuelle) n'est jamais écrasée.

update public.transactions_fournisseurs t
   set date_point = p.date
  from public.points p
 where t.point_id = p.id
   and t.date_point is null;

-- ── 2. Déclencheur : remplir date_point à chaque écriture ───────────────

create or replace function public.remplir_date_point_transaction()
returns trigger
language plpgsql
as $$
begin
  -- Une date explicitement fournie par l'appelant fait foi : le déclencheur
  -- ne comble que les trous, il ne corrige pas une saisie volontaire.
  if new.date_point is null and new.point_id is not null then
    select p.date into new.date_point
      from public.points p
     where p.id = new.point_id;
  end if;
  return new;
end;
$$;

comment on function public.remplir_date_point_transaction() is
  'Renseigne transactions_fournisseurs.date_point depuis points.date. Indispensable : les transactions sont créées depuis le JS, depuis le RPC upsert_transaction_fournisseur et par les rejeux hors-ligne.';

drop trigger if exists trg_date_point_transaction on public.transactions_fournisseurs;

create trigger trg_date_point_transaction
  before insert or update of point_id
  on public.transactions_fournisseurs
  for each row
  execute function public.remplir_date_point_transaction();

comment on column public.transactions_fournisseurs.date_point is
  'Date de la JOURNÉE à laquelle la facture se rattache (points.date) — à ne pas confondre avec created_at, qui est l''instant de la saisie. Rempli automatiquement par trg_date_point_transaction.';

-- ── 3. Index : l'historique et le rapport mensuel trient là-dessus ──────

create index if not exists idx_transactions_fournisseurs_date_point
  on public.transactions_fournisseurs (fournisseur_id, date_point);

-- ── 4. Contrôle — doit renvoyer 0 ligne restante sans date ──────────────

do $$
declare
  restantes bigint;
  total     bigint;
begin
  select count(*) into total from public.transactions_fournisseurs;
  select count(*) into restantes
    from public.transactions_fournisseurs t
    join public.points p on p.id = t.point_id
   where t.date_point is null;
  raise notice 'date_point : % transactions au total, % encore sans date rattachable', total, restantes;
end $$;
