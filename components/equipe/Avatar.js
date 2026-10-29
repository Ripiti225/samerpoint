import { Image, Text, View } from 'react-native'
import { BLEU, initiales } from '../../lib/equipe'
import { miniature } from '../../lib/miniature'

// Couleur du restaurant : vert Al Kayan, orange Chez Samer, ou la teinte
// propre du restaurant quand Paramètres en a enregistré une (« #D99A2B »).
export function couleurResto(resto) {
  if (!resto) return BLEU
  if (typeof resto.couleur === 'string' && /^#[0-9a-f]{6}$/i.test(resto.couleur)) return resto.couleur
  return resto.couleur === 'vert' ? '#2D7D46' : '#EF9F27'
}

/** Photo du travailleur, sinon ses initiales sur la couleur de son restaurant.
 *  `logo` : pastille du logo du restaurant dans le coin bas-droit. */
export default function Avatar({ nom, photo, resto, taille = 44, gris = false, logo = false, style }) {
  const rond = { width: taille, height: taille, borderRadius: taille / 2 }
  const visage = photo
    ? <Image source={{ uri: miniature(photo, taille) }} style={[rond, gris && { opacity: 0.6 }, !logo && style]} />
    : (
      <View style={[rond, { backgroundColor: gris ? '#9A9AA8' : couleurResto(resto), alignItems: 'center', justifyContent: 'center' }, !logo && style]}>
        <Text style={{ fontSize: Math.round(taille * 0.34), fontWeight: '800', color: '#fff' }}>{initiales(nom)}</Text>
      </View>
    )
  if (!logo || !resto?.photo_url) return logo ? <View style={style}>{visage}</View> : visage

  const p = Math.round(taille * 0.46)
  return (
    <View style={style}>
      {visage}
      <Image
        source={{ uri: miniature(resto.photo_url, p) }}
        style={{
          position: 'absolute', right: -4, bottom: -4, width: p, height: p, borderRadius: p / 2,
          borderWidth: 2, borderColor: couleurResto(resto), backgroundColor: '#fff',
        }}
      />
    </View>
  )
}
