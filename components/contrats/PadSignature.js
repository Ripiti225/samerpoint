// ──────────────────────────────────────────────────────────────────────────────
// Cadre de signature au doigt (ou au stylet).
//
// Pur JavaScript : PanResponder + react-native-svg, déjà dans l'application.
// Aucune dépendance native, donc livrable par mise à jour automatique.
//
// La signature remonte en traits relatifs (0 à 1) + le rapport largeur /
// hauteur du cadre : le PDF la redessine à n'importe quelle taille sans
// déformation (lib/pdfContrat.js).
//
// Ne pas placer ce cadre dans un ScrollView : le défilement volerait le geste.
// ──────────────────────────────────────────────────────────────────────────────
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { PanResponder, Platform, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { traitsVersPath } from '../../lib/recrutement'

const PadSignature = forwardRef(function PadSignature({ onChange, hauteur = 220, couleurTrait = '#1E2878', libelle }, ref) {
  const taille = useRef({ l: 1, h: 1 })
  const traits = useRef([])          // en pixels, trait en cours compris
  const [, rafraichir] = useState(0)

  function publier() {
    const { l, h } = taille.current
    const valides = traits.current.filter(t => t.length > 1)
    onChange?.(valides.length
      ? { traits: valides.map(t => t.map(([x, y]) => [Math.round((x / l) * 1000) / 1000, Math.round((y / h) * 1000) / 1000])), ratio: l / h }
      : null)
  }

  useImperativeHandle(ref, () => ({
    effacer() {
      traits.current = []
      rafraichir(n => n + 1)
      onChange?.(null)
    },
  }))

  const borne = (v, max) => Math.max(0, Math.min(max, v))
  const point = e => [borne(e.nativeEvent.locationX, taille.current.l), borne(e.nativeEvent.locationY, taille.current.h)]

  const repondeur = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      traits.current.push([point(e)])
      rafraichir(n => n + 1)
    },
    onPanResponderMove: e => {
      const t = traits.current[traits.current.length - 1]
      if (!t) return
      const [x, y] = point(e)
      const [px, py] = t[t.length - 1]
      // Sous 1,5 px, un point de plus n'ajoute rien au tracé.
      if (Math.abs(x - px) + Math.abs(y - py) < 1.5) return
      t.push([x, y])
      rafraichir(n => n + 1)
    },
    onPanResponderRelease: () => publier(),
    onPanResponderTerminate: () => publier(),
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  const { l, h } = taille.current
  const chemin = traitsVersPath(traits.current.map(t => (t.length === 1 ? [t[0], [t[0][0] + 0.5, t[0][1] + 0.5]] : t))
    .map(t => t.map(([x, y]) => [x / l, y / h])), l, h)

  return (
    <View
      onLayout={e => { taille.current = { l: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 } }}
      style={[{
        height: hauteur, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: '#B9B4A8',
        backgroundColor: '#FFFFFF', overflow: 'hidden',
      }, Platform.OS === 'web' && { touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }]}
      {...repondeur.panHandlers}
    >
      <Text pointerEvents="none" style={{ position: 'absolute', left: 14, top: 10, fontSize: 12, color: '#8A8578' }}>
        {libelle || 'Lu et approuvé — signez ici'}
      </Text>
      <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24, bottom: 40, height: 1, backgroundColor: '#DDD8CC' }} />
      <Svg width="100%" height="100%" pointerEvents="none">
        {chemin ? <Path d={chemin} stroke={couleurTrait} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </Svg>
    </View>
  )
})

export default PadSignature
