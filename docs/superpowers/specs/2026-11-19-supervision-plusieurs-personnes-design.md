# Supervision par plusieurs personnes — conception

Date : 19/11/2026 — validée par l'utilisateur.

## Problème

Les visites de supervision se font avec un compte partagé « Superviseur » (code 4321).
Toutes les visites sont signées « Superviseur » : impossible de savoir qui était où, et quand.
Cinq personnes font des visites : Administrateur, Manager General, Responsable RH,
Zongo Lucien (gérant Samer Angré 7E), Bonzou Michel (gérant Samer Oasis).

## Décisions

1. **Qui peut** : nouvelle colonne `utilisateurs.peut_superviser boolean not null default false`.
   Case « Peut faire des visites de supervision » dans Paramètres → Utilisateurs (fiche du compte),
   enregistrée par `enregistrer_utilisateur` (code du manager). Cochée d'office pour les 5 comptes.
2. **Entrée 1 — tuile Superviseur à la connexion** : toucher le compte de rôle `superviseur`
   ouvre une étape « Qui fait la visite ? » (comptes actifs `peut_superviser`), puis le clavier
   de code de la personne choisie (vérifié par `connexion_utilisateur`, comme toute connexion ;
   changement de code obligatoire géré comme d'habitude). Session : identité = la personne,
   rôle actif = `superviseur` → écran `/superviseur` uniquement. Pas de Face ID sur ce chemin.
3. **Entrée 2 — depuis son propre compte** : dans `/supervision`, bouton « 🧭 Faire une visite »
   si le compte connecté a `peut_superviser`. Ouvre `/superviseur` avec `depuis=compte` :
   « Retour » vers l'accueil au lieu de « Se déconnecter ». Pas de nouveau code.
4. **Code 4321 supprimé** : `connexion_utilisateur` refuse toute connexion directe d'un compte
   de rôle `superviseur` ; son code est remplacé par une valeur inutilisable.
5. **Signature** : `supervision_visites.superviseur_id / superviseur_nom` = la vraie personne
   (colonnes existantes). La visite en cours appartient à la personne : commencée par une entrée,
   terminable par l'autre. Les 4 anciennes visites restent signées « Superviseur ».
6. **Gérant et son restaurant** : le restaurant du compte (`utilisateurs.restaurant_id`) est retiré
   de sa liste de visites ; un trigger sur `supervision_visites` refuse aussi l'insertion
   (`superviseur_id` dont `restaurant_id` = `restaurant_id` de la visite).

## Composants

- `supabase_supervision_plusieurs.sql` (Samtrackly, idempotent, à passer par l'utilisateur) :
  colonne + `grant select (peut_superviser)` à anon/authenticated ; `enregistrer_utilisateur`
  avec `p_peut_superviser boolean default null` (null = inchangé ; ancienne signature supprimée,
  l'app actuelle continue d'appeler sans ce paramètre) ; refus des comptes `superviseur` dans
  `connexion_utilisateur` ; trigger « pas son propre restaurant » ; cases cochées pour les 5.
- `lib/supervision.js` : fonctions pures `superviseursPossibles(utilisateurs)` et
  `restaurantsVisitables(restaurants, personne)` + tests `lib/supervision.test.mjs`.
- `lib/codesDb.js` : `enregistrerUtilisateur` transmet `peutSuperviser`.
- `app/login.js` : étape « Qui fait la visite ? » + redirection rôle forcé `superviseur`.
- `app/superviseur.js` : filtre `restaurantsVisitables`, mode `depuis=compte`.
- `app/supervision.js` : bouton « Faire une visite ».
- `app/parametres.js` : case dans la fiche, badge 🧭 dans la liste.

## Erreurs

- Aucun compte coché : « Personne n'est autorisé à faire des visites. Demandez au manager. »
- Code faux / bloqué : messages existants de la connexion.
- SQL pas encore passé : la tuile affiche le message de mise à jour existant (`messageReponse`),
  la liste « Qui fait la visite ? » est vide → message ci-dessus.

## Tests

Tests `node:test` sur les deux fonctions pures (comptes inactifs exclus, gérant sans son resto,
compte global voit tout, porte « Superviseur » jamais dans la liste). SQL testé sur Postgres local
si disponible. Lint 0 erreur. Pas de publication sans accord.
