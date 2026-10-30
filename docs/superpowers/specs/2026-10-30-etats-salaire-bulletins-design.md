# États de salaire et bulletins de paie — conception

Date : 30/10/2026 · Validée section par section avec l'utilisateur le 30/10/2026.
Remplace, à terme, les bulletins faits sous **Sage** (modèle : les 11 bulletins de juillet 2026,
dossier `~/Downloads/07_juillet`, données personnelles — **jamais copiées dans le dépôt**).
S'appuie sur : la pointeuse branchée au POS (source `POINTEUSE` de `equipe_service`, en service depuis
le 27/10/2026), le pont POS → Samtrackly (`samtrackly-points`, voir
`docs/superpowers/specs/2026-08-17-pos-samer-vers-samtrackly-design.md`), les contrats signés
(`contrats_travailleurs.donnees`, `lib/baremes.js`) et la campagne de mise à jour des fiches
(`docs/superpowers/specs/2026-10-29-mise-a-jour-fiches-contrats-design.md`, limite 12/11).

## 1. Objectif

À partir de la fin novembre 2026 (premier mois complet de pointage) :

1. Sortir, pour chaque restaurant, l'**état de salaire du mois** : jours pointés, dû, déjà versé, **reste à payer**.
2. Produire le **bulletin de paie légal** (droit ivoirien) de chaque CDD et CDI, au format des bulletins Sage actuels.
3. Faire passer le tout par un circuit **RH → manager → Trésorerie**.

## 2. Décisions de l'utilisateur (30/10/2026)

| Sujet | Décision |
|---|---|
| Livrables | État de salaire par restaurant **et** bulletin PDF par travailleur. |
| Source des heures | Appareil pointeuse → POS → pont → Samtrackly. |
| Qui figure dans l'état | **CDD et CDI**, plus les **stagiaires qui ont un reste dû** : au moins un jour pointé sans paie, ou total payé du mois < total dû du mois. |
| État | Dû = jours pointés × montant par jour (`travailleurs.salaire_journalier`), **moins le déjà versé**. |
| Bulletin | Indépendant du montant par jour : il repose sur la **fiche paie** (catégorie, salaire catégoriel, sursalaire, cotisations…). L'ancienneté se calcule depuis la date d'embauche. |
| Pointage et bulletin | **Absences seulement** : retenue pour absence non justifiée, **pas** d'heures supplémentaires. |
| Cotisations | Bulletin légal (CNPS, CMU, ITS, part patronale) pour les CDD/CDI. |
| Éléments variables du brut | Le cas échéant : indemnité de fin de CDD, congés payés, gratification (**75 % du salaire catégoriel**), jours fériés payés. |
| Employeur | **Une société par marque** (Chez Samer, Al Kayan) ; le restaurant est le lieu d'affectation. |
| Circuit | RH prépare → manager valide → l'état se fige → dus dans Trésorerie → bulletins. |
| Trésorerie | **Un dû par restaurant et par mois** (« Salaires novembre 2026 — Angré 7E »). |
| Approche | Calcul **dans l'app** (`lib/paie.js`, testé), taux en **paramètres**, états **figés** en base. |
| Ordre | 1. pont pointeuse → 2. fiche paie → 3. état → 4. bulletin. |

## 3. Le bulletin Sage, décortiqué (juillet 2026)

Recalculé au franc près sur 5 bulletins (A cuisinier 8 ans, B assistante comptable 3 ans, C gérant adjoint 15 ans,
D serveur 3 ans, E caissière 0 an avec avance). Ces 5 cas deviennent les tests de référence (§ 9).

| Ligne Sage | Règle | Exemple (A) |
|---|---|---|
| 10 Salaire de base | salaire catégoriel × jours payés / 30 | 30 j × 88 007 = 88 007 |
| 20 Sursalaire | sursalaire × jours payés / 30 | 15 000 |
| 100 Prime d'ancienneté | base × taux ; taux = **1 % par année complète dès 2 ans**, plafond 25 % | 8 % × 88 007 = 7 041 |
| **Total brut** (= brut imposable) | somme des gains imposables | 110 048 |
| 415 CMU | 500 F × personnes couvertes (part salariale), même montant en part patronale | 3 personnes → 1 500 |
| 452 CNPS | 6,3 % × brut | 6 933 |
| 412 Impôt brut avant RICF | barème ITS (§ 5.3) sur le brut | (110 048 − 75 000) × 16 % = 5 608 |
| 413 RICF | 5 500 F par demi-part au-delà d'une part | 3 parts → 22 000 |
| 414 ITS | max(0, impôt brut − RICF) | 0 |
| 708 Prime de transport | transport × jours payés / 30 (non imposable) | 30 000 |
| 716 Prime de tenue | montant fixe (non imposable) | 3 031 |
| 661 Avance sur salaire | retenue (cas E : 91 400) | — |
| 781 Arrondi | net arrondi à la **centaine supérieure** | + 54 |
| **Net à payer** | brut − CMU − CNPS − ITS + transport + tenue − avances + arrondi | **134 700** |

Part patronale : retraite générale 7,7 % du brut · prestations familiales 5 %, assurance maternité 0,75 %,
accident du travail 2 % sur **min(brut, 75 000)** · part patronale CN 1,2 % · taxe d'apprentissage 0,4 % ·
taxe FPC 0,6 % · TFC à régulariser 0,6 % (sur le brut) · CMU = part salariale.

En-tête : employeur (raison sociale, BP, ville), matricule, coefficient, ancienneté « X an(s) et Y mois »,
n° CNPS (sécurité sociale), emploi occupé, horaire 173,33, « CCN Convention collective interprofessionnelle »,
période, date et mode de paiement (espèces / virement), adresse du travailleur, cachet et nom du responsable
administratif. Congés : acquis (2,2 jours ouvrables par mois), reste à prendre, pris.
Pied : cumuls **période** et **année** — salaire brut (brut imposable + transport), net imposable, charges
salariales, charges patronales, heures travaillées (173 par mois), heures sup. (0), avantages en nature (0).

## 4. Données

### 4.1 Pont pointeuse (POS, master Windows)

Le pont copie déjà les présences (`construirePresences`). Il copie en plus, pour chaque membre de
`equipe_service` dont la source est `POINTEUSE` : `pointe_le` → `presences.pointe_arrivee`,
`depart_le` → `presences.pointe_depart`. Le code du POS sur le Mac étant périmé, le correctif est livré
sous forme de fiche (`docs/correctif-pont-pointeuse.md`) à appliquer sur le master Windows, puis la fonction
`samtrackly-points` est redéployée. Sans ces colonnes, l'état compte les présences existantes.

Migration Samtrackly : `presences.pointe_arrivee timestamptz`, `presences.pointe_depart timestamptz`.

### 4.2 Fiche paie — table `fiches_paie`

Une ligne par travailleur CDD/CDI (`travailleur_id` unique).

| Colonne | Origine |
|---|---|
| `matricule`, `coefficient` | saisis par la RH |
| `categorie`, `salaire_categoriel`, `prime_tenue`, `prime_transport` | **pré-remplis depuis le contrat signé en cours** (`contrats_travailleurs.donnees`), modifiables |
| `sursalaire` | saisi (0 par défaut) |
| `numero_cnps` | saisi |
| `parts_fiscales` (1 à 5, pas de 0,5) | saisi |
| `personnes_cmu` (≥ 1) | saisi |
| `mode_paiement` (`especes` / `virement`) | saisi |
| `cumuls_reprise` jsonb, `cumuls_reprise_au` date | facultatif : cumuls 2026 repris de Sage à fin octobre |
| `conges_reprise` numeric | facultatif : jours restant à prendre au 31/10 |

Repris de la fiche travailleur, sans doublon : nom, poste (emploi occupé), `lieu_residence`, `date_embauche`
(ancienneté), `type_contrat`, `jour_repos`, `restaurant_id` (→ marque → employeur).
**Fiche paie complète** = matricule, catégorie, salaire catégoriel, n° CNPS, parts fiscales, personnes CMU,
mode de paiement renseignés.

### 4.3 Paramètres — table `parametres_paie`

Une ligne par **date d'effet** (`applicable_du`) avec un jsonb `valeurs`. Le calcul d'un mois prend la ligne
la plus récente dont la date ≤ dernier jour du mois. Une loi qui change = une nouvelle ligne, jamais une
modification des mois passés.

Valeurs initiales : SMIG 75 000 · barème ITS mensuel (tranches § 5.3) · RICF 5 500 par demi-part, plafond
5 parts · CNPS salarié 6,3 % · retraite patronale 7,7 % · PF 5 % · AM 0,75 % · AT 2 % · plafond PF/AM/AT
75 000 · part patronale CN 1,2 % · apprentissage 0,4 % · FPC 0,6 % · TFC 0,6 % · CMU 500 par personne et par
part · ancienneté (1 % par an dès 2 ans, plafond 25 %) · arrondi 100 · congés 2,2 j/mois · gratification 75 % ·
**taux indemnité de fin de CDD** et **méthode des congés payés** (§ 5.4, à valider par le comptable).

Employeurs (même table, clé `employeurs`) : par marque — raison sociale, adresse (BP, ville, commune),
n° CNPS employeur, n° contribuable, nom et téléphone du responsable administratif (cachet du bulletin).

### 4.4 États — tables `etats_salaire` et `lignes_etat_salaire`

`etats_salaire` : `restaurant_id`, `mois` (1er jour du mois), `statut` (`brouillon` → `soumis` → `valide`,
retour `brouillon` sur renvoi), `parametres_id`, totaux (reste à payer, brut, net, charges patronales),
`soumis_par/le`, `valide_par/le`, `renvoi_motif`, `du_id` (dû Trésorerie). Unique (`restaurant_id`, `mois`).

`lignes_etat_salaire` : `etat_id`, `travailleur_id`, `type_contrat`, `jours_pointes`, `jours_attendus`,
`absences_justifiees` jsonb (date, motif), `elements_variables` jsonb, `avances`, `du`, `deja_verse`,
`reste_a_payer`, `corrections` jsonb (champ, avant, après, motif, par, le), et **`bulletin` jsonb** : le calcul
complet figé (toutes les lignes du § 3, en-tête, congés, cumuls). Null pour un stagiaire.

## 5. Calculs — `lib/paie.js` (module pur) et `lib/etatSalaire.js` (module pur)

### 5.1 Jours

- **Jours attendus** : jours du mois depuis max(1er du mois, date d'embauche) jusqu'à min(fin du mois,
  `depart_le` ou fin de contrat), moins le `jour_repos` hebdomadaire.
- **Jour pointé** : une présence du travailleur ce jour-là (avec ou sans `pointe_arrivee`). Un départ oublié
  à la pointeuse compte la journée.
- **Absences non justifiées** = jours attendus − jours pointés − absences justifiées (congé, maladie…, saisies
  par la RH avec motif).
- **Jours payés du bulletin** = 30 − absences non justifiées (base Sage de 30 jours), minimum 0.

### 5.2 État de salaire (par personne)

- **Dû** = jours pointés × `salaire_journalier`.
- **Déjà versé** = somme des paies des présences du mois (`presences.paye`) + paies du gérant rattachées +
  avances du mois.
- **Reste à payer** = max(0, dû − déjà versé). Un dépassement (versé > dû) est affiché, pas reporté.
- **Stagiaire** inclus seulement si reste à payer > 0.

### 5.3 Bulletin (CDD et CDI)

1. Gains imposables : base et sursalaire au prorata des jours payés ; ancienneté sur la base ; éléments
   variables (§ 5.4). → **brut imposable**.
2. CNPS 6,3 % × brut ; CMU 500 × personnes.
3. **ITS** : barème mensuel sur le brut imposable — 0 % jusqu'à 75 000, 16 % jusqu'à 240 000, 21 % jusqu'à
   800 000, 24 % jusqu'à 2 400 000, 28 % jusqu'à 8 000 000, 32 % au-delà ; moins la RICF ; minimum 0.
   La première tranche est prouvée par les bulletins de juillet ; les seuils suivants viennent de sources
   secondaires et sont **à confirmer par le comptable** (ils sont en paramètres).
4. Non imposables : transport au prorata des jours payés ; tenue.
5. Avances du mois en retenue.
6. Net = brut − CNPS − CMU − ITS + transport + tenue − avances ; **arrondi à la centaine supérieure**
   (ligne 781). Net négatif → 0, et le reste de l'avance est signalé à la RH.
7. Part patronale (§ 3), congés (acquis 2,2 j/mois depuis le début de l'année ou l'embauche + reprise ; pris
   = congés payés du § 5.4), cumuls année = reprise Sage + bulletins validés de l'année + mois courant.

### 5.4 Éléments variables (saisis par la RH, proposition calculée, modifiable)

| Élément | Proposition | Imposable |
|---|---|---|
| Indemnité de fin de CDD | taux paramétré × brut total perçu pendant le contrat ; proposée le mois de la date de fin du contrat | oui |
| Congés payés | méthode paramétrée (par défaut : brut moyen des 12 derniers mois ÷ 30 × jours pris) ; la RH saisit les jours pris | oui |
| Gratification | 75 % × salaire catégoriel × mois de présence dans l'année ÷ 12 | oui |
| Jours fériés payés | nombre × (salaire catégoriel ÷ 30) | oui |

Le taux de fin de CDD (3 % ou 6 % selon les sources consultées) et la méthode des congés payés doivent être
**validés par le comptable avant le premier vrai bulletin**.

## 6. Écrans

- **Équipe → fiche d'un CDD/CDI → section « Paie »** (RH, manager) : champs du § 4.2, pré-remplissage depuis le
  contrat, liste des manques. Onglet **« Bulletins »** : bulletins validés du travailleur (PDF à la demande).
- **Badge « fiches paie incomplètes »** sur la tuile RH (même modèle que « fiches à compléter » du gérant).
- **Nouvel écran `app/salaires.js` « Salaires du mois »** (tuile RH et manager) : sélecteur de mois
  (calendrier, jamais de date tapée), une carte par restaurant avec son statut et ses totaux.
  - RH : « Préparer l'état » (crée ou recalcule le brouillon), lignes avec jours / dû / déjà versé / reste /
    ⚠ fiche incomplète ; toucher une ligne = justifier une absence, saisir un élément variable, corriger une
    avance (motif obligatoire) ; aperçu du bulletin ; « Soumettre au manager ».
  - Manager : totaux (reste à payer, brut, net, charges patronales), détail, **Valider** ou **Renvoyer** (motif).
  - Après validation : « Bulletins PDF » (un par travailleur ou un fichier par restaurant), « État PDF ».
- Notifications cloche : état soumis → manager ; état renvoyé → RH.

## 7. Circuit et Trésorerie

1. Brouillon (RH) → **Soumettre** : refusé si le mois n'est pas terminé ou si une fiche paie CDD/CDI est
   incomplète (message nominatif : « Il manque le n° CNPS de … »).
2. Soumis → **Valider** (manager) : fige les lignes et le jsonb `bulletin`, crée **un dû Trésorerie** par
   restaurant (`tresorerie_dus`, « Salaires novembre 2026 — <restaurant> », montant = total des restes à payer),
   payable par le gérant ou la direction comme les autres dus.
3. Soumis → **Renvoyer** (manager, motif) → brouillon.
4. Validé → **Rouvrir** (manager) seulement si le dû n'a reçu aucun paiement ; supprime le dû ; journalisé.

Recalculer un brouillon **conserve** les corrections, absences justifiées et éléments variables saisis.
Chaque action est journalisée (`journaliser`, jamais bloquant).

## 8. PDF

jsPDF (pas `expo-print`, inutile sur le web). Aucun fichier stocké : le PDF est régénéré à la demande depuis le
jsonb figé, donc toujours identique. Bulletin : une page A4 au format Sage (§ 3), employeur de la marque.
État : tableau par restaurant (travailleur, contrat, jours, dû, déjà versé, reste, net du bulletin).

## 9. Tests (`node:test`)

- `lib/paie.test.mjs` : les 5 bulletins de juillet (A–E) recalculés **au franc près** (brut, CMU, CNPS, ITS,
  RICF, part patronale ligne par ligne, arrondi, net) ; absences (28 jours payés) ; ITS en 2ᵉ et 3ᵉ tranche ;
  RICF > impôt ; avance > net ; ancienneté (1 an 11 mois = 0 %, 2 ans = 2 %, 30 ans = 25 %) ; fin de CDD ;
  gratification au prorata ; jours fériés ; choix des paramètres par date d'effet.
- `lib/etatSalaire.test.mjs` : jours attendus (embauche, départ, jour de repos en cours de mois) ; inclusion des
  stagiaires (reste > 0 seulement) ; dû / déjà versé / reste ; conservation des corrections au recalcul ;
  complétude de la fiche paie.

## 10. Garde-fous

- Un état validé ne change plus, même si la fiche paie ou les paramètres changent ensuite.
- Pas de suppression de travailleur qui casserait un état : l'état garde nom, poste et contrat en clair.
- Pagination `.range()` + `.order()` sur toutes les lectures de présences (limite des 1 000 lignes).
- Confidentialité : salaires et n° CNPS suivent la règle d'accès actuelle de la base (clé publique, accès ouvert —
  limite connue, hors de ce chantier). Les écrans sont réservés aux rôles RH et manager.

## 11. Livraison

Ordre : (1) fiche correctif du pont + migration `presences` ; (2) fiche paie + paramètres ; (3) état + circuit +
Trésorerie ; (4) bulletin et état PDF. Commit et push à chaque étape ; migrations SQL à passer par
l'utilisateur ; publication Vercel + EAS **une seule fois à la fin**. Cible : prêt avant le **30/11/2026**.
**Novembre 2026 en double avec Sage** : comparer les bulletins avant d'abandonner Sage en décembre.

## 12. Hors périmètre

Heures supplémentaires · déclarations CNPS / DGI (DISA, état 301) · virements bancaires automatiques ·
bulletins des stagiaires · signature électronique du bulletin par le travailleur.
