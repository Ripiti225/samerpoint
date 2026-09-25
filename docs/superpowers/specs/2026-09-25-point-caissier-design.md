# Point caissier — design

**Date :** 2026-09-25
**Statut :** validé, prêt pour le plan d'implémentation
**Contexte :** tous les shifts du 7E viennent désormais du POS (`points_shifts.pos_service_id`).

## Problème

Le gérant dispose aujourd'hui d'un « Espace Caissier » (`/gerant-caissier`) : une grille de
cinq tuiles de **saisie** (Point/Shift, Dépenses, Fournisseurs, Présences, Inventaire) héritée
de l'époque où le gérant remplissait le point à la place du caissier. Le seul écran qu'il y
consulte réellement est la liste des shifts de `/point-shift`, dont le détail affiche le
financier, les photos, les dépenses, les fournisseurs, les présences et l'inventaire —
mais **pas l'écart mesuré par le POS ni l'explication du caissier**, qui sont pourtant la
raison pour laquelle il ouvre cet écran.

On remplace cet espace par un écran de consultation dédié : **Point caissier**.

## Décisions

| Question | Décision |
|---|---|
| Période | Aujourd'hui + les **deux jours calendaires précédents**. Une journée sans shift reste affichée, vide. Au-delà, les shifts disparaissent de l'écran (rien n'est supprimé en base). |
| Shifts retenus | Uniquement les **clôtures POS validées** (`lib/cloturesCaisse.js` → `cloturesPOS()`). Aucun shift ouvert, aucun shift saisi à la main. |
| Écart affiché | **L'écart du comptage de caisse** (`ecart_pos`), accompagné de l'explication du caissier (`explication_ecart`), qui porte précisément sur cet écart. L'écart du rapport Z (`ecart_reconciliation`) n'est affiché **que s'il existe** — vérifié le 2026-09-25 : il est NULL sur les 42 shifts des trois derniers jours, le pont POS ne le remplit pas. Premier choix (« écart global seul ») corrigé après lecture des données réelles. |
| Explications d'inventaire | Sous chaque ligne de produit expliquée : quantité expliquée, texte du caissier et montant déduit s'il y en a un. |
| Paie | Détail par employé : nom, statut de présence, montant, plus le total. |
| Espace Caissier | Retiré du menu du gérant. L'écran reste dans le code (une tuile peut être réactivée depuis Paramètres) mais n'est plus proposé. |
| Visibilité de la tuile | Gérant **et** manager / directeur. |
| Actions | Lecture seule. La suppression d'un shift reste où elle est, dans `/point-shift`, réservée à manager / directeur (`peutSupprimer`, `app/point-shift.js:205`) — le gérant ne l'a jamais eue. |
| RH | Accès à l'onglet « Fournisseurs » de Contacts, avec l'envoi SMS / WhatsApp groupé comme les autres rôles. |

## Structure de l'écran

Route `/point-caissier`, fichier `app/point-caissier.js`.

```
‹ Retour        POINT CAISSIER
                 3 derniers jours

AUJOURD'HUI · jeudi 25 septembre
┌──────────────────────────────────────────────┐
│ 👤 Marie Paule          08:00 → 16:00        │
│ Vente shift  312 500 FCFA                    │
│ Écart de caisse  −2 500 FCFA  ⚠ Sans explication│
├──────────────────────────────────────────────┤
│ 👤 Hilary               16:00 → 23:30        │
│ Vente shift  198 000 FCFA                    │
│ Écart de caisse  0 FCFA                       │
└──────────────────────────────────────────────┘

MERCREDI 24 SEPTEMBRE
   Aucun shift clôturé ce jour-là

MARDI 23 SEPTEMBRE
┌──────────────────────────────────────────────┐
│ …                                            │
└──────────────────────────────────────────────┘
```

Sous l'écart, l'explication du caissier quand il en a donné une, entre guillemets.

L'écart est coloré : rouge quand il est négatif (manquant), vert quand il est positif,
neutre à zéro. `formaterMontantSigneFCFA()` fournit déjà le texte signé.

Le badge « Sans explication » n'apparaît que si l'écart de caisse est non nul **et**
`explication_ecart` est vide.

### Détail d'un shift

Un appui ouvre le détail en plein écran, en lecture seule, dans l'ordre suivant :

1. **En-tête** — caissier, heure de début → heure de fin, date.
2. **Données financières** — vente shift, espèces, Wave, Orange Money, Djamo, Yango CSE,
   Glovo CSE, KDO, retours, dépenses + salaires, fournisseurs, **puis les lignes qui
   distinguent cet écran de l'ancien détail : Écart de caisse (comptage), Écart du rapport Z
   quand il existe, et Explication du caissier** (« Aucune explication donnée » si vide).
3. **Photos** — justificatifs KDO, retour, Yango/Glovo CSE, Wave, Djamo, OM.
4. **Dépenses** — ligne par ligne + total.
5. **Fournisseurs** — ligne par ligne + total.
6. **Présences & paies** — nom, statut, montant + total payé.
7. **Inventaire** — état (verrouillé / en cours), montant à déduire, lignes de produits, et
   sous chaque ligne expliquée : « Expliqué : 3 — « Coupé pour poulet 3 » · déduit 1 500 FCFA ».

C'est exactement le contenu du détail existant, plus le point 2 enrichi.

## Découpage du code

| Fichier | Rôle |
|---|---|
| `lib/pointCaissier.js` *(nouveau)* | Pur, sans Supabase : `troisDerniersJours(dateRef)` et `grouperShiftsParJour(shifts, dateRef)` qui filtre par `cloturesPOS()`, range chaque clôture dans sa journée et renvoie **trois** groupes, même vides, du plus récent au plus ancien. Shifts triés par heure de début. |
| `lib/pointCaissier.test.mjs` *(nouveau)* | Tests `node:test` : trois journées toujours présentes, journée vide conservée, exclusion des shifts non validés et non-POS, dédoublonnage POS, tri par heure, changement de mois et de année. |
| `lib/detailShift.js` *(nouveau)* | Le chargement des dépenses / fournisseurs / présences / inventaire d'un shift, déplacé depuis `app/point-shift.js:312` sans changer sa logique (filtrage par `caissier_nom`, repli des présences par `point_id`). |
| `components/DetailShiftCaissier.js` *(nouveau)* | L'affichage du détail, déplacé depuis le modal de `app/point-shift.js:1245`. Reçoit `shift`, `data` et une option `afficherEcartPOS`. Les deux écrans l'utilisent : une seule version à maintenir. |
| `app/point-caissier.js` *(nouveau)* | L'écran : charge les shifts, affiche les trois journées, ouvre le détail. |
| `app/point-shift.js` | Le modal et la fonction de chargement sont remplacés par les deux modules partagés. Aucun changement de comportement pour le caissier. |
| `lib/menus.js` | Nouvelle tuile `point-caissier` (`admin: true`), ajoutée à `ACCES_DEFAUT.gerant` ; `gerant-caissier` retiré de `ACCES_DEFAUT.gerant`. |
| `app/contacts.js:31` | `onglets` du RH passe de `['Équipe']` à `['Équipe', 'Fournisseurs']`. Les fournisseurs sont déjà chargés, l'envoi groupé fonctionne tel quel. |
| `supabase_point_caissier.sql` *(nouveau)* | Migration du menu en base — voir ci-dessous. |

### Données

Une seule requête au chargement :

```js
supabase.from('points_shifts').select('*')
  .eq('restaurant_id', restaurantId)
  .in('date', troisDerniersJours())
  .order('heure_debut')
```

puis `grouperShiftsParJour()`. Trois jours d'un restaurant ne dépassent jamais la limite
silencieuse de 1000 lignes de Supabase ; aucune pagination nécessaire ici.

Le détail d'un shift n'est chargé qu'à l'ouverture, via `lib/detailShift.js`.

Le gérant voit son restaurant (`restaurantId` du contexte). Manager et directeur n'en ont
aucun dans leur contexte : une barre de choix en haut de l'écran liste les restaurants, le
premier par ordre alphabétique étant sélectionné d'office pour ne pas ouvrir sur un écran vide.

## Migration du menu — indispensable

`lib/menus.js` ne fournit que des **valeurs de repli** : la configuration réelle des menus
vit dans la table `roles_acces`, et `chargerAccesConfig()` écrase les défauts avec la ligne
de la base. Modifier `ACCES_DEFAUT` ne change donc rien en production.

`supabase_point_caissier.sql`, idempotent et rejouable, met à jour la ligne `role = 'gerant'` :
retire `gerant-caissier` du tableau `tuiles`, ajoute `point-caissier` s'il n'y est pas déjà.
Les rôles `rh` et `caissier` ne sont pas touchés. Manager et directeur ne passent pas par
cette table (tuiles `admin`), rien à migrer pour eux.

Sans cette migration, les gérants continuent de voir « Espace Caissier » et ne voient pas
« Point caissier ».

## Hors périmètre

- Aucune suppression ni modification de shift depuis le nouvel écran.
- L'écart espèces du tiroir (`ecart_pos`) n'est pas affiché ici ; il reste visible dans
  Vérification et Litiges.
- Pas de PDF, pas d'export.
- **Aucun déploiement** Vercel ni OTA tant qu'il n'est pas explicitement demandé.

## Vérifications avant de rendre la main

- `npm run lint` — 0 erreur.
- `for f in lib/*.test.mjs; do node "$f"; done` — tout vert, dont les nouveaux tests de
  `pointCaissier`.
- Relecture manuelle : un gérant du 7E voit ses trois journées, une journée sans shift reste
  affichée, un shift avec écart non expliqué porte le badge.
