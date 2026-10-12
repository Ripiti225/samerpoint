# Recherche globale — lot 2, vague B — design

Date : 12/10/2026 — même modèle que la vague A
(`2026-10-12-recherche-globale-lot2a-design.md`), demandé par l'utilisateur
(« attaquons la seconde vague »).

## Ce que chaque résultat ouvre

| Source | Écran | Params | Ce que fait l'écran |
|---|---|---|---|
| Inventaire | `gestion-stock` | restaurant_id, date, produit_id, produit_nom | resto + période = ce jour (perso) + détail du produit |
| Déductions vérification | `verification` | restaurant_id, point_id | point ouvert (déjà géré) |
| Permissions et congés | `equipe` | restaurant_id, focus = travailleur | fiche du travailleur (`rh` redirigeait déjà vers Équipe) |
| Contrats | `contrats` | restaurant_id, recherche = nom, travailleur_id | filtre resto + recherche pré-remplie + fiche contrats du travailleur ouverte |
| Documents | `documents` | restaurant_id, focus | resto + document ouvert |
| Documents travailleur | `equipe` | restaurant_id, focus = travailleur | fiche du travailleur (ces documents vivent sur sa fiche) |
| Contacts clients | `contacts` | restaurant_id, date, recherche = numéro | onglet Clients, période = ce jour, recherche pré-remplie |
| Avis plateformes | `avis-plateformes` | restaurant_id, date, focus | onglet Avis, période = ce jour, avis encadré |
| Charges | `charges` | restaurant_id, mois, focus | resto + mois, ligne encadrée |
| Mouvements restaurant, Transferts de fond | `tresorerie-restaurant` | id, an, mois, focus | resto + période du mois, ligne encadrée |
| Dépenses direction | `tresorerie-direction` | focus | ligne encadrée (toutes les dépenses y sont listées par mois) |
| Partenaires | `tresorerie-partenaires` | partenaire, periode = periode_debut, focus | période du partenaire ouverte (déjà géré), ligne encadrée |
| Coffre, Emprunts au coffre | `tresorerie-coffre` | focus | ligne encadrée |
| Journal | `journal` | focus | l'entrée cherchée affichée en tête, encadrée (la liste ne garde que les 100 dernières) |

**Commandes livraison** : pas d'écran de consultation (Livraisons est la
saisie du shift d'un caissier, filtrée par caissier) → le bandeau de rappel
reste, c'est lui qui montre la date, le restaurant et le numéro.

`ItemIcone` (trésorerie) accepte `focus` + `focusId` comme les cartes de demandes.
`ECRANS_AU_BON_ENDROIT` couvre désormais tous les écrans sauf `livraisons`,
`depenses` et `deductions-gerant` (gérant : seulement des totaux, rien à encadrer).

Le filtre « journée active » du gérant (vague A) ne change pas.
