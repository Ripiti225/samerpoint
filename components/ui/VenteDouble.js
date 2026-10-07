// ──────────────────────────────────────────────────────────────────────────────
// Vente machine (la vraie vente) avec la vente théorique en face.
// `children` = l'affichage de la vente machine propre à chaque écran ; la
// théorique et l'écart se placent à côté sur un écran large (tablette,
// ordinateur), en dessous sur un téléphone.
// Règle : lib/venteMachine.js
// ──────────────────────────────────────────────────────────────────────────────
import { Text, useWindowDimensions, View } from 'react-native'

export const LARGEUR_COTE_A_COTE = 600

const fcfa = n => Math.round(n || 0).toLocaleString('fr-FR')
const signe = n => (n > 0 ? '+' : n < 0 ? '−' : '')

/** « Théorique 501 700 F · écart −19 300 F » (écart = théorique − machine). */
// `couleur` / `couleurValeur` : pour un fond coloré (carte principale), sinon les gris du thème.
export function TexteTheorique({ machine, theorique, colors, taille = 12, style, couleur, couleurValeur }) {
  const ecart = Math.round((theorique || 0) - (machine || 0))
  return (
    <Text style={[{ fontSize: taille, color: couleur || colors.textMuted }, style]}>
      Théorique <Text style={{ fontWeight: '700', color: couleurValeur || couleur || colors.textSecondary }}>{fcfa(theorique)} F</Text>
      {ecart ? ` · écart ${signe(ecart)}${fcfa(Math.abs(ecart))} F` : ' · sans écart'}
    </Text>
  )
}

export default function VenteDouble({ machine, theorique, colors, children, taille, style, couleur, couleurValeur }) {
  const { width } = useWindowDimensions()
  const cote = width >= LARGEUR_COTE_A_COTE
  return (
    <View style={[cote
      ? { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', columnGap: 14 }
      : { flexDirection: 'column', gap: 2 }, style]}>
      {children}
      <TexteTheorique machine={machine} theorique={theorique} colors={colors} taille={taille} couleur={couleur} couleurValeur={couleurValeur} />
    </View>
  )
}
