// react-native-web ne fournit AUCUNE implémentation d'Alert.alert (c'est un
// no-op : `static alert() {}`). Résultat sur le web : les confirmations à 2
// boutons ne s'affichent jamais et leur action (ex: « marquer vérifié »,
// suppressions, validations…) ne se déclenche pas.
//
// On remplace donc Alert.alert par les dialogues natifs du navigateur
// (window.alert / window.confirm), qui fonctionnent partout (dont iOS Safari).
// Mapping :
//   - 0 ou 1 bouton  → window.alert, puis on déclenche l'onPress éventuel.
//   - 2 boutons et + → window.confirm : OK déclenche le bouton « non-cancel »
//     (l'action de confirmation), Annuler déclenche le bouton de style 'cancel'.

import { Alert, Platform } from 'react-native'

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title, message, buttons) => {
    const texte = [title, message].filter(Boolean).join('\n\n')

    if (!buttons || buttons.length <= 1) {
      window.alert(texte)
      buttons?.[0]?.onPress?.()
      return
    }

    const cancel = buttons.find(b => b.style === 'cancel')
    const confirm = buttons.find(b => b.style !== 'cancel') || buttons[buttons.length - 1]

    if (window.confirm(texte)) confirm?.onPress?.()
    else cancel?.onPress?.()
  }
}
