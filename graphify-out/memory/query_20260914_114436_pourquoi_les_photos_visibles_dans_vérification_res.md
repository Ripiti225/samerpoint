---
type: "query"
date: "2026-09-14T11:44:36.932899+00:00"
question: "Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?"
contributor: "graphify"
outcome: "corrected"
correction: "Reconnaître les anciens marqueurs gerant_caissier/deduction_gerant et appliquer le repli également au modal Voir l'historique, pas seulement à la vue mensuelle."
source_nodes: ["credits-fournisseurs.js", "preparerHistoriqueFournisseur()", "restaurerPhotosFacturesDepuisPoints()", "VerificationScreen()"]
---

# Q: Pourquoi les photos visibles dans Vérification restent absentes de l'historique Crédits fournisseurs sur localhost ?

## Answer

Les anciennes transactions récupérables portent saisi_par=gerant_caissier et source=deduction_gerant. Le premier repli exigeait saisi_par=gerant et excluait donc toutes ces lignes. La préparation de l'historique charge désormais draft_gerant et reconnaît les trois formats gérant: gerant, gerant_caissier et deduction_gerant.

## Outcome

- Signal: corrected
- Correction: Reconnaître les anciens marqueurs gerant_caissier/deduction_gerant et appliquer le repli également au modal Voir l'historique, pas seulement à la vue mensuelle.

## Source Nodes

- credits-fournisseurs.js
- preparerHistoriqueFournisseur()
- restaurerPhotosFacturesDepuisPoints()
- VerificationScreen()