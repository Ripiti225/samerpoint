import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useNetwork } from '../context/NetworkContext'

export default function NetworkStatusBar() {
  const { isOnline, isSyncing, queueSize, syncNow } = useNetwork()

  // En ligne, rien en attente → invisible
  if (isOnline && !isSyncing && queueSize === 0) return null

  if (isSyncing) {
    return (
      <View style={[styles.bar, styles.syncing]}>
        <Text style={styles.txt}>
          🔄 Synchronisation en cours...{queueSize > 0 ? ` (${queueSize})` : ''}
        </Text>
      </View>
    )
  }

  if (!isOnline) {
    return (
      <View style={[styles.bar, styles.offline]}>
        <Text style={styles.txt}>
          🔴 Hors ligne — modifications sauvegardées localement
        </Text>
      </View>
    )
  }

  // En ligne mais file d'attente non vide
  return (
    <View style={[styles.bar, styles.pending]}>
      <Text style={[styles.txt, { flex: 1 }]}>
        ⚠️ {queueSize} modification{queueSize > 1 ? 's' : ''} en attente
      </Text>
      <TouchableOpacity onPress={syncNow} style={styles.syncBtn}>
        <Text style={styles.syncBtnTxt}>Synchroniser</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  offline: { backgroundColor: '#A32D2D' },
  syncing: { backgroundColor: '#D4790A' },
  pending: { backgroundColor: '#C07A00', justifyContent: 'space-between' },
  txt: { color: '#fff', fontSize: 12, fontWeight: '500' },
  syncBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  syncBtnTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
})
