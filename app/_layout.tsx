import { router, Stack, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { AppProvider, useApp } from '../context/AppContext'

// Restaure la session ET le contexte React après un reload sur iPhone/Chrome
function SessionGuard() {
  const {
    roleActif,
    setRoleActif, setRestaurantId, setRestaurantNom,
    setUserId, setUserNom, setPointId, setDateJour, setPointValide,
  } = useApp()
  const segments = useSegments()

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const currentRoute = segments[0] || ''
    const publicRoutes = ['login', 'index', '(tabs)', '']
    if (publicRoutes.includes(currentRoute)) return

    if (!roleActif) {
      try {
        const raw = localStorage.getItem('samerpoint_session')
          || sessionStorage.getItem('samerpoint_session')
        const session = raw ? JSON.parse(raw) : null

        if (session?.roleActif) {
          // ── Restaurer le contexte React EN PREMIER ──────────────
          // Sans ça, roleActif reste null → boucle infinie de redirections
          setRoleActif(session.roleActif)
          setRestaurantId(session.restaurantId || null)
          setRestaurantNom(session.restaurantNom || null)
          setUserId(session.userId || null)
          setUserNom(session.userNom || null)
          if (session.pointId) setPointId(session.pointId)
          if (session.dateJour) setDateJour(session.dateJour)
          if (session.pointValide) setPointValide(true)

          // ── Puis naviguer vers accueil ──────────────────────────
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
