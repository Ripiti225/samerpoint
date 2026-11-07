import '../lib/webAlert' // remplace Alert.alert (no-op sur web) par window.alert/confirm
import * as Notifications from 'expo-notifications'
import { router, Stack, useSegments } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { AppState, Platform, View } from 'react-native'
import BandeauRecherche from '../components/BandeauRecherche'
import NetworkStatusBar from '../components/NetworkStatusBar'
import { AppProvider, useApp } from '../context/AppContext'
import { NetworkProvider } from '../context/NetworkContext'
import { NotificationsProvider } from '../context/NotificationsContext'
import { ThemeProvider } from '../context/ThemeContext'
import { estInactif, INACTIVITY_TIMEOUT_MS } from '../lib/inactivityLock'
import { mesurerDemarrage } from '../lib/mesuresVitesseDb'

const PUBLIC_ROUTES = ['login', 'index', '(tabs)', '']

function SessionGuard() {
  const {
    roleActif, restaurantId, lastRoute,
    setRoleActif, setRestaurantId, setRestaurantNom,
    setUserId, setUserNom, setPointId, setDateJour, setPointValide,
    setLastRoute,
    setFournisseursJour, setDepensesJour, setPresencesJour,
    setLivraisonsJour, setVentesJour, setPaiesJour, setInventaireJour,
  } = useApp()
  const segments = useSegments()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const roleRef = useRef(roleActif)
  roleRef.current = roleActif

  // Une seule mesure par ouverture : mesurerDemarrage ignore les appels suivants.
  useEffect(() => { mesurerDemarrage({ role: roleActif, restaurantId }) }, [roleActif, restaurantId])

  // Listener push — ici on a accès au rôle pour filtrer la navigation
  useEffect(() => {
    if (Platform.OS === 'web') return
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data ?? {}
      const screen = data.screen as string | undefined
      if (!screen) return
      const role = roleRef.current
      // Vérification de rôle avant navigation
      if (screen === 'gerant-caissier' && role !== 'gerant') return
      if (screen === 'verification' && role !== 'manager' && role !== 'directeur') return
      const { screen: _, ...params } = data as Record<string, unknown>
      router.push({ pathname: `/${screen}` as any, params: params as any })
    })
    return () => sub.remove()
  }, [])

  // Mémoriser la route actuelle pour y revenir après rechargement iOS
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (!roleActif) return
    const currentRoute = segments[0] || ''
    if (!PUBLIC_ROUTES.includes(currentRoute) && currentRoute) {
      setLastRoute(currentRoute)
    }
  }, [segments, roleActif])

  // CAS iOS : page rechargée → index.js redirige vers /login → mais roleActif est
  // déjà restauré depuis localStorage par AppContext. Revenir au bon écran.
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (!roleActif) return  // Pas de session dans le contexte

    const currentRoute = segments[0] || ''
    if (!PUBLIC_ROUTES.includes(currentRoute)) return  // Déjà sur le bon écran

    // On a une session MAIS on est sur login/index/root → iOS a rechargé la page
    // Utiliser lastRoute depuis le contexte React : il est déjà null si login.js l'a
    // remis à zéro dans le même batch, ce qui empêche la redirection parasite.
    const target = lastRoute

    // Pas de lastRoute = première connexion normale ou caissier re-login, laisser le flux habituel
    if (!target) return

    try {
      if (!PUBLIC_ROUTES.includes(target) && target !== 'accueil') {
        router.replace(`/${target}` as any)
      } else {
        const raw = localStorage.getItem('samerpoint_session')
          || sessionStorage.getItem('samerpoint_session')
        const session = raw ? JSON.parse(raw) : null
        router.replace({
          pathname: '/accueil',
          params: { nom: session?.userNom || '', role: roleActif }
        })
      }
    } catch {
      // Silencieux — le flux normal prend le relais
    }
  }, [roleActif, segments, lastRoute])

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const currentRoute = segments[0] || ''
    if (PUBLIC_ROUTES.includes(currentRoute)) return
    if (roleActif) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        const raw = localStorage.getItem('samerpoint_session')
        const session = raw ? JSON.parse(raw) : null

        if (session?.roleActif) {
          // Restaurer identité
          setRoleActif(session.roleActif)
          setRestaurantId(session.restaurantId || null)
          setRestaurantNom(session.restaurantNom || null)
          setUserId(session.userId || null)
          setUserNom(session.userNom || null)
          if (session.pointId) setPointId(session.pointId)
          if (session.dateJour) setDateJour(session.dateJour)
          if (session.pointValide) setPointValide(true)

          // Restaurer données du jour (perdues quand iOS recharge la page)
          if (session.fournisseursJour) setFournisseursJour(session.fournisseursJour)
          if (session.depensesJour) setDepensesJour(session.depensesJour)
          if (session.presencesJour) setPresencesJour(session.presencesJour)
          if (session.livraisonsJour) setLivraisonsJour(session.livraisonsJour)
          if (session.ventesJour) setVentesJour(session.ventesJour)
          if (session.paiesJour) setPaiesJour(session.paiesJour)
          if (session.inventaireJour) setInventaireJour(session.inventaireJour)

          // Revenir à l'écran où l'utilisateur était (ex: fournisseurs après photo)
          const target = session.lastRoute
          const isProtected = target && !PUBLIC_ROUTES.includes(target) && target !== 'accueil'
          if (isProtected) {
            router.replace(`/${target}` as any)
          } else {
            router.replace({
              pathname: '/accueil',
              params: { nom: session.userNom || '', role: session.roleActif }
            })
          }
        } else {
          router.replace('/login')
        }
      } catch {
        router.replace('/login')
      }
    }, 400)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [roleActif, segments])

  return null
}

function InactivityGuard({ children }) {
  const { roleActif, verrouillerSession } = useApp()
  const segments = useSegments()
  const derniereInteraction = useRef(Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const verrouiller = useCallback(() => {
    if (!roleActif) return
    verrouillerSession(segments[0] || null)
    router.replace('/login')
  }, [roleActif, segments, verrouillerSession])

  const programmerVerrouillage = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!roleActif) return
    const restant = Math.max(0, INACTIVITY_TIMEOUT_MS - (Date.now() - derniereInteraction.current))
    timer.current = setTimeout(verrouiller, restant)
  }, [roleActif, verrouiller])

  const enregistrerInteraction = useCallback(() => {
    derniereInteraction.current = Date.now()
    programmerVerrouillage()
  }, [programmerVerrouillage])

  useEffect(() => {
    derniereInteraction.current = Date.now()
    programmerVerrouillage()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [roleActif, programmerVerrouillage])

  useEffect(() => {
    if (!roleActif) return
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        if (estInactif(derniereInteraction.current)) verrouiller()
        else programmerVerrouillage()
      }
    })
    if (Platform.OS === 'web') {
      const interactionWeb = () => enregistrerInteraction()
      window.addEventListener('keydown', interactionWeb)
      window.addEventListener('mousedown', interactionWeb)
      return () => {
        subscription.remove()
        window.removeEventListener('keydown', interactionWeb)
        window.removeEventListener('mousedown', interactionWeb)
      }
    }
    return () => subscription.remove()
  }, [roleActif, enregistrerInteraction, programmerVerrouillage, verrouiller])

  return <View style={{ flex: 1 }} onTouchStart={enregistrerInteraction}>{children}</View>
}

export default function RootLayout() {

  return (
    <ThemeProvider>
    <AppProvider>
      <NetworkProvider>
      <NotificationsProvider>
        <SessionGuard />
        <NetworkStatusBar />
        <InactivityGuard>
        <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="choix-date" />
        <Stack.Screen name="accueil" />
        <Stack.Screen name="depenses" />
        <Stack.Screen name="presences" />
        <Stack.Screen name="inventaire" />
        <Stack.Screen name="livraisons" />
        <Stack.Screen name="ventes" />
        <Stack.Screen name="fournisseurs" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="dashboard-global" />
        <Stack.Screen name="parametres" />
        <Stack.Screen name="equipe" />
        <Stack.Screen name="salaires" />
        <Stack.Screen name="evenements" />
        <Stack.Screen name="modifier-point" />
        <Stack.Screen name="modifier-inventaire" />
        <Stack.Screen name="recap-point" />
        <Stack.Screen name="rh" />
        <Stack.Screen name="documents" />
        <Stack.Screen name="point-shift" />
        <Stack.Screen name="verification" />
        <Stack.Screen name="rapports" />
        <Stack.Screen name="stats-caissiers" />
        <Stack.Screen name="journal" />
        <Stack.Screen name="recherche" />
        <Stack.Screen name="gerant-caissier" />
        <Stack.Screen name="deductions-gerant" />
        <Stack.Screen name="selectionner-journee" />
        <Stack.Screen name="credits-fournisseurs" />
        <Stack.Screen name="demandes" />
        <Stack.Screen name="demandes-admin" />
        <Stack.Screen name="(tabs)" />
      </Stack>
        <BandeauRecherche />
        </InactivityGuard>
      </NotificationsProvider>
      </NetworkProvider>
    </AppProvider>
    </ThemeProvider>
  )
}
