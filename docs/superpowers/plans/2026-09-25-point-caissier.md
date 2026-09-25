# Point caissier — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer « Espace Caissier » par un écran de consultation « Point caissier » qui affiche, sur trois jours, chaque clôture POS validée avec son détail complet, son écart global et l'explication du caissier — et ouvrir les contacts fournisseurs au RH.

**Architecture :** Un module pur (`lib/pointCaissier.js`) calcule les trois journées et range les clôtures POS ; l'affichage du détail existant est sorti de `app/point-shift.js` vers `lib/detailShift.js` (chargement) et `components/DetailShiftCaissier.js` (rendu), que le nouvel écran `app/point-caissier.js` réutilise tel quel. Le menu bascule via `lib/menus.js` **et** une migration de la table `roles_acces`.

**Tech Stack :** React Native / Expo Router, Supabase JS, tests `node:test` (`lib/*.test.mjs`), pas de framework de test.

## Global Constraints

- Toute l'interface, les libellés et les messages sont **en français**. Montants en **FCFA**.
- `ecart_reconciliation` = écart global officiel (rapport Z). **Ne jamais y substituer `ecart_pos`** (écart du tiroir espèces). Cf. l'en-tête de `lib/cloturesCaisse.js`.
- Les écrans calculent leurs styles via `useMemo(() => makeStyles(colors), [colors])` (`context/ThemeContext`).
- Toute lecture Supabase sur une période doit rester sous 1000 lignes ou paginer. Trois jours d'un restaurant : pas de pagination nécessaire.
- `npm run lint` doit finir à **0 erreur** (71 warnings préexistants tolérés).
- **Aucun déploiement** Vercel ni OTA dans ce plan.

---

### Task 1 : le module pur `lib/pointCaissier.js`

**Files:**
- Create: `lib/pointCaissier.js`
- Test: `lib/pointCaissier.test.mjs`

**Interfaces:**
- Consomme : `cloturesPOS(shifts)` de `lib/cloturesCaisse.js` — renvoie les clôtures POS validées dédoublonnées, enrichies de `ecartGlobal`, `ecartGlobalTexte`, `ecartEspeces`, `ecartEspecesTexte`.
- Produit :
  - `troisDerniersJours(dateRef = new Date())` → `string[]` de 3 dates `'YYYY-MM-DD'`, de la plus récente à la plus ancienne.
  - `grouperShiftsParJour(shifts, dateRef = new Date())` → `Array<{ date: string, shifts: object[] }>` de longueur 3, journées vides comprises, shifts triés par `heure_debut` croissant.
  - `aBesoinExplication(cloture)` → `boolean` : vrai si `ecartGlobal` est un nombre non nul et `explication_ecart` vide.

- [ ] **Step 1 : écrire les tests qui échouent**

```js
// lib/pointCaissier.test.mjs
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let troisDerniersJours
let grouperShiftsParJour
let aBesoinExplication
try {
  ({ troisDerniersJours, grouperShiftsParJour, aBesoinExplication } = await import('./pointCaissier.js'))
} catch {
  // Le premier passage TDD échoue proprement tant que le contrat n'existe pas.
}

const clotureValide = (extra) => ({
  pos_service_id: `service-${extra.id}`, valide: true, ecart_reconciliation: 0, ...extra,
})

describe('les trois journées affichées', () => {
  test('renvoie aujourd’hui puis les deux jours précédents', () => {
    assert.equal(typeof troisDerniersJours, 'function')
    assert.deepEqual(
      troisDerniersJours(new Date('2026-09-25T10:00:00')),
      ['2026-09-25', '2026-09-24', '2026-09-23'],
    )
  })

  test('franchit un changement de mois', () => {
    assert.deepEqual(
      troisDerniersJours(new Date('2026-03-01T08:00:00')),
      ['2026-03-01', '2026-02-28', '2026-02-27'],
    )
  })

  test('franchit un changement d’année', () => {
    assert.deepEqual(
      troisDerniersJours(new Date('2026-01-01T23:30:00')),
      ['2026-01-01', '2025-12-31', '2025-12-30'],
    )
  })
})

describe('regroupement des clôtures par journée', () => {
  test('rend toujours trois journées, même sans aucun shift', () => {
    assert.equal(typeof grouperShiftsParJour, 'function')
    const groupes = grouperShiftsParJour([], new Date('2026-09-25T10:00:00'))
    assert.equal(groupes.length, 3)
    assert.deepEqual(groupes.map(g => g.date), ['2026-09-25', '2026-09-24', '2026-09-23'])
    assert.deepEqual(groupes.map(g => g.shifts.length), [0, 0, 0])
  })

  test('garde une journée vide entre deux journées remplies', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'a', date: '2026-09-25', heure_debut: '08:00' }),
      clotureValide({ id: 'b', date: '2026-09-23', heure_debut: '08:00' }),
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes.map(g => g.shifts.length), [1, 0, 1])
  })

  test('écarte les shifts non validés et ceux qui ne viennent pas du POS', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'ok', date: '2026-09-25', heure_debut: '08:00' }),
      { id: 'ouvert', date: '2026-09-25', heure_debut: '09:00', pos_service_id: 'service-ouvert', valide: false },
      { id: 'manuel', date: '2026-09-25', heure_debut: '10:00', valide: true, pos_service_id: null, ecart_reconciliation: null },
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes[0].shifts.map(s => s.id), ['ok'])
  })

  test('dédoublonne deux remontées du même service POS', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'un', date: '2026-09-25', heure_debut: '08:00', pos_service_id: 'service-x' }),
      clotureValide({ id: 'deux', date: '2026-09-25', heure_debut: '08:00', pos_service_id: 'service-x' }),
    ], new Date('2026-09-25T10:00:00'))

    assert.equal(groupes[0].shifts.length, 1)
  })

  test('trie les shifts d’une journée par heure de début', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'soir', date: '2026-09-25', heure_debut: '16:00' }),
      clotureValide({ id: 'matin', date: '2026-09-25', heure_debut: '08:00' }),
      clotureValide({ id: 'sans-heure', date: '2026-09-25', heure_debut: null }),
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes[0].shifts.map(s => s.id), ['matin', 'soir', 'sans-heure'])
  })

  test('ignore une clôture hors des trois journées', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'vieux', date: '2026-09-20', heure_debut: '08:00' }),
    ], new Date('2026-09-25T10:00:00'))

    assert.deepEqual(groupes.map(g => g.shifts.length), [0, 0, 0])
  })

  test('conserve l’écart global calculé par cloturesPOS', () => {
    const groupes = grouperShiftsParJour([
      clotureValide({ id: 'a', date: '2026-09-25', heure_debut: '08:00', ecart_reconciliation: -2500, ecart_pos: 0 }),
    ], new Date('2026-09-25T10:00:00'))

    assert.equal(groupes[0].shifts[0].ecartGlobal, -2500)
    assert.equal(groupes[0].shifts[0].ecartGlobalTexte, '-2 500 FCFA')
  })
})

describe('badge « sans explication »', () => {
  test('un écart non nul sans explication demande une explication', () => {
    assert.equal(typeof aBesoinExplication, 'function')
    assert.equal(aBesoinExplication({ ecartGlobal: -2500, explication_ecart: null }), true)
    assert.equal(aBesoinExplication({ ecartGlobal: -2500, explication_ecart: '   ' }), true)
  })

  test('un écart expliqué, nul ou indisponible ne demande rien', () => {
    assert.equal(aBesoinExplication({ ecartGlobal: -2500, explication_ecart: 'Erreur de rendu' }), false)
    assert.equal(aBesoinExplication({ ecartGlobal: 0, explication_ecart: null }), false)
    assert.equal(aBesoinExplication({ ecartGlobal: null, explication_ecart: null }), false)
  })
})
```

- [ ] **Step 2 : lancer le test, vérifier l'échec**

Run: `node lib/pointCaissier.test.mjs`
Expected: FAIL — `assert.equal(typeof troisDerniersJours, 'function')` échoue (`undefined`).

- [ ] **Step 3 : écrire l'implémentation minimale**

```js
// lib/pointCaissier.js
// Les trois journées de l'écran « Point caissier » et le rangement des
// clôtures POS validées dans ces journées.
//
// Aucun accès réseau : la source reste `cloturesPOS()`, qui décide seule
// ce qu'est une clôture POS. Ce module ne fait que dater et ordonner.

import { cloturesPOS } from './cloturesCaisse'

const NB_JOURS = 3

function isoLocal(date) {
  const an = date.getFullYear()
  const mois = String(date.getMonth() + 1).padStart(2, '0')
  const jour = String(date.getDate()).padStart(2, '0')
  return `${an}-${mois}-${jour}`
}

// Aujourd'hui + les deux jours calendaires précédents, du plus récent au
// plus ancien. Dates locales : le fuseau d'Abidjan ne doit pas faire
// basculer la journée comme le ferait toISOString().
export function troisDerniersJours(dateRef = new Date()) {
  const jours = []
  for (let i = 0; i < NB_JOURS; i++) {
    const jour = new Date(dateRef.getFullYear(), dateRef.getMonth(), dateRef.getDate() - i)
    jours.push(isoLocal(jour))
  }
  return jours
}

// Un shift sans heure de début passe en dernier plutôt que de disparaître.
function comparerParHeure(a, b) {
  const ha = a.heure_debut || '99:99'
  const hb = b.heure_debut || '99:99'
  return ha.localeCompare(hb)
}

export function grouperShiftsParJour(shifts, dateRef = new Date()) {
  const jours = troisDerniersJours(dateRef)
  const parJour = new Map(jours.map(date => [date, []]))

  for (const cloture of cloturesPOS(shifts)) {
    const liste = parJour.get(cloture.date)
    if (liste) liste.push(cloture)
  }

  return jours.map(date => ({ date, shifts: parJour.get(date).sort(comparerParHeure) }))
}

export function aBesoinExplication(cloture) {
  const ecart = cloture?.ecartGlobal
  if (typeof ecart !== 'number' || ecart === 0) return false
  return String(cloture?.explication_ecart || '').trim() === ''
}
```

- [ ] **Step 4 : relancer le test, vérifier qu'il passe**

Run: `node lib/pointCaissier.test.mjs`
Expected: PASS — tous les tests verts.

- [ ] **Step 5 : lancer toute la suite**

Run: `for f in lib/*.test.mjs; do node "$f"; done`
Expected: aucun échec.

---

### Task 2 : sortir le chargement du détail dans `lib/detailShift.js`

Déplacement à comportement identique : aucune requête, aucun filtre ne change.

**Files:**
- Create: `lib/detailShift.js`
- Modify: `app/point-shift.js` (fonction `chargerDetailShift`, lignes 312–374)

**Interfaces:**
- Produit : `chargerDetailShift(shift)` → `Promise<{ depenses: object[], fournisseurs: object[], presences: object[], inventaire: object|null }>`.

- [ ] **Step 1 : créer le module**

Copier le corps de `app/point-shift.js:312-374` dans `lib/detailShift.js`, sans les `setState` :

```js
// lib/detailShift.js
// Chargement du détail d'un shift caissier : dépenses, fournisseurs,
// présences et inventaire. Partagé par `app/point-shift.js` et
// `app/point-caissier.js` — une seule version des filtres à maintenir.

import { supabase } from './supabase'

export async function chargerDetailShift(shift) {
  let depQ = supabase.from('depenses')
    .select('*')
    .eq('point_id', shift.point_id)
    .eq('saisi_par', 'caissier')
    .order('created_at')
  if (shift.caissier_nom) depQ = depQ.eq('caissier_nom', shift.caissier_nom)

  // caissier_id n'est jamais sauvegardé dans transactions_fournisseurs → filtrer par caissier_nom
  let txQ = supabase.from('transactions_fournisseurs')
    .select('*, fournisseurs(nom)')
    .eq('point_id', shift.point_id)
    .eq('saisi_par', 'caissier')
  if (shift.caissier_nom) txQ = txQ.eq('caissier_nom', shift.caissier_nom)

  const [depRes, txRes, invRes] = await Promise.all([
    depQ,
    txQ,
    shift.caissier_id
      ? supabase.from('inventaires_shifts')
          .select(`
            id, caissier_id, type_shift, montant_a_deduire, valide,
            inventaire_lignes(
              produit_id, produit_nom, stock_initial, entrees, sorties,
              stock_reel, ecart, nombre_explique, explication, montant_deduit
            )
          `)
          .eq('point_id', shift.point_id)
          .eq('caissier_id', shift.caissier_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Présences : select('*') sans jointure FK (travailleur_nom est dénormalisé dans la table)
  // Essayer d'abord par caissier_id, sinon par point_id seul
  let presData = []
  if (shift.caissier_id) {
    const presById = await supabase.from('presences')
      .select('*')
      .eq('point_id', shift.point_id)
      .eq('caissier_id', shift.caissier_id)
    presData = presById.data || []
  }
  if (presData.length === 0) {
    const presByPoint = await supabase.from('presences')
      .select('*')
      .eq('point_id', shift.point_id)
    presData = presByPoint.data || []
  }

  return {
    depenses: depRes.data || [],
    fournisseurs: txRes.data || [],
    presences: presData,
    inventaire: invRes.data || null,
  }
}
```

- [ ] **Step 2 : brancher `app/point-shift.js` dessus**

Remplacer toute la fonction locale par :

```js
async function ouvrirDetailShift(shift) {
  setShiftDetail(shift)
  setShiftDetailData({ depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: true })
  const data = await chargerDetailShift(shift)
  setShiftDetailData({ ...data, loading: false })
}
```

Ajouter l'import `import { chargerDetailShift } from '../lib/detailShift'` et remplacer l'unique appelant, `app/point-shift.js:1009`, par `ouvrirDetailShift(shift)`.

- [ ] **Step 3 : vérifier le lint**

Run: `npm run lint`
Expected: 0 erreur, aucun nouveau warning sur `app/point-shift.js` ou `lib/detailShift.js`.

---

### Task 3 : sortir l'affichage du détail dans `components/DetailShiftCaissier.js`

**Files:**
- Create: `components/DetailShiftCaissier.js`
- Modify: `app/point-shift.js` (modal du détail lignes 1245–1525, modal photo plein écran 1527–1544, styles devenus inutilisés)

**Interfaces:**
- Consomme : `PhotoJustificatif` de `components/PhotoJustificatif`, `useTheme` de `context/ThemeContext`.
- Produit : composant par défaut `DetailShiftCaissier({ shift, data, onClose, afficherEcartPOS = false })`.
  - `shift` : la ligne `points_shifts` (enrichie par `cloturesPOS()` quand elle vient de « Point caissier »).
  - `data` : `{ depenses, fournisseurs, presences, inventaire, loading }`.
  - `onClose` : ferme le détail. Le composant n'est rendu que si `shift` est non nul.
  - `afficherEcartPOS` : ajoute les deux lignes « Écart global » et « Explication du caissier » à la fin des données financières.

- [ ] **Step 1 : créer le composant**

Déplacer tel quel le JSX des deux modals (détail + photo plein écran) de `app/point-shift.js`, avec :
- `const { colors } = useTheme()` et `const styles = useMemo(() => makeStyles(colors), [colors])`,
- `const [photoPleinEcranUrl, setPhotoPleinEcranUrl] = useState(null)` en état interne,
- les helpers locaux `fmt` et `formatDate` recopiés depuis `app/point-shift.js` (mêmes formats),
- les styles utilisés par ces deux modals recopiés dans le `makeStyles` du composant.

Puis, dans la carte « Données financières », après la liste existante :

```jsx
{afficherEcartPOS && (
  <>
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>Écart global (rapport Z)</Text>
      <Text style={[styles.detailVal, couleurEcart(shift?.ecartGlobal)]}>
        {shift?.ecartGlobalTexte || 'Non disponible'}
      </Text>
    </View>
    <View style={[styles.detailRow, { borderBottomWidth: 0, alignItems: 'flex-start' }]}>
      <Text style={styles.detailLabel}>Explication du caissier</Text>
      <Text style={[styles.detailVal, styles.detailExplication]}>
        {String(shift?.explication_ecart || '').trim() || 'Aucune explication donnée'}
      </Text>
    </View>
  </>
)}
```

avec, en haut du fichier :

```js
// Rouge = manquant, vert = excédent, neutre à zéro ou sans rapport Z.
function couleurEcart(ecart) {
  if (typeof ecart !== 'number' || ecart === 0) return null
  return { color: ecart < 0 ? '#C0392B' : '#3B6D11', fontWeight: '700' }
}
```

et le style `detailExplication: { flex: 1, textAlign: 'right', fontWeight: '400', fontStyle: 'italic' }`.

- [ ] **Step 2 : brancher `app/point-shift.js` dessus**

Supprimer les deux modals et rendre à leur place :

```jsx
<DetailShiftCaissier
  shift={shiftDetail}
  data={shiftDetailData}
  onClose={() => setShiftDetail(null)}
/>
```

Supprimer l'état `photoPleinEcranUrl` et, **un par un**, les styles devenus inutilisés : pour chaque nom de style déplacé, vérifier `grep -c "styles\.<nom>" app/point-shift.js` **avant** de le retirer — plusieurs styles (`loadingBox`, `emptyBox`…) servent aussi à la liste et doivent rester.

- [ ] **Step 3 : vérifier le lint et les tests**

Run: `npm run lint && for f in lib/*.test.mjs; do node "$f"; done`
Expected: 0 erreur, aucun test en échec.

---

### Task 4 : l'écran `app/point-caissier.js`

**Files:**
- Create: `app/point-caissier.js`

**Interfaces:**
- Consomme : `troisDerniersJours`, `grouperShiftsParJour`, `aBesoinExplication` (Task 1) ; `chargerDetailShift` (Task 2) ; `DetailShiftCaissier` (Task 3) ; `useApp()` pour `restaurantId`, `useTheme()` pour `colors`.

- [ ] **Step 1 : écrire l'écran**

Structure attendue :

```jsx
const [groupes, setGroupes] = useState([])
const [loading, setLoading] = useState(true)
const [shiftDetail, setShiftDetail] = useState(null)
const [detail, setDetail] = useState({ depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: false })

useEffect(() => { charger() }, [restaurantId])

async function charger() {
  setLoading(true)
  if (!restaurantId) { setGroupes(grouperShiftsParJour([])); setLoading(false); return }
  const { data } = await supabase.from('points_shifts')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .in('date', troisDerniersJours())
  setGroupes(grouperShiftsParJour(data || []))
  setLoading(false)
}

async function ouvrir(shift) {
  setShiftDetail(shift)
  setDetail({ depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: true })
  const data = await chargerDetailShift(shift)
  setDetail({ ...data, loading: false })
}
```

Rendu :
- En-tête orange `#EF9F27` identique aux autres écrans : « ‹ Retour », titre **POINT CAISSIER**, sous-titre « 3 derniers jours ».
- Sans `restaurantId` : « Choisissez d'abord un restaurant. » (le manager arrive parfois sans contexte).
- Une section par journée : titre « Aujourd'hui · jeudi 25 septembre » pour la première, sinon la date longue en français (`toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })`).
- Journée vide : « Aucun shift clôturé ce jour-là ».
- Une carte par shift : `👤 {caissier_nom}`, `⏰ {heure_debut} → {heure_fin}`, « Vente shift » en FCFA, « Écart global » avec `ecartGlobalTexte` coloré (rouge < 0, vert > 0), et le badge « ⚠ Sans explication » quand `aBesoinExplication(shift)`.
- Au bas : `<DetailShiftCaissier shift={shiftDetail} data={detail} onClose={() => setShiftDetail(null)} afficherEcartPOS />`.
- Aucun bouton de suppression, de sélection ou de modification.

- [ ] **Step 2 : vérifier le lint**

Run: `npm run lint`
Expected: 0 erreur.

---

### Task 5 : le menu et sa migration

**Files:**
- Modify: `lib/menus.js` (catalogue `TUILES`, `ACCES_DEFAUT.gerant`)
- Create: `supabase_point_caissier.sql`

- [ ] **Step 1 : ajouter la tuile au catalogue**

Dans la section admin de `TUILES`, après `stats-caissiers` :

```js
{ id: 'point-caissier', icon: '🧾', titre: 'Point caissier', sous: 'Shifts clôturés · 3 derniers jours', route: '/point-caissier', admin: true },
```

Dans `ACCES_DEFAUT.gerant`, remplacer `'gerant-caissier'` par `'point-caissier'`. Ne pas toucher aux listes `rh` (Task 6) ni `caissier`. Ne pas supprimer la tuile `gerant-caissier` du catalogue : elle reste réactivable depuis Paramètres.

- [ ] **Step 2 : écrire la migration**

```sql
-- Bascule du menu gérant : « Espace Caissier » → « Point caissier ».
-- Les menus réels vivent dans roles_acces ; lib/menus.js n'est qu'un repli.
-- Idempotent et rejouable.
UPDATE public.roles_acces
SET tuiles = (
      SELECT COALESCE(jsonb_agg(t ORDER BY ord), '[]'::jsonb)
      FROM (
        SELECT t, ord
        FROM jsonb_array_elements(tuiles) WITH ORDINALITY AS a(t, ord)
        WHERE t <> '"gerant-caissier"'::jsonb
        UNION ALL
        SELECT '"point-caissier"'::jsonb, 999
        WHERE NOT tuiles @> '["point-caissier"]'::jsonb
      ) AS fusion
    ),
    updated_at = NOW()
WHERE role = 'gerant';
```

Vérifier au préalable le type de la colonne `tuiles` :

```bash
grep -n "roles_acces" -A 12 supabase_roles_acces.sql
```

Si la colonne est `TEXT[]` et non `JSONB`, écrire à la place :

```sql
UPDATE public.roles_acces
SET tuiles = array_append(array_remove(tuiles, 'gerant-caissier'), 'point-caissier'),
    updated_at = NOW()
WHERE role = 'gerant'
  AND NOT ('point-caissier' = ANY(tuiles));

UPDATE public.roles_acces
SET tuiles = array_remove(tuiles, 'gerant-caissier'), updated_at = NOW()
WHERE role = 'gerant' AND 'gerant-caissier' = ANY(tuiles);
```

- [ ] **Step 3 : vérifier le lint**

Run: `npm run lint`
Expected: 0 erreur.

---

### Task 6 : les contacts fournisseurs pour le RH

**Files:**
- Modify: `app/contacts.js:31`

- [ ] **Step 1 : ouvrir l'onglet**

```js
const onglets = isRH ? ['Équipe', 'Fournisseurs'] : ONGLETS
```

L'onglet actif par défaut reste `'Équipe'`. Les fournisseurs sont déjà chargés par le `useEffect` existant ; l'envoi SMS / WhatsApp groupé fonctionne sans changement.

- [ ] **Step 2 : vérifier le lint**

Run: `npm run lint`
Expected: 0 erreur.

---

### Task 7 : vérifications finales

- [ ] **Step 1 : lint**

Run: `npm run lint`
Expected: 0 erreur (les 71 warnings préexistants restent).

- [ ] **Step 2 : suite de tests complète**

Run: `for f in lib/*.test.mjs; do node "$f"; done`
Expected: aucun échec.

- [ ] **Step 3 : relecture du rendu**

Vérifier à la lecture du code : trois journées toujours présentes, journée vide annoncée, badge « Sans explication » seulement si écart non nul et explication absente, aucun bouton d'action dans le nouvel écran.

- [ ] **Step 4 : commit — seulement après accord de l'utilisateur**

```bash
git add lib/pointCaissier.js lib/pointCaissier.test.mjs lib/detailShift.js \
        components/DetailShiftCaissier.js app/point-caissier.js app/point-shift.js \
        lib/menus.js app/contacts.js supabase_point_caissier.sql \
        docs/superpowers/specs/2026-09-25-point-caissier-design.md \
        docs/superpowers/plans/2026-09-25-point-caissier.md
git commit -m "feat(gerant): écran Point caissier et contacts fournisseurs pour le RH"
```

Rappeler à l'utilisateur que **`supabase_point_caissier.sql` doit être passée en base**, sinon les gérants ne voient aucun changement. Aucun déploiement Vercel ni OTA sans demande explicite.
