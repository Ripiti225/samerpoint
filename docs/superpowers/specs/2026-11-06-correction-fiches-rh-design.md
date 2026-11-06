# Correction et complément des fiches travailleurs par la RH — conception

Date : 06/11/2026. Fait suite à la campagne `2026-10-29-mise-a-jour-fiches-contrats-design.md`.

## Besoin

Le manager, le directeur et la RH reçoivent des gérants les données des travailleurs (date d'embauche, nom, etc.), dans l'application ou ailleurs (WhatsApp, papier). Ils doivent pouvoir corriger ou compléter ces données sans repasser par le gérant.

## Constat au 06/11/2026

- Sur 140 travailleurs non archivés : 78 sans date d'embauche, 122 sans état civil complet ni CNI/NNI.
- Mises à jour de fiche : 37 à valider, 28 refusées. Une embauche à valider.
- `FeuilleMiseAJourRH` et `FeuilleDemandeRH` ne permettent que d'accepter ou de refuser.
- Équipe → ✏️ Modifier permet déjà de tout modifier, sauf le nom complet (`nomEditable={!edition}`).
- Le Suivi de campagne ne montre que des totaux par restaurant.
- 98 paies de gérant (349 000 F) n'ont pas de `travailleur_id` : `rattacherPaiesGerant` les relie à une fiche par le nom.
- Le POS relie ses comptes par `externe_id` (id de la fiche) et reprend le nom à la synchro. Vérifié sur la copie du Mac seulement : **à confirmer sur le master Windows**.

## Décisions de l'utilisateur

- Corriger à la validation **et** disposer d'une liste des fiches à compléter.
- Le nom complet suit automatiquement le nom de famille et les prénoms.
- Une fiche refusée peut être reprise et acceptée par la RH sans attendre le gérant.

## 1. Corriger avant d'accepter

**Écrans :** `FeuilleMiseAJourRH` et `FeuilleDemandeRH` reçoivent un bouton « ✏️ Corriger / compléter ». Il ouvre les champs communs : civilité, nom de famille, prénoms, date de naissance, lieu de naissance, nationalité, situation de famille, CNI, NNI, lieu de résidence, téléphone, date d'embauche. Les dates passent par `ChampDate`, conformément à la règle « jamais de date tapée ».

**Valeurs de départ :**
- Mise à jour : `formulaireCorrection(trav, demande)`, soit la fiche actuelle plus les champs remplis par le gérant.
- Embauche : les champs de la demande.

**Effet d'Accepter :**
- Les corrections remplacent les champs de la demande, en base et en mémoire, puis le circuit d'acceptation existant s'applique.
- Mise à jour : un champ vide n'efface jamais une valeur de la fiche. Vider un champ revient à écarter la valeur du gérant.
- Nom de famille et prénoms restent obligatoires quand les corrections sont ouvertes, dans les deux cas : la table `demandes_travailleurs` les exige (`NOT NULL`). Les autres champs vides sont enregistrés `NULL`, jamais `''` (une date vide ferait échouer l'écriture).

**Fiches refusées (mises à jour seulement) :**
- L'onglet Refusées ouvre `FeuilleMiseAJourRH`, sans le bouton Refuser.
- `accepterMiseAJour` réserve la demande sur le statut lu à l'ouverture (`.eq('statut', demande.statut)`). Si le gérant l'a renvoyée entre-temps, l'acceptation échoue avec un message clair.
- En cas d'échec d'écriture, la demande reprend ce statut d'origine, et non plus toujours `envoyee`.
- Une embauche refusée reste chez le gérant.

## 2. Onglet « À compléter »

**Emplacement :** nouvel onglet de `app/embauches.js`, entre Acceptées et Suivi, soumis au filtre restaurant existant.

**Contenu :** les travailleurs non archivés incomplets (`manquantsFiche`), ou dont la mise à jour est refusée. Chaque ligne indique le restaurant et « Manque : … ». Tri : les fiches où il manque le plus d'abord, puis par nom.

**Filtre :** une puce par donnée manquante avec son compte, par exemple « Date d'embauche (78) ». Seules les données réellement manquantes apparaissent. Les comptes respectent le filtre restaurant.

**Toucher une ligne :**
- Demande envoyée ou refusée en attente → `FeuilleMiseAJourRH`, pour ne pas saisir deux fois.
- Sinon → `ModalFormTravailleur` en édition, enregistrement immédiat sans validation.

Après enregistrement, la liste se recharge. Une fiche devenue complète en sort.

**Logique pure :** `fichesACompleter(travailleurs, demandes, { restaurantId, manque })` dans `lib/miseAJourFiches.js`, à partir de `listeEquipe`. Données : `chargerCampagne`, déjà paginé.

## 3. Nom complet

**Règle unique** (`nomSuivi(trav, nouveau)`, module pur) : le nom est recalculé avec `nomComplet` seulement si les trois conditions suivantes sont réunies :
1. `nom_famille` ou `prenoms` change par rapport à la fiche ;
2. les deux valeurs résultantes sont remplies ;
3. le résultat diffère de `trav.nom`.

Sinon `nom` ne bouge pas. Aucune fiche n'est donc renommée en masse, et enregistrer une fiche sans toucher à son identité ne change pas son nom.

**Appliquée à :** `fusionFiche` (acceptation d'une mise à jour) et `enregistrerTravailleur` en édition. Le commentaire et le test « `nom` n'est jamais modifié » sont remplacés. Le champ Nom complet du formulaire reste en lecture seule en édition.

**Avant → après :** `diffFiche` ajoute une ligne « Nom complet », et `ModalFormTravailleur` affiche le nouveau nom sous les champs dès qu'il change.

**Protection des anciennes paies**, avant tout renommage :
1. Lire les dépenses `categorie = 'Paie'`, `saisi_par = 'gerant'`, `travailleur_id` nul, dont le libellé correspond à l'ancien nom. Pagination obligatoire.
2. Choisir la fiche avec les règles de `rattacherPaiesGerant`, sur **tous** les travailleurs, archivés compris. Un homonyme ambigu laisse la paie intacte.
3. Écrire `travailleur_id` sur les paies retenues pour cette fiche.
4. Si ce rattachement échoue, le renommage est annulé et un message en français s'affiche.

Les présences passées gardent `travailleur_nom` (le nom de l'époque) et se rattachent déjà par identifiant.

## 4. Droits et traçabilité

**Droits :** manager, directeur et RH, comme `peutEditer` et l'accès à `embauches` aujourd'hui. Le gérant ne change pas de parcours : son envoi passe toujours par la validation.

**Journal** (`journaliser`, jamais bloquant) :
- `FICHE_TRAV_VALIDEE` : ajoute `corrections: [{ champ, envoye, retenu }]`.
- `DEMANDE_TRAV_ACCEPTEE` : ajoute les mêmes `corrections`.
- `FICHE_TRAV_MODIFIEE` (nouveau) : `changements: [{ champ, avant, apres }]` pour toute modification par `ModalFormTravailleur`, nom complet compris.
- Si des paies sont rattachées : leur nombre figure dans l'entrée.

## Hors périmètre

Saisie en masse, import de fichier, modification de la date de début d'un contrat déjà signé, reprise d'une embauche refusée, changement du formulaire des gérants, renommage rétroactif des fiches déjà incohérentes.

## Tests et vérification

**Tests purs (`lib/miseAJourFiches.test.mjs`) :**
- `nomSuivi` : changement, sans changement, valeur vide, résultat identique.
- `fusionFiche` : corrections, champ vidé, renommage.
- `fichesACompleter` : filtres, tri, refusées, archivés exclus.

**Rattachement des paies :** `rattacherPaiesGerant` est déjà pure et testée pour l'homonyme ; ajouter le cas de l'homonyme archivé dans `lib/equipe.test.mjs`.

**Avant publication :** `npm run lint` (0 erreur), tests `lib/*.test.mjs` (0 échec), export web.

**Contrôle côté Windows :** confirmer que le POS relie bien les comptes par `externe_id` et que la synchro reprend le nouveau nom.

## Publication

Aucune migration. Commit et push à chaque étape ; Vercel + EAS Update seulement quand tout est terminé, suivis du résumé en français simple.
