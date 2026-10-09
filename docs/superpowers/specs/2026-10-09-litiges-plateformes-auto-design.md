# Litiges Yango / Glovo automatiques — conception

Date : 2026-10-09 · Statut : validée par Ange (QCM du 09/10)

## But

Remplir automatiquement, dans Litiges → Yango / Glovo, les litiges aujourd'hui
saisis à la main : **tapé −**, **tapé +**, **remboursement**, **temps d'attente**,
en comparant les ventes partenaires du POS aux historiques des portails Glovo et
Yango.

Le **tapé +** est le contrôle prioritaire : il repère la fraude « vente sur place
encaissée en espèces puis déclarée Yango/Glovo dans le POS » (la plateforme ne
paie pas le jour même, rien ne la détecte aujourd'hui).

## Découpage

- **Partie 1 (ce document)** — Samtrackly : récupération, correspondances,
  calcul, création des litiges.
- **Partie 2 (spec séparée, plus tard)** — POS (master Windows) : le caissier
  voit **ses propres** litiges, ses avis et sa note /20 à la connexion, plus une
  notification. Jamais ceux des autres.

## Définitions (au caractère près)

| Type | Définition | Montant | Responsable |
|---|---|---|---|
| Tapé − | Plat vendu sur la plateforme, absent du POS sur la journée | quantité manquante × prix POS du canal | caissier présent à l'heure de la commande plateforme |
| Tapé + | Plat tapé dans le POS en Yango/Glovo, absent de la plateforme sur la journée | quantité en trop × prix POS du canal | caissier qui a tapé la commande POS |
| Remboursement | Somme retenue par la plateforme sur le virement (client remboursé) | montant retenu par le portail | caissier présent à l'heure de la commande |
| Temps d'attente | Pénalité d'attente livreur retenue par le portail | montant de la pénalité | caissier présent à l'heure de la commande |

Les deux sens (tapé + et tapé −) sont des erreurs à la charge du responsable.

## Données déjà disponibles (vérifié le 09/10 sur `pos-samer-cloud`)

Les 7 restaurants remontent leurs commandes partenaires au cloud POS avec le
détail des plats : `commandes` (`partenaire` = `YANGO` / `GLOVO`, `statut`,
`ref_partenaire`, `caissier_id`, `created_at`) et `commande_items`
(`nom_snapshot`, `article_id`, `combo_id`, `prix_unitaire`, `quantite`).
`ref_partenaire` est rempli dans ~93 % des commandes payées ; il contient
normalement les **4 derniers chiffres** du n° long de la plateforme.
Lecture côté serveur comme `import-contacts-pos` (`restaurants.samtrackly_id`
fait le lien).

## 1. Récupération — même favori que les avis

Le favori unique « Avis → Samtrackly » (`public/bouton-avis.js`) ramène en plus,
sur chaque portail :
- les commandes de la période (n° long, heure, statut, montant payé au
  restaurant, boutique, **plats avec quantités**) ;
- les remboursements retenus et les pénalités d'attente, rattachés à leur commande.

Une nouvelle Edge Function Samtrackly `ingest-commandes-plateformes` (même secret
et même relais que `ingest-reviews`) les enregistre, idempotent par
`(plateforme, n° long)`, dans :
- `commandes_plateformes` (restaurant_id via le mapping boutiques des avis,
  plateforme, numero, commande_le, statut, montant_paye, montant_rembourse,
  penalite_attente, compte_comme_vendue)
- `commandes_plateformes_lignes` (commande_id, nom_plateforme, quantite).

Un seul clic, manager seulement. Premier passage : **à partir d'hier** (08/10/2026),
pas d'historique antérieur. Le favori doit être réinstallé une fois.

**À vérifier en premier (étape 0)**, connecté avec Ange dans Chrome : que les
portails exposent bien le détail des plats, le montant payé des annulées Yango,
les remboursements et les pénalités. Si une donnée manque, on revient vers Ange
avant de coder la suite.

### Commandes comptées comme vendues côté plateforme
- livrées / terminées ;
- **Yango annulées avec montant payé > 0** (comptent comme vendues) ;
- toute autre annulée : ignorée.

Côté POS : commandes `PAYEE` uniquement.

## 2. Correspondances de plats

Table `correspondances_plats` : (plateforme, nom_plateforme normalisé) →
article POS (nom de référence) ou « ignorer ». Écran manager « Correspondances » :
liste des noms inconnus, proposition automatique par ressemblance (mots communs,
sans accents ni casse), validation une fois pour toutes.

- Seuls les **plats principaux et boissons** sont comparés ; suppléments, options
  et sauces sont ignorés.
- Un combo compte comme ses plats (POS : `combo_id` éclaté ; plateforme : via
  correspondance vers plusieurs plats si nécessaire).
- Une journée contenant un plat plateforme **non relié** est **« à relier »** :
  aucun litige tapé ± n'est créé pour ce restaurant × plateforme × jour tant que
  le lien manque. Remboursements et attente ne sont pas bloqués.

## 3. Calcul — à chaque clic du favori

Pour chaque restaurant × plateforme × **journée minuit → minuit**, sur les
journées complètes (jusqu'à hier) :

1. Compter les plats (par article POS de référence) côté POS et côté plateforme.
2. Différence par plat : POS < plateforme → tapé − ; POS > plateforme → tapé +.
3. Montant = quantité d'écart × prix POS du canal (prix moyen des lignes POS du
   plat ce jour-là, sinon dernier prix connu du canal).
4. **Seuil 1 000 F** par sens, par restaurant × plateforme × jour : en dessous,
   rien n'est créé.
5. Attribution :
   - Tapé + : les commandes POS dont la `ref_partenaire` ne correspond à aucune
     commande plateforme du jour (4 derniers chiffres) et qui contiennent le plat
     en trop → leur `caissier_id`. À défaut, la dernière commande POS du jour
     contenant ce plat.
   - Tapé − : les commandes plateforme dont les 4 derniers chiffres ne sont dans
     aucune `ref_partenaire` du jour et qui contiennent le plat manquant → caissier
     présent à leur heure (`caissierAuMoment`, déjà utilisé pour les avis). À
     défaut, heure de la première commande plateforme contenant le plat.
   - Si l'attribution est ambiguë : litige créé **sans responsable** (même règle
     que les avis : mieux vaut personne qu'un caissier qui paie pour un autre).
   - Un litige peut regrouper plusieurs plats du même responsable le même jour.
6. Remboursements et pénalités : un litige par commande concernée, caissier de
   l'heure.

## 4. Enregistrement

Dans les tables existantes `litiges_yango` / `litiges_glovo`, nouvelles colonnes :
`origine` (`manuel` | `auto`), `cle_auto` (unique : restaurant, plateforme, jour,
type, responsable), `detail` JSONB (plats, quantités, commandes, heures),
`annule_le`, `annule_par`.

- **Litige créé directement**, comptant tout de suite dans la note /20 et les
  retenues (comme les saisies actuelles).
- Le manager peut **annuler** : la ligne reste (traçabilité) mais ne compte plus.
  **Un litige auto annulé ne revient jamais**, même si le calcul retombe dessus.
- Recalcul d'un jour : met à jour les lignes auto non annulées par `cle_auto`,
  supprime celles qui n'ont plus lieu d'être.
- **L'auto remplace la main** : quand l'auto a calculé un type pour un restaurant
  × plateforme × jour, les saisies manuelles de ce même type ce jour-là sont
  supprimées.
- Les calculs qui lisent les litiges (`litigesGlobal`, `noteCaissierDb`,
  `rapportMensuel`, retenues) excluent les lignes annulées.

Affichage dans Litiges → Yango / Glovo : pastille « auto », déroulant du détail
(plats, n° de commande, heures), bouton « Annuler », bandeau « Journées à relier »
renvoyant vers Correspondances. Rappel après 2 jours sans clic : déjà en place
pour les avis, il couvre désormais les commandes.

## 5. Erreurs et cas limites

- POS du jour non remonté (aucune commande partenaire POS alors que la plateforme
  en a) : journée « POS manquant », pas de litige (évite un faux tapé − massif).
- Boutique plateforme non rattachée à un restaurant : ignorée et signalée (même
  mapping que les avis).
- Plafonds portails : Yango ~30 j, Glovo 45 j par clic (déjà connus).

## 6. Tests (node:test, `lib/*.test.mjs`)

Fonctions pures dans `lib/litigesPlateformes.js` (copie testée identique dans la
fonction serveur, comme `attributionAvis.js`) :
- comptage par plat et écarts ± ;
- Yango annulée avec montant payé > 0 comptée, autres annulées ignorées ;
- seuil 1 000 F ;
- attribution tapé + par ref absente, tapé − par heure, ambiguïté → sans responsable ;
- journée « à relier » si plat non relié ; « POS manquant » ;
- litige annulé jamais recréé ; remplacement des saisies manuelles.

## Hors périmètre

Partie 2 POS (vue caissier, note, notification) ; annulations par le restaurant ;
réclamations « article manquant » sans remboursement chiffré.
