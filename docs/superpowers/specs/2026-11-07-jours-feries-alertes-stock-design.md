# Jours fériés ivoiriens et alertes de stock — conception

Date : 07/11/2026. Complète `2026-11-07-evenements-design.md`.

## Besoin

Pouvoir charger dans l'application le calendrier des jours fériés ivoiriens, le télécharger vers le calendrier du téléphone, et recevoir une alerte avant chaque fête pour rehausser le stock.

## Décisions de l'utilisateur

- Un bouton dans l'application **et** un fichier à télécharger.
- L'alerte donne un rappel et un chiffre réel de hausse, jamais une quantité par produit.
- Alerte à J-7 et J-2, sur l'accueil et par notification.
- Destinataires : le gérant pour son restaurant ; la direction et la RH pour le groupe.
- Le lundi de Pentecôte est inclus par défaut et reste supprimable, car sa présence est à confirmer.

Le calendrier grégorien n'a pas de contenu propre : les fériés sont déjà exprimés en dates grégoriennes. Il n'y a donc pas de second calendrier.

## Liste des jours fériés

Base : décret n° 96-205 du 7 mars 1996, modifié par le décret n° 2011-371 du 4 novembre 2011. Le texte officiel n'a pas pu être relu (lien de l'OIT en erreur le 07/11/2026) : la liste reste donc corrigeable dans l'application.

| Fête | Clé | Date | Statut |
|---|---|---|---|
| Jour de l'An | `an` | 1er janvier | Fixe |
| Lendemain de la Nuit du Destin | `nuit_destin` | Lunaire | Estimée |
| Korité | `korite` | Lunaire | Estimée |
| Lundi de Pâques | `lundi_paques` | Pâques + 1 | Calculée |
| Fête du Travail | `travail` | 1er mai | Fixe |
| Ascension | `ascension` | Pâques + 39 | Calculée |
| Lundi de Pentecôte | `lundi_pentecote` | Pâques + 50 | Calculée, à confirmer |
| Tabaski | `tabaski` | Lunaire | Estimée |
| Fête nationale | `nationale` | 7 août | Fixe |
| Assomption | `assomption` | 15 août | Fixe |
| Lendemain du Maouloud | `maouloud` | Lunaire | Estimée |
| Toussaint | `toussaint` | 1er novembre | Fixe |
| Journée nationale de la Paix | `paix` | 15 novembre | Fixe |
| Noël | `noel` | 25 décembre | Fixe |

**Années disponibles :** 2026 à 2030.

**Dates lunaires estimées**, calculées avec le calendrier islamique Umm al-Qura, à compléter pour 2026 avant la mise en service :

| Année | Lendemain Nuit du Destin | Korité | Tabaski | Lendemain Maouloud |
|---|---|---|---|---|
| 2027 | 7 mars | 9 mars | 16 mai | 15 août |
| 2028 | 24 février | 26 février | 5 mai | 4 août |
| 2029 | 12 février | 14 février | 24 avril | 25 juillet |
| 2030 | 1er février | 4 février | 13 avril | 14 juillet |

Pour 2027, une source donne la Tabaski le 17 mai. C'est pourquoi ces dates restent marquées « date estimée ».

## Données

La table `evenements_groupe` reçoit quatre colonnes :

| Colonne | Type | Rôle |
|---|---|---|
| `ferie_cle` | text | Clé de la fête ; vide pour un événement saisi à la main |
| `ferie_annee` | integer | Année de la fête |
| `date_estimee` | boolean, faux par défaut | Affiche « date estimée » |
| `alerte_stock` | boolean, faux par défaut | Déclenche les alertes de stock |

Un index unique sur `(ferie_cle, ferie_annee)`, limité aux lignes où `ferie_cle` n'est pas vide, empêche les doublons.

Nouvelle table `alertes_stock_envoyees` : `cle` (text, clé primaire), `message`, `created_at`. Une alerte ne part que si sa clé peut être insérée.

## Bouton « Ajouter les jours fériés »

- Réservé à la direction et à la RH, dans l'écran Événements.
- On choisit l'année ; les fériés sont insérés avec `alerte_stock = true`.
- Une fête déjà présente pour cette année n'est ni dupliquée ni écrasée : une date déjà corrigée le reste.
- Le résultat s'affiche : « 14 jours fériés ajoutés pour 2027 » ou « Déjà ajoutés ».
- Le journal enregistre l'ajout.

## Formulaire d'un événement

Deux réglages s'ajoutent :

- **Alerte stock :** oui ou non, pour tout événement, y compris ceux saisis à la main.
- **Date :** estimée ou confirmée, visible seulement pour un jour férié.

Le fil affiche « date estimée » sur la ligne concernée.

## Fichier à télécharger

- Bouton **Télécharger le calendrier** dans Événements, pour tous ceux qui ont accès à l'écran, avec le choix de l'année.
- Fichier `jours-feries-ci-AAAA.ics` : journées entières, rappels à 7 et 2 jours, « (date estimée) » dans le titre si besoin.
- Il part de la liste de l'année, en reprenant les corrections enregistrées dans l'application.
- L'écran prévient : « Ce fichier ne se met pas à jour tout seul. Si une date change, téléchargez-le à nouveau. »

## Chiffre de hausse

Calcul pur, par restaurant, avec `venteRetenue` (vente machine, jamais `vente_total` seule) :

1. **Dernière édition de la fête.** Pour un férié : la ligne de l'année précédente si elle existe et que sa date est confirmée ; sinon la date fixe ou calculée de l'année précédente. Une date lunaire non confirmée ne compte pas. Pour un événement « chaque année » saisi à la main : la même date l'année précédente. Pour tout autre événement : pas de chiffre.
2. **Jour normal.** Moyenne des 4 mêmes jours de semaine qui précèdent cette édition, sans les jours fériés connus.
3. **Hausse.** `(vente de la fête − moyenne) / moyenne`, arrondie à l'unité.

Pas de chiffre si le restaurant n'a pas de vente ce jour-là ou moins de 2 jours de référence. Pour le groupe, seuls comptent les restaurants qui ont un chiffre, et le message dit leur nombre.

## Texte de l'alerte

Titre : « 📦 {fête} dans {n} jours » ou « 📦 {fête} après-demain ». Ajouter « (date estimée) » si besoin.

| Résultat | Texte |
|---|---|
| Hausse d'au moins 10 % | « L'an dernier ce jour-là : +{x} % de ventes. Pensez à rehausser le stock. » |
| Entre −10 % et +10 % | « L'an dernier ce jour-là : ventes proches d'un jour normal. Vérifiez votre stock. » |
| Baisse d'au moins 10 % | « L'an dernier ce jour-là : −{x} % de ventes. Vérifiez votre stock avant de commander. » |
| Pas de chiffre | « Pensez à vérifier et rehausser le stock. » |

## Envoi des alertes

Nouvelle Edge Function `alertes-stock`, sur le modèle de `rappels-tresorerie`, appelée par `pg_cron` chaque jour à 9 h (Abidjan = UTC) :

- Elle retient les événements `alerte_stock` à exactement J-7 et J-2.
- Un événement d'un seul restaurant n'alerte que ce restaurant et la direction.
- Gérant actif : son restaurant. Manager, directeur et RH actifs : un résumé du groupe.
- Canaux : Android (Expo), iPhone (`send-web-push`), notification dans l'application, écran `evenements`.
- Clé : `stock|evenement|date|delai|utilisateur`, réservée avant l'envoi. Si une date est corrigée, la nouvelle date peut alerter à nouveau.
- Le mode `essai` calcule et renvoie les messages sans rien envoyer ni noter.
- Plusieurs fêtes le même jour se regroupent en un seul message par personne.

Le gérant sans compte actif ne reçoit rien ; aucune erreur n'est levée pour autant.

## Accueil

Sous le rappel du jour, une ligne par fête à moins de 7 jours et ayant une alerte active, avec le même texte. Elle s'affiche du J-7 au jour de la fête, s'ouvre sur Événements, et se masque en cas d'échec de chargement, sans bloquer l'accueil. Elle ne lit que les points des dates nécessaires.

## Découpage

- `lib/joursFeries.js` : liste, Pâques, dates lunaires, liste d'une année, fichier `.ics`.
- `lib/alertesStock.js` : dernière édition, hausse, textes, élément à alerter, destinataires. Importé par l'application et par l'Edge Function.
- Les deux avec leurs tests `node:test`, sans import de React Native.
- `lib/evenementsDb.js` : ajout des fériés, lecture des ventes nécessaires.
- `components/evenements/` : feuille du calendrier ivoirien, ligne d'alerte de l'accueil.
- `supabase/functions/alertes-stock/index.ts`.
- `supabase_jours_feries.sql` : colonnes, table, index ; `supabase_alertes_stock_cron.sql` : tâche programmée, à passer après le déploiement de la fonction.

## Limites connues

- Les dates lunaires restent des estimations jusqu'à leur correction, souvent quelques jours avant la fête. Une alerte à J-7 peut donc partir sur une date légèrement fausse.
- Un fichier `.ics` déjà importé ne suit pas les corrections.
- L'historique commence en novembre 2025 : la plupart des fêtes n'ont qu'une édition de référence, et certains chiffres resteront absents.
- Sur le web et l'iPhone, une notification n'arrive que si l'utilisateur a activé les alertes.

## Hors périmètre

Quantités à commander par produit, liaison plats-stock, mise à jour automatique des dates lunaires depuis Internet, calendrier d'un autre pays.

## Livraison

Dans cet ordre, chaque étape avec l'accord de l'utilisateur :

1. Migrations `supabase_evenements.sql` puis `supabase_jours_feries.sql`.
2. Déploiement de la fonction, avec `--project-ref wlwotzxnzowbkbfcpnyi`, puis essai sans envoi.
3. Test de l'utilisateur sur son localhost.
4. Tâche programmée `supabase_alertes_stock_cron.sql`.
5. Publication Vercel + EAS, sans nouvelle installation.
