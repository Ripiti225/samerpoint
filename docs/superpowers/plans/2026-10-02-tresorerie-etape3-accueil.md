# Trésorerie étape 3 — Nouvel accueil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remplacer la vue d'ensemble par l'accueil validé (nette réelle, trésorerie, prévisions, dépenses du mois, dette récente, dette).

**Architecture:** deux fonctions pures dans `lib/tresorerie.js` (`syntheseTresorerie`, `depensesDuMois`) ; l'écran `app/tresorerie.js` les affiche et réutilise `FeuilleDetail` / `FeuillePaiement` de `components/tresorerie/du.js`.

**Global Constraints:** français courant, FCFA entiers ; pas de serveur local ; vérifier par tests, lint (0 erreur), `npx expo export -p web` ; pas de publication.

### Task 1: Logique (TDD)

- `syntheseTresorerie({ comptes, partenaires = 0, prevu = 0 }) → { banque, especes, partenaires, tresorerie, prevu, nette }` : `especes` = compte nommé « Espèces », `banque` = les autres ; `tresorerie = banque + especes + partenaires` ; `nette = banque + especes − prevu`.
- `depensesDuMois(dus, paiements, aujourdhui)` : séries seulement ; par (catégorie, restaurant), la ligne la plus ancienne (échéance) avec un reste et une date limite non passée ; triées par échéance.
- Retirer `calculerTresorerieNette` (et ses tests) : plus utilisée.

### Task 2: Écran

- `app/tresorerie.js` réécrit selon la spec (étape 3) ; feuilles détail / paiement ; sections dépliables.
- Commit `feat(tresorerie): nouvel accueil`.
