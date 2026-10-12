// Mise en évidence de la ligne ouverte depuis la recherche globale (param `focus`).
//
//   const focus = useFocusRecherche(params.focus)
//   <View key={d.id} {...focus.props(d.id)} style={[styles.ligne, focus.style(d.id)]}>
//
// La ligne cherchée est encadrée en jaune pendant DUREE_FOCUS_MS à partir de son
// premier affichage. Sur le web (Safari iPhone), la page défile jusqu'à elle ;
// dans l'app installée, seulement l'encadré.
// Spéc : docs/superpowers/specs/2026-10-12-recherche-globale-lot2a-design.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useTheme } from '../context/ThemeContext'

export const DUREE_FOCUS_MS = 4000

export function useFocusRecherche(focusId) {
  const { colors } = useTheme()
  const cible = focusId ? String(focusId) : null
  const [fini, setFini] = useState(false)
  const vu = useRef(false)
  const minuteur = useRef(null)

  useEffect(() => { vu.current = false; setFini(false) }, [cible])
  useEffect(() => () => clearTimeout(minuteur.current), [])

  const props = useCallback(id => {
    if (!cible || String(id) !== cible) return {}
    return {
      nativeID: `focus-${cible}`,
      onLayout: () => {
        if (vu.current) return
        vu.current = true
        if (Platform.OS === 'web' && typeof document !== 'undefined') {
          setTimeout(() => document.getElementById(`focus-${cible}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
        }
        minuteur.current = setTimeout(() => setFini(true), DUREE_FOCUS_MS)
      },
    }
  }, [cible])

  const style = useCallback(id => (cible && !fini && String(id) === cible
    ? { borderWidth: 2, borderColor: colors.warning, backgroundColor: colors.warningLight }
    : null), [cible, fini, colors])

  return { props, style }
}
