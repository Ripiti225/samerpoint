# Recherche globale — design

Date : 12/10/2026 — validé avec l'utilisateur (approche A, lot 1 puis lot 2).

## Besoin

Une loupe : on tape « paie », on voit **tous** les endroits où le mot apparaît —
libellé, note, motif, nom, explication… — avec l'écran et l'onglet où se trouve
chaque résultat, et un toucher pour y aller.

## Décisions prises

| Question | Choix |
|---|---|
| Qui | Manager **et** gérant |
| Où | Partout (argent, points, stock, RH, litiges, clients, journal) |
| Toucher un résultat | Ouvre l'écran, sur le bon onglet / la bonne date quand c'est possible |
| Technique | Une fonction SQL `recherche_globale` (un seul appel, insensible aux accents) |
| Découpage | Lot 1 : recherche + navigation vers les écrans qui savent déjà s'ouvrir sur un onglet ; Lot 2 : apprendre les autres écrans |

## Base — `recherche_globale(p_terme text, p_restaurant_id uuid, p_manager boolean, p_limite int default 100)`

Migration `supabase_recherche_globale.sql` (idempotente, à passer à la main) :

- `create extension if not exists unaccent;`
- Fonction `SECURITY INVOKER`, `STABLE`, renvoie :
  `source text, id uuid, restaurant_id uuid, date date, champ text, texte text, montant numeric, ecran text, onglet text, params jsonb`.
- Terme nettoyé : `trim`, moins de 2 caractères → aucun résultat. Comparaison
  `unaccent(lower(colonne)) like '%' || unaccent(lower(terme)) || '%'`
  (les `%` et `_` tapés sont échappés).
- `UNION ALL` d'une sous-requête par source (tableau ci-dessous), chacune
  limitée à `p_limite` lignes triées par date décroissante ; le tout trié par
  date décroissante puis tronqué à `p_limite`.
- **Filtre restaurant dans la base** : si `p_manager` est faux, chaque source
  garde seulement `restaurant_id = p_restaurant_id` ; les sources marquées
  « manager » ne renvoient rien. `restaurant_id` absent de la table → pris sur
  le point (`points.restaurant_id`) ou le travailleur / fournisseur.
- `champ` = libellé lisible du champ trouvé (« Note », « Motif », « Libellé »…),
  `texte` = valeur complète de ce champ (l'app découpe l'extrait).
- `NOTIFY pgrst, 'reload schema';` puis requête de contrôle sur « paie ».

Pas d'index : ~170 000 lignes de texte au total, un balayage par recherche reste
sous la seconde. Si ça devient lent, on ajoutera `pg_trgm` (hors périmètre).

### Sources

« M » = manager seulement. Date = colonne utilisée pour trier et afficher.

| Source (libellé affiché) | Table | Champs cherchés | Resto via | Date | Écran (lot 1) | Onglet / params |
|---|---|---|---|---|---|---|
| Dépenses du point | depenses | libelle, categorie, saisi_par_nom, caissier_nom | point | points.date | depenses | — |
| Dépenses gérant | depenses_gerant_caisse | description, categorie, facture | point | points.date | deductions-gerant | — |
| Factures fournisseurs | transactions_fournisseurs | fournisseur_nom, facture_correction_raison, caissier_nom | restaurant_id | points.date sinon created_at | credits-fournisseurs | — |
| Corrections de crédit | historique_credit_fournisseurs | motif, modified_by | restaurant_id | point → date, sinon fournisseur | credits-fournisseurs | — |
| Paiements fournisseurs | paiements_fournisseurs | note | restaurant_id | date | credits-fournisseurs | — |
| Fournisseurs | fournisseurs | nom, contact, depart_motif | restaurant_id | created_at | credits-fournisseurs | — |
| Points (journée) | points | contact_litige_motif, explication_ecart_machine, nb_commandes_correction_motif, verifie_par | restaurant_id | date | verification (M) / point-caissier | — |
| Points caissier | points_shifts | explication_ecart, caissier_nom | restaurant_id | date | point-caissier | — |
| Inventaire | inventaires | explication, explication_ecart, produit_nom, fournisseur_nom | restaurant_id | date | gestion-stock | — |
| Déductions vérification | deductions_verification | explication, produits_resume, caissier_nom | restaurant_id | date | verification | — |
| Présences | presences | travailleur_nom, statut | restaurant_id | date | presences | — |
| Travailleurs | travailleurs | nom, poste, contact, archive_motif | restaurant_id | created_at | equipe | `restaurant_id` |
| Demandes | demandes | description, motif_decline, travailleur_nom | restaurant_id | created_at | demandes-admin (M) / demandes | — |
| Demandes d'explication | demandes_explication | motif, description, reponse_note, refus_motif, travailleur_nom | restaurant_id | created_at | demandes-explication-admin (M) / demandes-explication | — |
| Permissions / congés | permissions_conges | motif, travailleur_nom | restaurant_id | date_debut | rh (M) | — |
| Contrats (M) | contrats_travailleurs | cloture_motif, type | restaurant_id | date_debut | contrats | — |
| Documents | documents | titre, description | restaurant_id | created_at | documents | — |
| Documents travailleur | documents_travailleurs | description, type_document | travailleur | created_at | documents | — |
| Litiges Glovo / Yango | litiges_glovo, litiges_yango | detail, notes, numero_commande, responsable_nom | restaurant_id | date | litiges | — |
| Litiges avis clients | litiges_avis_clients | contenu, notes, numero_commande, responsable_nom | restaurant_id | date | litiges | — |
| Point pas fait | litiges_point_pas_fait | notes, responsable_nom | restaurant_id | date | litiges | — |
| Contacts clients | contacts_clients | numero | restaurant_id | date | contacts | — |
| Commandes livraison | commandes | numero_commande, contact_client, plat | point | points.date | livraisons | — |
| Avis plateformes | platform_reviews | comment, author | restaurant_id | created_at | avis-plateformes | — |
| Charges (M) | charges | libelle | restaurant_id | mois | charges | — |
| À payer (M) | tresorerie_dus | libelle, note, creancier | restaurant_id | mois sinon created_at | tresorerie-a-payer | `onglet = categorie` |
| Mouvements restaurant (M) | tresorerie_mouvements | libelle | restaurant_id | date | tresorerie-restaurant | `id = restaurant_id` |
| Dépenses direction (M) | tresorerie_depenses_direction | note, categorie | restaurant_id | date | tresorerie-direction | — |
| Partenaires (M) | tresorerie_partenaire_lignes | note, partenaire | restaurant_id | date | tresorerie-partenaires | `partenaire` |
| Prévisions (M) | tresorerie_previsions | note, partenaire | fournisseur | created_at | tresorerie-a-payer | — |
| Cotisations reçues (M) | tresorerie_cotisations_recues | note | restaurant_id | date | tresorerie-a-payer | — |
| Coffre (M) | tresorerie_coffre_mouvements, tresorerie_coffre_emprunts | libelle / note | — | date | tresorerie-coffre | — |
| Transferts de fond (M) | transferts_fond | note, destination | restaurant_id | date | tresorerie-restaurant | `id = restaurant_id` |
| Journal (M) | journal_activite | action, details, user_nom | restaurant_id | created_at | journal | — |

Exclus volontairement (techniques ou sans intérêt) : tokens push, erreurs_client,
caches POS, `raw` des avis, photos, PIN.

## App

### `lib/rechercheGlobale.js` (logique pure, testée)

- `extrait(texte, terme, rayon = 40)` → `{ avant, trouve, apres }` autour de la
  première occurrence, comparaison sans accents ; `…` aux coupures.
- `normaliser(s)` : minuscules + accents retirés (même règle que `unaccent`).
- `grouperParSource(resultats)` → groupes dans l'ordre d'apparition, avec compte.
- `filtrerPourGerant(resultats, tuilesAutorisees)` : retire les résultats dont
  l'écran n'est pas dans les tuiles du gérant (`tuilesPourRole`), en plus du
  filtre en base.
- `routePour(resultat)` → `{ pathname, params }`.
- Tests `lib/rechercheGlobale.test.mjs` (node:test).

### `lib/api.js` — `rechercheGlobale(terme)`

Appelle le RPC avec `restaurantId` et `isManager` du contexte. Hors ligne :
renvoie `{ horsLigne: true }` (pas de cache, pas de file d'attente).

### Écran `app/recherche.js`

- Champ en haut, focus automatique, recherche **après 3 lettres**, 350 ms après
  la dernière frappe ; la requête précédente est ignorée si une nouvelle part.
- Résultats groupés par source (bannière = libellé de la source + compte), chaque
  carte : `Écran › Onglet` · restaurant (manager seulement) · date ·
  champ, extrait avec le mot **surligné**, montant s'il existe.
- États : « Tape au moins 3 lettres », « Recherche… », « Aucun résultat pour
  « xxx » », « Pas de connexion : la recherche a besoin d'internet », erreur.
- « 100 premiers résultats — précise ta recherche » quand la limite est atteinte.
- Styles via `useMemo(() => makeStyles(colors), [colors])`, thème clair/sombre.

### Bouton

Loupe dans l'en-tête de l'Accueil manager (`AccueilManager`) et de l'Accueil
gérant → `router.push('/recherche')`. Pas une tuile : toujours visible, pas
réglable dans Paramètres.

### Toucher un résultat

`router.push(routePour(r))`. Les écrans qui lisent déjà leurs paramètres
(`tresorerie-a-payer` onglet, `tresorerie-restaurant` id/onglet/partenaire,
`tresorerie-partenaires` partenaire, `equipe` restaurant_id,
`credits-fournisseurs` onglet) s'ouvrent au bon endroit.

Pour les autres : **bandeau de rappel** global (`components/BandeauRecherche.js`
monté dans `app/_layout.tsx`) — « 🔍 12/10 · Yop · « …solde paie septembre… » »,
fermable d'une croix, disparaît au retour sur l'écran Recherche. L'état vient
d'un petit store module (`lib/rechercheCourante.js`), pas du localStorage.

Les écrans gérant « du jour » (`depenses`, `presences`, `deductions-gerant`)
dépendent de la journée active du contexte : en lot 1 ils s'ouvrent tels quels
avec le bandeau ; le passage à la bonne journée est en lot 2.

## Lot 2 (après essai du lot 1)

Apprendre à chaque écran restant à lire `date`, `restaurant_id`, `id` (et
`onglet` s'il en a) : litiges, verification, point-caissier, gestion-stock,
journal, demandes*, contrats, documents, contacts, credits-fournisseurs
(fiche fournisseur ouverte), tresorerie-direction, tresorerie-coffre ; et pour
les écrans du jour, ouvrir la bonne journée. Spécifié et validé séparément.

## Hors périmètre

Recherche par montant (« 45000 »), historique des recherches, recherche hors
ligne, index trigramme, rôles directeur / RH / caissier.

## Vérification

- Tests `lib/rechercheGlobale.test.mjs` verts, `npm run lint` 0 erreur, export web OK.
- Après migration : contrôle SQL « paie » (manager) et même terme avec un
  restaurant (gérant) → aucune source « M », un seul restaurant.
