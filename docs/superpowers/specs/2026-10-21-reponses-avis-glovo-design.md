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
| `texte` text | réponse validée (≤ 250 caractères, `verifierReponse` vide) |
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
- `proposerReponse(avis)` : texte fixe du modèle du motif. **Ni nom de
  restaurant, ni marque, ni plat, ni chiffre, ni signature** (Glovo annule
  sinon — consigne de l'utilisateur). Vouvoiement. Textes validés le 21/10 :

| Motif | Texte |
|---|---|
| `manquant_erreur` | Bonjour, merci pour votre retour et toutes nos excuses pour cette erreur dans votre commande. Nous avons fait le point avec l'équipe pour que cela ne se reproduise pas. Au plaisir de mieux vous servir. |
| `froid_sec` | Bonjour, merci pour votre retour. Nous sommes désolés que votre commande ne soit pas arrivée chaude et fraîche. Nous revoyons la préparation et la remise au livreur. Au plaisir de mieux vous servir. |
| `gout` | Bonjour, merci d'avoir pris le temps de nous écrire. Nous sommes désolés que le goût ne vous ait pas plu. Votre remarque est transmise à notre cuisine. Au plaisir de vous régaler la prochaine fois. |
| `photo_portion` | Bonjour, merci pour votre retour. Nous sommes désolés que votre commande ne corresponde pas à vos attentes. Nous veillons à ce que chaque plat soit servi comme présenté. Au plaisir de vous revoir. |
| `emballage` | Bonjour, merci pour votre retour et toutes nos excuses pour l'état de votre commande à l'arrivée. Nous renforçons la vérification des emballages avant chaque départ. Au plaisir de mieux vous servir. |
| `negatif_autre` | Bonjour, merci pour votre retour. Nous sommes désolés que votre expérience n'ait pas été à la hauteur. Votre remarque est transmise à l'équipe. Au plaisir de mieux vous servir très bientôt. |
| `positif` | Bonjour, merci beaucoup pour votre message ! Toute l'équipe est ravie que vous ayez apprécié votre commande. À très bientôt ! |
| `positif_mais` | Bonjour, merci pour votre message, nous sommes ravis que vous ayez apprécié ! Nous prenons note de votre remarque pour que la prochaine commande soit parfaite. À très bientôt ! |

- `verifierReponse(texte)` → liste de problèmes en français (vide = envoyable) :
  vide ; plus de **250 caractères** (limite du champ Glovo, `maxLength=250`
  relevé dans le portail) ; un **chiffre** ; un nom de restaurant ou de marque
  (« Samer », « Kayan », « Yango », « Uber », « Jumia »…). Règles Glovo (aide du
  portail) : pas de publicité ni promotion, pas d'autre marque, pas de demande
  de suppression d'avis ; modération pouvant prendre quelques jours.

## Écran — Avis → onglet « À répondre » (manager seulement)

- Avis Glovo avec texte, sans `reponses_avis` ou en `refusee`, du plus récent
  au plus ancien, filtrables par restaurant comme les autres onglets.
- Chaque carte : date, restaurant, 👍/👎, texte du client, plat ; dessous la
  réponse proposée (ou le texte refusé + l'erreur).
- **Valider** → `validee`. **Modifier** → champ éditable avec compteur « n / 250 » ;
  Valider est bloqué tant que `verifierReponse` signale un problème (message
  en clair : « Retirez le chiffre », « Trop long : 263 / 250 »…).
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
  positif avec « mais » ; chaque modèle passe `verifierReponse` (≤ 250, aucun
  chiffre, aucune marque) ; `verifierReponse` refuse chiffre, longueur, marque.
- Tests du moteur (`lib/boutonAvis.test.mjs`) : choix des réponses à
  envoyer, avis déjà répondu sauté, regroupement des résultats.
- Tests du relais (`lib/envoiAvis.test.mjs`) : résumé « réponses envoyées ».
- Premier envoi réel : une seule réponse, choisie avec l'utilisateur, vérifiée
  dans le portail avant d'ouvrir à toutes.
