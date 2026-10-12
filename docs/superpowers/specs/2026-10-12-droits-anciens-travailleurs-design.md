# Droits des anciens travailleurs — conception

Date : 12/10/2026 · Validé avec l'utilisateur (QCM du 12/10).
S'appuie sur : `2026-10-12-fournisseurs-administratifs-design.md` (à terminer avant).

## But

Suivre, restaurant par restaurant, l'argent dû aux travailleurs partis (solde
de tout compte, droits de fin de contrat) : nom, date de départ, motif,
montant dû, et ce qui en a déjà été payé. Chaque droit se comporte comme un
**fournisseur administratif** : visible par le gérant (qui paie en caisse) et
par l'administration (direction, RH, manager).

## Décisions (QCM)

| Question | Réponse |
|---|---|
| Rangement | Une fiche par ancien travailleur |
| Nom | Choisi parmi les travailleurs archivés du restaurant, sinon tapé à la main |
| Motif | Liste d'archivage d'Équipe (Démission, Renvoi, Fin de contrat, Autre + texte) |
| Affichage | Onglet « Anciens travailleurs » dans Trésorerie → À payer, en plus des écrans administratifs |
| Archivage dans Équipe | Proposer de saisir les droits **seulement si le travailleur est en CDI** |
| Qui crée / modifie | RH et manager |
| Qui paie | Gérant en espèces de caisse (Déductions) + direction (À payer) |
| Résultat net | Compté au fil des paiements, rien à la création |

## Approche retenue

Une fiche = une ligne de `fournisseurs` de type `administratif`, sans échéance
automatique, marquée comme droit d'ancien travailleur. Tout le circuit des
administratifs est réutilisé (paiement gérant, paiement direction, crédits,
tuile Administrations, exclusion du caissier). Écartée : une table dédiée, qui
obligerait à refaire les paiements en caisse, direction et points.

## 1. Données (migration `supabase_droits_anciens_travailleurs.sql`, idempotente)

Colonnes ajoutées à `fournisseurs` :
- `depart_le date` — date à laquelle le travailleur a cessé de travailler.
  **Une fiche est un droit d'ancien travailleur si et seulement si
  `depart_le` est rempli** ;
- `depart_motif text` — motif (libellé de la liste ou texte libre) ;
- `travailleur_id` — lien facultatif vers `travailleurs.id`
  (`ON DELETE SET NULL` : supprimer définitivement le travailleur garde la fiche).
  Même type que `travailleurs.id`, à vérifier dans la base avant d'écrire la
  migration.

Contrainte : `depart_le IS NULL OR type = 'administratif'`.

À la création : `type = 'administratif'`, `nom` = nom du travailleur,
`restaurant_id`, `facture_mensuelle` NULL (aucune échéance), `credit_actuel = 0`,
puis le montant dû est posé par une écriture `ajustement_manager` (même chemin
que le crédit de départ des administratifs), datée du jour de saisie.

**Paiement en plusieurs fois** (précisé le 12/10) : chaque paiement, du gérant
ou de la direction, est une transaction à part sur la fiche ; on peut payer
une partie puis le reste plus tard, autant de fois qu'il faut. Le reste dû =
montant dû − somme des paiements.

Une fiche dont le crédit retombe à 0 est **soldée** : elle reste en base
(historique), sort des listes « restants ».

## 2. Trésorerie → À payer : onglet « Anciens travailleurs »

Visible pour les niveaux qui voient À payer (`voir_a_payer`) et pour le RH
(`saisie_rh`, qui crée les fiches).

- Liste groupée par restaurant (filtre restaurant habituel). Chaque ligne :
  nom, « parti le 12/09/2026 · Démission », reste dû en gros, barre
  payé / dû (dû = crédit de départ + corrections ; payé = somme des paiements).
- Interrupteur « Restants seulement » (activé par défaut), comme les autres
  onglets ; désactivé, les fiches soldées s'affichent avec la pastille
  « Soldé ».
- En tête : total restant dû pour la sélection.
- **« + Ancien travailleur »** (RH, manager) — feuille : restaurant (puces),
  travailleur (liste des archivés du restaurant + « Autre nom… » en saisie
  libre), date de départ (`ChampDate`, jamais tapée), motif (puces
  `MOTIFS_ARCHIVE`, texte si « Autre »), montant dû.
  Choisir un archivé pré-remplit la date (`archived_at`) et le motif
  (`archive_motif`), modifiables.
- **« Modifier »** (RH, manager) : nom, date, motif ; le montant dû se corrige
  par une écriture `ajustement_manager` de la différence (jamais d'écrasement
  de `credit_actuel`).
- **« Payer »** (direction), en une ou plusieurs fois : réutilise le paiement direction des
  administratifs (`tresorerie_payer_fournisseur_admin` : banque, espèces de la
  trésorerie ou coffre). Montant proposé = reste dû, modifiable à la baisse (paiement partiel) ;
  jamais plus que le reste.
- Ouvrir une fiche : la liste de tous ses paiements (date, montant,
  gérant/direction), le dû, le payé et le reste.

## 2 bis. Prévisions (demandé le 12/10)

Comme sur une dette, on peut **prévoir un paiement** sur un droit : montant +
date, ou prochaine réception d'un partenaire. Bouton « Prévoir un paiement »
sur la fiche (À payer → Anciens travailleurs) et groupe « Anciens
travailleurs » dans « Prévoir un paiement » de l'accueil Trésorerie (niveau
`payer`, comme les autres prévisions).

- `tresorerie_previsions.fournisseur_id` (et `du_id` devient facultatif ;
  exactement l'un des deux est rempli).
- Pour les prévisions seulement, chaque droit est vu comme une ligne de la
  Trésorerie (`droitsPourPrevisions`) : même calcul d'état (orange le jour
  venu), compté dans le « Prévu » retiré de la trésorerie nette. Ces lignes ne
  vont jamais dans les dus (déjà comptées comme fournisseurs).
- Réalisée par **tout** paiement du droit — gérant en caisse ou direction —
  fait à partir du jour de la prévision, la plus ancienne d'abord, sans
  dépasser son montant.
- « Payer » sur une prévision orange ouvre le paiement direction du droit ;
  toucher la ligne mène à l'onglet Anciens travailleurs.
- Une prévision « à la réception d'un partenaire » sur un droit ne déclenche
  pas la notification de réception (seules les lignes de la Trésorerie y sont).

## 3. Équipe → Archiver

Après l'archivage d'un travailleur dont `type_contrat = 'CDI'` : question
« Lui doit-on de l'argent ? » (deux vrais boutons, pas de menu Alert à 3
choix). « Oui » ouvre une petite feuille « Montant dû » ; la fiche est créée
avec nom, restaurant, `travailleur_id`, date du jour et motif d'archivage déjà
remplis. La question s'affiche pour qui peut archiver (RH, directeur,
manager). Hors CDI : rien ne change.

## 4. Gérant — Déductions, onglet Administratifs

Les fiches y figurent comme tout administratif de son restaurant, avec sous le
nom « Ancien travailleur · parti le … ». Paiement en espèces de caisse,
enregistré comme les autres administratifs : le gérant peut payer une partie
un jour, une autre partie un autre jour, jusqu'au solde. Le caissier ne les voit pas
(exclusion des administratifs déjà prévue).

## 5. Crédits fournisseurs → Administratifs

Section « Anciens travailleurs » sous les autres administratifs, sous-titre
« parti le … · motif » au lieu de l'échéance. Comptées dans « Dû aux
administrations » et dans la tuile Administrations de la Trésorerie.
Feuille Excel Administrations : colonne « Échéance » remplie par
« Parti le … · motif ».

## 6. Résultat net — au fil des paiements

Les fiches d'anciens travailleurs sont **exclues de la variation du crédit
fournisseurs** (`lib/creditFournisseursMois.js`) : ni leur crédit de départ ni
leurs paiements n'y entrent. Ainsi :
- création : rien n'est compté ;
- paiement par le gérant : la sortie de caisse retire le montant du résultat
  du mois du paiement ;
- paiement par la direction : la dépense direction « administratif » le
  retire du mois du paiement.

À vérifier pendant le plan : que le paiement direction n'est pas compté deux
fois (dépense + variation) et que le paiement gérant passe bien par
l'encaissé du point.

## 7. Logique pure (`lib/droitsAnciensTravailleurs.js`)

- `estDroitAncienTravailleur(f)` — `!!f.depart_le` ;
- `proposerDroits(trav)` — vrai si `type_contrat === 'CDI'` ;
- `resumeDroits(fiches, paiements)` — par restaurant : dû, payé, reste,
  soldé ;
- `sousTitreDepart(f)` — « parti le 12/09/2026 · Démission ».

## 8. Tests

Purs (`lib/*.test.mjs`, node:test) :
- `estDroitAncienTravailleur`, `proposerDroits` (CDI oui ; CDD, Stage,
  Journalier non) ;
- `resumeDroits` : regroupement par restaurant, soldé à 0, plusieurs
  paiements partiels (gérant puis direction puis gérant) jusqu'au solde ;
- `creditFournisseursMois` : une fiche ancien travailleur ne bouge pas la
  variation (création et paiement), un administratif normal si.

Lint 0 erreur, tous les tests verts, export web qui compile.

## 9. Livraison

Après le chantier des fournisseurs administratifs. Commit + push seulement,
sans publication (Vercel / EAS à la fin, avec les chantiers en attente).
L'utilisateur passe la migration dans Supabase.
