/*
 * Écran admin — Récap des vérifications de stock (manager / directeur / RH).
 * Permet de contrôler les comptages faits par le(s) vérificateur(s).
 * Accessible depuis l'accueil. Réutilise le composant RecapVerifications.
 */

import { router } from 'expo-router'
import { useMemo } from 'react'
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import RecapVerifications from '../components/RecapVerifications'
import { useTheme } from '../context/ThemeContext'

export default function RecapVerificationsScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Vérifications stock</Text>
          <Text style={styles.headerSub}>Comptages des vérificateurs</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>
      <RecapVerifications colors={colors} />
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      backgroundColor: colors.headerBg, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
    headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
    headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  })
}
