# Journal de Caisse SYSCOHADA — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis Clôture du mois, télécharger un Excel « journal de Caisse » SYSCOHADA (groupe ou restaurant), équilibré journée par journée.

**Architecture:** Plan de comptes dans `lib/comptesSyscohada.js` ; écritures calculées par une fonction pure `lib/journalCaisse.js` (testée sous node, dont un cas réel d'octobre) ; chargement Supabase paginé + classeur `xlsx` dans `lib/exportJournalCaisse.js` (réutilise `enregistrer` de `lib/exportRapportMensuel.js`) ; bouton dans `app/cloture-mois.js`.

**Tech Stack:** Expo / React Native, Supabase, `xlsx` (import dynamique), tests `node:test`.

Spec : `docs/superpowers/specs/2026-11-19-export-comptable-caisse-design.md`

## Global Constraints

- Montants en francs entiers (arrondis), jamais de décimales dans le journal.
- Chaque pièce (restaurant + date) : total débit = total crédit, exactement.
- Comptes uniquement via `COMPTES` (jamais un numéro en dur ailleurs).
- Journées `source = 'import_sheets_2026_10'` ou sans shift : exclues, comptées dans Contrôle.
- Mois non clôturé : « PROVISOIRE » dans le nom du fichier et en tête de chaque onglet.
- Lectures Supabase paginées par 1 000 ; listes d'ids découpées par 100 pour `.in()`.
- Pas d'`expo start` ; vérification par tests, lint, export web.

---

### Task 1: Plan de comptes + écritures d'une journée

**Files:** Create `lib/comptesSyscohada.js`, `lib/journalCaisse.js`, `lib/journalCaisse.test.mjs`

**Interfaces — Produces:**
- `COMPTES: { [cle]: { compte: string, intitule: string } }` (clés : ventesCaisse, ventesLivraison, caisse, om, wave, djamo, yango, glovo, samerDelly, fournisseurs, achats, autresAchats, personnel, cadeaux, remises, ecartManque, ecartSurplus)
- `ecrituresJournee({ point, shifts, depensesCaissier, deductionsGerant, factures, restaurant: { nom, court } }) → { lignes: Ligne[], exclue: boolean, ecart: number }`
  avec `Ligne = { journal: 'CA', date, piece, compte, intitule, libelle, debit, credit, restaurant }`
- `controleJournal(lignes) → { parRestaurant: { [nom]: { debit, credit, difference } }, groupe: { debit, credit, difference } }`

- [ ] Step 1 — tests (équilibre ; écart surplus/manque = vente machine − théorique ; tablettes ; caisse gérant par catégorie ; facture non alimentaire en Autres achats ; salaires caissier = reste de `depensesSalairesShift` ; montant négatif inversé ; journée importée exclue ; cas réel KMS 10/10/2026).
- [ ] Step 2 — vérifier l'échec.
- [ ] Step 3 — implémenter (voir code dans les fichiers ; règles de la spec, section « Écritures d'une journée »).
- [ ] Step 4 — `node lib/journalCaisse.test.mjs` → `fail 0`.
- [ ] Step 5 — commit `feat(comptabilite): écritures du journal de caisse`.

### Task 2: Contrôle sur les vraies données d'octobre

- [ ] Requête SQL lecture seule : journées d'octobre où le détail des dépenses du caissier dépasse `depensesSalairesShift` (seul cas où l'écart ≠ vente machine − théorique). Résultat noté dans le message final ; si > 0, l'onglet Contrôle affiche la colonne « Écart inexpliqué ».

### Task 3: Chargement + Excel

**Files:** Create `lib/exportJournalCaisse.js`

**Interfaces — Produces:** `exporterJournalCaisse({ mois: 'AAAA-MM', restaurantId: string | null, provisoire: boolean, onProgres? }) → Promise<{ nomFichier, nbLignes, nbExclues }>`
**Consumes:** `ecrituresJournee`, `controleJournal`, `COMPTES` (Task 1) ; `bornesMois`, `libelleMois` (`lib/clotureMois.js`) ; `nomCourtResto` (`lib/groupesAccueil.js`) ; `enregistrer` (`lib/exportRapportMensuel.js`) ; `supabase`.

- [ ] Charger points du mois (filtre restaurant éventuel), puis par paquets de 100 ids : `points_shifts`, `depenses` (`saisi_par = 'caissier'`), `depenses_gerant_caisse`, `transactions_fournisseurs` (`facture` non nul) ; tout paginé.
- [ ] Construire les onglets Journal / Contrôle / Plan de comptes ; ligne PROVISOIRE si besoin ; nom `Journal-caisse-AAAA-MM[-Resto][-PROVISOIRE].xlsx`.
- [ ] Commit `feat(comptabilite): fichier Excel du journal de caisse`.

### Task 4: Bouton dans Clôture du mois

**Files:** Modify `app/cloture-mois.js`

- [ ] Dans le détail d'un mois : choix « Tout le groupe » / chaque restaurant (puces ≥ 44 px), bouton « 📥 Export comptable » (+ « provisoire » si mois non clôturé), message de progression, erreurs en français.
- [ ] Tests, lint (0 erreur), `npx expo export -p web`, commit `feat(comptabilite): export comptable depuis Clôture du mois`, `graphify update .`, push.
