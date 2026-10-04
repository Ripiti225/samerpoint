// ──────────────────────────────────────────────────────────────────────────────
//  Bandeau du jour de l'accueil gérant : son restaurant, la journée d'hier.
//  Point d'hier (corrections en premier), ventes d'hier et leur évolution
//  (hausse en vert, baisse en rouge), demandes de son équipe.
//  Textes : lib/accueilGerant.js, lib/hierAccueil.js.
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router } from 'expo-router'
import { Text, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import Survol from '../ui/Survol'
import Indicateur from './Indicateur'

const fcfa = n => Math.round(n || 0).toLocaleString('fr-FR')

export default function BandeauGerant({ etat, styles, colors }) {
  const { hier, point, ventes, ventesEvo, demandes, nbDemandes } = etat
  const pointUi = {
    corrections: { icone: 'pencil-alert', couleur: colors.error, route: '/correction-point' },
    verifie: { icone: 'check-decagram', couleur: colors.success },
    valide: { icone: 'check-circle', couleur: colors.success },
    en_attente: { icone: 'clock-outline', couleur: colors.warningDark },
    absent: { icone: 'clock-alert-outline', couleur: colors.textMuted },
  }[point.cle]
  const couleurSens = s => (s === 'hausse' ? colors.success : s === 'baisse' ? colors.error : colors.textMuted)

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <View style={styles.bandeau}>
        <Text style={styles.bandeauLabel}>
          Hier · {hier.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>

        <View style={[styles.bandeauHaut, { marginTop: 4 }]}>
          <View style={{ flex: 1 }}>
            {ventes != null ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={[styles.bandeauGrand, { color: colors.text }]}>{fcfa(ventes)}</Text>
                  <Text style={styles.bandeauUnite}>F de ventes</Text>
                </View>
                {ventesEvo.length ? (
                  <Text style={styles.bandeauUnite}>
                    {ventesEvo.map((e, i) => (
                      <Text key={e.texte} style={{ fontWeight: '700', color: couleurSens(e.sens) }}>
                        {i ? ' · ' : ''}{e.texte}
                      </Text>
                    ))}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.bandeauUnite}>Pas encore de ventes pour hier</Text>
            )}
          </View>
          <MaterialCommunityIcons name="cash-register" size={34} color={colors.primary} />
        </View>

        <View style={styles.bandeauTreso}>
          {pointUi.route ? (
            <Survol onPress={() => router.push(pointUi.route)} accessibilityRole="button" hitSlop={6}
              accessibilityLabel={`${point.texte}. Ouvrir les corrections.`} style={styles.lienTreso} echelle={1.02}
              styleSurvol={{ backgroundColor: pointUi.couleur + '14' }}>
              <Indicateur icone={pointUi.icone} couleur={pointUi.couleur} texte={point.texte} styles={styles} />
              <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
            </Survol>
          ) : (
            <Indicateur icone={pointUi.icone} couleur={pointUi.couleur} texte={point.texte} styles={styles} />
          )}
          <Survol onPress={() => router.push('/demandes')} accessibilityRole="button" hitSlop={6}
            accessibilityLabel={`${demandes}. Ouvrir les demandes.`} style={styles.lienTreso} echelle={1.02}
            styleSurvol={{ backgroundColor: colors.primary + '14' }}>
            <Indicateur icone={nbDemandes ? 'inbox-arrow-down' : 'inbox'} couleur={nbDemandes ? colors.primary : colors.textMuted}
              texte={demandes} styles={styles} />
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
          </Survol>
        </View>
      </View>
    </Animated.View>
  )
}
