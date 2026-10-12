# Remettre un fond de caisse négatif à 0 — design

Date : 12/10/2026 — validé avec l'utilisateur.

## Besoin

Plusieurs restaurants ont un fond laissé négatif (Palmeraie −3 M, KMS, Yop, 7E —
voir mémoire « fonds négatifs »). Le manager veut un bouton qui remonte ce fond
(jusqu'à 0, ou d'une partie seulement) en transférant le trou vers :

- **Dette administration** — l'administration doit cette somme au restaurant ;
- **Report caisse** — un fournisseur nommé « Report caisse », un par restaurant,
  dont le crédit monte du montant transféré.

## Rappel : d'où vient le fond

Fond laissé = `reste_fc + ajustement_fond` du **dernier point validé** du
restaurant (`app/ventes.js` fcVeille, `lib/alertes.js`). `reste_fc` est 100 %
dérivé des ventes ; toute correction passe par `ajustement_fond` (mémoire
« écart → fond ajustement_fond »).

## Ce que fait un transfert de X F

Conditions : fond laissé < 0, 0 < X ≤ |fond laissé|, compte manager.

En **une seule fonction SQL** `transferer_fond_negatif` (tout ou rien) :

1. **Fond** : `ajustement_fond += X` sur le dernier point validé du restaurant.
2. **Destination**
   - `dette_admin` : insertion dans `tresorerie_dus` — `categorie = 'dette'`,
     `restaurant_id`, `creancier = 'Fond de caisse – <nom resto>'`,
     `libelle = 'Fond négatif repris par l''administration'`, `montant = X`.
     Elle apparaît dans Trésorerie → À payer → Dettes ; la payer = rembourser le
     restaurant (le gérant saisit ensuite l'argent en « FC reçu »).
   - `report_caisse` : fournisseur « Report caisse » du restaurant (créé au
     premier transfert s'il n'existe pas), puis
     `inserer_transaction_hors_point(fournisseur, date du jour, facture = X, paye = 0,
     …, source 'report_caisse', caissier_nom 'Report caisse')` → crédit +X.
3. **Trace** : ligne dans la nouvelle table `transferts_fond`.

Puis, côté app, `journaliser('fond_transfert', …)` (jamais bloquant).

## Annulation

`annuler_transfert_fond(id)` (une seule fonction SQL) :

- `ajustement_fond -= X` sur le point enregistré (`fond_point_id`) ;
- `dette_admin` : supprime la ligne `tresorerie_dus` — **refusé** si elle a déjà
  des paiements (message : « Cette dette est déjà en partie remboursée ») ;
- `report_caisse` : écriture inverse hors journée (paye = X) sur le fournisseur,
  pas de suppression (l'historique fournisseur garde les deux lignes) ;
- marque le transfert `annule_le = now()` (on ne supprime pas la trace).

## Table `transferts_fond`

| colonne | type |
|---|---|
| id | uuid PK |
| restaurant_id | uuid NOT NULL → restaurants |
| date | date NOT NULL default current_date |
| montant | bigint NOT NULL CHECK > 0 |
| destination | text CHECK IN ('dette_admin','report_caisse') |
| fond_avant | numeric NOT NULL (fond laissé avant transfert) |
| fond_point_id | uuid NOT NULL → points |
| du_id | uuid → tresorerie_dus ON DELETE SET NULL |
| fournisseur_id | uuid → fournisseurs |
| transaction_id | uuid → transactions_fournisseurs ON DELETE SET NULL |
| note | text |
| cree_par, cree_par_nom | text |
| annule_le | timestamptz |
| created_at | timestamptz default now() |

RLS `allow_all` comme les autres tables (posture actuelle du projet).

## Écran

Composant unique `components/TransfertFondModal.js`, ouvert depuis :

1. la carte d'alerte « Fond bas » de l'accueil (quand le fond est négatif) ;
2. le récap du fond dans Vérification (à côté de « Fond reporté ») ;
3. la Trésorerie : une ligne par restaurant au fond négatif.

Bouton « Remettre le fond à 0 » visible seulement si fond < 0 et manager.

Contenu : fond actuel (rouge) · choix Dette administration / Report caisse ·
montant avec raccourci « Tout (xxx F) » ou saisie partielle · motif facultatif ·
aperçu « Fond après : … » · Confirmer. En dessous : « Transferts du fond » du
restaurant (date, montant, destination, auteur) avec « Annuler » (2 boutons
maximum dans les Alert web).

## Logique pure (testée)

`lib/transfertFond.js` + `lib/transfertFond.test.mjs` :

- `fondLaisse(point)` (réutilise la règle `reste_fc + ajustement_fond`) ;
- `montantMaxTransfert(fond)` → `max(0, -fond)` ;
- `validerTransfert({ fond, montant, destination })` → message d'erreur FR ou null ;
- `fondApres(fond, montant)`.

La fonction SQL revérifie montant > 0 et montant ≤ −fond (pas de règle seulement
côté écran).

## Migration

`supabase_fond_transferts.sql` (garde « mauvais projet » en tête) : table,
`transferer_fond_negatif`, `annuler_transfert_fond`. Passée par l'utilisateur
dans le SQL Editor ; sans elle, le bouton affiche « Migration à passer ».

## Hors périmètre

Pas de recalage automatique ; pas de transfert d'un fond positif ; pas de
publication (commit/push seulement, publication en fin de lot).
