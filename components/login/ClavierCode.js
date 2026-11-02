// Saisie d'un code (restaurant ou personnel). La touche bas-gauche devient
// 🔐 (Face ID) quand ce compte l'a activé sur ce téléphone.
import { useEffect, useRef } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { SPRINGS } from '../../lib/animations'
import { Avatar, EnteteLogin, FondLogin } from './CadreLogin'

function Point({ rempli, erreur, couleur, t }) {
  const scale = useSharedValue(1)
  const avant = useRef(false)
  useEffect(() => {
    if (rempli && !avant.current) scale.value = withSequence(withSpring(1.4, SPRINGS.bouncy), withSpring(1, SPRINGS.snappy))
    avant.current = rempli
  }, [rempli, scale])
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const c = erreur ? t.erreur : couleur
  return <Animated.View style={[styles.point, aStyle, { borderColor: c }, rempli && { backgroundColor: c }]} />
}

function Touche({ label, onPress, disabled, t }) {
  if (label === '') return <View style={styles.toucheVide} />
  return (
    <Pressable
      onPress={() => { if (!disabled) onPress(label) }}
      style={({ pressed }) => [
        styles.touche,
        { backgroundColor: pressed ? t.toucheAppui : t.touche, borderColor: t.sombre ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
    >
      <Text style={[styles.toucheTxt, { color: t.texte }, label === '🔐' && { fontSize: 26 }]}>{label}</Text>
    </Pressable>
  )
}

// longueur : nombre de chiffres du code (4 anciens codes, 6 nouveaux) ;
// bandeau : message mis en avant au-dessus (ex. « Changez votre code ») ;
// messageErreur : texte d'erreur venant du serveur (essais restants…) ;
// liensBas : liens sous le clavier (lienBas : un seul, comme avant).
export default function ClavierCode({
  t, entete, consigne, pin, pinError, bloque, secondesRestantes, couleur,
  appuyerChiffre, supprimer, toucheFaceID, onFaceID, bioEnCours, bioMessage, lienBas,
  longueur = 4, bandeau = null, messageErreur = null, liensBas = null, verification = false,
}) {
  const shakeX = useSharedValue(0)
  useEffect(() => {
    if (pinError) {
      shakeX.value = withSequence(
        withTiming(-12, { duration: 50 }), withTiming(12, { duration: 55 }),
        withTiming(-10, { duration: 50 }), withTiming(10, { duration: 50 }),
        withTiming(-5, { duration: 45 }), withTiming(0, { duration: 45 }),
      )
    }
  }, [pinError, shakeX])
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }))

  // Web : taper le code au clavier physique (chiffres + retour arrière).
  useEffect(() => {
    if (Platform.OS !== 'web' || bloque) return
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '0' && e.key <= '9') { appuyerChiffre(e.key); e.preventDefault() }
      else if (e.key === 'Backspace' || e.key === 'Delete') { supprimer(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bloque, appuyerChiffre, supprimer])

  const touches = ['1', '2', '3', '4', '5', '6', '7', '8', '9', toucheFaceID ? '🔐' : '', '0', '⌫']

  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} compact />
        <View style={styles.corps}>
          <View style={styles.qui}>
            <Avatar t={t} initialesTexte={entete.initialesTexte} couleur={entete.couleur} taille={64} />
            <Text style={[styles.nom, { color: t.texte }]} numberOfLines={1}>{entete.titre}</Text>
            <Text style={[styles.sous, { color: t.texteFaible }]} numberOfLines={1}>{entete.sousTitre}</Text>
          </View>

          {bandeau ? (
            <View style={[styles.bandeau, { borderColor: couleur, backgroundColor: t.sombre ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' }]}>
              <Text style={[styles.bandeauTitre, { color: t.texte }]}>{bandeau.titre}</Text>
              {bandeau.texte ? <Text style={[styles.bandeauTexte, { color: t.texteDoux }]}>{bandeau.texte}</Text> : null}
            </View>
          ) : null}

          <Text style={[styles.consigne, { color: t.texteDoux }]}>{consigne}</Text>

          <Animated.View style={[styles.points, shakeStyle]}>
            {Array.from({ length: longueur }, (_, i) => i).map(i => (
              <Point key={i} t={t} rempli={pin.length > i} erreur={pinError || !!bloque} couleur={couleur} />
            ))}
          </Animated.View>

          <View style={styles.message}>
            {bloque ? (
              <Text style={[styles.erreur, { color: t.erreur }]}>🔒 Trop de tentatives — réessayez dans {secondesRestantes}</Text>
            ) : verification ? (
              <Text style={[styles.erreur, { color: t.texteDoux }]}>Vérification du code…</Text>
            ) : pinError ? (
              <Text style={[styles.erreur, { color: t.erreur }]}>{messageErreur || 'Code incorrect, réessayez'}</Text>
            ) : bioEnCours ? (
              <Text style={[styles.erreur, { color: t.texteDoux }]}>Vérification Face ID…</Text>
            ) : bioMessage ? (
              <Text style={[styles.erreur, { color: t.erreur }]}>{bioMessage}</Text>
            ) : null}
          </View>

          <View style={styles.pave}>
            {touches.map((k, i) => (
              <Touche
                key={i} t={t} label={k}
                disabled={k === '🔐' ? bioEnCours : !!bloque}
                onPress={(val) => (val === '⌫' ? supprimer() : val === '🔐' ? onFaceID() : appuyerChiffre(val))}
              />
            ))}
          </View>

          {(liensBas || (lienBas ? [lienBas] : [])).map(l => (
            <TouchableOpacity key={l.texte} onPress={l.onPress} style={styles.lien}>
              <Text style={[styles.lienTxt, { color: t.texteDoux }]}>{l.texte}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  bandeau: { alignSelf: 'stretch', borderWidth: 1.5, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14 },
  bandeauTitre: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  bandeauTexte: { fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  scroll:     { paddingBottom: 30 },
  corps:      { alignItems: 'center', marginTop: -34, paddingHorizontal: 16 },
  qui:        { alignItems: 'center' },
  nom:        { fontSize: 18, fontWeight: '700', marginTop: 10, maxWidth: 320 },
  sous:       { fontSize: 12.5, marginTop: 3, maxWidth: 320 },
  consigne:   { fontSize: 14, fontWeight: '600', marginTop: 18 },
  points:     { flexDirection: 'row', gap: 18, marginTop: 14 },
  point:      { width: 16, height: 16, borderRadius: 8, borderWidth: 2.5 },
  message:    { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
  erreur:     { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  pave:       { flexDirection: 'row', flexWrap: 'wrap', width: 282, gap: 14, justifyContent: 'center' },
  touche:     { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  toucheVide: { width: 76, height: 76 },
  toucheTxt:  { fontSize: 26, fontWeight: '400' },
  lien:       { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, marginTop: 14 },
  lienTxt:    { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
})
