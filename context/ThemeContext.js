import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import { DARK, LIGHT } from '../lib/theme'

const ThemeContext = createContext({ isDark: false, colors: LIGHT, toggleTheme: () => {}, setAuto: () => {} })

const STORAGE_KEY = 'samerpoint_theme'

export function ThemeProvider({ children }) {
  // 'light' | 'dark' | 'auto'
  const [mode, setMode] = useState('auto')
  const systemScheme = useColorScheme() // 'light' | 'dark' | null

  // Charger la préférence sauvegardée
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => { if (v) setMode(v) })
      .catch(() => {})
  }, [])

  const isDark =
    mode === 'dark' ? true :
    mode === 'light' ? false :
    systemScheme === 'dark'

  const colors = isDark ? DARK : LIGHT

  function toggleTheme() {
    const next = isDark ? 'light' : 'dark'
    setMode(next)
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {})
  }

  function setThemeMode(m) {
    setMode(m)
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {})
  }

  return (
    <ThemeContext.Provider value={{ isDark, colors, mode, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
