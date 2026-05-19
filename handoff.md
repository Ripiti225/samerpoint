# Handoff — Samtrackly / SamerPoint

## État du projet au 2026-05-18

---

## Corrections récentes

### Inventaire (`app/inventaire.js`)

**Stocks initiaux**
- `chargerStockInitial` reécrit : cherche le dernier shift toutes dates confondues (plus de filtre `valide: true`, plus limité à aujourd'hui/hier)
- Fallback sur l'ancien format `inventaires` si aucun shift trouvé

**Darina (b7)**
- `noAlert: true` dans constants (était `auto: true`) — visible dans l'UI, pas bloquant à la validation
- Section dédiée dans l'onglet Boissons : Entrées (manuel) + Sorties (auto = Pot Fresco b6) + Stock réel
- Sauvegardé dans `inventaire_lignes.entrees`
- Restauré au rechargement via `chargerLignes`

**Modal entrées fournisseur**
- Fromage : Philadelphia (`f1`) retiré, "Total Fromage" (`f10`) réintégré
- Glaces : "Pot de glace" (`g3`) réintégré
- Frites : "Sachet de frites" (`fr3`) réintégré

---

### Déductions gérant (`app/deductions-gerant.js`)

- Détecte si une facture du même fournisseur a déjà été enregistrée aujourd'hui
- Affiche une dialog de confirmation : "Facture déjà enregistrée — Mettre à jour ?"
- Si confirmé : supprime l'ancienne entrée dans `historique_credit_fournisseurs` et insère la nouvelle
- Rafraîchit le crédit affiché après sauvegarde

---

### Vérification (`app/verification.js`)

- Dépenses gérant maintenant affichées en 3 lignes séparées dans le récapitulatif :
  - Gérant — Fournisseurs (depuis `draft_gerant.fournisseurs`)
  - Gérant — Marché / Dépenses (depuis `draft_gerant.depenses`)
  - Gérant — Paies (depuis `draft_gerant.paies`)
- Fallback vers l'ancienne ligne unique si `draft_gerant` absent

---

### Fournisseurs (`app/fournisseurs.js`)

- Supprime l'entrée existante dans `historique_credit_fournisseurs` avant d'insérer lors d'une re-validation
- Filtre : même fournisseur + même date (`.like('motif', 'Journée du DATE:%')`)
- Évite les doublons dans l'historique de crédit

---

## Build Android — GitHub Actions

**Fichier :** `.github/workflows/build-android.yml`

- Déclenché manuellement (workflow_dispatch)
- Ubuntu, Node 20, Java 17
- `expo prebuild --platform android --clean` puis `./gradlew assembleDebug`
- APK uploadé en artifact (7 jours de rétention)
- Durée : ~25 min

**Secrets GitHub à configurer :**
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

**`google-services.json`** : fichier placeholder à la racine (Firebase initialise sans crash, push notifications Android non fonctionnelles — acceptable pour les tests)

**Pour le Play Store :** passer à `assembleRelease` avec un vrai keystore signé + vrai `google-services.json` Firebase.

---

## Migrations SQL en attente

```sql
-- À exécuter sur Supabase si pas encore fait
ALTER TABLE transactions_fournisseurs ADD COLUMN IF NOT EXISTS caissier_nom TEXT;
```

---

## Points d'attention

- L'app est principalement utilisée comme PWA iOS Safari — le build Android est secondaire
- `localStorage` utilisé uniquement sur web (guards `Platform.OS !== 'web'` en place)
- `validerPoint` est online-only, jamais mis en queue offline
- `draft_gerant` est un JSON dans la table `points` — contient fournisseurs/depenses/paies du gérant
- IDs produits dans `CATEGORIES_INVENTAIRE` sont des clés DB — ne pas les modifier
