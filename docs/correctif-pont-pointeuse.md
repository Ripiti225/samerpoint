# Correctif pont POS → Samtrackly : heures réelles de la pointeuse

À appliquer sur le **master Windows** (le code POS du Mac est périmé), puis redéployer
la fonction `samtrackly-points` sur le projet **pos-samer-cloud**.
Prérequis : `supabase_paie.sql` passé sur Samtrackly (colonnes `presences.pointe_arrivee`
et `presences.pointe_depart`).

## Pourquoi

Depuis le 27/10/2026, la pointeuse remplit `equipe_service.pointe_le` / `depart_le`
(source `POINTEUSE`). Le pont ne copie que la présence ; l'état de salaire a besoin des
vraies heures d'arrivée et de départ.

## 1. `samtrackly-points/index.ts` : lire aussi le départ et la source

```ts
// avant
.select('utilisateur_id, poste_jour, pointe_le, reste')
// après
.select('utilisateur_id, poste_jour, pointe_le, depart_le, source, reste')
```

Ajouter `depart_le?: string | null; source?: string | null;` au type `EquipeService`
(`_shared/samtrackly-detail.ts`).

## 2. `_shared/samtrackly-detail.ts` : deux champs de plus par présence

Dans `LignePresence` :

```ts
pointe_arrivee: string | null;
pointe_depart: string | null;
```

Dans la boucle `for (const membre of equipe || [])` de `construirePresences()`, dans
l'objet poussé :

```ts
pointe_arrivee: membre.source === 'POINTEUSE' ? membre.pointe_le ?? null : null,
pointe_depart: membre.source === 'POINTEUSE' ? membre.depart_le ?? null : null,
```

Et `pointe_arrivee: null, pointe_depart: null` dans la boucle des personnes payées hors
équipe (correctif du 15/10), si elle est déjà appliquée.

## 3. Tests (`samtrackly-detail.test.ts`)

- membre source `POINTEUSE` avec `pointe_le` et `depart_le` → la présence porte les deux heures ;
- membre source `OUVERTURE` → `pointe_arrivee` et `pointe_depart` à `null` ;
- départ oublié (`depart_le` null) → `pointe_depart` null, présence quand même créée.

## Après déploiement

Dans le SQL Editor de **Samtrackly** :

```sql
select date, count(*) filter (where pointe_arrivee is not null) as avec_pointeuse, count(*) as presences
from presences where date >= current_date - 3 group by date order by date;
```
