# Trésorerie étape 4 — Prévisions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** prévoir le paiement d'une ligne (date ou prochaine réception partenaire), la voir passer orange, la payer, garder l'historique ; nette réelle − prévisions.

**Architecture:** table `tresorerie_previsions` ; chaque paiement fait depuis une prévision porte `prevision_id` (RPC `tresorerie_payer` étendue). L'état d'une prévision (réalisé, reste, orange) se calcule en pur JS (`lib/previsions.js`).

**Global Constraints:** français courant, FCFA entiers ; pas de serveur local ; tests, lint 0 erreur, `npx expo export -p web` ; pas de publication.

### Task 1: Migration `supabase_tresorerie_previsions.sql`
Table, colonne `prevision_id`, `tresorerie_payer` qui la remplit depuis `p_parts[].prevision_id`.

### Task 2: `lib/previsions.js` (TDD)
- `etatPrevision(prevision, { du, paiementsDu, receptions, aujourdhui }) → { realise, reste, statut, message }` ; statut ∈ `realisee | a_payer | prevue`.
- `totalPrevu(previsions, dus, paiements, receptions, aujourdhui)` : par ligne, min(Σ restes des prévisions ouvertes, reste de la ligne).
- `trierPrevisions` : orange d'abord, puis par date.

### Task 3: Base (`lib/tresorerieDb.js`)
Chargement (prévisions, réceptions) tolérant ; `ajouterPrevision`, `supprimerPrevision` ; `payer` accepte `previsionId`.

### Task 4: Écrans
Fiche d'une ligne (prévisions + « Prévoir un paiement ») ; feuille de prévision ; paiement depuis une prévision ; bloc Prévisions de l'accueil (liste, + Prévoir, historique) ; nette réelle.
