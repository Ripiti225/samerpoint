# Nouvelle Trésorerie — prévisions, dette récente, charges post-payées

Validée le 02/10/2026. Page présentée à la direction :
https://claude.ai/artifact/38utGxjGaSoSiYPBuztQGy (version 7).

Remplace la logique de « vue d'ensemble » de
`2026-10-01-tresorerie-socle-design.md`. Les tables existantes (comptes,
mouvements, dus, paiements, coffre, dépenses direction, partenaires) restent.

## Règles validées

### Tout se paie après coup

Une charge du mois M est due au jour limite du mois M+1. Loyer de septembre,
échéance au 5 → à payer avant le 5 octobre.

| Charge | Revient | Montant | Date limite | Saisie |
|---|---|---|---|---|
| Loyer | mensuel, par restaurant | fixe | jour par restaurant | RH, propriétaire |
| Salaires | mensuel, par restaurant | variable (un état par mois) | même jour pour tous | RH, propriétaire |
| CNPS | mensuel, par restaurant | variable | même jour pour tous | RH, propriétaire |
| Impôts | mensuel, par restaurant | fixe sur l'année | même jour pour tous | RH, propriétaire |
| ITS | mensuel, par restaurant | fixe sur l'année | même jour pour tous | RH, propriétaire |
| TEE | mensuel, par restaurant | fixe sur l'année | même jour pour tous | RH, propriétaire |
| Contrat de bail | annuel, par restaurant | fixe | une date par an, par restaurant | RH, propriétaire |
| Autres charges | ponctuelles | libre | aucune | propriétaire (dépenses direction) |

### Cycle de vie d'une charge à échéance

- **À payer** tant que la date limite n'est pas passée.
- **Dette récente** dès le lendemain de la date limite, si un reste existe.
- **Dette** quand une charge plus récente de la même série (même catégorie,
  même restaurant) passe à son tour en dette récente, c.-à-d. est elle aussi
  en retard avec un reste. Exemple : loyer de septembre de Lavage en retard le
  06/10 → dette récente ; le 06/11, le loyer d'octobre de Lavage est en retard
  à son tour → octobre en dette récente, septembre en Dette.
- Ce classement se **calcule** à partir des échéances et des paiements : il
  n'est pas stocké, aucune tâche planifiée n'est nécessaire.

Exceptions :
- **Autres charges** : jamais en dette récente. Passage en Dette **à la main**.
- **Créanciers** (catégorie `dette`, ex. Zabad) : dans Dette.
- **Prêt en espèces** (étape 2) : arrive en dette récente, passe en Dette à la main.

### Trésorerie (accueil, étape 3)

De haut en bas :
1. Trésorerie nette réelle = Banque + Espèces − prévisions
2. Trésorerie = Banque + Espèces + Partenaires à recevoir
3. Prévisions
4. Dépenses du mois : pour chaque série, la plus ancienne charge non payée dont
   la date limite n'est pas passée
5. Dette récente (total, déroulable)
6. Dette (total, déroulable)

Une dépense due sans prévision n'est pas soustraite de la nette réelle.

### Banque, espèces, coffre (étape 2)

- « Banque » devient « Banque et espèces ». Les espèces s'ajoutent à la main
  avec leur origine : un restaurant, ou un prêt. Un prêt crée la fiche du
  prêteur et sa dette (en dette récente).
- Le coffre est une épargne, hors trésorerie. Épargner une partie d'un
  virement. Emprunter au coffre : l'app demande quand rembourser (date, ou
  prochaine réception Wave / Glovo) ; simple rappel, la trésorerie ne bouge pas.

### Prévisions (étape 4)

- Sur toute dépense (du mois, dette récente, dette, dépense direction à payer),
  plusieurs prévisions possibles, chacune avec un montant.
- « À une date » : le jour venu, ligne orange + notification ; non payée, elle
  reste orange et le rappel revient chaque jour.
- « À la prochaine réception » Glovo, Yango, Wave ou OM / Djamo (tous
  restaurants) : la réception marquée « reçu » rend la ligne orange.
- Paiement toujours à la main, montant prévu prérempli.

### Notifications (étape 5)

- 9 h, puis relance à 14 h si rien n'a été fait (ni payé, ni prévision posée).
- Jour de la date limite, prévisions datées, rappels quotidiens, remboursements
  du coffre.
- Propriétaire et managers ; le RH pour ses sept charges.
- Préalable : réparer le push Android (clé FCM V1).

### Résultat net

Chaque charge à échéance pèse sur le **mois de sa date limite**, payée ou non
(loyer de juin, dû début juillet → juillet). Les autres charges payées comptent
au mois du paiement, si leur catégorie de dépense direction compte dans le
résultat (réparation, matériel, équipement d'un restaurant).

### Accès

- RH : saisit les sept charges et leurs réglages (montants fixes, jours
  limites, loyers, baux). Ne voit ni l'accueil, ni la banque, ni les espèces,
  ni le coffre ; ne paie pas.
- Propriétaire : tout. Lecture (managers) : inchangé.

## Livraison

1. **Charges et retards** (ce qui suit)
2. Banque, espèces et coffre
3. Nouvel accueil
4. Prévisions
5. Notifications

---

## Étape 1 — Charges et retards

### Données (`supabase_tresorerie_charges.sql`)

- `tresorerie_dus.categorie` accepte en plus `impot`, `its`, `tee`, `bail`,
  `autre`. `admin` reste accepté (aucune ligne en base au 02/10/2026) mais
  n'est plus proposé.
- Nouvelles colonnes de `tresorerie_dus` :
  - `categorie_direction text` : pour `autre`, la catégorie de dépense direction
    (réparation, matériel…) ;
  - `en_dette_depuis date` : passage manuel en Dette (autres charges, prêts).
- Restaurant + mois obligatoires et unicité (catégorie, restaurant, mois) pour
  les sept catégories en série. Pour le bail, `mois` = 1er du mois de la date
  limite.
- `tresorerie_echeances (categorie PK, jour)` : jour limite commun de
  `salaire`, `cnps`, `impot`, `its`, `tee` (valeurs de départ : salaires 10,
  les autres 15 ; réglables dans l'app).
- `tresorerie_charges_fixes (categorie, restaurant_id, montant, mois_depart,
  bail_mois, bail_jour, actif)` : montants fixes de `impot`, `its`, `tee` et
  contrat de bail (avec sa date limite annuelle). Les loyers restent dans
  `tresorerie_loyers`.
- Les échéances des loyers déjà créés passent au mois suivant (jour réglé du
  restaurant, borné à la fin du mois).

### Création automatique (à l'ouverture de la Trésorerie, insertion des absents)

- Loyer, impôts, ITS, TEE : une ligne par restaurant et par mois consommé, du
  mois de départ au mois courant ; échéance au jour limite du mois suivant.
- Bail : la ligne de l'année est créée à partir du 1er du mois qui précède sa
  date limite.
- Salaires et CNPS : saisis par le RH ; l'échéance se calcule seule (jour
  commun du mois suivant).
- Changer un montant fixe ou un jour limite met à jour les lignes non payées
  dont la date limite n'est pas encore passée.

### Écrans

- **À payer** : onglets Loyers · Salaires · CNPS · Impôts · ITS · TEE · Bail ·
  Dette récente · Dettes. Chaque ligne porte son état (à payer, dette récente,
  dette, payé). Dette récente et Dettes regroupent toutes les catégories, avec
  leur total. Réglages : jours limites communs, montants fixes, baux.
- **Saisie groupée** (02/10/2026) : salaires, CNPS, impôts, ITS, TEE → on
  choisit le mois, le montant de chaque restaurant en face, tout en une fois
  (mois écoulé proposé). Baux → on choisit l'année, montant + date limite
  (jour/mois) en face de chaque restaurant ; ces valeurs servent aux années
  suivantes. Une ligne déjà saisie est préremplie et se corrige, sauf si un
  paiement existe. Champ vidé : ligne supprimée (salaires, CNPS), mise à 0
  (impôts, ITS, TEE, qui restent créés automatiquement), bail arrêté.
- **Dépenses direction** : section « À payer » pour les autres charges
  (catégorie, restaurant ou Groupe, libellé, montant) ; payer, passer en Dette.
- **Vue d'ensemble actuelle** : les nouvelles catégories s'ajoutent à la ligne
  des charges, en attendant le nouvel accueil (étape 3).
- **Résultat net** : au mois de la date limite (voir plus haut).
- Tableaux de bord : les nouvelles catégories comptent au mois consommé, comme
  le loyer.

### Tests

`lib/tresorerie.test.mjs` (échéances post-payées, création, classement à
payer / dette récente / dette, droits RH) et `lib/chargesMois.test.mjs`
(résultat net au mois de la date limite, sans double compte avec l'ancien
tableau `charges`).

---

## Étape 2 — Banque, espèces et coffre

Décisions du 02/10/2026 :

- **Espèces = un vrai compte**, à côté de BACI et SIB (`tresorerie_comptes`,
  ligne « Espèces »). Payer « en espèces » (charge, dépense direction, dépôt au
  coffre) fait baisser son solde. L'ancienne source « espèces » sans compte ne
  sert plus qu'à l'historique.
- **Entrée d'espèces** (saisie à la main) avec son origine :
  - un restaurant (choisi dans la liste) ;
  - un prêt : nom du prêteur (créancier) ; la dette du même montant est créée
    en même temps (`est_pret`), en **dette récente**, passée en Dette à la main.
    Annuler l'entrée retire la dette tant qu'aucun remboursement n'a été fait.
- **Virement** entre deux comptes (Espèces, BACI, SIB) : deux mouvements liés
  (`groupe`), le total ne bouge pas ; ils s'annulent ensemble.
- L'écran « Banque » devient **« Banque et espèces »**.
- **Coffre = épargne**, hors trésorerie :
  - **Épargner** à tout moment, depuis Espèces, BACI ou SIB (ancien « dépôt ») ;
    raccourci depuis « Banque et espèces ».
  - **Emprunter** remplace le retrait : montant, compte qui reçoit l'argent, et
    quand rembourser — à une date, ou à la prochaine réception Glovo, Yango,
    Wave, OM ou Djamo (réception marquée « reçu » après l'emprunt). Le moment
    venu, l'emprunt passe « à rembourser » (orange) ; simple rappel, la
    trésorerie ne bouge pas. **Rembourser** = remettre le montant au coffre
    depuis un compte au choix. Les retraits d'avant restent dans l'historique.
- Vue d'ensemble : ligne « Banque et espèces » ; carte du coffre avec ce qui
  reste à lui rembourser.

Migration : `supabase_tresorerie_especes.sql`.
Tests : `lib/tresorerie.test.mjs` (prêt en dette récente), `lib/direction.test.mjs` (état d'un emprunt).

---

## Étape 3 — Nouvel accueil

Décisions du 02/10/2026 (remplace la vue d'ensemble) :

1. **Alertes** en haut (déficit, CNPS > 60 j, fond bas), comme avant.
2. **Trésorerie nette réelle** = Banque + Espèces − prévisions (0 tant que
   l'étape 4 n'est pas livrée). Touche → Banque et espèces.
3. **Trésorerie** : Banque (BACI + SIB), Espèces, Partenaires à recevoir,
   total. Chaque ligne ouvre son écran. En dessous, pour information :
   fournisseurs dus (→ Crédits fournisseurs).
4. **Prévisions** (vide jusqu'à l'étape 4).
5. **Dépenses du mois** : pour chaque série (catégorie + restaurant), la plus
   ancienne charge non payée dont la date limite n'est pas passée ; charges à
   échéance seulement (pas les autres charges). Triées par date limite, total.
   Toucher une ligne ouvre son détail (payer).
6. **Dette récente** puis **Dette** (managers en lecture : pas la Dette) :
   total, on touche pour dérouler, chaque ligne ouvre son détail.
7. Carte du **coffre** (solde, objectif, à rembourser) ; raccourcis restants en
   bas : À payer, Résultats, Dépenses direction, Plafonds de fond ; bouton
   Droits en haut à droite.

**Corrigé le 02/10/2026 (retour utilisateur)** : un appui sur un bloc le
**déroule sur place** avec ses montants, il n'ouvre aucun écran ; même
comportement pour tous les blocs (nette réelle, trésorerie, prévisions,
dépenses du mois, dette récente, dette, coffre). Tous les raccourcis d'avant
restent en bas (Banque et espèces, Partenaires, À payer, Dettes, Résultats,
Coffre, Dépenses direction, Plafonds de fond, Fournisseurs). La Dette est
toujours affichée, avec « + Ajouter une dette » (créancier, montant).

Tests : `lib/tresorerie.test.mjs` (dépenses du mois, synthèse).
