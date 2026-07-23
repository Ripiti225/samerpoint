import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Alert, Platform } from 'react-native'
import { supabase } from './supabase'

// projectId pris depuis app.json (extra.eas.projectId) — mis à jour par `eas init`.
// Le token push doit correspondre au projet Expo sous lequel l'APK est buildé.
const EXPO_PROJECT_ID =
  Constants.expoConfig?.extra?.eas?.projectId ||
  Constants.easConfig?.projectId ||
  '1f840fa7-6f32-4302-a82f-4d8f258e96f6'

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

// Enregistre le token push de n'importe quel utilisateur (manager, gérant, rh…)
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
          "Pour recevoir les alertes de l'application, veuillez autoriser les notifications.",
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

// ─── Helpers internes ─────────────────────────────────────────────────────────

async function _envoyerPush(userIds, titre, body, data = {}) {
  if (!userIds.length) return
  const { data: rows } = await supabase
    .from('admin_push_tokens')
    .select('user_id, token')
    .in('user_id', userIds)
  if (!rows?.length) return

  const messages = rows.map(r => ({
    to: r.token,
    title: titre,
    body,
    sound: 'default',
    data,
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
      const resData = Array.isArray(result.data) ? result.data : [result.data]
      const tokensASupprimer = []
      resData.forEach((item, idx) => {
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
}

// Résout les userIds pour des rôles globaux (manager, rh…) et/ou locaux (gérant)
async function _resolveUserIds(rolesGlobaux, rolesLocaux, restaurantId) {
  const userIds = []
  if (rolesGlobaux.length > 0) {
    const { data } = await supabase
      .from('utilisateurs').select('id').in('role', rolesGlobaux)
    userIds.push(...(data || []).map(u => u.id))
  }
  if (rolesLocaux.length > 0 && restaurantId) {
    const { data } = await supabase
      .from('utilisateurs').select('id')
      .in('role', rolesLocaux).eq('restaurant_id', restaurantId)
    userIds.push(...(data || []).map(u => u.id))
  }
  return userIds
}

// ─── Événement : Point journalier validé → manager + directeur ────────────────
export async function envoyerNotifValidation(dateJour, restaurantId = null, pointId = null, restaurantNom = null) {
  try {
    const [y, m, d] = (dateJour || '').split('-')
    const dateFormatee = (y && m && d) ? `${d}/${m}/${y}` : dateJour || ''
    // Nom du restaurant : passé par l'appelant, sinon lu depuis restaurantId.
    let nom = restaurantNom
    if (!nom && restaurantId) {
      try {
        const { data } = await supabase.from('restaurants').select('nom').eq('id', restaurantId).maybeSingle()
        nom = data?.nom || null
      } catch (_) {}
    }
    const userIds = await _resolveUserIds(['manager', 'directeur'], [], null)
    await _envoyerPush(
      userIds,
      nom ? `Point validé ✅ — ${nom}` : 'Point journalier validé ✅',
      nom
        ? `${nom} — le point du ${dateFormatee} a été validé. Ouvrez l'app pour consulter le récap.`
        : `Le point du ${dateFormatee} a été validé. Ouvrez l'app pour consulter le récap.`,
      { screen: 'verification', restaurant_id: restaurantId, point_id: pointId }
    )
  } catch (_) {}
}

// ─── Événement : Shift caissier validé → manager + directeur + gérant du resto ─
export async function envoyerNotifShiftValide(caissierNom, heureDebut, heureFin, restaurantId) {
  try {
    const userIds = await _resolveUserIds(
      ['manager', 'directeur'],
      ['gerant'],
      restaurantId
    )
    await _envoyerPush(
      userIds,
      '⏱️ Shift validé',
      `${caissierNom || 'Caissier'} — ${heureDebut}→${heureFin}`,
      { screen: 'gerant-caissier', restaurant_id: restaurantId }
    )
  } catch (_) {}
}

// ─── Événement : Nouvelle demande → manager + directeur + rh ─────────────────
export async function envoyerNotifDemandeNouvelle(travailleurNom, type, restaurantId) {
  try {
    const userIds = await _resolveUserIds(['manager', 'directeur', 'rh'], [], null)
    await _envoyerPush(
      userIds,
      '📋 Nouvelle demande',
      `${type} pour ${travailleurNom}`,
      { screen: 'demandes-admin', restaurant_id: restaurantId }
    )
  } catch (_) {}
}

// ─── Événement : Demande acceptée / refusée → l'auteur de la demande ──────────
export async function envoyerNotifDemandeStatut(travailleurNom, type, statut, destinataireId) {
  try {
    if (!destinataireId) return
    const titre = statut === 'validee' ? '✅ Demande acceptée' : '❌ Demande refusée'
    await _envoyerPush(
      [destinataireId],
      titre,
      `${type} pour ${travailleurNom}`,
      { screen: 'demandes' }
    )
  } catch (_) {}
}

// ─── Explication : nouvelle demande d'un gérant → manager + directeur + rh ────
export async function envoyerNotifExplicationNouvelle(travailleurNom, restaurantId) {
  try {
    const userIds = await _resolveUserIds(['manager', 'directeur', 'rh'], [], null)
    await _envoyerPush(
      userIds,
      '📨 Demande d\'explication à valider',
      `${travailleurNom} — à accepter et envoyer`,
      { screen: 'demandes-explication-admin', restaurant_id: restaurantId }
    )
  } catch (_) {}
}

// ─── Explication : acceptée / refusée par l'admin → le gérant demandeur ───────
export async function envoyerNotifExplicationStatut(travailleurNom, statut, destinataireId) {
  try {
    if (!destinataireId) return
    const titre = statut === 'refusee' ? '❌ Explication refusée' : '✅ Explication acceptée'
    const corps = statut === 'refusee'
      ? `Votre demande pour ${travailleurNom} a été refusée`
      : `Votre demande pour ${travailleurNom} a été acceptée et envoyée`
    await _envoyerPush([destinataireId], titre, corps, { screen: 'demandes-explication' })
  } catch (_) {}
}

// ─── Événement : Facture fournisseur corrigée (Vérification) → gérant du resto ─
export async function envoyerNotifFactureCorrigee(nomFourn, ancien, nouveau, restaurantId) {
  try {
    const userIds = await _resolveUserIds([], ['gerant'], restaurantId)
    const f = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' FCFA'
    await _envoyerPush(
      userIds,
      '✏️ Facture corrigée',
      `${nomFourn || 'Fournisseur'} : ${f(ancien)} → ${f(nouveau)}`,
      { restaurant_id: restaurantId }
    )
  } catch (_) {}
}

// ─── Événement : Nouveau travailleur ajouté → rh ─────────────────────────────
export async function envoyerNotifNouveauTravailleur(travailleurNom, restaurantNom, restaurantId) {
  try {
    const userIds = await _resolveUserIds(['rh'], [], null)
    await _envoyerPush(
      userIds,
      '👤 Nouveau travailleur',
      `${travailleurNom} ajouté à ${restaurantNom}`,
      { screen: 'rh', restaurant_id: restaurantId }
    )
  } catch (_) {}
}
