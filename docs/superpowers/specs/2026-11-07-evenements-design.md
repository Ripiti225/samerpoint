# Espace « Événements » — conception

Date : 07/11/2026.

## Besoin

Les fiches des travailleurs reçoivent maintenant leur date de naissance. Le groupe veut un endroit pour ne pas oublier les anniversaires, marquer l'ancienneté, préparer ses événements, et envoyer facilement un message au travailleur concerné.

Constat du 06/11/2026, sur 139 travailleurs actifs :

| Donnée | Fiches remplies |
|---|---|
| Date de naissance | 18 |
| Date d'embauche | 62 |
| Numéro de téléphone | 134 (127 à 10 chiffres sans indicatif, 7 avec 225) |

La liste des anniversaires sera donc courte au début et se remplira avec la mise à jour des fiches.

## Décisions de l'utilisateur

- Première version : anniversaires, ancienneté, calendrier du groupe.
- Ancienneté comptée **en années complètes uniquement** : « 2 ans chez nous », jamais « 3 mois chez nous ». Elle s'affiche à chaque année complète, sans paliers.
- Un message est généré pour chaque anniversaire et chaque ancienneté, à envoyer **par WhatsApp ou par SMS** au numéro du travailleur.
- Accès : direction et RH pour tout le groupe ; chaque gérant pour son restaurant.
- Organisation : un écran dédié et un rappel sur l'accueil.

## Écran `app/evenements.js`

**Accès :** tuile `evenements`, dans le groupe « Personnel et documents » (direction, RH) et le groupe « Équipe » (gérant).

| | Manager, directeur, RH | Gérant |
|---|---|---|
| Restaurants | Tous, avec un filtre par restaurant | Le sien, sans filtre |
| Âge | Affiché | Masqué, ainsi que l'année de naissance |
| Calendrier | Ajouter, modifier, supprimer | Lecture : événements du groupe et de son restaurant |
| Fiches sans date de naissance | Compteur affiché | Non affiché |

Le rôle superviseur et le caissier n'y ont pas accès.

**Fil :** les lignes sont triées par date, puis rangées dans la première section qui leur correspond :

1. Aujourd'hui ;
2. 7 prochains jours ;
3. Reste du mois ;
4. Mois suivant.

Rien n'est affiché au-delà de la fin du mois suivant. Les dates passées n'apparaissent pas. Les filtres sont : Tout, Anniversaires, Ancienneté, Calendrier. Un fil vide affiche un message simple.

## Anniversaires et ancienneté

Source : `travailleurs` actifs et non archivés. Rien n'est stocké : tout se calcule à l'affichage.

**Anniversaire :**
- Date de naissance renseignée.
- Ligne : photo, nom, restaurant, jour ; âge pour la direction et la RH.
- Né un 29 février : le 28 février les années non bissextiles.

**Ancienneté :**
- Date d'embauche renseignée, antérieure à la date concernée.
- Jour anniversaire de l'embauche, à partir d'un an complet. Moins d'un an : aucune ligne.
- Texte : « 1 an chez nous », « 2 ans chez nous ». Aucune mention de mois.
- Le 29 février suit la même règle.

## Message au travailleur

Les lignes d'anniversaire et d'ancienneté ont un bouton **Envoyer un message**. Il ouvre une fenêtre avec le texte déjà rédigé dans un champ modifiable, et deux boutons : **WhatsApp** et **SMS**.

**Modification :** l'utilisateur peut changer librement le texte avant chaque envoi. C'est le texte modifié qui part vers WhatsApp ou le SMS. La modification ne vaut que pour cet envoi : le texte de départ revient à l'ouverture suivante. Si le champ est vide, les deux boutons sont désactivés et un message demande d'écrire un texte.

Textes de départ (`{prénom}` vient de `prenoms`, sinon de `nom`) :

- Anniversaire : « Joyeux anniversaire {prénom} ! 🎂 Toute l'équipe de {restaurant} vous souhaite une excellente journée. »
- Ancienneté : « Bonjour {prénom}, cela fait {n} an(s) que vous êtes avec nous à {restaurant}. Merci pour votre travail et votre fidélité ! » (« 1 an », « 2 ans »).

**L'envoi reste manuel :** le bouton ouvre WhatsApp ou l'application SMS de l'appareil, message prêt, et l'utilisateur appuie sur Envoyer. Aucun service d'envoi automatique, et donc aucun coût par message. L'application ne peut pas savoir si le message est vraiment parti : elle n'affiche pas « envoyé ».

**Numéros :** WhatsApp exige l'indicatif du pays, et tous les numéros du groupe sont en +225 (confirmé par l'utilisateur). Une fonction pure ajoute l'indicatif au moment de l'envoi ; les numéros enregistrés sur les fiches ne sont pas modifiés :

| Numéro de la fiche | Résultat |
|---|---|
| 10 chiffres | `225` + les 10 chiffres |
| Commence par `225` ou `+225`, suivi de 10 chiffres | `225` + les 10 chiffres |
| Vide ou autre format | Aucun numéro : boutons remplacés par « Pas de numéro valide sur la fiche » |

Le SMS utilise le même numéro. Sur ordinateur, si aucune application SMS ne s'ouvre, un message d'erreur en français le dit.

## Calendrier du groupe

Nouvelle table `evenements_groupe` (migration `supabase_evenements.sql`) :

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid, clé primaire | |
| `titre` | text, obligatoire | |
| `date_evenement` | date, obligatoire | Choisie au calendrier (`ChampDate`), jamais tapée |
| `note` | text | Facultative |
| `restaurant_id` | uuid, vide = tout le groupe | |
| `chaque_annee` | boolean, faux par défaut | Noël, par exemple ; les fêtes mobiles comme la Tabaski se saisissent chaque année |
| `cree_par_nom` | text | |
| `created_at` | timestamptz | |

- Ajouter, modifier et supprimer passent par `journaliser`, qui ne bloque jamais l'action.
- La suppression demande une confirmation à deux boutons.
- Un événement `chaque_annee` s'affiche à sa prochaine date dans l'année en cours ou la suivante.
- La table suit les mêmes règles d'accès que le reste de la base.

## Rappel sur l'accueil

- Une ligne, sur `AccueilManager` (manager, directeur, RH) et `BandeauGerant` : par exemple « 🎂 2 anniversaires · 🏅 1 ancienneté · 📅 1 événement aujourd'hui ».
- Affichée seulement s'il y a au moins un élément aujourd'hui. Elle ouvre l'écran.
- Calculée à l'ouverture de l'accueil : pas de notification, ni de tâche programmée.
- Un échec de chargement masque la ligne sans bloquer l'accueil.

## Accès à la tuile

Les tuiles du RH et du gérant sont lues dans la table `roles_acces`, qui prime sur `ACCES_DEFAUT`. Ajouter la tuile au code ne suffit donc pas : la migration ajoute `evenements` aux lignes `rh` et `gerant`, en conservant leurs autres tuiles. `ACCES_DEFAUT`, `GROUPES_ADMIN`, `GROUPES_GERANT` et `ICONES_TUILES` sont aussi mis à jour.

## Découpage

- `lib/evenements.js` : logique pure — prochaine date, 29 février, sections du fil, ancienneté en années complètes, textes des messages, conversion des numéros, compteur du jour.
- `lib/evenements.test.mjs` : tests `node:test` de cette logique.
- `lib/evenementsDb.js` : lecture des travailleurs et du calendrier, écritures du calendrier.
- `app/evenements.js` et `components/evenements/` : écran, fenêtre de message, formulaire d'événement.

## Limites connues

- Masquer l'âge aux gérants se fait dans l'application seulement. La base reste lisible avec la clé publique ; une vraie protection relève du chantier de sécurité prévu à part.
- `app/contacts.js` ouvre `wa.me` avec le numéro tel quel, donc sans 225 pour les numéros à 10 chiffres. Ce point reste à vérifier séparément : il n'est pas modifié ici.

## Hors périmètre

Nouveaux arrivants, notifications automatiques, envoi automatique des messages, suivi « message envoyé », cadeaux ou primes, grille de calendrier.

## Livraison

- Migration à passer avant la publication.
- Vérification par les tests, le lint et l'export web.
- Publication par mise à jour automatique (Vercel + EAS), sans nouvelle installation, seulement après le feu vert de l'utilisateur.
