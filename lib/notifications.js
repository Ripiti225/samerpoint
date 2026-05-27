import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Alert, Platform } from 'react-native'
import { supabase } from './supabase'

const EXPO_PROJECT_ID = '1f840fa7-6f32-4302-a82f-4d8f258e96f6'

// NE PAS appeler setNotificationHandler au niveau module —
// ça crashe Android avant l'initialisation du module natif.
// On le configure uniquement à la demande, dans enregistrerTokenDirecteur.

function configurerHandler() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })
  } catch (_) {}
}

export async function enregistrerTokenDirecteur(userId) {
  if (!Device.isDevice) return
  if (Platform.OS === 'web') return

  try {
    configurerHandler()

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Alertes Samtrackly',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
      })
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      await new Promise(resolve =>
        Alert.alert(
          'Activer les alertes',
          'Pour recevoir les alertes de validation du point journalier, veuillez autoriser les notifications.',
          [{ text: 'Continuer', onPress: resolve }]
        )
      )
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') return

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID })
    const token = tokenData.data
    if (!token) return

    await supabase
      .from('admin_push_tokens')
      .upsert(
        { user_id: userId, token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
  } catch (err) {
    console.error('Erreur enregistrement token push:', err)
  }
}

export async function envoyerNotifValidation(dateJour, restaurantId = null, pointId = null) {
  try {
    // Récupérer uniquement les IDs des managers et directeurs
    const { data: users } = await supabase
      .from('utilisateurs')
      .select('id')
      .in('role', ['manager', 'directeur'])

    const userIds = (users || []).map(u => u.id)
    if (userIds.length === 0) return

    const { data: rows } = await supabase
      .from('admin_push_tokens')
      .select('user_id, token')
      .in('user_id', userIds)

    if (!rows || rows.length === 0) return

    const [y, m, d] = (dateJour || '').split('-')
    const dateFormatee = (y && m && d) ? `${d}/${m}/${y}` : dateJour || ''

    const messages = rows.map(r => ({
      to: r.token,
      title: 'Point journalier validé ✅',
      body: `Le point du ${dateFormatee} a été validé. Ouvrez l'application pour consulter le récapitulatif.`,
      sound: 'default',
      data: { screen: 'verification', restaurant_id: restaurantId, point_id: pointId },
    }))

    const BATCH = 100
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH)
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
          body: JSON.stringify(batch),
        })

        const result = await response.json()
        const data = Array.isArray(result.data) ? result.data : [result.data]

        const tokensASupprimer = []
        data.forEach((item, idx) => {
          if (
            item?.status === 'error' &&
            (item.details?.error === 'DeviceNotRegistered' ||
              item.details?.error === 'InvalidCredentials')
          ) {
            const token = rows[i + idx]?.token
            if (token) tokensASupprimer.push(token)
          }
        })

        for (const token of tokensASupprimer) {
          await supabase.from('admin_push_tokens').delete().eq('token', token)
        }
      } catch (_) {}
    }
  } catch (_) {}
}
