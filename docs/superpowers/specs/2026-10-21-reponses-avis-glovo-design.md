# Réponses aux avis Glovo depuis Samtrackly — conception (21/10/2026)

## But

Répondre aux avis Glovo **avec un texte** sans passer par le portail Glovo :
Samtrackly propose une réponse rédigée d'après un modèle choisi par motif, le
manager la valide telle quelle ou la modifie, et le bouton favori l'envoie à
Glovo au clic suivant.

Hors périmètre : Yango (répondre demande un abonnement payant, non souscrit ;
délai de 72 h), les coupons, les avis sans texte, la rédaction par IA.

## Ce que fait le portail Glovo (relevé le 21/10/2026, rien envoyé)

- Liste : `POST https://vrs-api.eu.prd.portal.restaurant/v1/reviews` (déjà lue
  par le favori). Chaque avis porte `id` (identifiant de l'avis), `orderId`,
  `globalVendorCode`, `date`, `text`, `thumbs_up`, `vendor_pills`,
  `product_ratings`, **`reply`** (null tant que personne n'a répondu),
  `pre_made_replies` (4 clés génériques, inutilisées ici). La réponse globale
  porte `awaiting_reply_count`.
- Réponse : `POST {même hôte}/v1/reviews/reply`, corps
  `{ global_vendor_code, reviewId, text, language }`, même jeton
  `Authorization: Bearer` que la lecture (lu dans `persist:root`, jamais sorti
  de la page).
- Glovo peut **rejeter** une réponse (le portail a un écran « réponse
  rejetée »). Une réponse peut aussi être modifiée ou supprimée : hors
  périmètre.
- Au 21/10, aucun avis écrit n'a de réponse (0 sur les 50 derniers de la
  Palmeraie).

## Données

Nouvelle table `reponses_avis` (projet Samtrackly) :

| Colonne | Rôle |
|---|---|
| `id` uuid | clé |
| `review_id` uuid unique → `platform_reviews.id` | l'avis |
| `texte` text | réponse validée (≤ 1 000 caractères) |
| `modele` text | motif du modèle de départ (suivi, pas de logique) |
| `statut` text | `validee` · `envoyee` · `refusee` · `ignoree` |
| `erreur` text | raison du refus de Glovo, en clair |
| `valide_par`, `valide_le` | qui a validé, quand |
| `envoye_le` | horodatage de l'envoi réussi |

Rien n'est écrit tant que le manager n'a ni validé ni ignoré : la proposition
est calculée à l'affichage. Une réponse `refusee` revient dans « À répondre »
avec son texte et l'erreur.

## Modèles par motif — `lib/reponsesAvis.js` (pur, testé)

- `detecterMotif(avis)` : d'abord les étiquettes Glovo (`raw.raw.theme`),
  puis des mots-clés du texte (sans accents, minuscules). Ordre de priorité :
  `manquant_erreur` > `froid_sec` > `gout` > `photo_portion` > `emballage` >
  `negatif_autre` pour un 👎 ; `positif_mais` (un « mais » / « sauf » /
  « pas de ») > `positif` pour un 👍.
- `proposerReponse(avis)` : texte du modèle du motif, avec le nom du restaurant
  et le plat quand Glovo le donne (`raw.raw.dish`), signé « L'équipe Chez
  Samer » ou « L'équipe Al Kayan » selon la boutique (`raw.raw.store_name`).
  Vouvoiement. Les textes des modèles sont validés par l'utilisateur avant
  d'être codés.

## Écran — Avis → onglet « À répondre » (manager seulement)

- Avis Glovo avec texte, sans `reponses_avis` ou en `refusee`, du plus récent
  au plus ancien, filtrables par restaurant comme les autres onglets.
- Chaque carte : date, restaurant, 👍/👎, texte du client, plat ; dessous la
  réponse proposée (ou le texte refusé + l'erreur).
- **Valider** → `validee`. **Modifier** → champ éditable puis Valider.
  **Ignorer** → `ignoree` (disparaît).
- Compteur en tête : « X à répondre · Y en attente d'envoi » ; rappel « Cliquez
  sur le bouton favori dans le portail Glovo pour envoyer ».

## Envoi — favori + relais + `ingest-reviews`

1. `ingest-reviews` GET (secret) renvoie en plus `reponses` : les `validee` de
   Glovo avec `id`, `external_ref` (= orderId), `external_store_label`,
   `review_date`, `texte`.
2. Le relais transmet la liste au favori avec la date du dernier avis (même
   échange `postMessage` qu'aujourd'hui).
3. Le favori, après la lecture des avis et des commandes : pour chaque réponse,
   retrouve l'avis Glovo (`orderId` + boutique) — dans les avis lus, sinon par
   une lecture ciblée sur le jour de l'avis — puis POST `/v1/reviews/reply`
   avec `language: 'fr'`. Un avis qui a déjà un `reply` chez Glovo n'est pas
   renvoyé (compté comme envoyé). 2 envois à la fois, réessais espacés comme
   pour les commandes.
4. Résultats renvoyés au relais → `ingest-reviews` POST `{ reponses: [{ id,
   ok, erreur }] }` (secret) → `envoyee` + `envoye_le`, ou `refusee` + `erreur`.
5. La petite fenêtre affiche « N réponses envoyées · M refusées par Glovo ».

Garanties : une réponse n'est envoyée qu'une fois (seules les `validee` partent,
et un avis déjà répondu chez Glovo est sauté) ; un échec réseau laisse la
réponse en `validee` pour le clic suivant ; aucun jeton ne quitte la page.

Le moteur change : **réinstaller le favori une fois** (le code est copié dans
le favori à l'installation).

## Tests

- `lib/reponsesAvis.test.mjs` : motif par étiquette, par mots-clés, priorités,
  positif avec « mais », signature selon la marque, plat absent.
- Tests du moteur (`lib/boutonAvis*.test.mjs` existants) : choix des réponses à
  envoyer, avis déjà répondu sauté, regroupement des résultats.
- Tests du relais (`lib/envoiAvis.test.mjs`) : résumé « réponses envoyées ».
- Premier envoi réel : une seule réponse, choisie avec l'utilisateur, vérifiée
  dans le portail avant d'ouvrir à toutes.
