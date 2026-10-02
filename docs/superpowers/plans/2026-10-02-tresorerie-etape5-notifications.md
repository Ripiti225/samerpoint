# Trésorerie étape 5 — Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rappels 9 h / relance 14 h (dernier jour des charges, prévisions à payer, emprunts au coffre) et notification immédiate à la réception d'un partenaire attendu.

**Architecture:** logique pure `lib/rappelsTresorerie.js` (testée sous node), reprise telle quelle par l'Edge Function `supabase/functions/rappels-tresorerie` (fichiers `lib/` envoyés avec la fonction) ; pg_cron + pg_net appellent la fonction à 9 h et 14 h UTC. Envoi : Expo (Android), `send-web-push` (iPhone), table `notifications` (dans l'app).

**Global Constraints:** français courant, FCFA ; pas de serveur local ; tests, lint 0 erreur, export web ; déploiement de la fonction et migration avec l'accord de l'utilisateur ; pas de publication web/EAS.

### Task 1: `lib/rappelsTresorerie.js` (TDD)
`elementsDuJour`, `destinatairesRappels`, `messagePour`.

### Task 2: Edge Function `rappels-tresorerie`
Mode `essai` (calcule sans envoyer) ; anti-doublon ; Expo + web push + in-app.

### Task 3: Réception partenaire + correctif « actif »
`lib/notifications.js` : comptes actifs seulement ; `envoyerNotifReception` appelée après `recevoir()`.

### Task 4: Migration `supabase_tresorerie_rappels.sql`
pg_cron, pg_net, tâches `rappels-tresorerie-9h` et `-14h`.
