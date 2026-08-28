# Graph Report - samtrackly  (2026-08-27)

## Corpus Check
- 184 files · ~316,246 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1975 nodes · 4174 edges · 181 communities (115 shown, 66 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 43 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b64b9197`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- LitigesScreen
- exportRapportMensuel.js
- InventaireScreen
- app/contrats.js
- BrouillonsFournisseursScreen
- FournisseursScreen
- rapportMensuel.js
- expo
- ModifierPointScreen
- VerificationScreen
- explore.tsx
- useApp
- RHScreen
- AccueilScreen
- verification.js
- api.js
- Backlog — features à venir (demandées le 2026-07-10)
- DemandesExplicationAdminScreen
- RecapPointScreen
- Travailleurs & Utilisateurs par restaurant
- dashboard.js
- CreditsFournisseursScreen
- AppProvider
- DashboardGlobalScreen
- PointShiftScreen
- DashboardScreen
- app/journal.js
- ParametresScreen
- useTheme
- VentesScreen
- verificateur.js
- dependencies
- Gestion des contrats de travail (RH)
- LoginScreen
- Écran Contrats autonome — design
- sauvegarderShift
- app/corbeille.js
- menus.js
- Le POS Samer alimente Samtrackly — bascule des caissiers, site par site
- Architecture
- photoQueue.js
- Architecture
- ChargesScreen
- creerNotification
- journaliser
- RestaurantsScreen
- ecartsParCaissier
- exceljs
- points_shifts
- accueil.js
- Web Push (PWA) — mise en route
- supabase_migrations_all.sql
- CorrectionPointScreen
- DocumentsScreen
- Structure des fichiers
- Périmètre
- Le pont pousse aussi l'inventaire — POS Samer → Samtrackly
- notifications.js
- scripts
- Plan de durcissement sécurité — Edge Functions (option 1)
- NotificationsContext.js
- Structure des fichiers
- rappel-contrats/index.ts
- ContactsScreen
- dashboard-global.js
- public.points_shifts
- Pont inventaire POS → Samtrackly — Implementation Plan
- EquipeScreen
- ModifierInventaireScreen
- devDependencies
- tsconfig.json
- reset-project.js
- demandes.js
- inventaires_shifts
- send-web-push/index.ts
- parametres.js
- Welcome to your Expo app 👋
- supabase_date_point_transactions.sql
- transactions-fournisseurs-date.js
- suppressions_archive
- demandes_explication
- litiges_responsables
- contrats_travailleurs
- public.deductions_verification
- inventaires_shifts_restaurant_depuis_point
- verifications_stock
- vercel.json
- eslint.config.js
- rappel-explications/index.ts
- expo
- expo-constants
- expo-device
- expo-document-picker
- expo-file-system
- expo-font
- expo-haptics
- expo-image-picker
- expo-notifications
- expo-print
- expo-router
- expo-splash-screen
- expo-status-bar
- expo-system-ui
- expo-updates
- @expo/vector-icons
- jspdf
- pptxgenjs
- react
- react-dom
- react-native
- react-native-calendars
- @react-native-community/netinfo
- react-native-gesture-handler
- react-native-reanimated
- react-native-safe-area-context
- react-native-screens
- react-native-url-polyfill
- react-native-web
- react-native-worklets
- @react-navigation/bottom-tabs
- @react-navigation/elements
- @react-navigation/native
- @shopify/react-native-skia
- @supabase/supabase-js
- victory-native
- xlsx
- supabase_erreurs_client.sql
- supabase_roles_acces.sql
- supabase_web_push.sql
- litiges_avis_clients
- public.inventaires_shifts
- public.utilisateurs
- inventaire_lignes
- demandes
- demandes
- points
- points
- inventaire_lignes
- points
- demandes
- public.points_shifts
- public.restaurants
- public.points_shifts
- restaurants
- inventaires_shifts
- inventaires_shifts
- transactions_fournisseurs
- verifications_stock

## God Nodes (most connected - your core abstractions)
1. `useTheme()` - 96 edges
2. `useApp()` - 80 edges
3. `InventaireScreen()` - 72 edges
4. `journaliser()` - 60 edges
5. `LitigesScreen()` - 57 edges
6. `supabase` - 56 edges
7. `expo-router` - 49 edges
8. `VerificationScreen()` - 44 edges
9. `creerNotification()` - 43 edges
10. `ModifierPointScreen()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `SessionGuard()` --calls--> `useApp()`  [EXTRACTED]
  app/_layout.tsx → context/AppContext.js
- `ventesToday()` --calls--> `totalVentes()`  [EXTRACTED]
  app/dashboard.js → context/AppContext.js
- `imprimerPdf()` --calls--> `genererPdfExplication()`  [EXTRACTED]
  app/demandes-explication.js → lib/pdfDocuments.js
- `ParametresScreen()` --calls--> `setThemeMode()`  [EXTRACTED]
  app/parametres.js → context/ThemeContext.js
- `sauvegarderCorrectionCommandes()` --calls--> `corrigerNbCommandes()`  [EXTRACTED]
  app/verification.js → lib/litigeContacts.js

## Import Cycles
- None detected.

## Communities (181 total, 66 thin omitted)

### Community 0 - "LitigesScreen"
Cohesion: 0.08
Nodes (56): canalAvis(), couleurMontant(), fmt(), fmtShort(), formDateDefaut(), getPlage(), LitigesScreen(), chargerAvis() (+48 more)

### Community 1 - "exportRapportMensuel.js"
Cohesion: 0.08
Nodes (65): calcPreset(), CAT_ORDER, DetailProduit(), fmtDateCourt(), GestionStockScreen(), choisirPreset(), exporter(), isoJour() (+57 more)

### Community 2 - "InventaireScreen"
Cohesion: 0.11
Nodes (70): InventaireScreen(), aExplicationKey(), analyserSourceStock(), appliquerOverrideVerif(), chargerLignes(), chargerOuCreer(), chargerStockInitial(), darinaEnt() (+62 more)

### Community 3 - "app/contrats.js"
Cohesion: 0.08
Nodes (56): ContratsScreen(), badge(), charger(), contratsDe(), enregistrerContrat(), messageErreur(), ouvrirFiche(), pied() (+48 more)

### Community 4 - "BrouillonsFournisseursScreen"
Cohesion: 0.23
Nodes (12): BrouillonsFournisseursScreen(), confirmerIgnorer(), confirmerIgnorerLot(), grouperParPoint(), quitterSelection(), reinjecter(), retirerDuBrouillon(), derniersMois() (+4 more)

### Community 5 - "FournisseursScreen"
Cohesion: 0.07
Nodes (34): DepensesScreen(), ajouterLigne(), enregistrer(), saveDepensesGerant(), setLibelle(), setMontant(), supprimerLigne(), totalCategorie() (+26 more)

### Community 6 - "rapportMensuel.js"
Cohesion: 0.12
Nodes (43): buildRapport(), fmt(), formatDateFr(), FORMATS, getDimanche(), getLundi(), makeStyles(), MoisCard() (+35 more)

### Community 7 - "expo"
Cohesion: 0.05
Nodes (41): backgroundColor, foregroundImage, adaptiveIcon, googleServicesFile, package, permissions, versionCode, projectId (+33 more)

### Community 8 - "ModifierPointScreen"
Cohesion: 0.12
Nodes (36): makeStyles(), ModifierPointScreen(), afficherToast(), beneficeSC(), calculerVenteShift(), chargerDepGerant(), chargerDetailShift(), chargerPoint() (+28 more)

### Community 9 - "VerificationScreen"
Cohesion: 0.08
Nodes (24): makeStyles(), VerificationScreen(), changerResto(), chargerPointsResto(), chargerRestaurants(), confirmerStatutMachine(), demanderCorrection(), fermerCorrectionFacture() (+16 more)

### Community 10 - "explore.tsx"
Cohesion: 0.11
Nodes (23): styles, styles, TabLayout(), ExternalLink(), Props, HapticTab(), ParallaxScrollView(), Props (+15 more)

### Community 11 - "useApp"
Cohesion: 0.11
Nodes (26): ONGLETS, SECTION_CONFIG, CATEGORIES, STATUT_COLORS, TYPE_DOC_ICONS, CATS_ENTREE, EXCLUS, PRODUITS_ENTREE (+18 more)

### Community 12 - "RHScreen"
Cohesion: 0.13
Nodes (31): makeStyles(), RHScreen(), archiverTravailleur(), chargerArchives(), chargerDonnees(), chargerHistoriqueTravailleur(), choisirPDFPapier(), choisirPhotoPapier() (+23 more)

### Community 13 - "AccueilScreen"
Cohesion: 0.18
Nodes (12): AccueilScreen(), activerPush(), activerNotificationsPush(), desactiverNotificationsPush(), enregistrerServiceWorker(), estStandalonePWA(), estWeb(), etatPermissionPush() (+4 more)

### Community 14 - "verification.js"
Cohesion: 0.10
Nodes (30): STATUT_MACHINE, confirmerAnnulationDeduction(), confirmerAnnulationMachine(), enregistrerDecisionInv(), enregistrerRepartition(), fmt(), ouvrirInventaire(), PhotoVignette() (+22 more)

### Community 15 - "api.js"
Cohesion: 0.06
Nodes (56): ChoixDateScreen(), chargerDonneesPoint(), confirmer(), makeStyles(), LivraisonsScreen(), ajouterCommande(), sauvegarder(), sauvegarderEtQuitter() (+48 more)

### Community 16 - "Backlog — features à venir (demandées le 2026-07-10)"
Cohesion: 0.08
Nodes (25): ✅ 1. Congés futurs saisis par le RH — CODE FAIT (non déployé), ~~1. Congés futurs saisis par le RH~~ (spec d'origine), 2. Demandes d'explication — workflow avec suivi, ✅ 2. Demandes d'explication — workflow avec suivi — CODE FAIT (non déployé), 3. Gestion de stock (menu Manager & Admin), ✅ 3. Gestion de stock (menu Manager & Admin) — CODE FAIT (non déployé), 4. Textes PDF prédéfinis, 4. Textes PDF prédéfinis — ✅ FAIT (dans `lib/pdfDocuments.js`) (+17 more)

### Community 17 - "DemandesExplicationAdminScreen"
Cohesion: 0.11
Nodes (29): DemandesExplicationAdminScreen(), accepter(), charger(), confirmerRefus(), confirmerRelance(), confirmerReponse(), imprimerPdf(), marquerEnvoyee() (+21 more)

### Community 18 - "RecapPointScreen"
Cohesion: 0.05
Nodes (42): DeductionsGerantScreen(), chargerDonnees(), fmt(), gererPhoto(), sauvegarder(), makeStyles(), gererConnexionOneDrive(), calcVariation() (+34 more)

### Community 19 - "Travailleurs & Utilisateurs par restaurant"
Cohesion: 0.08
Nodes (23): 🏪 Al Kayan KMS, 🏪 Al Kayan Yop, 🌍 Comptes globaux (manager / RH / directeur — sans restaurant), 🏪 Samer Angré 7E, 🏪 Samer Lavage, 🏪 Samer Maroc, 🏪 Samer Oasis, 🏪 Samer Palmeraie (+15 more)

### Community 20 - "dashboard.js"
Cohesion: 0.19
Nodes (14): CATEGORIES_FOOD, chargerCouts(), chargerCoutsGlobal(), jaugeStyles, makeStyles(), PERIODES, PILIERS, { width } (+6 more)

### Community 21 - "CreditsFournisseursScreen"
Cohesion: 0.15
Nodes (21): CreditsFournisseursScreen(), charger(), chargerHistorique(), confirmerArchivage(), confirmerFixTous(), confirmerRemiseAZero(), exporterExcel(), exporterPdf() (+13 more)

### Community 22 - "AppProvider"
Cohesion: 0.16
Nodes (18): valider(), seDeconnecter(), AppProvider(), aDonneesSaisies(), beneficeSC(), deconnecter(), _execResetJour(), fc() (+10 more)

### Community 23 - "DashboardGlobalScreen"
Cohesion: 0.11
Nodes (10): DashboardGlobalScreen(), calculerAlertesGlobal(), chargerPoints(), fmt(), formatDate(), getDateRange(), titrePeriode(), totalGlobal() (+2 more)

### Community 24 - "PointShiftScreen"
Cohesion: 0.12
Nodes (11): lireDraft(), PointShiftScreen(), chargerShiftsGerant(), chargerStatutInventaire(), gererPhoto(), selectionnerPhoto(), supprimerShift(), supprimerShiftsMultiples() (+3 more)

### Community 25 - "DashboardScreen"
Cohesion: 0.11
Nodes (14): DashboardScreen(), beneficeToday(), calculerAlertes(), chargerPoints(), confirmerPeriode(), fmt(), fmtFull(), formatDate() (+6 more)

### Community 26 - "app/journal.js"
Cohesion: 0.14
Nodes (20): CLES_MONTANT, EntryRow(), ErreurRow(), FILTRES, formatHeure(), formatRelative(), formatValeur(), JournalScreen() (+12 more)

### Community 27 - "ParametresScreen"
Cohesion: 0.07
Nodes (49): executer(), gererPhotoRegul(), executer(), makeStyles(), ParametresScreen(), ajouterDocument(), basculerRestaurant(), CarteBascule() (+41 more)

### Community 28 - "useTheme"
Cohesion: 0.15
Nodes (20): GerantCaissierScreen(), makeStyles(), MENU, HEURES, LigneSaisie(), LigneSaisieSimple(), makeStyles(), MINUTES (+12 more)

### Community 29 - "VentesScreen"
Cohesion: 0.17
Nodes (10): makeStyles(), VentesScreen(), allerAuRecap(), fmt(), gererPhoto(), PhotoBlock(), sauvegarderEtContinuer(), sauvegarderPhotosPoints() (+2 more)

### Community 30 - "verificateur.js"
Cohesion: 0.10
Nodes (26): makeStyles(), RecapVerificationsScreen(), aujourdhui(), makeStyles(), ORDRE_PRODUIT, VerificateurScreen(), changerResto(), chargerRestaurants() (+18 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): expo-dev-client, expo-image, expo-linking, expo-sharing, expo-symbols, expo-web-browser, dependencies, expo-dev-client (+13 more)

### Community 32 - "Gestion des contrats de travail (RH)"
Cohesion: 0.10
Nodes (19): Automatisation, Bloc « Contrat » dans la fiche travailleur, Formulaire de contrat (modal), Gestion des contrats de travail (RH), Hors périmètre, Le fichier du contrat, Le statut n'est pas stocké, Limite connue : le PIN survit à la désactivation (+11 more)

### Community 33 - "LoginScreen"
Cohesion: 0.21
Nodes (17): LoginScreen(), appuyerChiffre(), chargerUtilisateurs(), chargerUtilisateursGlobaux(), choisirRestaurant(), choisirUtilisateur(), fetchRestaurants(), getRoleBg() (+9 more)

### Community 34 - "Écran Contrats autonome — design"
Cohesion: 0.11
Nodes (18): Ajouter un contrat, Changements ailleurs, Durées de contrat, Décisions, Découpage des fichiers, Fiche d'un travailleur et actions, Hors périmètre, Interfaces (+10 more)

### Community 35 - "sauvegarderShift"
Cohesion: 0.28
Nodes (9): depensesToday(), laborCostMontant(), effacerDraft(), sauvegarderShift(), venteShift(), totalDepenses(), totalDepensesCat(), totalFournisseurs() (+1 more)

### Community 36 - "app/corbeille.js"
Cohesion: 0.24
Nodes (15): CorbeilleScreen(), charger(), restaurer(), decrireContenu(), formatDatePoint(), formatHeure(), makeStyles(), archiverSuppressionShift() (+7 more)

### Community 37 - "menus.js"
Cohesion: 0.22
Nodes (10): sauvegarderRole(), ACCES_DEFAUT, chargerAccesConfig(), enregistrerAccesRole(), LABELS_ROLES, ROLES_CONFIGURABLES, tuileParId(), TUILES (+2 more)

### Community 38 - "Le POS Samer alimente Samtrackly — bascule des caissiers, site par site"
Cohesion: 0.11
Nodes (17): 10. Les contacts, 11. Points ouverts, 12. Résistance aux pannes, 13. Risque assumé, non traité, 14. Déploiement, 1. Le principe, 2. Ce qui existe déjà et qu'on réutilise, 3. Le fond de caisse — la règle intangible (+9 more)

### Community 39 - "Architecture"
Cohesion: 0.12
Nodes (15): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), graphify, iOS Web Specifics, Key Screen Flows (+7 more)

### Community 40 - "photoQueue.js"
Cohesion: 0.08
Nodes (35): InactivityGuard(), PUBLIC_ROUTES, SessionGuard(), NetworkStatusBar(), styles, NetworkContext, NetworkProvider(), useNetwork() (+27 more)

### Community 41 - "Architecture"
Cohesion: 0.12
Nodes (15): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), graphify, iOS Web Specifics, Key Screen Flows (+7 more)

### Community 42 - "ChargesScreen"
Cohesion: 0.19
Nodes (11): ChargesScreen(), beneficeApresCharge(), beneficeReel(), chargerCharges(), recalculerBSC(), sauvegarder(), supprimerCharge(), totalApresCharge() (+3 more)

### Community 43 - "creerNotification"
Cohesion: 0.13
Nodes (23): chargerLitigesMois(), LITIGES_CATS, MOIS_NOMS, CANAUX_AVIS, chargerTousRestaurants(), ONGLETS, PERIODES, PRODUIT_TO_CAT (+15 more)

### Community 44 - "journaliser"
Cohesion: 0.16
Nodes (16): DemandesAdminScreen(), charger(), confirmerDeclin(), confirmerValidation(), demanderValidation(), estFinanciere(), executerAnnulation(), soumettreCreation() (+8 more)

### Community 45 - "RestaurantsScreen"
Cohesion: 0.22
Nodes (3): makeStyles(), ObjectifMensuel(), RestaurantsScreen()

### Community 46 - "ecartsParCaissier"
Cohesion: 0.50
Nodes (3): chargerCumulShifts(), ecartsParCaissier(), JOURNEE

### Community 49 - "accueil.js"
Cohesion: 0.15
Nodes (9): makeStyles(), MenuCard(), styles, SignatureFooter(), styles, SPRINGS, staggerDelay(), configurerHandler() (+1 more)

### Community 50 - "Web Push (PWA) — mise en route"
Cohesion: 0.14
Nodes (13): 1. Générer les clés VAPID, 2. Renseigner la clé PUBLIQUE côté app, 3. Secrets de l'Edge Function, 4. Créer la table, 5. Déployer l'Edge Function, 6. Redéployer l'app web, Architecture (rappel), Côté utilisateur (une fois, par téléphone) (+5 more)

### Community 51 - "supabase_migrations_all.sql"
Cohesion: 0.25
Nodes (12): demandes_explication, entrees_shift, erreurs_client, inventaire_lignes, inventaires_shifts, litiges_responsables, fournisseurs, points (+4 more)

### Community 52 - "CorrectionPointScreen"
Cohesion: 0.21
Nodes (8): CorrectionPointScreen(), initEdits(), _marquerCorrige(), marquerSansEdit(), recalculerTotaux(), sauvegarder(), toggleExpand(), makeStyles()

### Community 53 - "DocumentsScreen"
Cohesion: 0.19
Nodes (6): DocumentsScreen(), chargerDocuments(), resetForm(), sauvegarder(), supprimerDoc(), makeStyles()

### Community 54 - "Structure des fichiers"
Cohesion: 0.15
Nodes (12): Gestion des contrats de travail (RH) — Plan d'implémentation, Global Constraints, Structure des fichiers, Task 1 : Logique des contrats (`lib/contrats.js`), Task 2 : Migration SQL, Task 3 : Extraire l'upload de fichier (`lib/uploadFichier.js`), Task 4 : Formulaire de contrat (`components/FormulaireContrat.js`), Task 5 : Bloc « Contrat » dans la fiche travailleur (+4 more)

### Community 55 - "Périmètre"
Cohesion: 0.15
Nodes (12): 1. Le bouton (`app/verification.js`), 2. Le modal — réutilisé, avec un mode, 3. L'écriture en base — aucune migration, 4. Reverse dans Litiges — obligatoire, 5. Visibilité dans Litiges, 6. Notification gérant, Hors périmètre, Justifier un écart de vente machine sans toucher au fond (+4 more)

### Community 56 - "Le pont pousse aussi l'inventaire — POS Samer → Samtrackly"
Cohesion: 0.15
Nodes (12): 1. Ce qui existe déjà côté POS (vérifié le 2026-08-20), 2. Ce qui manque, 3. Où ça s'ajoute, 4. Correspondance des champs, 5. Idempotence, 6. Ce que ce chantier ne change PAS, 7. Migration Samtrackly, 8. Tests (+4 more)

### Community 57 - "notifications.js"
Cohesion: 0.18
Nodes (18): DemandesExplicationScreen(), charger(), imprimerPdf(), resetForm(), soumettre(), uploaderReponse(), fmtDateHeure(), makeStyles() (+10 more)

### Community 58 - "scripts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, android, ios, lint, reset-project (+4 more)

### Community 59 - "Plan de durcissement sécurité — Edge Functions (option 1)"
Cohesion: 0.15
Nodes (12): Ce que ça NE fait pas, Contraintes à respecter (ne rien casser), Décisions à prendre avant de coder, Effort estimé, ⚠️ La menace qu'on traite, Le plus gros risque à régler en premier 🔴, Phasage, Phase 1 — Auth serveur légère + PIN hashés (fondation) (+4 more)

### Community 60 - "NotificationsContext.js"
Cohesion: 0.17
Nodes (15): NotificationsContext, NotificationsProvider(), charger(), fermerPanel(), marquerUneCommeLue(), naviguerDepuisNotif(), ouvrirPanel(), supprimerTout() (+7 more)

### Community 62 - "Structure des fichiers"
Cohesion: 0.17
Nodes (11): Global Constraints, Structure des fichiers, Task 1 : Migration — durées libres, Task 2 : Logique de sélection, de rang et de validation, Task 3 : Formulaire — durées libres, date de fin modifiable, mode correction, Task 4 : Sélecteur de travailleur, Task 5 : Fiche d'un travailleur et ses quatre actions, Task 6 : L'écran `/contrats` (+3 more)

### Community 63 - "rappel-contrats/index.ts"
Cohesion: 0.23
Nodes (8): Contrat, enCours(), finEffective(), joursRestants(), palierAEnvoyer(), PALIERS, ROLES_ADMIN, versUTC()

### Community 65 - "dashboard-global.js"
Cohesion: 0.18
Nodes (10): CATEGORIES_FOOD, couleurResto(), courtNom(), familleResto(), jaugeStyles, makeStyles(), PERIODES, PIE_COLORS (+2 more)

### Community 67 - "Pont inventaire POS → Samtrackly — Implementation Plan"
Cohesion: 0.18
Nodes (10): Global Constraints, Pont inventaire POS → Samtrackly — Implementation Plan, Self-Review (fait avant de vous remettre ce plan), Step 1: Écrire les tests (ils doivent tous échouer au départ — le fichier `samtrackly-inventaire.ts` n'existe pas encore), Step 3: Écrire l'implémentation, Task 1: Migration Samtrackly — colonne d'idempotence, Task 2: Helper DELETE dans `samtrackly-api.ts`, Task 3: Module pur `samtrackly-inventaire.ts` (TDD) (+2 more)

### Community 71 - "EquipeScreen"
Cohesion: 0.40
Nodes (4): EquipeScreen(), ouvrirProfil(), renderCard(), makeStyles()

### Community 75 - "devDependencies"
Cohesion: 0.22
Nodes (9): eslint, eslint-config-expo, devDependencies, eslint, eslint-config-expo, @types/react, typescript, @types/react (+1 more)

### Community 76 - "tsconfig.json"
Cohesion: 0.22
Nodes (8): expo/tsconfig.base, **/*.ts, **/*.tsx, compilerOptions, paths, strict, extends, include

### Community 77 - "reset-project.js"
Cohesion: 0.22
Nodes (7): exampleDirPath, fs, oldDirs, path, readline, rl, root

### Community 78 - "demandes.js"
Cohesion: 0.33
Nodes (8): DemandesScreen(), charger(), resetForm(), soumettre(), fmtDate(), makeStyles(), STATUT_CONFIG, TYPES_DEMANDE

### Community 80 - "inventaires_shifts"
Cohesion: 0.32
Nodes (7): entrees_shift, inventaire_lignes, inventaires_shifts, fournisseurs, points, restaurants, utilisateurs

### Community 81 - "send-web-push/index.ts"
Cohesion: 0.29
Nodes (5): admin, cors, GLOBAL_ROLES, RESTO_ROLES, Sub

### Community 83 - "parametres.js"
Cohesion: 0.20
Nodes (10): SECTIONS, MOTIFS_ARCHIVE, ONGLETS, PERIODES, STATUT_COLORS, FormulaireTravailleur(), normaliserPoste(), POSTES (+2 more)

### Community 84 - "Welcome to your Expo app 👋"
Cohesion: 0.33
Nodes (5): Get a fresh project, Get started, Join the community, Learn more, Welcome to your Expo app 👋

### Community 85 - "supabase_date_point_transactions.sql"
Cohesion: 0.40
Nodes (4): public.remplir_date_point_transaction, public.remplir_date_point_transaction(), public.points, trg_date_point_transaction

### Community 86 - "transactions-fournisseurs-date.js"
Cohesion: 0.50
Nodes (4): { createClient }, fmt(), main(), supabase

### Community 87 - "suppressions_archive"
Cohesion: 0.40
Nodes (4): points, restaurants, utilisateurs, suppressions_archive

### Community 88 - "demandes_explication"
Cohesion: 0.50
Nodes (4): demandes_explication, restaurants, travailleurs, utilisateurs

### Community 89 - "litiges_responsables"
Cohesion: 0.40
Nodes (4): litiges_responsables, points, restaurants, utilisateurs

### Community 90 - "contrats_travailleurs"
Cohesion: 0.50
Nodes (3): contrats_travailleurs, restaurants, travailleurs

### Community 91 - "public.deductions_verification"
Cohesion: 0.50
Nodes (3): public.deductions_verification, public.points, public.restaurants

### Community 92 - "inventaires_shifts_restaurant_depuis_point"
Cohesion: 0.67
Nodes (3): inventaires_shifts_restaurant_depuis_point(), points, trg_inv_shifts_restaurant

### Community 93 - "verifications_stock"
Cohesion: 0.50
Nodes (3): restaurants, utilisateurs, verifications_stock

### Community 94 - "vercel.json"
Cohesion: 0.50
Nodes (3): buildCommand, outputDirectory, rewrites

## Knowledge Gaps
- **422 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+417 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **66 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useTheme()` connect `useTheme` to `LitigesScreen`, `exportRapportMensuel.js`, `InventaireScreen`, `app/contrats.js`, `BrouillonsFournisseursScreen`, `FournisseursScreen`, `rapportMensuel.js`, `ModifierPointScreen`, `VerificationScreen`, `useApp`, `RHScreen`, `AccueilScreen`, `verification.js`, `api.js`, `DemandesExplicationAdminScreen`, `RecapPointScreen`, `dashboard.js`, `CreditsFournisseursScreen`, `DashboardGlobalScreen`, `PointShiftScreen`, `DashboardScreen`, `app/journal.js`, `ParametresScreen`, `VentesScreen`, `verificateur.js`, `LoginScreen`, `app/corbeille.js`, `ChargesScreen`, `creerNotification`, `journaliser`, `RestaurantsScreen`, `accueil.js`, `CorrectionPointScreen`, `DocumentsScreen`, `notifications.js`, `ContactsScreen`, `dashboard-global.js`, `EquipeScreen`, `ModifierInventaireScreen`, `demandes.js`, `parametres.js`?**
  _High betweenness centrality (0.203) - this node is a cross-community bridge._
- **Why does `useApp()` connect `useApp` to `LitigesScreen`, `InventaireScreen`, `app/contrats.js`, `BrouillonsFournisseursScreen`, `FournisseursScreen`, `ModifierPointScreen`, `VerificationScreen`, `RHScreen`, `AccueilScreen`, `verification.js`, `api.js`, `DemandesExplicationAdminScreen`, `RecapPointScreen`, `dashboard.js`, `CreditsFournisseursScreen`, `PointShiftScreen`, `DashboardScreen`, `app/journal.js`, `ParametresScreen`, `useTheme`, `VentesScreen`, `verificateur.js`, `LoginScreen`, `app/corbeille.js`, `photoQueue.js`, `ChargesScreen`, `creerNotification`, `journaliser`, `accueil.js`, `CorrectionPointScreen`, `DocumentsScreen`, `notifications.js`, `NotificationsContext.js`, `ContactsScreen`, `EquipeScreen`, `demandes.js`, `parametres.js`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `InventaireScreen()` connect `InventaireScreen` to `useApp`, `useTheme`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _422 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `LitigesScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.07769423558897243 - nodes in this community are weakly interconnected._
- **Should `exportRapportMensuel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08468468468468468 - nodes in this community are weakly interconnected._
- **Should `InventaireScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.10663983903420524 - nodes in this community are weakly interconnected._