// ──────────────────────────────────────────────────────────────────────────────
// Survol — un Pressable qui grossit un peu quand la souris passe dessus (web),
// et se tasse un peu sous le doigt. Pour toutes les cartes et tuiles cliquables.
//
//   <Survol onPress={…} style={styles.carte} echelle={1.03}>…</Survol>
//
// style peut être un objet, un tableau ou une fonction ({ hovered, pressed }).
// Sur téléphone, seul l'effet d'appui joue (il n'y a pas de souris).
// ──────────────────────────────────────────────────────────────────────────────
import { Platform, Pressable } from 'react-native'

const TRANSITION_WEB = Platform.OS === 'web'
  ? { transitionProperty: 'transform, box-shadow, background-color', transitionDuration: '160ms', transitionTimingFunction: 'ease-out', cursor: 'pointer' }
  : null

export default function Survol({ style, styleSurvol, echelle = 1.03, disabled, children, ...props }) {
  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={etat => {
        const base = typeof style === 'function' ? style(etat) : style
        const { hovered, pressed } = etat
        return [
          base,
          TRANSITION_WEB,
          !disabled && hovered && !pressed && { transform: [{ scale: echelle }] },
          !disabled && hovered && styleSurvol,
          !disabled && pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
        ]
      }}
    >
      {children}
    </Pressable>
  )
}
