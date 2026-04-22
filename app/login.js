import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { getOrCreatePoint } from '../lib/api'
import { supabase } from '../lib/supabase'

const ROLES_GLOBAUX = ['manager', 'rh']

export default function LoginScreen() {
  const [etape, setEtape] = useState(1)
  const [restaurants, setRestaurants] = useState([])
  const [utilisateurs, setUtilisateurs] = useState([])
  const [selectedResto, setSelectedResto] = useState(null)
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [chargement, setChargement] = useState(false)
  const [loadingRestos, setLoadingRestos] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [pinError, setPinError] = useState(false)

  const {
    setRoleActif, setPointId, setDateJour, resetJour,
    setPointValide, setRestaurantId, setRestaurantNom,
    setUserId, setUserNom,
  } = useApp()

  useEffect(() => { fetchRestaurants() }, [])

  async function fetchRestaurants() {
    setLoadingRestos(true)
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
    setLoadingRestos(false)
  }

  function choisirRestaurant(resto) {
    setSelectedResto(resto)
    setPin('')
    setPinError(false)
    setEtape(2)
  }

  function verifierPinRestaurant(pinSaisi) {
    if (pinSaisi === selectedResto.pin) {
      setPinError(false)
      setPin('')
      chargerUtilisateurs()
    } else {
      setPinError(true)
      setPin('')
    }
  }

  async function chargerUtilisateurs() {
    setLoadingUsers(true)
    setEtape(3)
    const { data } = await supabase
      .from('utilisateurs')
      .select('*, restaurants(id, nom)')
      .eq('actif', true)
      .or(`restaurant_id.eq.${selectedResto.id},restaurant_id.is.null`)
      .order('nom')
    setUtilisateurs(data || [])
    setLoadingUsers(false)
  }

  async function chargerUtilisateursGlobaux() {
    setSelectedResto(null)
    setLoadingUsers(true)
    setEtape(3)
    const { data } = await supabase
      .from('utilisateurs')
      .select('*')
      .eq('actif', true)
      .in('role', ROLES_GLOBAUX)
      .order('nom')
    // Dédoublonner par nom+rôle (ces profils existent dans chaque restaurant)
    const vus = new Set()
    const uniques = (data || []).filter(u => {
      const cle = `${u.nom.trim().toLowerCase()}-${u.role}`
      if (vus.has(cle)) return false
      vus.add(cle)
      return true
    })
    setUtilisateurs(uniques)
    setLoadingUsers(false)
  }

  function choisirUtilisateur(user) {
    setSelected(user)
    setPin('')
    setPinError(false)
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
    if (pinSaisi !== selected.pin) {
      setPinError(true)
      setPin('')
      return
    }

    setPinError(false)
    setRoleActif(selected.role)
    resetJour()

    // Stocker userId et userNom dans le contexte
    setUserId(selected.id)
    setUserNom(selected.nom)

    const estGlobal = ROLES_GLOBAUX.includes(selected.role)
    const restoId = estGlobal ? null : selectedResto?.id
    const restoNom = estGlobal ? null : selectedResto?.nom
    setRestaurantId(restoId)
    setRestaurantNom(restoNom)

    if (selected.role === 'manager') {
      // Manager → accueil avec menu complet
      router.replace({
        pathname: '/accueil',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
      })

    } else if (selected.role === 'rh') {
      // RH → accueil avec menu limité
      router.replace({
        pathname: '/accueil',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
      })

    } else if (selected.role === 'gerant') {
      // Gérant → choix de la date
      router.replace({
        pathname: '/choix-date',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
      })

    } else {
      // ─── CAISSIER ──────────────────────────────────────────
      // On charge UNIQUEMENT le pointId — pas les dépenses/fournisseurs/présences
      // car ils appartiennent aux shifts déjà validés
      // Le caissier repart TOUJOURS de zéro
      setChargement(true)
      const today = new Date().toISOString().split('T')[0]
      const point = await getOrCreatePoint(today, selected.id, restoId)

      if (point) {
        setPointId(point.id)
        setDateJour(today)
        setPointValide(point.valide || false)
        // ✅ On ne charge PAS les données existantes
        // Le caissier repart de zéro — ses dépenses sont fraîches
      }

      setChargement(false)
      router.replace({
        pathname: '/accueil',
        params: { userId: selected.id, nom: selected.nom, role: selected.role }
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

  function PinPad({ titre, sousTitre, couleur }) {
    return (
      <View style={styles.pinContainer}>
        <Text style={styles.pinTitre}>{titre}</Text>
        <Text style={styles.pinSousTitre}>{sousTitre}</Text>
        <View style={styles.dots}>
          {[0,1,2,3].map(i => (
            <View key={i} style={[
              styles.dot,
              pin.length > i && { backgroundColor: couleur },
              { borderColor: pinError ? '#A32D2D' : couleur },
              pinError && styles.dotError,
            ]} />
          ))}
        </View>
        {pinError && (
          <Text style={styles.pinErrorTxt}>❌ Code incorrect, réessayez</Text>
        )}
        <View style={styles.pinpad}>
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.pinBtn, k === '' && styles.pinBtnEmpty]}
              onPress={() => k === '⌫' ? supprimer() : k !== '' ? appuyerChiffre(k) : null}
            >
              <Text style={styles.pinBtnText}>{k}</Text>
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
            contentContainerStyle={styles.restoGrid}
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
          />
        </ScrollView>
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
            data={modeGlobal
              ? globaux
              : specifiques
            }
            keyExtractor={(item, index) => item.separateur ? 'sep' : item.id}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 20 }}
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

        {chargement ? (
          <View style={{ marginTop: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={couleur} />
            <Text style={{ fontSize: 13, color: '#888', marginTop: 12 }}>
              Chargement...
            </Text>
          </View>
        ) : (
          <PinPad
            titre="Code PIN personnel"
            sousTitre="Entrez votre code PIN"
            couleur={couleur}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', paddingTop: 20 },
  logoImage: { width: 200, height: 120, marginBottom: 4 },
  logoImageSm: { width: 140, height: 80, marginBottom: 8 },
  appSub: { fontSize: 13, color: '#888', marginBottom: 28 },
  question: { fontSize: 14, color: '#555', marginBottom: 12 },
  list: { width: '100%', paddingHorizontal: 20 },
  separateur: {
    fontSize: 11, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginVertical: 10, paddingHorizontal: 4
  },
  restoItem: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    backgroundColor: '#f9f9f9', borderRadius: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: '#eee',
  },
  restoDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  restoInfo: { flex: 1 },
  restoNom: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  restoLoc: { fontSize: 11, color: '#888', marginTop: 2 },
  restoHeaderNom: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  restoHeaderLoc: { fontSize: 12, color: '#888', marginBottom: 20 },
  restoHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f5f5f5', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 12, marginBottom: 16, width: '90%',
  },
  restoHeaderNom2: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  userItem: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: '#f9f9f9', borderRadius: 12, marginBottom: 8,
    borderWidth: 0.5, borderColor: '#eee'
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginRight: 12
  },
  avatarText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  userRoleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  roleBadgeTxt: { fontSize: 11, fontWeight: '500' },
  globalTxt: { fontSize: 10, color: '#888' },
  arrow: { fontSize: 18, color: '#ccc' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  backBtn: { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 8 },
  backTxt: { fontSize: 15, color: '#EF9F27', fontWeight: '500' },
  whoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#f9f9f9', padding: 14, borderRadius: 14,
    marginVertical: 16, width: '90%', borderWidth: 1.5,
  },
  userSubtitle: { fontSize: 12, color: '#888', marginTop: 2 },
  pinContainer: { alignItems: 'center', width: '100%', paddingHorizontal: 20, paddingBottom: 20 },
  pinTitre: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 6 },
  pinSousTitre: { fontSize: 13, color: '#888', marginBottom: 20 },
  dots: { flexDirection: 'row', gap: 14, marginBottom: 12 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#EF9F27' },
  dotError: { borderColor: '#A32D2D', backgroundColor: '#FAECE7' },
  pinErrorTxt: { fontSize: 13, color: '#A32D2D', marginBottom: 16, fontWeight: '500' },
  pinpad: { flexDirection: 'row', flexWrap: 'wrap', width: 252, gap: 10, marginTop: 16 },
  pinBtn: {
    width: 74, height: 74, borderRadius: 16, backgroundColor: '#f5f5f5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: '#eee'
  },
  pinBtnEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  pinBtnText: { fontSize: 24, fontWeight: '500', color: '#1a1a1a' },
  restoGrid: { paddingHorizontal: 16, paddingBottom: 30, paddingTop: 8 },
  restoGridRow: { justifyContent: 'space-between', marginBottom: 14 },
  restoBadge: {
    width: '48%', backgroundColor: '#f9f9f9', borderRadius: 18,
    alignItems: 'center', padding: 16, borderWidth: 0.5, borderColor: '#eee',
    position: 'relative',
  },
  restoBadgePhoto: { width: 80, height: 80, borderRadius: 14, marginBottom: 10 },
  restoBadgeInitials: {
    width: 80, height: 80, borderRadius: 14, marginBottom: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  restoBadgeInitialsTxt: { fontSize: 26, fontWeight: '800', color: '#fff' },
  restoBadgeNom: { fontSize: 13, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', marginBottom: 3 },
  restoBadgeLoc: { fontSize: 10, color: '#888', textAlign: 'center' },
  restoBadgeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
  globalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#EEEDFE', borderRadius: 16, padding: 16,
    marginTop: 8, marginHorizontal: 0,
    borderWidth: 1, borderColor: '#CECBF6',
  },
  globalBtnIcon: { fontSize: 28 },
  globalBtnTxt: { fontSize: 14, fontWeight: '700', color: '#3C3489' },
  globalBtnSub: { fontSize: 11, color: '#6B63C4', marginTop: 2 },
  globalBtnArrow: { marginLeft: 'auto', fontSize: 20, color: '#6B63C4' },
  pinScrollContent: { alignItems: 'center', paddingBottom: 40, paddingTop: 8 },
})