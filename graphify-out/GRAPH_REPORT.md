# Graph Report - samtrackly  (2026-09-16)

## Corpus Check
- 220 files · ~349,339 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2195 nodes · 4675 edges · 215 communities (141 shown, 74 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8457f152`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- LitigesScreen
- exportRapportMensuel.js
- InventaireScreen
- app/contrats.js
- BrouillonsFournisseursScreen
- DepensesScreen
- rapportMensuel.js
- expo
- ModifierPointScreen
- VerificationScreen
- explore.tsx
- stats-caissiers.js
- RHScreen
- creerNotification
- avis-plateformes.js
- api.js
- Backlog — features à venir (demandées le 2026-07-10)
- pdfDocuments.js
- RecapVerifications.js
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
- journaliser
- deductionsVerification.js
- dependencies
- Gestion des contrats de travail (RH)
- AppProvider
- Écran Contrats autonome — design
- DocumentsScreen
- DeductionsGerantScreen
- gestion-stock.js
- Le POS Samer alimente Samtrackly — bascule des caissiers, site par site
- Architecture
- offlineQueue.js
- Architecture
- offlineCache.js
- Avis clients Yango & Glovo — mise en service
- useApp
- photoQueue.js
- litiges.js
- supabase_avis_plateformes.sql
- points_shifts
- ingest-reviews/index.ts
- Web Push (PWA) — mise en route
- supabase_migrations_all.sql
- CorrectionPointScreen
- constants.js
- Structure des fichiers
- Périmètre
- Le pont pousse aussi l'inventaire — POS Samer → Samtrackly
- demandes-explication.js
- scripts
- Plan de durcissement sécurité — Edge Functions (option 1)
- sauvegarderShift
- Structure des fichiers
- rappel-contrats/index.ts
- ContactsScreen
- VentesScreen
- public.points_shifts
- Pont inventaire POS → Samtrackly — Implementation Plan
- RecapPointScreen
- recap-point.js
- expo-dev-client
- contactsParCaissier.js
- dashboard.js
- livraisons.js
- dashboard-global.js
- devDependencies
- tsconfig.json
- reset-project.js
- expo-constants
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
- equipe.js
- expo-device
- demandes.js
- expo-file-system
- expo-font
- lib/corbeille.js
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
- parametres.js
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
- ChoixDateScreen
- renderModeGlobal
- Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?
- accueil.js
- chargerComparaison
- rapportHebdo.js
- verification.js
- Global Constraints
- public.points_shifts
- FournisseursScreen
- Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?
- onedrive.js
- Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?
- expo
- public.points_shifts
- expo-document-picker
- choisirPhoto
- Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire
- uploaderFichierPapier
- decisionInventaire.js
- public.decider_ecart_inventaire_atomique
- expo-haptics
- ThemeProvider
- @shopify/react-native-skia

## God Nodes (most connected - your core abstractions)
1. `useTheme()` - 104 edges
2. `useApp()` - 82 edges
3. `InventaireScreen()` - 72 edges
4. `journaliser()` - 64 edges
5. `LitigesScreen()` - 60 edges
6. `supabase` - 58 edges
7. `VerificationScreen()` - 57 edges
8. `expo-router` - 50 edges
9. `creerNotification()` - 45 edges
10. `ModifierPointScreen()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `ParametresScreen()` --calls--> `setThemeMode()`  [EXTRACTED]
  app/parametres.js → context/ThemeContext.js
- `sauvegarderCorrectionCommandes()` --calls--> `corrigerNbCommandes()`  [EXTRACTED]
  app/verification.js → lib/litigeContacts.js
- `ouvrirDecisionCloturePOS()` --calls--> `decisionEcartShiftPOS()`  [EXTRACTED]
  app/verification.js → lib/ecartPOS.js
- `TabLayout()` --indirect_call--> `HapticTab()`  [INFERRED]
  app/(tabs)/_layout.tsx → components/haptic-tab.tsx
- `SessionGuard()` --calls--> `useApp()`  [EXTRACTED]
  app/_layout.tsx → context/AppContext.js

## Import Cycles
- None detected.

## Communities (215 total, 74 thin omitted)

### Community 0 - "LitigesScreen"
Cohesion: 0.10
Nodes (44): fmt(), fmtShort(), formDateDefaut(), LitigesScreen(), chargerAvis(), chargerDatesAvec(), chargerDeducVerifResto(), chargerEcarts() (+36 more)

### Community 1 - "exportRapportMensuel.js"
Cohesion: 0.11
Nodes (57): DetailProduit(), exporter(), formaterMontantSigneFCFA(), chargerDetailProduit(), exporterDetailPdf(), exporterDetailXlsx(), fetchPagine(), formaterDateFr() (+49 more)

### Community 2 - "InventaireScreen"
Cohesion: 0.11
Nodes (69): InventaireScreen(), aExplicationKey(), analyserSourceStock(), appliquerOverrideVerif(), chargerLignes(), chargerOuCreer(), chargerStockInitial(), darinaEnt() (+61 more)

### Community 3 - "app/contrats.js"
Cohesion: 0.08
Nodes (59): ContratsScreen(), badge(), charger(), contratsDe(), enregistrerContrat(), messageErreur(), ouvrirFiche(), pied() (+51 more)

### Community 4 - "BrouillonsFournisseursScreen"
Cohesion: 0.23
Nodes (14): BrouillonsFournisseursScreen(), charger(), confirmerIgnorer(), confirmerIgnorerLot(), grouperParPoint(), quitterSelection(), reinjecter(), retirerDuBrouillon() (+6 more)

### Community 5 - "DepensesScreen"
Cohesion: 0.10
Nodes (18): DepensesScreen(), ajouterLigne(), enregistrer(), saveDepensesGerant(), setLibelle(), setMontant(), supprimerLigne(), totalCategorie() (+10 more)

### Community 6 - "rapportMensuel.js"
Cohesion: 0.09
Nodes (52): buildRapport(), fmt(), formatDateFr(), FORMATS, getDimanche(), getLundi(), makeStyles(), MoisCard() (+44 more)

### Community 7 - "expo"
Cohesion: 0.05
Nodes (41): backgroundColor, foregroundImage, adaptiveIcon, googleServicesFile, package, permissions, versionCode, projectId (+33 more)

### Community 8 - "ModifierPointScreen"
Cohesion: 0.12
Nodes (36): makeStyles(), ModifierPointScreen(), afficherToast(), beneficeSC(), calculerVenteShift(), chargerDepGerant(), chargerDetailShift(), chargerPoint() (+28 more)

### Community 9 - "VerificationScreen"
Cohesion: 0.07
Nodes (33): makeStyles(), VerificationScreen(), appliquerDeltaFond(), changerResto(), chargerPointsResto(), confirmerAnnulationDeduction(), confirmerAnnulationMachine(), confirmerRefusCloturePOS() (+25 more)

### Community 10 - "explore.tsx"
Cohesion: 0.11
Nodes (23): styles, styles, TabLayout(), ExternalLink(), Props, HapticTab(), ParallaxScrollView(), Props (+15 more)

### Community 11 - "stats-caissiers.js"
Cohesion: 0.16
Nodes (25): CaissierCard(), dateDepuis(), DetailLigne(), EcartBadge(), EcartDetail(), fmt(), fmtPct(), formatDate() (+17 more)

### Community 12 - "RHScreen"
Cohesion: 0.14
Nodes (28): makeStyles(), RHScreen(), archiverTravailleur(), chargerArchives(), chargerDonnees(), chargerHistoriqueTravailleur(), dedupPresences(), exporterExcel() (+20 more)

### Community 13 - "creerNotification"
Cohesion: 0.18
Nodes (12): DemandesAdminScreen(), charger(), confirmerDeclin(), confirmerValidation(), demanderValidation(), estFinanciere(), executerAnnulation(), soumettreCreation() (+4 more)

### Community 14 - "avis-plateformes.js"
Cohesion: 0.18
Nodes (24): AvisPlateformes(), charger(), confirmerRattachement(), onRefresh(), Badge(), etoiles(), fmtDate(), makeStyles() (+16 more)

### Community 15 - "api.js"
Cohesion: 0.19
Nodes (20): getOrCreatePoint(), getRestaurants(), majPresenceExistante(), saveDepenses(), saveInventaireShift(), saveOnePresence(), saveOneTransactionFournisseur(), savePointShiftData() (+12 more)

### Community 16 - "Backlog — features à venir (demandées le 2026-07-10)"
Cohesion: 0.07
Nodes (29): ✅ 1. Congés futurs saisis par le RH — CODE FAIT (non déployé), ~~1. Congés futurs saisis par le RH~~ (spec d'origine), 2. Demandes d'explication — workflow avec suivi, ✅ 2. Demandes d'explication — workflow avec suivi — CODE FAIT (non déployé), 3. Gestion de stock (menu Manager & Admin), ✅ 3. Gestion de stock (menu Manager & Admin) — CODE FAIT (non déployé), 4. Textes PDF prédéfinis, 4. Textes PDF prédéfinis — ✅ FAIT (dans `lib/pdfDocuments.js`) (+21 more)

### Community 17 - "pdfDocuments.js"
Cohesion: 0.11
Nodes (23): DemandesExplicationScreen(), charger(), imprimerPdf(), resetForm(), soumettre(), uploaderReponse(), makeStyles(), RestaurantsScreen() (+15 more)

### Community 18 - "RecapVerifications.js"
Cohesion: 0.19
Nodes (13): makeStyles(), RecapVerificationsScreen(), makeStyles(), RecapVerifications(), charger(), enregistrerCorrection(), onRefresh(), ROLES_CORRECTION (+5 more)

### Community 19 - "Travailleurs & Utilisateurs par restaurant"
Cohesion: 0.08
Nodes (23): 🏪 Al Kayan KMS, 🏪 Al Kayan Yop, 🌍 Comptes globaux (manager / RH / directeur — sans restaurant), 🏪 Samer Angré 7E, 🏪 Samer Lavage, 🏪 Samer Maroc, 🏪 Samer Oasis, 🏪 Samer Palmeraie (+15 more)

### Community 20 - "DashboardGlobalScreen"
Cohesion: 0.11
Nodes (10): DashboardGlobalScreen(), calculerAlertesGlobal(), chargerPoints(), fmt(), formatDate(), getDateRange(), titrePeriode(), totalGlobal() (+2 more)

### Community 21 - "CreditsFournisseursScreen"
Cohesion: 0.12
Nodes (26): CreditsFournisseursScreen(), charger(), chargerHistorique(), chargerMois(), confirmerArchivage(), confirmerFixTous(), confirmerRemiseAZero(), exporterExcel() (+18 more)

### Community 22 - "supabase.js"
Cohesion: 0.12
Nodes (24): ONGLETS, SECTION_CONFIG, CATEGORIES, makeStyles(), CATS_DEPENSES, ONGLETS, DEMANDE_COLOR_DEFAULT, STATUT_COLORS (+16 more)

### Community 24 - "PointShiftScreen"
Cohesion: 0.11
Nodes (13): lireDraft(), PointShiftScreen(), chargerShiftsGerant(), chargerStatutInventaire(), gererPhoto(), selectionnerPhoto(), supprimerShift(), supprimerShiftsMultiples() (+5 more)

### Community 25 - "DashboardScreen"
Cohesion: 0.12
Nodes (12): DashboardScreen(), calculerAlertes(), chargerPoints(), confirmerPeriode(), fmt(), fmtFull(), formatDate(), formatDateLong() (+4 more)

### Community 26 - "app/journal.js"
Cohesion: 0.14
Nodes (20): CLES_MONTANT, EntryRow(), ErreurRow(), FILTRES, formatHeure(), formatRelative(), formatValeur(), JournalScreen() (+12 more)

### Community 27 - "ParametresScreen"
Cohesion: 0.15
Nodes (22): ParametresScreen(), ajouterDocument(), basculerRestaurant(), CarteBascule(), chargerComptesShifts(), chargerDocsTravailleur(), chargerDonnees(), chargerTousRestaurants() (+14 more)

### Community 28 - "litigeContacts.js"
Cohesion: 0.14
Nodes (31): chargerLitigesMois(), LITIGES_CATS, MOIS_NOMS, chargerEcartContacts(), chargerTousRestaurants(), sauvegarderCorrLitige(), sauvegarderCorrNbCommandes(), calculerLitigeContact() (+23 more)

### Community 29 - "journaliser"
Cohesion: 0.18
Nodes (18): DemandesExplicationAdminScreen(), accepter(), charger(), confirmerRefus(), confirmerRelance(), confirmerReponse(), imprimerPdf(), marquerEnvoyee() (+10 more)

### Community 30 - "deductionsVerification.js"
Cohesion: 0.12
Nodes (23): aujourdhui(), makeStyles(), VerificateurScreen(), changerResto(), chargerRestaurants(), chargerStock(), creerDemandeRH(), valider() (+15 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): expo-image, expo-linking, expo-sharing, expo-symbols, expo-web-browser, dependencies, exceljs, expo-image (+13 more)

### Community 32 - "Gestion des contrats de travail (RH)"
Cohesion: 0.10
Nodes (19): Automatisation, Bloc « Contrat » dans la fiche travailleur, Formulaire de contrat (modal), Gestion des contrats de travail (RH), Hors périmètre, Le fichier du contrat, Le statut n'est pas stocké, Limite connue : le PIN survit à la désactivation (+11 more)

### Community 33 - "AppProvider"
Cohesion: 0.19
Nodes (16): seDeconnecter(), AppProvider(), aDonneesSaisies(), beneficeSC(), deconnecter(), _execResetJour(), fc(), onPageHide() (+8 more)

### Community 34 - "Écran Contrats autonome — design"
Cohesion: 0.11
Nodes (18): Ajouter un contrat, Changements ailleurs, Durées de contrat, Décisions, Découpage des fichiers, Fiche d'un travailleur et actions, Hors périmètre, Interfaces (+10 more)

### Community 35 - "DocumentsScreen"
Cohesion: 0.19
Nodes (6): DocumentsScreen(), chargerDocuments(), resetForm(), sauvegarder(), supprimerDoc(), makeStyles()

### Community 36 - "DeductionsGerantScreen"
Cohesion: 0.15
Nodes (6): DeductionsGerantScreen(), chargerDonnees(), fmt(), gererPhoto(), sauvegarder(), makeStyles()

### Community 37 - "gestion-stock.js"
Cohesion: 0.22
Nodes (9): calcPreset(), CAT_ORDER, fmtDateCourt(), GestionStockScreen(), choisirPreset(), isoJour(), makeStyles(), PRESETS (+1 more)

### Community 38 - "Le POS Samer alimente Samtrackly — bascule des caissiers, site par site"
Cohesion: 0.11
Nodes (17): 10. Les contacts, 11. Points ouverts, 12. Résistance aux pannes, 13. Risque assumé, non traité, 14. Déploiement, 1. Le principe, 2. Ce qui existe déjà et qu'on réutilise, 3. Le fond de caisse — la règle intangible (+9 more)

### Community 39 - "Architecture"
Cohesion: 0.11
Nodes (16): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), Déploiement — TOUJOURS en mise à jour automatique, graphify, iOS Web Specifics (+8 more)

### Community 40 - "offlineQueue.js"
Cohesion: 0.18
Nodes (16): NetworkStatusBar(), styles, NetworkContext, NetworkProvider(), useNetwork(), setOnlineStatus(), clearIdMappings(), generateId() (+8 more)

### Community 41 - "Architecture"
Cohesion: 0.11
Nodes (16): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), Déploiement — TOUJOURS en mise à jour automatique, graphify, iOS Web Specifics (+8 more)

### Community 42 - "offlineCache.js"
Cohesion: 0.22
Nodes (16): getFournisseurs(), getTravailleurs(), getUtilisateurs(), getUtilisateursGlobaux(), cacheFournisseurs(), cachePoint(), cachePointData(), cacheRestaurants() (+8 more)

### Community 43 - "Avis clients Yango & Glovo — mise en service"
Cohesion: 0.17
Nodes (11): 1. Migration, 2. Secret + déploiement de la fonction, 3. Premier envoi de test, 4. Mapping des boutiques, Adaptations au schéma réel, Avis clients Yango & Glovo — mise en service, Ce qui a été construit, Ce qui n'est pas couvert (+3 more)

### Community 44 - "useApp"
Cohesion: 0.16
Nodes (12): GerantCaissierScreen(), makeStyles(), MENU, InactivityGuard(), PUBLIC_ROUTES, SessionGuard(), makeStyles(), SelectionJourneeScreen() (+4 more)

### Community 45 - "photoQueue.js"
Cohesion: 0.30
Nodes (11): ecrireFile(), EMPLACEMENTS_PHOTO, enfilerPhoto(), estPhotoDistante(), lireFile(), nouveauJeton(), PENDING_PREFIX, persister() (+3 more)

### Community 46 - "litiges.js"
Cohesion: 0.14
Nodes (19): CANAUX_AVIS, getPlage(), makeStyles(), ONGLETS, PERIODES, PRODUIT_TO_CAT, SHIFT_LABELS, TYPES_AVIS (+11 more)

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

### Community 53 - "constants.js"
Cohesion: 0.15
Nodes (12): FILTRES_STATUT, STATUT_CONFIG, STATUT_FILTRE_MAP, CATS_ENTREE, EXCLUS, PRODUITS_ENTREE, TYPES_SHIFTS, CATEGORIES_DEPENSES (+4 more)

### Community 54 - "Structure des fichiers"
Cohesion: 0.15
Nodes (12): Gestion des contrats de travail (RH) — Plan d'implémentation, Global Constraints, Structure des fichiers, Task 1 : Logique des contrats (`lib/contrats.js`), Task 2 : Migration SQL, Task 3 : Extraire l'upload de fichier (`lib/uploadFichier.js`), Task 4 : Formulaire de contrat (`components/FormulaireContrat.js`), Task 5 : Bloc « Contrat » dans la fiche travailleur (+4 more)

### Community 55 - "Périmètre"
Cohesion: 0.15
Nodes (12): 1. Le bouton (`app/verification.js`), 2. Le modal — réutilisé, avec un mode, 3. L'écriture en base — aucune migration, 4. Reverse dans Litiges — obligatoire, 5. Visibilité dans Litiges, 6. Notification gérant, Hors périmètre, Justifier un écart de vente machine sans toucher au fond (+4 more)

### Community 56 - "Le pont pousse aussi l'inventaire — POS Samer → Samtrackly"
Cohesion: 0.15
Nodes (12): 1. Ce qui existe déjà côté POS (vérifié le 2026-08-20), 2. Ce qui manque, 3. Où ça s'ajoute, 4. Correspondance des champs, 5. Idempotence, 6. Ce que ce chantier ne change PAS, 7. Migration Samtrackly, 8. Tests (+4 more)

### Community 57 - "demandes-explication.js"
Cohesion: 0.15
Nodes (16): fmtDateHeure(), STATUT_EXPLICATION, NotificationsContext, NotificationsProvider(), charger(), fermerPanel(), marquerUneCommeLue(), naviguerDepuisNotif() (+8 more)

### Community 58 - "scripts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, android, ios, lint, reset-project (+4 more)

### Community 59 - "Plan de durcissement sécurité — Edge Functions (option 1)"
Cohesion: 0.15
Nodes (12): Ce que ça NE fait pas, Contraintes à respecter (ne rien casser), Décisions à prendre avant de coder, Effort estimé, ⚠️ La menace qu'on traite, Le plus gros risque à régler en premier 🔴, Phasage, Phase 1 — Auth serveur légère + PIN hashés (fondation) (+4 more)

### Community 60 - "sauvegarderShift"
Cohesion: 0.28
Nodes (9): depensesToday(), laborCostMontant(), effacerDraft(), sauvegarderShift(), venteShift(), totalDepenses(), totalDepensesCat(), totalFournisseurs() (+1 more)

### Community 62 - "Structure des fichiers"
Cohesion: 0.17
Nodes (11): Global Constraints, Structure des fichiers, Task 1 : Migration — durées libres, Task 2 : Logique de sélection, de rang et de validation, Task 3 : Formulaire — durées libres, date de fin modifiable, mode correction, Task 4 : Sélecteur de travailleur, Task 5 : Fiche d'un travailleur et ses quatre actions, Task 6 : L'écran `/contrats` (+3 more)

### Community 63 - "rappel-contrats/index.ts"
Cohesion: 0.23
Nodes (8): Contrat, enCours(), finEffective(), joursRestants(), palierAEnvoyer(), PALIERS, ROLES_ADMIN, versUTC()

### Community 65 - "VentesScreen"
Cohesion: 0.06
Nodes (44): LoginScreen(), appuyerChiffre(), chargerUtilisateurs(), chargerUtilisateursGlobaux(), choisirRestaurant(), choisirUtilisateur(), fetchRestaurants(), getRoleBg() (+36 more)

### Community 67 - "Pont inventaire POS → Samtrackly — Implementation Plan"
Cohesion: 0.18
Nodes (10): Global Constraints, Pont inventaire POS → Samtrackly — Implementation Plan, Self-Review (fait avant de vous remettre ce plan), Step 1: Écrire les tests (ils doivent tous échouer au départ — le fichier `samtrackly-inventaire.ts` n'existe pas encore), Step 3: Écrire l'implémentation, Task 1: Migration Samtrackly — colonne d'idempotence, Task 2: Helper DELETE dans `samtrackly-api.ts`, Task 3: Module pur `samtrackly-inventaire.ts` (TDD) (+2 more)

### Community 68 - "RecapPointScreen"
Cohesion: 0.19
Nodes (15): beneficeToday(), ventesToday(), calcVariation(), makeStyles(), RecapPointScreen(), beneficeSCCalc(), confirmerValider(), fcCalc() (+7 more)

### Community 69 - "recap-point.js"
Cohesion: 0.29
Nodes (12): STATUT_COLORS, ORDRE_PRODUIT, envoyerNotifDemandeNouvelle(), envoyerNotifDemandeStatut(), envoyerNotifExplicationNouvelle(), envoyerNotifExplicationStatut(), envoyerNotifFactureCorrigee(), envoyerNotifNouveauTravailleur() (+4 more)

### Community 71 - "contactsParCaissier.js"
Cohesion: 0.28
Nodes (13): ouvrirPoint(), contactPris(), depuisCommandes(), depuisShiftsPOS(), detailContactsParCaissier(), ECART_ALERTE_COMMANDES, entierPositif(), estimerCommandesShift() (+5 more)

### Community 72 - "dashboard.js"
Cohesion: 0.19
Nodes (14): CATEGORIES_FOOD, chargerCouts(), chargerCoutsGlobal(), jaugeStyles, makeStyles(), PERIODES, PILIERS, { width } (+6 more)

### Community 73 - "livraisons.js"
Cohesion: 0.26
Nodes (9): LivraisonsScreen(), ajouterCommande(), sauvegarder(), sauvegarderEtQuitter(), supprimerCommande(), makeStyles(), VIDE, getCommandes() (+1 more)

### Community 74 - "dashboard-global.js"
Cohesion: 0.18
Nodes (10): CATEGORIES_FOOD, couleurResto(), courtNom(), familleResto(), jaugeStyles, makeStyles(), PERIODES, PIE_COLORS (+2 more)

### Community 75 - "devDependencies"
Cohesion: 0.22
Nodes (9): eslint, eslint-config-expo, devDependencies, eslint, eslint-config-expo, @types/react, typescript, @types/react (+1 more)

### Community 76 - "tsconfig.json"
Cohesion: 0.22
Nodes (8): expo/tsconfig.base, **/*.ts, **/*.tsx, compilerOptions, paths, strict, extends, include

### Community 77 - "reset-project.js"
Cohesion: 0.22
Nodes (7): exampleDirPath, fs, oldDirs, path, readline, rl, root

### Community 80 - "inventaires_shifts"
Cohesion: 0.32
Nodes (7): entrees_shift, inventaire_lignes, inventaires_shifts, fournisseurs, points, restaurants, utilisateurs

### Community 81 - "send-web-push/index.ts"
Cohesion: 0.29
Nodes (5): admin, cors, GLOBAL_ROLES, RESTO_ROLES, Sub

### Community 82 - "ChargesScreen"
Cohesion: 0.16
Nodes (14): ChargesScreen(), beneficeApresCharge(), beneficeReel(), chargerCharges(), chargerRestaurants(), recalculerBSC(), sauvegarder(), supprimerCharge() (+6 more)

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
Cohesion: 0.21
Nodes (10): HEURES, LigneSaisie(), LigneSaisieSimple(), makeStyles(), MINUTES, PhotoInput(), GROUPES_RESTAURANTS, makeStyles() (+2 more)

### Community 102 - "equipe.js"
Cohesion: 0.28
Nodes (6): EquipeScreen(), ouvrirProfil(), renderCard(), makeStyles(), STATUT_COLORS, TYPE_DOC_ICONS

### Community 104 - "demandes.js"
Cohesion: 0.39
Nodes (7): DemandesScreen(), charger(), resetForm(), soumettre(), fmtDate(), makeStyles(), STATUT_CONFIG

### Community 107 - "lib/corbeille.js"
Cohesion: 0.18
Nodes (17): CorbeilleScreen(), charger(), restaurer(), decrireContenu(), formatDatePoint(), formatHeure(), makeStyles(), archiverSuppressionShift() (+9 more)

### Community 135 - "parametres.js"
Cohesion: 0.13
Nodes (20): makeStyles(), sauvegarderRole(), SECTIONS, FormulaireTravailleur(), normaliserPoste(), POSTES, compterShiftsParRestaurant(), diagnosticBascule() (+12 more)

### Community 189 - "ChoixDateScreen"
Cohesion: 0.28
Nodes (6): ChoixDateScreen(), chargerDonneesPoint(), confirmer(), pointVientDuPOS(), makeStyles(), getSequences()

### Community 190 - "renderModeGlobal"
Cohesion: 0.36
Nodes (9): canalAvis(), couleurMontant(), genererEtPartagePDF(), ouvrirEditAvis(), plageLabel(), renderAvis(), renderModeGlobal(), restoSansLitige() (+1 more)

### Community 191 - "Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?, Source Nodes

### Community 192 - "accueil.js"
Cohesion: 0.11
Nodes (20): AccueilScreen(), activerPush(), makeStyles(), MenuCard(), useNotifications(), SPRINGS, staggerDelay(), ACCES_DEFAUT (+12 more)

### Community 193 - "chargerComparaison"
Cohesion: 0.67
Nodes (3): getDateMoisPrecedent(), getDateSemainePrecedente(), chargerComparaison()

### Community 194 - "rapportHebdo.js"
Cohesion: 0.39
Nodes (5): envoyerNotifRapportHebdo(), fmt(), formatDateFr(), getSemaine(), verifierEtGenererRapportHebdo()

### Community 195 - "verification.js"
Cohesion: 0.19
Nodes (11): STATUT_MACHINE, { width: SW }, LIBELLES_SHIFT, preparerEntreesVerification(), buildHtml(), fmt(), formatDate(), genererPdfEcarts() (+3 more)

### Community 196 - "Global Constraints"
Cohesion: 0.29
Nodes (6): Global Constraints, Task 1: Contrat métier pur des clôtures, Task 2: Stockage et affichage des clôtures, Task 3: Résumés mensuels et exports, Task 4: Vérification finale, Écart global des clôtures POS — Plan d'implémentation

### Community 199 - "FournisseursScreen"
Cohesion: 0.19
Nodes (19): FournisseursScreen(), choisirPhoto(), creditVeille(), enregistrerTout(), getTransaction(), prendrePhoto(), restedu(), saveFournisseur() (+11 more)

### Community 200 - "Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?, Source Nodes

### Community 201 - "onedrive.js"
Cohesion: 0.25
Nodes (14): gererConnexionOneDrive(), base64urlEncode(), connecterOneDrive(), deconnecterOneDrive(), estatConnecte(), generateChallenge(), generateVerifier(), genererExcelPoint() (+6 more)

### Community 202 - "Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?, Source Nodes

### Community 207 - "choisirPhoto"
Cohesion: 0.33
Nodes (10): executer(), gererPhotoRegul(), executer(), choisirPhotoProfil(), choisirPhotoResto(), choisirPhotoProfil(), executer(), traiterPhoto() (+2 more)

### Community 208 - "Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire, Source Nodes

### Community 209 - "uploaderFichierPapier"
Cohesion: 0.67
Nodes (4): choisirPDFPapier(), choisirPhotoPapier(), renderModalFormTravailleur(), uploaderFichierPapier()

## Knowledge Gaps
- **465 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+460 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **74 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useTheme()` connect `useTheme` to `LitigesScreen`, `InventaireScreen`, `app/contrats.js`, `BrouillonsFournisseursScreen`, `DepensesScreen`, `rapportMensuel.js`, `parametres.js`, `ModifierPointScreen`, `VerificationScreen`, `stats-caissiers.js`, `RHScreen`, `creerNotification`, `avis-plateformes.js`, `pdfDocuments.js`, `RecapVerifications.js`, `DashboardGlobalScreen`, `CreditsFournisseursScreen`, `supabase.js`, `ModifierInventaireScreen`, `PointShiftScreen`, `DashboardScreen`, `app/journal.js`, `ParametresScreen`, `litigeContacts.js`, `journaliser`, `deductionsVerification.js`, `DocumentsScreen`, `DeductionsGerantScreen`, `gestion-stock.js`, `useApp`, `litiges.js`, `CorrectionPointScreen`, `constants.js`, `demandes-explication.js`, `ChoixDateScreen`, `accueil.js`, `ContactsScreen`, `VentesScreen`, `verification.js`, `RecapPointScreen`, `recap-point.js`, `FournisseursScreen`, `dashboard.js`, `livraisons.js`, `dashboard-global.js`, `ChargesScreen`, `equipe.js`, `demandes.js`, `lib/corbeille.js`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Why does `useApp()` connect `useApp` to `LitigesScreen`, `InventaireScreen`, `app/contrats.js`, `BrouillonsFournisseursScreen`, `DepensesScreen`, `parametres.js`, `ModifierPointScreen`, `VerificationScreen`, `stats-caissiers.js`, `RHScreen`, `creerNotification`, `avis-plateformes.js`, `pdfDocuments.js`, `RecapVerifications.js`, `CreditsFournisseursScreen`, `supabase.js`, `PointShiftScreen`, `DashboardScreen`, `app/journal.js`, `ParametresScreen`, `litigeContacts.js`, `journaliser`, `deductionsVerification.js`, `DocumentsScreen`, `DeductionsGerantScreen`, `litiges.js`, `CorrectionPointScreen`, `constants.js`, `demandes-explication.js`, `ChoixDateScreen`, `accueil.js`, `ContactsScreen`, `VentesScreen`, `verification.js`, `RecapPointScreen`, `recap-point.js`, `FournisseursScreen`, `dashboard.js`, `livraisons.js`, `ChargesScreen`, `useTheme`, `equipe.js`, `demandes.js`, `lib/corbeille.js`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `expo-router` connect `supabase.js` to `app/contrats.js`, `rapportMensuel.js`, `expo`, `parametres.js`, `explore.tsx`, `stats-caissiers.js`, `avis-plateformes.js`, `RecapVerifications.js`, `app/journal.js`, `litigeContacts.js`, `gestion-stock.js`, `useApp`, `litiges.js`, `constants.js`, `demandes-explication.js`, `accueil.js`, `VentesScreen`, `verification.js`, `recap-point.js`, `dashboard.js`, `livraisons.js`, `dashboard-global.js`, `useTheme`, `equipe.js`, `demandes.js`, `lib/corbeille.js`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _465 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `LitigesScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.09696969696969697 - nodes in this community are weakly interconnected._
- **Should `exportRapportMensuel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11059907834101383 - nodes in this community are weakly interconnected._
- **Should `InventaireScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.1093167701863354 - nodes in this community are weakly interconnected._