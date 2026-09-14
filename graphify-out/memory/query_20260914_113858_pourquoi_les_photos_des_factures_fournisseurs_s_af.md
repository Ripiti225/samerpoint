---
type: "query"
date: "2026-09-14T11:38:58.890291+00:00"
question: "Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?"
contributor: "graphify"
outcome: "corrected"
correction: "Le premier correctif ne couvrait que les transactions ayant déjà photo_url. Il faut aussi récupérer la photo du draft_gerant du même point et fournisseur pour les anciennes transactions gérant sans photo distante."
source_nodes: ["credits-fournisseurs.js", "chargerMois()", "VerificationScreen()", "PhotoJustificatif()"]
---

# Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?

## Answer

Expansion: [photo, photos, facture, factures, fournisseur, fournisseurs, credit, credits, verification, justificatif, transaction, url]. La cause réelle est que Vérification privilégie points.draft_gerant.fournisseurs[*].photoUri pour les saisies gérant, tandis que Crédits fournisseurs ne lisait que transactions_fournisseurs.photo_url. Le chargement mensuel récupère désormais draft_gerant et restaure la photo distante seulement pour la transaction gérant correspondante avant l'agrégation.

## Outcome

- Signal: corrected
- Correction: Le premier correctif ne couvrait que les transactions ayant déjà photo_url. Il faut aussi récupérer la photo du draft_gerant du même point et fournisseur pour les anciennes transactions gérant sans photo distante.

## Source Nodes

- credits-fournisseurs.js
- chargerMois()
- VerificationScreen()
- PhotoJustificatif()