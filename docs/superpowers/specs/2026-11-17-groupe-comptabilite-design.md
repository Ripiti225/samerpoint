# Bannière « Comptabilité » à l'accueil — conception

Date : 17/11/2026 · Chantier 1 sur 3 de la comptabilité (puis clôture du mois, puis export SYSCOHADA).

## But

Rassembler sous une seule bannière de l'accueil les écrans qui parlent d'argent :
Trésorerie, Crédits fournisseurs, Salaires du mois, Rapports.

## Décisions validées

- **Pas de nouvelle page** : l'accueil manager/RH est déjà rangé en bannières
  (`GROUPES_ADMIN`, `lib/groupesAccueil.js`). On ajoute une bannière, on ne crée pas d'écran.
- **Manager et RH** : tous deux utilisent `GROUPES_ADMIN`. La RH ne voit dans la bannière
  que les écrans cochés pour elle dans Paramètres (filtrage déjà fait par `organiserAccueil`).
  Si elle n'en a aucun, la bannière n'apparaît pas (déjà le cas : groupes vides retirés).
- **Gérant inchangé** : `GROUPES_GERANT` n'est pas touché.
- **La bannière « Trésorerie » disparaît**, remplacée par « Comptabilité ».
  La Trésorerie reste aussi en **Accès direct** (`FAVORIS_ADMIN` inchangé).

## Changement

Dans `GROUPES_ADMIN`, à la place de la bannière `tresorerie` (même rang, en tête) :

```js
{ id: 'comptabilite', icone: 'calculator-variant', couleur: '#0E9F6E', fonce: '#047857',
  titre: 'Comptabilité', tuiles: ['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports'] }
```

- `rapports` sort de « Tableaux de bord » (reste : Dashboard global, Stats caissiers).
- `salaires` sort de « Personnel et documents ».
- Couleur verte de l'ancienne bannière Trésorerie conservée.

### Couleur des écrans (`GROUPES_THEME_ACTIFS`, `groupeDeRoute`)

Chaque écran prend la couleur de sa bannière. `'tresorerie'` est remplacé par `'comptabilite'`
dans `GROUPES_THEME_ACTIFS`. Conséquences visibles :

- Trésorerie (et tous ses sous-écrans `tresorerie-*`) et Crédits fournisseurs : **verts, inchangés**.
- **Rapports** : passe du violet (Tableaux de bord) au **vert**.
- **Salaires du mois** : passe des couleurs par défaut au **vert** (Personnel n'est pas un groupe coloré).

`groupeDeRoute` continue de ramener `tresorerie-*` à la tuile `tresorerie`, qui appartient
maintenant à `comptabilite` : aucune autre modification.

### Ce qui ne change pas

- Aucune route : notifications, recherche et liens directs marchent comme avant.
- Le catalogue `TUILES` et les droits (`roles_acces`, Paramètres) : aucune modification, pas de SQL.
- La RH garde sa Trésorerie ouverte directement sur « À payer » (`AccueilManager`).
- Les badges (ex. « 3 fiches paie à compléter » sur Salaires) remontent sur la bannière
  Comptabilité par le mécanisme existant (`badgeGroupe`).
- Bannières ouvertes mémorisées sur le téléphone (`CLE_OUVERTS`) : l'ancienne clé
  `tresorerie` devient inutile ; la bannière Comptabilité démarre fermée. Sans gravité.

## Tests (`lib/groupesAccueil.test.mjs`)

- Chaque tuile admin reste dans exactement un groupe (test existant, toujours vrai).
- Mise à jour des attentes qui nomment le groupe `tresorerie` → `comptabilite`.
- Nouveaux cas :
  - le groupe `comptabilite` contient exactement les 4 tuiles, dans cet ordre ;
  - RH avec seulement `tresorerie`, `credits-fournisseurs`, `salaires` → bannière à 3 tuiles ;
  - RH sans aucune des 4 → pas de bannière Comptabilité ;
  - `groupeDeRoute('/rapports')` et `groupeDeRoute('/salaires')` → `comptabilite` ;
  - `GROUPES_GERANT` inchangé (Crédits fournisseurs toujours dans « Dépenses »).

Vérification : `npm run lint` (0 erreur), `for f in lib/*.test.mjs; do node "$f"; done` (0 échec),
`npx expo export -p web`.

## Publication

Commit + push à la fin du chantier ; publication Vercel + EAS seulement quand l'utilisateur le décide
(les trois chantiers peuvent partir ensemble).
