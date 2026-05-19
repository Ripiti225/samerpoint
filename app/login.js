import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native'
import SignatureFooter from '../components/SignatureFooter'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { getRestaurants, getUtilisateurs, getUtilisateursGlobaux } from '../lib/api'

const ROLES_GLOBAUX = ['manager', 'rh', 'directeur']

export default function LoginScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
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

  const {
    setRoleActif, resetJour,
    setRestaurantId, setRestaurantNom,
    setUserId, setUserNom,
    userId: userIdEnSession,
  } = useApp()

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
      router.replace({
        pathname: '/accueil',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
      })
    } else if (selected.role === 'rh') {
      router.replace({
        pathname: '/accueil',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
      })
    } else if (selected.role === 'gerant') {
      router.replace({
        pathname: '/choix-date',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
      })
    } else {
      router.replace({
        pathname: '/selectionner-journee',
        params: { userId: selected.id, nom: selected.nom, role: selected.role, restoId },
      })
    }
  }

  function getRoleLabel(role) {
    if (role === 'manager') return '👑 Manager'
    if (role === 'rh') return '🧑‍💼 RH'
    if (role === 'gerant') return '🔑 Gérant'
    return '💼 Caissier'
  }

  function getRoleCouleur(role) {
    if (role === 'manager') return '#534AB7'
    if (role === 'rh') return '#185FA5'
    if (role === 'gerant') return '#EF9F27'
    return '#888'
  }

  function getRoleBg(role) {
    if (role === 'manager') return '#EEEDFE'
    if (role === 'rh') return '#E6F1FB'
    if (role === 'gerant') return '#FAEEDA'
    return '#f5f5f5'
  }

  function PinPad({ titre, sousTitre, couleur, bloque }) {
    return (
      <View style={styles.pinContainer}>
        <Text style={styles.pinTitre}>{titre}</Text>
        <Text style={styles.pinSousTitre}>{sousTitre}</Text>
        <View style={styles.dots}>
          {[0,1,2,3].map(i => (
            <View key={i} style={[
              styles.dot,
              pin.length > i && { backgroundColor: bloque ? '#A32D2D' : couleur },
              { borderColor: bloque ? '#A32D2D' : pinError ? '#A32D2D' : couleur },
              (pinError || bloque) && styles.dotError,
            ]} />
          ))}
        </View>
        {bloque ? (
          <Text style={styles.pinErrorTxt}>🔒 Trop de tentatives — réessayez dans {secondesRestantes}s</Text>
        ) : pinError ? (
          <Text style={styles.pinErrorTxt}>❌ Code incorrect, réessayez</Text>
        ) : null}
        <View style={styles.pinpad}>
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.pinBtn, k === '' && styles.pinBtnEmpty, bloque && styles.pinBtnBloque]}
              onPress={() => bloque ? null : k === '⌫' ? supprimer() : k !== '' ? appuyerChiffre(k) : null}
              disabled={bloque}
            >
              <Text style={[styles.pinBtnText, bloque && { color: '#ccc' }]}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    )
  }

  // ─── ETAPE 1 — Choix du restaurant ────────────────────────
  if (etape === 1) {
    const couleurResto = (r) => r.couleur === 'vert' ? '#2D7D46' : '#EF9F27'
    return (
      <SafeAreaView style={styles.container}>
        <Image
          source={require('../assets/icon.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.appSub}>Gestion de restaurant</Text>
        <Text style={styles.question}>Choisissez votre restaurant</Text>
        {loadingRestos ? (
          <ActivityIndicator size="large" color="#EF9F27" style={{ marginTop: 40 }} />
        ) : restaurants.length === 0 ? (
          <Text style={styles.empty}>Aucun restaurant trouvé</Text>
        ) : (
          <FlatList
            key="restos-2col"
            data={restaurants}
            keyExtractor={item => item.id}
            numColumns={2}
            style={styles.list}
            contentContainerStyle={[styles.restoGrid, { paddingBottom: 60 }]}
            columnWrapperStyle={styles.restoGridRow}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.restoBadge}
                onPress={() => choisirRestaurant(item)}
                activeOpacity={0.8}
              >
                {item.photo_url ? (
                  <Image source={{ uri: item.photo_url }} style={styles.restoBadgePhoto} />
                ) : (
                  <View style={[styles.restoBadgeInitials, { backgroundColor: couleurResto(item) }]}>
                    <Text style={styles.restoBadgeInitialsTxt}>
                      {item.nom.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.restoBadgeNom} numberOfLines={2}>{item.nom}</Text>
                <Text style={styles.restoBadgeLoc} numberOfLines={1}>{item.localisation || 'Abidjan'}</Text>
                <View style={[styles.restoBadgeDot, { backgroundColor: couleurResto(item) }]} />
              </TouchableOpacity>
            )}
            ListFooterComponent={
              <TouchableOpacity style={styles.globalBtn} onPress={chargerUtilisateursGlobaux}>
                <Text style={styles.globalBtnIcon}>👑</Text>
                <View>
                  <Text style={styles.globalBtnTxt}>Accès Manager / RH</Text>
                  <Text style={styles.globalBtnSub}>Administration & ressources humaines</Text>
                </View>
                <Text style={styles.globalBtnArrow}>›</Text>
              </TouchableOpacity>
            }
          />
        )}
        <SignatureFooter />
      </SafeAreaView>
    )
  }

  // ─── ETAPE 2 — PIN restaurant ──────────────────────────────
  if (etape === 2) {
    const couleur = selectedResto?.couleur === 'vert' ? '#2D7D46' : '#EF9F27'
    return (
      <SafeAreaView style={styles.container}>
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
          <Image
            source={require('../assets/icon.png')}
            style={styles.logoImageSm}
            resizeMode="contain"
          />
          <Text style={styles.restoHeaderNom}>{selectedResto?.nom}</Text>
          <Text style={styles.restoHeaderLoc}>{selectedResto?.localisation || 'Abidjan'}</Text>
          <PinPad
            titre="Code d'accès du restaurant"
            sousTitre="Entrez le code PIN du restaurant"
            couleur={couleur}
            bloque={!!(bloqueJusquaResto && Date.now() < bloqueJusquaResto)}
          />
        </ScrollView>
        <SignatureFooter />
      </SafeAreaView>
    )
  }

  // ─── ETAPE 3 — Choix de l'utilisateur ─────────────────────
  if (etape === 3) {
    const couleur = selectedResto?.couleur === 'vert' ? '#2D7D46' : '#EF9F27'
    const globaux = utilisateurs.filter(u => ROLES_GLOBAUX.includes(u.role))
    const specifiques = utilisateurs.filter(u => !ROLES_GLOBAUX.includes(u.role))
    const modeGlobal = !selectedResto

    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => {
            setPin(''); setPinError(false)
            if (selectedResto) setEtape(2)
            else setEtape(1)
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backTxt}>‹ Retour</Text>
        </TouchableOpacity>
        {modeGlobal ? (
          <View style={[styles.restoHeader, { backgroundColor: '#EEEDFE', borderColor: '#CECBF6', borderWidth: 1 }]}>
            <Text style={{ fontSize: 18 }}>👑</Text>
            <Text style={[styles.restoHeaderNom2, { color: '#3C3489' }]}>Accès global</Text>
          </View>
        ) : (
          <View style={styles.restoHeader}>
            <View style={[styles.restoDot, { backgroundColor: couleur, width: 14, height: 14, borderRadius: 7 }]} />
            <Text style={styles.restoHeaderNom2}>{selectedResto?.nom}</Text>
          </View>
        )}
        <Text style={styles.question}>Qui êtes-vous ?</Text>
        {loadingUsers ? (
          <ActivityIndicator size="large" color="#EF9F27" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            key="users-1col"
            data={modeGlobal ? globaux : specifiques}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 60 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.userItem} onPress={() => choisirUtilisateur(item)}>
                <View style={[styles.avatar, { backgroundColor: getRoleCouleur(item.role) }]}>
                  <Text style={styles.avatarText}>
                    {item.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{item.nom}</Text>
                  <View style={styles.userRoleRow}>
                    <View style={[styles.roleBadge, { backgroundColor: getRoleBg(item.role) }]}>
                      <Text style={[styles.roleBadgeTxt, { color: getRoleCouleur(item.role) }]}>
                        {getRoleLabel(item.role)}
                      </Text>
                    </View>
                    {modeGlobal && (
                      <Text style={styles.globalTxt}>Accès global</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.arrow}>›</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>Aucun utilisateur pour ce restaurant</Text>
            }
          />
        )}
        <SignatureFooter />
      </SafeAreaView>
    )
  }

  // ─── ETAPE 4 — PIN utilisateur ─────────────────────────────
  const couleur = getRoleCouleur(selected?.role)
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        onPress={() => { setEtape(3); setPin(''); setPinError(false) }}
        style={styles.backBtn}
      >
        <Text style={styles.backTxt}>‹ Changer d'utilisateur</Text>
      </TouchableOpacity>

      <ScrollView
        style={{ width: '100%' }}
        contentContainerStyle={styles.pinScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={require('../assets/icon.png')}
          style={styles.logoImageSm}
          resizeMode="contain"
        />

        <View style={[styles.whoBox, { borderColor: couleur }]}>
          <View style={[styles.avatar, { backgroundColor: couleur }]}>
            <Text style={styles.avatarText}>
              {selected?.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.userName}>{selected?.nom}</Text>
            <Text style={styles.userSubtitle}>
              {ROLES_GLOBAUX.includes(selected?.role)
                ? 'Accès global — tous les restaurants'
                : `${selectedResto?.nom} — ${selected?.role}`}
            </Text>
          </View>
        </View>

        <PinPad
          titre="Code PIN personnel"
          sousTitre="Entrez votre code PIN"
          couleur={couleur}
          bloque={!!(bloqueJusquaUser && Date.now() < bloqueJusquaUser)}
        />
      </ScrollView>
      <SignatureFooter />
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', paddingTop: 20 },
    logoImage: { width: 200, height: 120, marginBottom: 4 },
    logoImageSm: { width: 140, height: 80, marginBottom: 8 },
    appSub: { fontSize: 13, color: colors.textMuted, marginBottom: 28 },
    question: { fontSize: 14, color: colors.textSecondary, marginBottom: 12 },
    list: { width: '100%', paddingHorizontal: 20 },
    separateur: {
      fontSize: 11, fontWeight: '600', color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.5,
      marginVertical: 10, paddingHorizontal: 4
    },
    restoItem: {
      flexDirection: 'row', alignItems: 'center', padding: 16,
      backgroundColor: colors.surfaceAlt, borderRadius: 14, marginBottom: 10,
      borderWidth: 0.5, borderColor: colors.border,
    },
    restoDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
    restoInfo: { flex: 1 },
    restoNom: { fontSize: 15, fontWeight: '600', color: colors.text },
    restoLoc: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    restoHeaderNom: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 4 },
    restoHeaderLoc: { fontSize: 12, color: colors.textMuted, marginBottom: 20 },
    restoHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surfaceAlt, paddingHorizontal: 16, paddingVertical: 10,
      borderRadius: 12, marginBottom: 16, width: '90%',
    },
    restoHeaderNom2: { fontSize: 14, fontWeight: '600', color: colors.text },
    userItem: {
      flexDirection: 'row', alignItems: 'center', padding: 14,
      backgroundColor: colors.surfaceAlt, borderRadius: 12, marginBottom: 8,
      borderWidth: 0.5, borderColor: colors.border
    },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center', marginRight: 12
    },
    avatarText: { fontSize: 14, fontWeight: '600', color: '#fff' },
    userInfo: { flex: 1 },
    userName: { fontSize: 14, fontWeight: '600', color: colors.text },
    userRoleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    roleBadgeTxt: { fontSize: 11, fontWeight: '500' },
    globalTxt: { fontSize: 10, color: colors.textMuted },
    arrow: { fontSize: 18, color: colors.border },
    empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
    backBtn: { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 8 },
    backTxt: { fontSize: 15, color: '#EF9F27', fontWeight: '500' },
    whoBox: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.surfaceAlt, padding: 14, borderRadius: 14,
      marginVertical: 16, width: '90%', borderWidth: 1.5,
    },
    userSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    pinContainer: { alignItems: 'center', width: '100%', paddingHorizontal: 20, paddingBottom: 20 },
    pinTitre: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 6 },
    pinSousTitre: { fontSize: 13, color: colors.textMuted, marginBottom: 20 },
    dots: { flexDirection: 'row', gap: 14, marginBottom: 12 },
    dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#EF9F27' },
    dotError: { borderColor: '#A32D2D', backgroundColor: '#FAECE7' },
    pinErrorTxt: { fontSize: 13, color: '#A32D2D', marginBottom: 16, fontWeight: '500' },
    pinpad: { flexDirection: 'row', flexWrap: 'wrap', width: 252, gap: 10, marginTop: 16 },
    pinBtn: {
      width: 74, height: 74, borderRadius: 16, backgroundColor: colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: colors.border
    },
    pinBtnEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
    pinBtnBloque: { backgroundColor: colors.borderLight, borderColor: colors.border },
    pinBtnText: { fontSize: 24, fontWeight: '500', color: colors.text },
    restoGrid: { paddingHorizontal: 16, paddingBottom: 30, paddingTop: 8 },
    restoGridRow: { justifyContent: 'space-between', marginBottom: 14 },
    restoBadge: {
      width: '48%', backgroundColor: colors.surfaceAlt, borderRadius: 18,
      alignItems: 'center', padding: 16, borderWidth: 0.5, borderColor: colors.border,
      position: 'relative',
    },
    restoBadgePhoto: { width: 80, height: 80, borderRadius: 14, marginBottom: 10 },
    restoBadgeInitials: {
      width: 80, height: 80, borderRadius: 14, marginBottom: 10,
      alignItems: 'center', justifyContent: 'center',
    },
    restoBadgeInitialsTxt: { fontSize: 26, fontWeight: '800', color: '#fff' },
    restoBadgeNom: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 3 },
    restoBadgeLoc: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
    restoBadgeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
    globalBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.primaryLight, borderRadius: 16, padding: 16,
      marginTop: 8, marginHorizontal: 0,
      borderWidth: 1, borderColor: colors.primaryText,
    },
    globalBtnIcon: { fontSize: 28 },
    globalBtnTxt: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
    globalBtnSub: { fontSize: 11, color: colors.primary, marginTop: 2 },
    globalBtnArrow: { marginLeft: 'auto', fontSize: 20, color: colors.primary },
    pinScrollContent: { alignItems: 'center', paddingBottom: 40, paddingTop: 8 },
  })
}