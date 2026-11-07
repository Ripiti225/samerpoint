# Calendrier : toutes les dates de l'application — conception

Date : 07/11/2026. Complète `2026-11-07-evenements-design.md`.

## Besoin

Voir dans le calendrier des Événements les dates de paiement de chèques et tout ce qui a une date à venir, en un seul endroit.

## Décisions de l'utilisateur

Sont inclus : la Trésorerie, les fins de contrat, les congés et permissions, les tâches de supervision. Les montants sont affichés selon les droits.

## Principe

Tout est lu à l'affichage, là où c'est saisi. Rien n'est copié ni stocké, aucune migration n'est nécessaire. Toucher une ligne ouvre l'écran d'origine.

## Ce qui s'affiche

| Type | Date | Condition | Ouvre |
|---|---|---|---|
| Chèque | `date_encaissement` | `statut = emis` | `/tresorerie-cheques` |
| Échéance À payer | `echeance` | Reste à payer, catégorie visible | `/tresorerie-a-payer` |
| Prévision de paiement | `date_prevue` | Non réalisée, sans chèque émis lié, ligne visible | `/tresorerie-a-payer` |
| Remboursement du coffre | `rembourser_le` | `rembourse_le` vide | `/tresorerie-coffre` |
| Charges administratives | `prochaineEcheance` | Fournisseur administratif actif avec un montant ; une ligne par date, avec le nombre et le total | `/credits-fournisseurs` |
| Fin de contrat | `date_fin` | Contrat signé, non clôturé, date à venir | `/contrats` |
| Congé ou permission | Début, ou aujourd'hui s'il a commencé | Accepté, fin à venir ; texte « Du … au … » | `/demandes-admin`, ou `/demandes` pour le gérant |
| Tâche de supervision | `echeance` | Ouverte (`a_faire` ou `signalee`) | `/supervision` |

Les anciennes lignes CNPS, TEE, ITS, Timbre et Bail de `tresorerie_dus` ne sont pas affichées : `categoriesVisibles` les écarte déjà, comme l'écran À payer.

Une échéance et sa prévision restent deux lignes, car ce sont deux dates différentes. Une prévision portée par un chèque émis n'apparaît pas : seul le chèque compte.

## Le fil

- Section **En retard** en tête : chèques, prévisions, remboursements et tâches dont la date est passée.
- Échéances en retard : une seule ligne, « N échéances en retard », avec le total, qui ouvre À payer. Elle est réservée à ceux qui ont le droit `voir_dettes`.
- Filtres ajoutés selon les droits : Trésorerie, Personnel, Tâches.
- Section **Plus tard** pour la direction et la RH, sous les filtres Calendrier, Trésorerie, Personnel et Tâches.
- Le filtre par restaurant s'applique. Les lignes sans restaurant (chèques, coffre) restent visibles quel que soit le restaurant choisi.
- Une ligne en retard affiche son jour en rouge.

## Droits

| Compte | Niveau Trésorerie | Chèques | Échéances, prévisions, charges | Coffre | Échéances en retard | Contrats | Congés, tâches |
|---|---|---|---|---|---|---|---|
| Propriétaire | `proprietaire` | Oui | Oui | Oui | Oui | Oui | Groupe |
| Autre manager | `lecture` | Oui | Oui | Non | Non | Oui | Groupe |
| RH | `saisie_rh` | Non | Ses catégories | Non | Non | Oui | Groupe |
| Gérant | Aucun, même avec une ligne de droits | Non | Non | Non | Non | Non | Son restaurant |

Les données qu'un compte ne peut pas voir ne sont pas lues du tout. Si les droits ne peuvent pas être lus, aucune donnée de Trésorerie n'est chargée.

## Échecs de chargement

Chaque source se charge à part. Si l'une échoue, le reste s'affiche, avec : « Certaines dates n'ont pas pu être chargées. » Si les paiements manquent, ni les échéances ni les prévisions ne s'affichent : elles paraîtraient toutes impayées.

## Ce qui ne change pas

Pas de nouvelle notification : les rappels de Trésorerie continuent. Le rappel de l'accueil reste limité aux anniversaires, à l'ancienneté et aux événements. Ces dates ne sont pas dans le fichier `.ics`.

## Limite connue

Le filtre des droits se fait dans l'application : la base reste lisible avec la clé publique, jusqu'au chantier de sécurité.

## Découpage

- `lib/calendrierDates.js` : droits et construction des lignes, logique pure, testée.
- `lib/evenements.js` : section En retard, filtres par famille, fusion des lignes.
- `lib/evenementsDb.js` : `chargerDatesCalendrier`.
- `components/evenements/LigneDate.js` et `app/evenements.js` : affichage.

## Accès réglables (décision de l'utilisateur, 07/11/2026)

L'utilisateur veut changer qui voit quoi sans modifier le code. Les colonnes « Droits » ci-dessus deviennent les **réglages par défaut**.

- **Écran « Accès au calendrier »**, ouvert depuis Paramètres et depuis Événements : un choix de rôle (Manager, Directeur, RH, Gérant) et une ligne par type à activer ou couper.
- **Types réglables :** anniversaires, âge, ancienneté, événements, congés, fins de contrat, tâches, chèques, échéances, prévisions, charges administratives, échéances en retard, coffre.
- **Le réglage décide, pas la Trésorerie :** cocher « Chèques » pour le RH les lui montre dans le calendrier. Ouvrir l'écran Chèques reste soumis aux droits de la Trésorerie.
- **Seul le propriétaire de la Trésorerie modifie ces réglages**, et il voit toujours tout.
- **Garde-fous non réglables :**
  - Le gérant reste limité à son restaurant, quoi qu'on coche. Toute donnée liée à un autre restaurant ou à aucun restaurant est écartée, à la lecture comme à l'affichage. Les événements de tout le groupe restent visibles.
  - Chèques, coffre et échéances en retard ne peuvent pas être activés pour le gérant : ils ne sont rattachés à aucun restaurant.
- **Stockage :** table `calendrier_acces` (`role`, `types`, `updated_at`, `modifie_par_nom`), migration `supabase_calendrier_acces.sql`. Sans ligne ou sans table, les réglages par défaut s'appliquent. Chaque modification est notée au journal.
- Le rappel de l'accueil suit ces réglages. L'ajout et la modification d'événements restent à la direction et à la RH. Les alertes de stock restent réglées événement par événement.
- **Limite connue :** comme le reste de l'application, ce contrôle se fait dans l'application tant que le chantier de sécurité n'est pas fait.
