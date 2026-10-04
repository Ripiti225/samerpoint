// Proposition d'activer Face ID, juste après un code juste.
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { EnteteLogin, FondLogin } from './CadreLogin'

export default function ActivationFaceID({ t, utilisateur, restaurant, enCours, message, onActiver, onPlusTard, onJamais }) {
  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} compact />
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={[styles.carte, { backgroundColor: t.carte, borderColor: t.carteBord }]}
        >
          <Text style={styles.icone}>🔐</Text>
          <Text style={[styles.titre, { color: t.texte }]}>Entrer plus vite la prochaine fois ?</Text>
          <Text style={[styles.texte, { color: t.texteDoux }]}>
            {restaurant
              ? `Activez Face ID ou l’empreinte sur ce téléphone : vous entrerez directement dans ${restaurant.nom}, sans taper vos deux codes.`
              : 'Activez Face ID ou l’empreinte sur ce téléphone : vous entrerez directement dans l’administration, sans taper votre code.'}
          </Text>
          <Text style={[styles.avert, { color: t.texteFaible }]}>
            ⚠️ À faire seulement sur VOTRE téléphone. Toute personne dont le visage ou le doigt est enregistré sur ce téléphone pourra entrer avec votre compte.
          </Text>

          <TouchableOpacity
            style={[styles.bouton, { backgroundColor: t.accent }, enCours && { opacity: 0.6 }]}
            onPress={onActiver}
            disabled={enCours}
            activeOpacity={0.85}
          >
            <Text style={styles.boutonTxt}>{enCours ? 'Vérification…' : 'Activer sur ce téléphone'}</Text>
          </TouchableOpacity>
          {!!message && <Text style={[styles.erreur, { color: t.erreur }]}>{message}</Text>}

          <TouchableOpacity style={styles.second} onPress={onPlusTard} disabled={enCours}>
            <Text style={[styles.secondTxt, { color: t.texteDoux }]}>Plus tard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.second} onPress={onJamais} disabled={enCours}>
            <Text style={[styles.secondTxt, { color: t.texteFaible }]}>
              Ne plus me demander sur ce téléphone ({utilisateur?.nom})
            </Text>
          </TouchableOpacity>
        </Animated.View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:    { paddingBottom: 30 },
  carte:     { marginTop: -26, marginHorizontal: 16, alignSelf: 'center', width: '92%', maxWidth: 440,
               borderRadius: 24, borderWidth: 1, padding: 22, alignItems: 'center',
               shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  icone:     { fontSize: 50, marginBottom: 10 },
  titre:     { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  texte:     { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 12 },
  avert:     { fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginBottom: 20 },
  bouton:    { width: '100%', minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  boutonTxt: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  erreur:    { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 10 },
  second:    { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
  secondTxt: { fontSize: 14, textAlign: 'center' },
})
