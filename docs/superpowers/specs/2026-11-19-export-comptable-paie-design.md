# Export comptable SYSCOHADA — étape 3 : journal de Paie

Date : 19/11/2026 · Suite des étapes 1 (Caisse) et 2 (Banque et Trésorerie).

## Contexte

Au 19/11/2026 les états de salaire ne sont que des brouillons (aucun validé, bruts presque tous à 0) :
le journal est construit sur la structure des bulletins (`lib/paie.js` → `calculerBulletin`) et ne
produira des chiffres qu'une fois des états validés. Décision de l'utilisateur : le construire quand même.

## Règle validée (pas de double comptage)

Pour un restaurant et un mois :

| | État de salaire **validé** | **Pas d'état validé** |
|---|---|---|
| Journal PA | écritures du bulletin (ci-dessous) | rien |
| « Paie » de la caisse (CA : dépenses caissier, caisse gérant, salaires déduits des shifts) | 422 Personnel, rémunérations dues | 661 Rémunérations |
| Paiements Trésorerie de catégorie salaire (BQ) | 422 | 661 |

Clé de la règle : `restaurant_id` + mois (pour BQ, le mois du dû payé, `tresorerie_dus.mois`).

## Écritures PA — une pièce par état validé

Pièce `PA-<resto court>-AAAAMM`, datée du dernier jour du mois, somme des bulletins (`bulletin.calcul`) :

| Ligne | Débit | Crédit |
|---|---|---|
| Salaire brut (+ arrondi du net) | 661 Rémunérations | |
| Transport et tenue | 663 Indemnités forfaitaires | |
| Charges patronales CNPS (codes 415, 470, 480, 481, 490) | 664 Charges sociales | |
| Taxes patronales sur salaires (codes 500, 520, 530, 531) | 6413 Taxes sur salaires | |
| CNPS salarié + CMU salarié + charges patronales CNPS | | 431 CNPS |
| ITS retenu + taxes patronales | | 447 État (ITS et taxes) |
| Dû au personnel (brut + transport + tenue + arrondi − retenues salariales) | | 422 |

Le 422 est soldé par les versements (avances et paie en caisse, paiements Trésorerie) ; les avances
déduites du bulletin sont donc déjà dans le 422, sans compte séparé.
Équilibre : 661 + 663 + 664 + 6413 = 431 + 447 + 422 (au franc).

## Comptes ajoutés

| Clé | Compte | Intitulé |
|---|---|---|
| indemnites | 663 | Indemnités forfaitaires versées (transport, tenue) |
| chargesSociales | 664 | Charges sociales patronales (CNPS) |
| taxesSalaires | 6413 | Taxes sur appointements et salaires (part patronale) |

## Architecture

- `lib/journalPaie.js` (pur) : `ecrituresPaie({ mois, restaurant, lignes })`, `clePaie(restaurantId, mois)`.
  Tests `lib/journalPaie.test.mjs` (bulletins calculés par `calculerBulletin`).
- `lib/journalCaisse.js` : option `paieAuDu` (journée) / `paieValidee` (Set de clés, mois) → Paie en 422.
- `lib/journalTresorerie.js` : paiement de salaire → 422 si la clé du dû est validée, sinon 661.
- `lib/exportJournalCaisse.js` : charge les états `valide` du mois et leurs lignes ; journal PA ;
  onglet Contrôle : colonne « Paie du mois » (état validé / versements).
