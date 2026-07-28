import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
} from 'react-native-reanimated'
import SignatureFooter from '../components/SignatureFooter'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { getRestaurants, getUtilisateurs, getUtilisateursGlobaux } from '../lib/api'
import { SPRINGS } from '../lib/animations'
import { ROLES_GLOBAUX } from '../lib/constants'

// ─── Bouton PIN animé ────────────────────────────────────────
function PinButton({ label, onPress, disabled, colors }) {
  const scale = useSharedValue(1)
  const bg = useSharedValue(0)
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: bg.value === 1
      ? colors.surfaceAlt
      : colors.surface,
  }))

  if (label === '') return <View style={styles.pinBtnEmpty} />

  return (
    <Animated.View style={[styles.pinBtn, aStyle, disabled && styles.pinBtnBloque]}>
      <Pressable
        onPressIn={() => {
          if (disabled) return
          scale.value = withSpring(0.85, SPRINGS.bouncy)
          bg.value = withTiming(1, { duration: 80 })
        }}
        onPressOut={() => {
          scale.value = withSpring(1, SPRINGS.snappy)
          bg.value = withTiming(0, { duration: 150 })
        }}
        onPress={() => { if (!disabled && label !== '') onPress(label) }}
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      >
        <Text style={[styles.pinBtnText, disabled && { color: '#555' }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  )
}

// ─── Dot PIN animé ───────────────────────────────────────────
function PinDot({ filled, error, couleur }) {
  const scale = useSharedValue(1)
  const prevFilled = useRef(false)

  useEffect(() => {
    if (filled && !prevFilled.current) {
      scale.value = withSequence(
        withSpring(1.4, SPRINGS.bouncy),
        withSpring(1, SPRINGS.snappy),
      )
    }
    prevFilled.current = filled
  }, [filled])

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Animated.View style={[
      styles.dot,
      aStyle,
      filled && { backgroundColor: error ? '#EE6060' : couleur },
      { borderColor: error ? '#EE6060' : couleur },
      error && styles.dotError,
    ]} />
  )
}

// ─── Composant PinPad ────────────────────────────────────────
function PinPadModule({
  pin, pinError, secondesRestantes,
  supprimer, appuyerChiffre,
  titre, sousTitre, couleur, bloque, colors,
}) {
  const shakeX = useSharedValue(0)

  useEffect(() => {
    if (pinError) {
      shakeX.value = withSequence(
        withTiming(-12, { duration: 50 }),
        withTiming( 12, { duration: 55 }),
        withTiming(-10, { duration: 50 }),
        withTiming( 10, { duration: 50 }),
        withTiming( -5, { duration: 45 }),
        withTiming(  0, { duration: 45 }),
      )
    }
  }, [pinError])

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }))

  // Web : permettre de taper le code au clavier physique (chiffres + retour arrière)
  // sans avoir à cliquer sur les boutons à l'écran.
  useEffect(() => {
    if (Platform.OS !== 'web' || bloque) return
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '0' && e.key <= '9') {
        appuyerChiffre(e.key)
        e.preventDefault()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        supprimer()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bloque, appuyerChiffre, supprimer])

  return (
    <View style={styles.pinContainer}>
      <Text style={styles.pinTitre}>{titre}</Text>
      <Text style={styles.pinSousTitre}>{sousTitre}</Text>

      <Animated.View style={[styles.dots, shakeStyle]}>
        {[0,1,2,3].map(i => (
          <PinDot
            key={i}
            filled={pin.length > i}
            error={pinError || !!bloque}
            couleur={couleur}
          />
        ))}
      </Animated.View>

      {bloque ? (
        <Text style={styles.pinErrorTxt}>🔒 Trop de tentatives — réessayez dans {secondesRestantes}s</Text>
      ) : pinError ? (
        <Text style={styles.pinErrorTxt}>❌ Code incorrect, réessayez</Text>
      ) : (
        <View style={{ height: 22 }} />
      )}

      <View style={styles.pinpad}>
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <PinButton
            key={i}
            label={k}
            disabled={!!bloque}
            colors={colors}
            onPress={(val) => val === '⌫' ? supprimer() : appuyerChiffre(val)}
          />
        ))}
      </View>
    </View>
  )
}

// ─── Carte Restaurant ────────────────────────────────────────
function RestoCard({ item, index, onPress }) {
  const scale = useSharedValue(1)
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const couleur = item.couleur === 'vert' ? '#1FAD6B' : '#F0A020'
  const initiales = item.nom.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <Animated.View
      entering={FadeInUp.delay(index * 90).springify().damping(18).stiffness(200)}
      style={[{ width: '48%' }, aStyle]}
    >
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.94, SPRINGS.snappy) }}
        onPressOut={() => { scale.value = withSpring(1, SPRINGS.gentle) }}
        onPress={onPress}
        style={styles.restoBadge}
      >
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.restoBadgePhoto} />
        ) : (
          <View style={[styles.restoBadgeInitials, { backgroundColor: couleur }]}>
            <Text style={styles.restoBadgeInitialsTxt}>{initiales}</Text>
          </View>
        )}
        <Text style={styles.restoBadgeNom} numberOfLines={2}>{item.nom}</Text>
        <Text style={styles.restoBadgeLoc} numberOfLines={1}>{item.localisation || 'Abidjan'}</Text>
        <View style={[styles.restoBadgeDot, { backgroundColor: couleur }]} />
      </Pressable>
    </Animated.View>
  )
}

// ─── Carte Utilisateur ───────────────────────────────────────
function UserCard({ item, index, onPress, getRoleCouleur, getRoleBg, getRoleLabel, modeGlobal }) {
  const scale = useSharedValue(1)
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const couleur = getRoleCouleur(item.role)

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 70).springify().damping(18).stiffness(180)}
      style={aStyle}
    >
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.97, SPRINGS.snappy) }}
        onPressOut={() => { scale.value = withSpring(1, SPRINGS.gentle) }}
        onPress={onPress}
        style={styles.userItem}
      >
        <View style={[styles.avatar, { backgroundColor: couleur }]}>
          <Text style={styles.avatarText}>
            {item.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{item.nom}</Text>
          <View style={styles.userRoleRow}>
            <View style={[styles.roleBadge, { backgroundColor: getRoleBg(item.role) }]}>
              <Text style={[styles.roleBadgeTxt, { color: couleur }]}>
                {getRoleLabel(item.role)}
              </Text>
            </View>
            {modeGlobal && <Text style={styles.globalTxt}>Accès global</Text>}
          </View>
        </View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </Animated.View>
  )
}

// ─── Écran principal ─────────────────────────────────────────
export default function LoginScreen() {
  const { colors } = useTheme()
  const [etape, setEtape] = useState(1)
  const [restaurants, setRestaurants] = useState([])
  const [utilisateurs, setUtilisateurs] = useState([])
  const [selectedResto, setSelectedResto] = useState(null)
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [loadingRestos, setLoadingRestos] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [pinError, setPinError] = useState(false)
  const [tentativesResto, setTentativesResto] = useState(0)
  const [tentativesUser, setTentativesUser] = useState(0)
  const [bloqueJusquaResto, setBloqueJusquaResto] = useState(null)
  const [bloqueJusquaUser, setBloqueJusquaUser] = useState(null)
  const [secondesRestantes, setSecondesRestantes] = useState(0)

  const {
    setRoleActif, resetJour, setLastRoute,
    setRestaurantId, setRestaurantNom,
    setUserId, setUserNom,
    userId: userIdEnSession,
  } = useApp()

  useEffect(() => {
    if (!bloqueJusquaResto && !bloqueJusquaUser) return
    const interval = setInterval(() => {
      const cible = bloqueJusquaResto || bloqueJusquaUser
      const reste = Math.ceil((cible - Date.now()) / 1000)
      if (reste <= 0) {
        setBloqueJusquaResto(null)
        setBloqueJusquaUser(null)
        setSecondesRestantes(0)
        clearInterval(interval)
      } else {
        setSecondesRestantes(reste)
      }
    }, 500)
    return () => clearInterval(interval)
  }, [bloqueJusquaResto, bloqueJusquaUser])

  useEffect(() => { fetchRestaurants() }, [])

  async function fetchRestaurants() {
    setLoadingRestos(true)
    const data = await getRestaurants()
    setRestaurants(data)
    setLoadingRestos(false)
  }

  function choisirRestaurant(resto) {
    setSelectedResto(resto)
    setPin('')
    setPinError(false)
    setTentativesResto(0)
    setBloqueJusquaResto(null)
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

  function verifierPinRestaurant(pinSaisi) {
    if (bloqueJusquaResto && Date.now() < bloqueJusquaResto) return
    const ok = pinSaisi === String(selectedResto.pin)
    if (ok) {
      setPinError(false)
      setPin('')
      setTentativesResto(0)
      if (Platform.OS === 'web') {
        try { localStorage.removeItem(`sam_lockout_resto_${selectedResto.id}`) } catch {}
      }
      chargerUtilisateurs()
    } else {
      const nouvellesTentatives = tentativesResto + 1
      setTentativesResto(nouvellesTentatives)
      setPinError(true)
      setPin('')
      if (nouvellesTentatives >= 3) {
        const until = Date.now() + 30_000
        setBloqueJusquaResto(until)
        if (Platform.OS === 'web') {
          try { localStorage.setItem(`sam_lockout_resto_${selectedResto.id}`, String(until)) } catch {}
        }
        setTentativesResto(0)
      }
    }
  }

  async function chargerUtilisateurs() {
    setLoadingUsers(true)
    setEtape(3)
    const data = await getUtilisateurs(selectedResto.id)
    setUtilisateurs(data)
    setLoadingUsers(false)
  }

  async function chargerUtilisateursGlobaux() {
    setSelectedResto(null)
    setLoadingUsers(true)
    setEtape(3)
    const data = await getUtilisateursGlobaux()
    setUtilisateurs(data)
    setLoadingUsers(false)
  }

  function choisirUtilisateur(user) {
    setSelected(user)
    setPin('')
    setPinError(false)
    setTentativesUser(0)
    setBloqueJusquaUser(null)
    if (Platform.OS === 'web') {
      try {
        const stored = localStorage.getItem(`sam_lockout_user_${user.id}`)
        if (stored) {
          const until = parseInt(stored)
          if (Date.now() < until) setBloqueJusquaUser(until)
          else localStorage.removeItem(`sam_lockout_user_${user.id}`)
        }
      } catch {}
    }
    setEtape(4)
  }

  function appuyerChiffre(chiffre) {
    if (pin.length < 4) {
      const newPin = pin + chiffre
      setPin(newPin)
      if (newPin.length === 4) {
        if (etape === 2) verifierPinRestaurant(newPin)
        else if (etape === 4) verifierPinUtilisateur(newPin)
      }
    }
  }

  function supprimer() {
    setPin(pin.slice(0, -1))
    setPinError(false)
  }

  async function verifierPinUtilisateur(pinSaisi) {
    if (bloqueJusquaUser && Date.now() < bloqueJusquaUser) return
    const pinOk = pinSaisi === String(selected.pin)
    if (!pinOk) {
      const nouvellesTentatives = tentativesUser + 1
      setTentativesUser(nouvellesTentatives)
      setPinError(true)
      setPin('')
      if (nouvellesTentatives >= 3) {
        const until = Date.now() + 30_000
        setBloqueJusquaUser(until)
        if (Platform.OS === 'web') {
          try { localStorage.setItem(`sam_lockout_user_${selected.id}`, String(until)) } catch {}
        }
        setTentativesUser(0)
      }
      return
    }

    if (Platform.OS === 'web') {
      try { localStorage.removeItem(`sam_lockout_user_${selected.id}`) } catch {}
    }
    setPinError(false)

    const memeUtilisateur = userIdEnSession === selected.id
    if (!memeUtilisateur) {
      resetJour()
    } else if (selected.role === 'caissier' || selected.role === 'gerant') {
      setLastRoute(null)
    }

    setRoleActif(selected.role)
    setUserId(selected.id)
    setUserNom(selected.nom)

    const estGlobal = ROLES_GLOBAUX.includes(selected.role)
    const restoId = estGlobal ? null : selectedResto?.id
    const restoNom = estGlobal ? null : selectedResto?.nom
    setRestaurantId(restoId)
    setRestaurantNom(restoNom)

    if (selected.role === 'manager' || selected.role === 'directeur') {
      router.replace({ pathname: '/accueil', params: { userId: selected.id, nom: selected.nom, role: selected.role } })
    } else if (selected.role === 'rh') {
      router.replace({ pathname: '/accueil', params: { userId: selected.id, nom: selected.nom, role: selected.role } })
    } else if (selected.role === 'verificateur') {
      router.replace({ pathname: '/verificateur', params: { userId: selected.id, nom: selected.nom, role: selected.role } })
    } else if (selected.role === 'gerant') {
      router.replace({ pathname: '/choix-date', params: { userId: selected.id, nom: selected.nom, role: selected.role } })
    } else {
      router.replace({ pathname: '/selectionner-journee', params: { userId: selected.id, nom: selected.nom, role: selected.role, restoId } })
    }
  }

  function getRoleLabel(role) {
    if (role === 'manager') return '👑 Manager'
    if (role === 'rh') return '🧑‍💼 RH'
    if (role === 'directeur') return '🏛️ Directeur'
    if (role === 'verificateur') return '🔍 Vérificateur'
    if (role === 'gerant') return '🔑 Gérant'
    return '💼 Caissier'
  }

  function getRoleCouleur(role) {
    if (role === 'manager') return '#5B52C8'
    if (role === 'rh') return '#185FA5'
    if (role === 'verificateur') return '#0E8A6B'
    if (role === 'gerant') return '#F0A020'
    return '#888'
  }

  function getRoleBg(role) {
    if (role === 'manager') return '#ECEAFF'
    if (role === 'rh') return '#E6F1FB'
    if (role === 'verificateur') return '#DEF3EC'
    if (role === 'gerant') return '#FEF0DA'
    return '#f5f5f5'
  }

  // ─── ETAPE 1 — Choix du restaurant ─────────────────────────
  if (etape === 1) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <Animated.View entering={FadeInDown.delay(0).springify().damping(20).stiffness(160)} style={styles.logoWrap}>
          <Image source={require('../assets/icon.png')} style={styles.logoImage} resizeMode="contain" />
          <Text style={[styles.appSub, { color: colors.textMuted }]}>Gestion de restaurant</Text>
        </Animated.View>

        <Animated.Text
          entering={FadeIn.delay(200).duration(400)}
          style={[styles.question, { color: colors.textSecondary }]}
        >
          Choisissez votre restaurant
        </Animated.Text>

        {loadingRestos ? (
          <ActivityIndicator size="large" color="#F0A020" style={{ marginTop: 40 }} />
        ) : restaurants.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>Aucun restaurant trouvé</Text>
        ) : (
          <FlatList
            key="restos-2col"
            data={restaurants}
            keyExtractor={item => item.id}
            numColumns={2}
            style={styles.list}
            contentContainerStyle={[styles.restoGrid, { paddingBottom: 60 }]}
            columnWrapperStyle={styles.restoGridRow}
            renderItem={({ item, index }) => (
              <RestoCard
                item={item}
                index={index}
                onPress={() => choisirRestaurant(item)}
              />
            )}
            ListFooterComponent={
              <Animated.View entering={FadeInUp.delay(300).springify().damping(20)}>
                <TouchableOpacity
                  style={[styles.globalBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primaryText }]}
                  onPress={chargerUtilisateursGlobaux}
                  activeOpacity={0.8}
                >
                  <Text style={styles.globalBtnIcon}>👑</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.globalBtnTxt, { color: colors.primaryDark }]}>Accès Manager / RH</Text>
                    <Text style={[styles.globalBtnSub, { color: colors.primary }]}>Administration & ressources humaines</Text>
                  </View>
                  <Text style={[styles.globalBtnArrow, { color: colors.primary }]}>›</Text>
                </TouchableOpacity>
              </Animated.View>
            }
          />
        )}
        <SignatureFooter />
      </SafeAreaView>
    )
  }

  // ─── ETAPE 2 — PIN restaurant ───────────────────────────────
  if (etape === 2) {
    const couleur = selectedResto?.couleur === 'vert' ? '#1FAD6B' : '#F0A020'
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => { setEtape(1); setPin(''); setPinError(false) }}
          style={styles.backBtn}
        >
          <Text style={styles.backTxt}>‹ Changer de restaurant</Text>
        </TouchableOpacity>
        <ScrollView
          style={{ width: '100%' }}
          contentContainerStyle={styles.pinScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.springify().damping(20)} style={styles.logoWrapSm}>
            <Image source={require('../assets/icon.png')} style={styles.logoImageSm} resizeMode="contain" />
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(80).springify().damping(18)}>
            <Text style={[styles.restoHeaderNom, { color: colors.text }]}>{selectedResto?.nom}</Text>
            <Text style={[styles.restoHeaderLoc, { color: colors.textMuted }]}>{selectedResto?.localisation || 'Abidjan'}</Text>
          </Animated.View>
          <Animated.View entering={FadeInUp.delay(150).springify().damping(18)} style={{ width: '100%' }}>
            <PinPadModule
              pin={pin} pinError={pinError} secondesRestantes={secondesRestantes}
              supprimer={supprimer} appuyerChiffre={appuyerChiffre}
              titre="Code d'accès du restaurant"
              sousTitre="Entrez le code PIN du restaurant"
              couleur={couleur}
              bloque={!!(bloqueJusquaResto && Date.now() < bloqueJusquaResto)}
              colors={colors}
            />
          </Animated.View>
        </ScrollView>
        <SignatureFooter />
      </SafeAreaView>
    )
  }

  // ─── ETAPE 3 — Choix de l'utilisateur ──────────────────────
  if (etape === 3) {
    const couleur = selectedResto?.couleur === 'vert' ? '#1FAD6B' : '#F0A020'
    const globaux = utilisateurs.filter(u => ROLES_GLOBAUX.includes(u.role))
    const specifiques = utilisateurs.filter(u => !ROLES_GLOBAUX.includes(u.role))
    const modeGlobal = !selectedResto

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => { setPin(''); setPinError(false); if (selectedResto) setEtape(2); else setEtape(1) }}
          style={styles.backBtn}
        >
          <Text style={styles.backTxt}>‹ Retour</Text>
        </TouchableOpacity>

        <Animated.View entering={FadeInDown.springify().damping(20)} style={{ width: '90%' }}>
          {modeGlobal ? (
            <View style={[styles.restoHeader, { backgroundColor: colors.primaryLight, borderColor: colors.primaryText, borderWidth: 1 }]}>
              <Text style={{ fontSize: 18 }}>👑</Text>
              <Text style={[styles.restoHeaderNom2, { color: colors.primaryDark }]}>Accès global</Text>
            </View>
          ) : (
            <View style={[styles.restoHeader, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <View style={[styles.restoDot, { backgroundColor: couleur }]} />
              <Text style={[styles.restoHeaderNom2, { color: colors.text }]}>{selectedResto?.nom}</Text>
            </View>
          )}
        </Animated.View>

        <Animated.Text
          entering={FadeIn.delay(100).duration(350)}
          style={[styles.question, { color: colors.textSecondary }]}
        >
          Qui êtes-vous ?
        </Animated.Text>

        {loadingUsers ? (
          <ActivityIndicator size="large" color="#F0A020" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            key="users-1col"
            data={modeGlobal ? globaux : specifiques}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 60 }}
            renderItem={({ item, index }) => (
              <UserCard
                item={item}
                index={index}
                onPress={() => choisirUtilisateur(item)}
                getRoleCouleur={getRoleCouleur}
                getRoleBg={getRoleBg}
                getRoleLabel={getRoleLabel}
                modeGlobal={modeGlobal}
              />
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>Aucun utilisateur pour ce restaurant</Text>
            }
          />
        )}
        <SignatureFooter />
      </SafeAreaView>
    )
  }

  // ─── ETAPE 4 — PIN utilisateur ──────────────────────────────
  const couleur = getRoleCouleur(selected?.role)
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <TouchableOpacity
        onPress={() => { setEtape(3); setPin(''); setPinError(false) }}
        style={styles.backBtn}
      >
        <Text style={styles.backTxt}>{'‹ Changer d\'utilisateur'}</Text>
      </TouchableOpacity>

      <ScrollView
        style={{ width: '100%' }}
        contentContainerStyle={styles.pinScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.springify().damping(20)} style={styles.logoWrapSm}>
          <Image source={require('../assets/icon.png')} style={styles.logoImageSm} resizeMode="contain" />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(80).springify().damping(18)}
          style={[styles.whoBox, { backgroundColor: colors.surfaceAlt, borderColor: couleur }]}
        >
          <View style={[styles.avatar, { backgroundColor: couleur }]}>
            <Text style={styles.avatarText}>
              {selected?.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.userName, { color: colors.text }]}>{selected?.nom}</Text>
            <Text style={[styles.userSubtitle, { color: colors.textMuted }]}>
              {ROLES_GLOBAUX.includes(selected?.role)
                ? 'Accès global — tous les restaurants'
                : `${selectedResto?.nom} — ${selected?.role}`}
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(150).springify().damping(18)} style={{ width: '100%' }}>
          <PinPadModule
            pin={pin} pinError={pinError} secondesRestantes={secondesRestantes}
            supprimer={supprimer} appuyerChiffre={appuyerChiffre}
            titre="Code PIN personnel"
            sousTitre="Entrez votre code PIN"
            couleur={couleur}
            bloque={!!(bloqueJusquaUser && Date.now() < bloqueJusquaUser)}
            colors={colors}
          />
        </Animated.View>
      </ScrollView>
      <SignatureFooter />
    </SafeAreaView>
  )
}

// ─── Styles statiques (sans couleurs dynamiques) ─────────────
const styles = StyleSheet.create({
  container:          { flex: 1, alignItems: 'center', paddingTop: 20 },
  logoWrap:           { alignItems: 'center', marginBottom: 8 },
  logoWrapSm:         { alignItems: 'center', marginBottom: 12 },
  logoImage:          { width: 210, height: 126, marginBottom: 6 },
  logoImageSm:        { width: 150, height: 90, marginBottom: 4 },
  appSub:             { fontSize: 13, marginBottom: 28, letterSpacing: 0.3 },
  question:           { fontSize: 14, marginBottom: 14, fontWeight: '500' },
  list:               { width: '100%', paddingHorizontal: 20 },
  // Restaurant grid
  restoGrid:          { paddingHorizontal: 16, paddingBottom: 30, paddingTop: 8 },
  restoGridRow:       { justifyContent: 'space-between', marginBottom: 16 },
  restoBadge: {
    borderRadius: 20, alignItems: 'center',
    padding: 18,
    backgroundColor: '#FFF',
    shadowColor: '#18182E', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09, shadowRadius: 12, elevation: 5,
    borderWidth: 1, borderColor: 'rgba(91,82,200,0.1)',
  },
  restoBadgePhoto:       { width: 88, height: 88, borderRadius: 16, marginBottom: 12 },
  restoBadgeInitials: {
    width: 88, height: 88, borderRadius: 16, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  restoBadgeInitialsTxt: { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  restoBadgeNom: {
    fontSize: 14, fontWeight: '700', textAlign: 'center',
    marginBottom: 4, color: '#18182E', letterSpacing: -0.2,
  },
  restoBadgeLoc:  { fontSize: 11, color: '#8888AA', textAlign: 'center' },
  restoBadgeDot:  { width: 8, height: 8, borderRadius: 4, marginTop: 10 },
  // Manager global
  globalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 18, marginTop: 8,
    borderWidth: 1.5,
  },
  globalBtnIcon:  { fontSize: 30 },
  globalBtnTxt:   { fontSize: 14, fontWeight: '700' },
  globalBtnSub:   { fontSize: 11, marginTop: 3 },
  globalBtnArrow: { fontSize: 22, marginLeft: 'auto' },
  // User list
  userItem: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderRadius: 16, marginBottom: 10,
    backgroundColor: '#FFF',
    shadowColor: '#18182E', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    borderWidth: 0.5, borderColor: 'rgba(91,82,200,0.1)',
    overflow: 'hidden',
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  avatarText:   { fontSize: 16, fontWeight: '700', color: '#fff' },
  userInfo:     { flex: 1 },
  userName:     { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  userRoleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  roleBadge:    { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  roleBadgeTxt: { fontSize: 11, fontWeight: '600' },
  globalTxt:    { fontSize: 10, color: '#8888AA' },
  arrow:        { fontSize: 20, color: '#DDDDF0' },
  restoDot:     { width: 14, height: 14, borderRadius: 7, marginRight: 0 },
  restoHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 14, marginBottom: 10, borderWidth: 1,
  },
  restoHeaderNom:  { fontSize: 22, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  restoHeaderLoc:  { fontSize: 12, marginBottom: 24, textAlign: 'center' },
  restoHeaderNom2: { fontSize: 14, fontWeight: '600' },
  // Who box
  whoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 18, marginVertical: 16,
    width: '90%', borderWidth: 2,
  },
  userSubtitle: { fontSize: 12, marginTop: 3 },
  // Misc
  empty:   { textAlign: 'center', marginTop: 40, fontSize: 14 },
  backBtn: { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10 },
  backTxt: { fontSize: 15, color: '#F0A020', fontWeight: '600' },
  pinScrollContent: { alignItems: 'center', paddingBottom: 40, paddingTop: 8, width: '100%' },
  // PIN
  pinContainer:  { alignItems: 'center', width: '100%', paddingHorizontal: 20, paddingBottom: 24 },
  pinTitre:      { fontSize: 17, fontWeight: '700', color: '#18182E', marginBottom: 6, letterSpacing: -0.3 },
  pinSousTitre:  { fontSize: 13, color: '#8888AA', marginBottom: 24 },
  dots:          { flexDirection: 'row', gap: 18, marginBottom: 16 },
  dot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2.5, borderColor: '#F0A020',
  },
  dotError: { borderColor: '#EE6060', backgroundColor: '#FDEBEB' },
  pinErrorTxt:   { fontSize: 13, color: '#EE6060', marginBottom: 18, fontWeight: '600' },
  pinpad:        { flexDirection: 'row', flexWrap: 'wrap', width: 270, gap: 12, marginTop: 12 },
  pinBtn: {
    width: 78, height: 78, borderRadius: 39,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF', overflow: 'hidden',
    shadowColor: '#18182E', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
    borderWidth: 1, borderColor: 'rgba(91,82,200,0.12)',
  },
  pinBtnEmpty:  { width: 78, height: 78 },
  pinBtnBloque: { opacity: 0.35 },
  pinBtnText:   { fontSize: 26, fontWeight: '400', color: '#18182E', letterSpacing: -0.5 },
})
