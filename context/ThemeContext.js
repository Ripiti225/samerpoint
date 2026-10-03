import AsyncStorage from '@react-native-async-storage/async-storage'
import { usePathname } from 'expo-router'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Platform, useColorScheme } from 'react-native'
import { couleursGroupe, groupeDeRoute } from '../lib/groupesAccueil'
import { DARK, LIGHT } from '../lib/theme'

// Web : les éléments cliquables des écrans d'un groupe grossissent un peu au
// survol de la souris (body[data-groupe] posé selon l'écran ouvert).
const CSS_SURVOL = `
@media (hover: hover) and (pointer: fine) {
  body[data-groupe] div[tabindex="0"] { transition: transform 160ms ease-out, box-shadow 160ms ease-out; }
  body[data-groupe] div[tabindex="0"]:hover { transform: scale(1.02); }
  body[data-groupe] div[tabindex="0"][aria-disabled="true"]:hover { transform: none; }
}`

function installerSurvolWeb() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('samer-survol')) return
  const style = document.createElement('style')
  style.id = 'samer-survol'
  style.textContent = CSS_SURVOL
  document.head.appendChild(style)
}

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

  // Chaque écran d'un groupe activé prend la couleur de sa bannière d'accueil
  // (lib/groupesAccueil.js) : en-tête, boutons, onglets.
  const chemin = usePathname()
  const groupe = groupeDeRoute(chemin)
  const colors = useMemo(() => {
    const base = isDark ? DARK : LIGHT
    return groupe ? { ...base, ...couleursGroupe(groupe, isDark) } : base
  }, [isDark, groupe])

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    installerSurvolWeb()
    if (groupe) document.body.dataset.groupe = groupe.id
    else delete document.body.dataset.groupe
  }, [groupe])

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
    <ThemeContext.Provider value={{ isDark, colors, groupe, mode, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
