import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { useApp } from '../context/AppContext'
import { getOrCreatePoint, getSequences } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function ChoixDateScreen() {
  const { nom, role, userId } = useLocalSearchParams()
  const {
    setPointId, setDateJour, resetJour, setPointValide,
    setDepensesJour, setVentesJour,
    restaurantId, restaurantNom,
  } = useApp()

  const [datesAvecDonnees, setDatesAvecDonnees] = useState({})
  const [dateSelectionnee, setDateSelectionnee] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    if (restaurantId) fetchDatesAvecDonnees()
  }, [restaurantId])

  async function fetchDatesAvecDonnees() {
    setLoading(true)
    const { data } = await supabase
      .from('points')
      .select('date, valide')
      .eq('restaurant_id', restaurantId)

    const marked = {}
    ;(data || []).forEach(p => {
      // Gérant ne peut pas accéder aux points validés
      if (p.valide && role === 'gerant') {
        marked[p.date] = {
          marked: true,
          dotColor: '#ccc',
          disabled: true,
        }
      } else {
        marked[p.date] = {
          marked: true,
          dotColor: p.valide ? '#3B6D11' : '#EF9F27',
        }
      }
    })
    setDatesAvecDonnees(marked)
    setLoading(false)
  }

  function choisirDate(day) {
    // Vérifier si la date est bloquée pour le gérant
    const dateInfo = datesAvecDonnees[day.dateString]
    if (dateInfo?.disabled && role === 'gerant') {
      Alert.alert(
        '🔒 Point validé',
        'Ce point a déjà été validé. Seul le Manager peut modifier un point validé.'
      )
      return
    }
    setDateSelectionnee(day.dateString)
  }

  async function chargerDonneesPoint(pointId) {
    // Charger le cumul des shifts pour pré-remplir les ventes gérant
    const { data: shifts } = await supabase
      .from('points_shifts')
      .select('*')
      .eq('point_id', pointId)

    if (shifts && shifts.length > 0) {
      // Cumuler toutes les données des shifts
      const cumulYangoCse = shifts.reduce((sum, s) => sum + (s.yango_cse || 0), 0)
      const cumulGlovoCse = shifts.reduce((sum, s) => sum + (s.glovo_cse || 0), 0)
      const cumulWave = shifts.reduce((sum, s) => sum + (s.wave || 0), 0)
      const cumulDjamo = shifts.reduce((sum, s) => sum + (s.djamo || 0), 0)
      const cumulOm = shifts.reduce((sum, s) => sum + (s.om || 0), 0)
      const cumulKdo = shifts.reduce((sum, s) => sum + (s.kdo || 0), 0)
      const cumulRetour = shifts.reduce((sum, s) => sum + (s.retour || 0), 0)
      const cumulDepenses = shifts.reduce((sum, s) => sum + (s.depenses || 0), 0)

      // Pré-remplir les ventes avec le cumul des shifts
      setVentesJour(prev => ({
        ...prev,
        yangoCse: cumulYangoCse > 0 ? String(cumulYangoCse) : '',
        glovoCse: cumulGlovoCse > 0 ? String(cumulGlovoCse) : '',
        wave: cumulWave > 0 ? String(cumulWave) : '',
        djamo: cumulDjamo > 0 ? String(cumulDjamo) : '',
        om: cumulOm > 0 ? String(cumulOm) : '',
        kdo: cumulKdo > 0 ? String(cumulKdo) : '',
        retour: cumulRetour > 0 ? String(cumulRetour) : '',
      }))

      // Pré-remplir les dépenses avec le cumul des shifts
      if (cumulDepenses > 0) {
        setDepensesJour({
          'Marché': [{ libelle: 'Cumul dépenses caissiers', montant: String(cumulDepenses) }],
          'Légumes': [],
          'Fruits': [],
          'Dépenses annexes': [],
        })
      }
    }

    // Charger les séquences existantes
    const seqData = await getSequences(pointId)
    if (seqData && seqData.length > 0) {
      setVentesJour(prev => ({
        ...prev,
        sequences: seqData.map(s => ({
          id: s.id,
          montant: String(s.montant),
          photo_url: s.photo_url
        }))
      }))
    }
  }

  async function confirmer() {
    if (!dateSelectionnee) {
      Alert.alert('Attention', 'Veuillez choisir une date')
      return
    }
    if (!restaurantId) {
      Alert.alert('Erreur', 'Restaurant non défini. Reconnectez-vous.')
      return
    }

    // Bloquer le gérant sur les dates validées
    const dateInfo = datesAvecDonnees[dateSelectionnee]
    if (dateInfo?.disabled && role === 'gerant') {
      Alert.alert(
        '🔒 Point validé',
        'Ce point a déjà été validé. Seul le Manager peut modifier un point validé.'
      )
      return
    }

    setCreating(true)
    resetJour()
    const point = await getOrCreatePoint(dateSelectionnee, userId, restaurantId)
    if (point) {
      setPointId(point.id)
      setDateJour(dateSelectionnee)
      setPointValide(point.valide || false)

      // Charger le cumul des shifts pour pré-remplir
      await chargerDonneesPoint(point.id)

      router.replace({
        pathname: '/accueil',
        params: { nom, role, userId, date: dateSelectionnee, pointId: point.id }
      })
    } else {
      Alert.alert('Erreur', 'Impossible de créer le point. Vérifiez votre connexion.')
    }
    setCreating(false)
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  const markedDates = {
    ...datesAvecDonnees,
    ...(dateSelectionnee ? {
      [dateSelectionnee]: {
        selected: true,
        selectedColor: '#EF9F27',
        marked: datesAvecDonnees[dateSelectionnee]?.marked,
        dotColor: datesAvecDonnees[dateSelectionnee]?.dotColor,
      }
    } : {}),
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Choisir la date</Text>
          <Text style={styles.headerSub}>{restaurantNom || 'Point journalier'}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTxt}>
            🟢 Point vert = données existantes{'\n'}
            🟡 Point orange = en cours non validé{'\n'}
            ⚫ Grisé = validé — accès Manager uniquement
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#EF9F27" style={{ marginTop: 40 }} />
        ) : (
          <Calendar
            onDayPress={choisirDate}
            markedDates={markedDates}
            maxDate={today}
            theme={{
              selectedDayBackgroundColor: '#EF9F27',
              selectedDayTextColor: '#412402',
              todayTextColor: '#EF9F27',
              dayTextColor: '#1a1a1a',
              textDisabledColor: '#ccc',
              arrowColor: '#EF9F27',
              monthTextColor: '#1a1a1a',
            }}
            style={styles.calendar}
          />
        )}

        {dateSelectionnee ? (
          <View style={styles.selectedBox}>
            <Text style={styles.selectedLabel}>Date sélectionnée</Text>
            <Text style={styles.selectedDate}>{formatDate(dateSelectionnee)}</Text>
            {datesAvecDonnees[dateSelectionnee] && !datesAvecDonnees[dateSelectionnee].disabled && (
              <Text style={styles.selectedSub}>
                {datesAvecDonnees[dateSelectionnee].dotColor === '#3B6D11'
                  ? '✅ Point validé — données chargées'
                  : '⏳ Point en cours — données shifts chargées'}
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.selectedBox}>
            <Text style={styles.selectedLabel}>Aucune date sélectionnée</Text>
            <Text style={styles.selectedSub}>Appuyez sur une date pour la sélectionner</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.confirmerBtn, (!dateSelectionnee || creating) && styles.confirmerBtnDisabled]}
          onPress={confirmer}
          disabled={!dateSelectionnee || creating}
        >
          {creating ? (
            <ActivityIndicator color="#412402" />
          ) : (
            <Text style={styles.confirmerTxt}>Confirmer la date</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  body: { flex: 1, padding: 16 },
  infoBox: {
    backgroundColor: '#EAF3DE', borderRadius: 12, padding: 12,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#C0DD97'
  },
  infoTxt: { fontSize: 12, color: '#3B6D11', lineHeight: 20 },
  calendar: { borderRadius: 16, borderWidth: 0.5, borderColor: '#eee', marginBottom: 14 },
  selectedBox: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee', alignItems: 'center'
  },
  selectedLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  selectedDate: { fontSize: 20, fontWeight: '600', color: '#EF9F27' },
  selectedSub: { fontSize: 12, color: '#3B6D11', marginTop: 4 },
  confirmerBtn: {
    backgroundColor: '#EF9F27', borderRadius: 14, padding: 16, alignItems: 'center'
  },
  confirmerBtnDisabled: { backgroundColor: '#f5c87a' },
  confirmerTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
})