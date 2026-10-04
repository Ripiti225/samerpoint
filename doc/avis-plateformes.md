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

### 4. Mapping des boutiques

Supabase → SQL Editor → `supabase_avis_mapping_boutiques.sql` → Run.

Les 27 correspondances (8 Glovo + 19 Yango) fournies par Ange le 02/09/2026 y
sont déjà : rien à rattacher à la main au premier run. Un restaurant porte
plusieurs boutiques — les marques *S Burger*, *S Pizza*, *Al Kayan Pizza* sont
servies depuis la même cuisine.

| Restaurant | Glovo | Yango |
|---|---|---|
| Al Kayan KMS | 2 | 5 |
| Al Kayan Yop | 1 | 2 |
| Samer Angré 7E | 1 | 1 |
| Samer Lavage | 1 | 3 |
| Samer Maroc | 1 | 3 |
| Samer Oasis | 1 | 2 |
| Samer Palmeraie | 1 | 3 |

Une boutique qui apparaîtrait quand même dans l'onglet **À rattacher** est soit
nouvelle, soit envoyée avec un libellé qui ne correspond pas — voir ci-dessous.
Le rattachement manuel reste disponible : il reprend les avis déjà reçus et
crée les litiges des négatifs concernés.

## Envoi des avis : le bouton « ⭐ Avis → Samtrackly »

Les tâches Claude planifiées (11h/12h/13h) ont échoué à chaque exécution :
elles tournaient dans le cloud, sans Chrome ni accès aux portails. Elles sont
en pause depuis le 04/10/2026. Les avis arrivent désormais par un **favori
Chrome** cliqué par un humain déjà connecté aux portails.

- **Installation** (manager) : Avis clients → « 🔖 Installer le bouton avis »,
  coller le secret d'ingestion, glisser le bouton dans la barre de favoris.
- **Glovo** : clic sur le bouton depuis n'importe quelle page du portail.
- **Yango** : clic depuis la page **Avis** (filtre « Tous les restaurants »).
- Le bouton relit depuis le dernier avis reçu moins 3 jours (au plus
  45 jours pour Glovo, 30 pour Yango qui refuse plus de 5 semaines) ; le dédoublonnage absorbe les répétitions. Une petite fenêtre
  (`/envoi-avis.html`) envoie les avis et affiche le résultat.
- **Rappel** : sans envoi depuis 2 jours sur une plateforme, bandeau dans
  l'écran Avis clients et ligne dans la cloche (manager, directeur).
- **Secret changé** (`INGEST_SECRET`) → chaque utilisateur réinstalle le bouton.
- **Nouvelle boutique Glovo** : l'ajouter à `NOMS_GLOVO` dans
  `public/bouton-avis.js`, publier, réinstaller le bouton.

Code : `public/bouton-avis.js` (moteur), `public/envoi-avis.{html,js}`
(relais), `app/bouton-avis.js` (installation), tests
`lib/boutonAvis.test.mjs` et `lib/envoiAvis.test.mjs`.

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
