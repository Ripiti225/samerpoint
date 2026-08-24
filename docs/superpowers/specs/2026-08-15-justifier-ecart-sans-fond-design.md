# Justifier un écart de vente machine sans toucher au fond

**Date :** 2026-08-15
**Écran :** `app/verification.js` — onglet 📋 Vérification Point, section « Vente machine »
**Migration SQL :** aucune

## Problème

Sur un écart de vente machine, le manager dispose aujourd'hui de trois décisions
(`app/verification.js:1809-1835`) :

| Bouton | Effet |
|---|---|
| ✅ Valider | pose `explication_machine_statut = 'validee'`, notifie le gérant. L'écart **reste ouvert** dans Litiges. |
| ❌ Refuser | pose `'refusee'`, notifie le gérant. L'écart reste ouvert. |
| 🚫 Annuler | écrit une régularisation **et** déplace `ajustement_fond` sur le dernier point validé (`confirmerAnnulationMachine`, ligne 937). |

Le seul moyen de solder un écart est donc « Annuler », qui corrige le fond. Or beaucoup
d'écarts sont des erreurs de saisie (mauvaise vente machine tapée, shift absent du cumul) :
aucun argent n'a bougé. Corriger le fond dans ce cas fabrique un faux fond qui se reporte
ensuite de journée en journée.

« Valider », lui, ne solde rien : il exprime un avis sur l'explication, et l'écart reste
dans les litiges. En pratique il ne sert pas.

## Solution

Remplacer **✅ Valider** par **✔️ Justifier** : solder tout ou partie de l'écart, sans
aucune écriture sur le fond. La rangée reste à trois boutons.

## Périmètre

### 1. Le bouton (`app/verification.js`)

- `✅ Valider` (ligne 1810-1817) est retiré ; `✔️ Justifier` prend sa place, en tête de
  rangée, et ouvre le modal en mode `sans_fond`.
- La note sous les boutons (ligne 1835) devient :
  « Le gérant est notifié. « Justifier » ne touche pas au fond, « Annuler » le corrige. »
- `STATUT_MACHINE.validee` (ligne 29) **est conservé** : plus aucun bouton ne le produit,
  mais les points déjà marqués « ✅ Explication validée » doivent continuer d'afficher leur
  badge (ligne 1799). Statut d'historique, en lecture seule.
- `statuerExplicationMachine` reste en place pour `'refusee'`.

### 2. Le modal — réutilisé, avec un mode

`modalAnnulerMachine` gagne un champ `mode: 'fond' | 'sans_fond'`. `ouvrirAnnulerMachine`
prend le mode en paramètre ; tout son calcul (sens manquant/surplus, restant déduction faite
des régularisations déjà posées depuis Litiges, lignes 912-933) est inchangé et partagé.

Différences en mode `sans_fond` :

| Élément | mode `fond` (actuel) | mode `sans_fond` |
|---|---|---|
| Titre | 🚫 Annuler l'écart | ✔️ Justifier l'écart |
| Ligne d'effet | « Le fond actuel sera AUGMENTÉ / DIMINUÉ… » | « → Le fond actuel n'est pas modifié. » |
| Bouton Confirmer | rouge/annulation | vert/validation |

Saisie du montant, plafond `restant` et reprise de l'explication du gérant : identiques.
**La justification partielle est donc possible**, comme pour Annuler.

Raison du partage : dupliquer le modal ferait diverger les deux chemins au premier correctif
sur le calcul du restant.

### 3. L'écriture en base — aucune migration

Le record ajouté à `ecart_regularisations` (JSONB sur `points`) a la même forme qu'aujourd'hui,
plus deux marqueurs :

```js
{
  sens, montant,
  motif: explication du gérant || 'Écart justifié sans incidence sur le fond',
  photos, par_id, par_nom, created_at,
  sans_fond: true,       // marqueur lu par Litiges
  fond_point_id: null,   // aucune journée n'a reçu de correction
  source: 'verification',
}
```

Contraintes d'implémentation :

- **Aucune lecture du dernier point validé, aucun update de `ajustement_fond`.** Un seul
  UPDATE, sur le point de l'écart.
- Nouveau statut `justifiee`, posé **uniquement quand le solde retombe à 0**, comme `annulee`
  aujourd'hui (lignes 976-981). La colonne `explication_machine_statut` est du texte libre
  sans contrainte CHECK (`supabase_explication_machine_statut.sql:12`) → pas de migration.
- 4ᵉ entrée dans `STATUT_MACHINE` : label « ✔️ Écart justifié », palette verte.

### 4. Reverse dans Litiges — obligatoire

`supprimerRegularisation` (`app/litiges.js:443-477`) reverse ainsi :

```js
if (r.fond_point_id) { /* rend le fond à la journée cible */ }
else { reste_fc += deltaFc }   // « format hérité »
```

Un record `sans_fond` a `fond_point_id: null` : sans garde, il tombe dans la branche héritée
et **modifie `reste_fc`** — le faux fond qu'on cherche à éviter, en pire, puisque `reste_fc`
doit rester intégralement dérivé des ventes.

→ Ajouter en tête : `if (r.sans_fond) { /* aucune écriture de fond */ }`, avant les deux
branches existantes. Le texte de confirmation ne doit plus promettre un recalcul du fond dans
ce cas.

### 5. Visibilité dans Litiges

- Carte de régularisation (`app/litiges.js:1486`) : titre « 📉 Manquant justifié » conservé,
  plus un badge gris **« sans incidence sur le fond »** quand `r.sans_fond`. Motif, auteur,
  date et photos y sont déjà affichés.
- `app/litiges.js:303` et `app/litiges.js:660` : `=== 'annulee'` devient
  `['annulee', 'justifiee'].includes(...)`. Non indispensable — le cumul des régularisations
  solde déjà l'écart — mais évite un écart fantôme si un montant est saisi de travers.
- Conséquence de ce qui précède, ajoutée à l'implémentation : le drapeau `annule` sert aussi
  aux libellés de la carte d'écart (lignes 1567-1576) et de la vue globale (ligne 1611). Un
  écart justifié y serait annoncé « 🚫 Écart annulé ». Un second drapeau `justifie` est donc
  exposé à côté d'`annule`, et ces libellés deviennent « ✔️ Écart justifié » /
  « ✔️ Justifié dans Vérification — fond non modifié ».
- La ligne « Fond ajusté » du récap (`app/verification.js:1447`) ne bouge pas : c'est le
  résultat attendu.

### 6. Notification gérant

Type `explication_machine_justifiee` :
« L'écart de vente machine du {date} a été justifié par le manager : {montant} neutralisé,
sans correction du fond. »

Journal : `journaliser('justification_ecart_machine', { point_id, sens, montant })`.

## Hors périmètre

- L'écran Litiges garde son unique régularisation, qui corrige le fond. Pas de bouton
  « justifier sans fond » là-bas.
- Aucun changement sur les écarts d'inventaire ni sur les déductions.

## Vérification

Aucun test automatisé dans ce projet. Vérification manuelle sur un point présentant un écart :

1. Justifier partiellement (ex. 3 000 sur 10 000) → écart restant 7 000 dans Litiges,
   `ajustement_fond` inchangé sur toutes les journées du resto, statut non posé.
2. Justifier le solde → statut « ✔️ Écart justifié », écart à 0 dans Litiges,
   `ajustement_fond` toujours inchangé.
3. Supprimer la régularisation depuis Litiges → écart réintégré, `ajustement_fond` **et**
   `reste_fc` inchangés.
4. Un point ancien au statut `validee` affiche toujours son badge.
5. « Annuler » conserve son comportement : fond corrigé, reverse fond correct.
