// ──────────────────────────────────────────────────────────────────────────────
// Texte sur une ligne qui rétrécit pour tenir en entier (grands montants).
//
// Dans l'app installée (iOS / Android), `adjustsFontSizeToFit` le fait déjà.
// Sur le web — l'app épinglée sur l'iPhone, son usage principal — cette option
// ne fait RIEN : un « 12 345 678 F » trop large finissait en « 12 345… ».
// Ici, sur le web, on mesure le texte réel à l'écran (scrollWidth > clientWidth
// = il déborde) et on baisse la police d'un point jusqu'à ce qu'il tienne,
// sans descendre sous `min` (60 % de la taille du style par défaut).
// La mesure est refaite quand le texte ou la largeur de la fenêtre changent
// (pas sur la largeur du texte lui-même : elle bouge avec la police, ce qui
// ferait boucler la mesure).
// ──────────────────────────────────────────────────────────────────────────────
import { useLayoutEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, useWindowDimensions } from 'react-native'

const WEB = Platform.OS === 'web'

export default function TexteAjuste({ style, children, min, ...props }) {
  const max = StyleSheet.flatten(style)?.fontSize || 14
  const plancher = min ?? Math.round(max * 0.6)
  const { width: fenetre } = useWindowDimensions()
  const ref = useRef(null)
  const [taille, setTaille] = useState(max)
  const cle = `${Array.isArray(children) ? children.join('') : String(children ?? '')}|${max}|${fenetre}`

  // Nouveau texte, nouvelle taille de style ou fenêtre redimensionnée : on repart du max…
  useLayoutEffect(() => {
    if (WEB) setTaille(max)
  }, [cle, max])

  // … puis on réduit d'un point tant que le texte déborde.
  useLayoutEffect(() => {
    if (!WEB) return
    const el = ref.current
    if (!el || typeof el.scrollWidth !== 'number') return
    if (el.scrollWidth > el.clientWidth + 1 && taille > plancher) setTaille(t => t - 1)
  }, [taille, cle, plancher])

  if (!WEB) {
    return <Text {...props} style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={plancher / max}>{children}</Text>
  }
  return <Text {...props} ref={ref} style={[style, { fontSize: taille }]} numberOfLines={1}>{children}</Text>
}
