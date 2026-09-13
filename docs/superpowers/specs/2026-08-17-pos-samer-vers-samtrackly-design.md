# Le POS Samer alimente Samtrackly — bascule des caissiers, site par site

**Date :** 2026-08-17
**Portée :** POS Samer (master Windows) → Samtrackly (Supabase)
**Migrations SQL :** 6 (détaillées § 7)
**Pilote :** 7e Tranche, une semaine minimum, puis Palmeraie

> Document vivant. Les décisions ci-dessous sont arrêtées ; la § 11 liste ce qui
> reste à compléter. Aucun code n'a été écrit à la date de rédaction.

## 1. Le principe

Le POS devient la source des ventes sur les sites où il est installé. Le caissier
n'ouvre plus Samtrackly : il prend ses commandes, saisit ses dépenses, fait son
inventaire et clôture son shift dans le POS. **À la validation de sa clôture, le
POS écrit lui-même dans Samtrackly** la ligne de shift que le caissier y saisissait
avant, plus ses satellites (dépenses détaillées, présences).

Samtrackly ne change pas de logique métier. Il reçoit les mêmes nombres, calculés
par la machine au lieu d'être tapés à la main. Le gérant garde exactement son rôle :
il valide le point, il paie les fournisseurs, il traite les litiges.

Le déploiement est **site par site**. Les sites sans POS continuent à fonctionner à
l'identique, sans aucune modification de comportement.

## 2. Ce qui existe déjà et qu'on réutilise

Le tuyau est en place, il ne coule que dans un sens :

- `apps/server/src/modules/equipe/sync-samtrackly.ts` — le POS interroge déjà
  Supabase Samtrackly en REST avec `SAMTRACKLY_URL` / `SAMTRACKLY_KEY`.
- `parametres_locaux.samtrackly_restaurant_id` — l'identité Samtrackly du site est
  déjà posée sur chaque poste.
- `utilisateurs.externe_id` (POS) = `travailleurs.id` (Samtrackly) — l'employé est
  déjà rapproché.
- `sync_outbox` + le moteur de synchro — un flux de montée a un endroit naturel où
  vivre, avec sa file et ses reprises.

**Les deux formules de vente sont la même formule**, terme à terme :

| Samtrackly (`app/point-shift.js:479`) | POS (`modules/services/routes.ts`, clôture) |
|---|---|
| dépenses + kdo + retour + yango_cse + glovo_cse + wave + djamo + om + espèce | dépenses + offerts + livraisons + modes déclarés + espèces comptées − fond |

kdo = commandes offertes, yango_cse / glovo_cse = livraisons partenaires externes.
La traduction est directe, ce n'est pas une reconstruction.

## 3. Le fond de caisse — la règle intangible

**Samtrackly ne lit JAMAIS le fond du POS.** Il garde sa logique inchangée :
fond de veille + `espece` = fond restant. Il ne lit que `espece` pour mettre son
fond à jour, exactement comme aujourd'hui.

Conséquence directe sur le calcul : `espece` ne peut pas être « espèces comptées
moins le fond », ce serait importer le fond du POS. Le POS envoie donc le **chiffre
système** :

```
espece = espèces encaissées (mode ESPECES, hors partenaires externes)
       − dépenses payées en espèces depuis le tiroir
```

Ce nombre est algébriquement identique à « comptées − fond » quand le tiroir
tombe juste, et il ne touche jamais au fond. C'est aussi pour ça que le manquant
doit voyager à part (§ 5).

## 4. Table de correspondance

| Colonne Samtrackly `points_shifts` | Source POS |
|---|---|
| `point_id` | le point de la journée retenue — **créé par le POS s'il n'existe pas** |
| `restaurant_id` | `parametres_locaux.samtrackly_restaurant_id` |
| `date` | journée d'exploitation (§ 6) |
| `caissier_id` | via le pont `utilisateurs.travailleur_id` ← `externe_id` du POS |
| `caissier_nom` | `nom_complet` de la session POS |
| `heure_debut` / `heure_fin` | `ouvert_le` / `cloture_le` du service |
| `depenses` | registre de dépenses du POS, **catégories seules** |
| `fournisseurs` | **0** — le gérant paie, dans Déductions gérant |
| `kdo` | total des commandes offertes du service (table KDO) |
| `retour` | **0** |
| `retour_pos` *(neuve)* | articles envoyés en cuisine puis annulés par un responsable |
| `yango_cse` / `glovo_cse` | livraisons partenaires externes du service |
| `wave` / `djamo` / `om` | modes déclarés à la clôture |
| `espece` | formule § 3 |
| `vente_shift` | formule § 4.1 |
| `ecart_reconciliation` *(neuve)* | copie exacte de `rapport_z.diff`, écart global officiel |
| `ecart_pos` *(neuve)* | `services_caisse.ecart`, écart espèces du tiroir |
| `pos_service_id` *(neuve, unique)* | id du service POS — clé d'idempotence |
| photos (`photo_kdo`, `photo_wave`…) | **aucune** — plus de justificatif (§ 8) |
| `valide` / `valide_at` | `true` / horodatage de la clôture |

En plus de la ligne de shift, le POS pousse :

- les **dépenses détaillées** dans la table `depenses` ;
- les **présences** dans la table `presences`, d'où Samtrackly tire les paies ;
- `points.vente_machine` = ventes système du POS pour la journée, **non modifiable** ;
- l'**inventaire**, en dernier, une fois le mappage fait (§ 9).

### 4.1 La formule de `vente_shift`

```
vente_shift = depenses (catégories) + paies + kdo + yango_cse + glovo_cse
            + wave + djamo + om + espece
```

`retour` et `fournisseurs` valent 0 et n'y entrent pas. Les `paies` viennent des
présences poussées.

**Pourquoi cette forme exactement.** La colonne `depenses` a aujourd'hui deux sens
selon le code qui l'écrit :

| Chemin | Sens de `depenses` |
|---|---|
| Sauvegarde caissier (`context/AppContext.js:184`) | catégories **+ paies + fournisseurs** |
| Recalcul manager (`app/modifier-point.js:574`) | catégories **seules** |

Le second réécrit la colonne dès qu'un manager corrige une ligne. La seule
définition qui survive à une correction est donc **catégories seules**, et
`calculerVenteShift()` (`app/modifier-point.js:181`) ajoute alors `fournisseurs`
et `paies` par-dessus — ce qui redonne le bon total. C'est la formule ci-dessus.

Piège associé : la cascade de correction retrouve le shift **par `caissier_nom`**
(`app/modifier-point.js:571`). Une différence d'orthographe entre le nom POS et le
nom Samtrackly envoie la correction sur le mauvais shift, ou sur aucun. D'où le
pont `travailleur_id`.

### 4.2 Pourquoi `retour` vaut 0

`retour` = les articles envoyés en cuisine puis supprimés par le gérant ou l'admin.
Le POS a déjà exactement la donnée : `commande_items.statut_cuisine = 'ANNULE'`
avec `envoye_le` renseigné et `annule_par` (PIN manager + motif obligatoires,
contrainte `annulation_tracee` en base).

Mais `recalculerTotaux()` tourne après l'annulation : l'article sort du total de la
commande, donc il n'est pas dans la vente machine. Et `calculerVenteShift()`
**inclut `retour`**. Si on écrivait le montant dans `retour`, tout tiendrait
jusqu'au jour où un manager ouvre le point pour corriger une dépense : la vente
serait recalculée, le retour y rentrerait tout seul, et l'écart bougerait du même
montant — silencieusement, des semaines plus tard.

D'où : `retour` = 0, montant dans `retour_pos`, qu'aucune formule ne somme.

## 5. Les deux écarts et leur imputation

Le rapport Z fige l'écart global de réconciliation :

```
rapport_z.diff = vente_totale − total_systeme
```

Le pont le copie tel quel dans `points_shifts.ecart_reconciliation`. Samtrackly
ne le recalcule pas et ne le remplace jamais par l'écart du tiroir. Une ancienne
clôture sans `rapport_z.diff` reste « Non disponible » et est exclue des sommes.

Indépendamment, le POS mesure l'écart espèces de chaque shift à son comptage à
l'aveugle :

```
ecart = espèces comptées − (fond + espèces encaissées − dépenses en espèces)
```

Signe négatif = manquant. Il part dans `points_shifts.ecart_pos`, un champ **neuf**
et non dans `points.ecart_responsables` : ce dernier veut dire « qui le gérant a
désigné comme responsable », pas « ce que la machine a mesuré ». Deux sens dans une
colonne se paient six mois plus tard. Le gérant garde `ecart_responsables` pour
imputer par-dessus, et ses régularisations.

**L'affichage attendu**, un service clôturé = une ligne :

```
Marie Paule   Écart global −5 000   Écart espèces 0
Hilary        Écart global 0        Écart espèces −2 000
────────────────────────────────────────────────────
Écart global  −5 000
```

La liste se déduit des `points_shifts` du jour. Le total global somme uniquement
les `ecart_reconciliation` disponibles des clôtures validées, dédupliquées par
`pos_service_id`.

Conséquence à connaître : sur un site POS, `points.ecart_caisse` calculé par
Samtrackly vaudra structurellement 0, puisque `vente_shift` et `vente_machine` sont
désormais deux vues du même système. Il ne représente donc ni l'écart global du
rapport Z ni l'écart espèces du tiroir.

## 6. La journée de rattachement

Une clôture entre **00h et 05h** fait apparaître deux boutons, la date en toutes
lettres, **défaut sur la veille** :

```
Ce shift compte pour :
  [ mercredi 30 octobre ]   ← par défaut
  [ jeudi 31 octobre ]
```

Pas de clavier, pas de calendrier libre : impossible de se tromper de mois.
En dehors de cette plage, la question n'est pas posée.

**Si le point de la journée retenue est déjà validé**, le shift bascule sur le jour
suivant — prolongement exact de la règle existante, un gérant ne pouvant déjà plus
sélectionner un jour validé (`app/choix-date.js:50`).

## 7. Migrations Supabase

| Migration | Pourquoi |
|---|---|
| `utilisateurs.travailleur_id` | le pont manquant : `points_shifts.caissier_id` référence `utilisateurs(id)`, or le POS ne connaît que l'id `travailleurs`. **Les deux tables n'ont aucun lien aujourd'hui.** Sans ce pont, les shifts POS sont anonymes et les écrans qui filtrent par caissier deviennent aveugles (déductions de vérification, stats caissiers, litiges). À remplir une fois pour les caissiers existants. |
| `points_shifts.pos_service_id` (unique) | idempotence : un renvoi après coupure ne crée jamais de doublon |
| `points_shifts.retour_pos` | § 4.2 |
| `points_shifts.ecart_pos` | § 5 |
| `restaurants.source_point` | la bascule par site, débrayable à distance |

## 8. Ce que Samtrackly doit changer

Rien pour les sites sans POS. Sur un site dont `source_point = 'POS'` :

- **Les comptes caissiers sont masqués** à la connexion. Les comptes ne sont pas
  supprimés : le drapeau se retire en une minute si le mini-PC tombe. Effet de
  bord utile : l'écran fournisseurs du caissier devient inatteignable de lui-même,
  rien à supprimer.
- **Cases grisées** (remplies par la machine, en lecture seule pour le gérant) :
  - vente machine **et sa photo** — la photo du total caisse n'a plus d'objet ;
  - écart et écarts par caissier — le gérant garde la main sur les régularisations ;
  - dépenses, présences et paies des caissiers.
- **Reste en saisie manuelle, volontairement** : le nombre de commandes Yango /
  Glovo. Le POS connaîtra son propre compte, le gérant garde le sien pris dans les
  apps partenaires — l'écart entre les deux est un contrôle croisé.
- **Le litige contacts est débranché sur les sites POS** en attendant la solution
  de la § 10.
- **Plus de photos justificatives** : les montants viennent du système, ils ne sont
  plus déclaratifs. Le POS pousse `valide = true` sans photo.

Côté POS : **MoMo, Moov et carte sont désactivés**. Ces modes ne servent pas
aujourd'hui, et Samtrackly n'a aucune colonne pour les recevoir — mieux vaut
interdire l'encaissement que de perdre un montant en silence.

## 9. L'inventaire — dernier module branché

À la bascule d'un site, le **dernier stock compté dans Samtrackly devient le stock
initial du POS**, une fois, au premier point validé. Ensuite le POS tient
l'inventaire et le pousse dans `inventaires`.

**Prérequis bloquant.** Dans le POS, `produits_inventaire.article_id` a la mauvaise
forme : le lien produit ↔ articles de vente est un-à-plusieurs (« Pain chawarma »
est consommé par les 6 Chawarmas, « Portions de frites » par une quinzaine
d'articles, et un « Poulet Pané + Frites » consomme trois produits à la fois). Les
sorties restent donc à **0** et le théorique se réduit à initial + entrées.

Or le vérificateur Samtrackly **déduit de l'argent** aux caissiers sur les écarts
d'inventaire. Brancher maintenant, ce serait retenir de l'argent sur des chiffres
faux. À faire avant : la table de liaison `inventaire_consommations`, l'adaptation
de `ventesParProduit()`, l'écran de réglage des recettes, et un jeu de liaisons
par défaut à seeder.

Le reste de la bascule — shift, dépenses, présences, écart — n'attend pas
l'inventaire.

## 10. Les contacts

**État actuel du litige** (`lib/litigeContacts.js:109`) : il compare
`points.yango_nb_commandes + glovo_nb_commandes` au nombre de
`commandes.contact_client` non vides, et retient `PRIX_CONTACT_MANQUANT` par
contact manquant au-delà d'un seuil de tolérance.

**Pourquoi il n'a jamais bien marché.** Le premier terme est saisi à la main par le
gérant (`app/verification.js:3359` l'affiche comme tel), et le second est compté par
pagination — c'est exactement là qu'était le bug des 47 000 FCFA de faux litiges.

**La solution sur un site POS** : les deux termes deviennent exacts.

- Le nombre de commandes Yango / Glovo, le POS ne l'estime pas, il les a créées.
- Les contacts : un champ « contact client » sur la commande partenaire dans le POS,
  demandé **à la prise de commande** — le seul instant où le livreur est devant le
  caissier. **Proposé, non bloquant** : un champ obligatoire ferait taper de faux
  numéros par un livreur pressé, ce qui est pire qu'un trou visible.

Le POS pousse alors les deux nombres par shift, et le litige redevient juste : on
compare ce que la machine a compté à ce que la machine a collecté. Plus de saisie
manuelle, plus de pagination.

**En attendant**, le volet Contacts est débranché des litiges sur les sites POS.

**Fait le 2026-08-28** — le débranchement décrit ci-dessus n'avait jamais été codé :
Vérification, Litiges et Charges comparaient les commandes déclarées par le gérant à
une table `commandes` restée vide depuis la bascule, soit 100 % de contacts manquants
et **103 000 FCFA de faux litiges sur Angré 7E du 17 au 25 août**. La règle est
désormais dans `lib/contactsPOS.js`, partagée par les trois écrans :

- site `SAMTRACKLY` → `commandes.contact_client` (inchangé) ;
- site `POS` → somme de `points_shifts.pos_nb_contacts`, jamais additionnée à la
  précédente ;
- compteur absent (`null`) ou partiel → **calcul suspendu**, aucune retenue, motif
  affiché. Le litige se rebranche tout seul, point par point, dès que le pont POS
  transmet `pos_nb_contacts` sur tous les shifts de la journée — il n'y a plus de
  drapeau à retirer à la main.

Côté POS, corrigé le 2026-08-28 dans `pos-samer` : le rapport Z calculait déjà
`partenaires.{YANGO,GLOVO,…}.{nb,contacts}`, c'est le pont cloud
(`supabase/functions/_shared/samtrackly-shift.ts`) qui perdait ces compteurs à la
frontière. Il remplit désormais `pos_nb_yango`, `pos_nb_glovo` et `pos_nb_contacts`
(contacts cumulés de TOUS les partenaires, livraison maison comprise). Reste à
déployer : au 28/08 les 70 shifts en base sont encore à NULL.

⚠ Le pont convertit un rapport Z sans bloc `partenaires` en **zéros**, pas en NULL.
Une resynchronisation des journées du 17 au 25 août — antérieures au champ contact —
rendrait donc « 0 contact pris » sur 22 commandes déclarées, soit le retour des
103 000 FCFA. `calculerLitigeContact` suspend pour cette raison tout calcul où le POS
ne rapporte AUCUNE commande partenaire alors que le gérant en a déclaré : les deux
sources se contredisent, on ne tranche pas contre les caissières. Les contacts ventilés par partenaire (`pos_nb_contacts_yango` /
`_glovo`) n'existent pas non plus : Vérification affiche « détail non transmis par
le POS » au lieu d'inventer une répartition.

## 11. Points ouverts

- Les autres règles dont le boss se souviendra — ce document est fait pour les
  recevoir.
- Le détail de l'écran de clôture POS (ce que le caissier voit, dans quel ordre).
- Le délai au bout duquel le gérant est alerté qu'un shift n'est pas parti.

## 12. Résistance aux pannes

- **L'envoi n'est jamais bloquant.** Une clôture ne doit pas échouer parce
  qu'internet est coupé. Le shift part dans une file, avec reprises.
- **Bandeau « X shifts en attente d'envoi »** sur la caisse, visible du caissier et
  du gérant, et alerte au gérant si ça dure. C'est la ressaisie à la main pendant
  une coupure qui fabrique les doublons, pas la coupure elle-même.
- **Idempotence** par `pos_service_id` : rejouer un envoi ne crée jamais un
  deuxième shift.
- **Retour arrière** : `restaurants.source_point` se retire en une minute, en base,
  sans nouveau build. Le mini-PC est déjà tombé plusieurs fois ; un site basculé
  doit toujours pouvoir revenir à Samtrackly le soir même.

## 13. Risque assumé, non traité

Le POS embarque la clé Supabase anon de Samtrackly, avec un RLS ouvert, sur 7
postes Windows en restaurant. Un poste compromis donne lecture et écriture sur
toute la base du groupe, tous restaurants confondus, sans trace de l'origine.

C'est déjà le cas aujourd'hui avec la synchro de l'équipe. La bascule ne crée pas
le risque, elle augmente ce qui passe par ce tuyau. Noté ici pour qu'il soit décidé
un jour, pas oublié.

## 14. Déploiement

1. Migrations Supabase (§ 7) + remplissage de `utilisateurs.travailleur_id`.
2. Côté POS : module d'envoi + file, écran de la journée de rattachement,
   désactivation des trois modes de paiement, champ contact sur commande partenaire.
3. Côté Samtrackly : lecture de `source_point`, masquage des comptes caissiers,
   cases grisées, affichage de `ecart_pos`, débranchement du litige contacts.
4. **7e Tranche** (le poste y est déjà créé) — bascule, puis **une semaine
   minimum** d'observation avant d'ouvrir le site suivant.
5. **Palmeraie**, puis les autres au fur et à mesure.
6. L'inventaire une fois le mappage fait (§ 9), site par site également.

Le travail d'implémentation se fait sur le **master Windows** : le dépôt `pos-samer`
présent sur le Mac s'arrête avant la session du 15/08 et n'a pas les modules
dépenses, pointage et inventaire.
