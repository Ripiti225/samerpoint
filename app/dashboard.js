// Route du Dashboard. Son code et ses graphiques (Victory) ne se téléchargent qu'ici,
// pour ne pas alourdir l'ouverture de l'app pour ceux qui n'en ont pas besoin.
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Platform, SafeAreaView, Text, TouchableOpacity, View } from 'react-native'
import { SqueletteDashboard } from '../components/ui/Squelette'
import { useTheme } from '../context/ThemeContext'

export default function Dashboard() {
  const { colors } = useTheme()
  const [Ecran, setEcran] = useState(null)
  const [echec, setEchec] = useState(false)

  const charger = useCallback(() => {
    setEchec(false)
    import('../components/dashboard/EcranDashboard')
      .then(module => setEcran(() => module.default))
      .catch(() => setEchec(true))
  }, [])
  useEffect(() => { charger() }, [charger])

  if (Ecran) return <Ecran />

  // Web : recharger la page récupère aussi la dernière version si une mise à jour vient de sortir.
  const reessayer = () => (Platform.OS === 'web' ? window.location.reload() : charger())

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {echec ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text style={{ fontSize: 15, color: colors.text, textAlign: 'center' }}>
            Le Dashboard n&apos;a pas pu s&apos;ouvrir. Vérifie ta connexion, puis réessaie.
          </Text>
          <TouchableOpacity
            onPress={reessayer} accessibilityRole="button"
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 24, borderRadius: 12, backgroundColor: colors.primary }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Réessayer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} accessibilityRole="button"
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 24 }}
          >
            <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>‹ Retour</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SqueletteDashboard ecran="dashboard_code" style={{ flex: 1, padding: 14 }} />
      )}
    </SafeAreaView>
  )
}
