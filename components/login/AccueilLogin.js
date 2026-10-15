// Premier écran : comptes Face ID du téléphone, puis restaurants (reconnus
// d'abord), puis l'accès Manager / RH.
import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { miniature } from '../../lib/miniature'
import { Avatar, EnteteLogin, FondLogin } from './CadreLogin'
import { couleurResto, initiales, VIOLET, ORANGE } from './themeLogin'

function LigneCompte({ t, e, enCours, modeRetrait, onPress }) {
  const admin = !e.restaurantId
  return (
    <TouchableOpacity
      style={[styles.ligne, { backgroundColor: t.carte, borderColor: t.carteBord }, enCours && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={enCours}
      activeOpacity={0.85}
    >
      <Avatar t={t} initialesTexte={initiales(e.userNom)} couleur={admin ? VIOLET : ORANGE} taille={40} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.ligneNom, { color: t.texte }]} numberOfLines={1}>{e.userNom}</Text>
        <Text style={[styles.ligneSous, { color: t.texteDoux }]} numberOfLines={1}>{e.restaurantNom}</Text>
      </View>
      {modeRetrait
        ? <Text style={[styles.retirer, { color: t.erreur }]}>Retirer</Text>
        : <Text style={styles.cadenas}>{enCours ? '…' : '🔐'}</Text>}
    </TouchableOpacity>
  )
}

function CarteResto({ t, item, index, reconnu, onPress }) {
  const couleur = couleurResto(item)
  return (
    <Animated.View entering={FadeInUp.delay(index * 60).springify().damping(18)} style={styles.carteWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.carte,
          { backgroundColor: t.carte, borderColor: t.carteBord },
          pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
        ]}
      >
        {item.photo_url ? (
          <Image source={{ uri: miniature(item.photo_url, 72) }} style={styles.restoImg} />
        ) : (
          <View style={[styles.restoImg, styles.restoInit, { backgroundColor: couleur }]}>
            <Text style={styles.restoInitTxt}>{initiales(item.nom)}</Text>
          </View>
        )}
        <Text style={[styles.restoNom, { color: t.texte }]} numberOfLines={2}>{item.nom}</Text>
        <Text style={[styles.restoLoc, { color: t.texteFaible }]} numberOfLines={1}>{item.localisation || 'Abidjan'}</Text>
        {reconnu && <Text style={[styles.reconnu, { color: t.accent }]}>✓ reconnu</Text>}
      </Pressable>
    </Animated.View>
  )
}

export default function AccueilLogin({
  t, restaurants, chargement, reconnusIds, enrolements,
  bioSupportee, bioEnCours, bioMessage, onFaceID, onRetirerFaceID, onResto, onGlobal,
}) {
  const [modeRetrait, setModeRetrait] = useState(false)
  const comptes = bioSupportee ? enrolements : []

  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} sousTitre="Bonjour 👋" />
        <View style={styles.corps}>
          {comptes.length > 0 && (
            <Animated.View entering={FadeInDown.springify().damping(18)}>
              <Text style={[styles.label, { color: t.texteFaible }]}>Vos comptes sur ce téléphone</Text>
              {comptes.map(e => (
                <LigneCompte
                  key={e.credentialId} t={t} e={e} enCours={bioEnCours} modeRetrait={modeRetrait}
                  onPress={() => (modeRetrait ? onRetirerFaceID(e) : onFaceID(e))}
                />
              ))}
              {!!bioMessage && <Text style={[styles.erreur, { color: t.erreur }]}>{bioMessage}</Text>}
              <TouchableOpacity onPress={() => setModeRetrait(m => !m)} style={styles.gerer}>
                <Text style={[styles.gererTxt, { color: t.texteFaible }]}>
                  {modeRetrait ? 'Terminé' : 'Gérer Face ID'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
          {comptes.length === 0 && !!bioMessage && (
            <Text style={[styles.erreur, { color: t.erreur }]}>{bioMessage}</Text>
          )}

          <Text style={[styles.label, { color: t.texteFaible }]}>
            {comptes.length > 0 ? 'Ou choisissez un restaurant' : 'Choisissez votre restaurant'}
          </Text>
          {chargement ? (
            <ActivityIndicator size="large" color={t.accent} style={{ marginTop: 30 }} />
          ) : restaurants.length === 0 ? (
            <Text style={[styles.vide, { color: t.texteFaible }]}>Aucun restaurant trouvé</Text>
          ) : (
            <View style={styles.grille}>
              {restaurants.map((r, i) => (
                <CarteResto key={r.id} t={t} item={r} index={i} reconnu={reconnusIds.includes(r.id)} onPress={() => onResto(r)} />
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.global, { backgroundColor: t.global, borderColor: t.globalBord }]}
            onPress={onGlobal}
            activeOpacity={0.85}
          >
            <Text style={styles.globalIcone}>👑</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.globalTxt, { color: t.globalTexte }]}>Accès Manager / RH</Text>
              <Text style={[styles.globalSous, { color: t.globalTexte }]}>Administration & ressources humaines</Text>
            </View>
            <Text style={[styles.fleche, { color: t.globalTexte }]}>›</Text>
          </TouchableOpacity>
        </View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:      { paddingBottom: 30 },
  corps:       { paddingHorizontal: 16, marginTop: 4, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label:       { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 18, marginBottom: 10, marginLeft: 4 },
  ligne:       { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10,
                 borderRadius: 18, borderWidth: 1, marginBottom: 8,
                 shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  ligneNom:    { fontSize: 15, fontWeight: '700' },
  ligneSous:   { fontSize: 12, marginTop: 2 },
  cadenas:     { fontSize: 22 },
  retirer:     { fontSize: 13, fontWeight: '700' },
  erreur:      { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  gerer:       { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  gererTxt:    { fontSize: 12, textDecorationLine: 'underline' },
  grille:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  carteWrap:   { width: '48.5%', marginBottom: 12 },
  carte:       { borderRadius: 20, borderWidth: 1, padding: 14, alignItems: 'center', minHeight: 150,
                 shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  restoImg:    { width: 72, height: 72, borderRadius: 18, marginBottom: 10 },
  restoInit:   { alignItems: 'center', justifyContent: 'center' },
  restoInitTxt:{ color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  restoNom:    { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  restoLoc:    { fontSize: 11, marginTop: 3, textAlign: 'center' },
  reconnu:     { fontSize: 11, fontWeight: '700', marginTop: 6 },
  vide:        { textAlign: 'center', marginTop: 30, fontSize: 14 },
  global:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1,
                 padding: 16, marginTop: 8, minHeight: 64 },
  globalIcone: { fontSize: 26 },
  globalTxt:   { fontSize: 14, fontWeight: '700' },
  globalSous:  { fontSize: 11, marginTop: 2, opacity: 0.8 },
  fleche:      { fontSize: 22 },
})
