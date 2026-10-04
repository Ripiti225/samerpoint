# Accueil gérant modernisé — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le gérant a le même accueil moderne que le manager, centré sur son restaurant : bandeau du jour (point d'hier, ventes d'hier + évolution, demandes), accès directs, bandeaux dépliants.

**Architecture:** `AccueilManager` devient l'accueil de tous les rôles « bureau » + gérant : la configuration (accès directs, bandeaux) se choisit par rôle dans `lib/groupesAccueil.js`, les calculs du bandeau sont purs dans `lib/accueilGerant.js`, le bandeau a son fichier `components/accueil/BandeauGerant.js`.

**Tech Stack:** Expo Router (React Native / Web), Supabase, `node:test`.

Spec : `docs/superpowers/specs/2026-10-04-accueil-gerant-design.md`

## Global Constraints

- Français ; montants en FCFA (`toLocaleString('fr-FR')`).
- La liste des écrans du gérant ne change pas (Paramètres) ; seuls ceux de sa liste s'affichent.
- `verrouSiPointValide` : un écran verrouillé reste verrouillé (`t.bloque`).
- Accueil caissier inchangé.
- Imports `.js` dans les fichiers de `lib/` testés par `node:test`.
- `npm run lint` : 0 erreur ; tous les `lib/*.test.mjs` verts ; `npx expo export -p web` OK.
- Commit + push à chaque tâche ; fin de message `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de publication (Vercel/EAS) sans accord.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/groupesAccueil.js` | `FAVORIS_GERANT`, `GROUPES_GERANT`, icônes, `organiserAccueil(tuiles, role)`, `groupeDeTuile(id, role)` |
| `lib/hierAccueil.js` | + `evolutionsHier(...)` (partie « ↑ x % vs … » seule) |
| `lib/accueilGerant.js` (nouveau) | `etatPointHier`, `texteDemandes` |
| `components/accueil/Indicateur.js` (nouveau) | petite ligne icône + texte, sortie d'AccueilManager |
| `components/accueil/BandeauGerant.js` (nouveau) | bandeau du jour du gérant |
| `components/accueil/AccueilManager.js` | prop `restaurantId`, état du jour gérant, configuration par rôle |
| `app/accueil.js` | le gérant passe par `AccueilManager`, ancien bandeau de corrections retiré |

---

### Task 1: Configuration gérant (`lib/groupesAccueil.js`)

**Produces:** `FAVORIS_GERANT = ['ventes', 'deductions-gerant', 'credits-fournisseurs']` ; `GROUPES_GERANT` (journee, depenses, equipe, clients) ; `organiserAccueil(tuiles, role) → { favoris, groupes, autres }` ; `organiserAccueilAdmin(tuiles)` = `organiserAccueil(tuiles, 'manager')` (gardé) ; `groupeDeTuile(id, role = 'manager')`.

- [ ] **Step 1: Tests (échec attendu)** — ajouter à `lib/groupesAccueil.test.mjs` (et `organiserAccueil` à l'import) :

```js
describe('organiserAccueil — gérant', () => {
  const t = ids => ids.map(id => ({ id }))
  test('accès directs dans l’ordre, seulement ceux de sa liste', () => {
    const r = organiserAccueil(t(['credits-fournisseurs', 'contacts', 'ventes']), 'gerant')
    assert.deepEqual(r.favoris.map(x => x.id), ['ventes', 'credits-fournisseurs'])
  })
  test('bandeaux dans l’ordre, vides retirés, écran inconnu dans « Autres »', () => {
    const r = organiserAccueil(t(['documents', 'contacts', 'ventes', 'demandes', 'nouvel-ecran']), 'gerant')
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(x => x.id)]), [
      ['journee', ['ventes']], ['equipe', ['demandes', 'documents']], ['clients', ['contacts']],
    ])
    assert.deepEqual(r.autres.map(x => x.id), ['nouvel-ecran'])
  })
  test('le manager garde sa configuration', () => {
    assert.deepEqual(organiserAccueil(t(['tresorerie']), 'manager').favoris.map(x => x.id), ['tresorerie'])
  })
})
```

Run: `node --test lib/groupesAccueil.test.mjs` → FAIL.

- [ ] **Step 2: Implémentation** — dans `lib/groupesAccueil.js`, après `GROUPES_ADMIN` :

```js
// Accueil gérant : son restaurant, ses écrans du jour (liste réglée dans
// Paramètres ; seuls ceux qu'il a s'affichent).
// Le Tableau de bord n'est pas accessible aux gérants.
export const FAVORIS_GERANT = ['ventes', 'deductions-gerant', 'credits-fournisseurs']

export const GROUPES_GERANT = [
  { id: 'journee', icone: 'calendar-today', couleur: '#E07B00', fonce: '#B45309', titre: 'Journée',
    tuiles: ['ventes', 'livraisons', 'point-caissier', 'gerant-caissier'] },
  { id: 'depenses', icone: 'cash-minus', couleur: '#0E9F6E', fonce: '#047857', titre: 'Dépenses',
    tuiles: ['deductions-gerant', 'credits-fournisseurs', 'depenses', 'fournisseurs'] },
  { id: 'equipe', icone: 'account-group', couleur: '#2F7FD8', fonce: '#1D5FB0', titre: 'Équipe',
    tuiles: ['demandes', 'demandes-explication', 'presences', 'documents'] },
  { id: 'clients', icone: 'star-face', couleur: '#D53F8C', fonce: '#B0306F', titre: 'Clients',
    tuiles: ['contacts', 'avis-plateformes'] },
]
```

Ajouter à `ICONES_TUILES` :

```js
  'ventes': 'cash-register',
  'dashboard': 'view-dashboard-outline',
  'livraisons': 'moped',
  'gerant-caissier': 'account-cash-outline',
  'deductions-gerant': 'cash-minus',
  'demandes': 'inbox-arrow-down',
  'demandes-explication': 'email-alert',
  'point-shift': 'timer-outline',
  'depenses': 'receipt-text-minus',
  'fournisseurs': 'truck-delivery',
  'inventaire': 'clipboard-list-outline',
  'presences': 'account-check',
```

Remplacer `groupeDeTuile` et `organiserAccueilAdmin` par :

```js
const config = role => (role === 'gerant'
  ? { favoris: FAVORIS_GERANT, groupes: GROUPES_GERANT }
  : { favoris: FAVORIS_ADMIN, groupes: GROUPES_ADMIN })

// Groupe d'une tuile (couleurs de l'accès direct).
export function groupeDeTuile(id, role = 'manager') {
  return config(role).groupes.find(g => g.tuiles.includes(id)) || { couleur: '#6C63E0', fonce: '#4F46C8' }
}

export function organiserAccueil(tuiles = [], role = 'manager') {
  const { favoris, groupes } = config(role)
  const parId = Object.fromEntries((tuiles || []).map(t => [t.id, t]))
  const ranges = new Set(groupes.flatMap(g => g.tuiles))
  return {
    favoris: favoris.map(id => parId[id]).filter(Boolean),
    groupes: groupes
      .map(g => ({ ...g, tuiles: g.tuiles.map(id => parId[id]).filter(Boolean) }))
      .filter(g => g.tuiles.length),
    autres: (tuiles || []).filter(t => !ranges.has(t.id)),
  }
}

export const organiserAccueilAdmin = tuiles => organiserAccueil(tuiles, 'manager')
```

(Supprimer l'ancienne `organiserAccueilAdmin` et son en-tête doc au profit de celles-ci ; garder le commentaire d'en-tête du fichier en ajoutant « et gérant ».)

- [ ] **Step 3:** `node --test lib/groupesAccueil.test.mjs` → PASS ; `npx eslint lib/groupesAccueil.js` → 0 erreur.
- [ ] **Step 4: Commit** — `feat(accueil): configuration de l'accueil gérant (accès directs, bandeaux)`.

---

### Task 2: Calculs du bandeau gérant

**Produces:** `evolutionsHierDetail({ hier, avantHier, semainePrec }, dateHier) → Array<{ texte, sens: 'hausse'|'baisse'|'egal' }>` et `evolutionsHier(...) → string` (`lib/hierAccueil.js`) ; `etatPointHier({ point, nbCorrections }) → { cle: 'corrections'|'verifie'|'valide'|'en_attente'|'absent', texte }` ; `texteDemandes({ demandes, explications }) → string` (`lib/accueilGerant.js`).

- [ ] **Step 1: Tests (échec attendu)** — dans `lib/hierAccueil.test.mjs`, ajouter `evolutionsHier` à l'import et :

```js
describe('evolutionsHier — les flèches seules (ventes du gérant)', () => {
  test('détail : le sens de chaque comparaison, pour la couleur', () => {
    assert.deepEqual(evolutionsHierDetail({ hier: 108, avantHier: 100, semainePrec: 120 }, '2026-10-03'), [
      { texte: '↑ 8 % vs avant-hier', sens: 'hausse' },
      { texte: '↓ 10 % vs sam. dernier', sens: 'baisse' },
    ])
  })
  test('deux comparaisons', () => {
    assert.equal(evolutionsHier({ hier: 108, avantHier: 100, semainePrec: 120 }, '2026-10-03'),
      '↑ 8 % vs avant-hier · ↓ 10 % vs sam. dernier')
  })
  test('rien à comparer : vide', () => {
    assert.equal(evolutionsHier({ hier: 50, avantHier: 0, semainePrec: 0 }, '2026-10-03'), '')
  })
})
```

Créer `lib/accueilGerant.test.mjs` :

```js
// Tests de lib/accueilGerant.js — le bandeau du jour de l'accueil gérant.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { etatPointHier, texteDemandes } from './accueilGerant.js'

describe('etatPointHier', () => {
  test('les corrections demandées passent avant tout', () => {
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: true }, nbCorrections: 2 }),
      { cle: 'corrections', texte: '2 corrections demandées par le manager' })
    assert.equal(etatPointHier({ point: null, nbCorrections: 1 }).texte, '1 correction demandée par le manager')
  })
  test('validé, vérifié, en attente, pas saisi', () => {
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: true }, nbCorrections: 0 }), { cle: 'verifie', texte: "Point d'hier validé et vérifié" })
    assert.deepEqual(etatPointHier({ point: { valide: true, verifie: false } }), { cle: 'valide', texte: "Point d'hier validé" })
    assert.deepEqual(etatPointHier({ point: { valide: false } }), { cle: 'en_attente', texte: "Point d'hier pas encore validé" })
    assert.deepEqual(etatPointHier({ point: null }), { cle: 'absent', texte: "Point d'hier pas encore saisi" })
  })
})

describe('texteDemandes', () => {
  test('singulier, pluriel, zéro', () => {
    assert.equal(texteDemandes({ demandes: 2, explications: 1 }), '2 demandes en attente · 1 explication en cours')
    assert.equal(texteDemandes({ demandes: 1, explications: 0 }), '1 demande en attente')
    assert.equal(texteDemandes({ demandes: 0, explications: 3 }), '3 explications en cours')
    assert.equal(texteDemandes({ demandes: 0, explications: 0 }), 'Aucune demande en attente')
  })
})
```

(Ajouter aussi `evolutionsHierDetail` à l'import.)

Run: `node --test lib/hierAccueil.test.mjs lib/accueilGerant.test.mjs` → FAIL.

- [ ] **Step 2: `evolutionsHier`** — dans `lib/hierAccueil.js`, remplacer le corps de `texteHier` par l'utilisation d'une nouvelle fonction :

```js
const sens = p => (p > 0 ? 'hausse' : p < 0 ? 'baisse' : 'egal')

/** Chaque comparaison avec son sens (hausse en vert, baisse en rouge à l'affichage). */
export function evolutionsHierDetail({ hier, avantHier, semainePrec }, dateHier) {
  const jour = JOURS_COURTS[new Date(`${dateHier}T12:00:00Z`).getUTCDay()]
  const parts = []
  const a = pctEvolution(hier, avantHier)
  const s = pctEvolution(hier, semainePrec)
  if (a !== null && (avantHier || hier)) parts.push({ texte: `${fleche(a)} vs avant-hier`, sens: sens(a) })
  if (s !== null && (semainePrec || hier)) parts.push({ texte: `${fleche(s)} vs ${jour} dernier`, sens: sens(s) })
  return parts
}

/** « ↑ 8 % vs avant-hier · ↓ 10 % vs sam. dernier » ; '' s'il n'y a rien à comparer. */
export function evolutionsHier(valeurs, dateHier) {
  return evolutionsHierDetail(valeurs, dateHier).map(x => x.texte).join(' · ')
}

export function texteHier(valeurs, dateHier, [un, plusieurs] = ['avis', 'avis']) {
  const evo = evolutionsHier(valeurs, dateHier)
  const debut = `Hier : ${valeurs.hier} ${valeurs.hier > 1 ? plusieurs : un}`
  return evo ? `${debut} · ${evo}` : debut
}
```

- [ ] **Step 3: `lib/accueilGerant.js`** :

```js
// ──────────────────────────────────────────────────────────────────────────────
//  ACCUEIL GÉRANT — textes du bandeau du jour (pur, testé)
//  Tests : lib/accueilGerant.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const pl = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`

/** État du point d'hier ; les corrections demandées par le manager passent avant tout. */
export function etatPointHier({ point, nbCorrections = 0 }) {
  if (nbCorrections > 0) {
    return { cle: 'corrections', texte: `${pl(nbCorrections, 'correction demandée', 'corrections demandées')} par le manager` }
  }
  if (!point) return { cle: 'absent', texte: "Point d'hier pas encore saisi" }
  if (point.valide && point.verifie) return { cle: 'verifie', texte: "Point d'hier validé et vérifié" }
  if (point.valide) return { cle: 'valide', texte: "Point d'hier validé" }
  return { cle: 'en_attente', texte: "Point d'hier pas encore validé" }
}

export function texteDemandes({ demandes = 0, explications = 0 }) {
  const parts = []
  if (demandes) parts.push(`${pl(demandes, 'demande', 'demandes')} en attente`)
  if (explications) parts.push(`${pl(explications, 'explication', 'explications')} en cours`)
  return parts.length ? parts.join(' · ') : 'Aucune demande en attente'
}
```

- [ ] **Step 4:** tests → PASS (tous les `lib/*.test.mjs`) ; lint 0 erreur.
- [ ] **Step 5: Commit** — `feat(accueil): textes du bandeau du jour du gérant`.

---

### Task 3: Bandeau gérant + Indicateur partagé

**Produces:** `components/accueil/Indicateur.js` (export default `Indicateur({ icone, couleur, texte, styles })`) ; `components/accueil/BandeauGerant.js` (export default `BandeauGerant({ etat, styles, colors })`, `etat` = `{ hier: Date, point: {cle, texte}, ventes: number|null, ventesEvo: Array<{texte, sens}>, demandes: string, nbDemandes: number }`).

- [ ] **Step 1: Indicateur** — créer `components/accueil/Indicateur.js` en déplaçant la fonction `Indicateur` d'`AccueilManager.js` :

```js
// Petite ligne d'information du bandeau du jour : icône + texte coloré.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { Text, View } from 'react-native'

export default function Indicateur({ icone, couleur, texte, styles }) {
  return (
    <View style={styles.indicateur}>
      <MaterialCommunityIcons name={icone} size={15} color={couleur} />
      <Text style={[styles.indicateurTxt, { color: couleur }]}>{texte}</Text>
    </View>
  )
}
```

  Dans `AccueilManager.js` : supprimer la fonction locale `Indicateur`, ajouter `import Indicateur from './Indicateur'`.

- [ ] **Step 2: Bandeau** — créer `components/accueil/BandeauGerant.js` :

```jsx
// ──────────────────────────────────────────────────────────────────────────────
//  Bandeau du jour de l'accueil gérant : son restaurant, la journée d'hier.
//  Point d'hier (corrections en premier), ventes d'hier et leur évolution,
//  demandes de son équipe. Textes : lib/accueilGerant.js, lib/hierAccueil.js.
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router } from 'expo-router'
import { Text, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import Survol from '../ui/Survol'
import Indicateur from './Indicateur'

const fcfa = n => Math.round(n || 0).toLocaleString('fr-FR')

export default function BandeauGerant({ etat, styles, colors }) {
  const { hier, point, ventes, ventesEvo, demandes, nbDemandes } = etat
  const pointUi = {
    corrections: { icone: 'pencil-alert', couleur: colors.error, route: '/correction-point' },
    verifie: { icone: 'check-decagram', couleur: colors.success },
    valide: { icone: 'check-circle', couleur: colors.success },
    en_attente: { icone: 'clock-outline', couleur: colors.warningDark },
    absent: { icone: 'clock-alert-outline', couleur: colors.textMuted },
  }[point.cle]

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <View style={styles.bandeau}>
        <Text style={styles.bandeauLabel}>
          Hier · {hier.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>

        <View style={styles.bandeauHaut}>
          <View style={{ flex: 1 }}>
            {ventes != null ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={[styles.bandeauGrand, { color: colors.text }]}>{fcfa(ventes)}</Text>
                  <Text style={styles.bandeauUnite}>F de ventes</Text>
                </View>
                {ventesEvo.length ? (
                  <Text style={styles.bandeauUnite}>
                    {ventesEvo.map((e, i) => (
                      <Text key={e.texte} style={{ fontWeight: '700', color: e.sens === 'hausse' ? colors.success : e.sens === 'baisse' ? colors.error : colors.textMuted }}>
                        {i ? ' · ' : ''}{e.texte}
                      </Text>
                    ))}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.bandeauUnite}>Pas encore de ventes pour hier</Text>
            )}
          </View>
          <MaterialCommunityIcons name="cash-register" size={34} color={colors.primary} />
        </View>

        <View style={styles.bandeauTreso}>
          {pointUi.route ? (
            <Survol onPress={() => router.push(pointUi.route)} accessibilityRole="button" hitSlop={6}
              accessibilityLabel={`${point.texte}. Ouvrir les corrections.`} style={styles.lienTreso} echelle={1.02}
              styleSurvol={{ backgroundColor: pointUi.couleur + '14' }}>
              <Indicateur icone={pointUi.icone} couleur={pointUi.couleur} texte={point.texte} styles={styles} />
              <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
            </Survol>
          ) : (
            <Indicateur icone={pointUi.icone} couleur={pointUi.couleur} texte={point.texte} styles={styles} />
          )}
          <Survol onPress={() => router.push('/demandes')} accessibilityRole="button" hitSlop={6}
            accessibilityLabel={`${demandes}. Ouvrir les demandes.`} style={styles.lienTreso} echelle={1.02}
            styleSurvol={{ backgroundColor: colors.primary + '14' }}>
            <Indicateur icone={nbDemandes ? 'inbox-arrow-down' : 'inbox'} couleur={nbDemandes ? colors.primary : colors.textMuted}
              texte={demandes} styles={styles} />
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
          </Survol>
        </View>
      </View>
    </Animated.View>
  )
}
```

- [ ] **Step 3:** `npx eslint components/accueil/` → 0 erreur.
- [ ] **Step 4: Commit** — `feat(accueil): bandeau du jour du gérant`.

---

### Task 4: Brancher dans l'accueil

**Consumes:** Tasks 1–3, `texteHier`, `evolutionsHierDetail`, `chargerContactsPeriode`, `totalParJour`.

- [ ] **Step 1: `AccueilManager.js` — chargement gérant.** `useEtatDuJour(role, userId, restaurantId)` ; dans `charger`, **au début** du `try` (après le calcul de `hier`, `avantHier`, `semainePrec`), si `role === 'gerant'` : charger et `setEtat` puis `return` :

```js
      if (role === 'gerant') {
        if (!restaurantId) return
        const dates = [isoLocal(hier), isoLocal(avantHier), isoLocal(semainePrec)]
        const nbAvisResto = jour => supabase.from('platform_reviews').select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId).eq('review_date', isoLocal(jour)).then(x => (x.error ? 0 : x.count || 0))
        const [pts, corr, dem, expl, aH, aAH, aSP, contactsJours] = await Promise.all([
          supabase.from('points').select('date, valide, verifie, vente_total').eq('restaurant_id', restaurantId).in('date', dates),
          supabase.from('deverouillages_points').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('statut', 'ouvert'),
          supabase.from('demandes').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('statut', 'en_attente'),
          supabase.from('demandes_explication').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId)
            .in('statut', ['en_attente_acceptation', 'acceptee', 'envoyee']),
          nbAvisResto(hier), nbAvisResto(avantHier), nbAvisResto(semainePrec),
          chargerContactsPeriode({ debut: isoLocal(semainePrec), fin: isoLocal(hier), restoId: restaurantId })
            .then(c => totalParJour(c.lignes, 'contacts')).catch(() => null),
        ])
        if (pts.error) return
        const parDate = Object.fromEntries((pts.data || []).map(p => [p.date, p]))
        const vente = d => (parDate[d] ? Number(parDate[d].vente_total) || 0 : 0)
        const nbDem = dem.error ? 0 : dem.count || 0
        const nbExpl = expl.error ? 0 : expl.count || 0
        setEtat({
          hier,
          gerant: {
            hier,
            point: etatPointHier({ point: parDate[dates[0]] || null, nbCorrections: corr.error ? 0 : corr.count || 0 }),
            ventes: parDate[dates[0]] ? vente(dates[0]) : null,
            ventesEvo: parDate[dates[0]] ? evolutionsHierDetail({ hier: vente(dates[0]), avantHier: vente(dates[1]), semainePrec: vente(dates[2]) }, dates[0]) : [],
            demandes: texteDemandes({ demandes: nbDem, explications: nbExpl }),
            nbDemandes: nbDem + nbExpl,
          },
          avisHier: texteHier({ hier: aH, avantHier: aAH, semainePrec: aSP }, dates[0]),
          contactsHier: contactsJours === null ? null : texteHier({
            hier: contactsJours[dates[0]] || 0, avantHier: contactsJours[dates[1]] || 0, semainePrec: contactsJours[dates[2]] || 0,
          }, dates[0], ['contact', 'contacts']),
        })
        return
      }
```

  (Déplacer les déclarations de `avantHier` et `semainePrec` avant ce bloc ; ajouter `restaurantId` aux dépendances du `useCallback`.)
  Imports : `etatPointHier, texteDemandes` de `../../lib/accueilGerant`, `evolutionsHierDetail` à côté de `texteHier`, `BandeauGerant` de `./BandeauGerant`, `organiserAccueil` à la place de `organiserAccueilAdmin`.

- [ ] **Step 2: `AccueilManager.js` — rendu.** Signature `AccueilManager({ items, role, userId, restaurantId })` ; `useEtatDuJour(role, userId, restaurantId)` ; `organiserAccueil(tuilesVivantes, role)` ; `groupeDeTuile(t.id, role)` ; bandeau :

```jsx
      {etat && (role === 'gerant'
        ? (etat.gerant ? <BandeauGerant etat={etat.gerant} styles={styles} colors={colors} /> : null)
        : role === 'rh'
          ? <BandeauRH etat={etat} styles={styles} colors={colors} />
          : <BandeauPoints etat={etat} styles={styles} colors={colors} />)}
```

- [ ] **Step 3: `app/accueil.js`.** Remplacer `(isManager || isDirecteur || isRH)` par `(isManager || isDirecteur || isRH || isGerant)` et passer `restaurantId={restaurantId}` à `AccueilManager` ; supprimer le bloc `{isGerant && nbCorrections > 0 && (…)}`, l'état `nbCorrections` et l'effet « Gérant : charger les corrections en attente » (repris dans le bandeau) ; retirer les styles `correctionBanner*` s'ils ne servent plus.

- [ ] **Step 3b: Couleurs.** Dans `app/accueil.js`, le gérant prend les couleurs du manager : `getHeaderColor`, `getRoleBadgeBg`, `getRoleBadgeText` et `getHeaderTextColor` traitent `isGerant` comme `isManager || isDirecteur` (violet `#534AB7`, texte blanc) ; le caissier garde l'orange. Dans `AccueilManager.js`, ajouter `const ORANGE_HERO = '#F47B0F'` à côté de `VERT_HERO` et, pour le gérant, surcharger la grande tuile : `style={[styles.hero, role === 'gerant' && { backgroundColor: ORANGE_HERO, shadowColor: ORANGE_HERO }]}`.

- [ ] **Step 4:** `npm run lint` (0 erreur), tous les tests, `npx expo export -p web` OK.
- [ ] **Step 5: Commit** — `feat(accueil): le gérant a l'accueil modernisé — bandeau de son restaurant, accès directs, bandeaux`.

---

### Task 5: Vérification avec Ange (localhost)

- [ ] Se connecter en **gérant** sur `http://localhost:8081` : bandeau (point d'hier, ventes + flèches vertes/rouges, demandes), accès directs, bandeaux Journée / Dépenses / Équipe / Clients (lignes Avis et Contacts du restaurant), écrans verrouillés si point validé.
- [ ] Se connecter en **manager** : accueil inchangé.
- [ ] `graphify update .`, commit `chore(graphify): graphe à jour`, push ; résumé en français simple.
