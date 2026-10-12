# Fournisseurs administratifs — conception

Date : 12/10/2026 · Validé avec l'utilisateur (QCM du 12/10).

## But

Les impôts et charges administratives d'un restaurant (TEE, ITS, Timbre, CNPS,
mairie…) deviennent des **fournisseurs administratifs** : un crédit par
restaurant qui monte tout seul à chaque échéance (mensuelle ou annuelle) et que
le gérant paie avec les espèces de caisse, directement à l'organisme.

Ils remplacent :
- les fournisseurs « cotisation » CNPS / TEE / ITS / Impôt (on les transforme) ;
- les charges TEE / ITS / Timbre / CNPS de Trésorerie → À payer (elles disparaissent).

Loyer, Salaire et Bail ne changent pas : ils restent dans la Trésorerie, avec
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
| Trésorerie TEE/ITS/Timbre/CNPS | Disparaît |

## 1. Données (migration `supabase_fournisseurs_administratifs.sql`, idempotente)

La colonne `fournisseurs.type` existe déjà (`fournisseur` | `cotisation`). On
ajoute la valeur **`administratif`**, et trois colonnes :

- `echeance_montant bigint` — montant ajouté à chaque échéance ;
- `echeance_periodicite text` — `mensuel` | `annuel` (CHECK) ;
- `prochaine_echeance date` — date de la prochaine échéance à ajouter.

Les trois ne servent que pour `type = 'administratif'`.

**Échéances automatiques** — pas de pg_cron sur ce projet. Une fonction RPC
`fournisseurs_admin_echeances()` ajoute toutes les échéances arrivées
(`prochaine_echeance <= current_date`) : pour chacune, une écriture
`inserer_transaction_hors_point(fournisseur, date_echeance, montant, 0, …, source 'echeance_admin')`,
puis `prochaine_echeance` avance d'un mois ou d'un an. Boucle tant qu'il reste
une échéance passée (rattrapage de plusieurs mois si personne n'a ouvert l'app).
Verrou `FOR UPDATE` sur le fournisseur : deux appareils en même temps
n'ajoutent pas deux fois la même échéance. Appelée (`.catch` silencieux) à
l'ouverture de Crédits fournisseurs, Déductions gérant et Trésorerie.

Transformer un fournisseur : simple `UPDATE` du type + des trois colonnes. Son
`credit_actuel` et ses transactions ne bougent pas. Repasser en marchandise
remet les trois colonnes à NULL (plus d'échéance).

## 2. Création et modification

- **Crédits fournisseurs → onglet Administratifs** (RH + manager) : bouton
  « + Fournisseur administratif » — nom, restaurant, montant, mensuel/annuel,
  date de la 1re échéance (au calendrier, `ChampDate`), crédit de départ.
  Le crédit de départ passe par l'écriture de correction existante
  (`ajustement_manager`) : c'est un vieux retard, pas une charge du mois.
- Sur chaque fiche : « Modifier » (nom, montant, périodicité, prochaine
  échéance, type). C'est là qu'on transforme un fournisseur existant.
- **Paramètres → Fournisseurs** (manager) : le sélecteur de type passe de
  `fournisseur / cotisation` à `fournisseur / cotisation / administratif`, avec
  les champs d'échéance quand « administratif » est choisi.

## 3. Crédits fournisseurs

Deux onglets, chacun avec son total dû :
- **Fournisseurs** : tout sauf `administratif` (sections Fournisseurs /
  Cotisations inchangées) ;
- **Administratifs** : `type = 'administratif'`, avec sous chaque nom la
  prochaine échéance (« 25 000 F le 15/11 »).

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

- TEE, ITS, Timbre, CNPS retirés de : À payer, Mois dus par restaurant,
  saisie groupée, rappels, réglages des charges. Plus aucune échéance de ces
  catégories n'est générée.
- Les dûs déjà existants de ces catégories restent en base (historique) mais
  ne sont plus affichés ni comptés dans le total À payer : leur retard est
  reporté à la main dans le crédit de départ des administratifs.
- À payer affiche une ligne **Administratifs** (somme des crédits
  administratifs), séparée de la ligne Fournisseurs.

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
