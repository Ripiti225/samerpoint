import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { getOrCreatePoint, getPresences } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function SelectionJourneeScreen() {
  const { userId, nom, role, restoId } = useLocalSearchParams()
  const {
    setPointId, setDateJour, setPointValide, restaurantId,
    setPaiesJour, setPresencesJour,
  } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const restoIdEffectif = restoId || restaurantId

  const today = new Date().toISOString().split('T')[0]
  const hierDate = new Date(); hierDate.setDate(hierDate.getDate() - 1)
  const hierStr = hierDate.toISOString().split('T')[0]

  const [hierDisponible, setHierDisponible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(false)

  useEffect(() => {
    verifierHier()
  }, [])

  async function verifierHier() {
    const { data } = await supabase
      .from('points')
      .select('id, valide')
      .eq('restaurant_id', restoIdEffectif)
      .eq('date', hierStr)
      .maybeSingle()

    // Hier disponible si: point inexistant OU point existant non validé
    setHierDisponible(!data || data.valide === false)
    setLoading(false)
  }

  async function restaurerPresencesDuJour(pointId, caissierUserId) {
    // Vérifier si ce caissier a déjà validé son shift pour ce point
    const { data: shiftValide } = await supabase
      .from('points_shifts')
      .select('id')
      .eq('point_id', pointId)
      .eq('caissier_id', caissierUserId)
      .eq('valide', true)
      .maybeSingle()

    // Remettre les présences à zéro avant de recharger
    setPresencesJour({})
    setPaiesJour({})

    // Si le shift est déjà validé, on laisse l'état vide
    if (shiftValide) return

    // Restaurer uniquement les présences filtrées par caissier_id
    // Les dépenses et fournisseurs ne sont PAS restaurés depuis Supabase :
    // la table depenses n'a pas de colonne caissier_id, donc charger
    // saisi_par='caissier' ramènerait les données d'un autre caissier.
    const presencesData = await getPresences(pointId)
    const newPresences = {}
    const newPaies = {}
    presencesData
      .filter(p => p.caissier_id === caissierUserId)
      .forEach(p => {
        newPresences[p.travailleur_id] = p.statut
        newPaies[p.travailleur_id] = String(p.paye || 0)
      })
    setPresencesJour(newPresences)
    setPaiesJour(newPaies)
  }

  async function choisir(dateStr) {
    setSelecting(true)
    const point = await getOrCreatePoint(dateStr, userId, restoIdEffectif)
    if (point) {
      setPointId(point.id)
      setDateJour(dateStr)
      setPointValide(point.valide || false)
      if (!point.valide) {
        await restaurerPresencesDuJour(point.id, userId)
      }
    }
    router.replace({
      pathname: '/accueil',
      params: { nom, role, userId },
    })
  }

  function formatDateFR(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#EF9F27" />
        <Text style={styles.loadingTxt}>Vérification des données...</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icone}>📅</Text>
        <Text style={styles.titre}>Pour quelle journée{'\n'}travaillez-vous ?</Text>
        <Text style={styles.sous}>Sélectionnez la date de votre shift</Text>

        {selecting ? (
          <View style={styles.selectingBox}>
            <ActivityIndicator size="large" color="#EF9F27" />
            <Text style={styles.selectingTxt}>Chargement de la journée...</Text>
          </View>
        ) : (
          <View style={styles.optionsBox}>
            {/* Aujourd'hui — toujours disponible */}
            <TouchableOpacity
              style={[styles.optionCard, styles.optionCardPrimary]}
              onPress={() => choisir(today)}
              activeOpacity={0.8}
            >
              <View style={styles.optionLeft}>
                <Text style={styles.optionIcon}>☀️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>Aujourd'hui</Text>
                  <Text style={styles.optionDate}>
                    {formatDateFR(today).charAt(0).toUpperCase() + formatDateFR(today).slice(1)}
                  </Text>
                </View>
              </View>
              <Text style={styles.optionArrow}>›</Text>
            </TouchableOpacity>

            {/* Hier — uniquement si point J-1 non validé ou inexistant */}
            {hierDisponible && (
              <TouchableOpacity
                style={[styles.optionCard, styles.optionCardSecondary]}
                onPress={() => choisir(hierStr)}
                activeOpacity={0.8}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.optionIcon}>🌙</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionLabel, { color: colors.text }]}>Hier</Text>
                    <Text style={[styles.optionDate, { color: colors.textMuted }]}>
                      {formatDateFR(hierStr).charAt(0).toUpperCase() + formatDateFR(hierStr).slice(1)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.optionArrow, { color: colors.textMuted }]}>›</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!hierDisponible && !selecting && (
          <View style={styles.infoBanner}>
            <Text style={styles.infoTxt}>
              ℹ️ Le point d'hier est déjà validé — seule la journée d'aujourd'hui est disponible.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, alignItems: 'center' },
  icone: { fontSize: 64, marginBottom: 20 },
  titre: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 10, lineHeight: 32 },
  sous: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 40 },
  loadingTxt: { fontSize: 14, color: colors.textMuted, marginTop: 16 },
  selectingBox: { alignItems: 'center', paddingVertical: 40 },
  selectingTxt: { fontSize: 14, color: colors.textMuted, marginTop: 16 },
  optionsBox: { width: '100%', gap: 14 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderRadius: 20, borderWidth: 1.5,
  },
  optionCardPrimary: { backgroundColor: '#FAEEDA', borderColor: '#EF9F27' },
  optionCardSecondary: { backgroundColor: colors.surface, borderColor: colors.border },
  optionLeft: { flexDirection: 'row', alignItems: 'center', gap: 16, flex: 1 },
  optionIcon: { fontSize: 32 },
  optionLabel: { fontSize: 17, fontWeight: '700', color: '#412402', marginBottom: 4 },
  optionDate: { fontSize: 13, color: '#854F0B' },
  optionArrow: { fontSize: 24, color: '#EF9F27', fontWeight: '600' },
  infoBanner: {
    backgroundColor: colors.surfaceAlt, borderRadius: 14, padding: 16,
    marginTop: 24, borderWidth: 0.5, borderColor: colors.border, width: '100%',
  },
  infoTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
}) }
