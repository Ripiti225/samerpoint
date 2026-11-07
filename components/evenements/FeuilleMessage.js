import { useEffect, useState } from 'react'
import { Alert, Linking, Platform, Text, View } from 'react-native'

import { lienSms, lienWhatsApp, messagePour, numeroInternational } from '../../lib/evenements'
import { Bouton, Champ, Feuille, Libelle } from '../ui/EcranModerne'

export default function FeuilleMessage({ ligne, styles, colors, onFermer }) {
  const [texte, setTexte] = useState('')
  // Texte de départ à chaque ouverture : une modification ne vaut que pour cet envoi.
  useEffect(() => { if (ligne) setTexte(messagePour(ligne)) }, [ligne])
  if (!ligne) return null

  const numero = numeroInternational(ligne.travailleur.contact)
  const vide = !texte.trim()

  function ouvrir(lien, appli) {
    Linking.openURL(lien)
      .then(onFermer)
      .catch(() => Alert.alert('Envoi impossible', `Impossible d'ouvrir ${appli} sur cet appareil.`))
  }

  return (
    <Feuille visible titre="💬 Envoyer un message" sous={ligne.travailleur.nom} onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Message (modifiable)</Libelle>
      <Champ styles={styles} colors={colors} multiline value={texte} onChangeText={setTexte} placeholder="Écrivez votre message" />
      {!numero ? (
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.error }}>Pas de numéro valide sur la fiche</Text>
      ) : (
        <>
          {vide ? <Text style={{ fontSize: 13, color: colors.error, marginBottom: 8 }}>{"Écrivez un message pour pouvoir l'envoyer."}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton label="📲 WhatsApp" variante="plein" couleur="#25D366" flex grand styles={styles} disabled={vide}
              onPress={() => ouvrir(lienWhatsApp(numero, texte.trim()), 'WhatsApp')} />
            <Bouton label="💬 SMS" variante="plein" couleur="#2F7FD8" flex grand styles={styles} disabled={vide}
              onPress={() => ouvrir(lienSms(numero, texte.trim(), Platform.OS === 'ios'), "l'application SMS")} />
          </View>
        </>
      )}
    </Feuille>
  )
}
