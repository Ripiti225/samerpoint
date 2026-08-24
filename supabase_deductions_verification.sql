-- ─────────────────────────────────────────────────────────────────────────
--  VÉRIFICATION DE STOCK → MONTANTS À DÉDUIRE
--
--  Ce que ça apporte
--  ─────────────────
--  Quand le vérificateur compte physiquement et trouve un écart (50 pains
--  déclarés, 48 comptés), la valeur du manque devient un montant à déduire,
--  imputé aux caissiers concernés, confirmé ensuite par l'administration —
--  exactement comme un écart d'inventaire.
--
--  Règles retenues avec l'utilisateur :
--   • Montant = |écart| × prix du produit. Le SURPLUS compte comme un
--     manquant : trouver plus que déclaré peut signaler des produits entrés
--     en douce, c'est donc anormal dans les deux sens.
--   • PLAFOND de 50 000 F par comptage. Les montants réels restent visibles ;
--     le plafond limite seulement ce qui est retenu.
--   • L'app PROPOSE une répartition (caissier en poste à l'heure du comptage
--     + caissier du shift précédent, à parts égales), mais c'est
--     l'administration qui RÉPARTIT réellement, montant par montant.
--   • Elle peut aussi mettre tout ou partie à la charge du GÉRANT du
--     restaurant, quand aucun caissier n'est précisément en cause.
--   • L'explication est saisie par le VÉRIFICATEUR au moment du comptage.
--   • Statut « en_attente » tant que la répartition n'est pas confirmée.
--
--  Une ligne = une PERSONNE pour UN COMPTAGE (et non par produit) : c'est une
--  enveloppe que l'administration redistribue. Le détail produit par produit
--  reste dans verifications_stock, et un résumé lisible est conservé ici.
--
--  Pourquoi une table dédiée plutôt que inventaire_lignes
--  ──────────────────────────────────────────────────────
--  app/inventaire.js supprime et réinsère TOUTES les lignes du shift à chaque
--  sauvegarde. Une ligne posée ici dans un shift encore ouvert serait effacée
--  sans le moindre message — c'est la même raison qui a fait porter l'override
--  de stock initial par le shift et non par les lignes (verificationStock.js).
--  Les montants de cette table s'ajoutent au total à déduire de l'inventaire.
--
--  ⚠️ À exécuter sur le projet Samtrackly (wlwotzxnzowbkbfcpnyi).
--  Idempotent — rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 0. Garde-fou ────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.verifications_stock') is null then
    raise exception
      'Mauvais projet Supabase : public.verifications_stock est introuvable sur la base "%".',
      current_database();
  end if;
end $$;

-- ── 1. La table ─────────────────────────────────────────────────────────

create table if not exists public.deductions_verification (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id),
  date              date not null,
  -- TEXTE et non uuid : verifications_stock.lot_id vaut « <uuid>-<timestamp> »
  -- (app/verificateur.js), ce qui n'est pas un uuid valide. Le typer en uuid
  -- faisait échouer toute insertion avec « invalid input syntax for type uuid ».
  lot_id            text,               -- lot de comptage (verifications_stock.lot_id)
  point_id          uuid references public.points(id),

  -- Le constat, identique pour toutes les lignes d'un même comptage
  nb_produits       integer,            -- nombre de produits en écart
  produits_resume   text,               -- « Pain chawarma −21, Nespresso −1 »
  montant_ecart     numeric,            -- valeur totale des écarts, AVANT plafond
  montant_plafond   numeric,            -- ce qui est réellement réparti (≤ 50 000)

  -- La personne à qui l'administration impute cette part
  beneficiaire_type text,               -- 'caissier' | 'gerant'
  caissier_id       uuid,
  caissier_nom      text,
  shift_libelle     text,               -- « 00:00–08:00 », vide pour un gérant
  role_dans_ecart   text,               -- 'en_poste' | 'shift_precedent' | 'gerant' | 'ajoute'
  montant           numeric not null,   -- part imputée à CETTE personne
  montant_propose   numeric,            -- ce que l'app avait suggéré, pour comparaison
  -- Part de l'enveloppe reconnue comme justifiée, donc NON déduite. Le reste
  -- (montant_plafond − montant_justifie) est ce qui se répartit entre les
  -- personnes. Une justification totale revient à montant_justifie =
  -- montant_plafond et aucune part imputée.
  montant_justifie  numeric default 0,

  explication       text,               -- saisie par le vérificateur
  verificateur_id   uuid,
  verificateur_nom  text,

  -- en_attente  : proposition de l'app, pas encore tranchée
  -- repartie    : l'administration a confirmé la répartition → montant dû
  -- validee     : intégralement justifié, rien à déduire
  -- Une décision reste TOUJOURS modifiable : l'écran rouvre le comptage et
  -- réécrit les lignes.
  statut            text not null default 'en_attente',
  decide_par_id     uuid,
  decide_par_nom    text,
  decide_at         timestamptz,

  created_at        timestamptz not null default now()
);

comment on table public.deductions_verification is
  'Montants à déduire issus des comptages du vérificateur. Une ligne = une PERSONNE pour un comptage. L''app propose une répartition, l''administration la modifie librement et peut imputer au gérant. Le détail produit reste dans verifications_stock.';

comment on column public.deductions_verification.montant is
  'Part imputée à cette personne. La somme des parts d''un comptage vaut montant_plafond. Ne compte dans le total à déduire que si statut <> ''validee''.';

comment on column public.deductions_verification.montant_plafond is
  'Enveloppe réellement répartie : min(montant_ecart, 50 000). Le plafond s''applique PAR COMPTAGE.';

comment on column public.deductions_verification.ecart is
  'stock_compte − stock_declare. Négatif = manquant, positif = surplus. Les deux sont déduits : un surplus peut signaler des produits entrés en douce.';

-- ── 1 bis. Rattrapage des installations antérieures ─────────────────────
--  La première version imputait PAR PRODUIT et typait lot_id en uuid. On
--  ajoute les colonnes manquantes et on corrige le type, sans perte.

alter table public.deductions_verification
  add column if not exists nb_produits       integer,
  add column if not exists produits_resume   text,
  add column if not exists montant_ecart     numeric,
  add column if not exists montant_plafond   numeric,
  add column if not exists beneficiaire_type text,
  add column if not exists montant_propose   numeric,
  add column if not exists montant_justifie  numeric default 0;

-- ── 1 ter. Type de lot_id ───────────────────────────────────────────────
--  La première version de ce script typait lot_id en uuid, ce qui rendait
--  toute insertion impossible. On corrige le type sans perdre de données.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'deductions_verification'
       and column_name  = 'lot_id'
       and data_type    = 'uuid'
  ) then
    alter table public.deductions_verification
      alter column lot_id type text using lot_id::text;
    raise notice 'lot_id converti de uuid vers text.';
  end if;
end $$;

-- ── 2. Index ────────────────────────────────────────────────────────────

create index if not exists idx_dedverif_resto_date
  on public.deductions_verification (restaurant_id, date desc);

create index if not exists idx_dedverif_statut
  on public.deductions_verification (statut, date desc);

create index if not exists idx_dedverif_caissier
  on public.deductions_verification (caissier_id, date desc);

create index if not exists idx_dedverif_lot
  on public.deductions_verification (lot_id);

-- ── 3. Sécurité — même posture que le reste du projet ───────────────────

alter table public.deductions_verification enable row level security;

drop policy if exists "lecture deductions_verification" on public.deductions_verification;
create policy "lecture deductions_verification"
  on public.deductions_verification for select using (true);

drop policy if exists "ecriture deductions_verification" on public.deductions_verification;
create policy "ecriture deductions_verification"
  on public.deductions_verification for insert with check (true);

drop policy if exists "maj deductions_verification" on public.deductions_verification;
create policy "maj deductions_verification"
  on public.deductions_verification for update using (true);

drop policy if exists "suppression deductions_verification" on public.deductions_verification;
create policy "suppression deductions_verification"
  on public.deductions_verification for delete using (true);

-- ── 4. Contrôle ─────────────────────────────────────────────────────────

do $$
declare n bigint;
begin
  select count(*) into n from public.deductions_verification;
  raise notice 'deductions_verification prête — % ligne(s) actuellement.', n;
end $$;
