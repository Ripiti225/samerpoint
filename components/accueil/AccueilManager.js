// ──────────────────────────────────────────────────────────────────────────────
// Accueil manager / directeur / RH (le RH voit ses demandes et ses échéances à
// la place des points d'hier, et seulement les bannières de ses accès).
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
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'

import { useTheme } from '../../context/ThemeContext'
import Jauge from '../ui/Jauge'
import Indicateur from './Indicateur'
import Survol from '../ui/Survol'
import { chargerContactsPeriode } from '../../lib/contactsPeriodeDb'
import { evolutionsHierDetail, texteHier, totalParJour } from '../../lib/hierAccueil'
import { etatPointHier, lignesCaissiersHier, texteDemandes } from '../../lib/accueilGerant'
import { objectifDuMois } from '../../lib/objectifs'
import { CHAMPS_VENTE, venteRetenue, venteTheorique, ventesDouble } from '../../lib/venteMachine'
import BandeauGerant from './BandeauGerant'
import { resumeContrats } from '../../lib/contrats'
import {
  ICONES_TUILES, etatPointsDuJour, groupeDeTuile, messagesTresorerie, nbAVerifier, organiserAccueil,
} from '../../lib/groupesAccueil'
import { supabase } from '../../lib/supabase'
import { CATEGORIES_TRESORERIE, fmt, niveauTresorerie, peut } from '../../lib/tresorerie'

const CLE_OUVERTS = 'samtrackly_accueil_groupes_ouverts'
const TRANSITION_WEB = Platform.OS === 'web'
  ? { transitionProperty: 'transform, border-color, box-shadow', transitionDuration: '160ms', transitionTimingFunction: 'ease-out' }
  : null
const VERT_HERO = '#047857' // fond de la carte Trésorerie : blanc lisible dessus (≥ 4,5:1)
const ORANGE_HERO = '#C2570C' // grande tuile du gérant (Saisir les ventes) : orange vif, blanc lisible dessus

const ECART_JAUGES = 6

const STATUTS = {
  verifie: { icone: 'check-circle', label: 'vérifié' },
  a_verifier: { icone: 'magnify-scan', label: 'à vérifier' },
  en_attente: { icone: 'clock-outline', label: 'pas encore validé' },
}

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Messages Trésorerie (échéances d'aujourd'hui et de demain, passées en dette
// ce matin, coffre à rembourser), selon le niveau de trésorerie du compte.
// null si le compte n'y a pas accès, ou si la Trésorerie ne répond pas.
async function chargerTresorerie({ role, userId, hier, auj, demain }) {
  const { data: droits, error } = await supabase.from('tresorerie_droits').select('user_id, niveau')
  if (error) return null
  const niveau = niveauTresorerie(role, userId, droits || [])
  if (!peut(niveau, 'voir_a_payer')) return null
  const d = await supabase.from('tresorerie_dus').select('id, categorie, restaurant_id, echeance, montant_du')
    .in('categorie', CATEGORIES_TRESORERIE).gte('echeance', hier).lte('echeance', demain).range(0, 999)
  if (d.error) return null
  const ids = (d.data || []).map(x => x.id)
  const p = ids.length
    ? await supabase.from('tresorerie_paiements').select('du_id, montant').in('du_id', ids).range(0, 4999)
    : { data: [] }
  let emprunts = []
  let receptions = []
  if (peut(niveau, 'voir_coffre')) {
    const e = await supabase.from('tresorerie_coffre_emprunts').select('*').is('rembourse_le', null)
    emprunts = e.error ? [] : e.data || []
    if (emprunts.length) {
      const plusAncien = emprunts.reduce((m, x) => (x.created_at < m ? x.created_at : m), emprunts[0].created_at)
      const r = await supabase.from('tresorerie_partenaire_lignes').select('partenaire, type, created_at')
        .eq('type', 'recu').gte('created_at', plusAncien).range(0, 999)
      receptions = r.error ? [] : r.data || []
    }
  }
  return messagesTresorerie({ dus: d.data, paiements: p.data, emprunts, receptions, aujourdhui: auj, demain, hier })
}

// Résumé des contrats (jauge « sous contrat » et rappels) ; null si la lecture échoue.
// .range explicite : PostgREST tronque silencieusement à 1000 lignes.
async function chargerContrats(jour) {
  const [t, c] = await Promise.all([
    supabase.from('travailleurs').select('id, actif, statut').neq('statut', 'archive').range(0, 4999),
    supabase.from('contrats_travailleurs').select('travailleur_id, type, date_debut, date_fin, cloture_le').range(0, 4999),
  ])
  if (t.error || c.error) return null
  return resumeContrats(t.data, c.data, jour)
}

// Points des 7 derniers jours, restaurants, demandes en attente, messages
// Trésorerie et contrats. null tant que rien n'est chargé (ou hors ligne) : pas de bandeau.
function useEtatDuJour(role, userId, restaurantId) {
  const [etat, setEtat] = useState(null)
  const charger = useCallback(async () => {
    try {
      const auj = new Date()
      const hier = new Date(auj); hier.setDate(auj.getDate() - 1)
      const demain = new Date(auj); demain.setDate(auj.getDate() + 1)
      const depuis = new Date(auj); depuis.setDate(auj.getDate() - 7)
      const avantHier = new Date(auj); avantHier.setDate(auj.getDate() - 2)
      const semainePrec = new Date(auj); semainePrec.setDate(auj.getDate() - 8)

      // Gérant : son restaurant seulement (point d'hier, ventes, demandes, avis, contacts).
      if (role === 'gerant') {
        if (!restaurantId) return
        const dates = [isoLocal(hier), isoLocal(avantHier), isoLocal(semainePrec)]
        const nbAvisResto = jour => supabase.from('platform_reviews').select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId).eq('review_date', isoLocal(jour)).then(x => (x.error ? 0 : x.count || 0))
        // Objectif du mois : ventes des jours terminés (aujourd'hui exclu).
        const debutMois = isoLocal(new Date(auj.getFullYear(), auj.getMonth(), 1))
        const joursMois = new Date(auj.getFullYear(), auj.getMonth() + 1, 0).getDate()
        const [pts, corr, dem, expl, aH, aAH, aSP, contactsJours, shiftsHier, resto, ptsMois] = await Promise.all([
          supabase.from('points').select(`date, valide, verifie, ${CHAMPS_VENTE}`).eq('restaurant_id', restaurantId).in('date', dates),
          supabase.from('deverouillages_points').select('id', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId).eq('statut', 'ouvert'),
          supabase.from('demandes').select('id', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId).eq('statut', 'en_attente'),
          supabase.from('demandes_explication').select('id', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId).in('statut', ['en_attente_acceptation', 'acceptee', 'envoyee']),
          nbAvisResto(hier), nbAvisResto(avantHier), nbAvisResto(semainePrec),
          chargerContactsPeriode({ debut: isoLocal(semainePrec), fin: isoLocal(hier), restoId: restaurantId })
            .then(c => totalParJour(c.lignes, 'contacts')).catch(() => null),
          supabase.from('points_shifts')
            .select('id, caissier_nom, heure_debut, heure_fin, vente_shift, ecart_pos, explication_ecart')
            .eq('restaurant_id', restaurantId).eq('date', dates[0]),
          supabase.from('restaurants').select('objectif_mensuel').eq('id', restaurantId).maybeSingle(),
          supabase.from('points').select(CHAMPS_VENTE).eq('restaurant_id', restaurantId)
            .gte('date', debutMois).lt('date', isoLocal(auj)),
        ])
        if (pts.error) return
        const parDate = Object.fromEntries((pts.data || []).map(x => [x.date, x]))
        // La vraie vente = vente machine ; la théorique n'est que le comparatif (lib/venteMachine.js).
        const vente = d => venteRetenue(parDate[d])
        const nbDem = dem.error ? 0 : dem.count || 0
        const nbExpl = expl.error ? 0 : expl.count || 0
        const mois = ventesDouble(ptsMois.data || [])
        const objectifMensuel = Number(resto.data?.objectif_mensuel) || 0
        setEtat({
          hier,
          gerant: {
            hier,
            point: etatPointHier({ point: parDate[dates[0]] || null, nbCorrections: corr.error ? 0 : corr.count || 0 }),
            ventes: parDate[dates[0]] ? vente(dates[0]) : null,
            ventesTheo: parDate[dates[0]] ? venteTheorique(parDate[dates[0]]) : null,
            ventesEvo: parDate[dates[0]]
              ? evolutionsHierDetail({ hier: vente(dates[0]), avantHier: vente(dates[1]), semainePrec: vente(dates[2]) }, dates[0])
              : [],
            demandes: texteDemandes({ demandes: nbDem, explications: nbExpl }),
            nbDemandes: nbDem + nbExpl,
            caissiers: shiftsHier.error ? [] : lignesCaissiersHier(shiftsHier.data),
            objectif: resto.error || ptsMois.error ? null : objectifDuMois({
              ventes: mois.machine, objectif: objectifMensuel, joursEcoules: auj.getDate() - 1, joursMois,
            }),
            objectifMensuel,
            ventesMois: mois.machine,
            ventesMoisTheo: mois.theorique,
          },
          avisHier: texteHier({ hier: aH, avantHier: aAH, semainePrec: aSP }, dates[0]),
          contactsHier: contactsJours === null ? null : texteHier({
            hier: contactsJours[dates[0]] || 0, avantHier: contactsJours[dates[1]] || 0, semainePrec: contactsJours[dates[2]] || 0,
          }, dates[0], ['contact', 'contacts']),
        })
        return
      }
      // Avis Glovo/Yango reçus un jour donné (date de l'avis), sans les charger.
      const nbAvis = jour => supabase.from('platform_reviews').select('id', { count: 'exact', head: true })
        .eq('review_date', isoLocal(jour)).then(x => (x.error ? null : x.count || 0))
      const [p, r, d, treso, contrats, avisHier, avisAvantHier, avisSemainePrec, contactsJours] = await Promise.all([
        supabase.from('points').select('restaurant_id, date, valide, verifie')
          .gte('date', isoLocal(depuis)).lte('date', isoLocal(auj)).order('date').range(0, 999),
        supabase.from('restaurants').select('id, nom').order('nom'),
        supabase.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente'),
        chargerTresorerie({ role, userId, hier: isoLocal(hier), auj: isoLocal(auj), demain: isoLocal(demain) }).catch(() => null),
        chargerContrats(isoLocal(auj)).catch(() => null),
        nbAvis(hier).catch(() => null),
        nbAvis(avantHier).catch(() => null),
        nbAvis(semainePrec).catch(() => null),
        // Contacts comptés comme l'écran Contacts (compteurs POS par shift).
        chargerContactsPeriode({ debut: isoLocal(semainePrec), fin: isoLocal(hier), restoId: null })
          .then(c => totalParJour(c.lignes, 'contacts')).catch(() => null),
      ])
      if (p.error || r.error) return
      setEtat({
        hier,
        jour: etatPointsDuJour({ points: p.data, restaurants: r.data, date: isoLocal(hier) }),
        aVerifier: nbAVerifier(p.data),
        demandes: d.error ? 0 : d.count || 0,
        treso,
        contrats,
        avisHier: avisHier === null ? null
          : texteHier({ hier: avisHier, avantHier: avisAvantHier || 0, semainePrec: avisSemainePrec || 0 }, isoLocal(hier)),
        contactsHier: contactsJours === null ? null
          : texteHier({
            hier: contactsJours[isoLocal(hier)] || 0,
            avantHier: contactsJours[isoLocal(avantHier)] || 0,
            semainePrec: contactsJours[isoLocal(semainePrec)] || 0,
          }, isoLocal(hier), ['contact', 'contacts']),
      })
    } catch (_) { /* hors ligne : pas de bandeau */ }
  }, [role, userId, restaurantId])
  useFocusEffect(useCallback(() => { charger() }, [charger]))
  return etat
}

export default function AccueilManager({ items, role, userId, restaurantId }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  // Le RH ne saisit que les charges : sa Trésorerie s'ouvre directement sur « À payer ».
  const tuiles = useMemo(
    () => (role === 'rh' ? items.map(t => (t.id === 'tresorerie' ? { ...t, route: '/tresorerie-a-payer' } : t)) : items),
    [items, role],
  )
  const etat = useEtatDuJour(role, userId, restaurantId)
  // Sous-titres vivants : les lignes « Avis clients » et « Contacts » donnent
  // le chiffre d'hier et son évolution.
  const tuilesVivantes = useMemo(() => {
    const vivants = { 'avis-plateformes': etat?.avisHier, contacts: etat?.contactsHier }
    return tuiles.map(t => (vivants[t.id] ? { ...t, sous: vivants[t.id] } : t))
  }, [tuiles, etat?.avisHier, etat?.contactsHier])
  const { favoris, groupes, autres } = useMemo(() => organiserAccueil(tuilesVivantes, role), [tuilesVivantes, role])
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
      {etat && (role === 'gerant'
        ? (etat.gerant ? <BandeauGerant etat={etat.gerant} styles={styles} colors={colors} /> : null)
        : role === 'rh'
          ? <BandeauRH etat={etat} styles={styles} colors={colors} />
          : <BandeauPoints etat={etat} styles={styles} colors={colors} />)}

      {favoris.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitre} accessibilityRole="header">Accès direct</Text>
          {hero && (
            <Animated.View entering={FadeInDown.delay(60).springify().damping(18)}>
              <Survol
                onPress={() => !hero.bloque && router.push(hero.route)}
                accessibilityRole="button" accessibilityLabel={`${hero.titre}, ${hero.sous}`}
                style={[styles.hero, role === 'gerant' && { backgroundColor: ORANGE_HERO, shadowColor: ORANGE_HERO }, hero.bloque && { opacity: 0.55 }]}
                echelle={1.02} styleSurvol={styles.heroSurvol}
              >
                <View style={styles.heroIcone}>
                  <MaterialCommunityIcons name={ICONES_TUILES[hero.id] || 'apps'} size={30} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTitre}>{hero.titre}</Text>
                  <Text style={styles.heroSous} numberOfLines={2}>{hero.bloque ? '🔒 Verrouillé : point du jour validé' : hero.sous}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={26} color="#FFFFFF" />
              </Survol>
            </Animated.View>
          )}
          <View style={styles.rangee}>
            {secondaires.map((t, i) => {
              const { couleur: c, fonce } = groupeDeTuile(t.id, role)
              return (
                <Animated.View key={t.id} style={{ flex: 1 }} entering={FadeInDown.delay(120 + i * 60).springify().damping(18)}>
                  <Survol
                    onPress={() => !t.bloque && router.push(t.route)}
                    accessibilityRole="button" accessibilityLabel={`${t.titre}${badges[t.id] ? `, ${badges[t.id]}` : ''}`}
                    style={[styles.favori, { backgroundColor: c + '14', borderColor: c + '40' }]}
                    echelle={1.05} styleSurvol={{ borderColor: c, backgroundColor: c + '22' }}
                  >
                    <View style={[styles.favoriIcone, { backgroundColor: c }]}>
                      <MaterialCommunityIcons name={ICONES_TUILES[t.id] || 'apps'} size={22} color="#FFFFFF" />
                    </View>
                    <Text style={styles.favoriTitre} numberOfLines={1}>{t.titre}</Text>
                    {badges[t.id]
                      ? <View style={[styles.pastille, { backgroundColor: fonce, alignSelf: 'flex-start', marginTop: 6 }]}><Text style={styles.pastilleTxt}>{badges[t.id]}</Text></View>
                      : <Text style={styles.favoriSous} numberOfLines={2}>{t.sous}</Text>}
                  </Survol>
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

// ── Bandeau du compte RH : ses demandes et les charges à échéance ────────────
// Les points des restaurants ne le concernent pas : à la place, les demandes
// en attente et les échéances (salaires, CNPS, timbre…) d'aujourd'hui et demain.

function BandeauRH({ etat, styles, colors }) {
  const { demandes, treso } = etat
  const auj = new Date()
  const lignes = treso ? [
    treso.aujourdhui.n > 0 && { cle: 'auj', icone: 'calendar-alert', couleur: colors.error,
      texte: `${treso.aujourdhui.n} échéance${treso.aujourdhui.n > 1 ? 's' : ''} aujourd'hui · ${fmt(treso.aujourdhui.total)} F` },
    treso.demain.n > 0 && { cle: 'dem', icone: 'calendar-clock', couleur: colors.warningDark,
      texte: `${treso.demain.n} demain · ${fmt(treso.demain.total)} F` },
    treso.detteCeMatin.n > 0 && { cle: 'det', icone: 'alert-octagon', couleur: colors.error,
      texte: `${treso.detteCeMatin.n} passée${treso.detteCeMatin.n > 1 ? 's' : ''} en dette ce matin · ${fmt(treso.detteCeMatin.total)} F` },
  ].filter(Boolean) : []
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Survol
        onPress={() => router.push('/demandes-admin')}
        accessibilityRole="button"
        accessibilityLabel={`${demandes} demande${demandes > 1 ? 's' : ''} en attente. Ouvrir les demandes.`}
        style={styles.bandeau} echelle={1.01} styleSurvol={{ borderColor: colors.primary + '66' }}
      >
        <View style={styles.bandeauHaut}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bandeauLabel}>Aujourd'hui · {auj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={[styles.bandeauGrand, { color: demandes ? colors.warningDark : colors.success }]}>{demandes}</Text>
              <Text style={styles.bandeauUnite}>demande{demandes > 1 ? 's' : ''} en attente</Text>
            </View>
          </View>
          <MaterialCommunityIcons name={demandes ? 'inbox-arrow-down' : 'check-decagram'} size={34}
            color={demandes ? colors.warningDark : colors.success} />
        </View>

        <View style={styles.bandeauTreso}>
          <Text style={styles.bandeauSousTitre}>Charges à payer</Text>
          {lignes.length === 0 && (
            <Indicateur icone="check-circle" couleur={colors.success} texte="Aucune échéance aujourd'hui ni demain" styles={styles} />
          )}
          {lignes.map(l => (
            <Survol key={l.cle} onPress={() => router.push('/tresorerie-a-payer')} accessibilityRole="button" hitSlop={6}
              accessibilityLabel={l.texte} style={styles.lienTreso} echelle={1.02}
              styleSurvol={{ backgroundColor: l.couleur + '14' }}>
              <Indicateur icone={l.icone} couleur={l.couleur} texte={l.texte} styles={styles} />
              <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
            </Survol>
          ))}
        </View>

        {etat.contrats && <BlocContrats resume={etat.contrats} styles={styles} colors={colors} />}
      </Survol>
    </Animated.View>
  )
}

// ── « Points d'hier » ────────────────────────────────────────────────────────

function BandeauPoints({ etat, styles, colors }) {
  const { jour, hier, aVerifier, demandes, treso } = etat
  const lignesTreso = treso ? [
    treso.aujourdhui.n > 0 && { cle: 'auj', icone: 'calendar-alert', couleur: colors.error,
      texte: `${treso.aujourdhui.n} échéance${treso.aujourdhui.n > 1 ? 's' : ''} aujourd'hui · ${fmt(treso.aujourdhui.total)} F`, route: '/tresorerie' },
    treso.demain.n > 0 && { cle: 'dem', icone: 'calendar-clock', couleur: colors.warningDark,
      texte: `${treso.demain.n} demain · ${fmt(treso.demain.total)} F`, route: '/tresorerie' },
    treso.detteCeMatin.n > 0 && { cle: 'det', icone: 'alert-octagon', couleur: colors.error,
      texte: `${treso.detteCeMatin.n} passée${treso.detteCeMatin.n > 1 ? 's' : ''} en dette ce matin · ${fmt(treso.detteCeMatin.total)} F`,
      route: '/tresorerie-a-payer?onglet=dette_recente' },
    treso.coffre.n > 0 && { cle: 'cof', icone: 'safe', couleur: colors.primary,
      texte: `Rembourser ${fmt(treso.coffre.total)} F au coffre`, route: '/tresorerie-coffre' },
  ].filter(Boolean) : []
  // warningDark : foncé en clair, vif en sombre — lisible dans les deux thèmes.
  const couleurs = { verifie: colors.success, a_verifier: colors.warningDark, en_attente: colors.textMuted }
  const complet = jour.valides === jour.total
  // Chaque restaurant a sa jauge, son nom juste en dessous. Sur un téléphone,
  // 8 colonnes ne laissent pas la place aux noms : deux rangées de 4.
  const [largeurJauges, setLargeurJauges] = useState(0)
  const nbRestos = jour.lignes.length || 1
  const parRangee = largeurJauges / nbRestos >= 70 ? nbRestos : Math.ceil(nbRestos / 2)
  const largeurJauge = largeurJauges ? (largeurJauges - ECART_JAUGES * (parRangee - 1)) / parRangee : 0
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Survol
        onPress={() => router.push('/verification')}
        accessibilityRole="button"
        accessibilityLabel={`Points d'hier : ${jour.valides} sur ${jour.total} validés, ${aVerifier} à vérifier. Ouvrir la vérification.`}
        style={styles.bandeau} echelle={1.01} styleSurvol={{ borderColor: colors.primary + '66' }}
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

        {/* Une jauge par restaurant, son nom juste en dessous */}
        <View style={styles.jauges} onLayout={e => setLargeurJauges(Math.floor(e.nativeEvent.layout.width))}>
          {largeurJauges > 0 && jour.lignes.map(l => (
            <View key={l.id} style={[styles.jauge, { width: largeurJauge }]}
              accessibilityLabel={`${l.nom} : ${STATUTS[l.statut].label}`}>
              <View style={[styles.segment, { backgroundColor: couleurs[l.statut] }]} />
              <View style={styles.resto}>
                <MaterialCommunityIcons name={STATUTS[l.statut].icone} size={13} color={couleurs[l.statut]} />
                <Text style={[styles.restoNom, l.statut === 'en_attente' && { color: colors.textMuted }]} numberOfLines={1}>{l.nom}</Text>
              </View>
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

        {treso && (
          <View style={styles.bandeauTreso}>
            <Text style={styles.bandeauSousTitre}>Trésorerie</Text>
            {lignesTreso.length === 0 && (
              <Indicateur icone="check-circle" couleur={colors.success} texte="Aucune échéance aujourd'hui ni demain" styles={styles} />
            )}
            {lignesTreso.map(l => (
              <Survol key={l.cle} onPress={() => router.push(l.route)} accessibilityRole="button" hitSlop={6}
                accessibilityLabel={l.texte} style={styles.lienTreso} echelle={1.02}
                styleSurvol={{ backgroundColor: l.couleur + '14' }}>
                <Indicateur icone={l.icone} couleur={l.couleur} texte={l.texte} styles={styles} />
                <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
              </Survol>
            ))}
          </View>
        )}

        {etat.contrats && <BlocContrats resume={etat.contrats} styles={styles} colors={colors} />}
      </Survol>
    </Animated.View>
  )
}

// ── Contrats : jauge « sous contrat » et rappels, dans les deux bandeaux ─────

function BlocContrats({ resume: r, styles, colors }) {
  const lignes = [
    r.bientot > 0 && { cle: 'bie', icone: 'timer-sand', couleur: r.plusProche !== null && r.plusProche <= 7 ? colors.error : colors.warningDark,
      texte: `${r.bientot} expire${r.bientot > 1 ? 'nt' : ''} bientôt${r.plusProche !== null ? ` · le plus proche ${r.plusProche === 0 ? "aujourd'hui" : `dans ${r.plusProche} j`}` : ''}` },
    r.aRenouveler > 0 && { cle: 'ren', icone: 'autorenew', couleur: colors.error,
      texte: `${r.aRenouveler} expiré${r.aRenouveler > 1 ? 's' : ''} à renouveler` },
    r.sans > 0 && { cle: 'san', icone: 'file-alert', couleur: colors.error,
      texte: `${r.sans} sans contrat` },
    { cle: 'sous', icone: 'file-check', couleur: colors.success,
      texte: `${r.sousContrat} / ${r.total} sous contrat` },
  ].filter(Boolean)
  return (
    <View style={styles.bandeauTreso}>
      <Text style={styles.bandeauSousTitre}>Contrats</Text>
      <Survol onPress={() => router.push('/contrats')} accessibilityRole="button" hitSlop={6}
        accessibilityLabel={`${r.pct} % des travailleurs sous contrat. Ouvrir les contrats.`}
        style={[styles.lienTreso, { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 4 }]} echelle={1.01}>
        <Jauge variante="barre" pct={r.pct} libelle="Travailleurs sous contrat" />
      </Survol>
      {lignes.map(l => (
        <Survol key={l.cle} onPress={() => router.push('/contrats')} accessibilityRole="button" hitSlop={6}
          accessibilityLabel={l.texte} style={styles.lienTreso} echelle={1.02}
          styleSurvol={{ backgroundColor: l.couleur + '14' }}>
          <Indicateur icone={l.icone} couleur={l.couleur} texte={l.texte} styles={styles} />
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
        </Survol>
      ))}
    </View>
  )
}

// ── Bannière dépliable ───────────────────────────────────────────────────────

function Banniere({ g, index, ouvert, onBasculer, badge, badges, styles, colors }) {
  const [survol, setSurvol] = useState(false)
  const rotation = useSharedValue(ouvert ? 180 : 0)
  useEffect(() => { rotation.value = withTiming(ouvert ? 180 : 0, { duration: 220 }) }, [ouvert, rotation])
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))

  return (
    <Animated.View
      entering={FadeInDown.delay(80 + index * 45).springify().damping(20)}
      layout={LinearTransition.duration(220)}
      style={[
        styles.banniere, TRANSITION_WEB,
        ouvert && { borderColor: g.couleur + '66' },
        survol && { borderColor: g.couleur, transform: [{ scale: 1.015 }], shadowOpacity: 0.12 },
      ]}
    >
      <Pressable
        onPress={onBasculer}
        onHoverIn={() => setSurvol(true)}
        onHoverOut={() => setSurvol(false)}
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
            <Survol
              key={t.id || i}
              onPress={() => !t.bloque && router.push(t.route)}
              disabled={t.bloque}
              accessibilityRole="button"
              accessibilityLabel={`${t.titre}, ${t.sous}${badges[t.id] ? `, ${badges[t.id]}` : ''}`}
              style={[styles.ligne, i > 0 && styles.ligneSep, t.bloque && { opacity: 0.5 }]}
              echelle={1.02} styleSurvol={{ backgroundColor: g.couleur + '14' }}
            >
              <View style={[styles.ligneIcone, { backgroundColor: g.couleur + '1A' }]}>
                <MaterialCommunityIcons name={ICONES_TUILES[t.id] || 'apps'} size={20} color={g.couleur} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ligneTitre}>{t.titre}</Text>
                <Text style={styles.ligneSous} numberOfLines={['avis-plateformes', 'contacts'].includes(t.id) ? 2 : 1}>{t.bloque ? 'Verrouillé' : t.sous}</Text>
              </View>
              {badges[t.id] && <View style={[styles.pastille, { backgroundColor: g.fonce }]}><Text style={styles.pastilleTxt}>{badges[t.id]}</Text></View>}
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
            </Survol>
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
  jauges: { flexDirection: 'row', flexWrap: 'wrap', columnGap: ECART_JAUGES, rowGap: 12, marginTop: 14, minHeight: 30 },
  jauge: { gap: 6 },
  segment: { height: 8, borderRadius: 4 },
  resto: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  restoNom: { flexShrink: 1, fontSize: 12, color: c.textSecondary, fontWeight: '700' },
  bandeauBas: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: c.borderLight,
  },
  indicateur: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  bandeauTreso: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.borderLight, gap: 8 },
  bandeauSousTitre: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  lienTreso: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 32, borderRadius: 10, paddingHorizontal: 6, marginHorizontal: -6 },
  indicateurTxt: { fontSize: 13, fontWeight: '700' },

  // Accès direct
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: VERT_HERO,
    borderRadius: 20, padding: 18, minHeight: 84,
    shadowColor: VERT_HERO, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 6,
  },
  heroSurvol: { shadowOpacity: 0.45, shadowRadius: 22 },
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
