# Plan de durcissement sécurité — Edge Functions (option 1)

> But : réduire l'exposition « la clé `anon` (publique) donne un accès total à la
> base ». On déplace les opérations **sensibles** côté serveur (Edge Functions
> Supabase avec la clé `service_role`, jamais exposée), puis on **resserre** les
> politiques RLS `anon` sur les tables concernées.

## ⚠️ La menace qu'on traite
La clé `anon` est dans le bundle (publique). Aujourd'hui toutes les tables sont
en `allow_all` pour `public` → qui extrait la clé peut **lire/écrire/supprimer
toute la base** (PIN, argent, employés) sans passer par l'app. Le login PIN ne
protège que l'app, pas la base.

## Contraintes à respecter (ne rien casser)
- **Mode hors-ligne** : `lib/offlineQueue.js` écrit via la clé `anon`. Les ops
  passées en Edge Function deviennent **online-only** → à réserver aux ops déjà
  critiques/online (la validation de point l'est déjà).
- **Pas d'identité serveur** aujourd'hui (login PIN client). Il faut un jeton de
  session vérifiable côté serveur (sinon une Edge Function ne sait pas qui appelle).
- **Migration progressive** : garder le chemin `anon` en fallback pendant la
  transition, table par table.

## Le plus gros risque à régler en premier 🔴
Les **PIN sont stockés en clair** dans `utilisateurs.pin`, et le login compare
`pinSaisi === selected.pin` côté client (donc l'app lit le PIN). Si quelqu'un lit
la table `utilisateurs` avec la clé anon → **tous les codes de connexion fuient**.
→ Phase 1 ci-dessous corrige ça (hash + vérif serveur).

## Phasage

### Phase 1 — Auth serveur légère + PIN hashés (fondation)
1. Edge Function `auth-login` : reçoit (restaurant, user, PIN), vérifie le PIN
   **hashé** en base (bcrypt) côté serveur, renvoie un **jeton de session signé**
   (JWT signé avec un secret de fonction, durée 8–24h).
2. Migrer `utilisateurs.pin` → `pin_hash` (script one-shot qui hashe l'existant).
3. Client (`app/login.js`) : appeler `auth-login` au lieu de lire le PIN ; stocker
   le jeton ; l'envoyer dans les appels suivants.
4. Resserrer la policy `utilisateurs` : `anon` ne peut **plus** lire `pin`/`pin_hash`
   (vue restreinte ou colonne masquée).
   → Gain : lire `utilisateurs` ne donne plus aucun code.

### Phase 2 — Edge Functions pour les écritures sensibles (argent)
Créer une Edge Function par opération critique, qui vérifie le jeton de session
puis écrit avec `service_role` :
- `valider-point` (remplace `validerPoint`, déjà online-only)
- `modifier-credit-fournisseur` + `fix-credits` (le « Fix tout »)
- `upsert-transaction-fournisseur` (ou garder le RPC mais derrière la fonction)
- `gerer-utilisateur` (créer/modifier/supprimer un compte, changer un PIN)

### Phase 3 — Resserrer les policies `anon`
Sur les tables protégées (`utilisateurs`, `transactions_fournisseurs`, `points`,
`fournisseurs`, `historique_credit_fournisseurs`) :
- retirer `INSERT/UPDATE/DELETE` pour `anon` (les écritures passent par les fonctions),
- garder un `SELECT` minimal nécessaire à l'affichage (ou le déplacer aussi si très
  sensible).

### Phase 4 — Nettoyage
- Retirer la clé `anon` des fichiers committés (`app.json`/`eas.json`) → variables
  d'env Vercel/EAS (la clé reste dans le bundle, mais on limite la diffusion).
- Vérifier que tout marche online + définir le comportement hors-ligne des ops
  déplacées (message « action possible uniquement en ligne »).

## Décisions à prendre avant de coder
1. **Périmètre v1** : on protège quoi en premier ? (reco : Phase 1 PIN + `valider-point`
   + crédits — le cœur « argent + identité »).
2. **Jeton de session** : JWT signé par secret de fonction (simple) — OK ?
3. **Hors-ligne** : accepter que validation/crédits soient **online-only** (déjà le cas
   pour la validation).

## Effort estimé
- Phase 1 (auth + PIN hash) : ~1 journée. **Le plus rentable.**
- Phase 2–3 (écritures sensibles + policies) : ~1–2 jours.
- Phase 4 : ~0,5 jour.

## Ce que ça NE fait pas
Tant qu'on garde du `SELECT anon` sur des tables, leur **lecture** reste possible
avec la clé. Le durcissement total (lecture incluse, par restaurant/rôle) = option 2
(migration **Supabase Auth**), plus lourde.
