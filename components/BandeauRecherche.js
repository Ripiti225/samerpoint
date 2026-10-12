/*
 * Bandeau de rappel de la recherche globale : sur l'écran ouvert depuis un
 * résultat, rappelle ce qu'on cherchait (date · restaurant · extrait) tant que
 * l'écran ne sait pas encore s'ouvrir tout seul au bon endroit (lot 2).
 * Toucher le bandeau = revenir aux résultats ; la croix le ferme.
 */

import { router, usePathname } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../context/ThemeContext'
import { rechercheCourante } from '../lib/rechercheCourante'
import { dateCourte, extrait, texteLisible } from '../lib/rechercheGlobale'

const ECRANS_SANS_BANDEAU = ['/recherche', '/accueil', '/login', '/']

export default function BandeauRecherche() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const pathname = usePathname()
  const [r, setR] = useState(rechercheCourante.lire())

  useEffect(() => rechercheCourante.abonner(setR), [])

  if (!r || ECRANS_SANS_BANDEAU.includes(pathname)) return null
  const e = extrait(texteLisible(r.texte), r.terme, 30)
  const entete = [dateCourte(r.date), r.restaurant_nom].filter(Boolean).join(' · ')

  return (
    <View style={styles.conteneur} pointerEvents="box-none">
      <View style={styles.bandeau}>
        <TouchableOpacity style={styles.corps} onPress={() => router.push('/recherche')} accessibilityRole="button"
          accessibilityLabel="Revenir aux résultats de recherche">
          <Text style={styles.entete} numberOfLines={1}>🔍 {entete || r.source}</Text>
          <Text style={styles.texte} numberOfLines={2}>
            {e.avant}{e.trouve ? <Text style={styles.surligne}>{e.trouve}</Text> : null}{e.apres}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fermer} onPress={() => rechercheCourante.definir(null)}
          accessibilityRole="button" accessibilityLabel="Fermer le rappel de recherche">
          <Text style={styles.fermerTxt}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    conteneur: { position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center', paddingHorizontal: 12 },
    bandeau: {
      flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 560,
      backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.primary,
      shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    },
    corps: { flex: 1, paddingVertical: 10, paddingLeft: 14 },
    entete: { fontSize: 12, fontWeight: '700', color: colors.primary },
    texte: { fontSize: 13, color: colors.text, marginTop: 2 },
    surligne: { backgroundColor: colors.warningLight, fontWeight: '800' },
    fermer: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    fermerTxt: { fontSize: 16, color: colors.textMuted },
  })
}
