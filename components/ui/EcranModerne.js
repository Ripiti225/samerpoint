// Composants visuels des écrans modernisés (Demandes, Demandes d'explication,
// Contrats…) : même modernisation qu'Équipe globale, dans la couleur de l'écran.
// Une couleur = un thème : `principale` pour l'en-tête et les fonds pleins,
// `accent` pour les textes colorés (plus clair en mode sombre, pour rester lisible).
import { useMemo } from 'react'
import {
  Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native'
import { CalendrierFr, CalendrierPeriode } from '../ChampDate'
import { useTheme } from '../../context/ThemeContext'
import { VIOLET, fmtDate } from '../../lib/demandes'

export const teinte = (couleur, alpha = '1F') => `${couleur}${alpha}`

export const THEMES = {
  violet: { principale: VIOLET, accentClair: VIOLET, accentSombre: '#A49DF5' },
  orange: { principale: '#E07B00', accentClair: '#B45309', accentSombre: '#F5A54A' },
  beige: { principale: '#A8875C', accentClair: '#7D5F38', accentSombre: '#D9BC8F' },
  sarcelle: { principale: '#0F766E', accentClair: '#0F766E', accentSombre: '#5EEAD4' },
}

/** Styles + couleurs d'un écran. theme : une clé de THEMES. */
export function useEcranModerne(theme = 'violet') {
  const { colors, isDark } = useTheme()
  const t = THEMES[theme] || THEMES.violet
  const accent = isDark ? t.accentSombre : t.accentClair
  const styles = useMemo(() => makeStyles(colors, accent, t.principale), [colors, accent, t.principale])
  return { styles, colors, accent, principale: t.principale }
}

/** Écrans Demandes et Demandes d'explication (violet). */
export const useDemandesStyles = () => useEcranModerne('violet')

export function EnTete({ titre, sous, onRetour, styles }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onRetour} hitSlop={10}><Text style={styles.back}>‹ Retour</Text></TouchableOpacity>
      <View style={{ flex: 1, paddingHorizontal: 8 }}>
        <Text style={styles.headerTitre}>{titre}</Text>
        {sous ? <Text style={styles.headerSub} numberOfLines={1}>{sous}</Text> : null}
      </View>
      <View style={{ width: 60 }} />
    </View>
  )
}

/** Tuiles de comptage cliquables (servent aussi de filtre). */
export function Compteurs({ elements, actif, onChoisir, styles }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.compteurs}>
      {elements.map(e => {
        const sel = actif === e.cle
        return (
          <TouchableOpacity key={String(e.cle)} onPress={() => onChoisir(sel && e.cle !== null ? null : e.cle)} activeOpacity={0.8}
            style={[styles.compteur, sel && { borderColor: e.couleur, backgroundColor: teinte(e.couleur, '14') }]}>
            <Text style={[styles.compteurVal, { color: e.couleur }]}>{e.valeur}</Text>
            <Text style={styles.compteurLabel} numberOfLines={1}>{e.label}</Text>
            {e.alerte ? <Text style={styles.compteurAlerte}>{e.alerte}</Text> : null}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

export function Recherche({ value, onChange, placeholder, styles, colors }) {
  return (
    <View style={styles.searchWrap}>
      <TextInput style={styles.searchInput} value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={colors.textPlaceholder} />
    </View>
  )
}

/** Puces de choix ; `ligne` = défilement horizontal, sinon retour à la ligne. */
export function Puces({ elements, actif, onChoisir, styles, ligne = false, petit = false }) {
  const puces = elements.map(e => {
    const sel = actif === e.cle
    return (
      <TouchableOpacity key={String(e.cle)} onPress={() => onChoisir(e.cle)}
        style={[petit ? styles.pucePetite : styles.puce, sel && styles.puceActive]}>
        <Text style={[styles.puceTxt, sel && styles.puceTxtActive]}>{e.label}</Text>
      </TouchableOpacity>
    )
  })
  return ligne
    ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.pucesLigne}>{puces}</ScrollView>
    : <View style={styles.pucesWrap}>{puces}</View>
}

export function Pastille({ cfg, styles }) {
  return (
    <View style={[styles.pastille, { backgroundColor: teinte(cfg.couleur, '22') }]}>
      <Text style={[styles.pastilleTxt, { color: cfg.couleur }]}>{cfg.emoji} {cfg.label}</Text>
    </View>
  )
}

export function Vide({ icone, texte, sous, styles }) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyIcon}>{icone}</Text>
      <Text style={styles.emptyTxt}>{texte}</Text>
      {sous ? <Text style={styles.emptySub}>{sous}</Text> : null}
    </View>
  )
}

/** Ligne d'information d'une carte : petite icône + texte. */
export function Info({ icone, children, styles, couleur, gras }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoIcone}>{icone}</Text>
      <Text style={[styles.infoTxt, couleur && { color: couleur }, gras && { fontWeight: '700' }]}>{children}</Text>
    </View>
  )
}

/**
 * Bouton. variante : 'plein' (fond coloré), 'teinte' (fond pâle) ou 'contour'.
 * `flex` pour partager une rangée.
 */
export function Bouton({ label, onPress, couleur = VIOLET, variante = 'teinte', disabled, flex, styles, grand }) {
  const fond = variante === 'plein' ? couleur : variante === 'teinte' ? teinte(couleur, '1C') : 'transparent'
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8}
      style={[styles.bouton, grand && styles.boutonGrand, { backgroundColor: fond },
        variante === 'contour' && { borderWidth: 1, borderColor: teinte(couleur, '66') },
        flex && { flex: 1 }, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.boutonTxt, grand && { fontSize: 15 }, { color: variante === 'plein' ? '#fff' : couleur }]}>{label}</Text>
    </TouchableOpacity>
  )
}

/**
 * Feuille qui monte du bas, avec titre et bouton de fermeture.
 * Le plafond « 92 % de l'écran » est porté par l'enveloppe, dont la hauteur
 * est connue. Posé sur la feuille elle-même, il valait 92 % d'un parent sans
 * hauteur, donc rien : un long formulaire poussait son haut hors de l'écran,
 * impossible à atteindre (constaté le 14/10/2026 sur l'ajout d'un travailleur).
 */
export function Feuille({ visible, titre, sous, onFermer, children, styles }) {
  const contenu = (
    <View style={styles.modalOverlay}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.enveloppeFeuille}>
        <View style={styles.feuille}>
          <View style={styles.poignee} />
          <View style={styles.feuilleHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.feuilleTitre}>{titre}</Text>
              {sous ? <Text style={styles.feuilleSous}>{sous}</Text> : null}
            </View>
            <TouchableOpacity onPress={onFermer} hitSlop={10}><Text style={styles.feuilleClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      {/* Sur le web, ce wrapper avalerait les clics : on ne le met que sur mobile. */}
      {Platform.OS === 'web' ? contenu : <TouchableWithoutFeedback onPress={Keyboard.dismiss}>{contenu}</TouchableWithoutFeedback>}
    </Modal>
  )
}

export function Libelle({ children, styles }) {
  return <Text style={styles.label}>{children}</Text>
}

export function Champ({ styles, colors, multiline, ...props }) {
  return (
    <TextInput {...props} multiline={multiline} placeholderTextColor={colors.textPlaceholder}
      style={[styles.input, multiline && styles.textArea]} />
  )
}

/** Deux boutons Début / Fin et un calendrier qui s'ouvre sous le champ choisi. */
export function ChampDates({ debut, fin, setDebut, setFin, champ, setChamp, styles, colors, accent, couleur = VIOLET, periode = false }) {
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'center' }}>
        {[['debut', debut, '📅 Début'], ['fin', fin, '📅 Fin']].map(([cle, val, vide], i) => (
          <View key={cle} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {i === 1 ? <Text style={{ color: colors.textMuted }}>→</Text> : null}
            <TouchableOpacity style={[styles.dateBtn, champ === cle && styles.puceActive]} onPress={() => setChamp(champ === cle ? null : cle)}>
              <Text style={[styles.dateBtnTxt, val && { color: colors.text, fontWeight: '700' }, champ === cle && { color: '#fff' }]}>
                {val ? fmtDate(val) : vide}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {/* periode : filtre (avis…) → un seul calendrier de période, un mois s'y choisit en entier.
          Sinon (congés…) : le calendrier d'une date, pour le champ ouvert. */}
      {champ !== null && (
        <View style={{ marginBottom: 14, borderRadius: 14, overflow: 'hidden' }}>
          {periode ? (
            <CalendrierPeriode debut={champ === 'debut' ? '' : debut} fin="" couleur={couleur}
              onChange={p => {
                if (p.fin) { setDebut(p.debut); setFin(p.fin); setChamp(null) } else { setDebut(p.debut); setChamp('fin') }
              }}
              onMoisEntier={p => { setDebut(p.debut); setFin(p.fin); setChamp(null) }} />
          ) : (
            <CalendrierFr key={champ} valeur={champ === 'debut' ? debut : fin} couleur={champ === 'debut' ? couleur : '#3B8D2F'}
              minDate={champ === 'fin' && debut ? debut : undefined}
              onChoisir={iso => { if (champ === 'debut') setDebut(iso); else setFin(iso); setChamp(null) }} />
          )}
        </View>
      )}
    </>
  )
}

function makeStyles(colors, accent, principale) {
  const carte = {
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1,
  }
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      backgroundColor: principale, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
      flexDirection: 'row', alignItems: 'center', borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
    },
    back: { fontSize: 16, color: 'rgba(255,255,255,0.85)', fontWeight: '600', width: 60 },
    headerTitre: { fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'center', letterSpacing: -0.2 },
    headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2, textAlign: 'center' },

    compteurs: { paddingHorizontal: 14, paddingTop: 12, gap: 8 },
    compteur: { ...carte, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, minWidth: 92, borderWidth: 1.5 },
    compteurVal: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    compteurLabel: { fontSize: 11.5, color: colors.textMuted, fontWeight: '700', marginTop: 1 },
    compteurAlerte: { fontSize: 10.5, color: '#C27C1A', fontWeight: '800', marginTop: 3 },

    searchWrap: { paddingHorizontal: 14, paddingTop: 10 },
    searchInput: {
      backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
      fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.borderLight,
    },
    pucesLigne: { paddingHorizontal: 14, paddingTop: 10, gap: 8 },
    pucesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    puce: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
    pucePetite: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
    puceActive: { backgroundColor: principale, borderColor: principale },
    puceTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    puceTxtActive: { color: '#fff' },

    ongletsWrap: { flexDirection: 'row', marginHorizontal: 14, marginTop: 12, backgroundColor: colors.surfaceAlt, borderRadius: 16, padding: 4, gap: 4 },
    onglet: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
    ongletActive: { backgroundColor: colors.surface, shadowColor: colors.cardShadow, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
    ongletTxt: { fontSize: 13.5, color: colors.textMuted, fontWeight: '600' },
    ongletTxtActive: { color: accent, fontWeight: '800' },

    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
    body: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
    resultat: { fontSize: 12, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
    emptyBox: { alignItems: 'center', paddingVertical: 50 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { fontSize: 15, color: colors.textMuted, fontWeight: '700' },
    emptySub: { fontSize: 12.5, color: colors.textPlaceholder, marginTop: 6, textAlign: 'center' },

    carte: { ...carte, padding: 14, marginBottom: 12 },
    carteAlerte: { borderColor: '#EF9F27', borderWidth: 1.5 },
    carteTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    bulle: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    bulleTxt: { fontSize: 20 },
    carteTitre: { fontSize: 15, fontWeight: '800', color: colors.text },
    carteSous: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
    pastille: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginTop: 10 },
    pastilleTxt: { fontSize: 11.5, fontWeight: '800' },
    carteCorps: { marginTop: 10, gap: 5 },
    citation: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 10, marginTop: 4 },
    info: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    infoIcone: { fontSize: 13, width: 18, textAlign: 'center' },
    infoTxt: { flex: 1, fontSize: 13, color: colors.textSecondary },
    refus: { backgroundColor: teinte('#C2462B', '18'), borderRadius: 12, padding: 10, marginTop: 6 },
    refusTitre: { fontSize: 12, fontWeight: '800', color: '#C2462B', marginBottom: 2 },
    refusTxt: { fontSize: 13, color: '#C2462B' },
    actions: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight, flexWrap: 'wrap' },
    bouton: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
    boutonGrand: { paddingVertical: 14, borderRadius: 14 },
    boutonTxt: { fontSize: 13.5, fontWeight: '800' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    // Plafond sur l'enveloppe (hauteur connue), pas sur la feuille : voir Feuille.
    enveloppeFeuille: { width: '100%', maxHeight: '92%' },
    feuille: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 8, flexShrink: 1 },
    poignee: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
    feuilleHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 10 },
    feuilleTitre: { fontSize: 18, fontWeight: '800', color: colors.text },
    feuilleSous: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
    feuilleClose: { fontSize: 18, color: colors.textMuted, padding: 4 },
    label: { fontSize: 11.5, fontWeight: '800', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
    input: { backgroundColor: colors.bg, borderRadius: 14, padding: 13, fontSize: 15, color: colors.text, marginBottom: 16, borderWidth: 1, borderColor: colors.borderLight },
    textArea: { minHeight: 90, textAlignVertical: 'top', fontSize: 14 },
    dateBtn: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: colors.borderLight },
    dateBtnTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    hint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  })
}
