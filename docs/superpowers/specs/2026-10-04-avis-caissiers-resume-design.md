# Avis clients : heure de commande, caissier responsable, écran Résumé — conception

Date : 04/10/2026 · Statut : validée en conversation, à relire

## Pourquoi

Les avis Glovo/Yango arrivent par le bouton « ⭐ Avis → Samtrackly » (voir
`2026-10-04-bouton-avis-design.md`) mais sans l'heure de la commande : on ne
sait pas quel caissier a servi le client. La règle du propriétaire (03/10)
existe déjà — l'avis va au caissier qui tenait la caisse à l'heure de la
commande (`lib/attributionAvis.js`, `caissierAuMoment`) — mais elle ne sert
qu'aux litiges dont l'heure est tapée à la main. L'écran Avis clients, lui,
n'offre qu'une liste et quelques chiffres.

## Ce qui est décidé

- Heure de commande **lue sur le portail** par le bouton avis (pas de
  rapprochement avec le POS : fiable pour la moitié des avis Yango seulement,
  quasi nul pour Glovo).
- **Tous** les avis sont attribués à un caissier ; **bons et mauvais comptent**
  dans la note /20.
- Un avis négatif **muet** (sans commentaire ni tag, donc sans litige) ne
  compte contre personne.
- Écran Avis clients en **trois onglets** : Résumé (ouvert par défaut) / Avis /
  À rattacher.

## 1. Heure de commande

**Bouton avis** (`public/bouton-avis.js`) — après la lecture des avis, pour
chacun, une lecture du détail de la commande, 4 en parallèle, avec un compteur
dans le bandeau (« Heures de commande : 120/310 ») :

- **Yango** : `GET /4.0/restapp-front/eats-restapp-orders/v1/order?order_nr=…`
  avec les en-têtes de la requête de la page déjà captée (jamais lus) →
  `created_at`. Vérifié le 04/10 : 261003-CI0622322 → 18:59, comme le portail.
- **Glovo** : `POST https://vagw-api.eu.prd.portal.restaurant/query`, requête
  GraphQL minimale `GetOrderDetails` (`orderId`, `GlobalVendorCode`
  `{globalEntityId:'GV_CI', vendorId}`), même authentification que la lecture
  des avis → `placedTimestamp`. Vérifié le 04/10 (réponse 200).
- L'heure va dans un nouveau champ `commande_le` (ISO) de chaque avis envoyé.
  Un détail introuvable ou en erreur : l'avis part sans heure (rien n'est
  bloqué), le bandeau indique « 3 heures introuvables ».

**Base** :
- `platform_reviews.commande_le TIMESTAMPTZ NULL` (migration).
- Abidjan = UTC : date et heure de commande se lisent directement en UTC.

**Fonction `ingest-reviews`** (POST) :
- Lit `commande_le` (date-heure ISO valide, sinon ignorée).
- Nouvel avis : `commande_le` enregistré ; son litige éventuel prend
  `date` = **date de la commande** (repli : date de l'avis) et
  `heure_commande` = HH:MM.
- Avis déjà connu sans heure : l'heure est ajoutée (`platform_reviews` et
  litige lié s'il n'a pas d'heure : `heure_commande` + `date` = date de
  commande). Rien d'autre n'est modifié.
- Résumé renvoyé : + `heures_ajoutees`, `litiges_attribues`.

**Avis déjà en base** : un clic sur chaque portail complète l'heure de la
fenêtre relue (30 jours Yango, 45 jours Glovo).

## 2. Attribution au caissier

Règle inchangée (`caissierAuMoment`), avec les mêmes shifts que le bouton
« Attribuer » de l'écran Litiges (`points_shifts` du restaurant) : le shift
qui couvre l'heure (service de soirée de la veille compris) ; plusieurs caissiers
ou aucun shift → personne. Mieux vaut un avis sans responsable qu'un caissier
qui paie pour un autre.

- **Litiges (négatifs avec motif)** : `ingest-reviews` remplit
  `responsable_id` / `responsable_nom` dès l'arrivée de l'heure, uniquement si
  le litige n'a pas déjà de responsable (une correction du manager prime). Si
  le shift n'est pas encore saisi, le bouton existant « Attribuer les N avis
  sans responsable » de l'écran Litiges rattrape plus tard.
  La fonction utilise une **copie exacte** de `lib/attributionAvis.js`
  (`supabase/functions/ingest-reviews/attributionAvis.js`) ; un test vérifie
  que les deux fichiers sont identiques.
- **Tous les avis** (affichage, classement) : caissier recalculé à
  l'affichage depuis `commande_le` et les shifts de la période (veille comprise) — à jour même si un shift est
  saisi tard. Pour un avis qui a un litige avec responsable, c'est ce
  responsable qui s'affiche.
- **Note /20** (`lib/noteCaissierDb.js`) : chaque **bon** avis plateforme de la
  période, attribué par la règle, compte comme « bon avis » (+0,5, le critère
  « Clients et plateformes » reste plafonné à 3 points). Les mauvais comptent
  via leur litige, comme aujourd'hui.

## 3. Écran Avis clients

Style « écran modernisé » (`components/ui/EcranModerne.js`, thème orange) :
en-tête, puces de période, `ChampDates` pour les dates au choix.

- **Périodes** : Aujourd'hui, Hier, 7 jours, 30 jours, Ce mois, Mois dernier,
  Dates au choix. Filtre restaurant conservé.
- **Onglet Résumé** (par défaut) :
  - 4 tuiles : note moyenne /5, nombre d'avis, % de négatifs, litiges (nombre
    et montant FCFA). Chacune avec l'évolution ↑↓ par rapport à la **période
    précédente de même durée** (en vert si c'est mieux, en rouge si c'est
    pire ; « — » si la période précédente est vide).
  - Restaurants, du pire au meilleur : nombre d'avis, % de négatifs, barre.
  - Caissiers : 👍, 👎, % de négatifs, du plus de mauvais avis au moins ;
    ligne « Sans caissier » pour les avis non attribués.
  - Motifs les plus fréquents parmi les avis négatifs : thèmes Glovo, tags
    Yango, + « Commentaire sans motif » ; 6 premiers.
- **Onglet Avis** : la liste actuelle ; chaque carte ajoute « Commande à
  20:17 · Caissier : Bazie » (ou « Caissier : non trouvé »).
- **Onglet À rattacher** : inchangé.
- Le bandeau de rappel (2 jours sans avis) et le lien manager « Installer le
  bouton avis » restent en haut.

**Fichiers** : la logique pure du résumé dans `lib/avisResume.js` (nouveau) ;
l'écran découpé en composants `components/avis/` (Résumé, carte d'avis) pour
que `app/avis-plateformes.js` (520 lignes) ne grossisse pas.

## Tests

`node:test` sur le pur :
- `lib/avisResume.js` : période précédente (même durée, Hier, Mois dernier),
  évolutions et sens « mieux/pire », classement restaurants, classement
  caissiers (dont « Sans caissier »), top motifs.
- attribution d'un avis plateforme (heure → caissier, responsable du litige
  prioritaire).
- copie de `attributionAvis.js` identique à l'original.
- bouton : extraction de l'heure depuis les réponses Glovo/Yango.

## Hors périmètre

- Rapprochement avec les commandes du POS.
- Correction manuelle du caissier d'un **bon** avis (seuls les litiges se
  corrigent, dans l'écran Litiges).
- Montant de la commande, réponses aux avis.
