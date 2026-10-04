# Page de connexion modernisée — conception

Date : 2026-10-04 · Écran : `app/login.js` · Validé en séance (maquettes `.superpowers/brainstorm/22441-1791131032/`).

## Pourquoi

Quatre gênes remontées par l'utilisateur : le look vieillot, trop d'étapes (restaurant → code restaurant →
« Qui êtes-vous ? » → code perso), Face ID mal intégré (grosses barres orange), mode sombre peu lisible.

## Look

- **Clair = style C** : bandeau orange dégradé (`#F5A623 → #E07B14`) arrondi en bas, fond crème `#FAF8F5`,
  cartes blanches avec ombre douce qui chevauchent le bandeau.
- **Sombre = style B** : fond noir chaud (dégradé radial `#2A2116 → #0E0E12`), logo/accents orange `#F5B13D`,
  cartes « verre fumé » (`rgba(255,255,255,.06)` + liseré `rgba(255,255,255,.09)`).
- Le mode suit `useTheme().isDark` (même réglage que le reste de l'app).
- Cibles tactiles ≥ 48 px. Couleur des restaurants inchangée (`couleur === 'vert'` → `#1FAD6B`, sinon `#F0A020`).

## Parcours

### Écran d'accueil
1. Bandeau (logo + « Bonjour 👋 »).
2. **« Vos comptes sur ce téléphone »** : une ligne par enrôlement Face ID (avatar, nom, lieu, 🔐).
   Un appui = Face ID (`navigator.credentials.get` lancé directement par l'appui). Retrait par un lien
   discret sous la liste (« Gérer Face ID » → retirer un compte, confirmation `Alert` 2 boutons).
3. **Restaurants** en grille 2 colonnes ; les restaurants reconnus d'abord, marqués « ✓ reconnu ».
4. « Accès Manager / RH ».

### Téléphone reconnu
- Après un code restaurant juste, le restaurant est mémorisé sur l'appareil :
  `{ restaurantId, signature }` avec `signature = empreinte FNV-1a de « restaurantId|pin »` calculée dans la
  logique pure (identique web et natif, pas besoin de `crypto.subtle`). Le PIN restaurant est déjà présent en
  clair dans le cache hors ligne : cette empreinte n'abaisse pas le niveau de sécurité.
- Toucher un restaurant reconnu dont la signature correspond au code actuel → directement « Qui êtes-vous ? ».
  Signature différente (code changé) → le restaurant est oublié et le code redemandé.
- Stockage : `AsyncStorage` (web **et** appli installée — pas de module natif, donc OTA possible).
  Clé `samerpoint_restos_reconnus`.
- Verrouillage d'inactivité : si le restaurant de la session est reconnu, on arrive directement sur le code
  personnel ; sinon (session ouverte avant cette version) le code restaurant est demandé comme aujourd'hui.

### Ouverture directe
Au chargement, si **exactement un** restaurant reconnu valide ET aucun enrôlement Face ID hors de ce
restaurant (ex. compte Administration) → ouverture directe sur son « Qui êtes-vous ? », avec un lien
« Changer de restaurant ». Sinon → écran d'accueil. (Pas d'ouverture directe pendant un verrouillage :
le flux de verrouillage existant garde la main.)

### « Qui êtes-vous ? »
- En-tête : puce du restaurant (« ✓ téléphone reconnu »).
- Grille d'avatars 3 colonnes : initiales, prénom, rôle. Couleur : gérant orange, rôles globaux violet
  `#5B52C8`, autres gris. Badge 🔐 si l'utilisateur a un enrôlement pour ce lieu.
- Appui sur un avatar 🔐 → Face ID immédiat ; annulation/échec → écran du code.
- Encart POS (« La caissière se connecte sur la caisse ») conservé tel quel.
- Mode global (Accès Manager / RH) : même grille, en-tête « Accès global ».

### Code personnel (et code restaurant)
- Avatar + nom + lieu en haut (pour le code restaurant : nom + localisation du restaurant).
- 4 points, clavier 3×4. Touche bas-gauche = 🔐 quand un enrôlement existe pour ce compte et ce lieu,
  sinon vide. Lien « Ce n'est pas moi » / « Changer de restaurant ».
- Erreurs et blocage 30 s inchangés.

### Proposition Face ID
Contenu et règles inchangés (activer / plus tard / ne plus demander + avertissement), restylé.

## Inchangé

Vérification des codes, blocage 3 essais → 30 s, règles Face ID (`lib/biometrie.js`), comptes POS masqués
(`separerComptesPOS`), `ouvrirSession` et les redirections par rôle, déverrouillage de session.

## Organisation du code

- `lib/restosReconnus.js` — logique pure testée : `estReconnu(liste, restaurant, signature)`,
  `signatureResto`, `ajouterReconnu`, `oublierReconnu`, `ecranDeDepart({ reconnusValides, enrolements, verrouille })`.
- `lib/restosReconnusStockage.js` — lecture / écriture AsyncStorage.
- `components/login/` :
  - `themeLogin.js` — palettes C / B selon `isDark` ;
  - `EnteteLogin.js` — bandeau ;
  - `AccueilLogin.js` — comptes Face ID + grille restaurants + accès global ;
  - `QuiEtesVous.js` — grille d'avatars + encart POS ;
  - `ClavierCode.js` — avatar, points, clavier (touche 🔐) ;
  - `ActivationFaceID.js` — proposition d'activation.
- `app/login.js` garde l'état et l'enchaînement des étapes uniquement.

## Vérifications

- Tests `lib/restosReconnus.test.mjs` + tous les `lib/*.test.mjs` verts.
- `npm run lint` : 0 erreur. `npx expo export -p web` sans erreur.
- Essai manuel par l'utilisateur sur `localhost:8081` (clair + sombre, Face ID, téléphone reconnu).
