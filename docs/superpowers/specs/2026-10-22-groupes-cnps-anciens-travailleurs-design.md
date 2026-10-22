# Groupes de restaurants, arriérés CNPS et import des anciens travailleurs — conception

Date : 22/10/2026 · Validé avec l'utilisateur (QCM du 22/10).
Sources : `~/Downloads/DETTE CNPS.xlsx` et `~/Downloads/depart par restaurant.xlsx`.

## But

1. Créer des **groupes** de restaurants (Groupe Samer, Groupe Al Kayan) capables
   de porter des dettes administratives qui n'appartiennent à aucun restaurant.
2. Mettre les **arriérés CNPS** (compte CNPS par marque) sur la fiche du groupe.
3. Importer les **droits des anciens travailleurs** (une fiche par personne) à
   partir du fichier Excel.

## Décisions (QCM du 22/10)

| Question | Réponse |
|---|---|
| Découpage | Samer = Palmeraie, Angré 7E, Maroc, Oasis, Lavage (et Saint André, absent de la base). Al Kayan = Yop, KMS. À la Braise : aucun groupe. |
| Où mettre la dette CNPS | Ni sur un restaurant ni répartie : sur un **groupe** |
| Qui paie | Arriérés (groupe) : **direction seulement**. Nouvelles cotisations : fiche CNPS **de chaque restaurant** (inchangé). |
| Coupure | Arriérés = jusqu'à **septembre 2026** inclus ; par restaurant à partir d'octobre 2026 |
| Al Kayan | Fiche d'arriérés créée **à 0**, montant saisi plus tard dans l'app |
| Détail CNPS Samer | **Une ligne par mois** (61 lignes) |
| Anciens à importer | **Tout le monde** (72 des onglets par restaurant) + TAPE BARRY, ETTIEN N'DA, LAGO AUDREY = 75 |
| Zone 4 (onglet « autres ») | Sur le **Groupe Samer** |
| 3 fiches Angré existantes | **Corrigées selon le fichier** |
| Anciennes fiches globales « ANCIEN TRAVAILLEURS » | **Toutes remplacées** (remise à 0 tracée + désactivation) |
| Paiement d'arriérés de groupe dans le résultat net | **Au global seulement** (« tous restaurants »), jamais dans un restaurant seul |

## 1. Données — migration `supabase_groupes_restaurants.sql` (idempotente, passée par l'utilisateur)

```sql
CREATE TABLE IF NOT EXISTS groupes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE restaurants  ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE SET NULL;
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS groupe_id uuid REFERENCES groupes(id) ON DELETE RESTRICT;
-- Une fiche de groupe est administrative et n'a pas de restaurant.
CHECK (groupe_id IS NULL OR (restaurant_id IS NULL AND type = 'administratif'))
```

- Groupes créés : `Groupe Samer`, `Groupe Al Kayan`.
- `restaurants.groupe_id` : 5 restaurants Samer → Groupe Samer ; Al Kayan Yop et
  Al Kayan KMS → Groupe Al Kayan ; À la Braise → NULL. Rattachement par **id**
  (les noms en base ont des espaces finaux).
- Les dépenses direction gardent `restaurant_id` NULL pour un paiement de groupe
  et reçoivent `groupe_id` (nouvelle colonne nullable sur `tresorerie_depenses_direction`), pour savoir d'où vient le paiement.
- Une fiche de groupe : `facture_mensuelle = 0` (pas d'échéance automatique).
- RLS : mêmes règles ouvertes que les tables voisines (voir `security-posture`).

## 2. Arriérés CNPS

- Fiche **« CNPS — arriérés »** (`type = 'administratif'`, `groupe_id`) pour chaque groupe.
- Groupe Samer : 61 écritures `ajustement_manager` (montant dû, **jamais une charge**),
  une par ligne du fichier, dans l'ordre, avec une raison lisible :
  « CNPS juin 2020 », « Redressement 2019 », « DISA 2024 »… Montants arrondis au
  franc (les lignes 2025 ont des décimales). La DISA 2025 vide est ignorée.
  Total : **43 440 751 F** (contrôlé par l'import ; écart d'arrondi éventuel
  affiché et accepté par l'utilisateur avant l'écriture).
- Groupe Al Kayan : fiche créée à 0 F ; montant ajouté plus tard via
  « Ajouter un montant dû ».
- Les fiches CNPS par restaurant (type `cotisation`) ne sont pas touchées par ce
  chantier ; leur passage en administratif avec échéance mensuelle dès octobre
  2026 reste fait par l'utilisateur (« Passer en administratif »).

## 3. Anciens travailleurs

Une fiche par personne, créée comme `creerDroitAncien()` le fait
(`lib/droitsAnciensTravailleursDb.js`) : `type = 'administratif'`, `depart_le`,
`depart_motif`, `facture_mensuelle = 0`, puis écritures :
1. `+ montant` raison « Droits à la sortie » ;
2. si déjà réglé : `− réglé` raison « Déjà payé avant l'app » (ajustement, pas une charge).

`depart_motif` = « motif — observation » (ex. « Démission — réclame toujours »).

| Onglet du fichier | Rattachement |
|---|---|
| palmeraie | Samer Palmeraie |
| angre | Samer Angré 7E |
| maroc | Samer Maroc |
| OASIS | Samer Oasis |
| lavage | Samer Lavage |
| AL KAYAN | Al Kayan Yop |
| koum | Al Kayan KMS |
| autres (Zone 4) | Groupe Samer (pas de restaurant) |

Feuil1, Feuil2, Feuil3, Feuil4 sont des brouillons : ignorés, sauf pour trois
personnes ajoutées depuis Feuil1 :
- TAPE BARRY — Palmeraie — 328 971, déjà payé 50 000 — Licenciement 30/06/2025 (observation du brouillon Feuil3 : « réclame toujours ») ;
- ETTIEN N'DA — Maroc — 1 000 000 — 10/04/2025 — sans motif ;
- LAGO AUDREY — Al Kayan Yop — 129 345 — Démission 12/07/2025.

Le montant déjà payé est lu **ligne par ligne** (colonne « montant réglé »), pas
dans la ligne TOTAL des onglets (celle de Maroc est fausse : 0 au lieu de 100 000).

Fiches existantes (Angré) : BAMBA LATIF → dû 87 960 ; BOUDA ANNE MARIE → dû 85 768,
départ 30/09/2022 ; YANKINE AYOUBA OUMAR → 239 500 (inchangé). Correction via la
même logique que `modifierDroitAncien()` (écriture de différence, pas
d'écrasement). Pas de doublon : rapprochement par restaurant + nom normalisé
(majuscules, sans accents, apostrophes ’ → ').

Anciennes fiches globales « ANCIEN TRAVAILLEURS » (une par restaurant) : même
logique que `remplacerAncienneFiche()` — écriture de remise à 0 puis `actif = false`.

## 4. Écrans

- **Crédits fournisseurs → onglet Administratifs** : en tête, une section par
  groupe (« Groupe Samer », « Groupe Al Kayan ») avec ses fiches ; le total
  « Dû aux administrations » les inclut. Le filtre par restaurant ne les montre
  pas ; la vue « tous » les montre. Export Excel : idem.
- **Direction → À payer** : les fiches de groupe apparaissent sous leur groupe ;
  paiement direction comme une fiche administrative (dépense direction
  `administratif`, `restaurant_id` NULL, `groupe_id` renseigné).
- **Déductions gérant** : les fiches de groupe n'apparaissent jamais (pas de restaurant).
- **Création manuelle** (RH, manager) : dans « + Fournisseur administratif », le
  choix du restaurant propose aussi les deux groupes. Pour un groupe, pas
  d'échéance automatique.
- **Paramètres → Restaurants** : hors périmètre (le rattachement est posé par la
  migration ; un changement de groupe passe par une demande).

## 5. Résultat net

- Une dépense direction `administratif` **avec `groupe_id`** compte dans le
  résultat **« tous restaurants »** du mois du paiement, et dans aucun
  restaurant pris seul. Aujourd'hui une dépense direction sans `restaurant_id`
  n'entre jamais dans le résultat (`lib/direction.js`, `compteDansResultat`) :
  on ajoute ce cas, sans changer les autres.
- Le montant dû (ajustements) reste hors résultat, comme pour toute fiche administrative.
- Texte d'aide de Résultats complété en une phrase.

## 6. Import

Script `scripts/import-cnps-anciens/` (Node, lit les deux .xlsx avec `xlsx`) :
1. **Contrôle** (sans écriture) : produit `controle.csv` + un récapitulatif —
   personne par personne (restaurant, date, motif, montant, déjà payé, reste,
   action : créer / corriger / ignorer), total par restaurant, total CNPS par
   année. L'utilisateur le valide.
2. **Écriture** : un seul fichier SQL généré (`import.sql`), en une
   transaction, idempotent (repérage par nom normalisé + restaurant/groupe et
   par une raison d'écriture marquée `[import 22/10]`), passé par l'utilisateur
   ou par moi après accord explicite.

Totaux attendus : anciens travailleurs 7 283 065 F (72 personnes)
+ 278 971 + 1 000 000 + 129 345 = **8 691 381 F** pour 75 personnes ;
CNPS Samer **43 440 751 F**.

## 7. Tests

- `lib/*.test.mjs` : résultat net — une dépense direction de groupe compte au
  global, pas dans un restaurant ; une dépense direction sans restaurant ni
  groupe ne compte toujours pas.
- Fonction pure de lecture/normalisation de l'import (noms, rattachement par
  onglet, réglé ligne par ligne) testée sur des lignes du fichier.
- `npm run lint` à 0 erreur.

## Hors périmètre

- Le passage des fiches CNPS par restaurant en administratif avec échéance mensuelle (fait par l'utilisateur dans l'app).
- Une gestion des groupes à l'écran (création, changement de groupe d'un restaurant).
- Les pénalités de retard CNPS (absentes du fichier).
