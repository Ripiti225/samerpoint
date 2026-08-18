# Gestion des contrats de travail (RH)

Design validé le 2026-08-18.

## Problème

Le RH n'a aucun moyen d'enregistrer la durée d'engagement d'un travailleur.
La fiche porte un `type_contrat` (CDI / CDD / Journalier) et une `date_embauche`,
mais rien qui dise quand l'engagement se termine. Conséquence : une fin de CDD
ou de stage passe inaperçue, et le travailleur reste actif dans les présences et
les salaires alors que son contrat est fini.

## Objectif

Permettre au RH de saisir les contrats successifs d'un travailleur, d'être
prévenu avant chaque échéance, et de voir le travailleur sortir automatiquement
des effectifs si aucun contrat ne prend le relais.

## État des lieux (constaté en base le 2026-08-18)

- 130 travailleurs actifs : 84 Journaliers, 36 CDI, 10 CDD.
- `documents_travailleurs` gère déjà les papiers (CNI, Passeport, Permis,
  Contrat, Autre) en photo ou PDF, bucket `documents-travailleurs`.
- L'archivage d'un travailleur existe, avec les motifs Démission / Renvoi /
  Fin de contrat / Autre, et un bouton Réactiver dans l'onglet Archivés.
- `rappel-explications` (Edge Function + pg_cron quotidien) sert de modèle
  éprouvé pour la partie automatique.
- `utilisateurs.travailleur_id` existe mais est vide sur les 39 comptes.

## Modèle de données

Nouvelle table `contrats_travailleurs`. Les 130 fiches existantes ne sont pas
migrées : elles n'ont simplement pas encore de contrat.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS contrats_travailleurs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  travailleur_id uuid NOT NULL REFERENCES travailleurs(id) ON DELETE CASCADE,
  restaurant_id  uuid REFERENCES restaurants(id),
  type           text NOT NULL CHECK (type IN ('Stage','CDD','CDI')),
  date_debut     date NOT NULL,
  date_fin       date,
  duree_mois     int CHECK (duree_mois IN (3,6,12)),
  photo_url      text NOT NULL,
  photo_type     text NOT NULL DEFAULT 'photo' CHECK (photo_type IN ('photo','pdf')),
  cloture_le     date,
  cloture_motif  text,
  rappels_envoyes int[] NOT NULL DEFAULT '{}',
  desactivation_faite_le date,
  cree_par       uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contrat_cdi_sans_fin CHECK (
    (type = 'CDI' AND date_fin IS NULL) OR (type <> 'CDI' AND date_fin IS NOT NULL)
  ),
  CONSTRAINT contrat_fin_apres_debut CHECK (date_fin IS NULL OR date_fin >= date_debut),
  CONSTRAINT contrat_cloture_coherente CHECK (cloture_le IS NULL OR cloture_le >= date_debut)
);

-- Deux contrats d'un même travailleur ne peuvent pas se chevaucher.
ALTER TABLE contrats_travailleurs
  ADD CONSTRAINT contrats_sans_chevauchement
  EXCLUDE USING gist (
    travailleur_id WITH =,
    daterange(date_debut, (COALESCE(cloture_le, date_fin) + 1), '[)') WITH &&
  );

CREATE INDEX ON contrats_travailleurs (travailleur_id, date_debut DESC);
CREATE INDEX ON contrats_travailleurs (date_fin) WHERE cloture_le IS NULL;

ALTER TABLE contrats_travailleurs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON contrats_travailleurs;
CREATE POLICY allow_all ON contrats_travailleurs
  FOR ALL TO public USING (true) WITH CHECK (true);
```

`travailleurs.type_contrat` accepte en plus la valeur `Stage`. Vérifier avant
migration s'il porte une contrainte CHECK à étendre.

### Le statut n'est pas stocké

`en cours` / `expiré` / `rompu` / `renouvelé` se déduisent des dates et de
`cloture_le`. Un statut stocké finit toujours par mentir : la date passe, plus
personne ne clique, et la colonne reste bloquée sur une valeur fausse.

Un contrat est **en cours** si `cloture_le IS NULL` et que la journée du jour
tombe dans `[date_debut, date_fin]` (`date_fin` vide = CDI, donc toujours en
cours).

### Le fichier du contrat

`photo_url` pointe vers le bucket `documents-travailleurs`, déjà utilisé pour
les papiers. À chaque contrat créé, une ligne est aussi écrite dans
`documents_travailleurs` avec `type_document = 'Contrat'`, pour que le contrat
apparaisse dans les papiers du travailleur comme les autres pièces.

## Règles métier

1. **Photo obligatoire.** Pas d'enregistrement sans le contrat signé, en photo
   ou en PDF. Vérifié côté écran (bouton désactivé) et côté base (`NOT NULL`).
2. **Durée obligatoire pour Stage et CDD** : 3, 6 ou 12 mois, ou « Autre » avec
   saisie de la date de fin à la main. `date_fin` est calculée à partir de la
   durée quand elle est choisie.
3. **CDI** : date de début seule, pas de date de fin, pas de durée. Jamais
   d'alerte, jamais de désactivation automatique.
4. **Journalier** : reste un type de fiche, n'ouvre aucun contrat. Les 84
   Journaliers ne sont pas concernés par cette fonctionnalité.
5. **Pas de chevauchement** : un travailleur n'a qu'un contrat en cours.
6. **Pas de renouvellement automatique.** Rien n'est jamais créé tout seul.
7. **Fin anticipée = archivage du travailleur.** Il n'existe pas d'action
   séparée « rompre le contrat ». Archiver un travailleur (Démission / Renvoi /
   Fin de contrat / Autre) clôture son contrat en cours : `cloture_le` prend la
   date du jour, `cloture_motif` le motif d'archivage.
8. **Désactivation automatique à l'échéance** (détail plus bas).
9. Un contrat clôturé ne déclenche ni alerte ni désactivation.

## Écrans

### Bloc « Contrat » dans la fiche travailleur

```
CONTRAT
● CDD · 16/04/2026 → 16/10/2026            [Expire dans 5 j]
  📄 contrat signé
  Historique (1) ▾
      Stage · 15/01/2026 → 15/04/2026       terminé
                                      [ + Nouveau contrat ]
```

Sans contrat : « Aucun contrat enregistré » + le bouton d'ajout.
Le badge d'échéance apparaît dès que la fin est à moins de 30 jours.

### Onglet « Contrats » dans l'écran RH

Sixième onglet, après Dashboard / Travailleurs / Présences / Salaires /
Archivés. Liste triée par date de fin la plus proche, filtres :
**Expire bientôt · En cours · Expirés · Sans contrat**.

C'est la vue de travail du RH : qui reste à traiter, dans quel ordre.

### Formulaire de contrat (modal)

Dans cet ordre :

1. **Type** — Stage · CDD · CDI
2. **Date de début** — pré-remplie : `date_embauche` pour un premier contrat,
   lendemain de la fin du précédent pour un renouvellement
3. **Durée** — `3 mois` · `6 mois` · `1 an` · `Autre` (masqué si CDI)
4. **Date de fin** — calculée et affichée en clair (« se termine le
   16/10/2026 »), saisissable seulement si « Autre »
5. **Photo du contrat signé** — obligatoire, photo ou PDF

Enregistrer reste désactivé tant que type, date de début, durée et photo ne
sont pas tous remplis. À l'enregistrement, `travailleurs.type_contrat` est
aligné sur le type du contrat, pour que salaires et exports Excel restent
cohérents.

**La création d'un contrat exige une connexion** : l'upload du fichier ne passe
pas par la file hors-ligne. Message explicite si hors ligne, pas d'échec muet.

## Automatisation

Edge Function `rappel-contrats`, déclenchée par pg_cron tous les jours à 07:00
(Abidjan est à UTC+0). Même mécanique que `rappel-explications`.

### Passe 1 — alertes d'échéance

Paliers : **15, 7 et 3 jours** avant `date_fin`. Chaque palier part une fois,
tracé dans `rappels_envoyes`.

Sélection : contrats avec `date_fin` non vide, `cloture_le IS NULL`, travailleur
actif. Pour chacun, on calcule les jours restants et on envoie **le palier
applicable le plus haut non encore envoyé**. Un contrat saisi tardivement, à 5
jours de sa fin, reçoit donc J-7 immédiatement au lieu d'attendre J-3.

Deux notifications distinctes par palier :

| Destinataires | `screen` | Comportement au clic |
|---|---|---|
| `rh`, `manager`, `directeur` | `rh` | ouvre l'écran RH |
| `gerant` (restaurant du travailleur) | vide | **aucune navigation** |

Le gérant reçoit la même information mais sa notification n'ouvre aucun écran.
C'est délibéré : il n'a pas accès à l'écran RH, une navigation le mènerait à un
écran vide ou à une erreur.

Texte : `⏰ Fin de contrat dans 7 jours — CDD de Kouamé Assi, le 16/10/2026`

### Passe 2 — désactivation automatique

Un travailleur est archivé automatiquement si **toutes** ces conditions sont
réunies :

- il est actif ;
- il a au moins un contrat (les 46 fiches CDI/CDD sans contrat saisi et les 84
  Journaliers sont donc hors de portée) ;
- **aucun** de ses contrats ne couvre la journée du jour ;
- et **aucun contrat futur** n'est enregistré pour lui.

La dernière condition traite le cas du trou : si l'ancien contrat finit le 16/10
et que le suivant est saisi à partir du 20/10, le travailleur n'est pas archivé
pendant les trois jours de battement. Le RH a signalé la continuité, l'app n'a
pas à le contredire — puis à lui faire cliquer « Réactiver » le 20. Une action
automatique et destructrice doit pencher du côté prudent.

L'archivage applique exactement ce que fait le bouton manuel :
`statut = 'archive'`, `actif = false`, `archived_at`, `archive_motif =
'Fin de contrat'`. `desactivation_faite_le` est posé sur le contrat expiré pour
garantir l'idempotence.

Conséquences voulues :

- La désactivation tombe **le lendemain de `date_fin`** : le dernier jour du
  contrat est un jour travaillé normal.
- Si le RH a saisi le contrat suivant, en continuité ou avec quelques jours de
  battement, **rien ne se passe**.
- Le travailleur part dans l'onglet Archivés ; le bouton Réactiver existant le
  récupère. Rien n'est supprimé.

La condition « il a au moins un contrat » n'est pas un détail : sans elle, le
premier passage du cron archivait les 130 travailleurs actifs.

Notification aux mêmes destinataires (gérant inclus, sans navigation) :
`🔒 Kouamé Assi désactivé — fin de contrat le 16/10/2026`

## Hors périmètre

- Renouvellement automatique d'un contrat.
- Génération d'un contrat PDF depuis l'app.
- Rattrapage des 46 CDI/CDD existants : saisie au fil de l'eau.
- Blocage du compte de connexion (voir Limite connue).

## Limite connue : le PIN survit à la désactivation

La désactivation retire le travailleur des présences, des salaires et des
listes RH, mais ne bloque pas sa connexion. Les comptes vivent dans
`utilisateurs`, et la colonne `travailleur_id` censée faire le lien est vide sur
les 39 comptes.

Un caissier dont le contrat expire disparaît donc des écrans RH, mais son PIN
continue de fonctionner. C'est déjà le comportement actuel de l'archivage
manuel : cette fonctionnalité ne l'aggrave pas. Traité comme un chantier
séparé, décision prise le 2026-08-18.

## Tests

- Contrat CDI avec une date de fin → refusé par la base.
- Contrat Stage sans date de fin → refusé par la base.
- Deux contrats qui se chevauchent → refusés par la base.
- Enregistrement sans photo → bouton désactivé, et refus base.
- Durée 6 mois au 16/04/2026 → date de fin calculée au 16/10/2026.
- Alerte J-7 envoyée une seule fois, même après trois passages du cron.
- Contrat saisi à 5 jours de la fin → reçoit J-7, pas J-3.
- Contrat clôturé par archivage → plus aucune alerte.
- Travailleur sans contrat → jamais désactivé automatiquement.
- Contrat suivant saisi en continuité → pas de désactivation.
- Contrat suivant saisi avec trois jours de battement → pas de désactivation.
- Journalier et CDI → jamais désactivés.
