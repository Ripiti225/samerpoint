# Recrutement et contrats signés — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** circuit complet demande d'embauche (gérant) → validation (RH) → contrat généré depuis un modèle fixe →
signature au doigt (gérant + travailleur) → « Signé » (RH), branché sur l'écran Contrats existant.

**Architecture :**
- Logique métier dans des modules purs testés avec `node:test` : `lib/recrutement.js`, `lib/modelesContrat.js`,
  `lib/baremes.js` et `lib/contrats.js`.
- Accès base regroupés dans `lib/contratsSignesDb.js`. PDF construit par jsPDF dans `lib/pdfContrat.js`.
- Le texte du contrat est une liste de blocs produite par `construireContrat(donnees)`. Elle sert à la fois à
  l'aperçu à l'écran et au PDF : un seul texte, deux rendus.
- La signature est stockée en **traits vectoriels** (JSON), dessinée en SVG à l'écran et en lignes jsPDF dans le
  PDF. Aucune conversion d'image, aucune dépendance native.

**Tech Stack :** Expo 54 / React Native Web, Supabase (clé anon, RLS ouvert), jsPDF 4, react-native-svg 15,
PanResponder.

**Conception :** `docs/superpowers/specs/2026-10-14-recrutement-contrats-signes-design.md`

## Global Constraints

- Interface et messages en français courant, sans code technique.
- Dates choisies au calendrier (`ChampDate`), jamais tapées.
- Fichiers dans le bucket `photos` uniquement (via `uploadFichier` de `lib/api.js`).
- PDF avec jsPDF et `normaliserPourPdf` (`lib/pdfTexte.js`) sur toute chaîne. Jamais expo-print.
- Requêtes de liste : `.range(0, 4999)` (troncature silencieuse à 1000 lignes).
- `journaliser(...).catch(() => {})` et `creerNotification(...).catch(() => {})` : ne bloquent jamais.
- Pas de nouvelle dépendance native, donc publication OTA uniquement. Ne jamais lancer `expo start` ou localhost.
- Seuls les contrats `statut = 'signe'` comptent : jauge, alertes, désactivation, `contratAffiche`.
- Modules purs : jamais d'horloge interne, la date du jour est passée en paramètre.
- Après chaque tâche : `npm test` vert, `npx eslint <fichiers touchés>` sans erreur, puis commit conventionnel
  en français.

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase_recrutement_contrats_signes.sql` (créé) | Migration idempotente |
| `lib/contrats.js` (modifié) | Paliers 7/3/1, `contratsSignes()`, statuts de contrat |
| `lib/recrutement.js` (créé) | Demande : champs, manquants, doublons, statuts |
| `lib/baremes.js` (créé) | Clé de poste, barème applicable, comparaison |
| `lib/modelesContrat.js` (créé) | Marques, nombres et dates en lettres, champs requis, `construireContrat` |
| `lib/cachetsContrat.js` (créé) | Cachets « M. Adou Eric JC » en base64 (Samer, Al Kayan) |
| `lib/pdfContrat.js` (créé) | Blocs + logo + cachet + signature → PDF (base64) |
| `lib/contratsSignesDb.js` (créé) | Toutes les écritures base du circuit + notifications + journal |
| `components/contrats/PadSignature.js` (créé) | Cadre de signature au doigt (SVG + PanResponder) |
| `components/contrats/ApercuContrat.js` (créé) | Rendu RN des blocs + signature SVG |
| `components/contrats/FormulaireDemande.js` (créé) | Formulaire gérant (création / correction) |
| `components/contrats/FeuilleDemandeRH.js` (créé) | Vérifier / accepter / refuser une demande |
| `components/contrats/FormulaireGeneration.js` (créé) | Type, durée, montants, champs manquants → générer |
| `components/contrats/FeuilleSignature.js` (créé) | Lecture → signature / refus / papier → téléchargement |
| `components/contrats/FeuilleBaremes.js` (créé) | Liste et édition du barème |
| `app/recrutement.js` (créé) | Écran gérant : *Mes demandes* / *Contrats à faire signer* |
| `app/contrats.js` (modifié) | Files RH, génération, renouvellement, filtrage `signe` |
| `components/FicheContrat.js` (modifié) | PDF signé, pas de suppression d'un contrat généré, « Renouveler » → génération |
| `lib/menus.js`, `context/NotificationsContext.js` (modifiés) | Tuile `recrutement`, routes des notifications |
| `supabase/functions/rappel-contrats/index.ts` (modifié) | Paliers 7/3/1, uniquement `signe`, gérant inclus |

---

### Task 1 : Migration SQL

**Files :** Create `supabase_recrutement_contrats_signes.sql`

**Produces :** colonnes et tables utilisées par toutes les tâches suivantes.

- [ ] **Step 1 : écrire la migration** (idempotente : `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
  blocs `DO $$` sur `pg_constraint`).
  - `travailleurs` + `civilite text`, `nom_famille text`, `prenoms text`, `date_naissance date`,
    `lieu_naissance text`, `nationalite text`, `situation_famille text`, `lieu_residence text`, `cni_numero text`,
    `nni_numero text`, `piece_identite_urls text[] NOT NULL DEFAULT '{}'`.
  - `demandes_travailleurs` :
    - `id`, `restaurant_id` (FK), les mêmes champs d'identité que ci-dessus ;
    - `poste`, `salaire_journalier int`, `date_embauche date`, `contact text` ;
    - `photo_url text NOT NULL`, `papiers_urls text[] DEFAULT '{}'` ;
    - `statut text NOT NULL DEFAULT 'envoyee' CHECK (statut IN ('envoyee','acceptee','refusee'))` ;
    - `motif_refus`, `historique_refus jsonb DEFAULT '[]'`, `doublon_travailleur_id uuid`, `travailleur_id uuid` ;
    - `cree_par uuid`, `cree_par_nom`, `traite_par uuid`, `traite_par_nom`, `traite_le timestamptz`,
      `created_at`, `updated_at` ;
    - RLS `allow_all`, comme le reste.
  - `baremes_postes` :
    - `id`, `cle_poste text`, `poste text`, `famille text CHECK (famille IN ('stage','contrat'))` ;
    - `categorie text`, `salaire_categoriel int`, `prime_tenue int`, `indemnite_transport int`, `prime_journaliere int` ;
    - `UNIQUE (cle_poste, famille)`, `updated_at`, RLS `allow_all`.
  - `contrats_travailleurs` + :
    - `statut text NOT NULL DEFAULT 'signe' CHECK (statut IN ('a_signer','signe_a_verifier','signe','refuse','annule'))` ;
    - `demande_id uuid`, `modele text`, `donnees jsonb`, `signature_traits jsonb`, `pdf_signe_url text`,
      `papier_signe_url text` ;
    - `signe_le timestamptz`, `presente_par uuid`, `presente_par_nom text` ;
    - `motif_refus text`, `historique_refus jsonb DEFAULT '[]'` ;
    - `valide_par uuid`, `valide_le timestamptz`, `annule_le timestamptz`, `annule_motif text`, `envoye_le timestamptz`.
  - `ALTER COLUMN photo_url DROP NOT NULL`, et contrainte `contrat_preuve_si_signe` :
    `CHECK (statut <> 'signe' OR photo_url IS NOT NULL OR pdf_signe_url IS NOT NULL OR papier_signe_url IS NOT NULL)`.
  - Recréer `contrats_sans_chevauchement` avec `WHERE (statut = 'signe')`. Pour l'idempotence : `DROP` si la
    définition (`pg_get_constraintdef`) ne contient pas `statut`, puis `ADD`.
  - Index unique partiel `contrat_un_seul_en_attente` sur `(travailleur_id)` `WHERE statut IN ('a_signer','signe_a_verifier','refuse')`.
  - `roles_acces` : ajouter `'recrutement'` en tête des tuiles du rôle `gerant` s'il n'y est pas
    (`UPDATE … SET tuiles = array_prepend('recrutement', tuiles) WHERE role='gerant' AND NOT ('recrutement' = ANY(tuiles))`).
    Vérifier d'abord le type de la colonne `tuiles` : `text[]` ou `jsonb`.
- [ ] **Step 2 :** lire la migration en entier une seconde fois (noms de colonnes identiques à ce tableau).
- [ ] **Step 3 :** commit `feat(contrats): migration recrutement + contrats signés`.

### Task 2 : `lib/contrats.js` — paliers et statuts

**Files :** Modify `lib/contrats.js`, `lib/contrats.test.mjs`

**Produces :**
- `PALIERS_ALERTE = [7, 3, 1]`
- `STATUTS_SIGNATURE = ['a_signer','signe_a_verifier','signe','refuse','annule']`
- `contratsSignes(contrats) → contrats` : garde `statut` absent ou `'signe'`
- `estGenere(contrat) → bool` : `!!contrat?.modele`

- [ ] **Step 1 : tests en échec** :
  - `PALIERS_ALERTE` vaut `[7,3,1]` ;
  - `palierAEnvoyer` à J-5 renvoie 7, à J-2 renvoie 3, à J-1 renvoie 1, à J-0 renvoie 1 si 1 n'est pas envoyé ;
  - `contratsSignes` exclut `a_signer`, `refuse` et `annule` et garde `undefined` et `signe` ;
  - adapter les tests existants qui supposent 15.
- [ ] **Step 2 :** `npm test`, constater l'échec.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm test`, tout vert.
- [ ] **Step 5 :** commit.

### Task 3 : `lib/recrutement.js`

**Files :** Create `lib/recrutement.js`, `lib/recrutement.test.mjs`

**Produces :**
- `CIVILITES = ['M.', 'Mme']`, `SITUATIONS_FAMILLE = ['Célibataire','Marié(e)','Divorcé(e)','Veuf(ve)']`
- `STATUTS_DEMANDE_TRAV = { envoyee, acceptee, refusee }` (label, emoji, couleur)
- `manquantsDemande(form) → { bloquants: string[], incomplets: string[] }`
  - bloquants : photo, nom de famille, prénoms, poste ;
  - incomplets : civilité, date de naissance, lieu de naissance, nationalité, situation de famille,
    pièce d'identité (CNI ou NNI), lieu de résidence, téléphone, date d'embauche, salaire journalier.
- `normaliserTelephone(s)` : chiffres seuls, sans indicatif `225`/`00225`, garde les 10 derniers.
- `normaliserPiece(s)` : majuscules, sans espaces ni séparateurs.
- `trouverDoublon(form, travailleurs) → travailleur | null` : CNI, NNI ou téléphone égaux après normalisation,
  en ignorant les valeurs vides.
- `nomComplet({ nom_famille, prenoms }) → 'GBADIE Gogre Tanguy'` : nom en majuscules, prénoms tels quels.
- `peutRenvoyer(demande) → statut === 'refusee'`

- [ ] **Step 1 : tests en échec** pour chaque fonction. Cas obligatoires :
  - `+225 07 08 11 11 18` = `0708111118` ;
  - CNI `ci 0078 797 05` = `CI007879705` ;
  - aucun doublon sur deux téléphones vides ;
  - photo absente = bloquant ;
  - lieu de naissance absent = incomplet seulement.
- [ ] **Step 2 :** constater l'échec.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** tout vert.
- [ ] **Step 5 :** commit.

### Task 4 : `lib/baremes.js`

**Files :** Create `lib/baremes.js`, `lib/baremes.test.mjs`

**Produces :**
- `clePoste(poste)` : minuscules, sans accents, trim, espaces réduits, suffixes `/re` `/se` `(e)` retirés.
  « Caissière » et « Caissier/re » donnent toutes deux `caissier`.
- `familleDe(type) → 'stage' | 'contrat'`
- `baremePour(baremes, poste, type) → ligne | null`
- `montantsDepuisBareme(ligne, type) → { categorie, salaire_categoriel, prime_tenue, indemnite_transport }` ou `{ prime_journaliere }`
- `differeDuBareme(ligne, montants, type) → bool`

- [ ] **Step 1 : tests en échec** :
  - `clePoste` sur les vrais postes de la base (« Caissier/re », « Caissière  », « Aide cuisinière  »,
    « Serveur/se », « Plongeuse  », « Gérant  ») ;
  - `baremePour` stage contre CDD ;
  - `differeDuBareme` sur une prime de tenue changée.
- [ ] **Step 2 :** constater l'échec.
- [ ] **Step 3 :** implémenter. Règle à retenir : ramener le féminin `-ière` à `-ier` et `-euse` à `-eur`
  (aide cuisinière = aide cuisinier, plongeuse = plongeur).
- [ ] **Step 4 :** tout vert.
- [ ] **Step 5 :** commit.

### Task 5 : `lib/modelesContrat.js` — les trois textes

**Files :** Create `lib/modelesContrat.js`, `lib/modelesContrat.test.mjs`

**Produces :**
- `MARQUES_CONTRAT = { samer: {...}, alkayan: {...} }`, avec `etablissement`, `siege`, `adresse_postale`,
  `telephone` et `representant: 'M. ZREIK SAMER'`, `qualite_representant: 'Gérant'`.
- `nombreEnLettres(n)` (0 à 999 999, français, « un », « vingt et un », « quatre-vingts », « cent »)
- `dureeEnLettres(mois) → 'trois mois (03 mois)'`
- `dateEnLettres(iso) → '1er mai 2026'` ; `montantFCFA(n) → '75 000 F CFA'` (espace normal)
- `CHAMPS_REQUIS = { Stage: [...], CDD: [...], CDI: [...] }` avec libellés FR ;
  `champsManquantsContrat(type, donnees) → string[]` (libellés)
- `construireContrat(donnees) → { titre, blocs }`, où un bloc vaut
  `{ t: 'entete' | 'titre' | 'para' | 'gras' | 'article' | 'puces' | 'signatures', texte?, items? }`.
- `donnees` :
  - `{ type, marque, civilite, nom_famille, prenoms, date_naissance, lieu_naissance, nationalite,
    situation_famille, cni_numero, nni_numero, lieu_residence, telephone, poste, categorie, date_debut, date_fin,
    duree_mois, salaire_categoriel, prime_tenue, indemnite_transport, prime_journaliere, date_signature }` ;
  - `date_signature` est absente tant que le contrat n'est pas signé : le texte affiche alors
    « Fait en double exemplaire à Abidjan le ____ ».

Textes à reproduire mot pour mot, avec les fautes d'orthographe des originaux corrigées :
- **CDD** : `~/Downloads/alkayan tanguy cdd.pdf`, articles 1 à 10. Le paragraphe « Entre » prend la marque.
  La ligne « représenté par M. ZREIK SAMER, Gérant » est ajoutée sous le siège. Le règlement intérieur
  « du restaurant <ETABLISSEMENT> ».
- **CDI** : le CDD sans la phrase de renouvellement, sans l'article 7 (renumérotation 1 à 9). L'article 2 devient
  « Le présent contrat est conclu pour une durée indéterminée et prend effet à compter du <date> ».
- **Stage** : `~/Downloads/stage1.pdf`, articles 1 à 9. Engagement « en qualité de STAGIAIRE pour un stage de
  qualification ». Rémunération « prime journalière de stage de <montant> ». Durée « <durée> renouvelable. A
  partir du <début> jusqu'au <fin>. Cependant, l'ensemble des renouvellements ne devra pas dépasser douze (12)
  mois. »
- « Monsieur » / « Madame » selon la civilité ; « Désigné » / « Désignée ».

- [ ] **Step 1 : tests en échec** :
  - `nombreEnLettres` : 1, 3, 12, 21, 71, 80, 81, 99, 100, 200, 1000, 75000 ;
  - `dureeEnLettres(3)` = `'trois mois (03 mois)'` et `dureeEnLettres(12)` = `'douze mois (12 mois)'` ;
  - `dateEnLettres('2026-05-01')` = `'1er mai 2026'` ;
  - `construireContrat` CDD Al Kayan : le texte joint contient « AL KAYAN », « YOPOUGON MAROC », « CAISSIER »,
    « 75 000 F CFA », « 3 031 F CFA », « 30 000 F CFA », « trois mois (03 mois) », « 1er mai 2026 »,
    « 31 juillet 2026 », « ZREIK SAMER » et « Gérant ». Aucun `undefined`, aucun `null`, aucun `[`.
  - CDI : ni « 3% » ni « renouvelable », mais « durée indéterminée ».
  - Stage Chez Samer : « STAGIAIRE », « prime journalière », « 3 000 F CFA », « RIVIERA PALMERAIE ».
  - Civilité Mme : « Madame » et « Désignée ».
  - `champsManquantsContrat('CDD', {...sans lieu_naissance})` contient « Lieu de naissance ».
  - Stage sans `salaire_categoriel` : rien ne manque ; stage sans `prime_journaliere` : il manque quelque chose.
- [ ] **Step 2 :** constater l'échec.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** tout vert.
- [ ] **Step 5 :** commit.

### Task 6 : cachets + PDF

**Files :**
- Create `lib/cachetsContrat.js`, `lib/pdfContrat.js`, `lib/pdfContrat.test.mjs`
- Create `scripts/cachets-contrat.sh` : régénère le base64 depuis les JPG, en réduisant avec `sips -Z 600`

**Produces :**
- `CACHET_CONTRAT_SAMER`, `CACHET_CONTRAT_KAYAN` : data URL JPEG.
- `cachetContrat(marque) → dataURL | null`
- `genererPdfContrat({ donnees, signature, jsPDF? }) → Promise<{ base64, nomFichier }>`
  - `signature` = `{ traits: [[x,y],…][], largeur, hauteur }` ou null ;
  - `jsPDF` est injectable pour les tests ;
  - logo `LOGO_SAMER` ou `LOGO_KAYAN` en haut à gauche ;
  - blocs avec retour à la ligne (`splitTextToSize`) et saut de page ;
  - en bas : « LE TRAVAILLEUR (Lu et approuvé) » avec les traits mis à l'échelle dans un cadre de 60 × 25 mm,
    et « L'EMPLOYEUR » avec le cachet (55 mm de large).
- `nomFichierContrat(donnees) → 'Contrat_CDD_GBADIE_Gogre_2026-05-01.pdf'`

- [ ] **Step 1 : test en échec** (node, avec `import { jsPDF } from 'jspdf'`). Le PDF généré :
  - commence par `%PDF` ;
  - fait plus de 2 pages pour un CDD ;
  - contient le texte « CONTRAT DE TRAVAIL A DUREE DETERMINEE » (option `compress: false` en test).
- [ ] **Step 2 :** constater l'échec.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** tout vert.
- [ ] **Step 5 :** commit.

### Task 7 : `lib/contratsSignesDb.js`

**Files :** Create `lib/contratsSignesDb.js`

**Consumes :** tâches 2 à 6.

**Produces :** toutes les fonctions sont `async` et lèvent une `Error` dont le message est en français.
- `chargerDemandes({ restaurantId? })`, `envoyerDemande(form, { userId, userNom, restaurant })`,
  `corrigerEtRenvoyer(demande, form, ctx)`
- `accepterDemande(demande, { salaire_journalier, reutiliser }, ctx) → travailleur` : crée la fiche, ou réactive
  `doublon_travailleur_id` ; copie l'identité et les papiers (`documents_travailleurs`).
- `refuserDemande(demande, motif, ctx)`
- `chargerBaremes()`, `enregistrerBareme(poste, type, montants)`
- `completerFiche(travailleurId, champs)`
- `genererContrat({ travailleur, type, duree_mois, date_debut, date_fin, montants, marque, demandeId }, ctx)` :
  insère `a_signer` avec `donnees` figées, puis notifie le gérant.
- `corrigerContratRefuse(contrat, champs, ctx)` : nouveau gel, puis retour à `a_signer`.
- `annulerContrat(contrat, motif, ctx)`
- `signerContrat(contrat, traits, ctx)` : génère le PDF signé, le téléverse dans `photos/contrats/`, passe à
  `signe_a_verifier` et notifie la RH. Renvoie `{ base64, nomFichier }` pour le téléchargement.
- `deposerPapierSigne(contrat, photoUrl, ctx)`
- `refuserSignature(contrat, motif, ctx)`
- `marquerSigne(contrat, ctx)` :
  - passe à `signe`, `valide_par` / `valide_le` ;
  - `photo_url` = `pdf_signe_url` ou `papier_signe_url`, et `photo_type` selon le cas ;
  - ajoute une ligne `documents_travailleurs` (type « Contrat ») ;
  - met à jour `travailleurs.type_contrat`.
- `televerserBase64(base64, mime, dossier) → url` :
  - web : `Blob`, `URL.createObjectURL`, puis `uploadFichier` ;
  - natif : `File(Paths.cache)`, puis `uploadFichier(file.uri)`.
- Notifications :
  - `cible_role ['manager','directeur','rh']` avec `screen 'contrats'` ;
  - `cible_role ['gerant']` avec `restaurant_id` et `screen 'recrutement'`.
- Chaque transition appelle `journaliser('CONTRAT_…' | 'DEMANDE_TRAV_…')`.

- [ ] **Step 1 :** implémenter (accès base, pas de test unitaire : la logique testable est dans les tâches 2 à 6).
- [ ] **Step 2 :** `npx eslint lib/contratsSignesDb.js`.
- [ ] **Step 3 :** commit.

### Task 8 : composants signature et aperçu

**Files :** Create `components/contrats/PadSignature.js`, `components/contrats/ApercuContrat.js`

**Produces :**
- `<PadSignature onChange={(traits) => …} couleur hauteur={220} />` :
  - PanResponder et `Svg` / `Path` ;
  - points relatifs au cadre ; un trait de moins de 2 points est ignoré ;
  - expose `effacer()` par `ref` (`forwardRef` + `useImperativeHandle`).
- `<ApercuContrat contrat={{ titre, blocs }} signature={traits|null} styles colors />` : fond blanc, police
  serif, lisible en mode sombre.
- `traitsVersPath(traits) → string` (export pur, testé dans `lib/recrutement.test.mjs`, pas besoin de RN).

- [ ] **Step 1 :** implémenter.
- [ ] **Step 2 :** lint.
- [ ] **Step 3 :** commit.

### Task 9 : écran gérant `app/recrutement.js`

**Files :**
- Create `app/recrutement.js`, `components/contrats/FormulaireDemande.js`, `components/contrats/FeuilleSignature.js`
- Modify `lib/menus.js` : tuile `{ id: 'recrutement', icon: '🧑‍🍳', titre: 'Nouveau travailleur', sous: 'Demandes & contrats à signer', route: '/recrutement' }`,
  ajoutée en tête de `ACCES_DEFAUT.gerant`.
- Modify `context/NotificationsContext.js` : ROUTE_MAP avec `demande_trav_refusee` / `demande_trav_acceptee` /
  `contrat_a_signer` vers `recrutement`, et `demande_trav_nouvelle` / `contrat_signe_a_verifier` /
  `contrat_refuse` vers `contrats`.

Comportement :
- Thème `useEcranModerne('orange')`, `EnTete`, et `Puces` pour les deux onglets.
- **Mes demandes** : cartes (photo, nom, poste, statut, motif de refus). Bouton « + Nouveau travailleur »
  vers `FormulaireDemande`.
- **FormulaireDemande** :
  - photo du travailleur avec `usePhoto().prendrePhoto('recrutement')` (obligatoire) ;
  - papiers facultatifs, plusieurs possibles ;
  - champs du §3 de la conception ; dates par `ChampDate` ; civilité et situation de famille par `Puces` ;
  - avant l'envoi : `manquantsDemande`. Un bloquant affiche une alerte et bloque. Un incomplet affiche
    « Informations incomplètes : … » avec deux boutons, « Compléter » et « Envoyer quand même »
    (deux boutons au plus, cf. mémoire web-alert) ;
  - un doublon détecté affiche un avertissement (ne bloque pas).
- **Contrats à faire signer** : contrats `a_signer` du restaurant, ouvrant `FeuilleSignature`.
- **FeuilleSignature** :
  1. `ApercuContrat` en lecture ; le bouton « J'ai lu, signer » apparaît en bas du défilement ;
  2. `PadSignature` avec Effacer et « Signer et valider » ;
  3. écran de fin avec « Télécharger le PDF » (`enregistrer(nomFichier, { base64 }, 'application/pdf')`) ;
  4. deux actions secondaires : « Le travailleur refuse » (motif obligatoire) et « Signer sur papier »
     (télécharge le PDF non signé, puis photo obligatoire du papier).

- [ ] **Step 1 :** implémenter.
- [ ] **Step 2 :** lint, puis `npx expo export -p web` pour vérifier que l'écran compile.
- [ ] **Step 3 :** commit.

### Task 10 : écran RH `app/contrats.js`

**Files :**
- Modify `app/contrats.js`, `components/FicheContrat.js`
- Create `components/contrats/FeuilleDemandeRH.js`, `components/contrats/FormulaireGeneration.js`,
  `components/contrats/FeuilleBaremes.js`

Comportement :
- **Chargement** : `contrats` = `contratsSignes(tous)` pour tout l'existant (lignes, jauge, compteurs, fiche).
  `enAttente` = les autres statuts sauf `annule`.
- **Bloc « À traiter »** au-dessus de la jauge, n'apparaît que s'il n'est pas vide. Trois rangées :
  - « Demandes à valider (n) » ;
  - « Signés, à vérifier (n) » ;
  - « Refusés par le travailleur (n) ».
  - Plus une ligne discrète « En attente de signature (n) ».
- **FeuilleDemandeRH** :
  - photos (cliquables, plein écran par `Linking.openURL`), identité, manquants, doublon éventuel ;
  - salaire journalier modifiable ;
  - Accepter, puis la question « Générer un contrat maintenant ? » (Oui / Plus tard) ;
  - Refuser avec motif obligatoire.
- **FormulaireGeneration** (`travailleur`, `contratsExistants`, `contratRefuse?`) :
  - type par `Puces` ; durée (`DUREES_MOIS` + libre) sauf CDI ;
  - date de début : stage = `date_embauche`, verrouillée et expliquée ; sinon `debutParDefaut` ;
  - montants pré-remplis par `baremePour` ;
  - section « À compléter » avec les champs de la fiche manquants (`champsManquantsContrat`), modifiables sur
    place ;
  - bouton « Générer et envoyer au gérant », désactivé tant qu'il manque quelque chose ;
  - si les montants diffèrent du barème : question « Retenir ces montants pour tous les <poste> ? » (Oui / Non) ;
  - un bouton « Aperçu » ouvre `ApercuContrat`.
- **Bouton flottant** : « + Nouveau contrat » ouvre un choix « Générer un contrat » ou « Enregistrer un contrat
  papier » (flux actuel), deux boutons.
- **Lien « Barème des postes »** sous la jauge, qui ouvre `FeuilleBaremes`.
- **FicheContrat** :
  - « Renouveler » ouvre `FormulaireGeneration` (le flux papier reste dans le choix ci-dessus) ;
  - « Voir le PDF » pour un contrat `pdf_signe_url` ;
  - pas de bouton Supprimer pour un contrat `estGenere` ;
  - les contrats en attente du travailleur sont listés avec leur statut et « Annuler » (motif).
- **Vérification** : un contrat `signe_a_verifier` ouvre une feuille PDF / photo avec « Marquer signé ».

- [ ] **Step 1 :** implémenter.
- [ ] **Step 2 :** lint et `npx expo export -p web`.
- [ ] **Step 3 :** commit.

### Task 11 : Edge Function `rappel-contrats`

**Files :** Modify `supabase/functions/rappel-contrats/index.ts`

- [ ] **Step 1 :**
  - `PALIERS = [7, 3, 1]` ;
  - requête `.eq('statut', 'signe')` ;
  - titres « Fin de contrat dans 7 jours », « dans 3 jours » et « demain » ;
  - `screen: 'contrats'` pour l'administration ; notification gérant ouvrant `recrutement` (onglet contrats) ;
  - `ROLES_ADMIN` inchangé (`manager`, `directeur`, `rh`).
- [ ] **Step 2 :** commit.
- [ ] **Step 3 (avec accord explicite de l'utilisateur, action en production) :**
  - `supabase functions deploy rappel-contrats --no-verify-jwt --project-ref wlwotzxnzowbkbfcpnyi` ;
  - programmer `cron.schedule('rappel-contrats-quotidien', '0 7 * * *', …)` sur Samtrackly ;
  - supprimer la copie `rappel-contrats` du projet POS `vbsmxwlxlcgkodwkbhfa`.

### Task 12 : vérification finale

- [ ] `npm test` : 0 échec.
- [ ] `npm run lint` : 0 erreur.
- [ ] `npx expo export -p web` : OK.
- [ ] Relire la conception section par section et cocher chaque exigence.
- [ ] Migration à passer par l'utilisateur, puis vérification par sondes REST (colonnes, contrainte, tuile
  gérant).
- [ ] Mettre à jour la mémoire ; `graphify update .` ; commit et push. Publication Vercel + EAS seulement sur feu
  vert.
