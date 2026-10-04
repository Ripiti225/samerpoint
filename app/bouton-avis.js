// ──────────────────────────────────────────────────────────────────────────────
//  BOUTON AVIS — installation (manager uniquement)
//
//  Génère le favori Chrome « ⭐ Avis → Samtrackly » : on le glisse dans la
//  barre de favoris, puis on clique dessus depuis le portail Glovo ou la page
//  Avis de Yango pour envoyer les nouveaux avis. Le secret d'ingestion est
//  collé ici une fois et n'est enregistré nulle part.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { construireFavori, secretValide } from '../lib/boutonAvis'
import { retour } from '../lib/navigation'

export default function BoutonAvis() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif } = useApp()
  const web = Platform.OS === 'web'

  const [secret, setSecret] = useState('')
  const [source, setSource] = useState(null)
  const [erreur, setErreur] = useState(null)
  const lienRef = useRef(null)

  useEffect(() => {
    if (!web) return
    fetch('/bouton-avis.js')
      .then(r => (r.ok ? r.text() : Promise.reject(new Error('absent'))))
      .then(setSource)
      .catch(() => setErreur("Le code du bouton n'a pas pu être chargé. Rechargez la page."))
  }, [web])

  const favori = useMemo(() => {
    if (!web || !source || !secretValide(secret)) return null
    return construireFavori(source, { origine: window.location.origin, secret })
  }, [web, source, secret])

  // React bloque les liens « javascript: » passés en href : on pose
  // l'adresse directement sur l'élément.
  useEffect(() => {
    if (lienRef.current && favori) lienRef.current.setAttribute('href', favori)
  }, [favori])

  const entete = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitre}>Bouton avis</Text>
      <Text style={styles.headerSub}>Envoyer les avis Glovo & Yango en un clic</Text>
    </View>
  )

  if (roleActif !== 'manager') {
    return (
      <SafeAreaView style={styles.container}>
        {entete}
        <View style={styles.body}><Text style={styles.texte}>Cet écran est réservé au manager.</Text></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {entete}
      <ScrollView style={styles.body}>
        {!web ? (
          <Text style={styles.texte}>
            Le bouton s'installe dans Chrome, sur ordinateur. Ouvrez Samtrackly dans Chrome pour l'installer.
          </Text>
        ) : (
          <>
            <Text style={styles.etape}>1. Collez le secret d'ingestion</Text>
            <Text style={styles.aide}>
              Il se trouve dans votre gestionnaire de mots de passe (64 caractères). Il n'est enregistré nulle part.
            </Text>
            <TextInput
              style={styles.champ}
              value={secret}
              onChangeText={setSecret}
              placeholder="Secret d'ingestion"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {secret && !secretValide(secret) ? (
              <Text style={styles.erreur}>Ce secret n'a pas le bon format : 64 caractères (chiffres et lettres a à f).</Text>
            ) : null}
            {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

            <Text style={styles.etape}>2. Glissez ce bouton dans la barre de favoris de Chrome</Text>
            {favori ? (
              <a
                ref={lienRef}
                draggable
                onClick={e => e.preventDefault()}
                style={{
                  display: 'inline-block', alignSelf: 'flex-start', padding: '12px 18px', borderRadius: 10,
                  background: colors.primary, color: '#FFFFFF', fontWeight: 700, fontSize: 15,
                  textDecoration: 'none', cursor: 'grab', marginBottom: 6,
                }}
              >
                ⭐ Avis → Samtrackly
              </a>
            ) : (
              <Text style={styles.aide}>Le bouton apparaît dès que le secret est collé.</Text>
            )}
            <Text style={styles.aide}>
              Barre de favoris cachée : Cmd + Maj + B (Mac) ou Ctrl + Maj + B (Windows).
            </Text>

            <Text style={styles.etape}>3. Utilisation</Text>
            <Text style={styles.texte}>
              • Glovo : sur n'importe quelle page du portail Glovo, cliquez sur le bouton.{'\n'}
              • Yango : ouvrez la page Avis (filtre « Tous les restaurants »), puis cliquez sur le bouton.{'\n'}
              • Une petite fenêtre affiche le résultat : nouveaux avis, litiges créés.{'\n'}
              • Un clic par portail, idéalement chaque jour. Samtrackly le rappelle après 2 jours sans envoi.
            </Text>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  backBtn: { marginBottom: 8 },
  backTxt: { color: colors.primaryText, fontSize: 14 },
  headerTitre: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },
  body: { flex: 1, padding: 16 },
  etape: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 6 },
  aide: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: 8 },
  texte: { fontSize: 14, color: colors.text, lineHeight: 22 },
  champ: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, minHeight: 48, color: colors.text, fontSize: 14 },
  erreur: { fontSize: 13, color: colors.errorDark, marginTop: 8 },
}) }
