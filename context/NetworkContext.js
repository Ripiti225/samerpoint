import NetInfo from '@react-native-community/netinfo'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { setOnlineStatus } from '../lib/networkStatus'
import { getQueueSize, processQueue } from '../lib/offlineQueue'

const NetworkContext = createContext({
  isOnline: true,
  isSyncing: false,
  queueSize: 0,
  syncNow: async () => {},
  refreshQueueSize: async () => {},
  lastSyncAt: null,
})

export function NetworkProvider({ children }) {
  const [isOnline, setIsOnline] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [queueSize, setQueueSize] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const syncTimeoutRef = useRef(null)
  const isSyncingRef = useRef(false)

  const refreshQueueSize = useCallback(async () => {
    try {
      const size = await getQueueSize()
      setQueueSize(size)
    } catch {}
  }, [])

  const syncNow = useCallback(async () => {
    if (isSyncingRef.current) return
    const size = await getQueueSize()
    if (size === 0) return

    isSyncingRef.current = true
    setIsSyncing(true)

    try {
      const result = await processQueue(api)
      if (result.failed > 0) {
        console.warn(`Sync partielle : ${result.success} ok, ${result.failed} échecs`)
      }
    } catch (e) {
      console.error('Sync error:', e)
    } finally {
      isSyncingRef.current = false
      setIsSyncing(false)
      setLastSyncAt(new Date())
      await refreshQueueSize()
    }
  }, [refreshQueueSize])

  useEffect(() => {
    refreshQueueSize()

    const unsubscribe = NetInfo.addEventListener(state => {
      const online = !!(state.isConnected && state.isInternetReachable !== false)
      setIsOnline(online)
      setOnlineStatus(online)

      if (online) {
        // Délai pour laisser la connexion se stabiliser avant de synchroniser
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
        syncTimeoutRef.current = setTimeout(async () => {
          await refreshQueueSize()
          syncNow()
        }, 1500)
      }
    })

    return () => {
      unsubscribe()
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    }
  }, [syncNow, refreshQueueSize])

  return (
    <NetworkContext.Provider value={{
      isOnline, isSyncing, queueSize,
      syncNow, refreshQueueSize, lastSyncAt,
    }}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  return useContext(NetworkContext)
}
