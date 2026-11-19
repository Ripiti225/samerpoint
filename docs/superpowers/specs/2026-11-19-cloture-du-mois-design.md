# Clôture du mois — conception

Date : 19/11/2026 · Chantier 2 sur 3 de la comptabilité (après la bannière Comptabilité,
avant l'export SYSCOHADA).

## But

Une fois un mois vérifié, plus personne ne peut modifier les journées des restaurants de ce mois.
Les chiffres remis au comptable ne bougent plus, et le fond de caisse n'est plus décalé par une
correction tardive (modifier une journée reporte l'écart sur toutes les journées suivantes).

## Décisions validées

| Question | Choix |
|---|---|
| Ce qui est verrouillé | **Journées des restaurants seulement** : le point et ses shifts, dépenses, présences, transactions fournisseurs, inventaires. Trésorerie, salaires, factures sans journée : non verrouillés. |
| Portée | **Tout le groupe d'un coup** : un mois = les 7 restaurants. |
| Condition | **Bloquante** : toutes les journées du mois doivent être validées ET vérifiées. |
| Jours sans point | **Listés pour information, non bloquants** (fermeture possible). |
| Erreur découverte après | **Réouverture avec motif obligatoire**, notée au Journal, puis reclôture. |
| Qui | **Manager seulement** (clôturer et rouvrir). |
| Mois en cours | Jamais clôturable : seulement un mois terminé. |
| Protection | **Dans la base** (triggers), pas seulement à l'écran. |

## Base de données — `supabase_cloture_mois.sql` (à passer par l'utilisateur)

### Table `clotures_mois`

| Colonne | Type | Rôle |
|---|---|---|
| `mois` | `date` PK | 1er jour du mois (`2026-10-01`) |
| `statut` | `text` check in (`cloture`, `rouvert`) | état courant |
| `cloture_le` / `cloture_par` | `timestamptz` / `uuid` | dernière clôture |
| `rouvert_le` / `rouvert_par` / `motif_reouverture` | `timestamptz` / `uuid` / `text` | dernière réouverture |

RLS activé : lecture pour tous, **aucune écriture directe** ; on n'écrit que par les deux fonctions.

### Fonctions (security definer)

- `cloturer_mois(p_mois date, p_user uuid) returns jsonb`
  - refuse si `p_user` n'est pas un `utilisateurs.role = 'manager'` ;
  - refuse si le mois n'est pas terminé (`p_mois >= date_trunc('month', current_date)`) ;
  - refuse s'il existe un point du mois avec `valide` faux ou `verifie` faux ;
  - sinon upsert `statut = 'cloture'`, `cloture_le = now()`, `cloture_par = p_user`.
- `rouvrir_mois(p_mois date, p_user uuid, p_motif text) returns jsonb`
  - refuse si pas manager, si motif vide (après trim), si le mois n'est pas clôturé ;
  - sinon `statut = 'rouvert'`, `rouvert_le`, `rouvert_par`, `motif_reouverture`.
- Messages d'erreur en français, renvoyés tels quels à l'écran.

### Verrou `verrou_mois_cloture()` (trigger before insert/update/delete)

- Sur `points` : refuse si le mois de `new.date` (insert/update) ou de `old.date` (update/delete)
  est clôturé.
- Sur `points_shifts`, `depenses`, `presences`, `transactions_fournisseurs`, `inventaires_shifts` :
  même contrôle via le point de `new.point_id` / `old.point_id`. Lignes sans `point_id` :
  laissées passer (factures sans journée).
- Message : « Octobre 2026 est clôturé : cette journée ne peut plus être modifiée. Le manager peut
  rouvrir le mois depuis Comptabilité → Clôture du mois. » (mois en toutes lettres, en français).
- Même modèle que `supabase_import_sheets_lecture_seule.sql` ; maintenance : `disable trigger`.

## Application

### Logique pure — `lib/clotureMois.js` (+ `lib/clotureMois.test.mjs`)

- `moisTermine(mois, aujourdhui)` → booléen.
- `etatMois({ mois, points, restaurants, aujourdhui })` →
  `{ bloquants: [{ restaurantId, nom, date, raison: 'non_valide' | 'non_verifie', pointId }],
     joursVides: [{ restaurantId, nom, dates: [] }], peutCloturer }` (jours vides regroupés par restaurant)
  (`peutCloturer` = mois terminé et aucun bloquant ; jours vides ignorés).
- `libelleMois('2026-10-01')` → « Octobre 2026 ».
- `listeMois(aujourdhui, n = 12)` → les n derniers mois terminés, du plus récent au plus ancien.

### Écran — `app/cloture-mois.js`

- Tuile catalogue `cloture-mois` (admin, icône `lock-check`), rangée dans la bannière
  **Comptabilité** après Rapports. Non ajoutée aux accès RH ; et de toute façon les fonctions
  SQL refusent un non-manager.
- Liste des 12 derniers mois terminés avec leur état (Ouvert / Clôturé le … par … /
  Rouvert le … : motif).
- Mois touché → chargement de ses points (`id, restaurant_id, date, valide, verifie`, paginé) :
  - 🔴 Journées qui bloquent : une ligne par journée ; toucher → non validée :
    `/modifier-point?restaurant_id=…&date=…` ; non vérifiée : `/verification?restaurant_id=…&point_id=…`.
  - 🟡 Jours sans point (information).
  - Bouton « Clôturer Octobre 2026 » actif seulement si `peutCloturer`, avec confirmation.
  - Mois clôturé : bouton « Rouvrir », motif obligatoire.
- Appels : `supabase.rpc('cloturer_mois' | 'rouvrir_mois')` ; `journaliser('cloture_mois' |
  'reouverture_mois', { mois, motif })`.
- Erreurs affichées en français (message SQL déjà en français).

## Effets à connaître

- Toute modification d'une journée d'un mois clôturé échoue, sur tous les écrans (Modifier un point,
  Correction, Corbeille, déplacement de shift, Déductions…) et pour le pont POS : c'est voulu.
- Le premier jour du mois suivant n'est pas touché : le fond de la veille est lu, jamais réécrit.

## Tests

- `lib/clotureMois.test.mjs` : journées non validées / non vérifiées bloquantes ; jours vides listés
  mais non bloquants ; mois en cours refusé ; libellé et liste des mois.
- SQL : bloc de contrôle commenté (une modification d'un point d'un mois clôturé doit échouer).
- `npm run lint` (0 erreur), tous les `lib/*.test.mjs`, `npx expo export -p web`.

## Publication

Commit + push. Le SQL est passé par l'utilisateur. Publication Vercel + EAS à la fin des chantiers.
