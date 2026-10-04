// Fond, bandeau et avatar partagés par les écrans de connexion.
// Pas de module natif de dégradé (OTA uniquement) : sur le web le dégradé
// est posé directement sur l'élément DOM, sur natif on garde une couleur unie.
import { Image, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { DEGRADE_BANDEAU, DEGRADE_SOMBRE } from './themeLogin'

function poserDegrade(degrade) {
  return (el) => {
    if (Platform.OS === 'web' && el?.style) el.style.backgroundImage = degrade
  }
}

export function FondLogin({ t, children }) {
  return (
    <SafeAreaView
      ref={t.sombre ? poserDegrade(DEGRADE_SOMBRE) : undefined}
      style={[styles.fond, { backgroundColor: t.fond }]}
    >
      {children}
    </SafeAreaView>
  )
}

export function EnteteLogin({ t, sousTitre, compact }) {
  return (
    <View
      ref={t.sombre ? undefined : poserDegrade(DEGRADE_BANDEAU)}
      style={[
        styles.bandeau,
        compact && styles.bandeauCompact,
        { backgroundColor: t.bandeauUni || 'transparent' },
      ]}
    >
      <View style={[styles.logoTuile, compact && styles.logoTuileCompact]}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      </View>
      {!!sousTitre && <Text style={[styles.sousTitre, { color: t.sousBandeau }]}>{sousTitre}</Text>}
    </View>
  )
}

export function Avatar({ nom, initialesTexte, couleur, taille = 52, badge, t }) {
  return (
    <View style={{ width: taille, height: taille }}>
      <View style={[
        styles.avatar,
        { width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur },
      ]}>
        <Text style={[styles.avatarTxt, { fontSize: taille * 0.32 }]}>{initialesTexte}</Text>
      </View>
      {badge && (
        <View style={[styles.badge, { backgroundColor: t.sombre ? '#1E1A14' : '#FFFFFF' }]}>
          <Text style={styles.badgeTxt}>🔐</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fond:             { flex: 1 },
  bandeau:          { width: '100%', alignItems: 'center', paddingTop: 28, paddingBottom: 46,
                      borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  bandeauCompact:   { paddingTop: 18, paddingBottom: 40 },
  logoTuile:        { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
                      shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  logoTuileCompact: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  logo:             { width: 120, height: 64 },
  sousTitre:        { fontSize: 14, fontWeight: '600', marginTop: 10, letterSpacing: 0.2 },
  avatar:           { alignItems: 'center', justifyContent: 'center' },
  avatarTxt:        { color: '#FFFFFF', fontWeight: '700' },
  badge:            { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
                      alignItems: 'center', justifyContent: 'center' },
  badgeTxt:         { fontSize: 12 },
})
