# Graph Report - samtrackly  (2026-10-01)

## Corpus Check
- 257 files · ~393,169 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2547 nodes · 5734 edges · 231 communities (160 shown, 71 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fd3478f7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- LitigesScreen
- exportRapportMensuel.js
- InventaireScreen
- lib/contrats.js
- BrouillonsFournisseursScreen
- DepensesScreen
- rapportMensuel.js
- expo
- ModifierPointScreen
- VerificationScreen
- explore.tsx
- stats-caissiers.js
- RHScreen
- demandes-admin.js
- avis-plateformes.js
- useApp
- Handoff — Samtrackly / SamerPoint
- DemandesExplicationAdminScreen
- journaliser
- Travailleurs & Utilisateurs par restaurant
- DashboardGlobalScreen
- CreditsFournisseursScreen
- supabase.js
- ModifierInventaireScreen
- PointShiftScreen
- DashboardScreen
- app/journal.js
- ParametresScreen
- litigeContacts.js
- partenairesImport.js
- deductionsVerification.js
- dependencies
- Gestion des contrats de travail (RH)
- AppProvider
- Écran Contrats autonome — design
- DocumentsScreen
- verification.js
- api.js
- Le POS Samer alimente Samtrackly — bascule des caissiers, site par site
- Architecture
- VentesScreen
- Architecture
- verificateur.js
- Avis clients Yango & Glovo — mise en service
- Comparaison A / B — Dashboard Global
- offlineCache.js
- comparaisonDashboard.js
- supabase_avis_plateformes.sql
- points_shifts
- ingest-reviews/index.ts
- Web Push (PWA) — mise en route
- supabase_migrations_all.sql
- CorrectionPointScreen
- creerNotification
- Structure des fichiers
- Périmètre
- Le pont pousse aussi l'inventaire — POS Samer → Samtrackly
- dashboardGlobal.js
- scripts
- Plan de durcissement sécurité — Edge Functions (option 1)
- selectionner-journee.js
- Structure des fichiers
- rappel-contrats/index.ts
- ContactsScreen
- login.js
- public.points_shifts
- Pont inventaire POS → Samtrackly — Implementation Plan
- RecapPointScreen
- notifications.js
- expo-dev-client
- contactsParCaissier.js
- dashboard.js
- dashboard-global.js
- gestion-stock.js
- devDependencies
- tsconfig.json
- reset-project.js
- FournisseursScreen
- litiges_avis_clients
- inventaires_shifts
- send-web-push/index.ts
- ChargesScreen
- litiges_avis_clients
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
- useTheme
- LivraisonsScreen
- offlineQueue.js
- android
- expo-file-system
- expo-font
- periodeComparee.js
- expo-image-picker
- expo-notifications
- expo-print
- expo-router
- expo-splash-screen
- expo-device
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
- rh.js
- @supabase/supabase-js
- victory-native
- xlsx
- supabase_erreurs_client.sql
- supabase_roles_acces.sql
- supabase_web_push.sql
- public.restaurants
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
- supabase_pos_vente_systeme.sql
- public.points_shifts
- restaurants
- inventaires_shifts
- inventaires_shifts
- transactions_fournisseurs
- verifications_stock
- choix-date.js
- Point caissier — design
- Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?
- accueil.js
- DeductionsGerantScreen
- rapportHebdo.js
- litiges.js
- Global Constraints
- public.points_shifts
- Global Constraints
- Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?
- photoQueue.js
- Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?
- Trésorerie — étape 1 : le socle
- public.points_shifts
- expo-document-picker
- supabase_tresorerie.sql
- Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire
- expo-status-bar
- decisionInventaire.js
- public.decider_ecart_inventaire_atomique
- expo-haptics
- @shopify/react-native-skia
- derniersRestesFournisseurs.js
- onedrive.js
- extra
- presences.js
- ios
- VerificateurScreen
- AccueilScreen
- expo
- menus.js
- webPush.js
- credits-fournisseurs.js
- equipe.js
- ThemeContext.js
- permissions
- chargerComparaison
- expo-constants

## God Nodes (most connected - your core abstractions)
1. `useTheme()` - 114 edges
2. `useApp()` - 86 edges
3. `journaliser()` - 82 edges
4. `InventaireScreen()` - 72 edges
5. `supabase` - 61 edges
6. `LitigesScreen()` - 60 edges
7. `VerificationScreen()` - 57 edges
8. `expo-router` - 54 edges
9. `creerNotification()` - 45 edges
10. `ModifierPointScreen()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `activerPush()` --calls--> `activerNotificationsPush()`  [EXTRACTED]
  app/accueil.js → lib/webPush.js
- `chargerRestaurants()` --calls--> `chargerRestaurantsContact()`  [EXTRACTED]
  app/charges.js → lib/litigeContacts.js
- `JaugeCout()` --calls--> `fmtFCFA()`  [EXTRACTED]
  app/dashboard-global.js → lib/dashboardGlobal.js
- `ventesToday()` --calls--> `totalVentes()`  [EXTRACTED]
  app/dashboard.js → context/AppContext.js
- `imprimerPdf()` --calls--> `genererPdfExplication()`  [EXTRACTED]
  app/demandes-explication.js → lib/pdfDocuments.js

## Import Cycles
- None detected.

## Communities (231 total, 71 thin omitted)

### Community 0 - "LitigesScreen"
Cohesion: 0.08
Nodes (53): canalAvis(), couleurMontant(), fmt(), fmtShort(), formDateDefaut(), LitigesScreen(), chargerAvis(), chargerDatesAvec() (+45 more)

### Community 1 - "exportRapportMensuel.js"
Cohesion: 0.11
Nodes (57): DetailProduit(), exporter(), formaterMontantSigneFCFA(), chargerDetailProduit(), exporterDetailPdf(), exporterDetailXlsx(), fetchPagine(), formaterDateFr() (+49 more)

### Community 2 - "InventaireScreen"
Cohesion: 0.11
Nodes (70): InventaireScreen(), aExplicationKey(), analyserSourceStock(), appliquerOverrideVerif(), chargerLignes(), chargerOuCreer(), chargerStockInitial(), darinaEnt() (+62 more)

### Community 3 - "lib/contrats.js"
Cohesion: 0.08
Nodes (57): ContratsScreen(), badge(), charger(), contratsDe(), enregistrerContrat(), messageErreur(), ouvrirFiche(), pied() (+49 more)

### Community 4 - "BrouillonsFournisseursScreen"
Cohesion: 0.23
Nodes (14): BrouillonsFournisseursScreen(), charger(), confirmerIgnorer(), confirmerIgnorerLot(), grouperParPoint(), quitterSelection(), reinjecter(), retirerDuBrouillon() (+6 more)

### Community 5 - "DepensesScreen"
Cohesion: 0.16
Nodes (12): DepensesScreen(), ajouterLigne(), enregistrer(), saveDepensesGerant(), setLibelle(), setMontant(), supprimerLigne(), totalCategorie() (+4 more)

### Community 6 - "rapportMensuel.js"
Cohesion: 0.07
Nodes (66): couleurEcart(), DETAIL_VIDE, fmt(), makeStyles(), PointCaissierScreen(), ouvrir(), titreJour(), ouvrirDetailShift() (+58 more)

### Community 7 - "expo"
Cohesion: 0.12
Nodes (16): expo, icon, name, orientation, owner, plugins, runtimeVersion, scheme (+8 more)

### Community 8 - "ModifierPointScreen"
Cohesion: 0.07
Nodes (57): CorbeilleScreen(), charger(), restaurer(), decrireContenu(), formatDatePoint(), formatHeure(), makeStyles(), makeStyles() (+49 more)

### Community 9 - "VerificationScreen"
Cohesion: 0.08
Nodes (30): VerificationScreen(), appliquerDeltaFond(), changerResto(), chargerPointsResto(), chargerRestaurants(), confirmerAnnulationDeduction(), confirmerAnnulationMachine(), confirmerRefusCloturePOS() (+22 more)

### Community 10 - "explore.tsx"
Cohesion: 0.11
Nodes (23): styles, styles, TabLayout(), ExternalLink(), Props, HapticTab(), ParallaxScrollView(), Props (+15 more)

### Community 11 - "stats-caissiers.js"
Cohesion: 0.16
Nodes (25): CaissierCard(), dateDepuis(), DetailLigne(), EcartBadge(), EcartDetail(), fmt(), fmtPct(), formatDate() (+17 more)

### Community 12 - "RHScreen"
Cohesion: 0.13
Nodes (32): makeStyles(), RHScreen(), archiverTravailleur(), chargerArchives(), chargerDonnees(), chargerHistoriqueTravailleur(), choisirPDFPapier(), choisirPhotoPapier() (+24 more)

### Community 13 - "demandes-admin.js"
Cohesion: 0.14
Nodes (15): DemandesAdminScreen(), charger(), confirmerDeclin(), confirmerValidation(), demanderValidation(), estFinanciere(), executerAnnulation(), soumettreCreation() (+7 more)

### Community 14 - "avis-plateformes.js"
Cohesion: 0.18
Nodes (24): AvisPlateformes(), charger(), confirmerRattachement(), onRefresh(), Badge(), etoiles(), fmtDate(), makeStyles() (+16 more)

### Community 15 - "useApp"
Cohesion: 0.12
Nodes (21): GerantCaissierScreen(), makeStyles(), MENU, InactivityGuard(), PUBLIC_ROUTES, SessionGuard(), useApp(), NotificationsContext (+13 more)

### Community 16 - "Handoff — Samtrackly / SamerPoint"
Cohesion: 0.06
Nodes (30): ✅ 1. Congés futurs saisis par le RH — CODE FAIT (non déployé), ~~1. Congés futurs saisis par le RH~~ (spec d'origine), 2. Demandes d'explication — workflow avec suivi, ✅ 2. Demandes d'explication — workflow avec suivi — CODE FAIT (non déployé), 3. Gestion de stock (menu Manager & Admin), ✅ 3. Gestion de stock (menu Manager & Admin) — CODE FAIT (non déployé), 4. Textes PDF prédéfinis, 4. Textes PDF prédéfinis — ✅ FAIT (dans `lib/pdfDocuments.js`) (+22 more)

### Community 17 - "DemandesExplicationAdminScreen"
Cohesion: 0.08
Nodes (32): DemandesExplicationAdminScreen(), accepter(), charger(), confirmerRefus(), confirmerRelance(), confirmerReponse(), imprimerPdf(), marquerEnvoyee() (+24 more)

### Community 18 - "journaliser"
Cohesion: 0.06
Nodes (133): Badge(), couleursStatut(), FeuilleDetail(), annuler(), supprimer(), FeuilleEdition(), enregistrer(), FeuillePaiement() (+125 more)

### Community 19 - "Travailleurs & Utilisateurs par restaurant"
Cohesion: 0.08
Nodes (23): 🏪 Al Kayan KMS, 🏪 Al Kayan Yop, 🌍 Comptes globaux (manager / RH / directeur — sans restaurant), 🏪 Samer Angré 7E, 🏪 Samer Lavage, 🏪 Samer Maroc, 🏪 Samer Oasis, 🏪 Samer Palmeraie (+15 more)

### Community 20 - "DashboardGlobalScreen"
Cohesion: 0.11
Nodes (11): DashboardGlobalScreen(), chargerPoints(), formatDate(), formatDateLongue(), getDateRange(), montantCanal(), renderClassementCompare(), renderComparaison() (+3 more)

### Community 21 - "CreditsFournisseursScreen"
Cohesion: 0.16
Nodes (21): CreditsFournisseursScreen(), charger(), chargerHistorique(), confirmerArchivage(), confirmerFixTous(), confirmerRemiseAZero(), exporterExcel(), exporterPdf() (+13 more)

### Community 22 - "supabase.js"
Cohesion: 0.13
Nodes (22): SECTION_CONFIG, CATEGORIES, CATS_ENTREE, EXCLUS, PRODUITS_ENTREE, TYPES_SHIFTS, CATS_DEPENSES, ONGLETS (+14 more)

### Community 23 - "ModifierInventaireScreen"
Cohesion: 0.20
Nodes (3): makeStyles(), ModifierInventaireScreen(), CATEGORIES_INVENTAIRE

### Community 24 - "PointShiftScreen"
Cohesion: 0.14
Nodes (7): lireDraft(), PointShiftScreen(), chargerStatutInventaire(), gererPhoto(), selectionnerPhoto(), validerShift(), verifierPhotosManquantes()

### Community 25 - "DashboardScreen"
Cohesion: 0.11
Nodes (14): DashboardScreen(), beneficeToday(), calculerAlertes(), chargerPoints(), confirmerPeriode(), fmt(), fmtFull(), formatDate() (+6 more)

### Community 26 - "app/journal.js"
Cohesion: 0.14
Nodes (20): CLES_MONTANT, EntryRow(), ErreurRow(), FILTRES, formatHeure(), formatRelative(), formatValeur(), JournalScreen() (+12 more)

### Community 27 - "ParametresScreen"
Cohesion: 0.05
Nodes (58): executer(), gererPhotoRegul(), executer(), makeStyles(), ParametresScreen(), ajouterDocument(), basculerRestaurant(), CarteBascule() (+50 more)

### Community 28 - "litigeContacts.js"
Cohesion: 0.13
Nodes (33): chargerLitigesMois(), LITIGES_CATS, MOIS_NOMS, chargerEcartContacts(), chargerTousRestaurants(), sauvegarderCorrLitige(), sauvegarderCorrNbCommandes(), sauvegarderCorrectionCommandes() (+25 more)

### Community 29 - "partenairesImport.js"
Cohesion: 0.21
Nodes (22): analyserGlovo(), analyserYango(), arrondirTotaux(), codeGlovo(), codeParMotsCles(), CODES, codeYango(), COLONNES_GLOVO (+14 more)

### Community 30 - "deductionsVerification.js"
Cohesion: 0.18
Nodes (15): appliquerPlafond(), caissiersResponsables(), calculerDeductions(), chargerDeductions(), chiffrerComptage(), cleLot(), couvre(), enMinutes() (+7 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): expo-image, expo-linking, expo-sharing, expo-symbols, expo-web-browser, dependencies, exceljs, expo-image (+13 more)

### Community 32 - "Gestion des contrats de travail (RH)"
Cohesion: 0.10
Nodes (19): Automatisation, Bloc « Contrat » dans la fiche travailleur, Formulaire de contrat (modal), Gestion des contrats de travail (RH), Hors périmètre, Le fichier du contrat, Le statut n'est pas stocké, Limite connue : le PIN survit à la désactivation (+11 more)

### Community 33 - "AppProvider"
Cohesion: 0.17
Nodes (19): confirmer(), depensesToday(), laborCostMontant(), effacerDraft(), sauvegarderShift(), venteShift(), AppProvider(), aDonneesSaisies() (+11 more)

### Community 34 - "Écran Contrats autonome — design"
Cohesion: 0.11
Nodes (18): Ajouter un contrat, Changements ailleurs, Durées de contrat, Décisions, Découpage des fichiers, Fiche d'un travailleur et actions, Hors périmètre, Interfaces (+10 more)

### Community 35 - "DocumentsScreen"
Cohesion: 0.19
Nodes (6): DocumentsScreen(), chargerDocuments(), resetForm(), sauvegarder(), supprimerDoc(), makeStyles()

### Community 36 - "verification.js"
Cohesion: 0.13
Nodes (18): makeStyles(), STATUT_MACHINE, PhotoVignette(), telechargerPdf(), telechargerPdfEcarts(), voirPhoto(), { width: SW }, photoConsultable() (+10 more)

### Community 37 - "api.js"
Cohesion: 0.21
Nodes (19): getOrCreatePoint(), getRestaurants(), majPresenceExistante(), saveCommandes(), saveDepenses(), saveInventaireShift(), saveOnePresence(), saveOneTransactionFournisseur() (+11 more)

### Community 38 - "Le POS Samer alimente Samtrackly — bascule des caissiers, site par site"
Cohesion: 0.11
Nodes (17): 10. Les contacts, 11. Points ouverts, 12. Résistance aux pannes, 13. Risque assumé, non traité, 14. Déploiement, 1. Le principe, 2. Ce qui existe déjà et qu'on réutilise, 3. Le fond de caisse — la règle intangible (+9 more)

### Community 39 - "Architecture"
Cohesion: 0.11
Nodes (16): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), Déploiement — TOUJOURS en mise à jour automatique, graphify, iOS Web Specifics (+8 more)

### Community 40 - "VentesScreen"
Cohesion: 0.15
Nodes (13): makeStyles(), VentesScreen(), allerAuRecap(), fmt(), gererPhoto(), PhotoBlock(), sauvegarderEtContinuer(), sauvegarderPhotosPoints() (+5 more)

### Community 41 - "Architecture"
Cohesion: 0.11
Nodes (16): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), Déploiement — TOUJOURS en mise à jour automatique, graphify, iOS Web Specifics (+8 more)

### Community 42 - "verificateur.js"
Cohesion: 0.18
Nodes (14): makeStyles(), RecapVerificationsScreen(), ORDRE_PRODUIT, makeStyles(), RecapVerifications(), charger(), enregistrerCorrection(), onRefresh() (+6 more)

### Community 43 - "Avis clients Yango & Glovo — mise en service"
Cohesion: 0.17
Nodes (11): 1. Migration, 2. Secret + déploiement de la fonction, 3. Premier envoi de test, 4. Mapping des boutiques, Adaptations au schéma réel, Avis clients Yango & Glovo — mise en service, Ce qui a été construit, Ce qui n'est pas couvert (+3 more)

### Community 44 - "Comparaison A / B — Dashboard Global"
Cohesion: 0.08
Nodes (23): 10. Tests, 11. Définition de « terminé », 1. Le problème, 2. Périmètre, 3.1 La période B n'est pas choisie, elle est déduite, 3.2 Qui remplit A et B, et ce que devient `restoFiltre`, 3. Les deux modes, 4.1 Les couleurs (+15 more)

### Community 45 - "offlineCache.js"
Cohesion: 0.20
Nodes (18): getFournisseurs(), getTravailleurs(), getUtilisateurs(), getUtilisateursGlobaux(), cacheFournisseurs(), cachePoint(), cachePointData(), cacheRestaurants() (+10 more)

### Community 46 - "comparaisonDashboard.js"
Cohesion: 0.20
Nodes (19): COULEUR_ECART, LigneComparee(), makeStyles(), valeurLisible(), decimal(), ecart(), ecarts(), EPSILON (+11 more)

### Community 47 - "supabase_avis_plateformes.sql"
Cohesion: 0.23
Nodes (9): rattacher_avis(), resoudre_restaurant_avis(), trg_resoudre_restaurant_avis, ingest_runs, platform_reviews, rattacher_avis(), review_store_mapping, review_weekly_stats (+1 more)

### Community 49 - "ingest-reviews/index.ts"
Cohesion: 0.20
Nodes (6): cors, dateIso(), MONTANT_MAUVAIS, PLATEFORMES, supabase, texte()

### Community 50 - "Web Push (PWA) — mise en route"
Cohesion: 0.14
Nodes (13): 1. Générer les clés VAPID, 2. Renseigner la clé PUBLIQUE côté app, 3. Secrets de l'Edge Function, 4. Créer la table, 5. Déployer l'Edge Function, 6. Redéployer l'app web, Architecture (rappel), Côté utilisateur (une fois, par téléphone) (+5 more)

### Community 51 - "supabase_migrations_all.sql"
Cohesion: 0.18
Nodes (14): demandes_explication, entrees_shift, erreurs_client, inventaire_lignes, inventaires_shifts, litiges_responsables, points_shifts_vente_machine, fournisseurs (+6 more)

### Community 52 - "CorrectionPointScreen"
Cohesion: 0.21
Nodes (8): CorrectionPointScreen(), initEdits(), _marquerCorrige(), marquerSansEdit(), recalculerTotaux(), sauvegarder(), toggleExpand(), makeStyles()

### Community 53 - "creerNotification"
Cohesion: 0.19
Nodes (12): FILTRES, DemandesExplicationScreen(), charger(), imprimerPdf(), resetForm(), soumettre(), uploaderReponse(), fmtDateHeure() (+4 more)

### Community 54 - "Structure des fichiers"
Cohesion: 0.15
Nodes (12): Gestion des contrats de travail (RH) — Plan d'implémentation, Global Constraints, Structure des fichiers, Task 1 : Logique des contrats (`lib/contrats.js`), Task 2 : Migration SQL, Task 3 : Extraire l'upload de fichier (`lib/uploadFichier.js`), Task 4 : Formulaire de contrat (`components/FormulaireContrat.js`), Task 5 : Bloc « Contrat » dans la fiche travailleur (+4 more)

### Community 55 - "Périmètre"
Cohesion: 0.15
Nodes (12): 1. Le bouton (`app/verification.js`), 2. Le modal — réutilisé, avec un mode, 3. L'écriture en base — aucune migration, 4. Reverse dans Litiges — obligatoire, 5. Visibilité dans Litiges, 6. Notification gérant, Hors périmètre, Justifier un écart de vente machine sans toucher au fond (+4 more)

### Community 56 - "Le pont pousse aussi l'inventaire — POS Samer → Samtrackly"
Cohesion: 0.15
Nodes (12): 1. Ce qui existe déjà côté POS (vérifié le 2026-08-20), 2. Ce qui manque, 3. Où ça s'ajoute, 4. Correspondance des champs, 5. Idempotence, 6. Ce que ce chantier ne change PAS, 7. Migration Samtrackly, 8. Tests (+4 more)

### Community 57 - "dashboardGlobal.js"
Cohesion: 0.28
Nodes (15): CATEGORIES_FOOD, chargesFixesMontant(), detailFondRecu(), familleResto(), fondRecuPoint(), foodCostMontant(), laborCostMontant(), nombre() (+7 more)

### Community 58 - "scripts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, android, ios, lint, reset-project (+4 more)

### Community 59 - "Plan de durcissement sécurité — Edge Functions (option 1)"
Cohesion: 0.15
Nodes (12): Ce que ça NE fait pas, Contraintes à respecter (ne rien casser), Décisions à prendre avant de coder, Effort estimé, ⚠️ La menace qu'on traite, Le plus gros risque à régler en premier 🔴, Phasage, Phase 1 — Auth serveur légère + PIN hashés (fondation) (+4 more)

### Community 60 - "selectionner-journee.js"
Cohesion: 0.36
Nodes (5): makeStyles(), SelectionJourneeScreen(), choisir(), restaurerPresencesDuJour(), getPresences()

### Community 62 - "Structure des fichiers"
Cohesion: 0.17
Nodes (11): Global Constraints, Structure des fichiers, Task 1 : Migration — durées libres, Task 2 : Logique de sélection, de rang et de validation, Task 3 : Formulaire — durées libres, date de fin modifiable, mode correction, Task 4 : Sélecteur de travailleur, Task 5 : Fiche d'un travailleur et ses quatre actions, Task 6 : L'écran `/contrats` (+3 more)

### Community 63 - "rappel-contrats/index.ts"
Cohesion: 0.23
Nodes (8): Contrat, enCours(), finEffective(), joursRestants(), palierAEnvoyer(), PALIERS, ROLES_ADMIN, versUTC()

### Community 64 - "ContactsScreen"
Cohesion: 0.17
Nodes (3): ContactsScreen(), makeStyles(), ONGLETS

### Community 65 - "login.js"
Cohesion: 0.13
Nodes (21): LoginScreen(), appuyerChiffre(), chargerUtilisateurs(), chargerUtilisateursGlobaux(), choisirRestaurant(), choisirUtilisateur(), fetchRestaurants(), getRoleBg() (+13 more)

### Community 67 - "Pont inventaire POS → Samtrackly — Implementation Plan"
Cohesion: 0.18
Nodes (10): Global Constraints, Pont inventaire POS → Samtrackly — Implementation Plan, Self-Review (fait avant de vous remettre ce plan), Step 1: Écrire les tests (ils doivent tous échouer au départ — le fichier `samtrackly-inventaire.ts` n'existe pas encore), Step 3: Écrire l'implémentation, Task 1: Migration Samtrackly — colonne d'idempotence, Task 2: Helper DELETE dans `samtrackly-api.ts`, Task 3: Module pur `samtrackly-inventaire.ts` (TDD) (+2 more)

### Community 68 - "RecapPointScreen"
Cohesion: 0.19
Nodes (16): calcVariation(), makeStyles(), RecapPointScreen(), beneficeSCCalc(), confirmerValider(), fcCalc(), resteEspecesCalc(), totalDepensesGlobal() (+8 more)

### Community 69 - "notifications.js"
Cohesion: 0.22
Nodes (17): DemandesScreen(), charger(), resetForm(), soumettre(), fmtDate(), makeStyles(), STATUT_CONFIG, envoyerNotifDemandeNouvelle() (+9 more)

### Community 71 - "contactsParCaissier.js"
Cohesion: 0.28
Nodes (13): ouvrirPoint(), contactPris(), depuisCommandes(), depuisShiftsPOS(), detailContactsParCaissier(), ECART_ALERTE_COMMANDES, entierPositif(), estimerCommandesShift() (+5 more)

### Community 72 - "dashboard.js"
Cohesion: 0.20
Nodes (15): CATEGORIES_FOOD, chargerCouts(), chargerCoutsB(), chargerCoutsGlobal(), jaugeStyles, makeStyles(), PERIODES, PILIERS (+7 more)

### Community 73 - "dashboard-global.js"
Cohesion: 0.16
Nodes (16): JaugeCout(), jaugeStyles, makeStyles(), PERIODES, PIE_COLORS, PILIERS, PILIERS_COMPARABLES, { width } (+8 more)

### Community 74 - "gestion-stock.js"
Cohesion: 0.14
Nodes (12): calcPreset(), CAT_ORDER, fmtDateCourt(), GestionStockScreen(), choisirPreset(), isoJour(), makeStyles(), PRESETS (+4 more)

### Community 75 - "devDependencies"
Cohesion: 0.22
Nodes (9): eslint, eslint-config-expo, devDependencies, eslint, eslint-config-expo, @types/react, typescript, @types/react (+1 more)

### Community 76 - "tsconfig.json"
Cohesion: 0.22
Nodes (8): expo/tsconfig.base, **/*.ts, **/*.tsx, compilerOptions, paths, strict, extends, include

### Community 77 - "reset-project.js"
Cohesion: 0.22
Nodes (7): exampleDirPath, fs, oldDirs, path, readline, rl, root

### Community 78 - "FournisseursScreen"
Cohesion: 0.22
Nodes (17): FournisseursScreen(), choisirPhoto(), creditVeille(), enregistrerTout(), getTransaction(), prendrePhoto(), restedu(), saveFournisseur() (+9 more)

### Community 80 - "inventaires_shifts"
Cohesion: 0.32
Nodes (7): entrees_shift, inventaire_lignes, inventaires_shifts, fournisseurs, points, restaurants, utilisateurs

### Community 81 - "send-web-push/index.ts"
Cohesion: 0.29
Nodes (5): admin, cors, GLOBAL_ROLES, RESTO_ROLES, Sub

### Community 82 - "ChargesScreen"
Cohesion: 0.19
Nodes (12): ChargesScreen(), beneficeApresCharge(), beneficeReel(), chargerCharges(), chargerRestaurants(), recalculerBSC(), sauvegarder(), supprimerCharge() (+4 more)

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

### Community 100 - "useTheme"
Cohesion: 0.23
Nodes (13): HEURES, LigneSaisie(), LigneSaisieSimple(), makeStyles(), MINUTES, PhotoInput(), couleurEcart(), DETAIL_VIDE (+5 more)

### Community 102 - "LivraisonsScreen"
Cohesion: 0.28
Nodes (7): LivraisonsScreen(), ajouterCommande(), sauvegarder(), sauvegarderEtQuitter(), supprimerCommande(), makeStyles(), getCommandes()

### Community 103 - "offlineQueue.js"
Cohesion: 0.19
Nodes (15): NetworkStatusBar(), styles, NetworkContext, NetworkProvider(), useNetwork(), setOnlineStatus(), clearIdMappings(), generateId() (+7 more)

### Community 104 - "android"
Cohesion: 0.29
Nodes (7): backgroundColor, foregroundImage, adaptiveIcon, googleServicesFile, package, versionCode, android

### Community 107 - "periodeComparee.js"
Cohesion: 0.41
Nodes (11): bandeauDeuxPeriodes(), estMoisEntier(), libelleDuree(), libelleJour(), libellePeriode(), MOIS_COURT, moisCouverts(), nombreDeJours() (+3 more)

### Community 135 - "rh.js"
Cohesion: 0.28
Nodes (7): MOTIFS_ARCHIVE, ONGLETS, PERIODES, STATUT_COLORS, FormulaireTravailleur(), normaliserPoste(), POSTES

### Community 189 - "choix-date.js"
Cohesion: 0.31
Nodes (5): ChoixDateScreen(), chargerDonneesPoint(), pointVientDuPOS(), makeStyles(), getSequences()

### Community 190 - "Point caissier — design"
Cohesion: 0.18
Nodes (10): Données, Décisions, Découpage du code, Détail d'un shift, Hors périmètre, Migration du menu — indispensable, Point caissier — design, Problème (+2 more)

### Community 191 - "Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?, Source Nodes

### Community 192 - "accueil.js"
Cohesion: 0.24
Nodes (6): makeStyles(), MenuCard(), SignatureFooter(), styles, SPRINGS, staggerDelay()

### Community 193 - "DeductionsGerantScreen"
Cohesion: 0.15
Nodes (6): DeductionsGerantScreen(), chargerDonnees(), fmt(), gererPhoto(), sauvegarder(), makeStyles()

### Community 194 - "rapportHebdo.js"
Cohesion: 0.39
Nodes (5): envoyerNotifRapportHebdo(), fmt(), formatDateFr(), getSemaine(), verifierEtGenererRapportHebdo()

### Community 195 - "litiges.js"
Cohesion: 0.13
Nodes (20): CANAUX_AVIS, getPlage(), makeStyles(), ONGLETS, PERIODES, PRODUIT_TO_CAT, SHIFT_LABELS, TYPES_AVIS (+12 more)

### Community 196 - "Global Constraints"
Cohesion: 0.29
Nodes (6): Global Constraints, Task 1: Contrat métier pur des clôtures, Task 2: Stockage et affichage des clôtures, Task 3: Résumés mensuels et exports, Task 4: Vérification finale, Écart global des clôtures POS — Plan d'implémentation

### Community 199 - "Global Constraints"
Cohesion: 0.20
Nodes (9): Global Constraints, Point caissier — plan d'implémentation, Task 1 : le module pur `lib/pointCaissier.js`, Task 2 : sortir le chargement du détail dans `lib/detailShift.js`, Task 3 : sortir l'affichage du détail dans `components/DetailShiftCaissier.js`, Task 4 : l'écran `app/point-caissier.js`, Task 5 : le menu et sa migration, Task 6 : les contacts fournisseurs pour le RH (+1 more)

### Community 200 - "Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?, Source Nodes

### Community 201 - "photoQueue.js"
Cohesion: 0.32
Nodes (11): ecrireFile(), EMPLACEMENTS_PHOTO, enfilerPhoto(), lireFile(), nombrePhotosEnAttente(), nouveauJeton(), PENDING_PREFIX, persister() (+3 more)

### Community 202 - "Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?, Source Nodes

### Community 203 - "Trésorerie — étape 1 : le socle"
Cohesion: 0.17
Nodes (11): Données (`supabase_tresorerie.sql`, à passer dans le SQL Editor), Droits par section (affichage seulement : la base reste ouverte à la clé anon), Découpage du chantier, Formule (étape 1), Journal, Loyers, Salaires et CNPS, Tests (+3 more)

### Community 207 - "supabase_tresorerie.sql"
Cohesion: 0.16
Nodes (14): restaurants, tresorerie_alias, tresorerie_annuler_reception(), tresorerie_partenaire_imports, tresorerie_partenaire_lignes, tresorerie_partenaires, restaurants, tresorerie_annuler_paiement() (+6 more)

### Community 208 - "Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire, Source Nodes

### Community 215 - "derniersRestesFournisseurs.js"
Cohesion: 0.33
Nodes (6): chargerFournisseurs(), chargerDerniersRestes(), choisirDerniersRestes(), PAGE_SUPABASE, PAQUET_POINTS, SOURCE_PRIO

### Community 216 - "onedrive.js"
Cohesion: 0.27
Nodes (13): gererConnexionOneDrive(), base64urlEncode(), connecterOneDrive(), deconnecterOneDrive(), generateChallenge(), generateVerifier(), genererExcelPoint(), getAccessToken() (+5 more)

### Community 217 - "extra"
Cohesion: 0.29
Nodes (7): projectId, extra, eas, onedriveClientId, router, supabaseKey, supabaseUrl

### Community 218 - "presences.js"
Cohesion: 0.19
Nodes (9): DEMANDE_COLOR_DEFAULT, getStatutColor(), makeStyles(), PresencesScreen(), confirmerShift(), sauvegarderPresence(), setStatutRapide(), STATUT_COLORS (+1 more)

### Community 219 - "ios"
Cohesion: 0.40
Nodes (5): ios, ITSAppUsesNonExemptEncryption, bundleIdentifier, infoPlist, supportsTablet

### Community 220 - "VerificateurScreen"
Cohesion: 0.19
Nodes (12): aujourdhui(), makeStyles(), VerificateurScreen(), changerResto(), chargerRestaurants(), chargerStock(), creerDemandeRH(), seDeconnecter() (+4 more)

### Community 221 - "AccueilScreen"
Cohesion: 0.17
Nodes (5): AccueilScreen(), activerPush(), useNotifications(), configurerHandler(), enregistrerTokenDirecteur()

### Community 223 - "menus.js"
Cohesion: 0.22
Nodes (10): sauvegarderRole(), ACCES_DEFAUT, chargerAccesConfig(), enregistrerAccesRole(), LABELS_ROLES, ROLES_CONFIGURABLES, tuileParId(), TUILES (+2 more)

### Community 224 - "webPush.js"
Cohesion: 0.42
Nodes (10): activerNotificationsPush(), desactiverNotificationsPush(), enregistrerServiceWorker(), estStandalonePWA(), estWeb(), etatPermissionPush(), pushSupporte(), sauvegarderAbonnement() (+2 more)

### Community 225 - "credits-fournisseurs.js"
Cohesion: 0.42
Nodes (6): chargerMois(), agregerMouvementsMensuels(), facturesGerantSansPhoto(), photoConsultable(), preparerHistoriqueFournisseur(), restaurerPhotosFacturesDepuisPoints()

### Community 226 - "equipe.js"
Cohesion: 0.28
Nodes (6): EquipeScreen(), ouvrirProfil(), renderCard(), makeStyles(), STATUT_COLORS, TYPE_DOC_ICONS

### Community 227 - "ThemeContext.js"
Cohesion: 0.38
Nodes (4): VIDE, ThemeContext, DARK, LIGHT

### Community 228 - "permissions"
Cohesion: 0.33
Nodes (6): permissions, android.permission.CAMERA, android.permission.POST_NOTIFICATIONS, android.permission.READ_EXTERNAL_STORAGE, android.permission.READ_MEDIA_IMAGES, android.permission.RECORD_AUDIO

### Community 229 - "chargerComparaison"
Cohesion: 0.67
Nodes (3): getDateMoisPrecedent(), getDateSemainePrecedente(), chargerComparaison()

## Knowledge Gaps
- **534 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+529 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **71 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useTheme()` connect `useTheme` to `LitigesScreen`, `InventaireScreen`, `lib/contrats.js`, `BrouillonsFournisseursScreen`, `DepensesScreen`, `rapportMensuel.js`, `rh.js`, `ModifierPointScreen`, `VerificationScreen`, `stats-caissiers.js`, `RHScreen`, `demandes-admin.js`, `avis-plateformes.js`, `useApp`, `DemandesExplicationAdminScreen`, `journaliser`, `DashboardGlobalScreen`, `CreditsFournisseursScreen`, `supabase.js`, `ModifierInventaireScreen`, `PointShiftScreen`, `DashboardScreen`, `app/journal.js`, `ParametresScreen`, `litigeContacts.js`, `DocumentsScreen`, `verification.js`, `VentesScreen`, `verificateur.js`, `comparaisonDashboard.js`, `CorrectionPointScreen`, `creerNotification`, `selectionner-journee.js`, `choix-date.js`, `accueil.js`, `ContactsScreen`, `DeductionsGerantScreen`, `litiges.js`, `login.js`, `notifications.js`, `RecapPointScreen`, `dashboard.js`, `dashboard-global.js`, `gestion-stock.js`, `FournisseursScreen`, `ChargesScreen`, `presences.js`, `VerificateurScreen`, `AccueilScreen`, `credits-fournisseurs.js`, `equipe.js`, `ThemeContext.js`, `LivraisonsScreen`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **Why does `useApp()` connect `useApp` to `LitigesScreen`, `InventaireScreen`, `lib/contrats.js`, `BrouillonsFournisseursScreen`, `DepensesScreen`, `rapportMensuel.js`, `rh.js`, `ModifierPointScreen`, `VerificationScreen`, `stats-caissiers.js`, `RHScreen`, `demandes-admin.js`, `avis-plateformes.js`, `DemandesExplicationAdminScreen`, `journaliser`, `CreditsFournisseursScreen`, `supabase.js`, `PointShiftScreen`, `DashboardScreen`, `app/journal.js`, `ParametresScreen`, `litigeContacts.js`, `DocumentsScreen`, `verification.js`, `VentesScreen`, `verificateur.js`, `CorrectionPointScreen`, `creerNotification`, `selectionner-journee.js`, `choix-date.js`, `accueil.js`, `ContactsScreen`, `DeductionsGerantScreen`, `litiges.js`, `login.js`, `notifications.js`, `RecapPointScreen`, `dashboard.js`, `FournisseursScreen`, `ChargesScreen`, `presences.js`, `VerificateurScreen`, `AccueilScreen`, `credits-fournisseurs.js`, `equipe.js`, `ThemeContext.js`, `useTheme`, `LivraisonsScreen`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `expo-router` connect `supabase.js` to `rapportMensuel.js`, `expo`, `ModifierPointScreen`, `rh.js`, `explore.tsx`, `stats-caissiers.js`, `demandes-admin.js`, `avis-plateformes.js`, `useApp`, `journaliser`, `ModifierInventaireScreen`, `app/journal.js`, `litigeContacts.js`, `verification.js`, `verificateur.js`, `creerNotification`, `selectionner-journee.js`, `choix-date.js`, `accueil.js`, `ContactsScreen`, `login.js`, `litiges.js`, `notifications.js`, `dashboard.js`, `dashboard-global.js`, `gestion-stock.js`, `presences.js`, `credits-fournisseurs.js`, `equipe.js`, `ThemeContext.js`, `useTheme`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _534 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `LitigesScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.08385744234800839 - nodes in this community are weakly interconnected._
- **Should `exportRapportMensuel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11059907834101383 - nodes in this community are weakly interconnected._
- **Should `InventaireScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.10663983903420524 - nodes in this community are weakly interconnected._