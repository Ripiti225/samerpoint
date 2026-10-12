# Recherche globale — lot 1 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une loupe sur l'accueil (manager, gérant) qui cherche un mot dans tous les textes de la base et ouvre l'écran du résultat.

**Architecture:** une fonction SQL `recherche_globale` (UNION ALL des sources, sans accents, filtre restaurant/manager en base) ; une lib pure `lib/rechercheGlobale.js` (extrait surligné, groupes, routes, accès gérant) ; un écran `app/recherche.js` ; un bandeau de rappel global alimenté par `lib/rechercheCourante.js`.

**Tech Stack:** Supabase (Postgres 15, `unaccent`), Expo Router, React Native, node:test.

## Global Constraints

- Tout en français ; montants en F CFA (`toLocaleString('fr-FR')`).
- Styles par `useMemo(() => makeStyles(colors), [colors])`, thème clair/sombre.
- Migration à passer à la main par l'utilisateur (`supabase_recherche_globale.sql`, idempotente).
- Ne pas publier (Vercel/EAS) : commit + push seulement.
- Avant commit : `npm run lint` 0 erreur, `for f in lib/*.test.mjs; do node "$f"; done` 0 échec.

---

### Task 1 : Migration SQL

**Files:** Create `supabase_recherche_globale.sql`

- [x] Écrire `rg_norm(text)` + `recherche_globale(p_terme, p_restaurant_id, p_manager, p_limite default 25)` (sources de la spéc, 25 résultats max par source).
- [x] Tester sur un Postgres 16 local avec la structure des tables de prod : accents/majuscules, `%` `_` littéraux, terme < 2 lettres → rien, gérant = son restaurant sans les sources manager, gérant sans restaurant → rien.
- [ ] Commit `feat(recherche): fonction SQL recherche_globale`.

### Task 2 : Lib pure + tests

**Files:** Create `lib/rechercheGlobale.js`, `lib/rechercheGlobale.test.mjs`, `lib/rechercheCourante.js`

**Produces:**
- `LONGUEUR_MIN = 3`, `LIMITE_PAR_SOURCE = 25`
- `normaliser(s) → string`
- `extrait(texte, terme, rayon = 40) → { avant, trouve, apres }`
- `texteLisible(texte) → string` (JSON `{"note":"x"}` → `note : x`)
- `grouperParSource(resultats) → [{ source, resultats }]`
- `cheminEcran(r) → 'Trésorerie › À payer › Anciens travailleurs'`
- `routePour(r) → { pathname, params }`
- `peutOuvrir(r, idsTuiles, manager) → boolean`
- `dateCourte('2026-10-12') → '12/10/26'`
- `rechercheCourante` : `definir(r)`, `lire()`, `abonner(fn) → désabonner`

- [ ] Tests d'abord (node:test), les voir échouer, implémenter, les voir passer.
- [ ] Commit `feat(recherche): logique pure de la recherche globale`.

### Task 3 : API + écran Recherche

**Files:** Modify `lib/api.js` (ajout `rechercheGlobale`), Create `app/recherche.js`, Modify `app/_layout.tsx` (Stack.Screen `recherche`)

- [ ] `rechercheGlobale(terme, { restaurantId, manager })` → `{ horsLigne, resultats }` (RPC, pas de cache).
- [ ] Écran : champ autofocus, recherche à 3 lettres + 350 ms, requêtes périmées ignorées, groupes par source, carte = chemin · resto (manager) · date · champ, extrait surligné, montant ; carte non ouvrable grisée pour le gérant ; états vide / hors ligne / erreur / « 25 plus récents ».
- [ ] Toucher : `rechercheCourante.definir(r)` puis `router.push(routePour(r))`.
- [ ] Lint + tests ; commit `feat(recherche): écran Recherche`.

### Task 4 : Loupe + bandeau

**Files:** Modify `app/accueil.js` (bouton 🔍 à côté de la cloche, manager et gérant), Create `components/BandeauRecherche.js`, Modify `app/_layout.tsx` (monter le bandeau)

- [ ] Bandeau : visible quand `rechercheCourante.lire()` existe et que la route courante n'est ni `recherche` ni `accueil` ; « 🔍 12/10/26 · Yop · …extrait… » + croix ; vidé au retour sur Recherche.
- [ ] Lint + tests + `npx expo export -p web` ; `graphify update .` ; commit `feat(recherche): loupe sur l'accueil et bandeau de rappel` ; push.
