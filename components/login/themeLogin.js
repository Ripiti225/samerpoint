// Palettes de l'écran de connexion : style C en clair (bandeau orange),
// style B en sombre (noir chaud, verre fumé). Choix validé le 2026-10-04.
import { ROLES_GLOBAUX } from '../../lib/constants'

export const ORANGE = '#F0A020'
export const VIOLET = '#5B52C8'
export const VERT = '#1FAD6B'

export const DEGRADE_BANDEAU = 'linear-gradient(150deg, #F5A623 0%, #E07B14 100%)'
export const DEGRADE_SOMBRE = 'radial-gradient(120% 60% at 50% 0%, #2A2116 0%, #0E0E12 62%)'

export function themeLogin(isDark) {
  if (isDark) {
    return {
      sombre: true,
      fond: '#0E0E12',
      texte: '#F3F1EC',
      texteDoux: 'rgba(243,241,236,0.68)',
      texteFaible: 'rgba(243,241,236,0.45)',
      carte: 'rgba(255,255,255,0.06)',
      carteBord: 'rgba(255,255,255,0.09)',
      touche: 'rgba(255,255,255,0.07)',
      toucheAppui: 'rgba(255,255,255,0.16)',
      accent: '#F5B13D',
      bandeauUni: null,
      texteBandeau: '#F5B13D',
      sousBandeau: 'rgba(243,241,236,0.72)',
      erreur: '#FF7A7A',
      global: 'rgba(91,82,200,0.18)',
      globalBord: 'rgba(140,130,255,0.3)',
      globalTexte: '#C9C4FF',
    }
  }
  return {
    sombre: false,
    fond: '#FAF8F5',
    texte: '#1B1B22',
    texteDoux: '#5C5C6B',
    texteFaible: '#8E8E9C',
    carte: '#FFFFFF',
    carteBord: '#EFEBE4',
    touche: '#FFFFFF',
    toucheAppui: '#F3EEE6',
    accent: ORANGE,
    bandeauUni: '#EE8E1C',
    texteBandeau: '#FFFFFF',
    sousBandeau: 'rgba(255,255,255,0.9)',
    erreur: '#E04848',
    global: '#F1F0FF',
    globalBord: '#DEDBFF',
    globalTexte: '#4A42B5',
  }
}

export function initiales(nom) {
  return String(nom || '').split(' ').filter(Boolean).map(m => m[0]).join('').slice(0, 2).toUpperCase()
}

export function prenom(nom) {
  return String(nom || '').split(' ').filter(Boolean)[0] || ''
}

export function couleurRole(role) {
  if (role === 'gerant') return ORANGE
  if (role === 'verificateur') return '#0E8A6B'
  if (ROLES_GLOBAUX.includes(role)) return VIOLET
  return '#9A9AA8'
}

export function libelleRole(role) {
  if (role === 'manager') return 'Manager'
  if (role === 'rh') return 'RH'
  if (role === 'directeur') return 'Directeur'
  if (role === 'verificateur') return 'Vérificateur'
  if (role === 'gerant') return 'Gérant'
  return 'Caissier'
}

export function couleurResto(restaurant) {
  return restaurant?.couleur === 'vert' ? VERT : ORANGE
}
