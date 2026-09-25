# Comparaison A / B — Dashboard Global

Date : 2026-09-25
Écran : `app/dashboard-global.js`
Pendant côté POS : `pos-samer/docs/superpowers/specs/2026-09-25-comparaison-console-siege-design.md`

## 1. Le problème

Le Dashboard Global montre les restaurants sur une période, avec un filtre
restaurant en tête et cinq piliers. Deux questions reviennent sans arrêt et
aucune n'a de réponse à l'écran :

- « Angré fait mieux que Riviera ? » — il faut taper un restaurant dans le
  filtre, retenir les chiffres de tête, taper l'autre, comparer de mémoire.
- « On est au-dessus du mois dernier ? » — la chip « Mois préc. » existe, mais
  la choisir **remplace** l'affichage. On ne voit jamais les deux ensemble.

Le classement par bénéfice répond à la première question pour un seul
indicateur (`classement`, trié par `benefice`). Il ne dit pas *pourquoi* : le
food cost, le labor cost, le mix des canaux restent hors de vue.

## 2. Périmètre

Inclus :

1. Un bouton **« Comparer »** au Dashboard Global, avec deux modes stricts :
   **2 restaurants** (une seule période) et **2 périodes** (un seul
   restaurant).
2. La comparaison dans **trois piliers sur cinq** : 📈 Aperçu, 📊 Coûts,
   🛵 Clients.
3. Une **disposition mobile** : une ligne par indicateur, A et B dessus.
4. Une **bande de synthèse** en tête du pilier.
5. L'extraction des calculs vers `lib/`, testés avec `node:test`.

Exclus :

- ⚠️ Alertes et ⚖️ Litiges : ce sont des listes d'événements déjà datables,
  pas des agrégats à confronter. Ils restent en lecture simple sur la
  période A.
- `app/dashboard.js` (le dashboard d'un seul restaurant, côté gérant) : il n'a
  pas de liste de restaurants, donc pas de mode « 2 restaurants ». À traiter
  séparément si le besoin se confirme.
- Comparaison à trois termes ou plus.
- Export PDF / Excel d'une comparaison.

Hors comparaison, **l'écran ne change pas**.

## 3. Les deux modes

Le bouton **« Comparer »** se place dans la barre du filtre restaurant, à
gauche de « Tous ». Activé, il remplace cette barre par les sélecteurs A / B.

| Mode | Ce qui varie | Ce qui est verrouillé |
|---|---|---|
| **2 restaurants** | A = un restaurant, B = un autre | une seule période, commune |
| **2 périodes** | A = la période choisie, B = **calculée** | un seul restaurant (ou « Tous ») |

Les modes sont **stricts** : jamais deux variables à la fois. Si Angré/octobre
bat Riviera/novembre, on ne sait pas si c'est le restaurant ou le mois.

```
┌──────────────────────────────────────┐
│ ‹ Retour   Dashboard Global          │
│            Angré contre Riviera      │
├──────────────────────────────────────┤
│ [Auj.] [7 jours] [▪Ce mois▪] [Mois   │
│  préc.] [📅 Période]                 │
│ 📅 1 → 25 oct. 2025                  │
├──────────────────────────────────────┤
│ [📈 Aperçu] [📊 Coûts] [🛵 Clients]  │
│ [⚠️ Alertes] [⚖️ Litiges]            │
├──────────────────────────────────────┤
│ ⚖ Comparer ✕   ( 2 restos )( 2 pér. )│
│ A ● Angré ▾                          │
│ B ● Riviera ▾                        │
└──────────────────────────────────────┘
```

### 3.1 La période B n'est pas choisie, elle est déduite

B = **les mêmes jours, juste avant A** : `[A.debut − durée, A.debut)`.

C'est la règle retenue pour la console du siège, et elle est reprise telle
quelle — les deux produits doivent répondre pareil à la même question, sinon
deux écrans du même groupe affichent deux vérités sur la même semaine.

Elle garantit que **A et B ont toujours la même durée**, donc que les
pourcentages d'écart veulent dire quelque chose.

**Conséquence assumée : « Mois préc. » n'est pas sélectionnable comme terme B.**
Elle reste une période A comme les autres — choisir « Mois préc. » pour A donne
B = les 30 ou 31 jours d'avant. Mais on ne peut pas confronter « Ce mois »
(25 jours écoulés) à « Mois préc. » (30 jours) : le pourcentage serait faux
d'un sixième, et c'est ce pourcentage qu'on retient.

Le bandeau écrit toujours les vraies dates des deux côtés, jamais un nom de
mois pour B :

```
A  Ce mois          1 → 25 oct. 2025   (25 jours)
B  les 25 jours     6 → 30 sept. 2025  (25 jours)
   précédents
```

### 3.2 Qui remplit A et B, et ce que devient `restoFiltre`

Au premier clic sur « Comparer » :

- Mode « 2 restaurants » : A prend `restoFiltre` s'il est posé, sinon le
  premier restaurant de la liste ; B prend le suivant.
- Mode « 2 périodes » : le restaurant est `restoFiltre`, « Tous » compris —
  comparer le groupe à lui-même est légitime.

À la sortie, `restoFiltre` reprend la valeur qu'il avait à l'entrée. Les
sélecteurs A / B ne le réécrivent pas : c'est l'état de l'écran hors
comparaison, et le repeindre ferait rester l'un des deux termes une fois la
comparaison fermée.

Deux refus :

- **A = B** en mode « 2 restaurants » : choisir pour B la valeur de A échange
  les deux termes au lieu de les confondre.
- **Moins de deux restaurants chargés** : le mode « 2 restaurants » est
  désactivé, avec la raison écrite. Le mode « 2 périodes » reste disponible.

## 4. La disposition : une ligne par indicateur

L'usage réel est **iOS Safari sur téléphone** (CLAUDE.md du repo). Deux
colonnes côte à côte y sont illisibles : un montant en FCFA fait 10 à 12
caractères, et les graphes Victory tomberaient à ~160 px de large
(`CHART_WIDTH = width - 48`, soit ~345 px sur un iPhone — la moitié n'est pas
un graphe, c'est une vignette).

Chaque indicateur devient donc **un bloc qui porte ses deux valeurs et son
écart**, sur la pleine largeur :

```
┌────────────────────────────────────┐
│ Ventes                             │
│ A  Angré         12 400 000 FCFA   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               │
│ B  Riviera        9 800 000 FCFA   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓            ▼ 21 %  │
│                          −2 600 000│
└────────────────────────────────────┘
```

Les deux barres partagent leur échelle (§ 6.1). La lettre **A** ou **B** est
toujours écrite : trois des couleurs de restaurant passent sous 3:1 sur leur
fond, l'identité ne peut pas reposer sur la couleur seule.

### 4.1 Les couleurs

- Mode « 2 restaurants » : chacun garde **sa** couleur, celle que
  `couleurResto(r.couleur)` lui donne partout ailleurs dans l'app. On ne
  réinvente pas une palette A/B qui ferait d'Angré un autre vert ici.
- Mode « 2 périodes » : c'est le même restaurant. A prend sa couleur pleine,
  B la même à 45 % d'opacité — le procédé déjà employé pour l'heure de pointe.

### 4.2 Les courbes d'évolution

`dataVentesEvo`, `dataBeneficeEvo` et `dataRentaEvo` indexent les jours en
`x: i + 1`, pas en date. **Cela tombe juste** : A et B ayant la même durée,
leurs deux séries se superposent sur un seul `VictoryChart`, jour 1 contre
jour 1, jour 2 contre jour 2. Deux `VictoryLine` au lieu d'une, l'axe X
portant « J1 … J25 » et le bandeau rappelant les deux plages réelles.

C'est le deuxième bénéfice de la règle du § 3.1 : sans durées égales, cette
superposition serait impossible.

## 5. Les données

| Mode | Requêtes supplémentaires |
|---|---|
| **2 restaurants** | **Aucune.** `chargerPoints` charge déjà `points` pour TOUS les restaurants, et `chargerCoutsGlobal` fait de même pour les coûts. Les deux termes se dérivent de ce qui est en mémoire. |
| **2 périodes** | **Le même chargement, une seconde fois**, sur les bornes de B : un `select` sur `points`, plus — pilier Coûts seulement — les quatre appels `getDepensesPeriode` / `getPresencesPeriode` / `getFournisseursPeriodePaye` / `getPaiesGerantPeriode` par restaurant. |

Le mode « 2 périodes » dans le pilier Coûts est donc le cas coûteux :
`2 × 4 × nb_restaurants` appels. Trois mesures :

1. Le second chargement n'est lancé **qu'à l'entrée dans le pilier Coûts**,
   comme le fait déjà `chargerCoutsGlobal` (son `useEffect` est conditionné à
   `pilier === 'couts' || pilier === 'alertes'`).
2. **Le chargement de B est limité aux restaurants réellement affichés.** En
   mode « 2 périodes », `restoFiltre` désigne un seul restaurant ou « Tous » :
   un seul choisi, on ne charge que celui-là pour B. Le chargement de A, lui,
   reste inchangé — il est partagé avec l'écran hors comparaison.
3. Les points de B sont gardés en état tant que la période A et le mode ne
   changent pas — changer de pilier ne relance rien.

`periodeKey === 'today'` n'ouvre pas le pilier Coûts aujourd'hui (le
`useEffect` l'exclut). Ce comportement est conservé : en comparaison aussi,
« Aujourd'hui » n'affiche pas de coûts.

## 6. Les quatre règles de correction

### 6.1 Échelle partagée entre A et B — obligatoire

Deux barres avec chacune son échelle sont un **mensonge visuel** : 9 800 000
remplirait la même largeur que 12 400 000 et l'œil conclurait l'égalité.
`GraphiqueBarres` accepte déjà un `max` en paramètre ; la comparaison lui
passe `Math.max(maxA, maxB)`. Les `VictoryChart` reçoivent un `domain`
explicite calculé sur les deux séries.

Sans cela, la fonctionnalité est fausse.

### 6.2 Les charges fixes ne sont pas comparables sur une période partielle

`chargesGlobal` lit la table `charges` par **mois entier**
(`.in('mois', moisListe)`), et `chargesFixesMontantResto` somme tout ce qui
remonte. Une période de 7 jours en octobre se voit donc imputer **le loyer
d'octobre en entier**, et `chargesFixesGlobalPct` s'en trouve gonflé d'un
facteur quatre.

Ce n'est pas introduit par la comparaison : c'est déjà le cas aujourd'hui. Mais
la comparaison le rendrait criant — deux périodes de 7 jours dans deux mois
différents afficheraient deux charges fixes mensuelles pleines, et un écart
qui ne mesurerait que la différence de loyer entre deux mois.

**Règle retenue** : la ligne « Charges fixes » n'entre dans la comparaison que
si **A et B couvrent chacun un mois calendaire entier**. Sinon elle s'affiche
pour A seul, avec la mention *« charges du mois entier — non comparable sur
une période partielle »*.

Les autres lignes du pilier Coûts (food cost, labor cost, coût primaire) sont
calculées sur la période réelle et restent comparables.

### 6.3 A à zéro ne produit jamais de pourcentage

`(b − a) / a` avec `a = 0` est une division par zéro. Le cas arrive pour de
bon : un restaurant fermé, un jour férié, un pilier sans donnée. L'écran écrit
alors la phrase — *« Angré n'a rien vendu sur cette période »* — et garde
l'écart absolu.

`tauxRenta` protège déjà ce cas pour la rentabilité (`if (!ventes) return 0`) ;
la règle est étendue à tous les écarts.

### 6.4 Aucun point n'est pas zéro

Un restaurant sans ligne dans `points` sur la période n'a pas fait zéro de
vente : personne n'a saisi son point. `classement` porte déjà `nbJours`. Quand
`nbJours === 0` d'un côté, la comparaison affiche *« aucun point saisi sur
cette période »* au lieu de `−100 %`, qui se lirait comme un effondrement.

## 7. La synthèse

En tête du pilier comparé, une phrase puis trois écarts :

```
┃ Riviera fait 2 600 000 FCFA de moins qu'Angré
┃ sur 25 jours (−21 %).
┃ • Bénéfice SC        ▼ 50 %
┃ • Coût matières      ▲ 6,2 pts
┃ • Part livraison     ▲ 11 pts
```

La phrase d'en-tête porte sur les **ventes**. Les trois lignes sont les trois
plus gros écarts **relatifs** parmi les indicateurs suivis :

| Indicateur | Pilier | Unité de l'écart | Monter est… |
|---|---|---|---|
| Ventes | Aperçu | % | bon |
| Bénéfice SC | Aperçu | % | bon |
| Taux de rentabilité | Aperçu | **points** | bon |
| Dépenses | Aperçu | % | mauvais |
| Coût matières (food) | Coûts | **points** | mauvais |
| Coût salaire (labor) | Coûts | **points** | mauvais |
| Coût primaire | Coûts | **points** | mauvais |
| Charges fixes | Coûts | **points** | mauvais — *hors comparaison si période partielle (§ 6.2)* |
| Part livraison | Clients | **points** | neutre — jamais de couleur, c'est un mix |
| Montant livraison | Clients | % | bon |

**Un pourcentage qui bouge se compare en POINTS, jamais en pourcentage de
pourcentage.** Un food cost qui passe de 31 % à 37 % monte de 6,2 points, pas
de « 20 % ». Les deux formulations sont justes arithmétiquement et l'une est
incompréhensible.

La polarité décide de la couleur et de rien d'autre : la flèche et le signe
redisent l'information, pour qui ne distingue pas le vert du rouge.

## 8. Ce que chaque pilier compare

### 📈 Aperçu
Ventes, dépenses, bénéfice SC, taux de rentabilité · le classement des
restaurants · les trois courbes d'évolution superposées (§ 4.2).

Le classement suit le mode : à « 2 restaurants » il se réduit aux deux termes ;
à « 2 périodes » sur « Tous », il donne le rang de chaque restaurant de part et
d'autre ; à « 2 périodes » sur un seul restaurant, il ne s'affiche pas — classer
une seule ligne ne dit rien.

### 📊 Coûts
Coût matières (montant et %), coût salaire (montant et %), coût primaire (%),
charges fixes (sous réserve du § 6.2) · le classement `classementCouts`, trié
par coût primaire.

### 🛵 Clients
Montant livraison (`yango_cse + glovo_cse`), montant sur place
(`CA − livraison`), part livraison en % · le mix des canaux (Yango, Glovo,
Wave, OM, Djamo), chaque canal portant son écart, échelle partagée.

## 9. Structure du code

`app/dashboard-global.js` fait 1 079 lignes où les calculs, les seuils
d'alerte et le rendu sont entrelacés. Le rendre comparatif en l'état voudrait
dire dupliquer chaque agrégat. On extrait — et le repo a déjà tout ce qu'il
faut pour ça : 18 modules `lib/*.js` testés par `lib/*.test.mjs` avec
`node:test`.

| Fichier | Rôle |
|---|---|
| `lib/dashboardGlobal.js` **(nouveau)** | `vueGlobale(points, couts, restaurantIds) → Vue` — **pure**. Reprend `totalResto`, `totalGlobal`, `tauxRenta`, `serieJours`, `classement`, `foodCostMontantResto`, `laborCostMontantResto`, `chargesFixesMontantResto`, le mix canaux. |
| `lib/comparaisonDashboard.js` **(nouveau)** | `ecarts(a, b)` et `synthese(a, b)` — **pures** : polarité, points vs pourcentage, division par zéro, `nbJours === 0`, charges fixes non comparables. |
| `lib/periodeComparee.js` **(nouveau)** | `periodePrecedente(debut, fin)` → les bornes de B, et `libellePeriode(...)`. **Pure**, et la seule source de la règle du § 3.1. |
| `components/LigneComparee.js` **(nouveau)** | le bloc d'un indicateur : deux barres à échelle partagée, l'écart, les libellés A / B. |
| `components/BarreComparaison.js` **(nouveau)** | le mode et les sélecteurs A / B. |
| `app/dashboard-global.js` | orchestration : chargements, état, rendu des piliers. |

`vueGlobale` ne connaît pas l'existence de la comparaison : elle reçoit des
points et rend des agrégats. C'est ce qui rend la vue unique et les vues A ou B
strictement le même code.

## 10. Tests

Convention du repo : `lib/<nom>.test.mjs`, `node:test` + `node:assert/strict`,
un en-tête qui dit **pourquoi** le module existe. Lancés par
`for f in lib/*.test.mjs; do node "$f"; done`.

`lib/periodeComparee.test.mjs` :
- B a exactement la durée de A, sur 1, 7, 25 et 31 jours.
- B se termine la veille du début de A, sans chevauchement ni trou.
- « Mois préc. » comme A donne bien les 30 ou 31 jours d'avant.
- Le libellé écrit les vraies dates, jamais un nom de mois pour B.

`lib/dashboardGlobal.test.mjs` :
- Agrégats par restaurant et pour le groupe.
- `tauxRenta` à ventes nulles rend 0, pas `NaN` ni `Infinity`.
- `serieJours` trie par date et somme les restaurants vus.
- Un restaurant sans point est distingué d'un restaurant à zéro.

`lib/comparaisonDashboard.test.mjs` :
- A à zéro : aucun pourcentage, la phrase de remplacement.
- B à zéro : `−100 %` légitime, affiché.
- Écart de taux rendu en **points**, jamais en pourcentage de pourcentage.
- Polarité : coût matières en hausse = mauvais, ventes en hausse = bon, part
  livraison = neutre, sans couleur.
- Charges fixes : exclues de la comparaison si A ou B n'est pas un mois entier.
- `nbJours === 0` d'un côté : aucun pourcentage produit.
- La synthèse retient les trois plus gros écarts **relatifs**, pas absolus.

## 11. Définition de « terminé »

- `for f in lib/*.test.mjs; do node "$f"; done` est vert.
- `npm run lint` passe.
- Mode « 2 restaurants » : deux restaurants comparés sur les trois piliers sans
  aucune requête supplémentaire.
- Mode « 2 périodes » : « Ce mois » contre les 25 jours précédents, avec les
  vraies dates écrites des deux côtés.
- Les trois courbes d'Aperçu se superposent, jour 1 contre jour 1.
- Un restaurant sans point saisi affiche sa mention, pas `−100 %`.
- Le pilier Coûts sur une période partielle affiche les charges fixes pour A
  seul, avec sa mention.
- Les barres de A et de B partagent visiblement leur échelle.
- Lu sur un iPhone en Safari : aucun montant tronqué, aucun défilement
  horizontal.
- « Comparer ✕ » rend l'écran à son état d'origine, `restoFiltre` compris.
