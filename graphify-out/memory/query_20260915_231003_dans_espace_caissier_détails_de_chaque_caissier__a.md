---
type: "query"
date: "2026-09-15T23:10:03.095027+00:00"
question: "Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire"
contributor: "graphify"
outcome: "useful"
source_nodes: ["StatsCaissiers()", "CaissierCard()", "points_shifts", "inventaires_shifts", "inventaire_lignes"]
---

# Q: Dans espace caissier détails de chaque caissier, afficher son manquant, son explication et l'explication d'inventaire

## Answer

Expanded from original query via vocab: [caissier, gerant, shift, manquant, explication, inventaire, point, stats, ecart, details]. L'écran app/stats-caissiers.js agrège actuellement les shifts mais ne sélectionne ni ecart_pos ni explication_ecart et ne charge aucun inventaire. Les données existent dans points_shifts.ecart_pos et points_shifts.explication_ecart. Les inventaires sont reliés par point_id et caissier_id dans inventaires_shifts, avec les explications produit dans inventaire_lignes.explication.

## Outcome

- Signal: useful

## Source Nodes

- StatsCaissiers()
- CaissierCard()
- points_shifts
- inventaires_shifts
- inventaire_lignes