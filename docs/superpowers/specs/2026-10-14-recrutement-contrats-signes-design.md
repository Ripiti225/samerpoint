# Recrutement et contrats signés dans l'application — conception

Date : 14/10/2026 · Validée avec l'utilisateur le 14/10/2026.
Étend le module Contrats existant (`docs/superpowers/specs/2026-08-18-contrats-travailleurs-design.md`,
`app/contrats.js`, table `contrats_travailleurs`). Aucun écran séparé, aucune seconde table de contrats.

## 1. Objectif

Aujourd'hui, un contrat est signé sur papier puis photographié par la RH. Demain :

1. le gérant **demande** l'embauche d'un nouveau travailleur depuis l'application ;
2. la RH ou un manager **valide** la demande, ce qui crée le travailleur ;
3. la RH **génère** le contrat à partir d'un modèle fixe ;
4. le gérant le **fait signer au doigt** sur son appareil ;
5. la RH **marque « Signé »**, et le contrat entre dans les contrats du travailleur.

La saisie d'un contrat papier en photo (flux actuel) reste possible.

## 2. Rôles

| Rôle | Peut |
|---|---|
| Gérant | Créer, corriger ou renvoyer une demande de travailleur pour **son** restaurant. Ouvrir un contrat à faire signer, le faire signer, noter un refus, utiliser le plan B papier, télécharger le PDF signé. Ne modifie jamais le contenu d'un contrat. |
| RH, manager | Accepter ou refuser une demande. Compléter la fiche. Générer, corriger ou renvoyer un contrat. Marquer « Signé ». Tenir le barème par poste. |
| Travailleur | Pas de compte. Lit et signe sur l'appareil du gérant. |

## 3. Demande de nouveau travailleur (gérant)

**Accès :** nouveau bouton **« Nouveau travailleur »** sur l'accueil du gérant. L'écran derrière a deux onglets :
*Mes demandes* et *Contrats à faire signer*.

**Formulaire :**
- civilité (M. / Mme), nom de famille, prénoms ;
- date de naissance (au calendrier, cf. ChampDate), lieu de naissance, nationalité ;
- situation de famille, lieu de résidence, téléphone ;
- numéro de pièce d'identité : CNI et/ou NNI ;
- poste, **salaire journalier proposé**, date d'embauche prévue (au calendrier) ;
- **photo du travailleur : OBLIGATOIRE** ;
- photo de la CNI (recto/verso) et autres papiers : facultatifs.

**Règles :**
- L'envoi est bloqué seulement sans photo du travailleur, sans nom, sans prénoms ou sans poste. Tout autre manque
  affiche « Informations incomplètes : <liste> » mais **laisse envoyer**.
- **Doublon :** si la CNI, le NNI ou le téléphone correspond à un travailleur existant (actif ou archivé), un
  avertissement s'affiche chez le gérant et chez la RH : « Ce travailleur existe déjà (ancien de <restaurant>) ».
- Envoi → statut `envoyee` → notification à la RH et aux managers.

**Statuts d'une demande :** `envoyee` → `acceptee` | `refusee`. Une demande `refusee` peut être corrigée par
le gérant puis renvoyée : elle repasse à `envoyee`, c'est la même ligne, et l'historique des refus est conservé.

## 4. Validation (RH / manager)

Dans l'écran Contrats, une file **« Demandes à valider »** s'affiche en haut.

- **Refuser :** motif obligatoire → `refusee` → notification au gérant avec le motif.
- **Accepter :**
  - si un doublon a été détecté et confirmé : **réactivation de l'ancienne fiche** (actif = true, restaurant mis à
    jour), sans création d'une seconde fiche ;
  - sinon : création de la fiche `travailleurs` dans le restaurant du gérant, avec `nom` = « NOM Prénoms »
    (format actuel conservé pour le reste de l'application) ;
  - le travailleur est **actif immédiatement** : équipe, pointage, descente POS ;
  - `salaire_journalier` = valeur proposée, corrigeable par la RH avant d'accepter ;
  - les photos et les champs d'identité sont copiés sur la fiche ;
  - notification au gérant : « Demande acceptée » ;
  - puis le message **« Générer un contrat maintenant ? »** apparaît. « Non » ne bloque rien : le contrat se
    génère plus tard depuis l'écran Contrats.
- La RH peut accepter une demande incomplète. La génération du contrat reste alors bloquée (§5).

## 5. Génération du contrat (RH / manager)

**Points d'entrée :**
- après acceptation d'une demande ;
- bouton **« Générer un contrat »** de l'écran Contrats, pour n'importe quel travailleur actif, y compris ceux
  déjà en poste sans contrat ;
- bouton **« Renouveler »** sur un contrat qui arrive à échéance (§9).

**Saisie :**
- type : Stage, CDD ou CDI ;
- durée en mois (pas pour un CDI) ;
- dates :
  - **Stage :** début = `date_embauche`, **non modifiable** ;
  - **CDD / CDI :** début = lendemain de la fin du contrat précédent, sinon `date_embauche` (règle actuelle
    `debutParDefaut`), modifiable ;
  - fin = calculée (règle actuelle `calculerDateFin`) ;
- rémunération, pré-remplie depuis le **barème du poste** (§6) et modifiable :
  - Stage : prime journalière ;
  - CDD / CDI : catégorie, salaire catégoriel, prime de tenue, indemnité de transport.

**Blocage :** le bouton « Générer » est désactivé tant qu'il manque une information indispensable au modèle.
Ce sont : civilité, nom, prénoms, date et lieu de naissance, nationalité, pièce d'identité, lieu de résidence,
téléphone, poste, et les montants du type choisi. L'écran dit lesquelles manquent, et la RH peut les compléter
sur place (enregistrées sur la fiche).

**Gel :** à la génération, toutes les valeurs utilisées sont **figées** dans le contrat (`donnees` JSONB).
Modifier ensuite la fiche ou le barème ne change pas un contrat déjà généré. Corriger un contrat refusé
régénère un nouveau gel.

Génération → statut `a_signer` → notification au gérant du restaurant : « Contrat à faire signer : <nom> ».

## 6. Barème par poste

Nouvelle table `baremes_postes` : une ligne par (poste, famille de contrat).

- `famille = 'stage'` : `prime_journaliere`.
- `famille = 'contrat'` (CDD et CDI) : `categorie`, `salaire_categoriel`, `prime_tenue`, `indemnite_transport`.

Mémorisation : quand la RH génère un contrat avec des montants différents du barème, une question lui est
posée : « Retenir ces montants pour tous les <poste> ? ». Si elle répond oui, le barème est mis à jour.
Le barème se consulte et se modifie aussi dans une petite liste de l'écran Contrats.

## 7. Modèles (fixes, dans le code)

Trois modèles écrits dans le code. La RH choisit, elle ne modifie pas.

| Modèle | Texte de base |
|---|---|
| **CDD** | Contrat Al Kayan « GBADIE Gogre Tanguy » du 30/04/2026 (10 articles : objet, durée, obligations, rémunération, horaire 8 h, rupture, indemnité de fin 3 %, règlement intérieur, confidentialité, maladie / accidents / CNPS). **Sans « net à payer ».** |
| **CDI** | Même texte que le CDD, **sans date de fin**, sans l'article « indemnité de fin de contrat » et sans la phrase de renouvellement. Durée « indéterminée ». **À faire relire par un juriste avant la première utilisation** — mention ajoutée dans l'écran tant que l'utilisateur ne l'a pas confirmé. |
| **Stage** | Contrat de stage de qualification Chez Samer (9 articles), poste « STAGIAIRE », rémunération = prime journalière. Plafond : renouvellements limités à 12 mois au total. |

**En-tête et employeur, selon la marque du restaurant** (`marquePourResto`, lib/logos.js) :

| | Chez Samer | Al Kayan |
|---|---|---|
| Établissement | CHEZ SAMER | AL KAYAN |
| Siège | Cocody Riviera Palmeraie Sodeci, 21 BP 915 Abidjan 21, tél. 22 49 75 12 | Yopougon Maroc, 21 BP 915 Abidjan 21, tél. 01 51 11 11 91 |
| Représentant | M. ZREIK SAMER, Gérant | M. ZREIK SAMER, Gérant |
| Logo | `LOGO_SAMER` (lib/logos.js) | `LOGO_KAYAN` (lib/logos.js) |
| Cachet employeur | `~/Downloads/cachet samer_0001.jpg` (« CHEZ SAMER – M. ADOU ERIC JC – Responsable administratif ») | `~/Downloads/cachet alk_0001.jpg` (« AL KAYAN – M. ADOU ERIC JC ») |

Les deux cachets « M. Adou Eric JC » sont nouveaux et propres aux contrats. Ils sont embarqués en base64 dans un
nouveau module, et le cachet existant `CACHET_SAMER` des autres documents RH n'est pas touché.

**Balises remplacées :** civilité, NOM, Prénoms, date et lieu de naissance, nationalité, situation de famille,
pièce d'identité (« CNI N° … ; NNI … »), lieu de résidence, téléphone, poste, catégorie, durée en lettres et
en chiffres (« trois mois (03 mois) »), dates de début et de fin en toutes lettres (« 1er mai 2026 »), montants
(« 75 000 F CFA »), et « Fait en double exemplaire à Abidjan le <date de signature> ».

**PDF :** construit avec **jsPDF** (jamais expo-print, cf. mémoire « expo-print inutile sur le web »). En bas :
« LE TRAVAILLEUR (Lu et approuvé) » avec la signature, et « L'EMPLOYEUR » avec le cachet.

## 8. Signature (gérant + travailleur)

L'onglet *Contrats à faire signer* du gérant contient le contrat en lecture complète, que le travailleur fait
défiler jusqu'en bas.

- **Signer :** grand cadre de signature au doigt, réalisé avec `react-native-svg` et les gestes déjà installés.
  Le cadre porte la mention « Lu et approuvé ». Boutons **Effacer** et **Signer et valider**.
  - La signature est enregistrée en PNG dans le bucket `photos`, seul bucket écrivable
    (cf. mémoire « Storage : bucket photos uniquement »).
  - Le PDF final, avec signature, cachet et date, est généré puis enregistré dans le même bucket.
  - L'application enregistre la date, l'heure et l'utilisateur gérant qui a présenté le contrat.
  - Statut → `signe_a_verifier` → notification à la RH et aux managers.
  - Écran de fin : bouton **« Télécharger le PDF »** (partage WhatsApp ou impression). Le PDF reste
    téléchargeable plus tard depuis la fiche.
- **Refus du travailleur :** motif obligatoire saisi par le gérant → `refuse` → notification à la RH. La RH
  corrige (§5, nouveau gel) et renvoie : retour à `a_signer`.
- **Plan B papier :** bouton « Signer sur papier ». Le gérant télécharge le PDF non signé, l'imprime, fait
  signer à la main, puis **photographie le papier signé** (photo obligatoire). La photo remplace la signature
  au doigt, et le statut passe aussi à `signe_a_verifier`.

Aucune nouvelle dépendance native : la publication se fait **par mise à jour OTA, sans nouveau build**.

## 9. Validation finale et intégration à l'existant

- File **« Signés à vérifier »** dans l'écran Contrats. La RH ouvre le PDF ou la photo, puis appuie sur
  **« Signé »** → statut `signe`.
- **Seul un contrat `signe` compte** : jauge « % sous contrat », compteurs, alertes de fin, historique dans la
  fiche, `contratAffiche`. Les autres statuts n'apparaissent que dans les files de travail et le suivi.
- Le PDF signé est rangé dans la fiche du travailleur, rubrique Contrats. **Aucune suppression possible.**
- Les contrats saisis à l'ancienne (photo d'un papier) sont créés directement en `signe`. Rien ne change pour
  eux.
- **Tableau de suivi :** la liste actuelle, avec les nouveaux statuts et les filtres restaurant, type, statut et
  période.

**Statuts d'un contrat :** `a_signer` → `signe_a_verifier` → `signe`, ou `a_signer` → `refuse` → (correction) →
`a_signer`. Une RH peut aussi **annuler** un contrat non signé (`annule`, motif obligatoire). Il reste visible
dans l'historique.

**Anti-chevauchement :** la contrainte `contrats_sans_chevauchement` ne doit porter que sur les contrats
`signe`. Un contrat à signer, refusé ou annulé ne bloque jamais des dates. Deux contrats non signés en même
temps pour un même travailleur sont interdits par l'application : il faut d'abord annuler l'autre.

## 10. Alertes de fin de contrat

- **Paliers : J-7, J-3 et la veille** (au lieu de 15/7/3), dans `lib/contrats.js` et dans l'Edge Function.
- **Destinataires :** RH, managers et gérant du restaurant.
- La notification ouvre le contrat, avec le bouton **« Renouveler »** (§5 : choix CDD / CDI, début = lendemain).
- **Réparation :** `rappel-contrats` est aujourd'hui déployée sur le **projet POS** (`vbsmxwlxlcgkodwkbhfa`) et
  **absente** de Samtrackly (`wlwotzxnzowbkbfcpnyi`). Aucune alerte n'est jamais partie. Ce chantier la déploie
  sur Samtrackly (`--project-ref wlwotzxnzowbkbfcpnyi`), programme son exécution quotidienne et retire la copie
  du projet POS. La migration de durée libre (`supabase_contrats_duree_libre.sql`) sera vérifiée au passage.

## 11. Données (une migration, à passer à la main)

- `travailleurs` + : `civilite`, `nom_famille`, `prenoms`, `date_naissance`, `lieu_naissance`, `nationalite`,
  `situation_famille`, `lieu_residence`, `cni_numero`, `nni_numero`, `piece_identite_urls` (text[]).
- Nouvelle table `demandes_travailleurs` : identité et propositions du gérant, `photo_url` (NOT NULL),
  `papiers_urls`, `restaurant_id`, `statut`, `motif_refus`, `historique_refus` (JSONB), `travailleur_id` (rempli
  à l'acceptation), `doublon_travailleur_id`, auteurs et horodatages.
- Nouvelle table `baremes_postes` (§6).
- `contrats_travailleurs` + :
  - `statut` (défaut `signe` pour l'existant) ;
  - `demande_id`, `modele`, `donnees` (JSONB figé) ;
  - `signature_url`, `pdf_signe_url`, `papier_signe_url` ;
  - `signe_le`, `presente_par`, `motif_refus`, `valide_par`, `valide_le`, `annule_le`, `annule_motif`.
- Contrainte : `photo_url NOT NULL` assouplie, car un contrat généré n'a pas de photo. Il faut une preuve pour
  passer à `signe` : photo, signature ou papier signé.
- Contrainte d'exclusion recréée avec `WHERE (statut = 'signe')`.
- La migration est idempotente et vérifiée après passage par sondes REST (cf. mémoire contrats-travailleurs).

## 12. Tests (node:test, `lib/*.test.mjs`)

- Remplissage des modèles : chaque balise remplacée ; aucune balise restante ; dates et durées en toutes lettres ;
  montants formatés ; en-tête selon la marque.
- Champs indispensables : liste des manquants par type de contrat.
- Transitions de statut autorisées et interdites, pour la demande et pour le contrat.
- Détection des doublons (CNI, NNI, téléphone ; normalisation des espaces et indicatifs).
- Dates : stage = date d'embauche ; renouvellement = lendemain.
- Paliers J-7 / J-3 / J-1.
- Seuls les contrats `signe` comptent dans la jauge et les alertes.

Avant publication : `npm run lint` sans erreur et tous les tests verts. Publication à la fin seulement, sur feu
vert de l'utilisateur (Vercel + EAS update).

## 13. Hors périmètre (lot suivant)

Signature de la RH et du gérant ; envoi WhatsApp ou email automatique ; QR code de vérification ; relance
automatique à 48 h d'un contrat non signé ; empreintes digitales ; modèles modifiables par la RH.
