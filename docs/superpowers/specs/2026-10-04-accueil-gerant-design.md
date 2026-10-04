# Accueil gérant modernisé — conception

Date : 04/10/2026 · Statut : validée en conversation, à relire

## Pourquoi

L'accueil manager (`components/accueil/AccueilManager.js`) a été modernisé :
bandeau du jour, accès directs, bandeaux dépliants par thème, sous-titres
vivants. Le gérant a encore l'ancienne grille de cartes à emojis
(`renderMenu` dans `app/accueil.js`) et un bandeau orange pour les
corrections. On lui donne le même accueil, centré sur **son** restaurant.

## Ce qui est décidé

- **Approche A** : on étend l'accueil manager (un seul composant, une
  configuration par rôle) plutôt que de recopier le visuel.
- Liste des écrans du gérant inchangée : elle reste réglée dans Paramètres
  (`lib/menus.js`, `ACCES_DEFAUT.gerant` + base). Seule la présentation change.

## 1. Bandeau du jour (son restaurant)

Remplace, pour le gérant, le bandeau orange « N correction(s) demandée(s) »
de `app/accueil.js`. Titre : « Hier · samedi 3 octobre ».

- **Point d'hier** (`points` du restaurant à la date d'hier) :
  - ✏️ « N correction(s) demandée(s) par le manager » si des
    `deverouillages_points` sont ouverts (prioritaire) → appui :
    `/correction-point` ;
  - ✅ « Point d'hier validé » (+ « et vérifié » si `verifie`) ;
  - ⏳ « Point d'hier pas encore validé » ;
  - « Point d'hier pas encore saisi » s'il n'existe pas.
- **Ventes d'hier** en grand : `points.vente_total` du point d'hier (FCFA),
  avec « ↑ 8 % vs avant-hier · ↓ 3 % vs sam. dernier » (même calcul que les
  lignes Avis/Contacts, `lib/hierAccueil.js`) : **une hausse en vert, une
  baisse en rouge**, chaque comparaison colorée séparément. Absent si pas de point.
- **Demandes** : « N demande(s) en attente · M explication(s) en cours » —
  `demandes` du restaurant au statut `en_attente`, `demandes_explication` du
  restaurant aux statuts `en_attente_acceptation`, `acceptee`, `envoyee`.
  Appui : `/demandes`. « Aucune demande en attente » si zéro.

Lecture hors ligne ou en erreur : pas de bandeau (comme le manager).

## 2. Accès direct

Saisir les ventes (grande tuile), Déductions gérant, Crédits fournisseurs —
seulement celles que le gérant a dans sa liste (le Tableau de bord ne lui est
pas accessible). Les écrans verrouillés après validation
du point (`verrouSiPointValide`) restent verrouillés.

## 3. Bandeaux dépliants

| Bandeau | Écrans (dans cet ordre, s'ils sont dans sa liste) |
|---|---|
| Journée | Saisir les ventes, Livraisons, Point caissier, Espace caissier |
| Dépenses | Déductions gérant, Crédits fournisseurs, Dépenses, Fournisseurs |
| Équipe | Demandes, Demandes d'explication, Présences, Documents |
| Clients | Contacts, Avis clients |
| Autres | tout écran de sa liste absent des bandeaux ci-dessus |

Bandeaux ouverts mémorisés sur le téléphone, comme pour le manager. Dans
**Clients**, les lignes Avis et Contacts affichent « Hier : … » pour **son**
restaurant (mêmes calculs que le manager, filtrés).

## Couleurs

Violet Samtrackly, comme l'accueil manager : en-tête et pastille de rôle du
gérant en violet (`#534AB7`, texte blanc) au lieu de l'orange actuel. Accent
**orange vif** (`#F47B0F`) pour la grande tuile « Saisir les ventes ». Hausse en
vert, baisse en rouge. Le caissier garde son en-tête orange.

## 4. Technique

- `lib/groupesAccueil.js` : `FAVORIS_GERANT`, `GROUPES_GERANT` (couleurs et
  icônes dans le même esprit), icônes manquantes ajoutées à `ICONES_TUILES`
  (ventes, dashboard, livraisons, gerant-caissier, deductions-gerant,
  demandes, demandes-explication, depenses, fournisseurs, presences,
  inventaire, point-shift) ; `organiserAccueil(tuiles, role)` remplace
  `organiserAccueilAdmin` (gérant → config gérant, sinon config admin).
- `lib/accueilGerant.js` (nouveau, pur, testé) : `etatPointHier({ point,
  nbCorrections })`, `texteDemandes({ demandes, explications })`.
- `components/accueil/BandeauGerant.js` (nouveau) : le bandeau du §1.
- `components/accueil/AccueilManager.js` : reçoit `restaurantId` ; pour le
  gérant, charge son état du jour (point d'hier, d'avant-hier et de la
  semaine d'avant, corrections, demandes, avis et contacts de son
  restaurant) et affiche `BandeauGerant`.
- `app/accueil.js` : le gérant passe par `AccueilManager` ; son ancien
  bandeau de corrections disparaît (repris dans le bandeau du jour). Le
  caissier garde la grille actuelle.

## Tests

`node:test` : `organiserAccueil` pour le gérant (ordre, « Autres »,
écrans absents de sa liste ignorés), `etatPointHier` (corrections
prioritaires, validé, vérifié, pas validé, pas saisi), `texteDemandes`
(singulier/pluriel, zéro).

## Hors périmètre

- Accueil caissier (inchangé).
- Changer la liste des écrans du gérant (reste dans Paramètres).
