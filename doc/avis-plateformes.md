# Avis clients Yango & Glovo — mise en service

Consolidation des notes et avis clients de **Yango** (étoiles 1-5) et **Glovo**
(pouce 👍/👎) dans SamerTrackly. Extraction quotidienne par Cowork + Chrome,
envoi à l'Edge Function `ingest-reviews`, qui dédoublonne, range et **crée un
litige pour chaque nouvel avis négatif**. Un même avis n'entre jamais deux fois.

## Ce qui a été construit

| Élément | Fichier |
|---|---|
| Schéma (avis, mapping, journal des extractions, vue hebdo) | `supabase_avis_plateformes.sql` |
| Ingestion serveur | `supabase/functions/ingest-reviews/index.ts` |
| Calculs (note moyenne, % négatifs, file à rattacher) | `lib/avisPlateformes.js` + tests |
| Accès base | `lib/avisPlateformesDb.js` |
| Écran back-office | `app/avis-plateformes.js` (tuile ⭐ **Avis clients**) |

### Adaptations au schéma réel

Le brief parlait d'une table `litiges` : elle n'existe pas. Les avis clients
vivent dans **`litiges_avis_clients`** (onglet « Avis clients » de l'écran
Litiges). Un avis négatif ingéré y crée une ligne `type = 'mauvais'`,
`montant = 1000`, `canal = 'yango' | 'glovo'`, `source = 'avis_plateforme'`,
`review_id` = l'avis d'origine.

> ⚠️ **Conséquence financière.** Chaque avis négatif ingéré compte 1000 FCFA à la
> charge du restaurant, exactement comme un avis saisi à la main. Sur un premier
> import couvrant plusieurs semaines, cela peut représenter une somme
> importante : lancer d'abord une extraction sur 3 jours pour voir le volume.
> Le montant est réglable par la variable d'environnement
> `LITIGE_MONTANT_MAUVAIS` de l'Edge Function.

## Mise en service — 4 étapes

### 1. Migration

Supabase → SQL Editor → coller `supabase_avis_plateformes.sql` → Run.
Idempotent, rejouable. Vérifie en fin de script que les 3 tables sont en RLS ON
et que `litiges_avis_clients` a bien `review_id` et `source`.

### 2. Secret + déploiement de la fonction

> ⚠️ **`--project-ref` est obligatoire.** Le projet lié au CLI est
> `pos-samer-cloud`, pas Samtrackly : sans le drapeau, le secret et la fonction
> partent sur le POS.

```bash
# 1. Générer le token — le NOTER, Supabase ne le réaffichera jamais
openssl rand -hex 32

# 2. Le poser (remplacer <TOKEN> par la valeur affichée)
supabase secrets set INGEST_SECRET=<TOKEN> --project-ref wlwotzxnzowbkbfcpnyi

# 3. Déployer
supabase functions deploy ingest-reviews --project-ref wlwotzxnzowbkbfcpnyi --no-verify-jwt
```

Ne pas générer le token en ligne avec `$(openssl rand -hex 32)` : la valeur
ne s'affiche pas et elle est nécessaire telle quelle dans l'en-tête
`x-ingest-secret` de Cowork. Ce secret ne doit **jamais** être mis dans
l'app : l'app n'écrit pas les avis.

### 3. Premier envoi de test

Fait le 02/09/2026 : ingestion, dédoublonnage, rattachement et création du
litige vérifiés en production, données de test supprimées ensuite.

```bash
# Statut du jour
curl -H "x-ingest-secret: $INGEST_SECRET" \
  https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-reviews
# → { "done_today": false }

# Un avis de test
curl -X POST -H "x-ingest-secret: $INGEST_SECRET" -H "Content-Type: application/json" \
  -d '{"reviews":[{"platform":"yango","external_store_label":"Chez Samer Yopougon Maroc","rating_raw":2,"rating_scale":5,"comment":"Test","review_date":"2026-09-02","external_ref":"TEST-1"}]}' \
  https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-reviews
# → { received:1, inserted:1, duplicates:0, unmapped:1, litiges_crees:0,
#     labels_a_rattacher:["yango · Chez Samer Yopougon Maroc"] }
```

Renvoyer exactement la même requête doit donner `inserted:0, duplicates:1`.

### 4. Rattacher les boutiques

Application → **Avis clients** → onglet **À rattacher** → pour chaque boutique,
choisir le restaurant. Le rattachement reprend les avis déjà reçus et crée les
litiges des négatifs concernés.

C'est la seule étape manuelle : 9 boutiques Glovo et 17 restaurants Yango pour
7 restaurants SamerTrackly, les libellés ne se devinent pas. Elle ne se fait
qu'une fois — ensuite le mapping s'applique tout seul.

## Extraction quotidienne (Cowork + Chrome)

Trois créneaux le même jour : **11h**, **12h**, **13h**.

1. `GET` sur l'endpoint → si `done_today: true`, **s'arrêter** (le créneau
   précédent a réussi).
2. Extraire Glovo (`portal.glovoapp.com/reviews`) et Yango
   (`vendor.yango.com/feedback/places?from=J-3&to=aujourd'hui&period=day&service=all`)
   sur une **fenêtre de 72 h** — une journée entièrement ratée est ainsi
   rattrapée au prochain run, sans risque de doublon.
3. `POST` avec `{ "reviews": [...], "finalize": true }` — `finalize` uniquement
   sur l'envoi final, celui qui contient Glovo **et** Yango.

Champs par avis :

| Champ | Yango | Glovo |
|---|---|---|
| `platform` | `"yango"` | `"glovo"` |
| `external_store_label` | nom du restaurant Yango | nom de la boutique Glovo |
| `external_ref` | n° de commande (`260901-CI6438910`) | n° de commande (`101760937850`) |
| `rating_raw` / `rating_scale` | étoiles 1-5 / 5 | absent |
| `classification` | déduit (< 3 → négatif) | **obligatoire** : `bon` / `negatif` |
| `comment`, `review_date`, `raw` | oui | oui |

Sans `external_ref`, le dédoublonnage retombe sur le contenu de l'avis
(plateforme + boutique + date + note + commentaire) : moins fiable, un même
commentaire reposté le lendemain passerait deux fois. Toujours extraire le
numéro de commande quand il est affiché.

## Lire les résultats

- `inserted` : avis réellement nouveaux. `duplicates` : déjà connus (normal).
- `unmapped` : avis dont la boutique n'a pas de restaurant → onglet À rattacher.
- `rejected` : lignes ignorées (plateforme inconnue) — à investiguer si > 0.
- `litiges_crees` : avis négatifs devenus des litiges.

L'écran Avis clients affiche l'état de la dernière extraction en bas de page.
Si les KPI semblent figés depuis plusieurs jours, c'est que l'extraction ne
tourne plus (machine éteinte, session Chrome expirée).

## Ce qui n'est pas couvert

- Pas d'API partenaire : l'extraction dépend d'une machine allumée avec une
  session Chrome valide. Une demande d'accès API est en cours chez Glovo et
  Yango — c'est la seule voie vers du 24/7 sans machine.
- Les réponses aux avis et les recours restent **manuels** sur les portails.
