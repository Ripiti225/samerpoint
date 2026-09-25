# Handoff — Samtrackly / SamerPoint

> Fichier vivant, réactualisé à chaque compactage de contexte.

---

## Session 2026-09-25 — Point caissier, suppression de compte, contacts RH

**Déployé en production** (commit `95e0292`, web Vercel + OTA EAS `production`).

- **Nouvel écran `/point-caissier`** (tuile gérant + admin) : les clôtures POS validées
  des trois derniers jours (aujourd'hui + 2 jours calendaires, journées vides comprises),
  une carte par shift avec l'écart et l'explication, puis le détail complet en lecture seule.
- **« Espace Caissier » retiré du menu** du gérant. L'écran `/gerant-caissier` reste dans
  le code, réactivable depuis Paramètres. Migration `supabase_point_caissier.sql`
  **passée en production le 2026-09-25** (les menus vivent dans `roles_acces`, pas dans le code).
- **L'écart affiché est `ecart_pos`, pas `ecart_reconciliation`.** Vérifié sur les 42 shifts
  des trois derniers jours : `ecart_reconciliation` est NULL partout, le pont POS ne le
  remplit pas. L'explication du caissier porte de toute façon sur `ecart_pos` (cf. le
  commentaire de la colonne). L'écart du rapport Z ne s'affiche que s'il existe, jamais
  à la place de l'autre — le contrat de `lib/cloturesCaisse.js` tient toujours.
- **Détail de shift mutualisé** : sorti de `app/point-shift.js` vers `lib/detailShift.js`
  (chargement) et `components/DetailShiftCaissier.js` (rendu). Les explications d'écart
  d'inventaire y sont désormais affichées ligne par ligne.
- **Paramètres — suppression de compte** : `supprimer()` jetait l'erreur Supabase, donc
  un refus de la base ressemblait à un bouton mort. 34 des 40 comptes ont de l'historique
  (`points_shifts`, `presences`, `inventaires_shifts` … tous en FK sans cascade) et ne
  peuvent pas être supprimés. L'écran explique maintenant pourquoi et propose la
  désactivation (`lib/suppressionCompte.js`, testé).
- **RH** : onglet « Fournisseurs » ouvert dans Contacts.

**Pièges rencontrés, à ne pas réapprendre :**
- `git` et `python3` du système échouent (licence Xcode non acceptée).
  Utiliser `/Library/Developer/CommandLineTools/usr/bin/git`, ou
  `DEVELOPER_DIR=/Library/Developer/CommandLineTools` — **indispensable pour `eas update`**,
  qui refuse de publier sans git fonctionnel.
- `vercel deploy --prod --yes` renvoie « Not authorized » sans `--scope ripiti225s-projects`.
- Un `git push` ne crée qu'un déploiement **Preview** : la production passe par le CLI.

Spec : `docs/superpowers/specs/2026-09-25-point-caissier-design.md` ·
Plan : `docs/superpowers/plans/2026-09-25-point-caissier.md`

---

## Session 2026-08-28 — Écarts POS : Ventes, Recap, Litiges

### Ce qui est fait et poussé sur GitHub

Trois commits sur `main`, poussés (`26f9f7d`) :

| commit | contenu |
|---|---|
| `ec7410d` | fix(ventes,recap) : plus de photo ni d'explication d'écart sur les sites POS |
| `81b4735` | feat(litiges) : la responsabilité d'un écart vient des shifts POS |
| `26f9f7d` | chore(graphify) : graphe à jour |

**Problème traité.** Sur Angré 7E (seul site avec `restaurants.source_point = 'POS'`),
la vente machine arrive bien du POS, mais la validation du point réclamait encore
(a) la photo de la vente machine et (b) une explication + des responsables pour un
écart que la caisse avait déjà mesuré, caissière par caissière.

**Corrections.**
1. `lib/sourcePoint.js` → `venteMachineVientDuPOS(shifts)` : un shift qui porte
   `vente_systeme_pos` prouve que le trigger a écrit `points.vente_machine`.
   Preuve par la donnée, pas seulement par le drapeau `source_point`.
2. `app/recap-point.js` : la photo n'est plus exigée quand le POS a écrit le montant.
   C'était le blocage dur — l'écran Ventes n'affiche déjà plus ce bloc sur un site POS,
   donc le gérant était renvoyé vers un champ inexistant.
3. `app/ventes.js` : `venteMachineDuSysteme` coupe photo + explication + responsables
   sur les sites POS. Le secours manuel les réactive (rien ne vient plus du système).
4. `lib/ecartPOS.js` → `responsablesEcartPOS()` dérive les responsables depuis
   `points_shifts.ecart_pos` (**négatif = manquant**), et `fusionnerResponsablesEcart()`
   garantit qu'une journée déjà imputée à la main n'est jamais comptée deux fois
   (**la main du gérant gagne**). Rien n'est écrit en base : tout est recalculé à la lecture.
5. `app/litiges.js` : dérivation branchée sur les 3 vues (détail d'une journée, onglet
   « Responsables des écarts », mode global + PDF), badge « Mesuré au POS ». Le détail
   s'ouvre aussi quand l'écart du jour vaut 0 (deux caissières qui se compensent
   cachaient un manquant réel). Lecture des shifts **paginée** (troncature silencieuse
   Supabase au-delà de 1000 lignes) + repli si `supabase_pos_bascule.sql` non passée.

**Périmètre respecté** : un site sans POS n'a jamais de shift avec `vente_systeme_pos`,
donc rien ne change pour lui. Vérifié sur données réelles du 20 au 28/08 :
Angré 7E n'ajoute que les 2 journées jamais imputées (+1 001 FCFA) ; Palmeraie
(sans POS) ressort à la ligne près comme avant.

**Aucune migration SQL nécessaire** — tout existe déjà (`supabase_pos_bascule.sql`,
`supabase_pos_explication_ecart.sql`, `supabase_pos_vente_systeme.sql`).

**Vérifications** : `npm run lint` 0 erreur (71 warnings préexistants) ;
`for f in lib/*.test.mjs; do node "$f"; done` tout vert, dont 23 tests sur `ecartPOS`
et 30 sur `sourcePoint`.

### ⚠️ CE QUI RESTE À FAIRE — le déploiement a échoué

**Rien n'est en production.** Les commits sont sur GitHub, mais :

1. **Web (Vercel)** — un déploiement est bien `Ready` et aliasé sur
   `samtrackly.vercel.app`, **mais il sert l'ancien code**. Vérifié en téléchargeant
   le bundle servi : les marqueurs `Mesuré au POS` / `Un shift = une caissière` en sont
   absents, et l'ancien texte `La photo de la vente machine est obligatoire` y est encore.
   Un `npx vercel deploy --prod --yes --force` a été lancé en fin de session et n'avait
   pas rendu la main — **vérifier son résultat avant d'en relancer un**.

2. **OTA (EAS)** — **échec** : `Failed to upload — Asset processing timed out` sur les
   deux bundles `.hbc`. L'app installée n'a rien reçu. À relancer.

**Cause du raté, à ne pas reproduire : `expo export -p web` et `eas update` écrivent
tous les deux dans `dist/`.** Ils ont été lancés en parallèle, `eas update` a écrasé
l'export web en cours de déploiement. **Les enchaîner en séquence, jamais en parallèle.**

Procédure de reprise (dans cet ordre, une commande à la fois) :

```bash
# 1. Web
npx expo export -p web
npx vercel deploy --prod --yes --force

# 2. Contrôle décisif : le nouveau code est-il vraiment servi ?
B=$(curl -s https://samtrackly.vercel.app/ | grep -oE '_expo/static/js/web/[A-Za-z0-9._-]+\.js' | head -1)
curl -s "https://samtrackly.vercel.app/$B" | grep -c "Mesuré au POS"   # doit être > 0

# 3. OTA seulement une fois le web confirmé
npx eas-cli update --branch production --message "Litiges : responsable d'un ecart lu depuis le POS"
```

Note : `vercel.json` a `buildCommand: npx expo export -p web`, donc Vercel reconstruit
côté cloud ; `--force` évite qu'il réutilise un build en cache.

### Point ouvert (pas un bug, une décision produit)

Sur les sites POS, `litiges_responsables` et `points.ecart_responsables` ne sont plus
alimentées par le gérant. Litiges affiche désormais la mesure du POS à la place, donc
rien n'est perdu à l'écran. Mais si un jour on veut **facturer** ces montants (retenues
sur paie, régularisation de fond), il faudra décider si l'on matérialise ces lignes
dérivées en base ou si l'on branche la facturation directement sur `ecart_pos`.

---

## État du projet au 2026-07-10

### Session courante (2026-07-10)

**1. Déploiement Vercel — RÉUSSI ✅**
- Prod en ligne : **https://samtrackly.vercel.app** (HTTP 200).
- Commande qui a marché depuis le Mac : `npx expo export -p web` puis `npx vercel deploy --prod --yes` (build cloud ~2 min, alias auto sur le domaine prod). Contrairement aux sessions passées, l'upload CLI **n'a pas timeout** cette fois — c'est intermittent, donc toujours essayer le CLI d'abord.
- Feature déployée : « explication écart vente machine » (statut décision manager).

**2. Git — À JOUR ✅**
- `feature/pos-system` commité + poussé.
- Merge `feature/pos-system → main` poussé sur GitHub (`d8069dd`), sans conflit.
- ⚠️ L'agent shell **ne peut pas push** → commandes git à lancer par l'utilisateur dans son Terminal.

**3. Migration SQL consolidée — FAITE ✅**
- `supabase_migrations_all.sql` exécuté par l'utilisateur (idempotent, rejouable).

**4. Annulation déduction inventaire (par produit) — CODE PRÊT, déploiement en attente**
- Ajout section 9 dans `supabase_migrations_all.sql` : colonnes `deduction_annulee`, `deduction_annulee_par`, `deduction_annulee_at`, `montant_deduit_annule` sur `inventaire_lignes` (+ fichier `supabase_annuler_deduction_inventaire.sql`).
- ⚠️ **Vérifier que ces colonnes sont bien en base avant de déployer** — sinon l'onglet inventaire de `verification.js` casse (select sur colonnes inexistantes).

**5. Vue Litiges « tous les restaurants » — CORRIGÉ ✅ (non commité, non déployé)**
- Bug : la vue globale multi-restaurants n'affichait pas les contacts, ni l'explication des manquants d'inventaire, ni le point-pas-fait.
- Fix dans `app/litiges.js` : `chargerTousRestaurants` calcule désormais contacts (litige si taux > 20 %), point-pas-fait, et récupère `explication` sur les lignes d'inventaire ; `renderModeGlobal` + le PDF affichent les 3 nouveaux volets ; le total par resto inclut contacts + point-pas-fait (colle enfin au total mono-resto).
- **Aucune migration nécessaire** (lit `commandes`, `points`, `litiges_point_pas_fait`). Build + lint OK.

**Prochaines actions**
1. Confirmer/exécuter les colonnes `deduction_annulee*` (via `supabase_migrations_all.sql` rejoué).
2. Commiter les changements en cours (litiges + inventaire-annulation), push (par l'utilisateur).
3. Redéployer sur Vercel (`npx expo export -p web` → `npx vercel deploy --prod --yes`).

---

## Backlog — features à venir (demandées le 2026-07-10)

> Nouvelles demandes fonctionnelles.

### ✅ 2. Demandes d'explication — workflow avec suivi — CODE FAIT (non déployé)
Module complet livré (rappel push J+3 retenu). **Reste : SQL + déploiement.**

**Fichiers créés/modifiés :**
- `supabase_demandes_explication.sql` (standalone) **+ section 10** dans `supabase_migrations_all.sql` : table `demandes_explication`.
- `supabase/functions/rappel-explications/index.ts` — Edge Function rappel J+3 (à déployer + planifier via pg_cron, bloc SQL commenté dans `supabase_demandes_explication.sql`, remplacer `<PROJECT_REF>` / `<SERVICE_ROLE_KEY>`).
- `lib/notifications.js` — `envoyerNotifExplicationNouvelle`, `envoyerNotifExplicationStatut`.
- `lib/pdfDocuments.js` — `genererPdfExplication` + `genererPdfPermission` (**feature 4 faite ici aussi**).
- `app/demandes-explication.js` — écran **gérant** (crée pour son resto uniquement, voit ses demandes, PDF).
- `app/demandes-explication-admin.js` — écran **manager/RH/directeur**, **2 onglets** (📥 Reçues / 📨 Mes demandes), tout le cycle de vie.
- `app/accueil.js` — entrées menu ajoutées (gérant → `/demandes-explication` ; manager+RH → `/demandes-explication-admin`).

**Cycle implémenté :** gérant crée → `en_attente_acceptation` → admin **Accepter**/**Refuser** → `acceptee` → **Marquer envoyée** → `envoyee` → (J+3 : badge « en retard » + push via Edge Function) → **Réponse récupérée** (`reponse_recuperee`) ou **Relancer** (originale → `relancee`, 2ᵉ demande auto `numero=2` en `envoyee`). Demandes créées par admin = auto-acceptées (`acceptee` direct, saute l'acceptation).

**⚠️ À faire avant de déployer :**
1. Exécuter le SQL (`supabase_migrations_all.sql` rejoué, ou `supabase_demandes_explication.sql`) — **sinon les écrans plantent** (table absente).
2. (Optionnel mais demandé) Déployer l'Edge Function `rappel-explications` + activer pg_cron/pg_net + planifier (voir bloc commenté). Sans ça : le badge « en retard » client-side fonctionne, mais pas le push auto.
3. Lint OK (0 erreur sur les nouveaux fichiers). Build à vérifier.

### 4. Textes PDF prédéfinis — ✅ FAIT (dans `lib/pdfDocuments.js`)
`genererPdfExplication` (branché) + `genererPdfPermission` (dispo, à brancher sur l'écran demandes/permissions si souhaité).

#### 4bis. PDF explication conforme au modèle juridique + logos + upload réponse — ✅ FAIT (non déployé)
- **Modèle** : `genererPdfExplication` réécrit pour reproduire `doc/Modele_Demande_Explication.docx` (lettre légale Code du Travail ivoirien art. 17.5, délai 72h, destinataire, faits reprochés, mentions légales, signature employeur, **accusé de réception salarié**). Pré-remplit resto/travailleur/motif/date ; pointillés pour le reste (poste, matricule, heure, réf).
- **Logos** : `lib/logos.js` embarque les 2 logos en base64 (source `doc/Logo CHEZ SAMER.png` + `doc/LOGO AL KAYAN..png`, optimisés via sips). `marquePourResto(nom)` déduit la marque : nom contenant « kayan » → Al Kayan, sinon Chez Samer. ⚠️ Coordonnées Al Kayan (adresse/contact) **laissées en pointillés** — à compléter dans `MARQUES.alkayan` si besoin (Chez Samer connu depuis le letterhead).
- **Upload réponse** : `lib/api.js` → nouvelle fn `uploadFichier` (image **et** PDF, content-type correct, bucket `photos`). Écran gérant `demandes-explication.js` : boutons « 🖼️ Photo / 📄 PDF » sur les demandes `envoyee`/`relancee` → upload → notif admin. Écran admin : bouton « Réponse déposée — voir ». 3 colonnes ajoutées : `reponse_fichier_url`, `reponse_fichier_type`, `reponse_uploadee_at` (dans `supabase_demandes_explication.sql` + section 10 du migrations_all).
- « Automatique à l'acceptation » = dès `acceptee`/`envoyee`, le gérant a le bouton « 📄 Télécharger la demande d'explication » pré-rempli (un PDF ne peut pas être généré côté serveur ; c'est un téléchargement 1 clic).

### ✅ 1. Congés futurs saisis par le RH — CODE FAIT (non déployé)
- `app/demandes-admin.js` : bouton **« + Nouvelle demande »** (visible RH / manager / directeur) → modal de création (type, restaurant, travailleur, dates **futures autorisées**, montant, description). Insérée directement en statut **`validee`** (l'admin est l'autorité) → idéal pour planifier un congé futur / année prochaine.
- Au passage : **bug latent corrigé** — `Alert` était utilisé mais pas importé dans ce fichier.
- **Aucune migration** (réutilise la table `demandes` existante). Lint OK.

### ✅ 3. Gestion de stock (menu Manager & Admin) — CODE FAIT (non déployé)
- `app/gestion-stock.js` : sorties + entrées **agrégées par produit**, filtres **restaurant** + **période** (Aujourd'hui / 7j / 30j / Ce mois / Personnalisé via calendrier), totaux en tête.
- Lit `inventaire_lignes` joint à `inventaires_shifts` (`!inner` sur date + restaurant_id). **Aucune migration.**
- Menu : entrée « 📉 Gestion de stock » ajoutée dans `menuManager` (couvre manager + directeur).

### ~~1. Congés futurs saisis par le RH~~ (spec d'origine)
- Le RH doit pouvoir, depuis son compte, **planifier un congé à une date ultérieure** (y compris l'année prochaine).
- La saisie doit accepter n'importe quelle date future, pas seulement la période courante.

### 2. Demandes d'explication — workflow avec suivi
Système de demandes d'explication adressées aux travailleurs, avec cycle de vie et rappels.

**Émetteurs et périmètre :**
- **Gérant** : voit **uniquement les travailleurs de son restaurant** ; ne peut demander des explications qu'à ceux-là. Une seule vue « Demandes » (émission).
- **Manager / Admin / RH** : peuvent demander à **tous les travailleurs, tous restaurants confondus**. Leur écran « Demandes » a **2 onglets** :
  - Onglet A : voir les demandes envoyées (par les gérants notamment, à accepter).
  - Onglet B : émettre eux-mêmes des demandes d'explication.

**Cycle de vie d'une demande :**
1. **Demande gérant** → doit être **acceptée** par (Admin / Manager / RH).
2. Celui qui accepte **envoie la demande** au concerné et marque **« demande envoyée »**.
3. **Après 3 jours** → **rappel** pour la réponse :
   - Si réponse reçue → marquer **« réponses récupérées »** (fin).
   - Si pas de réponse → **renvoi automatique d'une 2ᵉ demande** d'explication au concerné.
4. **Demandes émises par Admin / Manager / RH** : **pas d'étape « accepté »** (acceptation automatique) ; elles suivent **le même processus** ensuite (envoi → rappel 3 j → récupérée / relance).

*→ Prévoir table(s) `demandes_explication` (statut, émetteur, travailleur, restaurant, dates, relance) + migration. Statuts pressentis : `en_attente_acceptation`, `envoyee`, `reponse_recuperee`, `relancee`.*

### 3. Gestion de stock (menu Manager & Admin)
- Nouvelle entrée menu **Manager + Admin** : « Gestion de stock ».
- Affiche **la sortie de chaque produit présent dans l'inventaire**.
- **Filtres** : par **restaurant** et par **période**.

### 4. Textes PDF prédéfinis
- Modèles PDF prédéfinis dans l'app pour :
  - **Demande d'explication**
  - **Permission**

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

## Migrations SQL — historique (mai 2026, probablement déjà appliquées)

> Ces migrations datent de mai. Le script consolidé à jour est **`supabase_migrations_all.sql`** (voir « Session courante » en tête).

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
