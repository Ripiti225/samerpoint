/*
 * Recherche globale — la loupe de l'accueil (manager, RH, gérant).
 * Manager et RH choisissent Global ou un restaurant ; résultats en groupes repliés.
 * On tape un mot, on voit tous les endroits où il apparaît (libellés, notes,
 * motifs, noms…), groupés par source, avec l'écran où l'ouvrir.
 * Style sobre façon iPhone : grand titre qui se replie en défilant, champ gris
 * arrondi, rubriques en listes groupées (icônes monochromes), ouverture animée.
 * Spéc : docs/superpowers/specs/2026-10-12-recherche-globale-design.md
 */

import { MaterialCommunityIcons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import Animated, {
  Extrapolation, FadeIn, FadeInDown, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { rechercheGlobale } from '../lib/api'
import { chargerAccesConfig, tuilesPourRole } from '../lib/menus'
import { retour } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { rechercheCourante } from '../lib/rechercheCourante'
import {
  LIMITE_PAR_SOURCE, LONGUEUR_MIN, cheminEcran, dateCourte, extrait, grouperParSource, iconeSource, lignesAffichees,
  ouverturesInitiales, peutOuvrir, resumeResultats, routePour, texteLisible,
} from '../lib/rechercheGlobale'

const DELAI_FRAPPE = 350
const HAUTEUR_GRAND_TITRE = 46

function montantTexte(m) {
  const n = Number(m)
  return m === null || m === undefined || !Number.isFinite(n) ? null : `${Math.round(n).toLocaleString('fr-FR')} F`
}

// Bannière d'une rubrique : icône, nom, nombre, chevron qui pivote à l'ouverture.
function EnteteRubrique({ groupe, ouvert, dernier, onPress, styles, colors }) {
  const rotation = useSharedValue(ouvert ? 90 : 0)
  useEffect(() => { rotation.value = withTiming(ouvert ? 90 : 0, { duration: 180 }) }, [ouvert, rotation])
  const styleChevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.rubrique, dernier && styles.rubriqueSeule, pressed && styles.appuye]}
      accessibilityRole="button" accessibilityState={{ expanded: ouvert }}
      accessibilityLabel={`${groupe.source}, ${groupe.resultats.length} résultat(s)`}
    >
      <View style={styles.rubriqueIcone}>
        <MaterialCommunityIcons name={iconeSource(groupe.source)} size={18} color={colors.textSecondary} />
      </View>
      <Text style={styles.rubriqueTxt} numberOfLines={1}>{groupe.source}</Text>
      <Text style={styles.rubriqueNb}>{groupe.resultats.length}</Text>
      <Animated.View style={styleChevron}>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
      </Animated.View>
    </Pressable>
  )
}

export default function Recherche() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif, restaurantId, dateJour } = useApp()
  const manager = roleActif === 'manager'
  const rh = roleActif === 'rh'
  // Manager et RH : tous les restaurants (Global) ou un seul. Gérant : le sien.
  const choixResto = manager || rh

  const [terme, setTerme] = useState('')
  const [etat, setEtat] = useState({ statut: 'vide', resultats: [] })
  const [idsTuiles, setIdsTuiles] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [restoFiltre, setRestoFiltre] = useState(null) // null = Global
  const [ouverts, setOuverts] = useState({})           // { source: true } : groupes dépliés
  const [focusChamp, setFocusChamp] = useState(false)
  const numeroRequete = useRef(0)
  const champ = useRef(null)

  // Grand titre qui se replie en défilant ; petit titre centré qui apparaît.
  const defilement = useSharedValue(0)
  const surDefilement = useAnimatedScrollHandler(e => { defilement.value = e.contentOffset.y })
  const styleGrandTitre = useAnimatedStyle(() => ({
    height: interpolate(defilement.value, [0, HAUTEUR_GRAND_TITRE], [HAUTEUR_GRAND_TITRE, 0], Extrapolation.CLAMP),
    opacity: interpolate(defilement.value, [0, HAUTEUR_GRAND_TITRE * 0.6], [1, 0], Extrapolation.CLAMP),
  }))
  const stylePetitTitre = useAnimatedStyle(() => ({
    opacity: interpolate(defilement.value, [HAUTEUR_GRAND_TITRE * 0.5, HAUTEUR_GRAND_TITRE], [0, 1], Extrapolation.CLAMP),
  }))

  // Revenir sur la recherche efface le bandeau de rappel.
  useEffect(() => { rechercheCourante.definir(null) }, [])

  // Écrans que le gérant ou la RH peut ouvrir (ses tuiles, réglées dans Paramètres).
  useEffect(() => {
    if (manager) return
    let actif = true
    chargerAccesConfig().then(config => {
      if (actif) setIdsTuiles(tuilesPourRole(roleActif, config).map(t => (t.route || '').replace(/^\//, '') || t.id))
    })
    return () => { actif = false }
  }, [manager, roleActif])

  useEffect(() => {
    if (!choixResto) return
    supabase.from('restaurants').select('id, nom').order('nom').then(({ data }) => setRestaurants(data || []))
  }, [choixResto])

  useEffect(() => {
    const t = terme.trim()
    const numero = ++numeroRequete.current
    if (t.length < LONGUEUR_MIN) {
      setEtat({ statut: 'vide', resultats: [] })
      return
    }
    setEtat(e => ({ ...e, statut: 'chargement' }))
    const minuteur = setTimeout(async () => {
      try {
        const r = await rechercheGlobale(t, {
          restaurantId: choixResto ? restoFiltre : restaurantId, manager, rh, date: dateJour,
        })
        if (numero !== numeroRequete.current) return // une frappe plus récente a pris le relais
        setEtat({ statut: r.horsLigne ? 'horsLigne' : 'ok', resultats: r.resultats })
      } catch {
        if (numero === numeroRequete.current) setEtat({ statut: 'erreur', resultats: [] })
      }
    }, DELAI_FRAPPE)
    return () => clearTimeout(minuteur)
  }, [terme, restaurantId, restoFiltre, choixResto, manager, rh, dateJour])

  const groupes = useMemo(() => grouperParSource(etat.resultats), [etat.resultats])
  // Nouvelle recherche : tout replié (un groupe unique s'ouvre tout seul).
  useEffect(() => {
    setOuverts(ouverturesInitiales(groupes))
    defilement.value = 0 // nouvelle liste : le grand titre revient
  }, [groupes, defilement])
  const lignes = useMemo(() => lignesAffichees(groupes, ouverts), [groupes, ouverts])

  function basculer(source) {
    setOuverts(o => ({ ...o, [source]: !o[source] }))
  }

  function ouvrir(r) {
    rechercheCourante.definir({ ...r, terme: terme.trim() })
    router.push(routePour(r))
  }

  function renderLigne({ item }) {
    if (item.groupe) {
      return (
        <EnteteRubrique groupe={item.groupe} ouvert={item.ouvert} dernier={item.dernier}
          onPress={() => basculer(item.groupe.source)} styles={styles} colors={colors} />
      )
    }
    if (item.limite) {
      return (
        <Animated.View entering={FadeIn.duration(160)} style={[styles.cellule, styles.dernier]}>
          <Text style={styles.limite}>Les {LIMITE_PAR_SOURCE} plus récents — précise ta recherche pour voir les autres</Text>
        </Animated.View>
      )
    }
    const r = item.resultat
    const ouvrable = peutOuvrir(r, idsTuiles, manager)
    const e = extrait(texteLisible(r.texte), terme)
    const montant = montantTexte(r.montant)
    const sous = [cheminEcran(r), choixResto && !restoFiltre ? r.restaurant_nom : null, dateCourte(r.date)]
      .filter(Boolean).join(' · ')
    return (
      <Animated.View entering={FadeInDown.duration(180)}>
        <Pressable
          style={({ pressed }) => [styles.cellule, item.dernier && styles.dernier, pressed && ouvrable && styles.appuye]}
          disabled={!ouvrable}
          onPress={() => ouvrir(r)}
          accessibilityRole="button"
          accessibilityLabel={`${cheminEcran(r)}, ${r.champ} : ${texteLisible(r.texte)}`}
        >
          <View style={[styles.celluleCorps, !ouvrable && styles.estompe]}>
            <Text style={styles.extrait} numberOfLines={2}>
              <Text style={styles.champNom}>{r.champ} · </Text>
              {e.avant}
              {e.trouve ? <Text style={styles.surligne}>{e.trouve}</Text> : null}
              {e.apres}
            </Text>
            <Text style={styles.sous} numberOfLines={1}>{ouvrable ? sous : `${sous} · écran non disponible`}</Text>
          </View>
          {montant ? <Text style={styles.montant}>{montant}</Text> : null}
          {ouvrable ? <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} /> : null}
        </Pressable>
      </Animated.View>
    )
  }

  function messageVide() {
    const t = terme.trim()
    if (etat.statut === 'chargement') return <ActivityIndicator size="large" color={colors.textMuted} />
    let icone = 'magnify'
    let titre = `Tape au moins ${LONGUEUR_MIN} lettres`
    let sous = manager
      ? 'Dépenses, fournisseurs, trésorerie, points, équipe, litiges, journal… tous les restaurants ou un seul.'
      : rh
        ? 'Équipe, contrats, demandes, documents, contacts, fournisseurs… tous les restaurants ou un seul.'
        : dateJour
          ? `Ta journée du ${dateCourte(dateJour)} (dépenses, présences, litiges…), tes fournisseurs, ton équipe et tes demandes en cours.`
          : 'Aucune journée ouverte : seulement tes fournisseurs, ton équipe et tes demandes en cours.'
    if (etat.statut === 'horsLigne') {
      icone = 'wifi-off'; titre = 'Pas de connexion'; sous = "La recherche a besoin d'internet."
    } else if (etat.statut === 'erreur') {
      icone = 'alert-circle-outline'; titre = "La recherche n'a pas abouti"; sous = 'Réessaie dans un instant.'
    } else if (t.length >= LONGUEUR_MIN) {
      icone = 'text-search'; titre = `Aucun résultat pour « ${t} »`; sous = 'Vérifie l’orthographe ou essaie un autre mot.'
    }
    return (
      <Animated.View entering={FadeIn.duration(200)} style={styles.videBloc}>
        <MaterialCommunityIcons name={icone} size={56} color={colors.border} />
        <Text style={styles.videTitre}>{titre}</Text>
        <Text style={styles.videSous}>{sous}</Text>
      </Animated.View>
    )
  }

  const avecResultats = lignes.length > 0 && etat.statut !== 'horsLigne' && etat.statut !== 'erreur'
    && terme.trim().length >= LONGUEUR_MIN

  return (
    <SafeAreaView style={styles.container}>
      {/* Barre du haut : retour + petit titre (apparaît quand le grand se replie) */}
      <View style={styles.barre}>
        <TouchableOpacity onPress={() => retour()} style={styles.retour} hitSlop={10} accessibilityRole="button">
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.primary} />
          <Text style={styles.retourTxt}>Retour</Text>
        </TouchableOpacity>
        <Animated.Text style={[styles.petitTitre, stylePetitTitre]}>Recherche</Animated.Text>
        <View style={styles.retour} />
      </View>

      <Animated.View style={[styles.grandTitreBloc, styleGrandTitre]}>
        <Text style={styles.grandTitre}>Recherche</Text>
      </Animated.View>

      {/* Champ gris arrondi */}
      <View style={styles.zoneChamp}>
        <View style={[styles.champ, focusChamp && styles.champActif]}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.textMuted} />
          <TextInput
            ref={champ}
            style={styles.input}
            value={terme}
            onChangeText={setTerme}
            onFocus={() => setFocusChamp(true)}
            onBlur={() => setFocusChamp(false)}
            placeholder="paie, Konan, loyer, numéro…"
            placeholderTextColor={colors.textMuted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {etat.statut === 'chargement' && avecResultats ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
          {terme ? (
            <TouchableOpacity onPress={() => { setTerme(''); champ.current?.focus() }} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="Effacer la recherche">
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {choixResto ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segments}
            keyboardShouldPersistTaps="handled">
            {[{ id: null, nom: 'Global' }, ...restaurants].map(r => {
              const actif = restoFiltre === r.id
              return (
                <Pressable key={r.id || 'global'} onPress={() => setRestoFiltre(r.id)}
                  style={({ pressed }) => [styles.segment, actif && styles.segmentActif, pressed && styles.appuye]}
                  accessibilityRole="button" accessibilityState={{ selected: actif }}>
                  {!r.id ? <MaterialCommunityIcons name="earth" size={14} color={actif ? '#FFFFFF' : colors.textSecondary} /> : null}
                  <Text style={[styles.segmentTxt, actif && styles.segmentTxtActif]}>{r.nom}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}
      </View>

      {avecResultats ? (
        <Animated.FlatList
          data={lignes}
          keyExtractor={l => l.cle}
          renderItem={renderLigne}
          onScroll={surDefilement}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.liste}
          ListHeaderComponent={<Text style={styles.resume}>{resumeResultats(groupes).toUpperCase()}</Text>}
        />
      ) : (
        <View style={styles.vide}>{messageVide()}</View>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  const filet = StyleSheet.hairlineWidth
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    barre: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 44 },
    retour: { flexDirection: 'row', alignItems: 'center', minWidth: 90, minHeight: 44 },
    retourTxt: { fontSize: 17, color: colors.primary, marginLeft: -4 },
    petitTitre: { fontSize: 17, fontWeight: '600', color: colors.text },
    grandTitreBloc: { paddingHorizontal: 16, justifyContent: 'flex-end', overflow: 'hidden' },
    grandTitre: { fontSize: 34, fontWeight: '800', color: colors.text, letterSpacing: 0.3 },

    zoneChamp: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
    champ: {
      flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceAlt, borderRadius: 12,
      paddingHorizontal: 10, minHeight: 44, borderWidth: 1, borderColor: 'transparent',
    },
    champActif: { borderColor: colors.primary },
    input: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: 10 },

    segments: { gap: 8, paddingTop: 10 },
    segment: {
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, minHeight: 34, borderRadius: 17,
      backgroundColor: colors.surfaceAlt,
    },
    segmentActif: { backgroundColor: colors.primary },
    segmentTxt: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
    segmentTxtActif: { color: '#FFFFFF' },

    liste: { paddingHorizontal: 16, paddingBottom: 48 },
    resume: { fontSize: 12, color: colors.textMuted, letterSpacing: 0.4, marginTop: 8, marginBottom: 6, marginLeft: 4 },

    // Rubrique = haut d'une carte groupée iOS ; ses résultats suivent dans la même carte.
    rubrique: {
      flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, marginTop: 12,
      backgroundColor: colors.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12,
    },
    rubriqueSeule: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
    rubriqueIcone: {
      width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt,
    },
    rubriqueTxt: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
    rubriqueNb: { fontSize: 15, color: colors.textMuted, fontVariant: ['tabular-nums'] },

    cellule: {
      flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingVertical: 10, paddingLeft: 52, paddingRight: 12,
      backgroundColor: colors.surface, borderTopWidth: filet, borderTopColor: colors.border,
    },
    dernier: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
    celluleCorps: { flex: 1, minWidth: 0 },
    estompe: { opacity: 0.5 },
    extrait: { fontSize: 15, color: colors.text, lineHeight: 20 },
    champNom: { color: colors.textMuted, fontSize: 14 },
    surligne: { backgroundColor: colors.warningLight, color: colors.text, fontWeight: '700' },
    sous: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
    montant: { fontSize: 15, fontWeight: '600', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    limite: { flex: 1, fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
    appuye: { opacity: 0.6 },

    vide: { flex: 1, paddingHorizontal: 32 },
    videBloc: { alignItems: 'center', marginTop: 70 },
    videTitre: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 14, textAlign: 'center' },
    videSous: { fontSize: 15, color: colors.textMuted, marginTop: 8, textAlign: 'center', lineHeight: 21 },
  })
}
