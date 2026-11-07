import { useEffect, useState } from 'react'
import { Alert, Linking, Platform, Text, View } from 'react-native'

import { lienSms, lienWhatsApp, messagePour, numeroInternational } from '../../lib/evenements'
import { Bouton, Champ, Feuille, Libelle } from '../ui/EcranModerne'

// iPhone ou iPad : natif iOS, ou application web ajoutée à l'écran d'accueil (Platform.OS vaut alors 'web').
const estIOS = Platform.OS === 'ios'
  || (Platform.OS === 'web' && typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent))

export default function FeuilleMessage({ ligne, styles, colors, onFermer }) {
  const [texte, setTexte] = useState('')
  const [smsLance, setSmsLance] = useState(false)
  // Texte de départ à chaque ouverture : une modification ne vaut que pour cet envoi.
  useEffect(() => { if (ligne) { setTexte(messagePour(ligne)); setSmsLance(false) } }, [ligne])
  if (!ligne) return null

  const numero = numeroInternational(ligne.travailleur.contact)
  const vide = !texte.trim()

  function ouvrirSms(lien) {
    // Sur le web, openURL réussit toujours : on ne peut pas savoir si l'application SMS s'est ouverte.
    // On garde donc la fenêtre ouverte, avec le texte, et on explique quoi faire.
    if (Platform.OS === 'web') { Linking.openURL(lien).catch(() => {}); setSmsLance(true); return }
    ouvrir(lien, "l'application SMS")
  }

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
              onPress={() => ouvrirSms(lienSms(numero, texte.trim(), estIOS))} />
          </View>
          {smsLance ? <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 8 }}>{"Si l'application SMS ne s'ouvre pas, envoyez le message depuis un téléphone."}</Text> : null}
        </>
      )}
    </Feuille>
  )
}
