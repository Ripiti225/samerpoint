// ──────────────────────────────────────────────────────────────────────────────
// Style « chaleureux » des écrans Déductions gérant et Saisie des ventes.
//   Mode clair  = A · en-tête en dégradé orange, cartes blanches à ombre douce.
//   Mode sombre = B · fond nuit, gros chiffres orange lumineux, halo sur l'actif.
// Les dégradés passent par react-native-svg (déjà installé) : aucune dépendance
// native en plus, donc publiable en mise à jour automatique.
// ──────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '../../context/ThemeContext'
import { nomCourtResto } from '../../lib/groupesAccueil'
import PhotoJustificatif from '../PhotoJustificatif'
import TexteAjuste from './TexteAjuste'

export const CLAIR = {
  fond: '#F6F3EE', carte: '#FFFFFF', carteFin: '#FFFFFF', bord: '#EFE6D8',
  texte: '#2B1A05', texteDoux: '#7A5A30', texteVide: '#B8A58A', champ: '#F6F3EE', champBord: '#E8D9C2',
  accent: '#C2410C', accentVif: '#E07B00',
  degrade: ['#F7B23B', '#E07B00', '#C2410C'], degradeBouton: ['#F7B23B', '#E07B00'], texteBouton: '#FFFFFF',
  enTeteTexte: '#FFFFFF', piste: '#F2E6D6', ombre: '#7A3A00', voile: 'rgba(43,26,5,0.45)',
  ok: '#15803D', okFond: '#E8F5EE', erreur: '#B42318', erreurFond: '#FDECEA',
  alerte: '#B45309', alerteFond: '#FFF7EB', info: '#185FA5', infoFond: '#E6F1FB',
}

export const SOMBRE = {
  fond: '#0D0D14', carte: '#1C1C2A', carteFin: '#15151F', bord: '#2A2A3A',
  texte: '#F2F2F7', texteDoux: '#8E8EA0', texteVide: '#4A4A5E', champ: '#12121B', champBord: '#2A2A3A',
  accent: '#FFB84D', accentVif: '#F5A54A',
  degrade: ['#FFB84D', '#FF6B3D'], degradeBouton: ['#FFB84D', '#FF6B3D'], texteBouton: '#1A0E00',
  enTeteTexte: '#F2F2F7', piste: '#2A2A3A', ombre: '#FF8A3D', voile: 'rgba(0,0,0,0.6)',
  ok: '#4ADE80', okFond: '#0F2A1C', erreur: '#FF7A6B', erreurFond: '#2A1416',
  alerte: '#F5A54A', alerteFond: '#241A0C', info: '#7CB4F5', infoFond: '#0F1E33',
}

function makeStyles(p, sombre) {
  const ombreCarte = sombre ? {} : {
    shadowColor: p.ombre, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 2,
  }
  return StyleSheet.create({
    ecran: { flex: 1, backgroundColor: p.fond },
    corps: { flex: 1 },
    corpsContenu: { padding: 14, paddingBottom: 28 },
    ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    ligneChamps: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },

    enTete: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, overflow: 'hidden', backgroundColor: sombre ? p.fond : p.accentVif },
    enTeteFlottant: { paddingBottom: 52 },
    enTeteRetour: { fontSize: 15, fontWeight: '600', color: sombre ? p.texteDoux : p.enTeteTexte, paddingVertical: 4 },
    enTeteContexte: { fontSize: 12, color: sombre ? p.texteDoux : p.enTeteTexte, opacity: sombre ? 1 : 0.9, flexShrink: 1 },
    enTeteSurtitre: sombre
      ? { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: p.accentVif, marginTop: 14, textTransform: 'uppercase' }
      : { fontSize: 12, color: p.enTeteTexte, opacity: 0.85, marginTop: 10 },
    enTeteTitre: { fontSize: 21, fontWeight: '800', color: p.enTeteTexte, marginTop: 4 },
    enTeteGrand: { fontSize: 24, fontWeight: '800', color: p.texte, marginTop: 2 },
    enTeteChiffre: { fontSize: 32, color: p.accent, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
    enTeteSous: { fontSize: 12, color: sombre ? p.texteDoux : p.enTeteTexte, opacity: sombre ? 1 : 0.85, marginTop: 2 },

    onglets: {
      flexDirection: 'row', gap: 4, padding: 5, marginHorizontal: 14, marginTop: 10, borderRadius: 18,
      backgroundColor: p.carte, borderWidth: sombre ? 1 : 0, borderColor: p.bord, ...ombreCarte,
    },
    ongletsFlottants: {
      marginTop: -40, shadowColor: p.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 5,
    },
    onglet: {
      flex: 1, minHeight: 48, borderRadius: 13, paddingVertical: 7, paddingHorizontal: 4,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent',
    },
    ongletActif: sombre
      ? { backgroundColor: '#2A2236', borderColor: p.accentVif, shadowColor: p.accentVif, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 12, elevation: 4 }
      : { backgroundColor: p.accentVif },
    ongletLabel: { fontSize: 13, fontWeight: '700', color: p.texteDoux },
    ongletLabelActif: { color: sombre ? p.accent : '#FFFFFF' },
    ongletDetail: { fontSize: 10.5, color: p.texteDoux, marginTop: 1, fontVariant: ['tabular-nums'] },
    ongletDetailActif: { color: sombre ? p.accent : '#FFFFFF', opacity: 0.9 },

    etapes: { flexDirection: 'row', gap: 6, marginTop: 12 },
    etapeTrait: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: sombre ? p.piste : 'rgba(255,255,255,0.35)' },
    etapeTraitFait: sombre ? {} : { backgroundColor: '#FFFFFF' },
    etapeTraitActuel: sombre ? { shadowColor: p.ombre, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6 } : {},
    etapeLabel: { fontSize: 10.5, marginTop: 5, color: sombre ? p.texteDoux : p.enTeteTexte, opacity: sombre ? 1 : 0.75 },
    etapeLabelActuel: { fontWeight: '800', opacity: 1, color: sombre ? p.accent : p.enTeteTexte },

    carte: {
      backgroundColor: p.carte, borderRadius: 16, padding: 13, marginBottom: 10,
      ...(sombre ? { borderWidth: 1, borderColor: p.bord, overflow: 'hidden' } : ombreCarte),
    },
    carteActive: sombre ? { borderColor: p.accentVif + '88' } : { borderWidth: 1.5, borderColor: p.accentVif },
    carteTitre: { fontSize: 14.5, fontWeight: '700', color: p.texte, flexShrink: 1 },
    rubrique: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: p.texteDoux, marginTop: 8, marginBottom: 7, marginLeft: 2, textTransform: 'uppercase' },
    texte: { fontSize: 13.5, color: p.texte, lineHeight: 19 },
    texteDoux: { fontSize: 12.5, color: p.texteDoux },
    texteVide: { fontSize: 12, color: p.texteVide, marginTop: 6 },
    petitDoux: { fontSize: 11, color: p.texteDoux, marginTop: 2 },
    petitFort: { fontSize: 11, fontWeight: '700' },
    montantFort: { fontSize: 16, fontWeight: '800', color: p.accent, fontVariant: ['tabular-nums'] },
    enormeChiffre: { fontSize: 26, fontWeight: '800', color: p.accent, fontVariant: ['tabular-nums'], marginTop: 2 },
    supprimer: { fontSize: 15, color: p.erreur, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 10 },

    etiquette: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
    etiquetteTxt: { fontSize: 10.5, fontWeight: '700' },

    bandeau: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10,
      borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1,
    },
    bandeauDansCorps: { marginHorizontal: 0, marginTop: 0, marginBottom: 10 },
    bandeauTxt: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
    bandeauAction: { fontSize: 16, paddingHorizontal: 4 },

    ligneValeur: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, gap: 8 },
    ligneValeurForte: { borderTopWidth: 1, borderTopColor: p.bord, marginTop: 6, paddingTop: 10 },
    ligneValeurLibelle: { fontSize: 13, color: p.texteDoux, flexShrink: 1 },
    ligneValeurVal: { fontSize: 13.5, fontWeight: '700', color: p.texte, fontVariant: ['tabular-nums'] },
    ligneValeurValForte: { fontSize: 18, fontWeight: '800' },

    piste: { height: 6, borderRadius: 3, backgroundColor: p.piste, overflow: 'hidden', marginTop: 8 },
    remplissage: { height: '100%', borderRadius: 3, overflow: 'hidden' },

    champLibelle: { fontSize: 10.5, color: p.texteDoux, fontWeight: '600', marginBottom: 4 },
    champ: {
      backgroundColor: p.champ, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10,
      fontSize: 14, color: p.texte, borderWidth: 1, borderColor: p.champBord, minHeight: 44,
    },
    champGrand: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
    champAccent: { borderColor: p.accentVif, borderWidth: 1.5 },
    champInactif: { opacity: 0.6 },
    champMultiligne: { minHeight: 80, textAlignVertical: 'top' },

    boutonOmbre: sombre
      ? { borderRadius: 14, shadowColor: p.ombre, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 6 }
      : { borderRadius: 14, shadowColor: p.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3 },
    bouton: { borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, overflow: 'hidden' },
    boutonTxt: { fontSize: 15, fontWeight: '800', color: p.texteBouton },
    boutonAttenue: { opacity: 0.55 },
    boutonSecondaire: {
      borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.accentVif, marginBottom: 10, paddingHorizontal: 12,
    },
    boutonSecondaireTxt: { fontSize: 13.5, fontWeight: '700', color: p.accent },

    barreBas: {
      paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, backgroundColor: sombre ? p.fond : p.carte,
      ...(sombre
        ? { borderTopWidth: 1, borderTopColor: p.bord }
        : { shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 10 }),
    },
    manquants: { fontSize: 11.5, fontWeight: '600', marginBottom: 8, lineHeight: 16 },
    barreTotalLibelle: { fontSize: 10.5, color: p.texteDoux },
    barreTotalValeur: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },

    photo: { marginTop: 10, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: p.bord, backgroundColor: p.champ },
    photoRequise: { borderColor: p.erreur, backgroundColor: p.erreurFond },
    photoApercu: { width: '100%', height: 140, borderRadius: 10, marginBottom: 8 },
    photoBouton: {
      borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center',
      backgroundColor: p.carte, borderWidth: 1, borderColor: p.accentVif,
    },
    photoBoutonTxt: { fontSize: 13, fontWeight: '700', color: p.accent },

    vignettes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    vignette: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
    vignetteImage: { width: 72, height: 72 },
    vignetteRetirer: {
      position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    vignetteRetirerTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    vignetteAjout: {
      width: 72, height: 72, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed',
      borderColor: p.accentVif, alignItems: 'center', justifyContent: 'center',
    },
    vignetteAjoutTxt: { fontSize: 24, color: p.accent },

    voile: { flex: 1, backgroundColor: p.voile, justifyContent: 'flex-end' },
    feuille: {
      backgroundColor: p.carte, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18,
      maxHeight: '78%', borderWidth: sombre ? 1 : 0, borderColor: p.bord,
    },
    feuilleTitre: { fontSize: 16, fontWeight: '800', color: p.texte, flexShrink: 1 },
    feuilleFermer: { fontSize: 18, color: p.texteDoux, padding: 4 },
    choix: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 12, minHeight: 48,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.bord,
    },
    choixNom: { fontSize: 14.5, fontWeight: '600', color: p.texte },
    choixSous: { fontSize: 11.5, color: p.texteDoux, marginTop: 2 },
    vide: { fontSize: 13, color: p.texteVide, textAlign: 'center', paddingVertical: 20 },
  })
}

// Calculés une fois : deux jeux de styles, choisis selon le mode.
const STYLES = { clair: makeStyles(CLAIR, false), sombre: makeStyles(SOMBRE, true) }

export function useStyleChaleureux() {
  const { isDark } = useTheme()
  return isDark
    ? { p: SOMBRE, styles: STYLES.sombre, isDark: true }
    : { p: CLAIR, styles: STYLES.clair, isDark: false }
}

// « Samer Palmeraie » + « 2026-10-05 » → « Palmeraie · 05/10 ».
export function contexteJour(restaurantNom, dateJour) {
  const nom = restaurantNom ? nomCourtResto(restaurantNom) : ''
  const date = dateJour ? `${dateJour.slice(8, 10)}/${dateJour.slice(5, 7)}` : ''
  return [nom, date].filter(Boolean).join(' · ')
}

const TONS = p => ({
  neutre: [p.piste, p.texteDoux], ok: [p.okFond, p.ok], erreur: [p.erreurFond, p.erreur],
  alerte: [p.alerteFond, p.alerte], info: [p.infoFond, p.info],
})

let numeroDegrade = 0

/** Fond en dégradé, posé en absolu derrière le contenu de son parent. */
export function Degrade({ couleurs, horizontal = false }) {
  const id = useMemo(() => `degrade${++numeroDegrade}`, [])
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2={horizontal ? '0' : '1'}>
          {couleurs.map((c, i) => (
            <Stop key={c + i} offset={couleurs.length > 1 ? i / (couleurs.length - 1) : 0} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

/**
 * Clair : dégradé orange, grand titre blanc. Sombre : surtitre orange, grand
 * chiffre (total du jour) ou grand titre. `flottant` laisse la place aux
 * onglets qui chevauchent le bas de l'en-tête (mode clair).
 */
export function EnTete({ titre, surtitre, sous, chiffre, contexte, onRetour, libelleRetour = '‹ Retour', flottant = false, children }) {
  const { p, styles, isDark } = useStyleChaleureux()
  const haut = (
    <View style={styles.ligne}>
      <TouchableOpacity onPress={onRetour} hitSlop={10} accessibilityRole="button" accessibilityLabel={libelleRetour.replace('‹ ', '')}>
        <Text style={styles.enTeteRetour}>{libelleRetour}</Text>
      </TouchableOpacity>
      {contexte ? <Text style={styles.enTeteContexte} numberOfLines={1}>{contexte}</Text> : null}
    </View>
  )
  if (isDark) {
    const label = surtitre || (chiffre ? titre : null)
    return (
      <View style={styles.enTete}>
        {haut}
        {label ? <Text style={styles.enTeteSurtitre}>{label}</Text> : null}
        <TexteAjuste style={[styles.enTeteGrand, !label && { marginTop: 12 }, chiffre && styles.enTeteChiffre]}>
          {chiffre || titre}
        </TexteAjuste>
        {sous ? <Text style={styles.enTeteSous}>{sous}</Text> : null}
        {children}
      </View>
    )
  }
  return (
    <View style={[styles.enTete, flottant && styles.enTeteFlottant]}>
      <Degrade couleurs={p.degrade} />
      {haut}
      {surtitre ? <Text style={styles.enTeteSurtitre}>{surtitre}</Text> : null}
      <Text style={[styles.enTeteTitre, !surtitre && { marginTop: 10 }]}>{titre}</Text>
      {sous ? <Text style={styles.enTeteSous}>{sous}</Text> : null}
      {children}
    </View>
  )
}

export function Onglets({ elements, actif, onChoisir, flottant = false }) {
  const { styles } = useStyleChaleureux()
  return (
    <View style={[styles.onglets, flottant && styles.ongletsFlottants]} accessibilityRole="tablist">
      {elements.map(e => {
        const sel = e.cle === actif
        return (
          <TouchableOpacity key={e.cle} style={[styles.onglet, sel && styles.ongletActif]} onPress={() => onChoisir(e.cle)}
            accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={`${e.label}, ${e.detail || ''}`}>
            <Text style={[styles.ongletLabel, sel && styles.ongletLabelActif]} numberOfLines={1}>{e.label}</Text>
            {e.detail ? <Text style={[styles.ongletDetail, sel && styles.ongletDetailActif]} numberOfLines={1}>{e.detail}</Text> : null}
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export function BarreEtapes({ etapes, actuelle, onChoisir }) {
  const { p, styles, isDark } = useStyleChaleureux()
  return (
    <View style={styles.etapes}>
      {etapes.map((label, i) => {
        const n = i + 1
        const faite = n <= actuelle
        return (
          <TouchableOpacity key={label} style={{ flex: 1 }} onPress={() => onChoisir(n)}
            accessibilityRole="button" accessibilityLabel={`Étape ${n} : ${label}`} accessibilityState={{ selected: n === actuelle }}>
            <View style={[styles.etapeTrait, faite && styles.etapeTraitFait, n === actuelle && styles.etapeTraitActuel]}>
              {isDark && faite ? <Degrade couleurs={p.degradeBouton} horizontal /> : null}
            </View>
            <Text style={[styles.etapeLabel, n === actuelle && styles.etapeLabelActuel]} numberOfLines={1}>{n} · {label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export function Carte({ children, style, active }) {
  const { p, styles, isDark } = useStyleChaleureux()
  return (
    <View style={[styles.carte, active && styles.carteActive, style]}>
      {isDark ? <Degrade couleurs={[p.carte, p.carteFin]} /> : null}
      {children}
    </View>
  )
}

export function Rubrique({ children }) {
  const { styles } = useStyleChaleureux()
  return <Text style={styles.rubrique}>{children}</Text>
}

export function Etiquette({ texte, ton = 'neutre' }) {
  const { p, styles } = useStyleChaleureux()
  const [fond, couleur] = TONS(p)[ton] || TONS(p).neutre
  return (
    <View style={[styles.etiquette, { backgroundColor: fond }]}>
      <Text style={[styles.etiquetteTxt, { color: couleur }]}>{texte}</Text>
    </View>
  )
}

export function Bandeau({ texte, ton = 'alerte', chargement, action, style }) {
  const { p, styles } = useStyleChaleureux()
  const [fond, couleur] = TONS(p)[ton] || TONS(p).alerte
  return (
    <View style={[styles.bandeau, { backgroundColor: fond, borderColor: couleur + '55' }, style]}>
      {chargement ? <ActivityIndicator size="small" color={couleur} /> : null}
      <Text style={[styles.bandeauTxt, { color: couleur }]}>{texte}</Text>
      {action ? (
        <TouchableOpacity onPress={action.onPress} disabled={action.disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={action.libelle}>
          <Text style={[styles.bandeauAction, { color: couleur }]}>{action.icone}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

export function LigneValeur({ libelle, etiquette, valeur, fort, couleur }) {
  const { styles } = useStyleChaleureux()
  const etq = typeof etiquette === 'string' ? { texte: etiquette } : etiquette
  return (
    <View style={[styles.ligneValeur, fort && styles.ligneValeurForte]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        <Text style={[styles.ligneValeurLibelle, fort && { fontWeight: '800', color: couleur }]}>{libelle}</Text>
        {etq ? <Etiquette texte={etq.texte} ton={etq.ton} /> : null}
      </View>
      <Text style={[styles.ligneValeurVal, fort && styles.ligneValeurValForte, couleur && { color: couleur }]}>{valeur}</Text>
    </View>
  )
}

export function BarreProgression({ ratio, solde }) {
  const { p, styles } = useStyleChaleureux()
  const largeur = `${Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100)}%`
  return (
    <View style={styles.piste}>
      <View style={[styles.remplissage, { width: largeur, backgroundColor: solde ? p.ok : p.accentVif }]}>
        {solde ? null : <Degrade couleurs={p.degradeBouton} horizontal />}
      </View>
    </View>
  )
}

export function Champ({ libelle, grand, accent, editable = true, multiline, style, ...props }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <View style={style}>
      {libelle ? <Text style={styles.champLibelle}>{libelle}</Text> : null}
      <TextInput
        {...props}
        editable={editable}
        multiline={multiline}
        placeholderTextColor={p.texteVide}
        style={[styles.champ, grand && styles.champGrand, accent && styles.champAccent, multiline && styles.champMultiligne, !editable && styles.champInactif]}
      />
    </View>
  )
}

export function BoutonDegrade({ label, onPress, disabled, attenue, chargement, style }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <View style={[styles.boutonOmbre, (attenue || disabled) && styles.boutonAttenue, style]}>
      <TouchableOpacity onPress={onPress} disabled={disabled || chargement} activeOpacity={0.85} style={styles.bouton}
        accessibilityRole="button" accessibilityLabel={label}>
        <Degrade couleurs={p.degradeBouton} horizontal />
        {chargement ? <ActivityIndicator color={p.texteBouton} /> : <Text style={styles.boutonTxt}>{label}</Text>}
      </TouchableOpacity>
    </View>
  )
}

export function BoutonSecondaire({ label, onPress, disabled, style }) {
  const { styles } = useStyleChaleureux()
  return (
    <TouchableOpacity style={[styles.boutonSecondaire, disabled && styles.boutonAttenue, style]} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.boutonSecondaireTxt}>{label}</Text>
    </TouchableOpacity>
  )
}

/** Barre fixe sous le défilement : « Il manque : … », total éventuel, bouton(s). */
export function BarreBas({ libelle, valeur, couleurValeur, manquants = [], children }) {
  const { p, styles } = useStyleChaleureux()
  const bloquant = manquants.some(m => m.bloquant)
  return (
    <View style={styles.barreBas}>
      {manquants.length > 0 ? (
        <Text style={[styles.manquants, { color: bloquant ? p.erreur : p.alerte }]}>
          ⚠ Il manque : {manquants.map(m => m.texte).join(', ')}
        </Text>
      ) : null}
      {libelle ? (
        <View style={styles.ligne}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.barreTotalLibelle}>{libelle}</Text>
            <TexteAjuste style={[styles.barreTotalValeur, { color: couleurValeur || p.texte }]}>{valeur}</TexteAjuste>
          </View>
          <View style={{ flexShrink: 0, minWidth: 150 }}>{children}</View>
        </View>
      ) : children}
    </View>
  )
}

export function BlocPhoto({ uri, valide, requis, label, onPress, uploading, modifiable = true }) {
  const { p, styles } = useStyleChaleureux()
  const manque = requis && !valide
  return (
    <View style={[styles.photo, manque && styles.photoRequise]}>
      <View style={[styles.ligne, { marginBottom: uri || modifiable ? 8 : 0 }]}>
        <Text style={styles.texteDoux}>
          📷 {label}{requis ? <Text style={{ color: p.erreur }}> *</Text> : null}
        </Text>
        {valide ? <Etiquette ton="ok" texte="Photo OK" /> : requis ? <Etiquette ton="erreur" texte="Requise" /> : null}
      </View>
      {uri ? <PhotoJustificatif uri={uri} style={styles.photoApercu} /> : null}
      {modifiable ? (
        <TouchableOpacity style={styles.photoBouton} onPress={onPress} disabled={uploading} accessibilityRole="button"
          accessibilityLabel={uri ? `Changer la photo : ${label}` : `Ajouter une photo : ${label}`}>
          {uploading
            ? <ActivityIndicator size="small" color={p.accent} />
            : <Text style={styles.photoBoutonTxt}>{uri ? 'Changer la photo' : 'Ajouter une photo'}</Text>}
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

export function Feuille({ visible, titre, onFermer, children }) {
  const { styles } = useStyleChaleureux()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.voile}>
        <View style={styles.feuille}>
          <View style={[styles.ligne, { marginBottom: 12 }]}>
            <Text style={styles.feuilleTitre}>{titre}</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
              <Text style={styles.feuilleFermer}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
            <View style={{ height: 16 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

export function Choix({ nom, sous, etiquette, tonEtiquette = 'ok', desactive, onPress }) {
  const { styles } = useStyleChaleureux()
  return (
    <TouchableOpacity style={[styles.choix, desactive && { opacity: 0.4 }]} onPress={onPress} disabled={desactive}
      accessibilityRole="button" accessibilityLabel={nom}>
      <View style={{ flex: 1 }}>
        <Text style={styles.choixNom}>{nom}</Text>
        {sous ? <Text style={styles.choixSous}>{sous}</Text> : null}
      </View>
      {etiquette ? <Etiquette ton={tonEtiquette} texte={etiquette} /> : null}
    </TouchableOpacity>
  )
}

export function Vide({ texte }) {
  const { styles } = useStyleChaleureux()
  return <Text style={styles.vide}>{texte}</Text>
}
