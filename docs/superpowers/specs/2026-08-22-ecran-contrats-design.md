# Écran Contrats autonome — design

**Date :** 2026-08-22
**Statut :** validé, prêt pour le plan d'implémentation
**Prédécesseur :** `2026-08-18-contrats-travailleurs-design.md` (table, formulaire, alertes)

## Problème

La gestion des contrats vit aujourd'hui dans un onglet de `app/rh.js`. Pour ajouter un
contrat il faut ouvrir Ressources Humaines, choisir un restaurant, trouver le travailleur,
ouvrir sa fiche. Trop d'étapes pour une tâche qui a sa propre logique et son propre rythme
(échéances, renouvellements).

Les contrats deviennent un écran à part entière, `/contrats`, où tout se gère.

## Décisions

| Question | Décision |
|---|---|
| Organisation de la liste | Une ligne par **travailleur**, montrant le contrat qui fait foi. L'historique reste dans la fiche. |
| Onglet Contrats dans RH | Supprimé. Le bloc de la fiche travailleur reste, en lecture seule. |
| Actions sur un contrat | Renouveler, rompre, corriger, supprimer — les quatre. |
| Contrat fini + suivant pas encore démarré | On affiche le **contrat terminé**, mention « suite prévue le JJ/MM ». Le travailleur reste dans « Expirés ». |
| Nombre de contrats | Illimité, y compris plusieurs du même type à la suite. |
| Numérotation | **Par type**, pas globale : 3 stages d'affilée = 1er, 2e, 3e contrat de stage ; le passage en CDD repart à « 1er contrat CDD ». |
| Durées | Boutons 1 / 2 / 3 / 6 / 12 mois, plus un champ libre en mois. Demande une migration. |

## Structure de l'écran

Écran global à tous les restaurants, calqué sur `app/equipe.js` : barre de filtre par
restaurant, recherche par nom.

```
CONTRATS                          [Tous ▾] [🔍 nom…]
   2 expirent bientôt  ·  41 en cours  ·  3 sans contrat

[Expire bientôt] [En cours] [Expirés] [Sans contrat]

┌──────────────────────────────────────────────────┐
│ DIALLO Fatou                      7E · Serveuse  │
│ CDI · depuis 01/03/26              3 contrats ›  │
├──────────────────────────────────────────────────┤
│ KONE Aya                          7E · Caissière │
│ CDD · 16/04/26 → 16/10/26           [Expire 12j] │
├──────────────────────────────────────────────────┤
│ TRAORE Moussa                   Zone4 · Cuisine  │
│ Aucun contrat                        [⚠ À faire] │
└──────────────────────────────────────────────────┘
                                  ( + Nouveau contrat )
```

### Renouvellements successifs et numérotation

Un travailleur peut enchaîner autant de contrats qu'on veut, y compris plusieurs du même
type : un stage de 3 mois, renouvelé 4 mois, renouvelé encore 6 mois. Chaque renouvellement
est un contrat de plus, l'historique les garde tous.

Le rang affiché se compte **par type**, dans l'ordre des dates de début :

```
Stage · 1er contrat    16/01/26 → 15/04/26   terminé
Stage · 2e contrat     16/04/26 → 15/08/26   terminé
Stage · 3e contrat     16/08/26 → 15/02/27   en cours
```

Passé en CDD, le compteur repart : le premier CDD est « CDD · 1er contrat », quel que soit
le nombre de stages qui précèdent. `rangParType()` vit dans `lib/contrats.js` et se teste
sans réseau.

### Quel contrat s'affiche pour un travailleur

Règle, dans cet ordre — c'est le cœur de l'écran, elle vit dans `lib/contrats.js` :

1. le contrat **en cours** s'il y en a un ;
2. sinon le contrat **terminé ou rompu le plus récent** (fin effective la plus tardive) ;
3. sinon le contrat **à venir le plus proche** ;
4. sinon `null` — le travailleur n'a aucun contrat.

L'étape 2 passe avant l'étape 3 : un travailleur dont le CDD s'est terminé et dont le
prochain contrat ne démarre que dans quinze jours reste affiché sur son contrat terminé,
avec la mention « suite prévue le JJ/MM ». Il reste ainsi visible dans « Expirés ».

Le cron `rappel-contrats` ne le désactivera pas pour autant : `doitEtreDesactive` refuse
d'archiver quand un contrat à venir existe. Les deux comportements sont volontairement
différents — l'écran informe, le cron agit.

### Les filtres

| Filtre | Contenu |
|---|---|
| Expire bientôt | Contrat affiché dont l'échéance tombe dans 30 jours ou moins. Un CDI (sans date de fin) et un contrat rompu n'y entrent jamais. |
| En cours | Contrat affiché en cours **ou** à venir — dans les deux cas, rien à faire |
| Expirés | Contrat affiché terminé ou rompu — c'est la liste à traiter |
| Sans contrat | Tous les travailleurs actifs sans aucun contrat, sans exception de type |

« Expire bientôt » est un sous-ensemble de « En cours » : c'est une vue de priorité, pas
une catégorie disjointe. Les quatre filtres couvrent tous les travailleurs actifs, aucun
ne peut passer entre les mailles.

Aucune exception de type. Un journalier n'a pas de contrat tant qu'on ne lui en a pas
enregistré un — l'exclure de la liste reviendrait à décider à la place du RH qu'il n'en
aura jamais. Le filtre montre l'état réel, il ne présume pas de l'intention.

## Ajouter un contrat

`+ Nouveau contrat` → sélecteur de travailleur (recherche + filtre restaurant) → le
formulaire existant. Depuis une carte « Sans contrat », le sélecteur est sauté : le
travailleur est déjà connu.

## Fiche d'un travailleur et actions

Taper une carte ouvre la fiche : le contrat affiché en haut avec sa photo ou son PDF
consultable, l'historique des contrats précédents en dessous (type, dates, statut).

Les quatre actions portent sur **le contrat choisi**, y compris un contrat d'historique —
c'est souvent l'ancien qui a été mal saisi.

| Action | Comportement | Refus possible |
|---|---|---|
| Renouveler | Formulaire avec date de début pré-remplie au lendemain de la fin du contrat | Chevauchement |
| Rompre | Date de rupture + motif obligatoire (Démission, Renvoi, Fin anticipée, Autre) | Date hors bornes |
| Corriger | Formulaire pré-rempli : type, dates, photo | Chevauchement, règles du formulaire |

En mode correction, la photo déjà enregistrée satisfait l'obligation de justificatif : on
peut corriger une date sans redéposer le contrat signé. En remplacer un reste possible.
| Supprimer | Double confirmation, irréversible | — |

### Messages d'erreur

Chaque refus de la base a son message en français courant. Jamais de code Postgres.

| Cause | Message |
|---|---|
| `contrats_sans_chevauchement` | « Ce travailleur a déjà un contrat sur cette période. Vérifie les dates. » |
| `contrat_cloture_coherente` | « La date de rupture doit être comprise entre le JJ/MM/AAAA et le JJ/MM/AAAA. » |
| Autre | « Impossible d'enregistrer. Vérifie ta connexion et réessaie. » |

La validation de la rupture est faite **avant** l'appel réseau par une fonction pure, pour
que le message cite les vraies bornes du contrat. La contrainte base reste le filet.

### Suppression

Supprime la ligne de `contrats_travailleurs` et la ligne correspondante de
`documents_travailleurs` (celle dont `fichier_url` vaut la photo du contrat). Le fichier
lui-même reste dans le stockage — on ne supprime pas un fichier qu'une autre ligne
pourrait référencer.

### Journal

Rupture, correction et suppression sont des actions sensibles : chacune appelle
`journaliser()` avec le nom du travailleur et le contrat concerné. Comme partout,
l'appel est suivi de `.catch(() => {})` — le journal ne bloque jamais.

## Découpage des fichiers

`app/rh.js` fait 2 166 lignes. Le nouvel écran ne reproduit pas ce défaut : la logique
va dans des modules purs testables, l'écran orchestre.

| Fichier | Responsabilité |
|---|---|
| `supabase_contrats_duree_libre.sql` (créer) | Migration : lève la contrainte `duree_mois IN (3,6,12)` |
| `lib/contrats.js` (étendre) | `contratAffiche()`, `validerCloture()`, `rangParType()`, `ordinalFR()`, `MOTIFS_RUPTURE`, `DUREES_MOIS` élargi |
| `lib/contrats.test.mjs` (étendre) | Tests des deux nouvelles fonctions |
| `app/contrats.js` (créer) | L'écran : chargement, filtres, recherche, liste, orchestration |
| `components/FicheContrat.js` (créer) | Fiche d'un travailleur : contrat affiché, historique, 4 actions |
| `components/SelecteurTravailleur.js` (créer) | Choix du travailleur à l'ajout |
| `components/FormulaireContrat.js` (étendre) | Mode création **et** mode correction |
| `components/BlocContrats.js` (modifier) | `onAjouter` devient optionnel → bloc lecture seule |

### Interfaces

- `contratAffiche(contrats, aujourdhui)` → le contrat à montrer, ou `null`. Pur.
- `rangParType(contrats, contrat)` → entier 1-based parmi les contrats du même type,
  triés par date de début. Pur.
- `ordinalFR(n)` → `'1er'`, `'2e'`, `'3e'`… Pur.
- `validerCloture(contrat, dateCloture, motif)` → `{ ok, erreur }`. Pur, message en français.
- `FicheContrat({ visible, travailleur, contrats, colors, onFermer, onRenouveler, onRompre, onCorriger, onSupprimer })`
- `SelecteurTravailleur({ visible, travailleurs, restaurants, colors, onFermer, onChoisir })`
- `FormulaireContrat({ visible, travailleur, contratsExistants, contratEdite, colors, onFermer, onEnregistrer })`
  — `contratEdite` absent = création ; présent = correction.

## Changements ailleurs

- `lib/menus.js` : la tuile `contrats` pointe sur `/contrats` au lieu de `/rh?onglet=Contrats`.
- `app/rh.js` : suppression de l'onglet Contrats, de `renderContrats`, de `chargerTousContrats`,
  des états `tousContrats` / `filtreContrats`, et de la lecture du paramètre `onglet`.
- `app/rh.js` : le bloc de la fiche travailleur passe en lecture seule (plus de `onAjouter`),
  avec un renvoi « à gérer dans l'écran Contrats ».

Accès : manager, directeur et RH, comme `app/equipe.js` (`roleActif`). La tuile est déjà
configurée pour ces trois rôles.

## Durées de contrat

Boutons rapides : **1, 2, 3, 6, 12 mois**. Plus un champ libre en mois pour tout le reste —
un stage renouvelé 4 mois se saisit en tapant `4`, la date de fin se calcule seule.
`calculerDateFin()` gère déjà n'importe quel nombre de mois, y compris le débordement
d'année et le 31 d'un mois qui n'en a que 30.

La durée libre est bornée à 1–60 mois. Au-delà c'est une faute de frappe, pas un contrat :
« La durée doit être comprise entre 1 et 60 mois. »

La date de fin reste **modifiable** après calcul, pour le cas rare d'un contrat qui ne
tombe pas sur un nombre entier de mois (« jusqu'au 30 juin »). La corriger à la main met
`duree_mois` à `null` : on n'enregistre pas une durée qui ne correspond plus aux dates.
C'est la seule façon de garder la capacité qu'offrait l'ancien champ libre sans ajouter
un deuxième bouton « Autre ».

Un CDI n'a ni durée ni date de fin — inchangé.

## Une migration nécessaire

La colonne porte aujourd'hui `CHECK (duree_mois IN (3,6,12))`, qui refuserait un contrat
de 4 mois. `supabase_contrats_duree_libre.sql` remplace cette contrainte par
`duree_mois IS NULL OR (duree_mois BETWEEN 1 AND 60)`.

Migration idempotente et rejouable, sur le modèle de celles déjà écrites. Les contrats
existants restent tous valides : 3, 6 et 12 sont dans le nouvel intervalle.

Le reste de la table ne bouge pas : types, cohérence CDI, bornes de clôture et
anti-chevauchement couvrent déjà le besoin.

## Hors périmètre

- Export PDF ou Excel de la liste des contrats.
- Modèles de contrat pré-remplis à imprimer.
- Signature électronique.
- Rappels configurables (les paliers restent 15 / 7 / 3 jours).
