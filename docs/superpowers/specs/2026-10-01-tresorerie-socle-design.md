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
− Charges admin restantes           (impôts, autre)
− Carnet de dettes                  (ce qu'on doit à Zabad, Ibrahim, Alade…)
= Trésorerie nette réelle
```

Pour information seulement, **non soustraits** (payés par les restaurants,
décision du 01/10/2026) : fournisseurs dus (Σ `credit_actuel` > 0 des
fournisseurs actifs) et charges admin ODP / mairie restantes.

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

---

# Étape 2 — Partenaires à recevoir

Migration : `supabase_tresorerie_partenaires.sql` (après celle de l'étape 1).

- **Réglage par partenaire** : date de départ du suivi (vide = pas suivi ; les
  périodes d'avant sont considérées comme payées) et mode de versement.
  Seul **Glovo** verse un virement détaillé par restaurant ; Yango, Wave, OM
  et Djamo versent en une fois (corrigé le 01/10/2026, réglable dans l'app). Chaque partenaire a ses
  propres réceptions.
- **Périodes** : Yango ven→jeu · Glovo 1–7, 8–14, 15–21, 22–28, 29→fin ·
  Wave et Djamo lun→dim · OM le mois. Suivies = celles qui commencent le jour de
  départ ou après.
- **Estimé** par restaurant = points de la période × coefficient
  (`yango_tab` × 0,77, `glovo_tab` × 0,705, Wave / OM / Djamo × 0,99).
- **Export brut** (Yango, Glovo) lu dans l'app, mêmes règles que les skills
  `rapport-commandes-yango` et `rapport-commandes-glovo-2`. Zone 4 et Remblais
  = KMS, AK1 = ALK1. Les codes sont associés une fois aux restaurants de l'app
  (`tresorerie_alias`). Le réel REMPLACE l'estimé ; un restaurant absent de
  l'export vaut 0. Réimporter une période remplace l'import précédent.
- **Pub** (Yango, Glovo, après import) : par restaurant, déduite du réel. Pour
  Glovo, en plus des frais d'annonces de l'export.
- **À recevoir** = périodes terminées seulement. La période en cours est
  affichée en pointillés, sans compter.
- **Reçu** : montant réel, compte BACI / SIB, date → entrée en banque (type
  `partenaire`) ; écart avec l'attendu affiché. Annulable.
- Droits : propriétaire et lecture voient et marquent reçu / importent / saisissent
  la pub ; seul le propriétaire règle les dates de départ et les modes.

Tests : `lib/partenaires.test.mjs`, `lib/partenairesImport.test.mjs`.

---

# Étape 3 — Coffre, dépenses direction, résultat net

Migration : `supabase_tresorerie_direction.sql` (après celles des étapes 1 et 2).

- **Coffre** (M. Zreik seul) : argent réel mis à part, hors trésorerie nette.
  Dépôt depuis BACI / SIB (sortie de banque automatique) ou espèces ; retrait
  vers BACI / SIB (entrée en banque) ou espèces. Objectif fixé par mois ; un
  mois sans objectif reprend le dernier fixé. Progression = solde ÷ objectif.
- **Dépenses direction** (M. Zreik seul) : fond, réparation, matériel,
  équipement, investissement, retrait perso ; restaurant ou Groupe ; payées
  depuis BACI, SIB, espèces ou le coffre (la sortie suit). Comptent dans le
  résultat : réparation, matériel, équipement d'un restaurant. Le fond est un
  simple transfert et ne compte pas.
- **Résultat net par restaurant / mois** (M. Zreik et managers) = encaissé net
  des points validés (formule BSC de l'écran Charges, **sans les litiges**)
  − charges du mois (table `charges`) − dépenses direction comptées − pubs
  (mois de début de la période). 4 derniers mois ; le mois en cours est
  provisoire.

Tests : `lib/direction.test.mjs`.

---

# Étape 4 — Alertes automatiques

Migration : `supabase_tresorerie_alertes.sql` (après les étapes 1 à 3).

- **Restaurant déficitaire** : résultat net (étape 3) négatif sur le dernier
  mois terminé.
- **CNPS** : reste à payer et plus de 60 jours après l'échéance.
- **Fond bas** : « FC de la veille » du dernier point d'un restaurant sous son
  plafond (réglé par M. Zreik, vide ou 0 = pas d'alerte) → somme à rajouter.
- **Quand** : vérifié après chaque validation de point (`validerPoint`), en
  arrière-plan, sans jamais bloquer la validation.
- **Qui** : notification (in-app + push) aux propriétaires désignés ; à défaut,
  aux managers. Une seule fois par alerte (clé réservée dans
  `tresorerie_alertes_envoyees`).
- **Bandeau** en haut de la vue d'ensemble : toutes les alertes en cours
  (3 affichées, « voir tout » au-delà).

Tests : `lib/alertes.test.mjs`.
