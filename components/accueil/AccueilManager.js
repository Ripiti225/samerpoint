// ──────────────────────────────────────────────────────────────────────────────
// Accueil manager / directeur.
//
//  1. « Points d'hier » : un coup d'œil sur les 8 restaurants (vérifié, à
//     vérifier, en attente), ce qui reste à vérifier et les demandes en attente.
//  2. Accès direct : Trésorerie (grande carte), Vérification, Dashboard global.
//  3. Sept bannières colorées qui se déroulent sur place ; celles ouvertes sont
//     gardées d'une visite à l'autre.
// Icônes vectorielles (MaterialCommunityIcons), couleurs par groupe :
// lib/groupesAccueil.js.
// ──────────────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'

import { useTheme } from '../../context/ThemeContext'
import {
  ICONES_TUILES, etatPointsDuJour, groupeDeTuile, nbAVerifier, organiserAccueilAdmin,
} from '../../lib/groupesAccueil'
import { supabase } from '../../lib/supabase'

const CLE_OUVERTS = 'samtrackly_accueil_groupes_ouverts'
const VERT_HERO = '#047857' // fond de la carte Trésorerie : blanc lisible dessus (≥ 4,5:1)

const STATUTS = {
  verifie: { icone: 'check-circle', label: 'vérifié' },
  a_verifier: { icone: 'magnify-scan', label: 'à vérifier' },
  en_attente: { icone: 'clock-outline', label: 'pas encore validé' },
}

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Points des 7 derniers jours, restaurants et demandes en attente.
// null tant que rien n'est chargé (ou hors ligne) : le bandeau ne s'affiche pas.
function useEtatDuJour() {
  const [etat, setEtat] = useState(null)
  const charger = useCallback(async () => {
    try {
      const auj = new Date()
      const hier = new Date(auj); hier.setDate(auj.getDate() - 1)
      const depuis = new Date(auj); depuis.setDate(auj.getDate() - 7)
      const [p, r, d] = await Promise.all([
        supabase.from('points').select('restaurant_id, date, valide, verifie')
          .gte('date', isoLocal(depuis)).lte('date', isoLocal(auj)).order('date').range(0, 999),
        supabase.from('restaurants').select('id, nom').order('nom'),
        supabase.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente'),
      ])
      if (p.error || r.error) return
      setEtat({
        hier,
        jour: etatPointsDuJour({ points: p.data, restaurants: r.data, date: isoLocal(hier) }),
        aVerifier: nbAVerifier(p.data),
        demandes: d.error ? 0 : d.count || 0,
      })
    } catch (_) { /* hors ligne : pas de bandeau */ }
  }, [])
  useFocusEffect(useCallback(() => { charger() }, [charger]))
  return etat
}

export default function AccueilManager({ items }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { favoris, groupes, autres } = useMemo(() => organiserAccueilAdmin(items), [items])
  const etat = useEtatDuJour()
  const [ouverts, setOuverts] = useState({})

  // Bannières ouvertes : gardées d'une visite à l'autre sur ce téléphone.
  useEffect(() => {
    AsyncStorage.getItem(CLE_OUVERTS).then(v => { if (v) setOuverts(JSON.parse(v)) }).catch(() => {})
  }, [])
  function basculer(id) {
    setOuverts(o => {
      const n = { ...o, [id]: !o[id] }
      AsyncStorage.setItem(CLE_OUVERTS, JSON.stringify(n)).catch(() => {})
      return n
    })
  }

  // Petits compteurs sur les tuiles et les bannières.
  const badges = {
    'verification': etat?.aVerifier ? `${etat.aVerifier} à vérifier` : null,
    'demandes-admin': etat?.demandes ? `${etat.demandes} en attente` : null,
  }
  const badgeGroupe = g => {
    const b = g.tuiles.map(t => badges[t.id]).filter(Boolean)
    return b.length ? b[0] : null
  }

  const [hero, ...secondaires] = favoris
  const tousGroupes = autres.length
    ? [...groupes, { id: 'autres', icone: 'dots-grid', couleur: '#64748B', fonce: '#475569', titre: 'Autres', tuiles: autres }]
    : groupes

  return (
    <View>
      {etat && <BandeauPoints etat={etat} styles={styles} colors={colors} />}

      {favoris.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitre} accessibilityRole="header">Accès direct</Text>
          {hero && (
            <Animated.View entering={FadeInDown.delay(60).springify().damping(18)}>
              <Pressable
                onPress={() => !hero.bloque && router.push(hero.route)}
                accessibilityRole="button" accessibilityLabel={`${hero.titre}, ${hero.sous}`}
                style={({ pressed }) => [styles.hero, pressed && styles.presse]}
              >
                <View style={styles.heroIcone}>
                  <MaterialCommunityIcons name={ICONES_TUILES[hero.id] || 'apps'} size={30} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTitre}>{hero.titre}</Text>
                  <Text style={styles.heroSous} numberOfLines={2}>{hero.sous}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={26} color="#FFFFFF" />
              </Pressable>
            </Animated.View>
          )}
          <View style={styles.rangee}>
            {secondaires.map((t, i) => {
              const { couleur: c, fonce } = groupeDeTuile(t.id)
              return (
                <Animated.View key={t.id} style={{ flex: 1 }} entering={FadeInDown.delay(120 + i * 60).springify().damping(18)}>
                  <Pressable
                    onPress={() => !t.bloque && router.push(t.route)}
                    accessibilityRole="button" accessibilityLabel={`${t.titre}${badges[t.id] ? `, ${badges[t.id]}` : ''}`}
                    style={({ pressed }) => [styles.favori, { backgroundColor: c + '14', borderColor: c + '40' }, pressed && styles.presse]}
                  >
                    <View style={[styles.favoriIcone, { backgroundColor: c }]}>
                      <MaterialCommunityIcons name={ICONES_TUILES[t.id] || 'apps'} size={22} color="#FFFFFF" />
                    </View>
                    <Text style={styles.favoriTitre} numberOfLines={1}>{t.titre}</Text>
                    {badges[t.id]
                      ? <View style={[styles.pastille, { backgroundColor: fonce, alignSelf: 'flex-start', marginTop: 6 }]}><Text style={styles.pastilleTxt}>{badges[t.id]}</Text></View>
                      : <Text style={styles.favoriSous} numberOfLines={2}>{t.sous}</Text>}
                  </Pressable>
                </Animated.View>
              )
            })}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitre} accessibilityRole="header">Tout</Text>
        {tousGroupes.map((g, i) => (
          <Banniere key={g.id} g={g} index={i} ouvert={!!ouverts[g.id]} onBasculer={() => basculer(g.id)}
            badge={badgeGroupe(g)} badges={badges} styles={styles} colors={colors} />
        ))}
      </View>
    </View>
  )
}

// ── « Points d'hier » ────────────────────────────────────────────────────────

function BandeauPoints({ etat, styles, colors }) {
  const { jour, hier, aVerifier, demandes } = etat
  // warningDark : foncé en clair, vif en sombre — lisible dans les deux thèmes.
  const couleurs = { verifie: colors.success, a_verifier: colors.warningDark, en_attente: colors.textMuted }
  const complet = jour.valides === jour.total
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Pressable
        onPress={() => router.push('/verification')}
        accessibilityRole="button"
        accessibilityLabel={`Points d'hier : ${jour.valides} sur ${jour.total} validés, ${aVerifier} à vérifier. Ouvrir la vérification.`}
        style={({ pressed }) => [styles.bandeau, pressed && styles.presse]}
      >
        <View style={styles.bandeauHaut}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bandeauLabel}>Points d'hier · {hier.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={[styles.bandeauGrand, { color: complet ? colors.success : colors.text }]}>{jour.valides}/{jour.total}</Text>
              <Text style={styles.bandeauUnite}>validés</Text>
            </View>
          </View>
          <MaterialCommunityIcons name={complet ? 'check-decagram' : 'progress-clock'} size={34}
            color={complet ? colors.success : colors.warningDark} />
        </View>

        {/* Une barre par restaurant, dans l'ordre des noms ci-dessous */}
        <View style={styles.barre}>
          {jour.lignes.map(l => <View key={l.id} style={[styles.segment, { backgroundColor: couleurs[l.statut] }]} />)}
        </View>
        <View style={styles.restos}>
          {jour.lignes.map(l => (
            <View key={l.id} style={styles.resto}>
              <MaterialCommunityIcons name={STATUTS[l.statut].icone} size={13} color={couleurs[l.statut]} />
              <Text style={styles.restoNom}>{l.nom}</Text>
            </View>
          ))}
        </View>

        <View style={styles.bandeauBas}>
          <Indicateur icone="magnify-scan" couleur={aVerifier ? colors.warningDark : colors.success} texte={aVerifier ? `${aVerifier} point${aVerifier > 1 ? 's' : ''} à vérifier (7 jours)` : 'Tout est vérifié'} styles={styles} />
          {demandes > 0 && (
            <Pressable onPress={() => router.push('/demandes-admin')} accessibilityRole="button" hitSlop={8}>
              <Indicateur icone="inbox-arrow-down" couleur={colors.primary} texte={`${demandes} demande${demandes > 1 ? 's' : ''} en attente`} styles={styles} />
            </Pressable>
          )}
        </View>
      </Pressable>
    </Animated.View>
  )
}

function Indicateur({ icone, couleur, texte, styles }) {
  return (
    <View style={styles.indicateur}>
      <MaterialCommunityIcons name={icone} size={15} color={couleur} />
      <Text style={[styles.indicateurTxt, { color: couleur }]}>{texte}</Text>
    </View>
  )
}

// ── Bannière dépliable ───────────────────────────────────────────────────────

function Banniere({ g, index, ouvert, onBasculer, badge, badges, styles, colors }) {
  const rotation = useSharedValue(ouvert ? 180 : 0)
  useEffect(() => { rotation.value = withTiming(ouvert ? 180 : 0, { duration: 220 }) }, [ouvert, rotation])
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))

  return (
    <Animated.View
      entering={FadeInDown.delay(80 + index * 45).springify().damping(20)}
      layout={LinearTransition.duration(220)}
      style={[styles.banniere, ouvert && { borderColor: g.couleur + '66' }]}
    >
      <Pressable
        onPress={onBasculer}
        accessibilityRole="button"
        accessibilityState={{ expanded: ouvert }}
        accessibilityLabel={`${g.titre}, ${g.tuiles.length} écrans${badge ? `, ${badge}` : ''}`}
        style={({ pressed }) => [styles.banniereEntete, pressed && { opacity: 0.75 }]}
      >
        <View style={[styles.banniereIcone, { backgroundColor: g.couleur + '1F' }]}>
          <MaterialCommunityIcons name={g.icone} size={24} color={g.couleur} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.banniereTitre}>{g.titre}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <Text style={styles.banniereSous}>{g.tuiles.length} écran{g.tuiles.length > 1 ? 's' : ''}</Text>
            {badge && <View style={[styles.pastille, { backgroundColor: g.fonce }]}><Text style={styles.pastilleTxt}>{badge}</Text></View>}
          </View>
        </View>
        <Animated.View style={chevron}>
          <MaterialCommunityIcons name="chevron-down" size={24} color={colors.textMuted} />
        </Animated.View>
      </Pressable>

      {ouvert && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.liste}>
          {g.tuiles.map((t, i) => (
            <Pressable
              key={t.id || i}
              onPress={() => !t.bloque && router.push(t.route)}
              disabled={t.bloque}
              accessibilityRole="button"
              accessibilityLabel={`${t.titre}, ${t.sous}${badges[t.id] ? `, ${badges[t.id]}` : ''}`}
              style={({ pressed }) => [styles.ligne, i > 0 && styles.ligneSep, pressed && { backgroundColor: colors.surfaceAlt }, t.bloque && { opacity: 0.5 }]}
            >
              <View style={[styles.ligneIcone, { backgroundColor: g.couleur + '1A' }]}>
                <MaterialCommunityIcons name={ICONES_TUILES[t.id] || 'apps'} size={20} color={g.couleur} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ligneTitre}>{t.titre}</Text>
                <Text style={styles.ligneSous} numberOfLines={1}>{t.bloque ? 'Verrouillé' : t.sous}</Text>
              </View>
              {badges[t.id] && <View style={[styles.pastille, { backgroundColor: g.fonce }]}><Text style={styles.pastilleTxt}>{badges[t.id]}</Text></View>}
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
            </Pressable>
          ))}
        </Animated.View>
      )}
    </Animated.View>
  )
}

const makeStyles = (c) => StyleSheet.create({
  section: { marginBottom: 18 },
  sectionTitre: {
    fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 10,
  },
  presse: { opacity: 0.85, transform: [{ scale: 0.985 }] },

  // Points d'hier
  bandeau: {
    backgroundColor: c.surface, borderRadius: 20, padding: 16, marginBottom: 18,
    borderWidth: 1, borderColor: c.borderLight,
    shadowColor: c.cardShadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  bandeauHaut: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bandeauLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  bandeauGrand: { fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  bandeauUnite: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  barre: { flexDirection: 'row', gap: 4, marginTop: 12, height: 8 },
  segment: { flex: 1, borderRadius: 4 },
  restos: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6, marginTop: 10 },
  resto: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  restoNom: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  bandeauBas: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: c.borderLight,
  },
  indicateur: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  indicateurTxt: { fontSize: 13, fontWeight: '700' },

  // Accès direct
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: VERT_HERO,
    borderRadius: 20, padding: 18, minHeight: 84,
    shadowColor: VERT_HERO, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 6,
  },
  heroIcone: {
    width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroTitre: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  heroSous: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  rangee: { flexDirection: 'row', gap: 12, marginTop: 12 },
  favori: { borderRadius: 18, padding: 14, borderWidth: 1, minHeight: 124 },
  favoriIcone: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  favoriTitre: { fontSize: 15, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
  favoriSous: { fontSize: 12, color: c.textSecondary, marginTop: 3, lineHeight: 16 },

  // Bannières
  banniere: {
    backgroundColor: c.surface, borderRadius: 18, marginBottom: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: c.borderLight,
  },
  banniereEntete: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64 },
  banniereIcone: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  banniereTitre: { fontSize: 16, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
  banniereSous: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  liste: { paddingHorizontal: 8, paddingBottom: 8 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, minHeight: 56 },
  ligneSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  ligneIcone: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ligneTitre: { fontSize: 14, fontWeight: '700', color: c.text },
  ligneSous: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  pastille: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pastilleTxt: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
})
