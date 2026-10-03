// Jauge de 0 % à 100 %.
//   variante 'demi'  : demi-cercle, le pourcentage au centre (écrans)
//   variante 'barre' : barre horizontale compacte (bandeau de l'accueil)
// Couleur selon la valeur : vert ≥ 90 %, orange ≥ 60 %, rouge en dessous.
import { Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '../../context/ThemeContext'

export function couleurJauge(pct) {
  return pct >= 90 ? '#3B8D2F' : pct >= 60 ? '#D98A0B' : '#C2462B'
}

export default function Jauge({ pct = 0, variante = 'demi', taille = 180, epaisseur = 16, libelle }) {
  const { colors } = useTheme()
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))
  const c = couleurJauge(v)

  if (variante === 'barre') {
    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
          {libelle ? <Text style={{ fontSize: 12.5, color: colors.textSecondary, fontWeight: '600' }}>{libelle}</Text> : <View />}
          <Text style={{ fontSize: 16, fontWeight: '800', color: c }}>{v} %</Text>
        </View>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.max(v, 1.5)}%`, borderRadius: 5, backgroundColor: c }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>0 %</Text>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>100 %</Text>
        </View>
      </View>
    )
  }

  // Demi-cercle : un arc de gauche à droite, rempli à v %.
  const r = (taille - epaisseur) / 2
  const h = r + epaisseur / 2
  const arc = `M ${epaisseur / 2} ${h} A ${r} ${r} 0 0 1 ${taille - epaisseur / 2} ${h}`
  const longueur = Math.PI * r
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: taille, height: h + 2 }}>
        <Svg width={taille} height={h + 2}>
          <Path d={arc} stroke={colors.surfaceAlt} strokeWidth={epaisseur} strokeLinecap="round" fill="none" />
          {v > 0 && (
            <Path d={arc} stroke={c} strokeWidth={epaisseur} strokeLinecap="round" fill="none"
              strokeDasharray={`${(v / 100) * longueur} ${longueur}`} />
          )}
        </Svg>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
          <Text style={{ fontSize: Math.round(taille * 0.17), fontWeight: '800', color: c, letterSpacing: -0.5 }}>{v} %</Text>
          {libelle ? <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '600' }}>{libelle}</Text> : null}
        </View>
      </View>
      <View style={{ width: taille, flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted, width: epaisseur * 2, textAlign: 'center' }}>0 %</Text>
        <Text style={{ fontSize: 11, color: colors.textMuted, width: epaisseur * 2.4, textAlign: 'center' }}>100 %</Text>
      </View>
    </View>
  )
}
