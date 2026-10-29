# Mise à jour des fiches par les gérants et contrat pour tous — conception

Date : 29/10/2026 · Validée avec l'utilisateur le 29/10/2026.
Étend le circuit Recrutement existant (`docs/superpowers/specs/2026-10-14-recrutement-contrats-signes-design.md`,
`app/recrutement.js`, `app/embauches.js`, `components/contrats/FormulaireDemande.js`,
`components/contrats/FormulaireGeneration.js`, table `demandes_travailleurs`). Aucune seconde table de demandes.

## 1. Objectif

Le 29/10/2026, sur 145 travailleurs non archivés, **8 fiches sont complètes** (137 sans nom/prénoms séparés,
sans date de naissance, sans CNI ni NNI) et **1 seul contrat est en cours**. La carte du travailleur (recto-verso,
QR de vérification) et les contrats ont besoin de ces informations.

1. Chaque gérant **met à jour** les fiches de **son** équipe depuis l'application.
2. La RH ou un manager **valide** chaque mise à jour (avant → après) ou la refuse avec motif.
3. Une fois validée, la RH **génère le contrat** (circuit existant : signature au doigt, « Signé »).
4. La direction **suit** l'avancement par restaurant et **relance** les gérants.

## 2. Décisions de l'utilisateur (29/10/2026)

| Sujet | Décision |
|---|---|
| Validation | Toute mise à jour passe par « Accepter » (RH / manager). Rien ne change sur la fiche avant. |
| Complétude | Le gérant **peut envoyer une mise à jour incomplète** ; la liste des manques est affichée. |
| Contrat des journaliers | **Stage** (89 journaliers le 29/10). CDI → CDI, autres → CDD. La RH peut changer. |
| Début du contrat | **Date d'embauche réelle**, pour tous les types. La date d'embauche est donc mise en avant dans la mise à jour. |
| Relances | Badge à l'accueil du gérant, notification de lancement, suivi par restaurant, date limite. |
| Date limite | **Jeudi 12 novembre 2026** (constante dans le code). |
| Approche | Réutiliser `demandes_travailleurs` avec un type « mise_a_jour » (et non une table ou des écrans à part). |

## 3. Rôles

| Rôle | Peut |
|---|---|
| Gérant | Voir la liste de **son** équipe et l'état de chaque fiche. Envoyer, corriger et renvoyer une mise à jour. |
| RH, manager | Accepter (fiche mise à jour) ou refuser avec motif. Générer le contrat. Voir le suivi par restaurant. Relancer un gérant ou tous. |

## 4. Données

### 4.1 Migration `supabase_mise_a_jour_fiches.sql` (à passer à la main, relançable)

- `demandes_travailleurs.type text not null default 'embauche'` avec `check (type in ('embauche','mise_a_jour'))`.
  Les demandes existantes restent des embauches.
- Index unique partiel : **une seule mise à jour en attente par travailleur**
  (`unique (travailleur_id) where type = 'mise_a_jour' and statut in ('envoyee','refusee')`).
- Pour une mise à jour, `travailleur_id` (colonne existante) désigne le travailleur concerné et `restaurant_id`
  son restaurant au moment de l'envoi.

### 4.2 Fusion à l'acceptation (`fusionFiche`)

- Champs fusionnés : photo, civilité, nom de famille, prénoms, date et lieu de naissance, nationalité, situation
  de famille, lieu de résidence, CNI, NNI, téléphone, date d'embauche.
- **Un champ envoyé vide ne remplace jamais une valeur connue.** Un champ envoyé rempli remplace l'ancienne valeur.
- Photos de pièce d'identité et papiers envoyés : ajoutés aux documents du travailleur (`documents_travailleurs`)
  et à `piece_identite_urls`, sans doublon.
- Le nom affiché (`travailleurs.nom`) n'est pas modifié (il sert de lien avec le POS et les paies).

## 5. Gérant — écran Recrutement (tuile « Nouveau travailleur »)

- Nouvel onglet **« 📋 Mettre à jour mon équipe (N) »**, à côté de « Mes demandes » et « Contrats à faire signer ».
  N = fiches ni à jour ni en attente RH.
- **Bandeau** : « Complétez les fiches de votre équipe avant le jeudi 12 novembre : X / Y à jour ». Rouge une fois
  la date dépassée.
- **Liste** des travailleurs non archivés de son restaurant, les plus incomplets d'abord. Chaque ligne : photo, nom,
  poste, état :
  - « ⚠️ N infos manquantes » ;
  - « 🟡 Envoyée à la RH » ;
  - « ❌ Refusée : motif » (toucher → corriger et renvoyer) ;
  - « ✅ À jour ».
- Toucher une ligne ouvre **FormulaireDemande** en mode « mise à jour », **pré-rempli** avec la fiche (et, si une
  demande refusée existe, avec la demande). Nom de famille et prénoms modifiables ; le poste, le salaire et le
  restaurant ne font pas partie de la mise à jour (déjà gérés ailleurs). La date d'embauche est en tête, avec
  « C'est la date de début du contrat ».
- Envoi : photo, nom de famille et prénoms obligatoires (comme les embauches) ; **le poste n'est pas exigé** en
  mode mise à jour (il est déjà sur la fiche) ; le reste peut manquer ; la liste des manques est rappelée avant
  l'envoi.
- Notification à la RH : « 📋 Fiche à valider : NOM — Restaurant ».

## 6. Accueil du gérant

Badge sur sa tuile Recrutement : **« N fiches à compléter »** (même N qu'à l'onglet). Disparaît à 0.

## 7. RH / manager — écran « Nouveaux travailleurs » (`app/embauches.js`)

- « 🟡 À valider », « ❌ Refusées », « ✅ Acceptées » montrent embauches **et** mises à jour ; une mise à jour porte
  l'étiquette **« Mise à jour »**.
- Carte d'une mise à jour : **seulement ce qui change** (« Date de naissance : vide → 12 mars 1995 »), nouvelles
  photos de pièce, et les infos encore manquantes.
- **Accepter** : fusion (§ 4.2), demande `acceptee` (garde `.eq('statut','envoyee')` : une double validation
  affiche « Déjà traitée »), puis bouton **« Générer le contrat »** qui ouvre FormulaireGeneration avec le type
  proposé (§ 9).
- **Refuser** : motif obligatoire, comme aujourd'hui.
- Badge d'accueil existant « X à valider » : compte aussi les mises à jour.

## 8. Suivi par restaurant (onglet « 📊 Suivi », RH / manager)

- Une ligne par restaurant : « fiches à jour X/Y · en attente RH Z · contrats signés W/Y », barre de progression.
- Bouton **« Relancer le gérant »** : notification aux gérants de ce restaurant
  (« Il vous reste N fiches à compléter avant le 12 novembre »).
- En haut : total du groupe et bouton **« Prévenir tous les gérants »** (notification de lancement, envoyée par la
  direction au moment voulu, après publication Vercel **et** EAS).

## 9. Règles communes (logique pure, `lib/miseAJourFiches.js`)

- `manquantsFiche(trav)` : libellés manquants parmi photo, civilité, nom de famille, prénoms, date de naissance,
  lieu de naissance, nationalité, CNI ou NNI, lieu de résidence, téléphone, date d'embauche (= ce que le contrat
  exige + photo + date d'embauche). **Fiche à jour** ⇔ liste vide.
- `diffFiche(trav, demande)` : lignes { libellé, avant, après } des champs qui changent.
- `fusionFiche(trav, demande)` : § 4.2.
- `typeContratPropose(trav)` : Journalier → Stage ; CDI → CDI ; sinon CDD.
- `contratDejaTermine(debut, fin, aujourdhui)` : avertissement dans FormulaireGeneration
  (« Avec cette durée, le contrat serait déjà terminé le … »).
- `etatFiche(trav, demandeEnCours)` : 'a_jour' | 'envoyee' | 'refusee' | 'incomplete'.
- `resumeCampagne(travailleurs, demandes, contrats, restaurants, aujourdhui)` : chiffres du suivi.
- `DATE_LIMITE = '2026-11-12'`.

Changement de l'existant : **FormulaireGeneration** prend la date de début = date d'embauche pour **tous** les
types quand le travailleur est déjà en poste (aujourd'hui seulement pour le Stage), toujours modifiable pour
CDD/CDI.

## 10. Erreurs

- Messages en français ; migration absente → « Mise à jour des fiches pas encore activée (migration
  supabase_mise_a_jour_fiches.sql à passer) ».
- Envoi alors qu'une mise à jour est déjà en attente → la demande en attente est **remplacée** (mise à jour de la
  même ligne), pas d'erreur.
- Échec réseau : rien n'est perdu côté formulaire (l'utilisateur peut renvoyer).

## 11. Tests (node:test, `lib/miseAJourFiches.test.mjs`)

Fiche à jour / manques, CNI **ou** NNI suffit, diff avant → après, fusion qui n'efface rien, photos sans doublon,
type proposé (Journalier/CDI/CDD/vide), contrat déjà terminé, état d'une fiche selon la demande, chiffres du suivi
(dont travailleurs archivés exclus), date limite dépassée.

## 12. Hors périmètre

- Rappels automatiques programmés (aucune tâche planifiée dans Samtrackly) : les relances sont manuelles (§ 8).
- Contrats d'À la Braise (pas de modèle) : ses gérants mettent quand même leurs fiches à jour.
- Modification du poste, du salaire ou du restaurant par le gérant.
