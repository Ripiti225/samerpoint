// Ligne de l'accueil, seulement s'il se passe quelque chose aujourd'hui.
// Calculée à l'ouverture ; un échec la masque sans bloquer l'accueil.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { compterAujourdhui, construireLignes, peutVoirEvenements, texteRappel, voitToutLeGroupe } from '../../lib/evenements'
import { chargerDonneesEvenements } from '../../lib/evenementsDb'
import Survol from '../ui/Survol'

export default function RappelEvenements({ role, restaurantId, styles, colors }) {
  const [texte, setTexte] = useState(null)

  useFocusEffect(useCallback(() => {
    if (!peutVoirEvenements(role)) { setTexte(null); return undefined }
    let vivant = true
    const aujourdhui = aujourdhuiISO()
    chargerDonneesEvenements({ groupe: voitToutLeGroupe(role), restaurantId })
      .then(d => { if (vivant) setTexte(texteRappel(compterAujourdhui(construireLignes({ ...d, aujourdhui }), aujourdhui))) })
      .catch(() => { if (vivant) setTexte(null) })
    return () => { vivant = false }
  }, [role, restaurantId]))

  if (!texte) return null
  return (
    <Survol onPress={() => router.push('/evenements')} accessibilityRole="button" accessibilityLabel={`${texte}. Ouvrir les événements.`}
      style={[styles.bandeau, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} echelle={1.01} styleSurvol={{ borderColor: colors.primary + '66' }}>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: colors.text }}>{texte}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </Survol>
  )
}
