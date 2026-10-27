// ──────────────────────────────────────────────────────────────────────────────
//  FAVORI VENTES YANGO — installation
//
//  Génère le favori Chrome « 🛵 Ventes Yango → Samtrackly » : on le glisse dans
//  la barre de favoris, puis on clique dessus depuis le portail Yango. Il ouvre
//  Trésorerie → Partenaires, prêt à lire une semaine (ventes + pub) sans
//  fichier Excel. Aucun secret : l'import se fait avec la session Samtrackly.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../context/ThemeContext'
import { construireFavoriVentes } from '../lib/boutonVentesYango'
import { retour } from '../lib/navigation'

export default function BoutonVentesYango() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const web = Platform.OS === 'web'

  const [source, setSource] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [aideClic, setAideClic] = useState(false)
  const lienRef = useRef(null)

  useEffect(() => {
    if (!web) return
    fetch('/bouton-ventes-yango.js')
      .then(r => (r.ok ? r.text() : Promise.reject(new Error('absent'))))
      .then(setSource)
      .catch(() => setErreur("Le code du favori n'a pas pu être chargé. Rechargez la page."))
  }, [web])

  const favori = useMemo(() => {
    if (!web || !source) return null
    try { return construireFavoriVentes(source, { origine: window.location.origin }) } catch { return null }
  }, [web, source])

  // React bloque les liens « javascript: » passés en href : on pose
  // l'adresse directement sur l'élément.
  useEffect(() => {
    if (lienRef.current && favori) lienRef.current.setAttribute('href', favori)
  }, [favori])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Favori Ventes Yango</Text>
        <Text style={styles.headerSub}>Les ventes et la pub Yango sans fichier Excel</Text>
      </View>
      <ScrollView style={styles.body}>
        {!web ? (
          <Text style={styles.texte}>
            Le favori s'installe dans Chrome, sur ordinateur. Ouvrez Samtrackly dans Chrome pour l'installer.
          </Text>
        ) : (
          <>
            {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

            <Text style={styles.etape}>1. Glissez ce bouton dans la barre de favoris de Chrome (ne cliquez pas dessus ici)</Text>
            {favori ? (
              <a
                ref={lienRef}
                draggable
                onClick={e => { e.preventDefault(); setAideClic(true) }}
                style={{
                  display: 'inline-block', alignSelf: 'flex-start', padding: '12px 18px', borderRadius: 10,
                  background: colors.primary, color: '#FFFFFF', fontWeight: 700, fontSize: 15,
                  textDecoration: 'none', cursor: 'grab', marginBottom: 6,
                }}
              >
                🛵 Ventes Yango → Samtrackly
              </a>
            ) : (
              !erreur && <Text style={styles.aide}>Chargement du favori…</Text>
            )}
            {aideClic ? (
              <Text style={styles.avertissement}>
                Ce bouton ne se clique pas ici. Maintenez-le enfoncé et faites-le glisser jusque dans la barre de
                favoris de Chrome (sous la barre d'adresse). Ensuite, cliquez dessus depuis le portail Yango.
              </Text>
            ) : null}
            <Text style={styles.aide}>
              Barre de favoris cachée : Cmd + Maj + B (Mac) ou Ctrl + Maj + B (Windows).
            </Text>

            <Text style={styles.etape}>2. Utilisation</Text>
            <Text style={styles.texte}>
              • Connectez-vous à Samtrackly dans ce même Chrome.{'\n'}
              • Ouvrez le portail Yango (n'importe quelle page) et cliquez sur le favori.{'\n'}
              • Une fenêtre Samtrackly s'ouvre : choisissez la semaine, « Lire la semaine », vérifiez, puis « Importer ».{'\n'}
              • Les commandes annulées que Yango paie quand même sont comptées.{'\n'}
              • La pub est ajoutée seulement quand Yango l'a comptée jusqu'au jeudi. Sinon, recliquez plus tard ou saisissez-la à la main.
            </Text>
            <Text style={[styles.aide, { marginTop: 10 }]}>
              Le favori ouvre l'adresse depuis laquelle il a été installé : réinstallez-le après un changement
              d'adresse de Samtrackly ou une mise à jour du favori.
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
  erreur: { fontSize: 13, color: colors.errorDark, marginTop: 8 },
  avertissement: { fontSize: 14, color: '#8A4B00', backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12, marginBottom: 8, lineHeight: 21, fontWeight: '600' },
}) }
