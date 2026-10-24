# Cotisations reçues dans Banque — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saisir chaque cotisation reçue d'un restaurant dans Banque (comptes « Cotisation salaire » et « Cotisations autres »), avec effet automatique sur la fiche du restaurant et sur son résultat du mois de réception.

**Architecture:** La table `tresorerie_cotisations_recues` accepte une ligne sans charge (`du_id` vide) mais avec `categorie`. L'argent entre dans le compte de cotisation choisi (mouvement `cotisation`). Le résultat ajoute une ligne de charge négative par restaurant, catégorie et mois de la date.

**Tech Stack:** Expo / React Native web, Supabase, tests `node:test`.

## Global Constraints

- Interface en français, montants en F (FCFA, entiers).
- Dates au calendrier (`ChampCalendrier`), jamais tapées.
- Toutes les catégories (salaire, cnps, impot, its, tee, loyer, bail) réduisent le résultat (choix utilisateur du 24/10).
- Anciennes cotisations (avec `du_id`) : comportement inchangé.
- Pas de publication (Vercel / EAS) avant la fin ; commit + push seulement.

---

### Task 1 : migration `supabase_cotisations_banque.sql`

- [ ] `ALTER TABLE tresorerie_cotisations_recues ALTER COLUMN du_id DROP NOT NULL`, `ADD COLUMN IF NOT EXISTS categorie text`, index `(du_id) WHERE du_id IS NULL` sur date.
- [ ] Insérer les comptes `Cotisation salaire` (ordre 10) et `Cotisations autres` (ordre 11) s'ils manquent.

### Task 2 : `lib/cotisations.js` (pur, testé)

**Produces:**
- `COMPTE_COTISATION_SALAIRE = 'Cotisation salaire'`, `COMPTE_COTISATIONS_AUTRES = 'Cotisations autres'`
- `CATEGORIES_COTISATIONS_AUTRES = ['cnps','impot','its','tee','loyer','bail']`
- `LIBELLES_COTISATION : { [categorie]: string }`
- `categoriesDuCompte(compte) → string[] | null`
- `lignesResultatCotisations(cotisations) → [{ restaurant_id, mois, libelle, montant (<0), source: 'tresorerie', categorie }]` — seules les lignes sans `du_id`, regroupées par restaurant + mois (AAAA-MM de `date`) + catégorie.
- `recuDuMois(cotisations, { restaurantId, categorie, mois }) → number` (lignes sans `du_id`, `mois` = 'AAAA-MM' ou 'AAAA-MM-01').

- [ ] Tests dans `lib/cotisations.test.mjs` (échouent), puis code, puis tests verts.

### Task 3 : `lib/chargesMois.js`

- [ ] `fusionnerChargesResultat(anciennes, dus, paiementsAutres, cotise, cotisationsBanque = [])` ajoute `lignesResultatCotisations(cotisationsBanque)`.
- [ ] `chargerChargesResultat` lit `tresorerie_cotisations_recues` `du_id IS NULL`, date dans la plage (erreur = ignoré).
- [ ] Test dans `lib/chargesMois.test.mjs`.

### Task 4 : `lib/tresorerieDb.js`

- [ ] `recevoirCotisation({ du?, restaurantId?, categorie?, compteId?, compteEspecesId?, fournisseur, montant, date, note, nomResto })` : compte = `compteId || compteEspecesId` ; restaurant = `du?.restaurant_id || restaurantId` ; insère `categorie` seulement quand pas de `du`.

### Task 5 : `app/tresorerie-banque.js`

- [ ] Fenêtre d'un compte de cotisation : bouton « Cotisation reçue » (vue `cotisation`) à la place d'« Entrée ».
- [ ] `FormCotisation` : restaurant (Puces), cotisation (Puces, comptes « autres » seulement), montant, date, note ; fiche diminuée affichée.
- [ ] Appui long sur un mouvement `cotisation` lié à une ligne sans charge → « Annuler la cotisation » (`annulerCotisation`).
- [ ] Message si la migration manque (comptes absents).

### Task 6 : saisie du mois + détail d'une charge

- [ ] `components/tresorerie/saisieGroupee.js` : retirer « Dont cotisé » ; afficher « Cotisations reçues en <mois> : X F » par restaurant (`recuDuMois`).
- [ ] `components/tresorerie/du.js` : retirer le bouton et le formulaire d'ajout ; garder la liste et l'annulation des anciennes.
- [ ] `app/tresorerie-resultats.js` : phrase d'explication.

### Task 7 : vérification

- [ ] `npm run lint` (0 erreur), `for f in lib/*.test.mjs; do node "$f"; done` (0 échec), `npx expo export -p web`.
- [ ] Commit + push ; `graphify update .`.
