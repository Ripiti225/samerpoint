import { router, Stack, useSegments } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { AppProvider, useApp } from '../context/AppContext'

function SessionGuard() {
  const {
    roleActif,
    setRoleActif, setRestaurantId, setRestaurantNom,
    setUserId, setUserNom, setPointId, setDateJour, setPointValide,
  } = useApp()
  const segments = useSegments()
  // Empêche le Guard d'agir pendant une navigation interne (ex: login → accueil)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const currentRoute = segments[0] || ''
    const publicRoutes = ['login', 'index', '(tabs)', '']
    if (publicRoutes.includes(currentRoute)) return

    // Si le contexte est déjà rempli, rien à faire
    if (roleActif) return

    // Attendre 400ms pour laisser React propager le contexte après une connexion
    // (évite de rediriger vers login juste après que verifierPinUtilisateur ait
    //  appelé setRoleActif mais avant que le re-render soit terminé)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      // Re-vérifier après le délai : si roleActif a été mis à jour, ignorer
      // On ne peut pas lire roleActif ici (closure stale), donc on lit le storage
      try {
        const raw = localStorage.getItem('samerpoint_session')
          || sessionStorage.getItem('samerpoint_session')
        const session = raw ? JSON.parse(raw) : null

        if (session?.roleActif) {
          setRoleActif(session.roleActif)
          setRestaurantId(session.restaurantId || null)
          setRestaurantNom(session.restaurantNom || null)
          setUserId(session.userId || null)
          setUserNom(session.userNom || null)
          if (session.pointId) setPointId(session.pointId)
          if (session.dateJour) setDateJour(session.dateJour)
          if (session.pointValide) setPointValide(true)
          router.replace({
            pathname: '/accueil',
            params: { nom: session.userNom || '', role: session.roleActif }
          })
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
