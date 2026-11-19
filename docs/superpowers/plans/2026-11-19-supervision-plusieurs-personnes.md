# Supervision par plusieurs personnes — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chaque visite de supervision est signée par la vraie personne (5 comptes autorisés), entrée par la tuile « Superviseur » (choix du nom + son propre code) ou depuis son propre compte.

**Architecture:** colonne `utilisateurs.peut_superviser` + RPC existantes étendues (SQL idempotent). Deux fonctions pures dans `lib/supervision.js` décident qui apparaît et quels restaurants sont visitables. La connexion gagne une étape 7 « Qui fait la visite ? » qui réutilise le clavier de code (étape 4) et force le rôle de session à `superviseur`.

**Tech Stack:** Expo Router / React Native web, Supabase (RPC plpgsql), tests `node:test`.

Spec : `docs/superpowers/specs/2026-11-19-supervision-plusieurs-personnes-design.md`

## Global Constraints

- Interface et messages en français courant.
- Le code des comptes ne quitte jamais le serveur (pas de `select pin`).
- `enregistrer_utilisateur` : `p_peut_superviser` null = inchangé (l'app actuelle continue de marcher).
- SQL à passer par l'utilisateur AVANT toute publication (la liste Paramètres lit `peut_superviser`).
- Pas de publication (Vercel / EAS) sans accord ; commit + push seulement.
- `DEVELOPER_DIR=/Library/Developer/CommandLineTools` pour git.

---

### Task 1 : SQL `supabase_supervision_plusieurs.sql`

**Files:** Create `supabase_supervision_plusieurs.sql`

- [ ] Colonne `peut_superviser boolean not null default false`, `grant select (peut_superviser)` à anon/authenticated.
- [ ] `drop function enregistrer_utilisateur(uuid,text,uuid,text,text,uuid,text)` puis recréation avec `p_peut_superviser boolean default null` : insert `coalesce(p_peut_superviser,false)`, update `peut_superviser = coalesce(p_peut_superviser, peut_superviser)` ; grant execute.
- [ ] `connexion_utilisateur` : après le `select`, `if u.role = 'superviseur' then return jsonb_build_object('statut','refuse'); end if;` (le code 4321 ne sert plus à rien ; `changer_mon_code` passe par cette fonction donc refusé aussi). Code du compte porte remplacé par `'PORTE'`.
- [ ] Trigger `supervision_visites_pas_son_resto` (before insert) : refuse si `superviseur_id` a `restaurant_id = new.restaurant_id`, message « Un gérant ne peut pas noter son propre restaurant. »
- [ ] Coche les 5 comptes (`nom in (...)` trimés).
- [ ] Tester sur Postgres local (schéma minimal) : 4321 refusé, update sans le paramètre garde la case, trigger refuse le gérant sur son resto et accepte ailleurs.
- [ ] Commit `feat(supervision): SQL — case peut_superviser, porte sans code, gérant hors de son resto`.

### Task 2 : fonctions pures + tests

**Files:** Modify `lib/supervision.js`, `lib/supervision.test.mjs`

**Produces:**
- `estPorteSupervision(u) → boolean` (role `superviseur`)
- `superviseursPossibles(utilisateurs) → utilisateur[]` (actifs, `peut_superviser === true`, pas la porte, triés par nom fr)
- `restaurantsVisitables(restaurants, personne) → restaurant[]` (retire `personne.restaurant_id` s'il existe)

- [ ] Tests d'abord (RED), puis implémentation (GREEN) :
  inactif exclu, non coché exclu, porte exclue, tri ; gérant sans son resto ; global voit tout ; personne null voit tout.
- [ ] `for f in lib/*.test.mjs; do node "$f"; done` → 0 échec. Commit.

### Task 3 : Paramètres + données

**Files:** Modify `lib/codesDb.js`, `lib/api.js`, `app/parametres.js`

- [ ] `enregistrerUtilisateur(..., { ..., peutSuperviser })` → `p_peut_superviser: peutSuperviser ?? null`.
- [ ] `lib/api.js` : `getSuperviseursPossibles()` → select `id, nom, role, actif, restaurant_id, code_a_changer, code_version, pin_longueur, sans_connexion, peut_superviser` where `actif and peut_superviser`, puis `superviseursPossibles()`. Hors ligne / erreur → `[]`.
- [ ] Paramètres : `peut_superviser` dans le select de la liste ; ligne à interrupteur « 🧭 Peut faire des visites de supervision » dans le formulaire (masquée pour le rôle `superviseur`) ; envoi `peutSuperviser: !!form.peut_superviser` ; badge « 🧭 Visites » dans les deux listes.
- [ ] Lint. Commit.

### Task 4 : connexion par la tuile

**Files:** Modify `app/login.js`, `components/login/QuiEtesVous.js`

- [ ] `QuiEtesVous` : props optionnelles `titre` (défaut « Qui êtes-vous ? »), `puce` (texte de la puce sans restaurant, défaut « Accès global »), `messageVide`.
- [ ] `toucherAvatar(user)` : si `estPorteSupervision(user)` → `ouvrirPorteSupervision()` (étape 7, charge `getSuperviseursPossibles()`).
- [ ] Étape 7 : `QuiEtesVous` titre « Qui fait la visite ? », puce « 🧭 Supervision », vide « Personne n'est autorisé à faire des visites. Demandez au manager. », choix → `choisirUtilisateur({ ...u, modeVisite: true })`, retour → étape 3.
- [ ] Étape 4 : sous-titre « Visite de supervision » si `selected.modeVisite` ; « Ce n'est pas moi » → étape 7 dans ce mode ; pas de Face ID (touche masquée).
- [ ] `apresCodeJuste` : pas de proposition Face ID si `modeVisite`.
- [ ] `ouvrirSession` : `role = utilisateur.modeVisite ? 'superviseur' : utilisateur.role` pour `setRoleActif`, `estGlobal` et la redirection.
- [ ] Lint. Commit.

### Task 5 : écrans de visite

**Files:** Modify `app/superviseur.js`, `app/supervision.js`, `lib/supervisionDb.js`

- [ ] `supervisionDb.chargerPersonne(userId)` → `{ id, restaurant_id, peut_superviser }` (null si erreur).
- [ ] `superviseur.js` : charge la personne, `restaurantsVisitables(restaurants, personne)` pour la liste ; param `depuis=compte` → en-tête « ‹ Retour » (vers `/supervision`) au lieu de « Quitter », et `onDeconnecter` de la visite = retour sans déconnexion.
- [ ] `supervision.js` : si `chargerPersonne(userId).peut_superviser` → bouton « 🧭 Faire une visite » → `router.push({ pathname: '/superviseur', params: { depuis: 'compte' } })`.
- [ ] Erreur trigger à la création de visite → message du serveur s'il parle du propre restaurant.
- [ ] Lint + tests. Commit.

### Task 6 : clôture

- [ ] `graphify update .`, commit + push.
- [ ] Mémoire projet mise à jour (SQL à passer, non publié).
