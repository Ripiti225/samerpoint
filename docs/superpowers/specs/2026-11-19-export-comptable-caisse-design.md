# Export comptable SYSCOHADA — étape 1 : journal de Caisse des restaurants

Date : 19/11/2026 · Chantier 3 de la comptabilité, étape 1 sur 3
(1 Caisse des restaurants → 2 Banque et Trésorerie → 3 Paie).

## But

Un fichier Excel mensuel que le cabinet comptable peut reprendre : un **journal** en partie double
(date, compte, libellé, débit, crédit), conforme au plan SYSCOHADA révisé, construit à partir des
journées des restaurants.

## Décisions validées

- Format proposé par nous (le cabinet n'a pas fourni de modèle) ; numéros de comptes **à faire valider**
  par le cabinet, réunis dans un seul fichier de code + un onglet « Plan de comptes ».
- Organisation juridique inconnue → export **pour tout le groupe** ou **pour un restaurant**, avec le
  restaurant sur chaque ligne.
- Export depuis l'écran **Clôture du mois** ; un mois **non clôturé** peut aussi être exporté, marqué
  **PROVISOIRE** (nom du fichier + première ligne de chaque onglet).
- Commissions Yango/Glovo/OM/Wave/Djamo : **pas dans ce journal** (étape 2, à l'arrivée réelle de l'argent).

## Ce que disent les données (vérifié sur octobre 2026, lecture seule)

- `points.vente_total` = somme des `points_shifts.vente_shift` (vente théorique).
- Vente retenue = `vente_machine` si > 0, sinon `vente_total` (`lib/venteMachine.js`).
- Par shift : `vente_shift` = espèce + OM + Wave + Djamo + Yango espèces + Glovo espèces + KDO +
  points fidélité + retour + fournisseurs payés + dépenses et salaires (`lib/depensesShift.js`).
- **Ventes tablette** (`yango_tab`, `glovo_tab`, `samer_delly_tab`) : **hors** vente théorique et
  hors vente machine (Palmeraie octobre : 11,5 M de tablettes en plus de 31,6 M) → ventes à part.
- **Caisse gérant** : la table `depenses_gerant_caisse` détaille exactement
  `points.depenses_gerant_caisse_total` (Lavage octobre : 4 725 615 F au franc près) ; catégories
  Fournisseur, Marché, Légumes, Fruits, Dépenses annexes, Paie.
- Dépenses du caissier : `depenses` avec `saisi_par = 'caissier'` ; sur les sites POS les salaires
  n'y sont pas → reste de `depensesSalairesShift` moins ces dépenses = salaires du caissier.
- Factures fournisseurs : `transactions_fournisseurs.facture` (sources caissier, deduction_gerant,
  manager).

## Écritures d'une journée (un restaurant, une date, journal « CA »)

Pièce `CA-<resto court>-<AAAAMMJJ>`. Toutes les lignes d'une pièce s'équilibrent.

**A. Ventes et encaissements (shifts)**

| Ligne | Débit | Crédit | Montant |
|---|---|---|---|
| Ventes caisse | | Ventes restaurant | vente retenue |
| Espèces (espèce + Yango espèces + Glovo espèces) | Caisse | | somme des shifts |
| Orange Money / Wave / Djamo | un compte de monnaie électronique par moyen | | somme des shifts |
| KDO | Cadeaux clients | | somme des shifts |
| Points fidélité, retours | Remises accordées | | somme des shifts |
| Fournisseurs payés par le caissier | Fournisseurs | | `shift.fournisseurs` |
| Dépenses du caissier par catégorie | Achats (Marché, Légumes, Fruits) / Autres achats (annexes) | | `depenses` caissier |
| Salaires payés par le caissier | Personnel | | reste de `depensesSalairesShift` |
| Écart de caisse (vente théorique − vente retenue, sens de l'app) | Manque (si négatif) | Surplus (si positif) | différence |

Équilibre garanti : vente théorique = somme des postes justifiés ; l'écart porte la différence avec la
vente retenue. Si le détail des dépenses caissier dépasse le total du shift, le salaire déduit est
ramené à 0 et le surplus de détail reste visible dans l'onglet Contrôle.

**B. Ventes tablette** : Yango / Glovo / Samer Delly au débit (client plateforme), Ventes livraison au
crédit.

**C. Caisse gérant** (`depenses_gerant_caisse`) : au débit Fournisseurs (catégorie Fournisseur),
Achats, Autres achats ou Personnel ; au crédit Caisse.

**D. Factures fournisseurs** (`transactions_fournisseurs.facture > 0`) : au débit Achats
(ou Autres achats si fournisseur non alimentaire, `FOURNISSEURS_NON_FOOD`), au crédit Fournisseurs,
libellé = nom du fournisseur.

## Plan de comptes proposé (SYSCOHADA révisé — à valider par le cabinet)

| Clé | Compte | Intitulé |
|---|---|---|
| ventesCaisse | 7021 | Ventes restaurant (sur place, à emporter) |
| ventesLivraison | 7022 | Ventes livraison plateformes |
| caisse | 571 | Caisse |
| om / wave / djamo | 5511 / 5512 / 5513 | Monnaie électronique Orange Money / Wave / Djamo |
| yango / glovo / samerDelly | 4111 / 4112 / 4113 | Clients plateformes Yango / Glovo / Samer Delly |
| fournisseurs | 401 | Fournisseurs |
| achats | 6021 | Achats de matières premières (alimentaire) |
| autresAchats | 605 | Autres achats (non alimentaire, dépenses annexes) |
| personnel | 661 | Rémunérations du personnel |
| cadeaux | 6278 | Cadeaux à la clientèle (KDO) |
| remises | 709 | Rabais, remises accordés (points fidélité, retours) |
| ecartManque / ecartSurplus | 658 / 758 | Charges diverses / Produits divers (écarts de caisse) |

## Fichier Excel

Nom : `Journal-caisse-<AAAA-MM>[-<restaurant>][-PROVISOIRE].xlsx`.

- **Journal** : Journal, Date, Pièce, Compte, Intitulé, Libellé, Débit, Crédit, Restaurant.
- **Contrôle** : par restaurant et pour le groupe : total débit, total crédit, différence (doit être 0),
  ventes, écarts de caisse, journées non validées incluses (si provisoire).
- **Plan de comptes** : clé, compte, intitulé.

Journées prises : toutes celles du mois (`points.date` dans le mois) ; journées importées des anciens
Sheets (`source = 'import_sheets_2026_10'`, sans shift) : **exclues** et signalées dans Contrôle.

## Architecture

- `lib/comptesSyscohada.js` — le plan de comptes (une seule source).
- `lib/journalCaisse.js` — logique pure : `ecrituresJournee({ point, shifts, depensesCaissier,
  deductionsGerant, factures, nomResto })` → lignes ; `controleJournal(lignes)` → totaux.
  Testée sous node (`lib/journalCaisse.test.mjs`), dont un cas réel d'octobre.
- `lib/exportJournalCaisse.js` — chargement Supabase paginé + fabrication de l'Excel (même outillage
  que `lib/exportRapportMensuel.js`).
- `app/cloture-mois.js` — bouton « 📥 Export comptable » sur le mois ouvert, choix Groupe / restaurant.

## Tests

- Unitaires : équilibre de chaque pièce ; écart positif / négatif ; tablettes ; caisse gérant ;
  factures non alimentaires ; salaires caissier déduits ; journée importée exclue.
- Contrôle réel : sur octobre 2026, pour chaque journée, débit = crédit et l'écart de caisse =
  vente théorique − vente machine.
- `npm run lint`, tous les `lib/*.test.mjs`, `npx expo export -p web`.

## Hors de cette étape

Banque, partenaires (virements et commissions), chèques, Trésorerie, dépenses direction (étape 2) ;
états de salaire (étape 3) ; transferts d'espèces du fond vers la direction (étape 2).
