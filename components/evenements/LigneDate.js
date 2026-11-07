// Une date venue d'un autre écran : toucher la ligne ouvre cet écran.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router } from 'expo-router'
import { Text, TouchableOpacity, View } from 'react-native'

import { libelleJour } from '../../lib/evenements'
import { fmt } from '../../lib/tresorerie'

const ICONES = {
  cheque: '🧾', echeance: '🏠', echeances_retard: '⚠️', prevision: '🗓️', coffre: '🔐',
  charges: '🏛️', contrat: '📝', conge: '🌴', tache: '🧭',
}

export default function LigneDate({ ligne, aujourdhui, styles, colors }) {
  return (
    <TouchableOpacity style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={`${ligne.titre}. Ouvrir.`} onPress={() => router.push(ligne.route)}>
      <Text style={{ fontSize: 20 }}>{ICONES[ligne.sousType] || '📅'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }} numberOfLines={2}>{ligne.titre}</Text>
        {ligne.detail ? <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }} numberOfLines={2}>{ligne.detail}</Text> : null}
        <Text style={{ fontSize: 13, fontWeight: '700', color: ligne.retard ? colors.error : colors.textMuted, marginTop: 2 }}>
          {libelleJour(ligne.date, aujourdhui)}{ligne.montant !== null ? ` · ${fmt(ligne.montant)} F` : ''}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  )
}
