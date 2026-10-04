// Petite ligne d'information du bandeau du jour : icône + texte coloré.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { Text, View } from 'react-native'

export default function Indicateur({ icone, couleur, texte, styles }) {
  return (
    <View style={styles.indicateur}>
      <MaterialCommunityIcons name={icone} size={15} color={couleur} />
      <Text style={[styles.indicateurTxt, { color: couleur }]}>{texte}</Text>
    </View>
  )
}
