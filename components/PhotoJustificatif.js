// Affichage d'une photo justificative qui ne ment jamais sur son état.
//
// Un <Image> nu rend un rectangle noir quand l'URL ne pointe sur rien — c'est
// exactement ce que voyaient les vérificateurs sur les 81 factures dont la
// `photo_url` était une URI locale (`file:///…`). Le cadre noir laissait croire
// à un souci d'affichage alors que la photo n'avait jamais quitté le téléphone.
//
// Trois cas sont distingués explicitement :
//   • jeton `pending-photo://…` → envoi en attente, la photo existe encore
//   • URI locale               → perdue, elle n'a jamais été envoyée
//   • URL distante illisible   → détectée à l'exécution via onError

import { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { estPhotoEnAttente, estPhotoLocale } from '../lib/photoQueue'

export default function PhotoJustificatif({ uri, style, resizeMode = 'cover', compact = false }) {
  const [erreur, setErreur] = useState(false)

  // Sans ça, recycler le composant sur une autre photo garderait l'erreur
  // de la précédente et masquerait une image parfaitement valide.
  useEffect(() => { setErreur(false) }, [uri])

  if (estPhotoEnAttente(uri)) {
    return (
      <View style={[styles.etat, styles.attente, style]}>
        <Text style={styles.icone}>⏳</Text>
        {!compact && <Text style={styles.texteAttente}>Envoi en attente</Text>}
      </View>
    )
  }

  if (!uri || estPhotoLocale(uri) || erreur) {
    return (
      <View style={[styles.etat, styles.indisponible, style]}>
        <Text style={styles.icone}>🚫</Text>
        {!compact && <Text style={styles.texteIndispo}>Photo indisponible</Text>}
      </View>
    )
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setErreur(true)}
    />
  )
}

// Une photo est-elle réellement consultable ? (pour décider d'ouvrir la galerie)
export function photoConsultable(uri) {
  return !!uri && !estPhotoLocale(uri) && !estPhotoEnAttente(uri)
}

const styles = StyleSheet.create({
  etat: { alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: 6 },
  attente: { backgroundColor: '#FDF3E0', borderWidth: 1, borderColor: '#EFC97F', borderStyle: 'dashed' },
  indisponible: { backgroundColor: '#F6E9E5', borderWidth: 1, borderColor: '#D9A899', borderStyle: 'dashed' },
  icone: { fontSize: 18 },
  texteAttente: { fontSize: 9, color: '#8A6220', textAlign: 'center', marginTop: 2, fontWeight: '600' },
  texteIndispo: { fontSize: 9, color: '#993C1D', textAlign: 'center', marginTop: 2, fontWeight: '600' },
})
