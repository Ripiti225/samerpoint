# Fournisseurs administratifs — conception

Date : 12/10/2026 · Validé avec l'utilisateur (QCM du 12/10).

## But

Les impôts et charges administratives d'un restaurant (TEE, ITS, Timbre, CNPS,
bail, mairie…) deviennent des **fournisseurs administratifs** : un crédit par
restaurant qui monte tout seul à chaque échéance (mensuelle ou annuelle) et que
le gérant paie avec les espèces de caisse, directement à l'organisme.

Ils remplacent :
- les fournisseurs « cotisation » CNPS / TEE / ITS / Impôt / Bail (on les transforme) ;
- les charges TEE / ITS / Timbre / CNPS / Bail de Trésorerie → À payer (elles disparaissent).

Loyer et Salaire ne changent pas : ils restent dans la Trésorerie, avec
leurs cotisations et la « cotisation reçue (RH) ».

## Décisions (QCM)

| Question | Réponse |
|---|---|
| Rattachement | Par restaurant, comme les fournisseurs actuels |
| Qui crée / modifie | Le RH (et le manager) |
| Caissier | Ne les voit pas — gérant seulement |
| Échéance | Montant fixe, mensuel ou annuel selon le fournisseur, ajouté automatiquement |
| Retard existant | Saisi à la main par l'utilisateur, restaurant par restaurant (crédit de départ) |
| Fournisseurs existants | Transformables en administratifs (et inversement), crédit et historique conservés |
| Cotisations CNPS/TEE/ITS/Impôt | Deviennent administratives |
| Où va l'argent payé | Directement à l'organisme : sortie de caisse, rien d'autre |
| Payé par la direction | Possible (ajout du 12/10) : compté comme charge du restaurant à la fin du mois |
| Trésorerie TEE/ITS/Timbre/CNPS/Bail | Disparaît (bail ajouté le 12/10) |
| Crédits fournisseurs | « Dû aux fournisseurs » et « Dû aux administrations » côte à côte, toujours visibles |

## 1. Données (migration `supabase_fournisseurs_administratifs.sql`, idempotente)

La colonne `fournisseurs.type` existe déjà (`fournisseur` | `cotisation`, sans
contrainte) : on ajoute la valeur **`administratif`**.

**Échéances automatiques** : on réutilise la facture mensuelle automatique déjà
en service (`facture_mensuelle`, `facture_mensuelle_depuis`,
`appliquer_factures_mensuelles()`, appelée à l'ouverture des écrans, sans
pg_cron, jamais deux fois le même mois). Ajouts :
- `facture_periodicite text` — `mensuel` (défaut) | `annuel` : une échéance
  annuelle tombe le 1er du mois de départ, puis tous les 12 mois ;
- `administratif_depuis date` — posé par trigger au 1er du mois où la fiche
  devient administrative (remis à NULL si elle cesse de l'être). Sert au
  résultat net pour ne pas toucher aux mois passés.

Transformer un fournisseur : simple `UPDATE` du type et de l'échéance. Son
crédit et ses transactions ne bougent pas.

## 2. Création et modification

- **Crédits fournisseurs → onglet Administratifs** (RH + manager) : bouton
  « + Fournisseur administratif » — nom, restaurant, montant, mensuel/annuel,
  mois de la 1re échéance (puces). Le retard existant se saisit ensuite avec
  « Modifier » sur la fiche (écriture `ajustement_manager`) : c'est un vieux
  retard, pas une charge du mois.
- Sur chaque fiche : « Modifier » (nom, montant, périodicité, prochaine
  échéance, type). C'est là qu'on transforme un fournisseur existant.
- **Paramètres → Fournisseurs** (manager) : le sélecteur de type passe de
  `fournisseur / cotisation` à `fournisseur / cotisation / administratif`, avec
  les champs d'échéance quand « administratif » est choisi.

## 3. Crédits fournisseurs

En haut, toujours visibles, deux totaux côte à côte : **Dû aux fournisseurs**
et **Dû aux administrations**. En dessous, deux onglets :
- **Fournisseurs** : tout sauf `administratif` (sections Fournisseurs /
  Cotisations inchangées) ;
- **Administratifs** : `type = 'administratif'`, avec sous chaque nom la
  prochaine échéance (« 25 000 F / mois · prochaine : novembre 2026 »).

L'export Excel suit le même découpage (une feuille Administratifs en plus).

## 4. Déductions gérant

- 4e onglet **Administratifs**, qui réutilise `OngletFournisseurs` (dû de la
  veille, payé ce jour, photo) sur la liste filtrée `type = 'administratif'`.
- L'onglet Fournisseurs exclut les administratifs.
- Enregistrement identique aux fournisseurs (même tableau
  `fournisseursGerantCaisse`, mêmes transactions) : rien de nouveau côté point.

Les administratifs sont **exclus** des listes du caissier (Point shift), de
l'inventaire et des brouillons fournisseurs.

## 5. Trésorerie

- TEE, ITS, Timbre, CNPS, Bail retirés de : À payer, Mois dus par restaurant,
  saisie groupée, rappels, réglages des charges. Plus aucune échéance de ces
  catégories n'est générée.
- Les dûs déjà existants de ces catégories restent en base (historique) mais
  ne sont plus affichés ni comptés dans le total À payer : leur retard est
  reporté à la main dans le crédit de départ des administratifs.
- L'accueil Trésorerie affiche une tuile **Administrations** (somme des
  crédits administratifs) à côté de la tuile Fournisseurs.
- L'alerte « CNPS en retard » disparaît ; les rappels (y compris la fonction
  serveur `rappels-tresorerie`, à redéployer à la publication) ignorent ces
  catégories.

## 5 bis. Payé par la direction

Sur une fiche administrative de Crédits fournisseurs (manager, directeur) :
« Payé par la direction » — montant, date, compte (BACI, SIB, Espèces, têtes
de fond, Coffre), note. La RPC `tresorerie_payer_fournisseur_admin` crée en
une transaction : la sortie (banque ou coffre), le paiement sur le crédit du
fournisseur (`inserer_transaction_hors_point`, source `paiement_direction`) et
une dépense direction de catégorie `administratif` (avec `fournisseur_id`,
`transaction_id`), qui **compte dans le résultat** du restaurant.

Résultat du mois : échéance (+ crédit) − paiement direction (− crédit) = 0 de
variation ; la dépense direction porte la charge. Une échéance n'est donc
comptée qu'une fois, qu'elle soit payée par le gérant (encaissé) ou par la
direction (dépense direction).

Supprimer la dépense (Dépenses direction, appui long) retire aussi le paiement
du crédit ; la modifier est refusé par un trigger (supprimer puis ressaisir).

## 6. Résultat net

- Le résultat part de l'encaissé (paiements déjà retirés) et retire la
  variation du crédit fournisseurs (`lib/creditFournisseursMois.js`). Un
  fournisseur administratif y entre comme un fournisseur normal : paiement +
  hausse du crédit = échéances du mois. Les corrections `ajustement_manager`
  (dont le crédit de départ) sont déjà retirées depuis octobre 2026.
- `estFournisseurCharge` écarte aujourd'hui CNPS, TEE, ITS, Impôt **par le
  nom** : elle doit d'abord regarder le type — un `administratif` n'est jamais
  écarté.
- `lib/chargesMois.js` continue de compter les dûs TEE/ITS/Timbre/CNPS déjà
  créés (mois passés, déjà comptés) ; comme aucun nouveau n'est généré, il n'y
  a pas de double comptage tant que la 1re échéance automatique d'un
  administratif tombe après le dernier mois déjà dans la Trésorerie.
- Texte d'aide de l'écran Résultats mis à jour.

À vérifier pendant le plan : comment le résultat traite aujourd'hui les
paiements faits aux fournisseurs « cotisation », pour qu'un administratif
payé ne soit ni compté deux fois ni oublié.

## 7. Tests

Purs (`lib/*.test.mjs`, node:test) :
- calcul des échéances dues (mensuel, annuel, rattrapage de plusieurs
  périodes, fin de mois 31 → 30/28) ;
- découpage marchandise / administratif des listes ;
- `estFournisseurCharge` : un administratif nommé « CNPS » n'est pas écarté.

Lint 0 erreur, tous les tests verts, export web qui compile.

## 8. Livraison

Commit + push seulement, sans publication (Vercel / EAS à la fin, avec les
chantiers en attente). L'utilisateur passe la migration dans Supabase puis
transforme lui-même CNPS / TEE / ITS / Impôt de chaque restaurant en saisissant
leur montant dû.
