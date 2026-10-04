// « Qui êtes-vous ? » : grille d'avatars. Un avatar 🔐 a Face ID sur ce
// téléphone ; login.js lance alors Face ID dès l'appui.
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInUp } from 'react-native-reanimated'
import SignatureFooter from '../SignatureFooter'
import { Avatar, EnteteLogin, FondLogin } from './CadreLogin'
import { couleurResto, couleurRole, initiales, libelleRole, prenom } from './themeLogin'

export default function QuiEtesVous({
  t, restaurant, utilisateurs, chargement, reconnu, idsFaceID, reprisParLePOS, onChoisir, onRetour,
}) {
  return (
    <FondLogin t={t}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <EnteteLogin t={t} compact />
        <View style={styles.corps}>
          <View style={[styles.puce, { backgroundColor: t.carte, borderColor: t.carteBord }]}>
            {restaurant ? (
              <>
                <View style={[styles.point, { backgroundColor: couleurResto(restaurant) }]} />
                <Text style={[styles.puceNom, { color: t.texte }]} numberOfLines={1}>{restaurant.nom}</Text>
                {reconnu && <Text style={[styles.puceInfo, { color: t.texteFaible }]}>✓ téléphone reconnu</Text>}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 16 }}>👑</Text>
                <Text style={[styles.puceNom, { color: t.texte }]}>Accès global</Text>
              </>
            )}
          </View>

          <Text style={[styles.label, { color: t.texteFaible }]}>Qui êtes-vous ?</Text>

          {chargement ? (
            <ActivityIndicator size="large" color={t.accent} style={{ marginTop: 30 }} />
          ) : (
            <View style={styles.grille}>
              {utilisateurs.map((u, i) => (
                <Animated.View key={u.id} entering={FadeInUp.delay(i * 50).springify().damping(18)} style={styles.case}>
                  <Pressable
                    onPress={() => onChoisir(u)}
                    style={({ pressed }) => [styles.personne, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}
                  >
                    <Avatar t={t} initialesTexte={initiales(u.nom)} couleur={couleurRole(u.role)} taille={60} badge={idsFaceID.includes(u.id)} />
                    <Text style={[styles.prenom, { color: t.texte }]} numberOfLines={1}>{prenom(u.nom)}</Text>
                    <Text style={[styles.role, { color: t.texteFaible }]} numberOfLines={1}>{libelleRole(u.role)}</Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}

          {!chargement && utilisateurs.length === 0 && reprisParLePOS.length === 0 && (
            <Text style={[styles.vide, { color: t.texteFaible }]}>Aucun utilisateur pour ce restaurant</Text>
          )}

          {reprisParLePOS.length > 0 && (
            // Un compte qui disparaît sans un mot déclenche un appel au
            // support : on explique l'absence là où elle se constate.
            <View style={[styles.pos, { borderColor: t.carteBord, backgroundColor: t.carte }]}>
              <Text style={styles.posIcone}>🖥️</Text>
              <Text style={[styles.posTitre, { color: t.texteDoux }]}>
                {reprisParLePOS.length > 1 ? 'Les caissières se connectent sur la caisse' : 'La caissière se connecte sur la caisse'}
              </Text>
              <Text style={[styles.posTexte, { color: t.texteFaible }]}>
                Ce restaurant est équipé du POS. Le point de shift, les dépenses et
                l'inventaire s'y font, et arrivent ici automatiquement.
              </Text>
              <Text style={[styles.posTexte, { color: t.texteFaible, marginTop: 8 }]}>
                Manager : en cas de panne de la caisse, rétablissez la saisie depuis
                Paramètres → Restaurants. Les comptes sont intacts.
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={onRetour} style={styles.lien}>
            <Text style={[styles.lienTxt, { color: t.texteDoux }]}>
              {restaurant ? 'Changer de restaurant' : '‹ Retour'}
            </Text>
          </TouchableOpacity>
        </View>
        <SignatureFooter />
      </ScrollView>
    </FondLogin>
  )
}

const styles = StyleSheet.create({
  scroll:   { paddingBottom: 30 },
  corps:    { paddingHorizontal: 16, marginTop: -24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  puce:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1,
              paddingHorizontal: 14, minHeight: 52,
              shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  point:    { width: 10, height: 10, borderRadius: 5 },
  puceNom:  { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  puceInfo: { fontSize: 11, marginLeft: 'auto' },
  label:    { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 12, marginLeft: 4 },
  grille:   { flexDirection: 'row', flexWrap: 'wrap' },
  case:     { width: '33.33%', marginBottom: 16 },
  personne: { alignItems: 'center', paddingVertical: 6, minHeight: 104 },
  prenom:   { fontSize: 13, fontWeight: '700', marginTop: 8, maxWidth: '92%' },
  role:     { fontSize: 11, marginTop: 2 },
  vide:     { textAlign: 'center', marginTop: 30, fontSize: 14 },
  pos:      { marginTop: 8, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', padding: 16, alignItems: 'center' },
  posIcone: { fontSize: 22, marginBottom: 6 },
  posTitre: { fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  posTexte: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  lien:     { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, marginTop: 8 },
  lienTxt:  { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
})
