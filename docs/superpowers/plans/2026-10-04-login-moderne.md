# Page de connexion modernisée — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moderniser `app/login.js` : style C (clair) / B (sombre), « téléphone reconnu » (code restaurant une seule fois), Face ID intégré en lignes de comptes et en touche 🔐 du clavier.

**Architecture:** Logique pure testée dans `lib/restosReconnus.js` (signature FNV-1a, liste des restaurants reconnus, écran de départ). Stockage AsyncStorage dans `lib/restosReconnusStockage.js`. Rendu découpé dans `components/login/*` ; `app/login.js` ne garde que l'état et l'enchaînement.

**Tech Stack:** Expo 54 / React Native + react-native-web, expo-router, react-native-reanimated, AsyncStorage, `node:test` pour les tests purs.

## Global Constraints

- Aucun nouveau module natif (pas de `expo-linear-gradient`) : déploiement OTA uniquement. Les dégradés passent par le DOM sur le web (`el.style.backgroundImage`), couleur unie sur natif.
- Textes en français, cibles tactiles ≥ 48 px.
- Clair : bandeau `#F5A623 → #E07B14`, fond `#FAF8F5`. Sombre : `radial-gradient(120% 60% at 50% 0%, #2A2116 0%, #0E0E12 62%)`, accent `#F5B13D`.
- Couleurs : gérant `#F0A020`, rôles globaux `#5B52C8`, vérificateur `#0E8A6B`, autres `#9A9AA8` ; restaurant `couleur === 'vert'` → `#1FAD6B` sinon `#F0A020`.
- Inchangé : vérification des codes (`=== String(pin)`), blocage 3 essais → 30 s (clés `sam_lockout_resto_*` / `sam_lockout_user_*`), `lib/biometrie.js`, `separerComptesPOS`, `ouvrirSession`, déverrouillage de session.
- Tests : `for f in lib/*.test.mjs; do node "$f"; done` ; lint : `npm run lint` (0 erreur) ; `npx expo export -p web`.
- Git : `DEVELOPER_DIR=/Library/Developer/CommandLineTools` ; commits conventionnels en français + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Après chaque commit de code : `graphify update .` puis commit `chore(graphify): graphe à jour`.

---

### Task 1: Règles « téléphone reconnu » (logique pure)

**Files:**
- Create: `lib/restosReconnus.js`
- Test: `lib/restosReconnus.test.mjs`

**Interfaces:**
- Produces:
  - `signatureResto(restaurant) → string` (8 hex)
  - `normaliserReconnus(brut) → Array<{restaurantId, signature}>`
  - `estReconnu(liste, restaurant) → boolean`
  - `ajouterReconnu(liste, restaurant) → liste`
  - `nettoyerReconnus(liste, restaurants) → liste` (oublie ceux dont le code a changé)
  - `trierRestaurants(restaurants, liste) → restaurants` (reconnus d'abord)
  - `ecranDeDepart({ valides, enrolements, verrouille }) → { ecran: 'accueil' } | { ecran: 'quiEtesVous', restaurant }`

- [ ] **Step 1: Write the failing test**

```js
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const {
  signatureResto, normaliserReconnus, estReconnu, ajouterReconnu,
  nettoyerReconnus, trierRestaurants, ecranDeDepart,
} = await import('./restosReconnus.js')

const angre = { id: 'r1', nom: 'Angré 7E', pin: '9073' }
const palm = { id: 'r2', nom: 'Palmeraie', pin: '1188' }

describe('signature du code restaurant', () => {
  test('stable, et change avec le code', () => {
    assert.equal(signatureResto(angre), signatureResto({ ...angre }))
    assert.equal(signatureResto({ ...angre, pin: 9073 }), signatureResto(angre))
    assert.notEqual(signatureResto({ ...angre, pin: '9074' }), signatureResto(angre))
    assert.match(signatureResto(angre), /^[0-9a-f]{8}$/)
  })
})

describe('liste des restaurants reconnus', () => {
  test('format illisible → liste vide', () => {
    assert.deepEqual(normaliserReconnus(null), [])
    assert.deepEqual(normaliserReconnus('x'), [])
    assert.deepEqual(normaliserReconnus([{ restaurantId: 'r1' }, null]), [])
  })

  test('reconnu après ajout, plus reconnu si le code change', () => {
    const liste = ajouterReconnu([], angre)
    assert.equal(estReconnu(liste, angre), true)
    assert.equal(estReconnu(liste, palm), false)
    assert.equal(estReconnu(liste, { ...angre, pin: '0000' }), false)
    assert.equal(estReconnu(liste, null), false)
  })

  test('ré-ajouter remplace sans doublon', () => {
    const liste = ajouterReconnu(ajouterReconnu([], angre), { ...angre, pin: '5555' })
    assert.equal(liste.length, 1)
    assert.equal(estReconnu(liste, { ...angre, pin: '5555' }), true)
  })

  test('nettoyer oublie un code changé, garde un restaurant absent (hors ligne)', () => {
    const liste = ajouterReconnu(ajouterReconnu([], angre), palm)
    const net = nettoyerReconnus(liste, [{ ...angre, pin: '0000' }])
    assert.deepEqual(net.map(r => r.restaurantId), ['r2'])
  })

  test('les restaurants reconnus passent en premier, ordre conservé sinon', () => {
    const c = { id: 'r3', nom: 'Cocody', pin: '1' }
    const liste = ajouterReconnu([], c)
    assert.deepEqual(trierRestaurants([angre, palm, c], liste).map(r => r.id), ['r3', 'r1', 'r2'])
  })
})

describe('écran de départ', () => {
  test('un seul restaurant reconnu, pas de Face ID ailleurs → ouverture directe', () => {
    const r = ecranDeDepart({ valides: [angre], enrolements: [{ userId: 'u1', restaurantId: 'r1' }], verrouille: false })
    assert.deepEqual(r, { ecran: 'quiEtesVous', restaurant: angre })
  })

  test('Face ID administration présent → accueil', () => {
    const r = ecranDeDepart({ valides: [angre], enrolements: [{ userId: 'm1', restaurantId: null }], verrouille: false })
    assert.equal(r.ecran, 'accueil')
  })

  test('zéro ou plusieurs restaurants reconnus → accueil', () => {
    assert.equal(ecranDeDepart({ valides: [], enrolements: [], verrouille: false }).ecran, 'accueil')
    assert.equal(ecranDeDepart({ valides: [angre, palm], enrolements: [], verrouille: false }).ecran, 'accueil')
  })

  test('session verrouillée → le flux de verrouillage garde la main', () => {
    assert.equal(ecranDeDepart({ valides: [angre], enrolements: [], verrouille: true }).ecran, 'accueil')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node lib/restosReconnus.test.mjs`
Expected: FAIL (`Cannot find module './restosReconnus.js'`)

- [ ] **Step 3: Write minimal implementation**

```js
// ─────────────────────────────────────────────────────────────────────────
//  TÉLÉPHONE RECONNU — le code restaurant n'est demandé qu'une fois
//
//  Après un code restaurant juste, l'appareil mémorise { restaurantId,
//  signature } ; ce restaurant s'ouvre ensuite directement sur « Qui
//  êtes-vous ? ». La signature (FNV-1a de « id|pin ») change avec le code :
//  un code modifié redemande le code sur tous les téléphones.
//  Le PIN restaurant est déjà en clair dans le cache hors ligne : cette
//  empreinte n'abaisse pas le niveau de sécurité. Stockage :
//  lib/restosReconnusStockage.js.
// ─────────────────────────────────────────────────────────────────────────

export function signatureResto(restaurant) {
  const texte = `${restaurant?.id ?? ''}|${String(restaurant?.pin ?? '')}`
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function normaliserReconnus(brut) {
  if (!Array.isArray(brut)) return []
  return brut.filter(r => r && typeof r === 'object' && r.restaurantId && r.signature)
}

export function estReconnu(liste, restaurant) {
  if (!restaurant) return false
  const sig = signatureResto(restaurant)
  return liste.some(r => r.restaurantId === restaurant.id && r.signature === sig)
}

export function ajouterReconnu(liste, restaurant) {
  return [
    ...liste.filter(r => r.restaurantId !== restaurant.id),
    { restaurantId: restaurant.id, signature: signatureResto(restaurant) },
  ]
}

// Un restaurant absent de la liste chargée (hors ligne, cache vide) est
// gardé : on n'oublie que ceux dont on VOIT que le code a changé.
export function nettoyerReconnus(liste, restaurants) {
  return liste.filter(r => {
    const resto = restaurants.find(x => x.id === r.restaurantId)
    return !resto || r.signature === signatureResto(resto)
  })
}

export function trierRestaurants(restaurants, liste) {
  const oui = restaurants.filter(r => estReconnu(liste, r))
  const non = restaurants.filter(r => !estReconnu(liste, r))
  return [...oui, ...non]
}

// Ouverture directe seulement si elle ne cache rien : un seul restaurant
// reconnu, et aucun compte Face ID ailleurs (ex. Administration).
export function ecranDeDepart({ valides, enrolements, verrouille }) {
  if (verrouille || valides.length !== 1) return { ecran: 'accueil' }
  const restaurant = valides[0]
  const ailleurs = enrolements.some(e => (e.restaurantId ?? null) !== restaurant.id)
  return ailleurs ? { ecran: 'accueil' } : { ecran: 'quiEtesVous', restaurant }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node lib/restosReconnus.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Add the storage module**

Create `lib/restosReconnusStockage.js`:

```js
// Lecture / écriture de la liste des restaurants reconnus (web et natif).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normaliserReconnus } from './restosReconnus'

const CLE = 'samerpoint_restos_reconnus'

export async function lireReconnus() {
  try {
    const brut = await AsyncStorage.getItem(CLE)
    return normaliserReconnus(brut ? JSON.parse(brut) : null)
  } catch {
    return []
  }
}

export async function ecrireReconnus(liste) {
  try { await AsyncStorage.setItem(CLE, JSON.stringify(liste)) } catch {}
  return liste
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/restosReconnus.js lib/restosReconnus.test.mjs lib/restosReconnusStockage.js
git commit -m "feat(login): règles du téléphone reconnu (code restaurant une seule fois)"
```

---

### Task 2: Thème et briques visuelles communes

**Files:**
- Create: `components/login/themeLogin.js`
- Create: `components/login/CadreLogin.js`

**Interfaces:**
- Produces:
  - `themeLogin(isDark) → t` (tokens : `sombre, fond, texte, texteDoux, texteFaible, carte, carteBord, touche, toucheAppui, accent, bandeauUni, texteBandeau, sousBandeau, erreur, global, globalBord, globalTexte`)
  - `initiales(nom)`, `prenom(nom)`, `couleurRole(role)`, `libelleRole(role)`, `couleurResto(restaurant)`
  - `<FondLogin t>` (SafeAreaView plein écran), `<EnteteLogin t sousTitre compact>` (bandeau + logo), `<Avatar nom couleur taille badge>`

- [ ] **Step 1: Write `components/login/themeLogin.js`**

```js
// Palettes de l'écran de connexion : style C en clair (bandeau orange),
// style B en sombre (noir chaud, verre fumé). Choix validé le 2026-10-04.
import { ROLES_GLOBAUX } from '../../lib/constants'

export const ORANGE = '#F0A020'
export const VIOLET = '#5B52C8'
export const VERT = '#1FAD6B'

export const DEGRADE_BANDEAU = 'linear-gradient(150deg, #F5A623 0%, #E07B14 100%)'
export const DEGRADE_SOMBRE = 'radial-gradient(120% 60% at 50% 0%, #2A2116 0%, #0E0E12 62%)'

export function themeLogin(isDark) {
  if (isDark) {
    return {
      sombre: true,
      fond: '#0E0E12',
      texte: '#F3F1EC',
      texteDoux: 'rgba(243,241,236,0.68)',
      texteFaible: 'rgba(243,241,236,0.45)',
      carte: 'rgba(255,255,255,0.06)',
      carteBord: 'rgba(255,255,255,0.09)',
      touche: 'rgba(255,255,255,0.07)',
      toucheAppui: 'rgba(255,255,255,0.16)',
      accent: '#F5B13D',
      bandeauUni: null,
      texteBandeau: '#F5B13D',
      sousBandeau: 'rgba(243,241,236,0.72)',
      erreur: '#FF7A7A',
      global: 'rgba(91,82,200,0.18)',
      globalBord: 'rgba(140,130,255,0.3)',
      globalTexte: '#C9C4FF',
    }
  }
  return {
    sombre: false,
    fond: '#FAF8F5',
    texte: '#1B1B22',
    texteDoux: '#5C5C6B',
    texteFaible: '#8E8E9C',
    carte: '#FFFFFF',
    carteBord: '#EFEBE4',
    touche: '#FFFFFF',
    toucheAppui: '#F3EEE6',
    accent: ORANGE,
    bandeauUni: '#EE8E1C',
    texteBandeau: '#FFFFFF',
    sousBandeau: 'rgba(255,255,255,0.9)',
    erreur: '#E04848',
    global: '#F1F0FF',
    globalBord: '#DEDBFF',
    globalTexte: '#4A42B5',
  }
}

export function initiales(nom) {
  return String(nom || '').split(' ').filter(Boolean).map(m => m[0]).join('').slice(0, 2).toUpperCase()
}

export function prenom(nom) {
  return String(nom || '').split(' ').filter(Boolean)[0] || ''
}

export function couleurRole(role) {
  if (role === 'gerant') return ORANGE
  if (role === 'verificateur') return '#0E8A6B'
  if (ROLES_GLOBAUX.includes(role)) return VIOLET
  return '#9A9AA8'
}

export function libelleRole(role) {
  if (role === 'manager') return 'Manager'
  if (role === 'rh') return 'RH'
  if (role === 'directeur') return 'Directeur'
  if (role === 'verificateur') return 'Vérificateur'
  if (role === 'gerant') return 'Gérant'
  return 'Caissier'
}

export function couleurResto(restaurant) {
  return restaurant?.couleur === 'vert' ? VERT : ORANGE
}
```

- [ ] **Step 2: Write `components/login/CadreLogin.js`**

```js
// Fond, bandeau et avatar partagés par les écrans de connexion.
// Pas de module natif de dégradé (OTA uniquement) : sur le web le dégradé
// est posé directement sur l'élément DOM, sur natif on garde une couleur unie.
import { Image, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { DEGRADE_BANDEAU, DEGRADE_SOMBRE } from './themeLogin'

function poserDegrade(degrade) {
  return (el) => {
    if (Platform.OS === 'web' && el?.style) el.style.backgroundImage = degrade
  }
}

export function FondLogin({ t, children }) {
  return (
    <SafeAreaView
      ref={t.sombre ? poserDegrade(DEGRADE_SOMBRE) : undefined}
      style={[styles.fond, { backgroundColor: t.fond }]}
    >
      {children}
    </SafeAreaView>
  )
}

export function EnteteLogin({ t, sousTitre, compact }) {
  return (
    <View
      ref={t.sombre ? undefined : poserDegrade(DEGRADE_BANDEAU)}
      style={[
        styles.bandeau,
        compact && styles.bandeauCompact,
        { backgroundColor: t.bandeauUni || 'transparent' },
      ]}
    >
      <View style={[styles.logoTuile, compact && styles.logoTuileCompact]}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      </View>
      {!!sousTitre && <Text style={[styles.sousTitre, { color: t.sousBandeau }]}>{sousTitre}</Text>}
    </View>
  )
}

export function Avatar({ nom, initialesTexte, couleur, taille = 52, badge, t }) {
  return (
    <View style={{ width: taille, height: taille }}>
      <View style={[
        styles.avatar,
        { width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur },
      ]}>
        <Text style={[styles.avatarTxt, { fontSize: taille * 0.32 }]}>{initialesTexte}</Text>
      </View>
      {badge && (
        <View style={[styles.badge, { backgroundColor: t.sombre ? '#1E1A14' : '#FFFFFF' }]}>
          <Text style={styles.badgeTxt}>🔐</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fond:             { flex: 1 },
  bandeau:          { width: '100%', alignItems: 'center', paddingTop: 28, paddingBottom: 46,
                      borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  bandeauCompact:   { paddingTop: 18, paddingBottom: 40 },
  logoTuile:        { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
                      shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  logoTuileCompact: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  logo:             { width: 120, height: 64 },
  sousTitre:        { fontSize: 14, fontWeight: '600', marginTop: 10, letterSpacing: 0.2 },
  avatar:           { alignItems: 'center', justifyContent: 'center' },
  avatarTxt:        { color: '#FFFFFF', fontWeight: '700' },
  badge:            { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
                      alignItems: 'center', justifyContent: 'center' },
  badgeTxt:         { fontSize: 12 },
})
```

- [ ] **Step 3: Lint the two files**

Run: `npx eslint components/login`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add components/login/themeLogin.js components/login/CadreLogin.js
git commit -m "feat(login): thème clair/sombre et bandeau de la nouvelle connexion"
```

---

### Task 3: Écran d'accueil (comptes Face ID + restaurants)

**Files:**
- Create: `components/login/AccueilLogin.js`

**Interfaces:**
- Consumes: `themeLogin` helpers, `FondLogin`, `EnteteLogin`, `Avatar` (Task 2) ; `SignatureFooter`.
- Produces: `<AccueilLogin t restaurants chargement reconnusIds enrolements bioSupportee bioEnCours bioMessage onFaceID(e) onRetirerFaceID(e) onResto(r) onGlobal />`

- [ ] **Step 1: Write the component**

```js
// Premier écran : comptes Face ID du téléphone, puis restaurants (reconnus
// d'abord), puis l'accès Manager / RH.
import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { Avatar, EnteteLogin, FondLogin } from './CadreLogin'
import { couleurResto, initiales, VIOLET, ORANGE } from './themeLogin'

function LigneCompte({ t, e, enCours, modeRetrait, onPress }) {
  const admin = !e.restaurantId
  return (
    <TouchableOpacity
      style={[styles.ligne, { backgroundColor: t.carte, borderColor: t.carteBord }, enCours && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={enCours}
      activeOpacity={0.85}
    >
      <Avatar t={t} initialesTexte={initiales(e.userNom)} couleur={admin ? VIOLET : ORANGE} taille={40} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.ligneNom, { color: t.texte }]} numberOfLines={1}>{e.userNom}</Text>
        <Text style={[styles.ligneSous, { color: t.texteDoux }]} numberOfLines={1}>{e.restaurantNom}</Text>
      </View>
      {modeRetrait
        ? <Text style={[styles.retirer, { color: t.erreur }]}>Retirer</Text>
        : <Text style={styles.cadenas}>{enCours ? '…' : '🔐'}</Text>}
    </TouchableOpacity>
  )
}

function CarteResto({ t, item, index, reconnu, onPress }) {
  const couleur = couleurResto(item)
  return (
    <Animated.View entering={FadeInUp.delay(index * 60).springify().damping(18)} style={styles.carteWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.carte,
          { backgroundColor: t.carte, borderColor: t.carteBord },
          pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
        ]}
      >
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.restoImg} />
        ) : (
          <View style={[styles.restoImg, styles.restoInit, { backgroundColor: couleur }]}>
            <Text style={styles.restoInitTxt}>{initiales(item.nom)}</Text>
          </View>
        )}
        <Text style={[styles.restoNom, { color: t.texte }]} numberOfLines={2}>{item.nom}</Text>
        <Text style={[styles.restoLoc, { color: t.texteFaible }]} numberOfLines={1}>{item.localisation || 'Abidjan'}</Text>
        {reconnu && <Text style={[styles.reconnu, { color: t.accent }]}>✓ reconnu</Text>}
      </Pressable>
    </Animated.View>
  )
}

export default function AccueilLogin({
  t, restaurants, chargement, reconnusIds, enrolements,
  bioSupportee, bioEnCours, bioMessage, onFaceID, onRetirerFaceID, onResto, onGlobal,
}) {
  const [modeRetrait, setModeRetrait] = useState(false)
  const comptes = bioSupportee ? enrolements : []

  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} sousTitre="Bonjour 👋" />
        <View style={styles.corps}>
          {comptes.length > 0 && (
            <Animated.View entering={FadeInDown.springify().damping(18)}>
              <Text style={[styles.label, { color: t.texteFaible }]}>Vos comptes sur ce téléphone</Text>
              {comptes.map(e => (
                <LigneCompte
                  key={e.credentialId} t={t} e={e} enCours={bioEnCours} modeRetrait={modeRetrait}
                  onPress={() => (modeRetrait ? onRetirerFaceID(e) : onFaceID(e))}
                />
              ))}
              {!!bioMessage && <Text style={[styles.erreur, { color: t.erreur }]}>{bioMessage}</Text>}
              <TouchableOpacity onPress={() => setModeRetrait(m => !m)} style={styles.gerer}>
                <Text style={[styles.gererTxt, { color: t.texteFaible }]}>
                  {modeRetrait ? 'Terminé' : 'Gérer Face ID'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
          {comptes.length === 0 && !!bioMessage && (
            <Text style={[styles.erreur, { color: t.erreur }]}>{bioMessage}</Text>
          )}

          <Text style={[styles.label, { color: t.texteFaible }]}>
            {comptes.length > 0 ? 'Ou choisissez un restaurant' : 'Choisissez votre restaurant'}
          </Text>
          {chargement ? (
            <ActivityIndicator size="large" color={t.accent} style={{ marginTop: 30 }} />
          ) : restaurants.length === 0 ? (
            <Text style={[styles.vide, { color: t.texteFaible }]}>Aucun restaurant trouvé</Text>
          ) : (
            <View style={styles.grille}>
              {restaurants.map((r, i) => (
                <CarteResto key={r.id} t={t} item={r} index={i} reconnu={reconnusIds.includes(r.id)} onPress={() => onResto(r)} />
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.global, { backgroundColor: t.global, borderColor: t.globalBord }]}
            onPress={onGlobal}
            activeOpacity={0.85}
          >
            <Text style={styles.globalIcone}>👑</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.globalTxt, { color: t.globalTexte }]}>Accès Manager / RH</Text>
              <Text style={[styles.globalSous, { color: t.globalTexte }]}>Administration & ressources humaines</Text>
            </View>
            <Text style={[styles.fleche, { color: t.globalTexte }]}>›</Text>
          </TouchableOpacity>
        </View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:      { paddingBottom: 30 },
  corps:       { paddingHorizontal: 16, marginTop: -26, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label:       { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 18, marginBottom: 10, marginLeft: 4 },
  ligne:       { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10,
                 borderRadius: 18, borderWidth: 1, marginBottom: 8,
                 shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  ligneNom:    { fontSize: 15, fontWeight: '700' },
  ligneSous:   { fontSize: 12, marginTop: 2 },
  cadenas:     { fontSize: 22 },
  retirer:     { fontSize: 13, fontWeight: '700' },
  erreur:      { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  gerer:       { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  gererTxt:    { fontSize: 12, textDecorationLine: 'underline' },
  grille:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  carteWrap:   { width: '48.5%', marginBottom: 12 },
  carte:       { borderRadius: 20, borderWidth: 1, padding: 14, alignItems: 'center', minHeight: 150,
                 shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  restoImg:    { width: 72, height: 72, borderRadius: 18, marginBottom: 10 },
  restoInit:   { alignItems: 'center', justifyContent: 'center' },
  restoInitTxt:{ color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  restoNom:    { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  restoLoc:    { fontSize: 11, marginTop: 3, textAlign: 'center' },
  reconnu:     { fontSize: 11, fontWeight: '700', marginTop: 6 },
  vide:        { textAlign: 'center', marginTop: 30, fontSize: 14 },
  global:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1,
                 padding: 16, marginTop: 8, minHeight: 64 },
  globalIcone: { fontSize: 26 },
  globalTxt:   { fontSize: 14, fontWeight: '700' },
  globalSous:  { fontSize: 11, marginTop: 2, opacity: 0.8 },
  fleche:      { fontSize: 22 },
})
```

- [ ] **Step 2: Lint**

Run: `npx eslint components/login`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/login/AccueilLogin.js
git commit -m "feat(login): écran d'accueil — comptes Face ID et restaurants reconnus"
```

---

### Task 4: « Qui êtes-vous ? » en grille d'avatars

**Files:**
- Create: `components/login/QuiEtesVous.js`

**Interfaces:**
- Consumes: Task 2.
- Produces: `<QuiEtesVous t restaurant utilisateurs chargement reconnu idsFaceID reprisParLePOS onChoisir(u) onRetour />` — `restaurant` null = accès global ; `idsFaceID` = ids d'utilisateurs ayant Face ID ici.

- [ ] **Step 1: Write the component**

```js
// « Qui êtes-vous ? » : grille d'avatars. Un avatar 🔐 a Face ID sur ce
// téléphone ; login.js lance alors Face ID dès l'appui.
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInUp } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { Avatar, EnteteLogin, FondLogin } from './CadreLogin'
import { couleurResto, couleurRole, initiales, libelleRole, prenom } from './themeLogin'

export default function QuiEtesVous({
  t, restaurant, utilisateurs, chargement, reconnu, idsFaceID, reprisParLePOS, onChoisir, onRetour,
}) {
  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} compact />
        <View style={styles.corps}>
          <View style={[styles.puce, { backgroundColor: t.carte, borderColor: t.carteBord }]}>
            {restaurant ? (
              <>
                <View style={[styles.point, { backgroundColor: couleurResto(restaurant) }]} />
                <Text style={[styles.puceNom, { color: t.texte }]} numberOfLines={1}>{restaurant.nom}</Text>
                {reconnu && <Text style={[styles.puceInfo, { color: t.texteFaible }]}>✓ téléphone reconnu</Text>}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 16 }}>👑</Text>
                <Text style={[styles.puceNom, { color: t.texte }]}>Accès global</Text>
              </>
            )}
          </View>

          <Text style={[styles.label, { color: t.texteFaible }]}>Qui êtes-vous ?</Text>

          {chargement ? (
            <ActivityIndicator size="large" color={t.accent} style={{ marginTop: 30 }} />
          ) : (
            <View style={styles.grille}>
              {utilisateurs.map((u, i) => (
                <Animated.View key={u.id} entering={FadeInUp.delay(i * 50).springify().damping(18)} style={styles.case}>
                  <Pressable
                    onPress={() => onChoisir(u)}
                    style={({ pressed }) => [styles.personne, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}
                  >
                    <Avatar t={t} initialesTexte={initiales(u.nom)} couleur={couleurRole(u.role)} taille={60} badge={idsFaceID.includes(u.id)} />
                    <Text style={[styles.prenom, { color: t.texte }]} numberOfLines={1}>{prenom(u.nom)}</Text>
                    <Text style={[styles.role, { color: t.texteFaible }]} numberOfLines={1}>{libelleRole(u.role)}</Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}

          {!chargement && utilisateurs.length === 0 && reprisParLePOS.length === 0 && (
            <Text style={[styles.vide, { color: t.texteFaible }]}>Aucun utilisateur pour ce restaurant</Text>
          )}

          {reprisParLePOS.length > 0 && (
            // Un compte qui disparaît sans un mot déclenche un appel au
            // support : on explique l'absence là où elle se constate.
            <View style={[styles.pos, { borderColor: t.carteBord, backgroundColor: t.carte }]}>
              <Text style={styles.posIcone}>🖥️</Text>
              <Text style={[styles.posTitre, { color: t.texteDoux }]}>
                {reprisParLePOS.length > 1 ? 'Les caissières se connectent sur la caisse' : 'La caissière se connecte sur la caisse'}
              </Text>
              <Text style={[styles.posTexte, { color: t.texteFaible }]}>
                Ce restaurant est équipé du POS. Le point de shift, les dépenses et
                l'inventaire s'y font, et arrivent ici automatiquement.
              </Text>
              <Text style={[styles.posTexte, { color: t.texteFaible, marginTop: 8 }]}>
                Manager : en cas de panne de la caisse, rétablissez la saisie depuis
                Paramètres → Restaurants. Les comptes sont intacts.
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={onRetour} style={styles.lien}>
            <Text style={[styles.lienTxt, { color: t.texteDoux }]}>
              {restaurant ? 'Changer de restaurant' : '‹ Retour'}
            </Text>
          </TouchableOpacity>
        </View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:   { paddingBottom: 30 },
  corps:    { paddingHorizontal: 16, marginTop: -24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  puce:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1,
              paddingHorizontal: 14, minHeight: 52,
              shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  point:    { width: 10, height: 10, borderRadius: 5 },
  puceNom:  { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  puceInfo: { fontSize: 11, marginLeft: 'auto' },
  label:    { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 12, marginLeft: 4 },
  grille:   { flexDirection: 'row', flexWrap: 'wrap' },
  case:     { width: '33.33%', marginBottom: 16 },
  personne: { alignItems: 'center', paddingVertical: 6, minHeight: 104 },
  prenom:   { fontSize: 13, fontWeight: '700', marginTop: 8, maxWidth: '92%' },
  role:     { fontSize: 11, marginTop: 2 },
  vide:     { textAlign: 'center', marginTop: 30, fontSize: 14 },
  pos:      { marginTop: 8, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', padding: 16, alignItems: 'center' },
  posIcone: { fontSize: 22, marginBottom: 6 },
  posTitre: { fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  posTexte: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  lien:     { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, marginTop: 8 },
  lienTxt:  { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
})
```

- [ ] **Step 2: Lint**

Run: `npx eslint components/login`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/login/QuiEtesVous.js
git commit -m "feat(login): « Qui êtes-vous ? » en grille d'avatars"
```

---

### Task 5: Clavier du code (touche 🔐) et proposition Face ID

**Files:**
- Create: `components/login/ClavierCode.js`
- Create: `components/login/ActivationFaceID.js`

**Interfaces:**
- Consumes: Task 2 ; `SPRINGS` de `lib/animations`.
- Produces:
  - `<ClavierCode t entete={{ initialesTexte, couleur, titre, sousTitre }} consigne pin pinError bloque secondesRestantes couleur appuyerChiffre supprimer toucheFaceID onFaceID bioEnCours bioMessage lienBas={{ texte, onPress }} />`
  - `<ActivationFaceID t utilisateur restaurant enCours message onActiver onPlusTard onJamais />`

- [ ] **Step 1: Write `components/login/ClavierCode.js`**

```js
// Saisie d'un code (restaurant ou personnel). La touche bas-gauche devient
// 🔐 (Face ID) quand ce compte l'a activé sur ce téléphone.
import { useEffect, useRef } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { SPRINGS } from '../../lib/animations'
import { Avatar, EnteteLogin, FondLogin } from './CadreLogin'

function Point({ rempli, erreur, couleur, t }) {
  const scale = useSharedValue(1)
  const avant = useRef(false)
  useEffect(() => {
    if (rempli && !avant.current) scale.value = withSequence(withSpring(1.4, SPRINGS.bouncy), withSpring(1, SPRINGS.snappy))
    avant.current = rempli
  }, [rempli, scale])
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const c = erreur ? t.erreur : couleur
  return <Animated.View style={[styles.point, aStyle, { borderColor: c }, rempli && { backgroundColor: c }]} />
}

function Touche({ label, onPress, disabled, t }) {
  if (label === '') return <View style={styles.toucheVide} />
  return (
    <Pressable
      onPress={() => { if (!disabled) onPress(label) }}
      style={({ pressed }) => [
        styles.touche,
        { backgroundColor: pressed ? t.toucheAppui : t.touche, borderColor: t.sombre ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
    >
      <Text style={[styles.toucheTxt, { color: t.texte }, label === '🔐' && { fontSize: 26 }]}>{label}</Text>
    </Pressable>
  )
}

export default function ClavierCode({
  t, entete, consigne, pin, pinError, bloque, secondesRestantes, couleur,
  appuyerChiffre, supprimer, toucheFaceID, onFaceID, bioEnCours, bioMessage, lienBas,
}) {
  const shakeX = useSharedValue(0)
  useEffect(() => {
    if (pinError) {
      shakeX.value = withSequence(
        withTiming(-12, { duration: 50 }), withTiming(12, { duration: 55 }),
        withTiming(-10, { duration: 50 }), withTiming(10, { duration: 50 }),
        withTiming(-5, { duration: 45 }), withTiming(0, { duration: 45 }),
      )
    }
  }, [pinError, shakeX])
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }))

  // Web : taper le code au clavier physique (chiffres + retour arrière).
  useEffect(() => {
    if (Platform.OS !== 'web' || bloque) return
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '0' && e.key <= '9') { appuyerChiffre(e.key); e.preventDefault() }
      else if (e.key === 'Backspace' || e.key === 'Delete') { supprimer(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bloque, appuyerChiffre, supprimer])

  const touches = ['1', '2', '3', '4', '5', '6', '7', '8', '9', toucheFaceID ? '🔐' : '', '0', '⌫']

  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} compact />
        <View style={styles.corps}>
          <View style={styles.qui}>
            <Avatar t={t} initialesTexte={entete.initialesTexte} couleur={entete.couleur} taille={64} />
            <Text style={[styles.nom, { color: t.texte }]} numberOfLines={1}>{entete.titre}</Text>
            <Text style={[styles.sous, { color: t.texteFaible }]} numberOfLines={1}>{entete.sousTitre}</Text>
          </View>

          <Text style={[styles.consigne, { color: t.texteDoux }]}>{consigne}</Text>

          <Animated.View style={[styles.points, shakeStyle]}>
            {[0, 1, 2, 3].map(i => (
              <Point key={i} t={t} rempli={pin.length > i} erreur={pinError || !!bloque} couleur={couleur} />
            ))}
          </Animated.View>

          <View style={styles.message}>
            {bloque ? (
              <Text style={[styles.erreur, { color: t.erreur }]}>🔒 Trop de tentatives — réessayez dans {secondesRestantes}s</Text>
            ) : pinError ? (
              <Text style={[styles.erreur, { color: t.erreur }]}>Code incorrect, réessayez</Text>
            ) : bioEnCours ? (
              <Text style={[styles.erreur, { color: t.texteDoux }]}>Vérification Face ID…</Text>
            ) : bioMessage ? (
              <Text style={[styles.erreur, { color: t.erreur }]}>{bioMessage}</Text>
            ) : null}
          </View>

          <View style={styles.pave}>
            {touches.map((k, i) => (
              <Touche
                key={i} t={t} label={k}
                disabled={k === '🔐' ? bioEnCours : !!bloque}
                onPress={(val) => (val === '⌫' ? supprimer() : val === '🔐' ? onFaceID() : appuyerChiffre(val))}
              />
            ))}
          </View>

          {lienBas && (
            <TouchableOpacity onPress={lienBas.onPress} style={styles.lien}>
              <Text style={[styles.lienTxt, { color: t.texteDoux }]}>{lienBas.texte}</Text>
            </TouchableOpacity>
          )}
        </View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:     { paddingBottom: 30 },
  corps:      { alignItems: 'center', marginTop: -34, paddingHorizontal: 16 },
  qui:        { alignItems: 'center' },
  nom:        { fontSize: 18, fontWeight: '700', marginTop: 10, maxWidth: 320 },
  sous:       { fontSize: 12.5, marginTop: 3, maxWidth: 320 },
  consigne:   { fontSize: 14, fontWeight: '600', marginTop: 18 },
  points:     { flexDirection: 'row', gap: 18, marginTop: 14 },
  point:      { width: 16, height: 16, borderRadius: 8, borderWidth: 2.5 },
  message:    { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
  erreur:     { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  pave:       { flexDirection: 'row', flexWrap: 'wrap', width: 282, gap: 14, justifyContent: 'center' },
  touche:     { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  toucheVide: { width: 76, height: 76 },
  toucheTxt:  { fontSize: 26, fontWeight: '400' },
  lien:       { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, marginTop: 14 },
  lienTxt:    { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
})
```

- [ ] **Step 2: Write `components/login/ActivationFaceID.js`**

```js
// Proposition d'activer Face ID, juste après un code juste.
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { EnteteLogin, FondLogin } from './CadreLogin'

export default function ActivationFaceID({ t, utilisateur, restaurant, enCours, message, onActiver, onPlusTard, onJamais }) {
  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} compact />
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={[styles.carte, { backgroundColor: t.carte, borderColor: t.carteBord }]}
        >
          <Text style={styles.icone}>🔐</Text>
          <Text style={[styles.titre, { color: t.texte }]}>Entrer plus vite la prochaine fois ?</Text>
          <Text style={[styles.texte, { color: t.texteDoux }]}>
            {restaurant
              ? `Activez Face ID ou l’empreinte sur ce téléphone : vous entrerez directement dans ${restaurant.nom}, sans taper vos deux codes.`
              : 'Activez Face ID ou l’empreinte sur ce téléphone : vous entrerez directement dans l’administration, sans taper votre code.'}
          </Text>
          <Text style={[styles.avert, { color: t.texteFaible }]}>
            ⚠️ À faire seulement sur VOTRE téléphone. Toute personne dont le visage ou le doigt est enregistré sur ce téléphone pourra entrer avec votre compte.
          </Text>

          <TouchableOpacity
            style={[styles.bouton, { backgroundColor: t.accent }, enCours && { opacity: 0.6 }]}
            onPress={onActiver}
            disabled={enCours}
            activeOpacity={0.85}
          >
            <Text style={styles.boutonTxt}>{enCours ? 'Vérification…' : 'Activer sur ce téléphone'}</Text>
          </TouchableOpacity>
          {!!message && <Text style={[styles.erreur, { color: t.erreur }]}>{message}</Text>}

          <TouchableOpacity style={styles.second} onPress={onPlusTard} disabled={enCours}>
            <Text style={[styles.secondTxt, { color: t.texteDoux }]}>Plus tard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.second} onPress={onJamais} disabled={enCours}>
            <Text style={[styles.secondTxt, { color: t.texteFaible }]}>
              Ne plus me demander sur ce téléphone ({utilisateur?.nom})
            </Text>
          </TouchableOpacity>
        </Animated.View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:    { paddingBottom: 30 },
  carte:     { marginTop: -26, marginHorizontal: 16, alignSelf: 'center', width: '92%', maxWidth: 440,
               borderRadius: 24, borderWidth: 1, padding: 22, alignItems: 'center',
               shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  icone:     { fontSize: 50, marginBottom: 10 },
  titre:     { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  texte:     { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 12 },
  avert:     { fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginBottom: 20 },
  bouton:    { width: '100%', minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  boutonTxt: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  erreur:    { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 10 },
  second:    { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
  secondTxt: { fontSize: 14, textAlign: 'center' },
})
```

- [ ] **Step 3: Lint**

Run: `npx eslint components/login`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add components/login/ClavierCode.js components/login/ActivationFaceID.js
git commit -m "feat(login): clavier avec touche Face ID et proposition d'activation restylée"
```

---

### Task 6: Brancher `app/login.js` sur les nouveaux écrans

**Files:**
- Modify: `app/login.js` (réécriture du rendu ; l'état et les fonctions de vérification restent)

**Interfaces:**
- Consumes: Tasks 1-5 ; `lib/biometrie.js`, `lib/biometrieWeb.js` (inchangés).

- [ ] **Step 1: Imports**

Remplacer les imports de rendu (`FlatList`, `Image`, `Pressable`, `SafeAreaView`, `ScrollView`, `StyleSheet`, `Text`, `TouchableOpacity`, `View`, reanimated, `SignatureFooter`, `SPRINGS`) par :

```js
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Platform } from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { getRestaurants, getUtilisateurs, getUtilisateursGlobaux } from '../lib/api'
import { ROLES_GLOBAUX } from '../lib/constants'
import { separerComptesPOS } from '../lib/sourcePoint'
import { destinationApresDeverrouillage } from '../lib/inactivityLock'
import { controlerEnrolement, peutProposerActivation } from '../lib/biometrie'
import {
  activer, aRefuse, estSupportee, lireEnrolements, messageErreur,
  noterRefus, oublierEnrolement, signature, verifier,
} from '../lib/biometrieWeb'
import {
  ajouterReconnu, ecranDeDepart, estReconnu, nettoyerReconnus, trierRestaurants,
} from '../lib/restosReconnus'
import { ecrireReconnus, lireReconnus } from '../lib/restosReconnusStockage'
import AccueilLogin from '../components/login/AccueilLogin'
import QuiEtesVous from '../components/login/QuiEtesVous'
import ClavierCode from '../components/login/ClavierCode'
import ActivationFaceID from '../components/login/ActivationFaceID'
import { couleurResto, couleurRole, initiales, libelleRole, themeLogin } from '../components/login/themeLogin'
import '../lib/webAlert'   // remplace Alert.alert par les dialogues du navigateur
```

Supprimer `PinButton`, `PinDot`, `PinPadModule`, `RestoCard`, `UserCard`, `BoutonsBiometrie`, `getRoleLabel`, `getRoleCouleur`, `getRoleBg` et tout `StyleSheet.create` en bas du fichier.

- [ ] **Step 2: État et chargement**

Dans `LoginScreen`, remplacer `const { colors } = useTheme()` par :

```js
  const { isDark } = useTheme()
  const t = themeLogin(isDark)
```

Ajouter l'état :

```js
  const [reconnus, setReconnus] = useState([])
```

Remplacer `fetchRestaurants` par :

```js
  async function fetchRestaurants() {
    setLoadingRestos(true)
    const [data, liste] = await Promise.all([getRestaurants(), lireReconnus()])
    // Un code restaurant modifié fait oublier le restaurant sur ce téléphone.
    const nette = nettoyerReconnus(liste, data)
    if (nette.length !== liste.length) ecrireReconnus(nette)
    setReconnus(nette)
    setRestaurants(trierRestaurants(data, nette))
    setLoadingRestos(false)
    if (sessionVerrouille) {
      const resto = data.find(r => r.id === restaurantIdEnSession)
      if (resto) choisirRestaurant(resto, nette)
      else chargerUtilisateursGlobaux()
      return
    }
    const depart = ecranDeDepart({
      valides: data.filter(r => estReconnu(nette, r)),
      enrolements: lireEnrolements(),
      verrouille: false,
    })
    if (depart.ecran === 'quiEtesVous') {
      setSelectedResto(depart.restaurant)
      chargerUtilisateurs(depart.restaurant)
    }
  }
```

- [ ] **Step 3: Restaurant reconnu = pas de code**

Remplacer `choisirRestaurant` par :

```js
  function choisirRestaurant(resto, liste = reconnus) {
    setSelectedResto(resto)
    setBioMessage('')
    setPin('')
    setPinError(false)
    setTentativesResto(0)
    setBloqueJusquaResto(null)
    if (estReconnu(liste, resto)) {
      chargerUtilisateurs(resto)
      return
    }
    if (Platform.OS === 'web') {
      try {
        const stored = localStorage.getItem(`sam_lockout_resto_${resto.id}`)
        if (stored) {
          const until = parseInt(stored)
          if (Date.now() < until) setBloqueJusquaResto(until)
          else localStorage.removeItem(`sam_lockout_resto_${resto.id}`)
        }
      } catch {}
    }
    setEtape(2)
  }
```

Dans `verifierPinRestaurant`, branche `ok`, remplacer `chargerUtilisateurs()` par :

```js
      const liste = ajouterReconnu(reconnus, selectedResto)
      setReconnus(liste)
      ecrireReconnus(liste)
      chargerUtilisateurs(selectedResto)
```

Remplacer `chargerUtilisateurs` par une version qui reçoit le restaurant (l'état `selectedResto` n'est pas encore à jour dans le même appui) :

```js
  async function chargerUtilisateurs(resto) {
    setLoadingUsers(true)
    setEtape(3)
    const data = await getUtilisateurs(resto.id)
    setUtilisateurs(data)
    setLoadingUsers(false)
    if (sessionVerrouille) {
      const utilisateur = data.find(u => u.id === userIdEnSession)
      if (utilisateur) choisirUtilisateur(utilisateur)
    }
  }
```

- [ ] **Step 4: Avatar 🔐 → Face ID immédiat**

Ajouter, après `choisirUtilisateur` :

```js
  // Avatar 🔐 : Face ID part tout de suite (dans l'appui, exigence Safari) ;
  // en cas d'annulation on reste sur le clavier, touche 🔐 disponible.
  function toucherAvatar(user) {
    choisirUtilisateur(user)
    const e = enrolementsDe(user, selectedResto)[0]
    if (bioSupportee && e) entrerAvecBiometrie(e)
  }
```

Dans `choisirUtilisateur`, ajouter `setBioMessage('')` en tête.

- [ ] **Step 5: Rendu**

Remplacer tout le bloc de rendu (étapes 1 à 5) par :

```js
  const enrolementsAffiches = bioSupportee ? enrolements : []

  if (etape === 1) {
    return (
      <AccueilLogin
        t={t}
        restaurants={restaurants}
        chargement={loadingRestos}
        reconnusIds={restaurants.filter(r => estReconnu(reconnus, r)).map(r => r.id)}
        enrolements={enrolementsAffiches}
        bioSupportee={bioSupportee}
        bioEnCours={bioEnCours}
        bioMessage={bioMessage}
        onFaceID={entrerAvecBiometrie}
        onRetirerFaceID={retirerBiometrie}
        onResto={(r) => choisirRestaurant(r)}
        onGlobal={chargerUtilisateursGlobaux}
      />
    )
  }

  if (etape === 2) {
    const ici = enrolementsAffiches.filter(e => e.restaurantId === selectedResto?.id)
    return (
      <ClavierCode
        t={t}
        entete={{
          initialesTexte: initiales(selectedResto?.nom),
          couleur: couleurResto(selectedResto),
          titre: selectedResto?.nom,
          sousTitre: selectedResto?.localisation || 'Abidjan',
        }}
        consigne="Code du restaurant"
        pin={pin} pinError={pinError} secondesRestantes={secondesRestantes}
        bloque={!!(bloqueJusquaResto && Date.now() < bloqueJusquaResto)}
        couleur={couleurResto(selectedResto)}
        appuyerChiffre={appuyerChiffre} supprimer={supprimer}
        toucheFaceID={ici.length === 1}
        onFaceID={() => entrerAvecBiometrie(ici[0])}
        bioEnCours={bioEnCours} bioMessage={bioMessage}
        lienBas={{ texte: 'Changer de restaurant', onPress: () => { setEtape(1); setPin(''); setPinError(false) } }}
      />
    )
  }

  if (etape === 3) {
    const modeGlobal = !selectedResto
    const globaux = utilisateurs.filter(u => ROLES_GLOBAUX.includes(u.role))
    // Sur un site passé au POS, les caissiers ne saisissent plus ici : leurs
    // comptes sortent de la liste (jamais désactivés — un UPDATE sur
    // restaurants.source_point les fait revenir au prochain chargement).
    const { visibles: specifiques, reprisParLePOS } = separerComptesPOS(
      selectedResto,
      utilisateurs.filter(u => !ROLES_GLOBAUX.includes(u.role)),
    )
    return (
      <QuiEtesVous
        t={t}
        restaurant={selectedResto}
        utilisateurs={modeGlobal ? globaux : specifiques}
        chargement={loadingUsers}
        reconnu={estReconnu(reconnus, selectedResto)}
        idsFaceID={enrolementsAffiches
          .filter(e => e.restaurantId === (selectedResto?.id ?? null))
          .map(e => e.userId)}
        reprisParLePOS={modeGlobal ? [] : reprisParLePOS}
        onChoisir={toucherAvatar}
        onRetour={() => { setPin(''); setPinError(false); setBioMessage(''); setEtape(1) }}
      />
    )
  }

  if (etape === 5 && activationEnAttente) {
    const { utilisateur, restaurant } = activationEnAttente
    return (
      <ActivationFaceID
        t={t}
        utilisateur={utilisateur}
        restaurant={restaurant}
        enCours={bioEnCours}
        message={bioMessage}
        onActiver={activerBiometrie}
        onPlusTard={() => passerActivation(false)}
        onJamais={() => passerActivation(true)}
      />
    )
  }

  const ici = enrolementsDe(selected, selectedResto)
  return (
    <ClavierCode
      t={t}
      entete={{
        initialesTexte: initiales(selected?.nom),
        couleur: couleurRole(selected?.role),
        titre: selected?.nom,
        sousTitre: ROLES_GLOBAUX.includes(selected?.role)
          ? `${libelleRole(selected?.role)} · tous les restaurants`
          : `${selectedResto?.nom} · ${libelleRole(selected?.role)}`,
      }}
      consigne="Votre code personnel"
      pin={pin} pinError={pinError} secondesRestantes={secondesRestantes}
      bloque={!!(bloqueJusquaUser && Date.now() < bloqueJusquaUser)}
      couleur={couleurRole(selected?.role)}
      appuyerChiffre={appuyerChiffre} supprimer={supprimer}
      toucheFaceID={bioSupportee && ici.length > 0}
      onFaceID={() => entrerAvecBiometrie(ici[0])}
      bioEnCours={bioEnCours} bioMessage={bioMessage}
      lienBas={{ texte: 'Ce n’est pas moi', onPress: () => { setEtape(3); setPin(''); setPinError(false); setBioMessage('') } }}
    />
  )
```

- [ ] **Step 6: Lint, tests, export web**

Run:
```bash
npx eslint app/login.js components/login lib/restosReconnus.js lib/restosReconnusStockage.js
for f in lib/*.test.mjs; do node "$f" > /dev/null || echo "ECHEC $f"; done
npx expo export -p web --output-dir <scratchpad>/web
```
Expected: 0 errors ; aucun `ECHEC` ; `Exported:`.

- [ ] **Step 7: Commit + push**

```bash
git add app/login.js
git commit -m "feat(login): nouvelle page de connexion (bandeau clair, sombre premium, téléphone reconnu)"
graphify update . && git add -A graphify-out && git commit -m "chore(graphify): graphe à jour"
git push
```

- [ ] **Step 8: Essai manuel (utilisateur, localhost:8081)**

Recharger la page (Cmd+Maj+R) puis vérifier :
1. Clair : bandeau orange, cartes blanches ; sombre (réglage du téléphone/app) : fond noir chaud.
2. Restaurant non reconnu → code restaurant → « Qui êtes-vous ? » ; déconnexion → ce restaurant porte « ✓ reconnu » et s'ouvre sans code.
3. Avatar 🔐 → Face ID immédiat ; annulation → clavier avec touche 🔐.
4. Comptes Face ID en haut de l'accueil ; « Gérer Face ID » → « Retirer ».
5. Verrouillage d'inactivité → retour direct au code personnel.
