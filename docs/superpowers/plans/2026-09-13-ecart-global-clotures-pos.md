# Écart global des clôtures POS — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher `rapport_z.diff` comme « Écart global » des clôtures, tout en conservant `services_caisse.ecart` comme détail « Écart espèces ».

**Architecture:** Le pont POS expose la valeur figée dans `points_shifts.ecart_reconciliation`; SamerTrackly ne la recalcule jamais et ne retombe jamais sur `ecart_pos`. Un module métier pur normalise, formate et agrège les clôtures validées sans doublons. Les écrans et rapports consomment ce module, tandis que `ecart_pos` reste réservé au tiroir et aux litiges espèces.

**Tech Stack:** React Native / Expo, JavaScript ES modules, Supabase/PostgreSQL, `node:test`.

**Spec:** Demande utilisateur du 13 septembre 2026, reproduite dans les contraintes ci-dessous.

## Global Constraints

- Source officielle de l'écart global : `rapport_z.diff`, exposé sans transformation dans `points_shifts.ecart_reconciliation`.
- Source de l'écart espèces : `services_caisse.ecart`, déjà exposé dans `points_shifts.ecart_pos`.
- Libellés exacts : « Écart global » et « Écart espèces ».
- Valeurs entières signées en FCFA; zéro s'affiche `0 FCFA`; une absence s'affiche « Non disponible ».
- Aucun repli de `ecart_reconciliation` vers `ecart_pos` et aucune reconstruction de `diff` dans SamerTrackly.
- Les agrégats somment uniquement les clôtures `valide = true`, dédupliquées par `pos_service_id` puis `id`.
- Les filtres existants de restaurant, caissier, période et statut restent appliqués avant l'agrégation.
- Aucune modification du calcul métier du POS ni refactorisation sans rapport.

---

### Task 1: Contrat métier pur des clôtures

**Files:**
- Create: `lib/cloturesCaisse.js`
- Create: `lib/cloturesCaisse.test.mjs`

**Interfaces:**
- Produces: `formaterMontantSigneFCFA(value)`, `cloturesPOS(shifts)`, `resumerEcartsGlobaux(shifts)`.
- `cloturesPOS` renvoie une ligne par service POS clôturé avec `ecartGlobal`, `ecartEspeces` et leurs textes, sans jamais substituer l'un à l'autre.

- [x] **Step 1: Écrire les tests en échec** pour les couples `0/-5000`, `-2000/0`, l'absence de `diff`, le format signé et l'agrégat dédupliqué des seuls services clôturés.
- [x] **Step 2: Exécuter `node --test lib/cloturesCaisse.test.mjs`** et vérifier que l'échec vient de l'API absente.
- [x] **Step 3: Implémenter le module minimal** avec validation d'entiers, absence représentée par `null`, déduplication et comptage des indisponibles.
- [x] **Step 4: Réexécuter le test ciblé** et obtenir zéro échec.

### Task 2: Stockage et affichage des clôtures

**Files:**
- Modify: `supabase_pos_bascule.sql`
- Modify: `supabase_migrations_all.sql`
- Modify: `lib/ecartPOS.js`
- Modify: `app/ventes.js`
- Modify: `app/verification.js`

**Interfaces:**
- Consumes: `points_shifts.ecart_reconciliation = rapport_z.diff`, `points_shifts.ecart_pos = services_caisse.ecart`.
- Produces: listes où chaque clôture présente « Écart global » en premier et « Écart espèces » en détail, avec total disponible et nombre d'anciennes clôtures indisponibles.

- [x] **Step 1: Ajouter `ecart_reconciliation BIGINT`** avec commentaire de source et interdiction explicite de repli/recalcul.
- [x] **Step 2: Étendre les sélections de shifts** pour recevoir ce champ sans modifier les filtres existants.
- [x] **Step 3: Remplacer l'ancien indicateur principal** dans Ventes et Vérification par les lignes issues de `cloturesPOS` et le total issu de `resumerEcartsGlobaux`.
- [x] **Step 4: Conserver `ecart_pos`** sous le seul libellé « Écart espèces » et garder les explications/litiges existants.

### Task 3: Résumés mensuels et exports

**Files:**
- Modify: `lib/rapportMensuel.js`
- Modify: `lib/exportRapportMensuel.js`
- Test: `lib/cloturesCaisse.test.mjs`

**Interfaces:**
- Consumes: shifts déjà filtrés par mois et éventuellement restaurant.
- Produces: `ecartGlobal`, `ecartGlobalDisponible`, `ecartGlobalIndisponibles`, `ecartEspeces`; détail Excel par clôture.

- [x] **Step 1: Charger les deux écarts et l'identifiant POS** dans la requête mensuelle.
- [x] **Step 2: Calculer les agrégats depuis les seuls shifts validés** avec le module métier, jamais depuis `points.ecart_caisse` pour l'indicateur global.
- [x] **Step 3: Renommer les sorties principales en « Écart global »** et les contrôles tiroir en « Écart espèces » dans PowerPoint, Excel et PDF.
- [x] **Step 4: Exporter les clôtures historiques sans `diff` comme « Non disponible »** et afficher leur nombre dans les synthèses.

### Task 4: Vérification finale

**Files:**
- Update: `graphify-out/`

**Interfaces:**
- Consumes: tous les fichiers modifiés.
- Produces: preuves fraîches de tests, lint, export web et graphe à jour.

- [x] **Step 1: Exécuter tous les `lib/*.test.mjs`** et confirmer zéro échec.
- [x] **Step 2: Exécuter `npm run lint`** et confirmer zéro erreur.
- [x] **Step 3: Exécuter `npx expo export -p web`** et confirmer la compilation.
- [x] **Step 4: Exécuter `git diff --check` et `graphify update .`**.
