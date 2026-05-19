import { router } from 'expo-router'
import { useMemo } from 'react'
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'

const MENU = [
  { icon: '⏱️', titre: 'Point / Shift', sous: 'Faire le point de shift', route: '/point-shift' },
  { icon: '📋', titre: 'Dépenses', sous: 'Marché, paie…', route: '/depenses' },
  { icon: '🧾', titre: 'Fournisseurs', sous: 'Factures & paiements', route: '/fournisseurs' },
  { icon: '👥', titre: 'Présences', sous: 'Statuts équipe', route: '/presences' },
  { icon: '📦', titre: 'Inventaire', sous: 'Stock par shift', route: '/inventaire' },
]

export default function GerantCaissierScreen() {
  const { pointValide, estBloque } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const menuAvecBloque = MENU.map(item => ({
    ...item,
    bloque: item.route === '/depenses' || item.route === '/fournisseurs' || item.route === '/presences'
      ? estBloque(pointValide)
      : false,
  }))

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Espace Caissier</Text>
          <Text style={styles.headerSub}>Actions du jour</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {menuAvecBloque.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.card, item.bloque && styles.cardBloque]}
              onPress={() => !item.bloque && router.push(item.route)}
              disabled={item.bloque}
            >
              <Text style={styles.cardIcon}>{item.icon}</Text>
              <Text style={[styles.cardTitre, item.bloque && styles.cardTitreBloque]}>
                {item.titre}
              </Text>
              <Text style={[styles.cardSous, item.bloque && styles.cardSousBloque]}>
                {item.bloque ? '🔒 Verrouillé' : item.sous}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  body: { flex: 1, padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  card: {
    width: '47%', backgroundColor: colors.surface, borderRadius: 14,
    padding: 14, borderWidth: 0.5, borderColor: colors.borderLight
  },
  cardBloque: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: 0.6 },
  cardIcon: { fontSize: 26, marginBottom: 8 },
  cardTitre: { fontSize: 13, fontWeight: '600', color: colors.text },
  cardTitreBloque: { color: '#aaa' },
  cardSous: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  cardSousBloque: { color: '#ccc' },
}) }
