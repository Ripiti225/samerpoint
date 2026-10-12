# Recherche globale — lot 2, vague A — design

Date : 12/10/2026 — validé avec l'utilisateur. Suite de
`2026-10-12-recherche-globale-design.md` (lot 1).

## 1. Gérant : sa journée active seulement

Règle donnée par l'utilisateur : « le gérant ne voit que les infos du jour, il ne
peut pas voir une info déjà passée ». Le jour = **sa journée active**
(`dateJour` du contexte, choisie à la connexion).

`recherche_globale` gagne un 5e paramètre `p_date date` (l'ancienne signature à
4 paramètres est supprimée). Pour le gérant (`p_manager = false`) :

| Sources | Filtre |
|---|---|
| Datées : dépenses, dépenses gérant, points, points caissier, présences, commandes, factures / corrections / paiements fournisseurs, inventaire, litiges (4), contacts, avis | `restaurant = le sien` **et** `date = p_date` ; `p_date` nul → rien |
| Fiches : fournisseurs, travailleurs, documents, documents travailleur | `restaurant = le sien` |
| Demandes | le sien **et** (créée le `p_date` **ou** statut pas dans `validee, declinee, annulee`) |
| Demandes d'explication | le sien **et** (créée le `p_date` **ou** statut pas dans `acceptee, refusee, annulee`) |
| Sources « manager » | rien (inchangé) |

Le manager est inchangé (tout, tous restaurants, `p_date` ignoré).

## 2. Ouvrir au bon endroit

`params` renvoyés par la base (toujours des chaînes ou absents) :

| Source | Manager : écran + params | Gérant : écran + params |
|---|---|---|
| Dépenses du point | `modifier-point` {restaurant_id, date, onglet: `Dépenses`, focus} | `depenses` {focus} |
| Dépenses gérant | `modifier-point` {…, onglet: `Dép. Gérant`, focus} | `deductions-gerant` {focus} |
| Présences | `modifier-point` {…, onglet: `Présences`, focus} | `presences` {focus} |
| Points (journée) | `verification` {restaurant_id, point_id} (déjà géré) | `point-caissier` {restaurant_id} |
| Points caissier | `point-caissier` {restaurant_id, focus = shift} | idem |
| Factures, corrections, paiements fournisseurs, Fournisseurs | `credits-fournisseurs` {fournisseur_id} | idem |
| Travailleurs | `equipe` {restaurant_id, focus = travailleur} | idem |
| À payer | `tresorerie-a-payer` {onglet, focus = dû} | — |
| Prévisions, cotisations reçues | `tresorerie-a-payer` {onglet de leur dû, focus = du_id} | — |
| Litiges Glovo / Yango / avis / point pas fait | `litiges` {restaurant_id, date, onglet: `glovo`/`yango`/`avis`/`point_pas_fait`, focus} | idem |
| Demandes | `demandes-admin` {restaurant_id, focus} | `demandes` {focus} |
| Demandes d'explication | `demandes-explication-admin` {restaurant_id, focus} | `demandes-explication` {focus} |

Chaque écran lit ces paramètres **une seule fois**, après son premier
chargement (un `useRef` garde la trace), puis : choisit restaurant / date /
onglet, ouvre la fiche (modale existante) ou met la ligne en évidence.

### Mise en évidence d'une ligne — `lib/useFocusRecherche.js`

`useFocusRecherche(focusId)` → `{ refDefilement, surLayout(id), styleFocus(id) }` :
- `surLayout(id)` à passer en `onLayout` de la ligne : quand c'est la ligne
  cherchée, le `ScrollView` (`refDefilement`) défile jusqu'à elle (une fois) ;
- `styleFocus(id)` → bordure + fond jaunes pendant 4 s, puis rien.

Dans les écrans où la liste est imbriquée (sous-vues), on se contente du
`styleFocus` sans défilement.

### Bandeau de rappel

`ECRANS_AU_BON_ENDROIT` (dans `lib/rechercheGlobale.js`) : le bandeau ne
s'affiche plus pour un résultat dont l'écran y figure.

## Hors périmètre (vague B)

Livraisons, Stock, Contrats, Documents, Contacts, Avis plateformes, Charges,
Journal, Coffre, Direction, Mouvements / transferts restaurant, Déductions
vérification, Permissions et congés.

## Vérification

- Migration testée sur le Postgres local (structure prod) : gérant + `p_date`,
  fiches sans date, demandes en cours, manager inchangé.
- Tests `lib/*.test.mjs`, lint 0 erreur, export web.
