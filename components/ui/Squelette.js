// Squelettes de chargement : un aperçu de la page pendant que les données arrivent.
// Pulsation avec l'Animated de React Native : aucune dépendance native, donc pas de
// nouveau build. Rien ne s'affiche avant DELAI_AFFICHAGE, pour éviter un flash quand
// la connexion est rapide.
import { useEffect, useMemo, useRef } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { useTheme } from '../../context/ThemeContext'
import { enregistrerMesure } from '../../lib/mesuresVitesseDb'

const DELAI_AFFICHAGE = 200
const DUREE_PULSATION = 800
const OPACITE_BASSE = 0.5
const NATIF = Platform.OS !== 'web'

// Anime tout le groupe d'un bloc : un seul minuteur, quel que soit le nombre de formes.
// « ecran » : le temps passé à l'écran est l'attente réelle, enregistrée à la disparition.
export function ZoneSquelette({ ecran, style, children }) {
  const opacite = useRef(new Animated.Value(0)).current
  const { roleActif, restaurantId } = useApp()

  useEffect(() => {
    if (!ecran) return
    const debut = Date.now()
    return () => enregistrerMesure({ ecran, dureeMs: Date.now() - debut, role: roleActif, restaurantId })
  }, [ecran, roleActif, restaurantId])

  useEffect(() => {
    let annule = false
    let animation = null
    const animer = (valeur, duree = DUREE_PULSATION) => Animated.timing(opacite, {
      toValue: valeur, duration: duree, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIF,
    })
    const minuteur = setTimeout(async () => {
      const reduire = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false)
      if (annule) return
      if (reduire) { opacite.setValue(1); return }
      animation = Animated.sequence([
        animer(1, 150),
        // Sans resetBeforeIteration: false, chaque cycle repartirait de 0 (clignotement).
        Animated.loop(Animated.sequence([animer(OPACITE_BASSE), animer(1)]), { resetBeforeIteration: false }),
      ])
      animation.start()
    }, DELAI_AFFICHAGE)
    return () => {
      annule = true
      clearTimeout(minuteur)
      animation?.stop()
    }
  }, [opacite])

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Chargement en cours"
      style={[style, { opacity: opacite }]}
    >
      {children}
    </Animated.View>
  )
}

// Une forme grise : ligne de texte, chiffre, pastille...
export function Bloc({ largeur = '100%', hauteur = 12, rayon = 6, style }) {
  const { colors } = useTheme()
  return (
    <View style={[{ width: largeur, height: hauteur, borderRadius: rayon, backgroundColor: colors.border }, style]} />
  )
}

function useStyles() {
  const { colors } = useTheme()
  return useMemo(() => makeStyles(colors), [colors])
}

// Accueil : bandeau du jour (manager, RH, gérant).
export function SqueletteBandeau() {
  const s = useStyles()
  return (
    <ZoneSquelette ecran="accueil" style={s.bandeau}>
      <View style={s.ligne}>
        <View style={s.souple}>
          <Bloc largeur="55%" />
          <Bloc largeur="70%" hauteur={34} rayon={10} style={s.espaceHaut} />
        </View>
        <Bloc largeur={34} hauteur={34} rayon={17} />
      </View>
      <View style={s.separation}>
        <Bloc largeur="35%" hauteur={10} />
        <Bloc largeur="85%" hauteur={14} style={s.espaceHaut} />
        <Bloc largeur="65%" hauteur={14} style={s.espaceHaut} />
      </View>
    </ZoneSquelette>
  )
}

// Dashboard : quatre chiffres clés et une carte de graphique.
export function SqueletteDashboard({ ecran, style }) {
  const s = useStyles()
  return (
    <ZoneSquelette ecran={ecran} style={style}>
      <View style={s.grille}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={s.kpi}>
            <Bloc largeur="65%" hauteur={10} />
            <Bloc largeur="85%" hauteur={16} style={s.espaceHaut} />
          </View>
        ))}
      </View>
      <View style={s.graphique}>
        <Bloc largeur="60%" hauteur={13} />
        <Bloc hauteur={180} rayon={10} style={s.espaceHautLarge} />
      </View>
    </ZoneSquelette>
  )
}

// Vérification : résumé du mois et cartes des points.
export function SqueletteListePoints() {
  const s = useStyles()
  return (
    <ZoneSquelette ecran="verification_liste" style={s.liste}>
      <View style={s.resume}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[s.resumeCase, i > 0 && s.resumeSep]}>
            <Bloc largeur={28} hauteur={24} rayon={8} />
            <Bloc largeur="60%" hauteur={10} style={s.espaceHaut} />
          </View>
        ))}
      </View>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={s.cartePoint}>
          <View style={s.souple}>
            <Bloc largeur="55%" hauteur={15} />
            <Bloc largeur="35%" hauteur={18} rayon={9} style={s.espaceHaut} />
          </View>
          <Bloc largeur={72} hauteur={16} />
        </View>
      ))}
    </ZoneSquelette>
  )
}

// Vérification : fiche d'un point (résumé, onglets, début du détail).
export function SqueletteFichePoint() {
  const s = useStyles()
  return (
    <ZoneSquelette ecran="verification_fiche" style={s.fiche}>
      <View style={s.ficheResume}>
        <Bloc largeur={110} hauteur={20} rayon={10} />
        <Bloc largeur="45%" hauteur={11} style={s.espaceHautLarge} />
        <Bloc largeur="60%" hauteur={34} rayon={10} style={s.espaceHaut} />
        <View style={s.ficheTrois}>
          {[0, 1, 2].map(i => (
            <View key={i} style={s.ficheCase}>
              <Bloc largeur="75%" hauteur={10} />
              <Bloc largeur="55%" hauteur={14} style={s.espaceHaut} />
            </View>
          ))}
        </View>
      </View>
      <View style={s.onglets}>
        {[0, 1, 2].map(i => <Bloc key={i} largeur={84} hauteur={34} rayon={17} />)}
      </View>
      <View style={s.detail}>
        <Bloc largeur="50%" hauteur={13} />
        <Bloc hauteur={12} style={s.espaceHautLarge} />
        <Bloc largeur="85%" hauteur={12} style={s.espaceHaut} />
        <Bloc largeur="70%" hauteur={12} style={s.espaceHaut} />
      </View>
    </ZoneSquelette>
  )
}

const makeStyles = c => StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  souple: { flex: 1 },
  espaceHaut: { marginTop: 8 },
  espaceHautLarge: { marginTop: 14 },

  bandeau: {
    backgroundColor: c.surface, borderRadius: 20, padding: 16, marginBottom: 18,
    borderWidth: 1, borderColor: c.borderLight,
  },
  separation: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.borderLight },

  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpi: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: c.borderLight,
  },
  graphique: {
    backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: 0.5, borderColor: c.borderLight,
  },

  liste: { flex: 1, paddingHorizontal: 14, paddingTop: 10 },
  resume: {
    flexDirection: 'row', backgroundColor: c.surface, borderRadius: 18, paddingVertical: 12, marginBottom: 14,
    borderWidth: 1, borderColor: c.borderLight,
  },
  resumeCase: { flex: 1, alignItems: 'center' },
  resumeSep: { borderLeftWidth: 1, borderLeftColor: c.borderLight },
  cartePoint: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 16, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: c.borderLight, borderLeftWidth: 5, borderLeftColor: c.border,
  },

  fiche: { flex: 1, padding: 14 },
  ficheResume: {
    backgroundColor: c.surface, borderRadius: 20, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: c.borderLight,
  },
  ficheTrois: { flexDirection: 'row', gap: 8, marginTop: 12 },
  ficheCase: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 10 },
  onglets: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  detail: {
    backgroundColor: c.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: c.borderLight,
  },
})
