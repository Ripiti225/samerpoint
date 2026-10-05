# Refonte visuelle — Déductions gérant & Saisie des ventes

Date : 05/10/2026 · Statut : conception validée

## But

Moderniser les deux écrans du gérant `app/deductions-gerant.js` et `app/ventes.js`
avec un style neuf, plus poussé que le kit `EcranModerne`, sans toucher aux
règles métier ni à ce qui est écrit en base.

## Choix validés

| Sujet | Choix |
|---|---|
| Style mode clair | **A · Dégradé chaleureux** : en-tête dégradé `#F7B23B → #E07B00 → #C2410C`, fond `#F6F3EE`, cartes blanches à ombre douce, boutons en dégradé orange |
| Style mode sombre | **B · Sombre premium** : fond `#0D0D14`, cartes `#1C1C2A → #15151F` bord `#2A2A3A`, gros chiffres en dégradé `#FFB84D → #FF6B3D`, halo orange sur l'élément actif |
| Déductions gérant | 3 onglets **Fournisseurs · Dépenses · Paies** + barre du bas fixe |
| Saisie des ventes | 3 étapes : **Livraisons TAB → Fond & bénéfice → Vente machine & écart** |
| Améliorations | total/bouton toujours visibles ; « Il manque : … » avant d'appuyer ; barre payé / dû par fournisseur |
| Exclu | séparateurs de milliers pendant la saisie (non retenu) |

Maquettes : `.superpowers/brainstorm/69933-1791237180/content/` (`style-visuel.html`, `ventes-etapes-2-3.html`).

## Invariants (ne changent pas)

- Calculs : `totalDepensesGerantCaisse`, `resteEspeces`, `fc`, `beneficeSC`, crédit veille fournisseur, écart théorique − machine.
- Contrôles : photo de facture obligatoire si montant facture > 0 (bloquant) ;
  doublon de facture caissier et facture déjà enregistrée (confirmations) ;
  explication d'écart ≥ 10 caractères, au moins un responsable, montants > 0, répartition = écart (bloquants, hors manager) ;
  photos Yango TAB / Glovo TAB / vente machine (alerte « Continuer quand même », hors manager).
- Règles POS : vente machine verrouillée 🔒 si le site vient du POS, secours manuel, clôtures POS / rapport Z, pas de photo ni d'explication quand la vente machine vient du système.
- Écritures base : `sauvegarder()` (déductions) et `sauvegarderPhotosPoints()` / `syncLitigesResponsables()` (ventes) déplacées sans modification.
- Droits : `bloque && !isManager` → lecture seule, inchangé ; bandeau « Point validé — lecture seule ».
- Brouillon gérant (`points.draft_gerant`) chargé et sauvegardé comme aujourd'hui.

## Architecture

### Kit de style — `components/ui/StyleChaleureux.js`

- `useStyleChaleureux()` → `{ styles, palette, isDark }` ; palette A si clair, B si sombre (via `useTheme().isDark`).
- `Degrade` : fond en dégradé via `react-native-svg` (`LinearGradient` + `Rect`), utilisable en arrière-plan absolu. **Aucune nouvelle dépendance native** → publiable en OTA.
- Composants : `EnTeteChaleureux` (retour, titre, sous-titre, ligne restaurant · date, enfant optionnel : onglets ou barre d'étapes), `Onglets` (libellé + « n · montant »), `BarreEtapes` (3 segments + libellés), `Carte`, `Etiquette` (auto / shifts / Trésorerie / POS), `BarreProgression` (payé / dû), `BarreBasFixe` (total optionnel, liste « Il manque », bouton principal), `BoutonDegrade`.
- En mode A, les onglets flottent sur le bas de l'en-tête ; en mode B, le total du jour s'affiche en grand chiffre dégradé dans l'en-tête.

### Déductions gérant

- `app/deductions-gerant.js` : garde l'état, le chargement, `sauvegarder()`, la gestion photo, le modal travailleur ; rend `EnTeteChaleureux` + `Onglets` + l'onglet actif + `BarreBasFixe`.
- `components/deductions/OngletFournisseurs.js` : carte par fournisseur (nom, étiquette « dû X » ou « avance X », payé du jour, `BarreProgression`, reste dû, état photo) ; toucher ouvre le détail (n° facture, montant facture, payé, bloc photo) dans la carte.
- `components/deductions/OngletDepenses.js` : 4 sous-sections (`CATEGORIES_DEPENSES`) avec lignes description / montant / supprimer et « + Ajouter ».
- `components/deductions/OngletPaies.js` : lignes travailleur / montant / supprimer et « + Ajouter une paie ».
- Bouton Sauvegarder : états actuels conservés (en cours, ✅ Sauvegardé, ❌ Erreur — Réessayez).
- L'alerte « Photo manquante » est conservée ; en plus, elle bascule sur l'onglet Fournisseurs et ouvre les cartes concernées.

### Saisie des ventes

- `app/ventes.js` : garde l'état, les chargements (shifts, POS, restaurant, équipe), la validation `allerAuRecap`, les modals ; rend `EnTeteChaleureux` + `BarreEtapes` + l'étape active + `BarreBasFixe`.
- `components/ventes/EtapeTab.js` : bandeau « n shifts intégrés · vente X », cartes Yango TAB / Glovo TAB (montant, nb commandes, photo), récap shifts.
- `components/ventes/EtapeFondBenefice.js` : carte Fond de caisse (veille, reçu éditable ou Trésorerie, espèces, FC calculé), carte Bénéfice SC.
- `components/ventes/EtapeMachineEcart.js` : vente théorique, vente machine (saisie / 🔒 POS / secours), photo, clôtures POS, bandeau d'écart, explication, responsables, photos d'écart.
- Retour : étape n → n−1, étape 1 → écran précédent (inchangé). Les segments de la barre restent cliquables.
- Bas fixe : étapes 1–2 « Continuer › <étape suivante> » ; étape 3 « Voir le récapitulatif » (masqué si lecture seule, comme aujourd'hui).

### « Il manque » — `lib/manquantsSaisie.js` (fonctions pures, testées)

- `manquantsDeductions({ fournisseursGerantCaisse, nomsFournisseurs })` → `[{ texte, bloquant: true }]` pour chaque facture sans photo valide (réutilise `facturesGerantSansPhoto`).
- `manquantsVentes({ ventesJour, cumulShifts, venteMachineDuSysteme, venteMachineRecue, peutVoirMachine, isManager })` →
  - bloquants : explication < 10 caractères, aucun responsable, responsable à 0, répartition ≠ écart (mêmes conditions qu'`allerAuRecap`) ;
  - non bloquants : photos manquantes (mêmes conditions que `verifierPhotosObligatoires`).
  - Manager → liste vide (il passe outre, comme aujourd'hui).
- `allerAuRecap` et `verifierPhotosObligatoires` utilisent ces fonctions : l'affichage et le contrôle partagent la même source, ils ne peuvent pas diverger.
- Affichage : bloquants en rouge, non bloquants en orange ; le bouton reste cliquable (le contrôle existant explique et décide), il est seulement atténué s'il reste un élément bloquant.

### Barre payé / dû — `lib/manquantsSaisie.js`

- `progressionFournisseur({ creditVeille, facture, paye })` → `{ du, paye, reste, ratio (0–1), avance: bool }` avec `du = creditVeille + facture`, `reste = du − paye`. Cas `du ≤ 0` : ratio 1, affichage « Avance ».

### Résumé des onglets — `lib/manquantsSaisie.js`

- `resumeDeductions(depenses, fournisseurs, paies)` → nombre de lignes et montant de chaque onglet (affichés « n · montant » sous chaque onglet).
- La carte « Statut photos » de l'ancienne étape 2 des ventes disparaît : la barre « Il manque » du bas la remplace.

## Tests

- `lib/manquantsSaisie.test.mjs` (`node:test`) : facture avec/sans photo ; écart nul / manquant / surplus ; explication courte ; répartition incomplète ou complète ; site POS (rien demandé) ; manager (vide) ; photos TAB ; progression avec avance, dû nul, paiement supérieur au dû.
- Avant commit : `npm run lint` (0 erreur), `for f in lib/*.test.mjs; do node "$f"; done` (0 échec), `npx expo export -p web` compile.
- Pas de lancement de localhost par l'agent ; le contrôle visuel se fait par l'utilisateur après publication.

## Livraison

Commits successifs sur `main` (kit, déductions, ventes), push à chaque étape, **publication Vercel + EAS update seulement à la fin** du chantier.
