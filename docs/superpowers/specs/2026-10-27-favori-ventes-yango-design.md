# Favori « Ventes Yango → Samtrackly » — conception (27/10/2026)

## Pourquoi

L'export Excel du portail Yango ne marche plus. Une seule semaine Yango a été importée dans
Trésorerie → Partenaires (25/09 → 01/10) ; les semaines suivantes restent sur l'estimé.
On remplace le fichier par un favori Chrome qui lit les ventes et la pub directement sur le
portail, avec la même logique que la skill `rapport-commandes-yango`.

## Vérifié sur le portail le 26/10/2026 (semaine 25/09 → 01/10)

Relecture par l'API du portail comparée à l'export Excel importé le 03/10 :

| | Export Excel | Portail (API) |
|---|---|---|
| Lignes lues (24/09 → 01/10) | 500 | 500 |
| Coupées avant 22h le 1er jour / après 22h le dernier | 44 / 13 | 44 / 13 |
| Non payables / annulées | 6 / 20 | 6 / 20 |
| Gardées · Montant | 417 · 2 262 600 | 417 · 2 262 600 |
| Par code (PALM, 7E, MRC, ALK1, LVG, KMS, OASIS) | identique | identique |

Correspondance des colonnes (exacte) :

| Colonne de l'export | Champ du portail |
|---|---|
| Nom du restaurant | `nom (adresse)` de `places/v2/search` |
| Numéro de la commande | `order_nr` |
| Montant | `sum` (= `total_sum`, `discount` toujours 0) |
| Statut | `status` : `refused` → « Annulé », sinon « Livré » |
| La commande sera payée | `is_reimbursement_to_place` → « Oui » / « Non » |
| Commande confirmée par le restaurant | `place_confirmed_at`, en UTC (= heure d'Abidjan) |

Pub : `POST /4.0/restapp-front/reports/v1/place-metrics/get`, métrique `cpa_advert_costs`,
une boutique à la fois, `group_by: day`. Semaine 25/09 → 01/10 : 127 193 F (Palmeraie 81 265,
7E 36 219, St André 7 135, Al Kayan Pizza 1 088 + 1 486). **Yango ne met plus ces chiffres à
jour depuis le 06/10** (« Mis à jour 6 octobre » sur le portail, 0 F chaque jour depuis).

## Décisions

1. **Annulées « Sera payée » comptées.** Yango les rembourse au restaurant. Seules les
   commandes « La commande sera payée = Non » sont écartées. S'applique aussi à l'import
   par fichier Excel (une seule règle). Écart volontaire avec la skill, qui les retirait.
2. **Le favori ouvre l'app directement** (pas de table d'attente, pas de fonction serveur,
   pas de secret) : il faut être connecté à Samtrackly dans le même Chrome.
3. **Pub lue sur le portail**, pré-remplie par restaurant, jamais à 0 par défaut quand
   Yango n'a pas encore compté la période.

## Déroulé

1. Sur n'importe quelle page de vendor.yango.com, on clique sur le favori. Dans le même
   geste, il ouvre la fenêtre `<origine>/tresorerie-partenaires?favori=yango`.
2. Le favori repère la connexion du portail : il écoute la prochaine requête que la page fait
   elle-même vers `/4.0/restapp-front/` et en reprend les en-têtes, qu'il garde en mémoire
   dans la page. Rien ne sort du portail à part les commandes et les pubs.
3. Dans la fenêtre Samtrackly, l'écran d'import Yango s'ouvre en mode favori et propose les
   semaines Yango (vendredi → jeudi) : par défaut la dernière terminée, avec les 4 précédentes
   (le portail refuse au-delà d'environ 5 semaines).
4. La semaine choisie, l'app demande au favori `{ type: 'lire', debut, fin }`. Le favori lit :
   - les boutiques (`places/v2/search?limit=999&filter=all`) ;
   - les commandes du **jeudi d'avant** au **jeudi de fin** (`eats-restapp-orders/v2/history`,
     pages de 50 avec curseur), comme l'export ;
   - la pub de chaque boutique, jour par jour, du vendredi au jeudi.
5. Le favori renvoie `{ type: 'ventes', lignes, pubs, pubAJourAu }` :
   - `lignes` = tableau au format exact de la feuille Excel (ligne d'en-têtes
     `COLONNES_YANGO` puis une ligne par commande) ;
   - `pubs` = `[{ nom, montant }]` par boutique (`nom (adresse)`) ;
   - `pubAJourAu` = dernier jour compté par Yango (champ `updated_at` s'il existe, sinon
     dernier jour où une boutique a une pub non nulle).
6. L'app passe `lignes` à `analyserYango` (le même code que pour le fichier) : même écran de
   contrôle qu'aujourd'hui (coupure 22h/21h, restaurants à associer, total SOUS TOTAL).
7. En plus, un bloc « Pub Yango » montre la pub par restaurant (codes de boutique → code
   restaurant par `codeYango`, puis restaurant par la table de correspondance, comme les
   ventes) :
   - si `pubAJourAu` ≥ dernier jour de la semaine : pub cochée, enregistrée avec l'import
     (`ajouterPubs`, note « Lue sur le portail Yango ») ;
   - sinon : « Yango n'a compté la pub que jusqu'au JJ/MM : elle n'est pas enregistrée.
     Recliquez sur le favori plus tard. » Rien n'est enregistré, l'import des ventes passe ;
   - si des pubs existent déjà pour cette période : rien n'est ajouté, on l'affiche
     (« déjà saisie : X F ») pour ne jamais compter deux fois.
8. « Importer » enregistre exactement comme aujourd'hui (`enregistrerAlias` +
   `importerExport`, fichier noté « Favori Yango du JJ/MM »), puis la pub si elle est cochée.

## Pièces

| Fichier | Rôle |
|---|---|
| `public/bouton-ventes-yango.js` | Moteur du favori, servi tel quel (fonction `moteurVentesYango()`, sur le modèle de `public/bouton-avis.js`) : connexion, lecture, conversion en lignes, échanges avec la fenêtre. |
| `lib/boutonVentesYango.js` | `construireFavoriVentes(source, { origine })` : emballe le moteur dans un lien `javascript:`. |
| `lib/ventesYangoFavori.js` | Logique pure côté app : semaines proposées, regroupement des pubs par restaurant, état « à jour / pas à jour / déjà saisie ». |
| `lib/partenairesImport.js` | `analyserYango` : les annulées payées ne sont plus écartées. |
| `app/tresorerie-partenaires.js` | `FeuilleImport` : deuxième source « Commandes lues par le favori » + bloc pub ; ouverture automatique avec `?favori=yango`. |
| `app/bouton-ventes-yango.js` | Écran d'installation du favori (lien à glisser dans la barre de favoris), accessible depuis la carte Yango de Partenaires. Pas de secret. |

## Erreurs (en français, sans code technique)

- Favori cliqué hors de vendor.yango.com → « Ouvre le portail Yango, puis clique à nouveau
  sur le favori. »
- Fenêtre bloquée par Chrome → « Chrome a bloqué la fenêtre : autorise les fenêtres pour ce
  site, puis clique à nouveau. »
- Aucune requête de la page en 20 s → « Le portail ne répond pas : recharge la page Yango
  puis clique à nouveau. »
- 401/403 → « Ta session Yango a expiré : reconnecte-toi au portail puis clique à nouveau. »
- Pas connecté à Samtrackly dans la fenêtre → l'écran de connexion s'affiche ; le message
  dit de se connecter puis de recliquer sur le favori.
- Fenêtre ouverte sans favori → l'écran d'import classique (fichier Excel).
- L'app n'écoute que les messages venant de `https://vendor.yango.com` et de sa fenêtre
  d'origine (`window.opener`).

## Tests (`node:test`)

- `lib/partenairesImport.test.mjs` : annulée payée gardée, non payable écartée.
- Moteur : conversion d'une commande du portail en ligne d'export (statut, Oui/Non, date
  UTC `AAAA-MM-JJ hh:mm:ss`) ; semaine → bornes de lecture (jeudi → jeudi) ; pub par
  boutique ; `pubAJourAu`.
- Fixture tirée de la semaine du 25/09 (forme exacte du portail, sans données client) :
  `analyserYango` sur les lignes converties redonne 417 + 20 annulées payées et les totaux
  par code de l'export (avec les annulées payées en plus).
- `lib/ventesYangoFavori.js` : semaines proposées, pub à jour / pas à jour / déjà saisie.

## Hors périmètre

- Pas de lecture automatique sans clic, pas de favori sur iPhone (le favori tourne sur le
  portail, dans Chrome sur ordinateur).
- Le favori Avis ne change pas.
- La skill `rapport-commandes-yango` (fichier Excel) n'est pas modifiée ici ; elle retire
  encore les annulées payées.
