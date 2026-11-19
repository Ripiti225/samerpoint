# Export comptable SYSCOHADA — étape 2 : journal Banque et Trésorerie

Date : 19/11/2026 · Suite de `2026-11-19-export-comptable-caisse-design.md` (étape 1).

## But

Ajouter à l'export comptable du mois :
- **BQ** : une écriture par mouvement de Trésorerie (`tresorerie_mouvements`) du mois ;
- **OD** : en fin de mois, par restaurant, les commissions estimées des plateformes et du mobile money,
  et les frais de publicité Glovo réels.

## Décisions validées

- Contrepartie déduite de ce à quoi le mouvement se rattache ; **cas ambigus en 471 Compte d'attente**
  avec le libellé d'origine (le cabinet reclasse).
- **Commissions estimées** avec les taux de l'app (`COEFFICIENTS` : Yango 23 %, Glovo 29,5 %,
  OM/Wave/Djamo 1 %) appliqués aux ventes du mois du journal de Caisse.
- Même bouton, même classeur ; libellé « Télécharger l'export comptable ». Export d'un restaurant :
  seulement les mouvements rattachés à ce restaurant.

## Données (vérifiées, lecture seule)

- Comptes : BACI, SIB, Espèces, Tête de fond OM / Wave / Djamo, Cotisation salaire, Cotisations autres.
- Types de mouvement : partenaire, paiement, direction, virement (toujours par paires, total 0),
  coffre, cotisation, pret, recalage, recu_banque, autre. `montant` signé (+ entrée, − sortie).
- Liens : `tresorerie_paiements.mouvement_id` → `tresorerie_dus` (categorie, categorie_direction) ;
  `tresorerie_partenaire_lignes.mouvement_id` (partenaire) ; `tresorerie_depenses_direction.mouvement_id`
  (categorie, restaurant_id).
- Réceptions partenaires : **nettes, sans brut** → commission exacte inconnue.
- Lignes partenaires `pub` (Glovo) : publicité retenue, par restaurant et période → réelle.
- Lignes `reel` (relevés plateformes avec brut) : partielles (Glovo par semaine, Yango une période) →
  **non utilisées** pour l'instant (piste d'amélioration).

## Comptes ajoutés à `COMPTES`

| Clé | Compte | Intitulé |
|---|---|---|
| baci / sib | 5211 / 5212 | Banque BACI / Banque SIB |
| especesDirection | 5712 | Caisse direction (espèces) |
| coffre | 5713 | Coffre |
| tdfOm / tdfWave / tdfDjamo | 5514 / 5515 / 5516 | Tête de fond Orange Money / Wave / Djamo |
| cotisSalaire / cotisAutres | 5717 / 5718 | Caisse cotisations salaire / autres |
| virementsInternes | 585 | Virements de fonds internes |
| locations | 622 | Locations (loyers) |
| droitsEnregistrement | 646 | Droits d'enregistrement et timbre (bail, timbre) |
| impotsTaxes | 641 | Impôts et taxes directs (TEE) |
| salairesDus | 422 | Personnel, rémunérations dues |
| cnps | 431 | Sécurité sociale (CNPS) |
| itsRetenu | 447 | État, impôts retenus à la source (ITS) |
| entretien | 624 | Entretien, réparations |
| petitMateriel | 6056 | Achats de petit matériel |
| materielOutillage | 2441 | Matériel et outillage (équipement) |
| autresImmobilisations | 2448 | Autres matériels et mobiliers (investissement) |
| associe | 4621 | Associé, compte courant (retraits du patron) |
| chargesDiverses | 6588 | Autres charges diverses |
| commissionsPlateformes | 632 | Commissions des plateformes (estimées) |
| fraisMobileMoney | 631 | Frais sur mobile money (estimés) |
| publicite | 627 | Publicité (Glovo) |
| attente | 471 | Compte d'attente (à reclasser par le cabinet) |

## Écritures

**BQ** — pièce `BQ-AAAAMMJJ-<8 premiers caractères de l'id>`, date du mouvement :
compte de trésorerie (selon le nom du compte, sinon attente) au débit si entrée, au crédit si sortie ;
contrepartie en sens inverse :

| Type | Contrepartie |
|---|---|
| partenaire | yango / glovo → client plateforme ; om / wave / djamo → monnaie électronique du restaurant (5511/5512/5513) |
| virement | virementsInternes |
| coffre | coffre |
| paiement | selon `du.categorie` : loyer → locations ; bail, impot → droitsEnregistrement ; tee → impotsTaxes ; its → itsRetenu ; cnps → cnps ; salaire → salairesDus ; autre → selon `categorie_direction` (table direction) ; dette, admin, inconnu → attente |
| direction | fond → caisse (571) ; fond_nature → achats ; reparation → entretien ; materiel → petitMateriel ; equipement → materielOutillage ; investissement → autresImmobilisations ; retrait_perso → associe ; divers → chargesDiverses ; administratif → fournisseurs ; inconnu → attente |
| cotisation, pret, recalage, recu_banque, autre | attente |

Libellé : libellé du mouvement. Restaurant : celui du mouvement, sinon de sa ligne liée, sinon « Direction ».

**OD** — pièce `OD-<resto>-AAAAMM`, date = dernier jour du mois, par restaurant :
- commissionsPlateformes au débit, client Yango / Glovo au crédit : tablette du mois × (1 − taux) ;
- fraisMobileMoney au débit, 5511/5512/5513 au crédit : encaissements OM/Wave/Djamo des shifts × 1 % ;
- publicite au débit, client Glovo au crédit : lignes `pub` dont `periode_debut` est dans le mois.

## Architecture

- `lib/comptesSyscohada.js` : comptes ajoutés.
- `lib/journalTresorerie.js` (pur) : `ecrituresTresorerie({ mouvements, comptes, liens, restaurants })`,
  `ecrituresCommissions({ mois, assiettes })`, `assiettesCommissions({ points, shifts, pubs, restaurants })`.
  Tests `lib/journalTresorerie.test.mjs`.
- `lib/exportJournalCaisse.js` : charge aussi mouvements + liens + pubs, ajoute BQ et OD au Journal,
  Contrôle par journal ; libellé du bouton changé dans `app/cloture-mois.js`.

## Tests

Chaque mouvement équilibré ; chaque type et chaque catégorie vers le bon compte ; inconnu → attente ;
virements d'une paire qui s'annulent sur 585 ; commissions arrondies et équilibrées ; filtre restaurant.
Contrôle SQL d'octobre : tous les mouvements ont une contrepartie, part en attente chiffrée.
