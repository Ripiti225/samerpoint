import { router, Stack, useSegments } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { AppProvider, useApp } from '../context/AppContext'

const PUBLIC_ROUTES = ['login', 'index', '(tabs)', '']

function SessionGuard() {
  const {
    roleActif,
    setRoleActif, setRestaurantId, setRestaurantNom,
    setUserId, setUserNom, setPointId, setDateJour, setPointValide,
    setLastRoute,
    setFournisseursJour, setDepensesJour, setPresencesJour,
    setLivraisonsJour, setVentesJour, setPaiesJour, setInventaireJour,
  } = useApp()
  const segments = useSegments()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    try {
      const raw = localStorage.getItem('samerpoint_session')
        || sessionStorage.getItem('samerpoint_session')
      const session = raw ? JSON.parse(raw) : null
      const target = session?.lastRoute

      // Pas de lastRoute = première connexion normale, laisser le flux habituel
      if (!target) return

      if (!PUBLIC_ROUTES.includes(target) && target !== 'accueil') {
        router.replace(`/${target}` as any)
      } else {
        router.replace({
          pathname: '/accueil',
          params: { nom: session?.userNom || '', role: roleActif }
        })
      }
    } catch {
      // Silencieux — le flux normal prend le relais
    }
  }, [roleActif, segments])

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const currentRoute = segments[0] || ''
    if (PUBLIC_ROUTES.includes(currentRoute)) return
    if (roleActif) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        const raw = localStorage.getItem('samerpoint_session')
          || sessionStorage.getItem('samerpoint_session')
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

export default function RootLayout() {
  return (
    <AppProvider>
      <SessionGuard />
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
        <Stack.Screen name="restaurants" />
        <Stack.Screen name="equipe" />
        <Stack.Screen name="modifier-point" />
        <Stack.Screen name="modifier-inventaire" />
        <Stack.Screen name="recap-point" />
        <Stack.Screen name="rh" />
        <Stack.Screen name="charges" />
        <Stack.Screen name="documents" />
        <Stack.Screen name="point-shift" />
        <Stack.Screen name="verification" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AppProvider>
  )
}
