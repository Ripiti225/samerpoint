# Bouton « Avis → Samtrackly » + rappel — conception

Date : 04/10/2026 · Statut : validée en conversation, à relire

## Pourquoi

L'extraction quotidienne des avis Glovo/Yango confiée à 3 tâches Claude cloud
(11h, 12h, 13h) n'a jamais fonctionné : elles s'exécutent sans Chrome ni accès
aux portails. Seul le run manuel du 05/09 est passé ; un mois d'avis a dû être
rattrapé à la main le 04/10. Les 3 tâches sont en pause depuis le 04/10.

On remplace l'automate par un **bouton cliqué par un humain** sur le portail
où il est déjà connecté, et par un **rappel** dans Samtrackly quand personne
n'a cliqué depuis 2 jours.

## Ce qui est décidé

- Forme : **favori Chrome (bookmarklet)** + **page relais** dans Samtrackly.
  Pas d'extension Chrome.
- Un seul bouton pour les deux portails ; il reconnaît le site.
- Plusieurs personnes peuvent l'utiliser ; **seul le rôle manager** voit
  l'écran d'installation.
- Rappel : à partir de **2 jours sans nouvel avis** sur une plateforme, dans
  l'écran Avis clients **et** dans la cloche de l'accueil (manager, directeur).

## 1. Trajet d'un clic

1. L'utilisateur clique sur le favori depuis `portal.glovoapp.com` ou
   `vendor.yango.com`. Ailleurs : message « Ouvre le portail Glovo ou la page
   Avis de Yango, puis clique à nouveau ».
2. **Immédiatement** (encore dans le geste de clic, sinon Chrome bloque la
   fenêtre), le bouton ouvre `<origine Samtrackly>/envoi-avis.html` en petite
   fenêtre.
3. La fenêtre relais répond `pret` au portail (`postMessage` vers
   `window.opener`). Elle interroge `GET ingest-reviews` pour connaître la date
   du dernier avis reçu par plateforme et la transmet au bouton.
4. Le bouton lit les avis de la période (§2), les met au format d'ingestion
   et les transmet à la fenêtre relais.
5. La fenêtre relais fait le `POST ingest-reviews` (`finalize: false`), affiche
   le résumé en français (« Glovo : 37 nouveaux avis · 4 litiges créés ·
   2 boutiques à rattacher ») et se ferme seule après 8 s.

**Période lue** : du dernier `review_date` reçu pour cette plateforme moins
3 jours (notes tardives) jusqu'à aujourd'hui, plafonnée à 45 jours pour Glovo
et 30 jours pour Yango (au-delà de 5 semaines, Yango répond « invalid_period »).
Aucun avis reçu → le plafond. Les doublons sont absorbés par le dédoublonnage existant
(`dedup_hash` sur le n° de commande).

## 2. Lecture des avis sur chaque portail

Le bouton se sert de la connexion déjà ouverte dans la page pour lire les
avis, mais n'affiche ni ne transmet **aucun jeton de connexion** des
portails : seuls des avis sortent de la page.

**Glovo** (n'importe quelle page du portail, testé le 04/10) — `POST
https://vrs-api.eu.prd.portal.restaurant/v1/reviews`, authentifié comme la
page le fait elle-même, les 9 codes boutique en une requête
(`global_vendor_codes`), pagination `afterId` / `afterTimestamp`, 50 par page.
Format envoyé, identique au rattrapage :
`external_store_label` = code boutique (`GV_CI;84806`), `external_ref` =
`orderId`, `classification` = `thumbs_up ? 'bon' : 'negatif'`, `comment` =
`text`, `review_date` = date UTC, `raw.theme` = thèmes traduits (table des
9 codes : TASTY → « Bon goût », TASTED_BAD → « Mauvais goût »,
MISSING_OR_MISTAKEN_ITEMS → « Produits manquants ou incorrects »,
SMALL_PORTION_SIZE → « Portion trop petite », EXPENSIVE → « Cher »,
GOOD_VALUE → « Bon rapport qualité-prix », PORTION_SIZE → « Taille des
portions », PACKAGING_QUALITY → « Qualité de l'emballage »,
SPEED_AND_RELIABILITY → « Rapidité et fiabilité » ; code inconnu → gardé
tel quel), `raw.dish` = plat(s), `raw.store_name` = nom de la boutique.

**Yango** (page **Avis** obligatoire) — le bouton laisse la page émettre sa
propre requête `POST /4.0/restapp-front/eats-place-rating/v1/places-order-feedbacks`
(en déclenchant « Afficher plus ») et la réutilise telle quelle en ne
changeant que le corps (`from`, `to`, `cursor`, `limit: 50`). Si la page ne
la déclenche pas en 10 s : message « Fais défiler la liste des avis puis
clique à nouveau ». Format : `external_store_label` = `place_id`,
`external_ref` = `order_nr`, `rating_raw` / `rating_scale: 5`,
`classification` = note < 3 → `negatif`, `comment` = `''` (Yango n'en
transmet pas), `raw.tag` = `predefined_comments`, `raw.yango_place_id`.

## 3. Page relais, installation, sécurité

- **`public/envoi-avis.html` + `public/envoi-avis.js`** : page statique, hors
  de l'app (les gardes de session de l'app redirigeraient la fenêtre vers la
  connexion ou le dernier écran). N'accepte un message que si son origine est
  exactement `https://portal.glovoapp.com` ou `https://vendor.yango.com`.
  Elle ne stocke rien.
- **`app/bouton-avis.js`** (manager uniquement, lien depuis l'écran Avis
  clients) : le manager colle **une fois** le secret d'ingestion (pris dans
  son gestionnaire de mots de passe) ; l'écran génère le favori à glisser
  dans la barre de favoris, avec 3 lignes d'explication. Le secret n'est ni
  enregistré ni présent dans le code de l'app (le bundle web est public).
- Le secret vit dans le favori. Fuite → changer `INGEST_SECRET`, chaque
  utilisateur réinstalle le bouton.
- Le code du favori est autonome (aucun script externe : les portails
  l'interdiraient). Sa logique de conversion (période, format Glovo, format
  Yango, traduction des thèmes) est écrite en fonctions pures, testées, puis
  assemblée dans le favori.

## 4. Fonction `ingest-reviews`

`GET` renvoie en plus, par plateforme, la date du dernier avis
(`max(review_date)`) et du dernier envoi (`max(ingested_at)`) :
`{ done_today, finished_at, derniers: { glovo: { review_date, ingested_at }, yango: {...} } }`.
Le `POST` est inchangé.

## 5. Rappel

- Règle pure `plateformesEnRetard(derniers, maintenant, seuilJours = 2)` dans
  `lib/avisPlateformes.js` : une plateforme est en retard si son dernier
  `ingested_at` date de plus de 2 jours (ou s'il n'y en a aucun). Testée.
- Lecture : `dernierAvisRecu()` dans `lib/avisPlateformesDb.js` (une requête
  `order by ingested_at desc limit 1` par plateforme — pas de lecture de
  toute la table).
- **Écran Avis clients** : bandeau orange en haut, par plateforme en retard :
  « Yango : derniers avis reçus il y a 3 jours — ouvre la page Avis du portail
  Yango et clique sur le bouton avis ».
- **Cloche de l'accueil** (manager, directeur) : ligne « ⭐ Avis Yango non
  reçus depuis 3 jours », calculée à l'ouverture du panneau comme les
  explications J+3 (`NotificationsContext`), un appui ouvre l'écran Avis
  clients. Disparaît d'elle-même après un envoi.

## Erreurs (messages en français, jamais de code technique)

| Situation | Message |
|---|---|
| Portail déconnecté (401/403) | « Ta session Glovo a expiré : reconnecte-toi au portail puis clique à nouveau. » |
| Fenêtre bloquée par Chrome | « Chrome a bloqué la fenêtre d'envoi : autorise les fenêtres pour ce site puis clique à nouveau. » |
| Secret refusé (401 de la fonction) | « Le bouton n'est plus à jour : demande au manager de le réinstaller. » |
| Aucun nouvel avis | « Glovo : aucun nouvel avis depuis le dernier envoi. » (succès) |
| Erreur réseau / 500 | « L'envoi n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes. » |

## Tests

- Tests unitaires `node:test` : période (dernier avis − 3 j, plafond 45 j,
  aucun avis), conversion Glovo (thèmes, plats, pouce), conversion Yango
  (note, tags), `plateformesEnRetard` (seuil strict, plateforme jamais reçue).
- Vérification réelle : un clic sur chaque portail depuis Chrome, résultat
  contrôlé en base ; puis bandeau et cloche vérifiés en modifiant la date de
  référence dans les tests, pas en base.

## Hors périmètre

- Extension Chrome, envoi automatique sans clic, lecture des deux portails en
  un seul clic.
- Réponses aux avis et recours (restent manuels sur les portails).
- Suppression des 3 tâches cloud (en pause ; suppression possible sur
  claude.ai/code/routines).
