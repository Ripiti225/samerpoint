import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { ACTION_LABELS, chargerJournal } from '../lib/journal'

function formatHeure(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatRelative(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `Il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Il y a ${hours}h`
  const days = Math.floor(hours / 24)
  return `Il y a ${days} jour${days > 1 ? 's' : ''}`
}

const FILTRES = [
  { key: null, label: 'Tout' },
  { key: 'point_valide', label: '✅ Validations' },
  { key: 'shift_sauvegarde', label: '⏱️ Shifts' },
  { key: 'depenses_sauvegardees', label: '📋 Dépenses' },
  { key: 'inventaire_sauvegarde', label: '📦 Inventaire' },
]

export default function JournalScreen() {
  const { restaurantId } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filtreAction, setFiltreAction] = useState(null)

  useEffect(() => { charger() }, [filtreAction, restaurantId])

  async function charger() {
    setLoading(true)
    try {
      const data = await chargerJournal({ restaurantId, limite: 100, action: filtreAction })
      setEntries(data)
    } catch (_) {}
    setLoading(false)
  }

  async function onRefresh() {
    setRefreshing(true)
    await charger()
    setRefreshing(false)
  }

  // Regrouper par date
  const grouped = useMemo(() => {
    const map = {}
    for (const e of entries) {
      const date = (e.created_at || '').split('T')[0]
      if (!map[date]) map[date] = []
      map[date].push(e)
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries])

  function formatDateGroupe(dateStr) {
    const [y, m, d] = dateStr.split('-')
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    if (dateStr === today) return "Aujourd'hui"
    if (dateStr === yesterday) return 'Hier'
    return `${d}/${m}/${y}`
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Journal d'activité</Text>
        <Text style={styles.headerSub}>Historique de toutes les actions</Text>
      </View>

      {/* Filtres */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtreBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}>
        {FILTRES.map(f => (
          <TouchableOpacity
            key={String(f.key)}
            style={[styles.filtreBtn, filtreAction === f.key && styles.filtreBtnActif]}
            onPress={() => setFiltreAction(f.key)}
          >
            <Text style={[styles.filtreTxt, filtreAction === f.key && styles.filtreTxtActif]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {grouped.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTxt}>Aucune activité enregistrée</Text>
            </View>
          ) : (
            grouped.map(([date, items]) => (
              <View key={date}>
                <Text style={styles.dateLabel}>{formatDateGroupe(date)}</Text>
                {items.map(e => (
                  <EntryRow key={e.id} entry={e} styles={styles} colors={colors} />
                ))}
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function EntryRow({ entry, styles, colors }) {
  const [expanded, setExpanded] = useState(false)
  const meta = ACTION_LABELS[entry.action] || { icon: '📝', label: entry.action }
  const details = entry.details || {}
  const hasDetails = Object.keys(details).length > 0

  return (
    <TouchableOpacity
      style={styles.entryRow}
      onPress={() => hasDetails && setExpanded(e => !e)}
      activeOpacity={hasDetails ? 0.7 : 1}
    >
      <View style={styles.entryIcon}>
        <Text style={styles.entryIconTxt}>{meta.icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.entryHeader}>
          <Text style={styles.entryLabel}>{meta.label}</Text>
          <Text style={styles.entryTime}>{formatRelative(entry.created_at)}</Text>
        </View>
        {entry.user_nom && (
          <Text style={styles.entrySub}>👤 {entry.user_nom}</Text>
        )}
        {expanded && hasDetails && (
          <View style={styles.detailsBox}>
            {Object.entries(details).map(([k, v]) => (
              <Text key={k} style={styles.detailLine}>
                <Text style={{ fontWeight: '600' }}>{k}</Text> : {String(v)}
              </Text>
            ))}
            <Text style={styles.detailTime}>{formatHeure(entry.created_at)}</Text>
          </View>
        )}
      </View>
      {hasDetails && (
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      )}
    </TouchableOpacity>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
    backBtn: { marginBottom: 8 },
    backTxt: { color: colors.primaryText, fontSize: 14 },
    headerTitre: { fontSize: 22, fontWeight: '700', color: colors.headerText },
    headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },

    filtreBar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    filtreBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.badgeBg, marginRight: 8 },
    filtreBtnActif: { backgroundColor: colors.primary },
    filtreTxt: { fontSize: 12, color: colors.textMuted },
    filtreTxtActif: { color: '#fff', fontWeight: '700' },

    body: { flex: 1 },

    emptyBox: { alignItems: 'center', paddingVertical: 60 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyTxt: { fontSize: 15, color: colors.textMuted },

    dateLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

    entryRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surface },
    entryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 1 },
    entryIconTxt: { fontSize: 16 },
    entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    entryLabel: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
    entryTime: { fontSize: 11, color: colors.textMuted, marginLeft: 8 },
    entrySub: { fontSize: 12, color: colors.textSecondary },
    chevron: { fontSize: 10, color: colors.textMuted, marginLeft: 8, marginTop: 4 },

    detailsBox: { marginTop: 8, backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 10 },
    detailLine: { fontSize: 12, color: colors.textSecondary, marginBottom: 3 },
    detailTime: { fontSize: 10, color: colors.textMuted, marginTop: 6 },
  })
}
