# Handoff — Samtrackly / SamerPoint

## État du projet au 2026-05-19

---

## Corrections récentes (code app)

### Inventaire (`app/inventaire.js`)

**Stocks initiaux**
- `chargerStockInitial` réécrit : cherche le dernier shift toutes dates confondues (plus de filtre `valide: true`, plus limité à aujourd'hui/hier)
- Fallback sur l'ancien format `inventaires` si aucun shift trouvé

**Darina (b7)**
- `noAlert: true` dans constants (était `auto: true`) — visible dans l'UI, pas bloquant à la validation
- Section dédiée dans l'onglet Boissons : Entrées (manuel) + Sorties (auto = Pot Fresco b6) + Stock réel
- Sauvegardé dans `inventaire_lignes.entrees` / restauré au rechargement via `chargerLignes`

**Modal entrées fournisseur**
- Fromage : Philadelphia (`f1`) retiré, "Total Fromage" (`f10`) réintégré
- Glaces : "Pot de glace" (`g3`) réintégré
- Frites : "Sachet de frites" (`fr3`) réintégré

---

### Déductions gérant (`app/deductions-gerant.js`)
- Détecte si une facture du même fournisseur a déjà été enregistrée aujourd'hui
- Dialog de confirmation avant écrasement
- Rafraîchit le crédit affiché après sauvegarde

---

### Vérification (`app/verification.js`)
- Dépenses gérant affichées en 3 lignes : Fournisseurs / Marché-Dépenses / Paies
- Fallback vers ligne unique si `draft_gerant` absent

---

### Fournisseurs (`app/fournisseurs.js`)
- Supprime l'entrée existante dans `historique_credit_fournisseurs` avant d'insérer lors d'une re-validation
- Évite les doublons dans l'historique de crédit

---

## Build Android — Configuration finale ✅

### Codemagic (`codemagic.yaml`)
- Workflow : `android-release`
- Node 20.18.0, Java 17
- `rm -rf node_modules && npm ci` + `rm -rf android && expo prebuild --clean`
- Patch `MainActivity.kt` via `scripts/patch-android.py` (fix NullPointerException onUserLeaveHint)
- Keystore généré à chaque build (samerapp / samerapp123)
- `assembleRelease` avec ProGuard désactivé
- Variables Supabase hardcodées dans le YAML

### Fichiers clés créés
- `codemagic.yaml` — workflow Codemagic
- `.github/workflows/build-android.yml` — workflow GitHub Actions (alternatif)
- `scripts/patch-android.py` — patch MainActivity post-prebuild
- `app.config.js` — embarque les credentials Supabase via `expo-constants`

### Supabase init (`lib/supabase.js`)
- Triple fallback : `Constants.expoConfig.extra` → `process.env` → valeur hardcodée
- Garantit que `supabaseUrl` n'est jamais vide sur Android natif

---

## Pour les prochains builds Android

```bash
# 1. Pusher le code
git add .
git commit -m "description"
git push

# 2. Lancer sur Codemagic
# Start new build → workflow android-release

# 3. Télécharger l'APK depuis le build le plus récent
# Désinstaller l'ancienne version avant d'installer la nouvelle
```

**Note keystore :** le keystore est regénéré à chaque build → signatures différentes à chaque fois → toujours désinstaller avant de réinstaller. Pour le Play Store, il faudra un keystore fixe stocké comme secret Codemagic.

---

## Migrations SQL en attente

```sql
-- 1. Colonne caissier_nom dans transactions_fournisseurs (ancienne migration)
ALTER TABLE transactions_fournisseurs ADD COLUMN IF NOT EXISTS caissier_nom TEXT;

-- 2. Nouveaux champs dans historique_credit_fournisseurs (OBLIGATOIRE pour l'historique complet)
ALTER TABLE historique_credit_fournisseurs
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manuel',
  ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES points(id),
  ADD COLUMN IF NOT EXISTS facture NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paye NUMERIC DEFAULT 0;
```

---

## Points d'attention

- L'app est principalement utilisée comme PWA iOS Safari — le build Android est secondaire
- `localStorage` utilisé uniquement sur web (guards `Platform.OS !== 'web'` en place)
- `validerPoint` est online-only, jamais mis en queue offline
- `draft_gerant` est un JSON dans la table `points` — contient fournisseurs/depenses/paies du gérant
- IDs produits dans `CATEGORIES_INVENTAIRE` sont des clés DB — ne pas les modifier
- `expo-notifications` plugin retiré de `app.json` (push notifications Android non fonctionnelles)
- Push notifications iOS via Safari PWA non affectées
