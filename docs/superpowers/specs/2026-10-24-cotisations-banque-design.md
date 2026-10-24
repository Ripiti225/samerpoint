# Cotisations reçues dans Banque — conception (24/10/2026)

## But

Noter chaque remise de cotisation **au moment où elle arrive**, depuis Banque, au lieu
de la saisir dans l'état de salaires (colonne « Dont cotisé ») en fin de mois.

## Ce qui change pour l'utilisateur

1. **Deux nouveaux comptes dans Banque** : « Cotisation salaire » et « Cotisations autres ».
   Chacun a sa carte, son solde et son historique, comme BACI / SIB / Espèces.
2. Dans la fenêtre de ces comptes, un bouton **« Cotisation reçue »** :
   restaurant, montant, date (calendrier) ; pour « Cotisations autres », on choisit
   aussi la cotisation : CNPS, Impôt, ITS, TEE, Loyer, Bail.
3. L'argent **entre dans ce compte**, pas dans Espèces.
4. La fiche fournisseur de la cotisation du restaurant (« Cotisation salaire », « CNPS »…)
   baisse du montant, comme aujourd'hui (`inserer_transaction_hors_point`).
5. **Résultat** : la cotisation réduit les charges du restaurant **le mois de sa date de
   réception**. Plusieurs remises dans le mois s'additionnent. Aucune dépendance à
   l'état de salaires : rien n'est perdu si l'état n'est pas encore saisi.
6. **Payer** : les deux comptes apparaissent dans la liste des comptes de « Payer »
   (À payer). On peut payer n'importe quelle charge, de n'importe quel mois. Le paiement
   ne touche pas le résultat une seconde fois (comme tout paiement de charge).
7. **État de salaires / saisie groupée** : la colonne « Dont cotisé » disparaît (toutes
   catégories). À la place, une ligne d'information par restaurant :
   « Cotisations reçues en <mois> : X F ».
8. **Détail d'une charge** : le bouton « Cotisation reçue du restaurant » disparaît. Les
   anciennes cotisations rattachées à la charge restent listées et annulables.
9. **Annuler** : toucher la ligne dans l'historique du compte → « Annuler la cotisation ».
   L'entrée du compte, la transaction fournisseur et l'effet sur le résultat sont défaits.

## Données (migration `supabase_cotisations_banque.sql`, idempotente)

- `tresorerie_cotisations_recues.du_id` devient facultatif (`DROP NOT NULL`).
- Nouvelle colonne `categorie text` (salaire, cnps, impot, its, tee, loyer, bail).
- Comptes créés s'ils manquent : `Cotisation salaire` (ordre 10), `Cotisations autres` (ordre 11).
- Les anciennes lignes (avec `du_id`) ne bougent pas : elles restent entrées en Espèces et
  continuent de réduire leur charge comme avant.

## Calcul du résultat (`lib/chargesMois.js`)

- Anciennes lignes (`du_id` rempli) : inchangé, « dont X cotisés » sur la charge.
- Nouvelles lignes (`du_id` vide) : une ligne de charge **négative**
  « Cotisation <catégorie> reçue » au mois de `date`, pour `restaurant_id`.
  `lib/direction.js` additionne déjà les charges : le net monte d'autant.
- Taux salarial : inchangé (l'état de salaires y compte en entier, par principe).

## Code touché

- `lib/cotisations.js` : comptes de cotisation (noms, catégories proposées), ligne de
  résultat des nouvelles cotisations (pur, testé).
- `lib/tresorerieDb.js` : `recevoirCotisation` accepte une réception sans charge
  (compte choisi, catégorie, restaurant) ; `annulerCotisation` inchangée.
- `lib/chargesMois.js` : lit aussi les cotisations sans `du_id` de la plage.
- `app/tresorerie-banque.js` : bouton et formulaire « Cotisation reçue » dans la fenêtre
  des deux comptes ; annulation depuis l'historique.
- `components/tresorerie/saisieGroupee.js` : colonne « Dont cotisé » remplacée par
  l'information des cotisations reçues du mois.
- `components/tresorerie/du.js` : plus de bouton d'ajout ; liste des anciennes gardée.

## Erreurs

- Montant vide ou nul, date absente, restaurant non choisi → message, rien n'est écrit.
- Pas de fiche de cotisation trouvée pour ce restaurant : la réception est enregistrée,
  le message dit qu'aucune fiche n'a été diminuée.
- Échec en cours d'écriture : on retire ce qui a été écrit (comme aujourd'hui).
- Migration non passée : avertissement dans Banque, pas de bouton.

## Tests

- `lib/cotisations.test.mjs` : lignes de résultat des nouvelles cotisations (mois de la date,
  par restaurant, somme, anciennes lignes ignorées).
- `lib/chargesMois.test.mjs` : fusion avec les cotisations sans charge.
- Lint 0 erreur, tous les tests `lib/*.test.mjs`, export web sans erreur.
