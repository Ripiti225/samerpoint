import * as Haptics from 'expo-haptics'
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { chargerNotifications, marquerToutLu } from '../lib/notificationsInterne'
import { useApp } from './AppContext'

const NotificationsContext = createContext({
  notifications: [],
  nonLues: 0,
  panelVisible: false,
  ouvrirPanel: () => {},
  fermerPanel: () => {},
})

export function NotificationsProvider({ children }) {
  const { userId, roleActif, restaurantId } = useApp() ?? {}
  const [notifications, setNotifications] = useState([])
  const [panelVisible, setPanelVisible] = useState(false)
  const channelRef = useRef(null)

  const nonLues = userId ? notifications.filter(n => !n.lu_par?.includes(userId)).length : 0

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

  async function ouvrirPanel() {
    setPanelVisible(true)
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

  return (
    <NotificationsContext.Provider value={{ notifications, nonLues, panelVisible, ouvrirPanel, fermerPanel }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  return useContext(NotificationsContext)
}
