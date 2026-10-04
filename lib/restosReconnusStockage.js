// Lecture / écriture de la liste des restaurants reconnus (web et natif).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normaliserReconnus } from './restosReconnus'

const CLE = 'samerpoint_restos_reconnus'

export async function lireReconnus() {
  try {
    const brut = await AsyncStorage.getItem(CLE)
    return normaliserReconnus(brut ? JSON.parse(brut) : null)
  } catch {
    return []
  }
}

export async function ecrireReconnus(liste) {
  try { await AsyncStorage.setItem(CLE, JSON.stringify(liste)) } catch {}
  return liste
}
