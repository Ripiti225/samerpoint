# Graph Report - samtrackly  (2026-09-05)

## Corpus Check
- 197 files · ~335,803 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2088 nodes · 4437 edges · 202 communities (132 shown, 70 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ca4a25ed`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- LitigesScreen
- exportRapportMensuel.js
- InventaireScreen
- app/contrats.js
- brouillons-fournisseurs.js
- DepensesScreen
- rapportMensuel.js
- expo
- ModifierPointScreen
- VerificationScreen
- explore.tsx
- useTheme
- RHScreen
- LoginScreen
- avis-plateformes.js
- api.js
- Backlog — features à venir (demandées le 2026-07-10)
- DemandesExplicationAdminScreen
- AppProvider
- Travailleurs & Utilisateurs par restaurant
- DashboardGlobalScreen
- CreditsFournisseursScreen
- verification.js
- dashboard.js
- point-shift.js
- DashboardScreen
- lib/journal.js
- ParametresScreen
- litigeContacts.js
- VentesScreen
- verificateur.js
- dependencies
- Gestion des contrats de travail (RH)
- offlineCache.js
- Écran Contrats autonome — design
- AccueilScreen
- notifications.js
- parallax-scroll-view.tsx
- Le POS Samer alimente Samtrackly — bascule des caissiers, site par site
- Architecture
- app/_layout.tsx
- Architecture
- sourcePoint.js
- Avis clients Yango & Glovo — mise en service
- demandes-admin.js
- offlineQueue.js
- litiges.js
- supabase_avis_plateformes.sql
- points_shifts
- ingest-reviews/index.ts
- Web Push (PWA) — mise en route
- supabase_migrations_all.sql
- CorrectionPointScreen
- DocumentsScreen
- Structure des fichiers
- Périmètre
- Le pont pousse aussi l'inventaire — POS Samer → Samtrackly
- journaliser
- scripts
- Plan de durcissement sécurité — Edge Functions (option 1)
- FournisseursScreen
- Structure des fichiers
- rappel-contrats/index.ts
- ContactsScreen
- erreursLisibles.js
- public.points_shifts
- Pont inventaire POS → Samtrackly — Implementation Plan
- stats-caissiers.js
- LivraisonsScreen
- expo-constants
- EquipeScreen
- DeductionsGerantScreen
- ModifierInventaireScreen
- dashboard-global.js
- devDependencies
- tsconfig.json
- reset-project.js
- usePhoto
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
- login.js
- SelectionJourneeScreen
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
- basculePOS.js
- renderModeGlobal
- parametres.js
- permissions
- extra
- generatePdf.js
- chargerRestaurantsContact
- expo-dev-client
- public.points_shifts
- external-link.tsx
- exceljs
- ios

## God Nodes (most connected - your core abstractions)
1. `useTheme()` - 99 edges
2. `useApp()` - 82 edges
3. `InventaireScreen()` - 72 edges
4. `journaliser()` - 62 edges
5. `LitigesScreen()` - 59 edges
6. `supabase` - 58 edges
7. `expo-router` - 50 edges
8. `VerificationScreen()` - 45 edges
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
- `TabLayout()` --indirect_call--> `HapticTab()`  [INFERRED]
  app/(tabs)/_layout.tsx → components/haptic-tab.tsx

## Import Cycles
- None detected.

## Communities (202 total, 70 thin omitted)

### Community 0 - "LitigesScreen"
Cohesion: 0.11
Nodes (40): fmt(), fmtShort(), formDateDefaut(), LitigesScreen(), chargerAvis(), chargerDeducVerifResto(), chargerEcarts(), chargerGlovo() (+32 more)

### Community 1 - "exportRapportMensuel.js"
Cohesion: 0.09
Nodes (65): calcPreset(), CAT_ORDER, DetailProduit(), fmtDateCourt(), GestionStockScreen(), choisirPreset(), exporter(), isoJour() (+57 more)

### Community 2 - "InventaireScreen"
Cohesion: 0.11
Nodes (70): InventaireScreen(), aExplicationKey(), analyserSourceStock(), appliquerOverrideVerif(), chargerLignes(), chargerOuCreer(), chargerStockInitial(), darinaEnt() (+62 more)

### Community 3 - "app/contrats.js"
Cohesion: 0.08
Nodes (58): ContratsScreen(), badge(), charger(), contratsDe(), enregistrerContrat(), messageErreur(), ouvrirFiche(), pied() (+50 more)

### Community 4 - "brouillons-fournisseurs.js"
Cohesion: 0.26
Nodes (12): BrouillonsFournisseursScreen(), confirmerIgnorer(), confirmerIgnorerLot(), grouperParPoint(), quitterSelection(), reinjecter(), retirerDuBrouillon(), derniersMois() (+4 more)

### Community 5 - "DepensesScreen"
Cohesion: 0.10
Nodes (18): DepensesScreen(), ajouterLigne(), enregistrer(), saveDepensesGerant(), setLibelle(), setMontant(), supprimerLigne(), totalCategorie() (+10 more)

### Community 6 - "rapportMensuel.js"
Cohesion: 0.12
Nodes (43): buildRapport(), fmt(), formatDateFr(), FORMATS, getDimanche(), getLundi(), makeStyles(), MoisCard() (+35 more)

### Community 7 - "expo"
Cohesion: 0.13
Nodes (14): expo, icon, name, orientation, owner, runtimeVersion, scheme, slug (+6 more)

### Community 8 - "ModifierPointScreen"
Cohesion: 0.12
Nodes (36): makeStyles(), ModifierPointScreen(), afficherToast(), beneficeSC(), calculerVenteShift(), chargerDepGerant(), chargerDetailShift(), chargerPoint() (+28 more)

### Community 9 - "VerificationScreen"
Cohesion: 0.10
Nodes (10): makeStyles(), VerificationScreen(), changerResto(), chargerPointsResto(), chargerRestaurants(), confirmerStatutMachine(), fermerCorrectionFacture(), LigneCorrigerFacture() (+2 more)

### Community 10 - "explore.tsx"
Cohesion: 0.19
Nodes (11): styles, TabLayout(), HapticTab(), Collapsible(), styles, IconMapping, IconSymbol(), IconSymbolName (+3 more)

### Community 11 - "useTheme"
Cohesion: 0.12
Nodes (27): LITIGES_CATS, MOIS_NOMS, ONGLETS, SECTION_CONFIG, CATEGORIES, STATUT_COLORS, TYPE_DOC_ICONS, GerantCaissierScreen() (+19 more)

### Community 12 - "RHScreen"
Cohesion: 0.13
Nodes (31): makeStyles(), RHScreen(), archiverTravailleur(), chargerArchives(), chargerDonnees(), chargerHistoriqueTravailleur(), choisirPDFPapier(), choisirPhotoPapier() (+23 more)

### Community 13 - "LoginScreen"
Cohesion: 0.21
Nodes (17): LoginScreen(), appuyerChiffre(), chargerUtilisateurs(), chargerUtilisateursGlobaux(), choisirRestaurant(), choisirUtilisateur(), fetchRestaurants(), getRoleBg() (+9 more)

### Community 14 - "avis-plateformes.js"
Cohesion: 0.18
Nodes (24): AvisPlateformes(), charger(), confirmerRattachement(), onRefresh(), Badge(), etoiles(), fmtDate(), makeStyles() (+16 more)

### Community 15 - "api.js"
Cohesion: 0.18
Nodes (20): getOrCreatePoint(), majPresenceExistante(), saveDepenses(), saveInventaireShift(), saveOnePresence(), saveOneTransactionFournisseur(), savePointShiftData(), savePresences() (+12 more)

### Community 16 - "Backlog — features à venir (demandées le 2026-07-10)"
Cohesion: 0.07
Nodes (29): ✅ 1. Congés futurs saisis par le RH — CODE FAIT (non déployé), ~~1. Congés futurs saisis par le RH~~ (spec d'origine), 2. Demandes d'explication — workflow avec suivi, ✅ 2. Demandes d'explication — workflow avec suivi — CODE FAIT (non déployé), 3. Gestion de stock (menu Manager & Admin), ✅ 3. Gestion de stock (menu Manager & Admin) — CODE FAIT (non déployé), 4. Textes PDF prédéfinis, 4. Textes PDF prédéfinis — ✅ FAIT (dans `lib/pdfDocuments.js`) (+21 more)

### Community 17 - "DemandesExplicationAdminScreen"
Cohesion: 0.07
Nodes (33): DemandesExplicationAdminScreen(), accepter(), charger(), confirmerRefus(), confirmerRelance(), confirmerReponse(), imprimerPdf(), marquerEnvoyee() (+25 more)

### Community 18 - "AppProvider"
Cohesion: 0.05
Nodes (56): ChoixDateScreen(), chargerDonneesPoint(), confirmer(), pointVientDuPOS(), makeStyles(), gererConnexionOneDrive(), calcVariation(), getDateMoisPrecedent() (+48 more)

### Community 19 - "Travailleurs & Utilisateurs par restaurant"
Cohesion: 0.08
Nodes (23): 🏪 Al Kayan KMS, 🏪 Al Kayan Yop, 🌍 Comptes globaux (manager / RH / directeur — sans restaurant), 🏪 Samer Angré 7E, 🏪 Samer Lavage, 🏪 Samer Maroc, 🏪 Samer Oasis, 🏪 Samer Palmeraie (+15 more)

### Community 20 - "DashboardGlobalScreen"
Cohesion: 0.11
Nodes (10): DashboardGlobalScreen(), calculerAlertesGlobal(), chargerPoints(), fmt(), formatDate(), getDateRange(), titrePeriode(), totalGlobal() (+2 more)

### Community 21 - "CreditsFournisseursScreen"
Cohesion: 0.15
Nodes (21): CreditsFournisseursScreen(), charger(), chargerHistorique(), confirmerArchivage(), confirmerFixTous(), confirmerRemiseAZero(), exporterExcel(), exporterPdf() (+13 more)

### Community 22 - "verification.js"
Cohesion: 0.11
Nodes (25): STATUT_MACHINE, confirmerAnnulationDeduction(), enregistrerRepartition(), ouvrirInventaire(), { width: SW }, annulerDeductionInventaire(), CATEGORIES_DEPENSES, CATEGORIES_INVENTAIRE (+17 more)

### Community 23 - "dashboard.js"
Cohesion: 0.19
Nodes (14): CATEGORIES_FOOD, chargerCouts(), chargerCoutsGlobal(), jaugeStyles, makeStyles(), PERIODES, PILIERS, { width } (+6 more)

### Community 24 - "point-shift.js"
Cohesion: 0.06
Nodes (39): CorbeilleScreen(), charger(), restaurer(), decrireContenu(), formatDatePoint(), formatHeure(), makeStyles(), depensesToday() (+31 more)

### Community 25 - "DashboardScreen"
Cohesion: 0.10
Nodes (16): DashboardScreen(), beneficeToday(), calculerAlertes(), chargerPoints(), confirmerPeriode(), fmt(), fmtFull(), formatDate() (+8 more)

### Community 26 - "lib/journal.js"
Cohesion: 0.13
Nodes (20): CATS_ENTREE, EXCLUS, PRODUITS_ENTREE, TYPES_SHIFTS, CLES_MONTANT, EntryRow(), ErreurRow(), FILTRES (+12 more)

### Community 27 - "ParametresScreen"
Cohesion: 0.14
Nodes (22): makeStyles(), ParametresScreen(), ajouterDocument(), chargerComptesShifts(), chargerDocsTravailleur(), chargerDonnees(), chargerTousRestaurants(), gererPhotoDoc() (+14 more)

### Community 28 - "litigeContacts.js"
Cohesion: 0.13
Nodes (31): chargerLitigesMois(), chargerEcartContacts(), chargerTousRestaurants(), sauvegarderCorrLitige(), sauvegarderCorrNbCommandes(), ouvrirPoint(), sauvegarderCorrectionCommandes(), calculerLitigeContact() (+23 more)

### Community 29 - "VentesScreen"
Cohesion: 0.17
Nodes (10): makeStyles(), VentesScreen(), allerAuRecap(), fmt(), gererPhoto(), PhotoBlock(), sauvegarderEtContinuer(), sauvegarderPhotosPoints() (+2 more)

### Community 30 - "verificateur.js"
Cohesion: 0.12
Nodes (20): makeStyles(), RecapVerificationsScreen(), aujourdhui(), makeStyles(), ORDRE_PRODUIT, VerificateurScreen(), changerResto(), chargerRestaurants() (+12 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): expo, expo-image, expo-linking, expo-sharing, expo-symbols, expo-web-browser, dependencies, expo (+13 more)

### Community 32 - "Gestion des contrats de travail (RH)"
Cohesion: 0.10
Nodes (19): Automatisation, Bloc « Contrat » dans la fiche travailleur, Formulaire de contrat (modal), Gestion des contrats de travail (RH), Hors périmètre, Le fichier du contrat, Le statut n'est pas stocké, Limite connue : le PIN survit à la désactivation (+11 more)

### Community 33 - "offlineCache.js"
Cohesion: 0.20
Nodes (18): getFournisseurs(), getRestaurants(), getTravailleurs(), getUtilisateurs(), getUtilisateursGlobaux(), cacheFournisseurs(), cachePoint(), cachePointData() (+10 more)

### Community 34 - "Écran Contrats autonome — design"
Cohesion: 0.11
Nodes (18): Ajouter un contrat, Changements ailleurs, Durées de contrat, Décisions, Découpage des fichiers, Fiche d'un travailleur et actions, Hors périmètre, Interfaces (+10 more)

### Community 35 - "AccueilScreen"
Cohesion: 0.11
Nodes (21): AccueilScreen(), activerPush(), NotificationsProvider(), charger(), fermerPanel(), marquerUneCommeLue(), naviguerDepuisNotif(), ouvrirPanel() (+13 more)

### Community 36 - "notifications.js"
Cohesion: 0.19
Nodes (19): DemandesScreen(), charger(), resetForm(), soumettre(), fmtDate(), makeStyles(), STATUT_CONFIG, sauvegarderTravailleur() (+11 more)

### Community 37 - "parallax-scroll-view.tsx"
Cohesion: 0.21
Nodes (10): styles, ParallaxScrollView(), Props, styles, styles, ThemedText(), ThemedTextProps, ThemedView() (+2 more)

### Community 38 - "Le POS Samer alimente Samtrackly — bascule des caissiers, site par site"
Cohesion: 0.11
Nodes (17): 10. Les contacts, 11. Points ouverts, 12. Résistance aux pannes, 13. Risque assumé, non traité, 14. Déploiement, 1. Le principe, 2. Ce qui existe déjà et qu'on réutilise, 3. Le fond de caisse — la règle intangible (+9 more)

### Community 39 - "Architecture"
Cohesion: 0.11
Nodes (16): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), Déploiement — TOUJOURS en mise à jour automatique, graphify, iOS Web Specifics (+8 more)

### Community 40 - "app/_layout.tsx"
Cohesion: 0.13
Nodes (15): InactivityGuard(), PUBLIC_ROUTES, SessionGuard(), seDeconnecter(), NetworkStatusBar(), styles, deconnecter(), verrouillerSession() (+7 more)

### Community 41 - "Architecture"
Cohesion: 0.11
Nodes (16): Activity Journal (`lib/journal.js`), Architecture, Commands, Constants (`lib/constants.js`), Database — Supabase (`lib/supabase.js`), Déploiement — TOUJOURS en mise à jour automatique, graphify, iOS Web Specifics (+8 more)

### Community 42 - "sourcePoint.js"
Cohesion: 0.38
Nodes (9): CHAMPS_REMPLIS_PAR_LE_POS, estRempliParLePOS(), estSurPOS(), peutSaisirVenteMachineManuellement(), ROLES_REPRIS_PAR_LE_POS, separerComptesPOS(), EQUIPE, venteMachineEstRecue() (+1 more)

### Community 43 - "Avis clients Yango & Glovo — mise en service"
Cohesion: 0.17
Nodes (11): 1. Migration, 2. Secret + déploiement de la fonction, 3. Premier envoi de test, 4. Mapping des boutiques, Adaptations au schéma réel, Avis clients Yango & Glovo — mise en service, Ce qui a été construit, Ce qui n'est pas couvert (+3 more)

### Community 44 - "demandes-admin.js"
Cohesion: 0.15
Nodes (15): DemandesAdminScreen(), charger(), confirmerDeclin(), confirmerValidation(), demanderValidation(), estFinanciere(), executerAnnulation(), soumettreCreation() (+7 more)

### Community 45 - "offlineQueue.js"
Cohesion: 0.26
Nodes (12): NetworkContext, NetworkProvider(), setOnlineStatus(), clearIdMappings(), getIdMappings(), getQueue(), getQueueSize(), patchArgs() (+4 more)

### Community 46 - "litiges.js"
Cohesion: 0.13
Nodes (18): CANAUX_AVIS, getPlage(), makeStyles(), ONGLETS, PERIODES, PRODUIT_TO_CAT, SHIFT_LABELS, TYPES_AVIS (+10 more)

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

### Community 57 - "journaliser"
Cohesion: 0.16
Nodes (22): relancer(), DemandesExplicationScreen(), charger(), imprimerPdf(), resetForm(), soumettre(), uploaderReponse(), fmtDateHeure() (+14 more)

### Community 58 - "scripts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, android, ios, lint, reset-project (+4 more)

### Community 59 - "Plan de durcissement sécurité — Edge Functions (option 1)"
Cohesion: 0.15
Nodes (12): Ce que ça NE fait pas, Contraintes à respecter (ne rien casser), Décisions à prendre avant de coder, Effort estimé, ⚠️ La menace qu'on traite, Le plus gros risque à régler en premier 🔴, Phasage, Phase 1 — Auth serveur légère + PIN hashés (fondation) (+4 more)

### Community 60 - "FournisseursScreen"
Cohesion: 0.11
Nodes (34): FournisseursScreen(), choisirPhoto(), creditVeille(), enregistrerTout(), getTransaction(), prendrePhoto(), restedu(), saveFournisseur() (+26 more)

### Community 62 - "Structure des fichiers"
Cohesion: 0.17
Nodes (11): Global Constraints, Structure des fichiers, Task 1 : Migration — durées libres, Task 2 : Logique de sélection, de rang et de validation, Task 3 : Formulaire — durées libres, date de fin modifiable, mode correction, Task 4 : Sélecteur de travailleur, Task 5 : Fiche d'un travailleur et ses quatre actions, Task 6 : L'écran `/contrats` (+3 more)

### Community 63 - "rappel-contrats/index.ts"
Cohesion: 0.23
Nodes (8): Contrat, enCours(), finEffective(), joursRestants(), palierAEnvoyer(), PALIERS, ROLES_ADMIN, versUTC()

### Community 65 - "erreursLisibles.js"
Cohesion: 0.47
Nodes (5): CAUSES, expliquerErreur(), messageCourt(), QUOI, regrouperErreurs()

### Community 67 - "Pont inventaire POS → Samtrackly — Implementation Plan"
Cohesion: 0.18
Nodes (10): Global Constraints, Pont inventaire POS → Samtrackly — Implementation Plan, Self-Review (fait avant de vous remettre ce plan), Step 1: Écrire les tests (ils doivent tous échouer au départ — le fichier `samtrackly-inventaire.ts` n'existe pas encore), Step 3: Écrire l'implémentation, Task 1: Migration Samtrackly — colonne d'idempotence, Task 2: Helper DELETE dans `samtrackly-api.ts`, Task 3: Module pur `samtrackly-inventaire.ts` (TDD) (+2 more)

### Community 68 - "stats-caissiers.js"
Cohesion: 0.33
Nodes (10): CaissierCard(), dateDepuis(), DetailLigne(), fmt(), fmtPct(), makeStyles(), PERIODES, StatsCaissiers() (+2 more)

### Community 69 - "LivraisonsScreen"
Cohesion: 0.27
Nodes (8): LivraisonsScreen(), ajouterCommande(), sauvegarder(), sauvegarderEtQuitter(), supprimerCommande(), makeStyles(), getCommandes(), saveCommandes()

### Community 71 - "EquipeScreen"
Cohesion: 0.40
Nodes (4): EquipeScreen(), ouvrirProfil(), renderCard(), makeStyles()

### Community 72 - "DeductionsGerantScreen"
Cohesion: 0.15
Nodes (6): DeductionsGerantScreen(), chargerDonnees(), fmt(), gererPhoto(), sauvegarder(), makeStyles()

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

### Community 78 - "usePhoto"
Cohesion: 0.33
Nodes (10): executer(), gererPhotoRegul(), executer(), choisirPhotoProfil(), choisirPhotoResto(), choisirPhotoProfil(), executer(), usePhoto() (+2 more)

### Community 80 - "inventaires_shifts"
Cohesion: 0.32
Nodes (7): entrees_shift, inventaire_lignes, inventaires_shifts, fournisseurs, points, restaurants, utilisateurs

### Community 81 - "send-web-push/index.ts"
Cohesion: 0.29
Nodes (5): admin, cors, GLOBAL_ROLES, RESTO_ROLES, Sub

### Community 82 - "ChargesScreen"
Cohesion: 0.21
Nodes (11): ChargesScreen(), beneficeApresCharge(), beneficeReel(), chargerCharges(), recalculerBSC(), sauvegarder(), supprimerCharge(), totalApresCharge() (+3 more)

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

### Community 100 - "login.js"
Cohesion: 0.16
Nodes (5): styles, SignatureFooter(), styles, SPRINGS, ROLES_GLOBAUX

### Community 102 - "SelectionJourneeScreen"
Cohesion: 0.33
Nodes (5): makeStyles(), SelectionJourneeScreen(), choisir(), restaurerPresencesDuJour(), getPresences()

### Community 189 - "basculePOS.js"
Cohesion: 0.31
Nodes (8): basculerRestaurant(), CarteBascule(), compterShiftsParRestaurant(), diagnosticBascule(), ETAT_BASCULE, nombre(), SAMTRACKLY, SUR_POS

### Community 190 - "renderModeGlobal"
Cohesion: 0.36
Nodes (9): canalAvis(), couleurMontant(), genererEtPartagePDF(), ouvrirEditAvis(), plageLabel(), renderAvis(), renderModeGlobal(), restoSansLitige() (+1 more)

### Community 191 - "parametres.js"
Cohesion: 0.10
Nodes (27): makeStyles(), MenuCard(), SECTIONS, MOTIFS_ARCHIVE, ONGLETS, PERIODES, STATUT_COLORS, FormulaireTravailleur() (+19 more)

### Community 192 - "permissions"
Cohesion: 0.15
Nodes (13): backgroundColor, foregroundImage, adaptiveIcon, googleServicesFile, package, permissions, versionCode, android (+5 more)

### Community 193 - "extra"
Cohesion: 0.29
Nodes (7): projectId, extra, eas, onedriveClientId, router, supabaseKey, supabaseUrl

### Community 194 - "generatePdf.js"
Cohesion: 0.39
Nodes (8): telechargerPdf(), telechargerPdfEcarts(), buildHtml(), fmt(), formatDate(), genererPdfEcarts(), genererPdfPoint(), photoVersBase64()

### Community 195 - "chargerRestaurantsContact"
Cohesion: 0.40
Nodes (5): chargerRestaurants(), chargerDatesAvec(), chargerRestaurants(), chargerUtilisateurs(), chargerRestaurantsContact()

### Community 199 - "external-link.tsx"
Cohesion: 0.40
Nodes (4): plugins, ExternalLink(), Props, expo-web-browser

### Community 201 - "ios"
Cohesion: 0.40
Nodes (5): ios, ITSAppUsesNonExemptEncryption, bundleIdentifier, infoPlist, supportsTablet

## Knowledge Gaps
- **445 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+440 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **70 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useTheme()` connect `useTheme` to `LitigesScreen`, `exportRapportMensuel.js`, `InventaireScreen`, `app/contrats.js`, `brouillons-fournisseurs.js`, `DepensesScreen`, `rapportMensuel.js`, `ModifierPointScreen`, `VerificationScreen`, `RHScreen`, `LoginScreen`, `avis-plateformes.js`, `DemandesExplicationAdminScreen`, `AppProvider`, `DashboardGlobalScreen`, `CreditsFournisseursScreen`, `verification.js`, `dashboard.js`, `point-shift.js`, `DashboardScreen`, `lib/journal.js`, `ParametresScreen`, `VentesScreen`, `verificateur.js`, `AccueilScreen`, `notifications.js`, `demandes-admin.js`, `litiges.js`, `CorrectionPointScreen`, `DocumentsScreen`, `journaliser`, `FournisseursScreen`, `parametres.js`, `ContactsScreen`, `stats-caissiers.js`, `LivraisonsScreen`, `EquipeScreen`, `DeductionsGerantScreen`, `ModifierInventaireScreen`, `dashboard-global.js`, `ChargesScreen`, `login.js`, `SelectionJourneeScreen`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `useApp()` connect `useTheme` to `LitigesScreen`, `InventaireScreen`, `app/contrats.js`, `brouillons-fournisseurs.js`, `DepensesScreen`, `ModifierPointScreen`, `VerificationScreen`, `RHScreen`, `LoginScreen`, `avis-plateformes.js`, `DemandesExplicationAdminScreen`, `AppProvider`, `CreditsFournisseursScreen`, `verification.js`, `dashboard.js`, `point-shift.js`, `DashboardScreen`, `lib/journal.js`, `ParametresScreen`, `VentesScreen`, `verificateur.js`, `AccueilScreen`, `notifications.js`, `app/_layout.tsx`, `demandes-admin.js`, `litiges.js`, `CorrectionPointScreen`, `DocumentsScreen`, `journaliser`, `FournisseursScreen`, `parametres.js`, `ContactsScreen`, `stats-caissiers.js`, `LivraisonsScreen`, `EquipeScreen`, `DeductionsGerantScreen`, `ChargesScreen`, `login.js`, `SelectionJourneeScreen`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `expo-router` connect `useTheme` to `exportRapportMensuel.js`, `app/contrats.js`, `brouillons-fournisseurs.js`, `rapportMensuel.js`, `explore.tsx`, `avis-plateformes.js`, `verification.js`, `dashboard.js`, `point-shift.js`, `lib/journal.js`, `verificateur.js`, `notifications.js`, `parallax-scroll-view.tsx`, `app/_layout.tsx`, `demandes-admin.js`, `litiges.js`, `journaliser`, `FournisseursScreen`, `parametres.js`, `stats-caissiers.js`, `external-link.tsx`, `dashboard-global.js`, `login.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _445 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `LitigesScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.10853658536585366 - nodes in this community are weakly interconnected._
- **Should `exportRapportMensuel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08663457978526472 - nodes in this community are weakly interconnected._
- **Should `InventaireScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.10663983903420524 - nodes in this community are weakly interconnected._