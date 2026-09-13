---
type: "query"
date: "2026-09-12T12:46:28.673464+00:00"
question: "Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["credits-fournisseurs.js", "chargerMois()", "VerificationScreen()", "PhotoJustificatif()"]
---

# Q: Pourquoi les photos des factures fournisseurs s'affichent dans Vérification mais pas dans Crédits fournisseurs ?

## Answer

Expanded from original query via vocab: [credits, facture, factures, fournisseur, fournisseurs, verification, photo, photos, justificatif, transaction, url]. La vue mensuelle de credits-fournisseurs sélectionnait seulement fournisseur_id, fournisseur_nom, facture et paye, alors que Vérification sélectionne la transaction complète incluant photo_url. Le correctif charge photo_url et conserve les factures dans l'agrégation mensuelle afin de rendre leurs justificatifs.

## Outcome

- Signal: useful

## Source Nodes

- credits-fournisseurs.js
- chargerMois()
- VerificationScreen()
- PhotoJustificatif()