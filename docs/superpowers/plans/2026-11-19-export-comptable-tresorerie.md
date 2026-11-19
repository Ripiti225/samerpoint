# Journal Banque et Trésorerie — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ajouter les journaux BQ (mouvements de Trésorerie) et OD (commissions estimées, publicité Glovo) à l'export comptable.

**Architecture:** Fonctions pures dans `lib/journalTresorerie.js` (testées sous node), comptes dans `lib/comptesSyscohada.js`, chargement et classeur dans `lib/exportJournalCaisse.js`, libellé du bouton dans `app/cloture-mois.js`.

Spec : `docs/superpowers/specs/2026-11-19-export-comptable-tresorerie-design.md`

## Global Constraints
- Francs entiers, chaque pièce équilibrée, numéros de comptes seulement via `COMPTES`.
- Ambigu ou inconnu → `attente` (471), jamais perdu.
- Lectures paginées ; pas d'`expo start`.

### Task 1: Comptes + écritures BQ et OD (pur)
**Files:** Modify `lib/comptesSyscohada.js` ; Create `lib/journalTresorerie.js`, `lib/journalTresorerie.test.mjs`
**Produces:**
- `ecrituresTresorerie({ mouvements, comptes: Map<id, nom>, liens: { paiements: Map<mvtId, {categorie, categorie_direction, restaurant_id}>, partenaires: Map<mvtId, {partenaire, restaurant_id}>, direction: Map<mvtId, {categorie, restaurant_id}> }, restaurants: Map<id, {nom, court}> }) → Ligne[]`
- `assiettesCommissions({ points, shifts: Map, pubs, restaurants: Map }) → [{ restaurant, yangoTab, glovoTab, om, wave, djamo, pubGlovo }]`
- `ecrituresCommissions({ mois, assiettes }) → Ligne[]`
- [ ] Tests (chaque type/catégorie, attente, paire de virements, commissions, pub) → échec → implémentation → `fail 0` → commit.

### Task 2: Contrôle SQL d'octobre
- [ ] Mouvements d'octobre par contrepartie calculée en SQL (même règles) : aucun sans contrepartie ; montant en attente chiffré.

### Task 3: Export
**Files:** Modify `lib/exportJournalCaisse.js`, `app/cloture-mois.js`
- [ ] Charger mouvements du mois (+ comptes, paiements/dus, partenaires, direction liés, pubs du mois) ; filtre restaurant ; Journal = CA + BQ + OD ; Contrôle par journal ; bouton « Télécharger l'export comptable » ; nom de fichier `Export-comptable-…`.
- [ ] Tous les tests, lint, export web, commit, graphify, push.
