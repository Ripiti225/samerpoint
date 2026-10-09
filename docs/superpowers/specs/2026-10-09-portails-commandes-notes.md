# Repérage des commandes sur les portails Glovo et Yango (09/10/2026)

Tâche 0 du plan `docs/superpowers/plans/2026-10-09-litiges-plateformes-auto.md`.
Relevé dans Chrome, session d'Ange connectée, sans lire ni copier aucun jeton.
Fixtures : `lib/fixtures/commandes-glovo.json`, `lib/fixtures/commandes-yango.json`.

## Glovo — `portal.glovoapp.com`

Même API GraphQL que les avis : `POST https://vagw-api.eu.prd.portal.restaurant/query`,
en-tête `Authorization: Bearer <jeton>` (le moteur le lit déjà dans `persist:root`,
fonction `jetonGlovo()`).

### Liste : `ListOrders`

```graphql
query ListOrders($params: ListOrdersReq!) {
  orders { listOrders(input: $params) {
    nextPageToken resultTimestamp
    orders { orderId globalEntityId vendorId vendorName orderStatus placedTimestamp subtotal
      billableStatus deliveryType billing { commissionAmount netRevenue }
      orderIssuesDetails { orderIssue metadata { reason amount deduction fee avoidableWaitTime baseWaitTimeFeeThresholdMinutes } }
      totalFeesAndDeductions }
  } }
}
```

Variables : `{ params: { pagination: { pageSize: 50, pageToken? }, timeFrom: 'AAAA-MM-JJT00:00:00.000Z', timeTo: 'AAAA-MM-JJT23:59:59.999Z', globalVendorCodes: [{ globalEntityId: 'GV_CI', vendorId: '84806' }, …], useRefundStreamIssueSource: false } }`.
Page suivante : `pagination.pageToken = nextPageToken` tant que `nextPageToken` est non nul.
Volume : 69 commandes le 08/10 pour les 9 boutiques (2 pages).

**La liste ne contient pas les plats.** Elle porte en revanche toutes les retenues :

| `orderIssue` | Sens | Montant |
|---|---|---|
| `AVOIDABLE_WAIT_TIME` | attente du livreur | `metadata[].fee` (souvent 0 ; ex. 468 F pour 17 min) → **temps d'attente** si > 0 |
| `ORDER_WITH_DEDUCTION` (reason `…reasons.refund`) | client remboursé, retenu sur le virement | `metadata[].amount` (= `deduction` de l'entrée suivante) → **remboursement** |
| `ORDER_WITH_COMPLAINT` | réclamation (`WRONG_ORDER`, …) | pas de montant — ignoré |
| `AVOIDABLE_CANCELLATION` | annulée par le restaurant | hors périmètre |

Statuts vus : `DELIVERED` (→ `livree`), `CANCELLED` (→ `annulee`, jamais vendue chez Glovo) ;
le jour même, `ACCEPTED`, `READY`… (→ `autre`).

### Détail : `GetOrderDetails` (déjà utilisé par les avis pour l'heure)

Ajouter `items { name parentName quantity unitPrice options { name quantity unitPrice } }` à la
requête minimale `order { orderId placedTimestamp }`. `unitPrice` = **prix unitaire**.
Un menu est **une seule ligne** (« Tacos Viande + Frites + Coca-Cola… »), la boisson choisie
est dans `options` : on garde la ligne, on ignore les options.

Coût : un appel détail par commande (≈ 70 par jour), 4 en parallèle comme `ajouterHeures`.

### Boutique → restaurant

`boutique = globalEntityId + ';' + vendorId` (ex. `GV_CI;84806`) : clé déjà présente dans
`review_store_mapping` pour les 9 boutiques.

## Yango — `vendor.yango.com`

Même principe que les avis : on capte une requête de la page et on réutilise ses en-têtes
(`new Request(url, { headers: modele.headers, credentials: 'include' })`).
Page de départ : **Histoire** (`/history`).

### Liste

`POST /4.0/restapp-front/eats-restapp-orders/v2/history?limit=50[&cursor=<meta.cursor>]`
Corps : `{ from: 'AAAA-MM-JJ', to: 'AAAA-MM-JJ', place_ids: [ … 14 boutiques … ] }` (+ `status`
si un filtre est actif sur la page : **le retirer**).
Réponse : `{ orders: [...], summary, meta: { can_fetch_next, cursor } }`.
Volume : 76 commandes le 08/10 ; 478 sur 7 jours.

Champs utiles : `order_nr` (ex. `261008-CI0870074`), `status` (`released` = livrée,
`refused` = annulée), `place_id`, `place_confirmed_at`, `sum`, `summary_date`,
**`is_reimbursement_to_place`** = la pastille « Sera payée ».

**Annulée mais payée** : `status = 'refused'` et `is_reimbursement_to_place = true`.
Vérifié sur les annulées des 7 derniers jours : vrai pour « coursier indisponible »,
« client injoignable », « client a annulé » ; faux pour « l'utilisateur n'a pas accepté les
modifications ». `montant_paye = is_reimbursement_to_place ? sum : 0`.

### Détail

`GET /4.0/restapp-front/eats-restapp-orders/v1/history/order?order_nr=<n°>`
Champs : `created_at`, `status`, `sum`, `is_reimbursement`, `cancel_reason`,
`items[] { name, quantity, sum, original_sum, category_name }`, `combos[]`, `place { id, name }`.
`items[].sum` = **prix unitaire** (2 × Chawarma mélange : `sum` 3000, total 6000) ;
`original_sum` = prix avant promo. `combos` était vide sur les 50 commandes du 08/10 :
les menus sont des lignes ordinaires.

### Boutique → restaurant

`boutique = String(place_id)` : clé déjà présente dans `review_store_mapping`
(toutes les boutiques vues le 08/10 sont rattachées).

### Retenues

**Ni remboursement ni pénalité d'attente** dans la liste ou le détail Yango.
→ `RETENUES_FOURNIES.yango = []`. C'est cohérent avec Samtrackly : Litiges → Yango n'a que
« Tapé − » et « Tapé + » (`TYPES_YANGO`), remboursement et temps d'attente n'existent que
pour Glovo (confirmé par Ange le 09/10).

## Conséquences sur le plan

- Format normalisé inchangé ; numéro Yango = `order_nr` complet, ses 4 derniers chiffres
  servent au rapprochement (`261008-CI0870074` → `0074`).
- Heure Glovo = `placedTimestamp` ; heure Yango = `created_at` du détail (repli :
  `place_confirmed_at` de la liste).
- `RETENUES_FOURNIES = { glovo: ['remboursement', 'temps_attente'], yango: [] }`.
- Attention : une commande Yango « annulée mais payée » que le caissier a annulée dans le
  POS ressortira en **tapé −**. Confirmé par Ange le 09/10 : elle est payée, donc vendue.
