import Constants from 'expo-constants'
import { StyleSheet, Text, View } from 'react-native'

const version = Constants.expoConfig?.version || Constants.manifest?.version || '—'

export default function SignatureFooter() {
  return (
    <View style={styles.wrapper} pointerEvents="none">
      <Text style={styles.copy}>© 2026 — Tous droits réservés</Text>
      <Text style={styles.name}>M. DJE</Text>
      <Text style={styles.version}>v{version}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 18,
    paddingTop: 8,
    alignItems: 'center',
  },
  copy: { fontSize: 10, color: '#666666', textAlign: 'center' },
  name: { fontSize: 13, color: '#C9A84C', textAlign: 'center', fontWeight: '600', letterSpacing: 2, marginTop: 2 },
  version: { fontSize: 10, color: '#aaaaaa', textAlign: 'center', marginTop: 3, letterSpacing: 1 },
})
