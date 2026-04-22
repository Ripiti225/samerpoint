import { router, Stack, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { AppProvider, useApp } from '../context/AppContext'

// Redirige vers /accueil si la session existe mais le contexte est vide (après reload web)
function SessionGuard() {
  const { roleActif } = useApp()
  const segments = useSegments()

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const currentRoute = segments[0] || ''
    const publicRoutes = ['login', 'index', '(tabs)', '']
    if (publicRoutes.includes(currentRoute)) return

    if (!roleActif) {
      // Contexte vide sur un écran protégé → chercher la session
      try {
        const raw = localStorage.getItem('samerpoint_session') || sessionStorage.getItem('samerpoint_session')
        const session = raw ? JSON.parse(raw) : null
        if (session?.roleActif) {
          // Session valide → retour à l'accueil
          router.replace({
            pathname: '/accueil',
            params: { nom: session.userNom || '', role: session.roleActif }
          })
        } else {
          // Pas de session → login
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
