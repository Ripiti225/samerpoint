# Recherche globale — choix du restaurant, RH, groupes repliés — design

Date : 12/10/2026 — validé avec l'utilisateur.

## Choix du restaurant (manager et RH)

- Sous le champ : une rangée de puces **🌍 Global** + les restaurants. Au départ :
  Global. Changer de puce relance la recherche, sans retaper.
- Le filtre est fait **en base** : `p_restaurant_id` (NULL = Global) ; la limite
  de 25 par source s'applique au restaurant choisi.
- Le gérant n'a pas ce choix : son restaurant et sa journée active (inchangé).

## RH

- La loupe apparaît aussi sur l'accueil RH.
- `recherche_globale(…, p_rh boolean DEFAULT false)` (6e paramètre ; les
  versions à 4 et 5 paramètres sont supprimées). RH = tout l'historique, tous
  les restaurants ou un seul, mais **seulement les sources de ses écrans** :
  factures / corrections / paiements fournisseurs, fournisseurs, travailleurs,
  demandes, demandes d'explication, permissions et congés, contrats, documents,
  documents travailleur, contacts clients. Écrans admin (`demandes-admin`…).
- Côté app, un résultat dont l'écran n'est pas dans ses tuiles reste grisé
  (même règle que le gérant).

## Groupes repliés

- À chaque nouvelle recherche, les groupes (Présences, Fournisseurs…) sont
  **fermés** : seule la bannière « ▸ SOURCE  n » s'affiche ; un toucher la
  déroule (▾), un autre la referme. Plusieurs groupes peuvent être ouverts.
- S'il n'y a **qu'un seul groupe**, il s'ouvre tout seul.
- Logique pure : `ouverturesInitiales(groupes)`, `lignesAffichees(groupes, ouverts)`
  dans `lib/rechercheGlobale.js` (testées).

## Vérification

Migration testée sur le Postgres local : manager Global / un restaurant, RH
Global (sources RH seulement) / un restaurant (rien d'un autre), gérant inchangé,
une seule version de la fonction après passage.

## Style (choisi par l'utilisateur : « sobre façon iPhone »)

- Barre du haut « ‹ Retour » + petit titre qui apparaît quand le **grand titre
  « Recherche »** se replie en défilant (reanimated).
- Champ gris arrondi (loupe, ⓧ pour effacer), bord coloré quand il est actif ;
  puces Global / restaurants grises, la choisie pleine.
- Rubriques en **listes groupées iOS** : icône monochrome par rubrique
  (`iconeSource`), nombre, chevron qui pivote ; résultats dans la même carte,
  filets fins, extrait surligné + « Écran › Onglet · resto · date », montant à droite.
- Résumé « 42 RÉSULTATS · 6 RUBRIQUES » ; états vides avec grande icône grise.
