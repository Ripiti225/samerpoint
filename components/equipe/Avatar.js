import { Image, Text, View } from 'react-native'
import { BLEU, initiales } from '../../lib/equipe'
import { miniature } from '../../lib/miniature'

// Couleur de marque du restaurant : vert Al Kayan, orange Chez Samer.
export function couleurResto(resto) {
  if (!resto) return BLEU
  return resto.couleur === 'vert' ? '#2D7D46' : '#EF9F27'
}

/** Photo du travailleur, sinon ses initiales sur la couleur de son restaurant. */
export default function Avatar({ nom, photo, resto, taille = 44, gris = false, style }) {
  const rond = { width: taille, height: taille, borderRadius: taille / 2 }
  if (photo) return <Image source={{ uri: miniature(photo, taille) }} style={[rond, gris && { opacity: 0.6 }, style]} />
  return (
    <View style={[rond, { backgroundColor: gris ? '#9A9AA8' : couleurResto(resto), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ fontSize: Math.round(taille * 0.34), fontWeight: '800', color: '#fff' }}>{initiales(nom)}</Text>
    </View>
  )
}
