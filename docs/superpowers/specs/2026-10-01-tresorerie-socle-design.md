# Trésorerie — étape 1 : le socle

Maquette validée : https://claude.ai/artifact/PtUEnLmjbkKL9hCLbnAmgo (version 5).
Source : feuille « Trésorerie nette réelle » de M. Zreik (sections A à E), 30/09/2026.

## Découpage du chantier

| Étape | Contenu |
|---|---|
| **1 — Socle (ce document)** | Onglet Trésorerie, comptes BACI / SIB, tout ce qu'on doit, formule de trésorerie nette, droits par section |
| 2 — Partenaires | Estimé par période (tab × coeff, Wave/OM/Djamo × 0,99), import de l'export brut Yango/Glovo, pub par restaurant, « marquer reçu » |
| 3 — Coffre, dépenses direction, résultat net par restaurant / mois | |
| 4 — Alertes | Déficit (mois terminé), CNPS > 60 j, fond laissé sous le plafond ; bandeau + notification |

Mis de côté : « SODECI côté gérant ».

## Formule (étape 1)

```
  Banque (somme des soldes BACI + SIB)
+ Partenaires à recevoir            → 0 tant que l'étape 2 n'est pas livrée
− Loyers restants                   (loyers dus des mois ≤ mois courant, non soldés)
− Salaires restants
− CNPS restante
− Charges admin restantes           (ODP, mairie, impôts, autre)
− Fournisseurs dus                  (Σ fournisseurs.credit_actuel > 0, fournisseurs actifs)
− Carnet de dettes                  (ce qu'on doit à Zabad, Ibrahim, Alade…)
= Trésorerie nette réelle
```

« Restant » = montant dû − Σ paiements, jamais négatif.

## Données (`supabase_tresorerie.sql`, à passer dans le SQL Editor)

- `tresorerie_comptes` : BACI, SIB (seedés). Solde = Σ `tresorerie_mouvements.montant`.
- `tresorerie_mouvements` : un mouvement signé par compte. Types : `recalage`
  (solde de départ ou alignement sur relevé : montant = relevé − solde courant),
  `recu_banque` (entrée saisie à la main, photo facultative), `paiement` (sortie
  liée à un paiement), `autre`.
- `tresorerie_loyers` : un loyer fixe par restaurant (montant, jour d'échéance,
  mois de départ).
- `tresorerie_dus` : tout ce qu'on doit. `categorie` ∈ loyer, salaire, cnps,
  admin, dette. Restaurant + mois pour loyer / salaire / cnps ; libellé pour
  admin ; créancier pour dette. Unicité (categorie, restaurant, mois) pour
  loyer / salaire / cnps.
- `tresorerie_paiements` : paiements partiels d'un dû. Source BACI, SIB ou
  espèces. Un paiement depuis un compte crée le mouvement de sortie
  correspondant ; supprimer le paiement supprime ce mouvement.
- `tresorerie_droits` : niveau attribué à un utilisateur.

Montants en entiers FCFA.

## Loyers

- Les dus de loyer sont créés à l'ouverture de l'écran, pour chaque restaurant
  qui a un loyer configuré, du mois de départ au mois courant (insertion
  idempotente grâce à l'unicité).
- Payer un loyer : on choisit **toujours** à la main le ou les mois retenus par
  le propriétaire. Rien n'est présélectionné. Plusieurs mois = le montant est
  réparti entre eux, dans l'ordre chronologique, chaque mois jusqu'à son reste.
- Couleur : vert = soldé ; rouge = échéance passée et pas soldé ; orange = le reste.
  Rouge dès le lendemain de l'échéance.

## Salaires et CNPS

Par restaurant et par mois, saisis par M. Adou (niveau `saisie_rh`), payables en
plusieurs fois. Chaque ligne : « dû X · payé Y · **reste Z** ». Échéance CNPS
par défaut : le 15 du mois suivant (modifiable) ; l'écran affiche le nombre de
jours de retard.

## Droits par section (affichage seulement : la base reste ouverte à la clé anon)

| Niveau | Qui | Peut |
|---|---|---|
| `proprietaire` | M. Zreik | tout : voir, saisir, payer, gérer les droits |
| `lecture` | autres managers / directeur | voir vue d'ensemble, banque, loyers, salaires, CNPS, admin. Pas les dettes |
| `saisie_rh` | M. Adou, rôle RH | voir et saisir les dus salaires / CNPS, sans payer |

Résolution : une ligne dans `tresorerie_droits` l'emporte. Sinon, un manager ou
directeur est `lecture`, sauf **tant qu'aucun propriétaire n'est désigné** : il
est alors `proprietaire`, pour pouvoir se désigner lui-même. Un RH sans ligne est
`saisie_rh`. Les autres rôles n'ont pas accès.

## Écrans

- `/tresorerie` : vue d'ensemble (formule), raccourcis Banque / À payer / Droits.
- `/tresorerie-banque` : soldes, « Recaler sur relevé », « + Reçu banque », mouvements.
- `/tresorerie-a-payer` : onglets Loyers · Salaires · CNPS · Admin · Dettes ;
  ajout / modification / suppression d'un dû, paiement, réglage des loyers.

En ligne uniquement (comme la validation d'un point) : hors connexion, l'écran
le dit et ne propose pas de saisie.

## Journal

Chaque saisie, paiement, recalage et suppression part dans `journal_activite`
(actions `tresorerie_*`), sans bloquer l'action.

## Tests

`lib/tresorerie.test.mjs` : restant d'un dû, formule nette, statut loyer
(couleurs, lendemain d'échéance), mois à créer, répartition d'un paiement sur
plusieurs mois, montant de recalage, résolution des droits, jours de retard CNPS.
