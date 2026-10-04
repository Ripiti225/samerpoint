// ──────────────────────────────────────────────────────────────────────────────
//  Bandeau du jour de l'accueil gérant : son restaurant, la journée d'hier.
//  Point d'hier (corrections en premier), ventes d'hier et leur évolution
//  (hausse en vert, baisse en rouge), vente, écart et explication de chaque
//  caissier d'hier, demandes de son équipe.
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
  const { hier, point, ventes, ventesEvo, demandes, nbDemandes, caissiers = [] } = etat
  const pointUi = {
    corrections: { icone: 'pencil-alert', couleur: colors.error, route: '/correction-point' },
    verifie: { icone: 'check-decagram', couleur: colors.success },
    valide: { icone: 'check-circle', couleur: colors.success },
    en_attente: { icone: 'clock-outline', couleur: colors.warningDark },
    absent: { icone: 'clock-alert-outline', couleur: colors.textMuted },
  }[point.cle]
  const couleurSens = s => (s === 'hausse' ? colors.success : s === 'baisse' ? colors.error : colors.textMuted)
  const couleurEcart = { nul: colors.success, negatif: colors.error, positif: colors.warningDark }
  const signe = n => (n > 0 ? '+' : n < 0 ? '−' : '')

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

        {caissiers.length > 0 && (
          <View style={styles.bandeauTreso}>
            <Text style={styles.bandeauSousTitre}>Caissiers d'hier</Text>
            {caissiers.map(c => (
              <View key={c.cle} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                    {c.nom} <Text style={{ fontSize: 12, fontWeight: '400', color: colors.textMuted }}>{c.horaire}</Text>
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>{fcfa(c.vente)} F</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: couleurEcart[c.sensEcart], fontVariant: ['tabular-nums'], minWidth: 70, textAlign: 'right' }}>
                    {c.ecart === 0 ? 'aucun écart' : `${signe(c.ecart)}${fcfa(Math.abs(c.ecart))}`}
                  </Text>
                </View>
                {c.explication ? (
                  <Text style={{ fontSize: 12, fontStyle: 'italic', color: colors.textSecondary }} numberOfLines={2}>« {c.explication} »</Text>
                ) : c.sansExplication ? (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.warningDark }}>Pas d'explication</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

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
