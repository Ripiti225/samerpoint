# Le pont pousse aussi l'inventaire — POS Samer → Samtrackly

**Date :** 2026-08-20
**Portée :** extension du pont existant (`samtrackly-points`, cloud POS → Samtrackly)
**Dépend de :** `2026-08-17-pos-samer-vers-samtrackly-design.md` (shift, dépenses, présences — déjà en service)

> Ce document part d'un constat qui change la donne par rapport au § 9 du
> document du 17/08 : le prérequis qui y était décrit comme bloquant (mapping
> produit de comptage ↔ articles de vente) **est déjà construit** côté POS —
> table `inventaire_consommations`, recettes par défaut, `ventesParProduit()`.
> Le travail qui reste n'est donc pas de reconstruire ce mapping, mais
> d'étendre le pont pour qu'il pousse l'inventaire déjà calculé.

## 1. Ce qui existe déjà côté POS (vérifié le 2026-08-20)

- `produits_inventaire` : catalogue de comptage, avec un `code` texte
  (`p1`, `po2`, `f5`…) — **le même identifiant** que celui utilisé côté
  Samtrackly comme `produit_id` dans `inventaire_lignes` (`lib/constants.js`,
  `CATEGORIES_INVENTAIRE`). Aucune table de correspondance à construire : la
  jointure se fait par `code`.
- `inventaire_consommations (produit_id, article_id, quantite)` : la
  liaison un-à-plusieurs entre produit de comptage et articles de vente,
  posée par la migration 0022. `ventesParProduit()`
  (`modules/inventaire/service.ts`) l'utilise déjà pour calculer les vraies
  sorties par produit à partir des commandes payées du service.
- `inventaires_service` (une ligne par service clôturé) porte `valide`,
  et le déblocage manager `debloque_par` / `debloque_le` / `debloque_motif`
  (CHECK : motif obligatoire si déblocage), plus `montant_manquant` — décrit
  côté POS comme **information manager, jamais une retenue**.
- `inventaire_lignes` (POS) porte `stock_initial`, `entrees`, `sorties`,
  `stock_compte`, `ecart`, `quantite_expliquee`, `explication`.
- `entrees_stock` : réceptions saisies pendant le service, par produit.
- La clôture d'un service POS est **déjà refusée** tant que l'inventaire
  n'est ni validé ni débloqué (§6.10 du cahier des charges POS) : au moment
  où un service devient éligible au pont (`statut = 'CLOTURE'`), son
  inventaire est donc **toujours** dans un état résolu (validé ou débloqué),
  jamais entre les deux.

## 2. Ce qui manque

Rien côté calcul. Il manque uniquement le **transport** : rien dans
`pos-samer` n'écrit aujourd'hui dans les tables d'inventaire de Samtrackly
(`inventaires_shifts`, `inventaire_lignes`, `entrees_shift`) — vérifié par
recherche exhaustive dans le dépôt.

## 3. Où ça s'ajoute

Dans `transfererService()` (`supabase/functions/samtrackly-points/index.ts`),
**au même passage** que le shift — pas une fonction séparée. Ce point a
déjà résolu `pointId`, `caissierId` et `journee` ; les réutiliser évite une
deuxième résolution d'identité et garde une seule ligne de code qui décide
« ce service part vers ce point-là ».

Nouveau module pur `_shared/samtrackly-inventaire.ts` (même patron que
`samtrackly-shift.ts`) : aucun accès réseau, entièrement testable.

## 4. Correspondance des champs

### `inventaires_shifts` (Samtrackly)

| Colonne | Source |
|---|---|
| `point_id` / `caissier_id` / `restaurant_id` / `date` | repris de la résolution déjà faite pour le shift |
| `type_shift` | dérivé de l'heure d'ouverture réelle du service POS → le créneau `TYPES_SHIFTS` le plus proche (matin 08h, soir 16h, nuit 00h, double 12h) |
| `heure_debut` / `heure_fin` | `service.ouvert_le` / `service.cloture_le` |
| `valide` | toujours `true` à l'arrivée (le POS garantit déjà validé ou débloqué avant clôture) |
| `montant_a_deduire` | `inventaires_service.montant_manquant` **si validé normalement** ; **`0` si débloqué manager** — décision du 2026-08-20 : une retenue sur un comptage que le manager a lui-même admis incomplet serait injuste |
| `pos_service_id` *(colonne neuve, UNIQUE)* | `service.id` — même clé d'idempotence que `points_shifts.pos_service_id` |

### `inventaire_lignes` (Samtrackly), une ligne par produit compté côté POS

| Colonne | Source |
|---|---|
| `produit_id` | `produits_inventaire.code` |
| `stock_initial` / `sorties` / `explication` | identiques, mêmes noms côté POS |
| `stock_reel` | `inventaire_lignes.stock_compte` (POS) |
| `nombre_explique` | `inventaire_lignes.quantite_expliquee` (POS) |
| `ecart` | `inventaire_lignes.ecart` (POS), déjà calculé |
| `montant_deduit` | `ecart × prix` si validé normalement, `0` si débloqué (cohérent avec `montant_a_deduire`) |
| `explication_statut` | **`'en_attente'`** dès qu'il y a une explication (texte ou `nombre_explique > 0`) ET un écart non nul — décision du 2026-08-20, confirmée : une explication écrite dans le POS doit repasser par le vérificateur Samtrackly (écran `verification.js`), exactement comme une explication saisie à la main aujourd'hui. Même condition que `app/inventaire.js:631`. Le déblocage manager côté POS ne dispense donc PAS de cette revue — il évite seulement la retenue automatique (§ montant_a_deduire), il ne valide pas les explications à la place du vérificateur. |

### `entrees_shift` (Samtrackly)

Une ligne par ligne de `entrees_stock` (POS), **sauf le produit de code
`b7`** (Darina) dont Samtrackly attend l'entrée directement dans
`inventaire_lignes.entrees` plutôt que dans une table séparée (particularité
déjà présente côté Samtrackly, à respecter telle quelle).

## 5. Idempotence

- `inventaires_shifts` : `upsert` sur `pos_service_id` (migration à ajouter :
  colonne neuve, `UNIQUE`, même patron que `supabase_pos_bascule.sql` pour
  `points_shifts`).
- `inventaire_lignes` / `entrees_shift` : purge puis réinsertion, scopée à
  `inventaire_id` — c'est déjà le mécanisme utilisé par `app/inventaire.js`
  lui-même pour ses propres sauvegardes, et sans risque ici puisque ces
  lignes ne sont jamais éditées à la main côté Samtrackly une fois venues du
  POS.

## 6. Ce que ce chantier ne change PAS

- Le contournement posé le 2026-08-20 dans `app/recap-point.js`
  (`pointVenuDuPOS` : un point contenant au moins un shift `pos_service_id`
  peut être validé même sans ligne d'inventaire) **reste en place**. Il sert
  de filet de sécurité : si le push d'inventaire échoue un jour (bug, timeout
  du pont), le point reste validable — seule la retenue manque ce jour-là, la
  validation du point n'est jamais bloquée par une panne de ce chantier.
- Rien ne change côté POS : `montant_manquant` y reste « information
  manager, jamais une retenue » — c'est uniquement une fois arrivé côté
  Samtrackly que le nombre devient une vraie retenue, via le mécanisme déjà
  existant du vérificateur.

## 7. Migration Samtrackly

Un seul ajout : `inventaires_shifts.pos_service_id UUID UNIQUE` — fichier
`supabase_pos_inventaire.sql`, sur le même patron que
`supabase_pos_bascule.sql` (rejouable, `IF NOT EXISTS`).

## 8. Tests

`_shared/samtrackly-inventaire.test.ts` (même esprit que
`samtrackly-shift.test.ts`) : construction d'une ligne d'inventaire à partir
d'un service + ses lignes POS, cas validé vs débloqué (montant à 0),
détection de l'explication en attente, gestion du produit `b7`.
