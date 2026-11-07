// Accueil : une ligne par fête à moins de 7 jours avec une alerte de stock.
// Un échec masque les lignes sans bloquer l'accueil.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { peutVoirEvenements } from '../../lib/evenements'
import { chargerAlertesAccueil } from '../../lib/evenementsDb'
import Survol from '../ui/Survol'

export default function AlertesStockAccueil({ role, restaurantId, styles, colors }) {
  const [items, setItems] = useState([])

  useFocusEffect(useCallback(() => {
    if (!peutVoirEvenements(role)) { setItems([]); return undefined }
    let vivant = true
    chargerAlertesAccueil({ role, restaurantId, aujourdhui: aujourdhuiISO() })
      .then(r => { if (vivant) setItems(r) })
      .catch(() => { if (vivant) setItems([]) })
    return () => { vivant = false }
  }, [role, restaurantId]))

  return items.map(i => (
    <Survol key={i.cle} onPress={() => router.push('/evenements')} accessibilityRole="button" accessibilityLabel={`${i.titre}. ${i.corps} Ouvrir les événements.`}
      style={[styles.bandeau, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} echelle={1.01} styleSurvol={{ borderColor: colors.primary + '66' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>{i.titre}</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{i.corps}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </Survol>
  ))
}
