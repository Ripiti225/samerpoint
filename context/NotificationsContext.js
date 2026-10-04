import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { plateformesEnRetard } from '../lib/avisPlateformes'
import { dernierAvisRecu } from '../lib/avisPlateformesDb'
import { explicationsSansReponse, seuilRetard } from '../lib/demandes'
import { supabase } from '../lib/supabase'
import {
  chargerNotifications, marquerToutLu,
  supprimerNotification, supprimerToutesNotifications,
} from '../lib/notificationsInterne'
import { useApp } from './AppContext'

const NotificationsContext = createContext({
  notifications: [],
  explicationsEnRetard: [],
  avisEnRetard: [],
  nonLues: 0,
  panelVisible: false,
  ouvrirPanel: () => {},
  fermerPanel: () => {},
  marquerUneCommeLue: () => {},
  supprimerUne: () => {},
  supprimerTout: () => {},
  naviguerDepuisNotif: () => {},
})

const ROUTE_MAP = {
  point_valide: 'verification',
  shift_valide: 'gerant-caissier',
  correction_demandee: 'recap-point',
  explication_machine_validee: 'recap-point',
  explication_machine_refusee: 'recap-point',
  explication_machine_annulee: 'recap-point',
  nouveau_document: 'documents',
  nouveau_travailleur: 'equipe',
}

// Rôles qui suivent les demandes d'explication restées sans réponse.
const ROLES_SUIVI_EXPLICATIONS = ['manager', 'rh']

// Rôles rappelés quand une plateforme n'a pas reçu d'avis depuis 2 jours.
const ROLES_RAPPEL_AVIS = ['manager', 'directeur']

export function NotificationsProvider({ children }) {
  const { userId, roleActif, restaurantId } = useApp() ?? {}
  const [notifications, setNotifications] = useState([])
  // Demandes d'explication dont le jour de réponse (J+3) est passé. Calculées
  // à l'affichage et non stockées : elles disparaissent d'elles-mêmes dès que
  // la réponse est récupérée ou la demande relancée.
  const [explicationsEnRetard, setExplicationsEnRetard] = useState([])
  // Plateformes sans nouvel avis depuis 2 jours (personne n'a cliqué sur le
  // bouton avis). Calculées à l'affichage, disparaissent après un envoi.
  const [avisEnRetard, setAvisEnRetard] = useState([])
  const [panelVisible, setPanelVisible] = useState(false)
  const channelRef = useRef(null)

  const nonLues = userId
    ? notifications.filter(n => !n.lu_par?.includes(userId)).length + explicationsEnRetard.length + avisEnRetard.length
    : 0

  useEffect(() => {
    if (!userId || !roleActif) return
    charger()
    abonner()
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [userId, roleActif, restaurantId])

  async function charger() {
    const data = await chargerNotifications(userId, roleActif, restaurantId)
    setNotifications(data)
    chargerExplicationsEnRetard()
    chargerAvisEnRetard()
  }

  async function chargerExplicationsEnRetard() {
    if (!ROLES_SUIVI_EXPLICATIONS.includes(roleActif)) { setExplicationsEnRetard([]); return }
    try {
      const [{ data: demandes }, { data: restos }] = await Promise.all([
        supabase.from('demandes_explication')
          .select('id, travailleur_nom, travailleur_poste, motif, restaurant_id, envoyee_at, numero, statut, cree_par_id, cree_par_role')
          .eq('statut', 'envoyee')
          .lt('envoyee_at', seuilRetard())
          .order('envoyee_at'),
        supabase.from('restaurants').select('id, nom'),
      ])
      const nomResto = Object.fromEntries((restos || []).map(r => [r.id, r.nom]))
      setExplicationsEnRetard(explicationsSansReponse(demandes)
        .map(d => ({ ...d, restaurant_nom: nomResto[d.restaurant_id] || null })))
    } catch (_) {
      // Le panneau reste utilisable sans ce bloc.
    }
  }

  function abonner() {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase
      .channel(`notifs-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new
        const ciblé =
          n.cible_user_id === userId ||
          (n.cible_role?.includes(roleActif) && (!n.restaurant_id || !restaurantId || n.restaurant_id === restaurantId)) ||
          (!n.cible_user_id && (!n.cible_role || n.cible_role.length === 0))
        if (ciblé) {
          setNotifications(prev => [n, ...prev])
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        }
      })
      .subscribe()
  }

  async function chargerAvisEnRetard() {
    if (!ROLES_RAPPEL_AVIS.includes(roleActif)) { setAvisEnRetard([]); return }
    try {
      setAvisEnRetard(plateformesEnRetard(await dernierAvisRecu()))
    } catch {
      setAvisEnRetard([])
    }
  }

  async function ouvrirPanel() {
    setPanelVisible(true)
    chargerExplicationsEnRetard()
    chargerAvisEnRetard()
    const ids = notifications.filter(n => !n.lu_par?.includes(userId)).map(n => n.id)
    if (ids.length > 0) {
      await marquerToutLu(ids, userId)
      setNotifications(prev =>
        prev.map(n => ({
          ...n,
          lu_par: n.lu_par?.includes(userId) ? n.lu_par : [...(n.lu_par || []), userId],
        }))
      )
    }
  }

  function fermerPanel() {
    setPanelVisible(false)
  }

  async function marquerUneCommeLue(notifId) {
    if (!userId) return
    await marquerToutLu([notifId], userId)
    setNotifications(prev =>
      prev.map(n =>
        n.id === notifId
          ? { ...n, lu_par: n.lu_par?.includes(userId) ? n.lu_par : [...(n.lu_par || []), userId] }
          : n
      )
    )
  }

  async function supprimerUne(notifId) {
    setNotifications(prev => prev.filter(n => n.id !== notifId))
    await supprimerNotification(notifId)
  }

  async function supprimerTout() {
    const ids = notifications.map(n => n.id)
    setNotifications([])
    await supprimerToutesNotifications(ids)
  }

  function naviguerDepuisNotif(notif) {
    // Calculer l'écran selon le type + rôle courant (ignore notif.screen stocké en DB
    // qui peut être obsolète si le rôle ou la règle a changé)
    let screen
    if (notif.type === 'shift_valide') {
      screen = roleActif === 'gerant' ? 'gerant-caissier' : null
    } else if (notif.type === 'point_valide') {
      screen = (roleActif === 'manager' || roleActif === 'directeur') ? 'verification' : null
    } else {
      screen = notif.screen || ROUTE_MAP[notif.type]
    }
    if (!screen) return
    fermerPanel()
    marquerUneCommeLue(notif.id).catch(() => {})
    const params = notif.params
      ? { ...notif.params }
      : notif.restaurant_id
        ? { restaurant_id: notif.restaurant_id }
        : {}
    router.push({ pathname: `/${screen}`, params })
  }

  // Ouvre le suivi sur l'onglet où la demande apparaît, filtré « Attente réponse ».
  function ouvrirExplicationEnRetard(d) {
    fermerPanel()
    const onglet = ['gerant', 'verificateur'].includes(d.cree_par_role) ? 'recues' : 'miennes'
    router.push({ pathname: '/demandes-explication-admin', params: { onglet, etape: 'attente' } })
  }

  function ouvrirAvisEnRetard() {
    fermerPanel()
    router.push('/avis-plateformes')
  }

  return (
    <NotificationsContext.Provider value={{
      notifications, explicationsEnRetard, avisEnRetard, nonLues, panelVisible,
      ouvrirPanel, fermerPanel,
      marquerUneCommeLue, supprimerUne, supprimerTout,
      naviguerDepuisNotif, ouvrirExplicationEnRetard, ouvrirAvisEnRetard,
    }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  return useContext(NotificationsContext)
}
