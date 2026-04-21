import { Stack } from 'expo-router'
import { AppProvider } from '../context/AppContext'

export default function RootLayout() {
  return (
    <AppProvider>
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