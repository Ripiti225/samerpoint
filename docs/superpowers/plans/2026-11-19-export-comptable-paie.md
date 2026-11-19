# Journal de Paie — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Journal PA à partir des états de salaire validés, sans double comptage avec les versements (CA, BQ).

Spec : `docs/superpowers/specs/2026-11-19-export-comptable-paie-design.md`

## Global Constraints
- Francs entiers ; chaque pièce équilibrée ; comptes via `COMPTES`.
- Sans état validé : comportement actuel conservé pour la caisse (661) ; salaires Trésorerie → 661.

### Task 1: Journal PA (pur)
**Files:** `lib/comptesSyscohada.js`, Create `lib/journalPaie.js`, `lib/journalPaie.test.mjs`
**Produces:** `clePaie(restaurantId, mois) → 'id|AAAA-MM'` ; `ecrituresPaie({ mois, restaurant: {nom, court}, lignes: [{ bulletin: { calcul } }] }) → Ligne[]`
- [ ] Tests (bulletin réel via `calculerBulletin`, équilibre, comptes, plusieurs salariés, avance, ligne sans calcul ignorée) → échec → code → vert → commit.

### Task 2: Règle 422 / 661 dans CA et BQ
**Files:** `lib/journalCaisse.js`, `lib/journalTresorerie.js` (+ tests)
- [ ] `ecrituresJournee({ …, paieAuDu })` : Paie et salaires déduits → `salairesDus` si vrai, sinon `personnel`.
- [ ] `journalDuMois(donnees)` : `donnees.paieValidee` (Set de clés) → `paieAuDu` par journée.
- [ ] `ecrituresTresorerie({ …, paieValidee })` : salaire → `salairesDus` si `clePaie(du.restaurant_id, du.mois)` validée, sinon `personnel`.
- [ ] Tests mis à jour + nouveaux → vert → commit.

### Task 3: Export
**Files:** `lib/exportJournalCaisse.js`
- [ ] Charger `etats_salaire` du mois `statut = 'valide'` (+ filtre restaurant), leurs `lignes_etat_salaire` (bulletin), `tresorerie_dus.mois`.
- [ ] Journal = CA + BQ + OD + PA ; Contrôle : « Paie du mois » ; tous les tests, lint, export web, commit, graphify, push.
