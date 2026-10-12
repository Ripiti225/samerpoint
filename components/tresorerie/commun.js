// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — briques partagées par les trois écrans (vue, banque, à payer).
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { retour } from '../../lib/navigation'
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'

import { useApp } from '../../context/AppContext'
import ChampDate from '../ChampDate'
import { useTheme } from '../../context/ThemeContext'
import { isOnlineNow } from '../../lib/networkStatus'
import { fmt, niveauTresorerie, peut } from '../../lib/tresorerie'
import { chargerDirection, chargerDroits, chargerPartenaires, chargerPartenairesParResto, chargerTresorerie } from '../../lib/tresorerieDb'

// Charge les données + le niveau d'accès de l'utilisateur. Recharge à chaque
// retour sur l'écran (une saisie faite ailleurs apparaît tout de suite).
export function useTresorerie({ creerLoyers = false, avecPartenaires = false, avecDirection = false, avecPartenairesParResto = false } = {}) {
  const { roleActif, userId, userNom } = useApp() ?? {}
  const [donnees, setDonnees] = useState(null)
  const [droits, setDroits] = useState([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState(null)

  const user = useMemo(() => ({ userId, userNom }), [userId, userNom])

  const recharger = useCallback(async () => {
    if (!isOnlineNow()) {
      setErreur("Pas de connexion. La trésorerie se consulte et se saisit en ligne uniquement.")
      setLoading(false)
      return
    }
    setLoading(true)
    setErreur(null)
    try {
      const dr = await chargerDroits()
      setDroits(dr)
      const niv = niveauTresorerie(roleActif, userId, dr)
      if (!niv) { setDonnees(null); return }
      const [base, partenaires, direction, partenairesParResto] = await Promise.all([
        chargerTresorerie({ creerLoyers, user }),
        avecPartenaires && peut(niv, 'voir_partenaires') ? chargerPartenaires() : Promise.resolve(undefined),
        avecDirection && (peut(niv, 'voir_coffre') || peut(niv, 'voir_direction')) ? chargerDirection() : Promise.resolve(undefined),
        avecPartenairesParResto && peut(niv, 'voir_partenaires') ? chargerPartenairesParResto() : Promise.resolve(undefined),
      ])
      setDonnees({ ...base, partenaires, direction, partenairesParResto })
    } catch (e) {
      setErreur(e?.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [roleActif, userId, creerLoyers, avecPartenaires, avecDirection, avecPartenairesParResto, user])

  useFocusEffect(useCallback(() => { recharger() }, [recharger]))

  const niveau = niveauTresorerie(roleActif, userId, droits)
  return { donnees, droits, niveau, loading, erreur, recharger, user }
}

export function useStylesTreso() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return { colors, styles }
}

// repli : écran où revenir quand il n'y a pas d'écran précédent (page rechargée).
// En-tête aux couleurs du groupe (thème), avec l'icône de la bannière d'accueil.
// toujoursRepli : Retour va toujours à `repli`, sans repasser par l'écran
// précédent (le RH arrive sur « À payer » par une redirection depuis
// « Trésorerie » : y revenir le renverrait aussitôt sur « À payer »).
export function Entete({ titre, sous, droite, repli = '/tresorerie', toujoursRepli = false }) {
  const { styles } = useStylesTreso()
  const { groupe } = useTheme()
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => (toujoursRepli ? router.replace(repli) : retour(repli))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button" accessibilityLabel="Retour" style={styles.retourBtn}>
        <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
      </TouchableOpacity>
      <View style={styles.headerCentre}>
        {groupe && (
          <View style={styles.headerIcone}>
            <MaterialCommunityIcons name={groupe.icone} size={18} color="#FFFFFF" />
          </View>
        )}
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.headerTitre} numberOfLines={1}>{titre}</Text>
          {!!sous && <Text style={styles.headerSous} numberOfLines={1}>{sous}</Text>}
        </View>
      </View>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{droite}</View>
    </View>
  )
}

// États communs : chargement, erreur, accès refusé. Rend null si tout va bien.
export function EtatEcran({ loading, erreur, niveau, donnees, recharger, autorise = true }) {
  const { styles, colors } = useStylesTreso()
  if (loading && !donnees) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.muted}>Chargement de la trésorerie…</Text>
      </View>
    )
  }
  if (erreur) {
    return (
      <View style={styles.centre}>
        <Pastille icone="wifi-off" couleur={colors.error} taille={56} />
        <Text style={[styles.erreur, { marginTop: 14 }]}>{erreur}</Text>
        <Bouton titre="Réessayer" icone="refresh" style={{ marginTop: 14 }} onPress={recharger} />
      </View>
    )
  }
  if (!niveau || !autorise) {
    return (
      <View style={styles.centre}>
        <Pastille icone="lock-outline" couleur={colors.textMuted} taille={56} />
        <Text style={styles.muted}>Cette partie de la trésorerie n'est pas ouverte à votre compte.</Text>
      </View>
    )
  }
  return null
}

export function Puces({ options, valeur, onChange }) {
  const { styles } = useStylesTreso()
  return (
    <View style={styles.puces}>
      {options.map(o => {
        const actif = o.valeur === valeur
        return (
          <TouchableOpacity key={String(o.valeur)} style={[styles.puce, actif && styles.puceActive]} onPress={() => onChange(o.valeur)}>
            <Text style={[styles.puceTxt, actif && styles.puceTxtActive]}>{o.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export function Champ({ label, ...props }) {
  const { styles, colors } = useStylesTreso()
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.textPlaceholder} style={styles.input} {...props} />
    </View>
  )
}

// Date choisie au calendrier (jamais tapée au clavier). Valeur ISO AAAA-MM-JJ.
export function ChampCalendrier({ label, valeur, onChange, ...props }) {
  const { styles } = useStylesTreso()
  return <ChampDate label={label} styleLabel={styles.label} valeur={valeur} onChange={onChange} {...props} />
}

export function ChampMontant({ label, valeur, onChange, placeholder = '0' }) {
  return (
    <Champ
      label={label}
      value={valeur}
      onChangeText={t => onChange(t.replace(/[^\d]/g, ''))}
      keyboardType="number-pad"
      placeholder={placeholder}
    />
  )
}

export function Feuille({ visible, titre, onFermer, children }) {
  const { styles, colors } = useStylesTreso()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onFermer} />
        <View style={styles.feuille}>
          <View style={styles.poignee} />
          <View style={styles.feuilleEntete}>
            <Text style={styles.feuilleTitre}>{titre}</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.fermerBtn} accessibilityRole="button" accessibilityLabel="Fermer">
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function Ligne({ label, valeur, signe, fort, couleur }) {
  const { styles } = useStylesTreso()
  const txt = signe === '-' ? `− ${fmt(valeur)}` : signe === '+' ? `+ ${fmt(valeur)}` : fmt(valeur)
  return (
    <View style={styles.ligne}>
      <Text style={[styles.ligneLabel, fort && styles.fort]}>{label}</Text>
      <Text style={[styles.ligneValeur, fort && styles.fort, couleur && { color: couleur }]}>{txt}</Text>
    </View>
  )
}

export function Bouton({ titre, onPress, secondaire, danger, desactive, occupe, style, icone }) {
  const { styles, colors } = useStylesTreso()
  const couleurTxt = secondaire ? colors.primary : '#FFFFFF'
  return (
    <TouchableOpacity
      style={[styles.btn, secondaire && styles.btnSecondaire, danger && styles.btnDanger, (desactive || occupe) && { opacity: 0.5 }, style]}
      onPress={onPress}
      disabled={desactive || occupe}
    >
      {occupe
        ? <ActivityIndicator color={couleurTxt} />
        : (
          <View style={styles.btnContenu}>
            {icone ? <MaterialCommunityIcons name={icone} size={18} color={couleurTxt} /> : null}
            <Text style={[styles.btnTxt, secondaire && styles.btnTxtSecondaire]}>{titre}</Text>
          </View>
        )}
    </TouchableOpacity>
  )
}

// ── Habillage commun : icônes et couleurs par charge, cartes colorées ───────

// Chaque charge a son icône et sa couleur, les mêmes sur tous les écrans.
export const STYLE_CATEGORIE = {
  loyer: { icone: 'home-city-outline', couleur: '#2563EB' },
  salaire: { icone: 'account-cash-outline', couleur: '#7C3AED' },
  cnps: { icone: 'shield-account-outline', couleur: '#0891B2' },
  impot: { icone: 'bank-outline', couleur: '#D97706' },
  its: { icone: 'percent-outline', couleur: '#DB2777' },
  tee: { icone: 'file-percent-outline', couleur: '#0D9488' },
  bail: { icone: 'file-sign', couleur: '#4F46E5' },
  autre: { icone: 'dots-horizontal-circle-outline', couleur: '#64748B' },
  admin: { icone: 'briefcase-outline', couleur: '#475569' },
  dette: { icone: 'hand-coin-outline', couleur: '#DC2626' },
  dette_recente: { icone: 'alert-circle-outline', couleur: '#EA580C' },
  anciens_travailleurs: { icone: 'account-arrow-right-outline', couleur: '#B45309' },
}
export const styleCategorie = cat => STYLE_CATEGORIE[cat] || STYLE_CATEGORIE.autre

// Partenaires de livraison et de paiement.
export const STYLE_PARTENAIRE = {
  yango: { icone: 'moped', couleur: '#E11D48' },
  glovo: { icone: 'bike-fast', couleur: '#D97706' },
  wave: { icone: 'waves', couleur: '#0284C7' },
  om: { icone: 'cellphone', couleur: '#EA580C' },
  djamo: { icone: 'credit-card-outline', couleur: '#6366F1' },
}

// Icône et couleur de chaque catégorie de dépense direction.
export const STYLE_DEPENSE = {
  fond: { icone: 'cash-refund', couleur: '#0E9F6E' },
  fond_nature: { icone: 'package-variant-closed', couleur: '#D97706' },
  reparation: { icone: 'hammer-wrench', couleur: '#DC2626' },
  materiel: { icone: 'silverware-fork-knife', couleur: '#2563EB' },
  equipement: { icone: 'stove', couleur: '#7C3AED' },
  investissement: { icone: 'office-building-cog-outline', couleur: '#0891B2' },
  retrait_perso: { icone: 'account-arrow-right-outline', couleur: '#64748B' },
  administratif: { icone: 'bank-outline', couleur: '#7C3AED' },
  divers: { icone: 'dots-horizontal-circle-outline', couleur: '#64748B' },
}
export const styleDepense = id => STYLE_DEPENSE[id] || STYLE_DEPENSE.divers

// Carré arrondi teinté avec une icône.
export function Pastille({ icone, couleur, taille = 38, fond }) {
  return (
    <View style={{
      width: taille, height: taille, borderRadius: Math.round(taille * 0.32),
      alignItems: 'center', justifyContent: 'center', backgroundColor: fond || `${couleur}1F`,
    }}>
      <MaterialCommunityIcons name={icone} size={Math.round(taille * 0.52)} color={couleur} />
    </View>
  )
}

// Titre de section : pastille + titre (+ montant ou action à droite).
export function TitreSection({ icone, couleur, titre, droite, style }) {
  const { styles, colors } = useStylesTreso()
  return (
    <View style={[styles.titreSection, style]}>
      {icone ? <Pastille icone={icone} couleur={couleur || colors.primary} taille={28} /> : null}
      <Text style={styles.titreSectionTxt} numberOfLines={1}>{titre}</Text>
      {typeof droite === 'string' ? <Text style={styles.titreSectionDroite}>{droite}</Text> : droite}
    </View>
  )
}

// Grande carte aux couleurs du groupe : le chiffre principal de l'écran.
export function Hero({ icone, titre, valeur, sous, couleurValeur, children, onPress }) {
  const { styles } = useStylesTreso()
  const Conteneur = onPress ? TouchableOpacity : View
  return (
    <Conteneur style={styles.hero} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.heroRond, { top: -60, right: -40, width: 170, height: 170 }]} />
      <View style={[styles.heroRond, { bottom: -70, left: -30, width: 140, height: 140, opacity: 0.5 }]} />
      <View style={styles.heroHaut}>
        {icone ? (
          <View style={styles.heroIcone}>
            <MaterialCommunityIcons name={icone} size={18} color="#FFFFFF" />
          </View>
        ) : null}
        <Text style={styles.heroLbl} numberOfLines={1}>{titre}</Text>
      </View>
      <Text style={[styles.heroValeur, couleurValeur && { color: couleurValeur }]} numberOfLines={1} adjustsFontSizeToFit>{valeur}</Text>
      {sous ? <Text style={styles.heroSous}>{sous}</Text> : null}
      {children}
    </Conteneur>
  )
}

// Petite case translucide dans la carte Hero (« Banque 12 000 000 »).
export function HeroCase({ label, valeur, couleur }) {
  const { styles } = useStylesTreso()
  return (
    <View style={styles.heroCase}>
      <View style={styles.heroCaseHaut}>
        {couleur ? <View style={[styles.heroPoint, { backgroundColor: couleur }]} /> : null}
        <Text style={styles.heroCaseLbl} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.heroCaseVal} numberOfLines={1} adjustsFontSizeToFit>{valeur}</Text>
    </View>
  )
}

// Barre empilée (répartition) ; segments = [{ valeur, couleur }].
export function BarreRepartition({ segments, hauteur = 8, fond = 'rgba(255,255,255,0.18)' }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.valeur || 0), 0)
  return (
    <View style={{ flexDirection: 'row', height: hauteur, borderRadius: hauteur, overflow: 'hidden', backgroundColor: fond, gap: total ? 2 : 0 }}>
      {total > 0 && segments.filter(x => x.valeur > 0).map((x, i) => (
        <View key={i} style={{ flex: x.valeur / total, backgroundColor: x.couleur }} />
      ))}
    </View>
  )
}

// Barre de progression (pourcentage 0–100).
export function Progression({ pct, couleur, fond, hauteur = 10 }) {
  const { colors } = useStylesTreso()
  return (
    <View style={{ height: hauteur, backgroundColor: fond || colors.surfaceAlt, borderRadius: hauteur, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct || 0))}%`, backgroundColor: couleur || colors.success, borderRadius: hauteur }} />
    </View>
  )
}

// Ligne de liste avec pastille d'icône, titre, détail et montant à droite.
export function ItemIcone({ icone, couleur, titre, sous, droite, couleurDroite, sousDroite, onPress, onLongPress, surligne, estompe }) {
  const { styles, colors } = useStylesTreso()
  const actif = !!(onPress || onLongPress)
  return (
    <TouchableOpacity
      style={[styles.itemIcone, surligne && { backgroundColor: surligne, borderColor: 'transparent' }, estompe && { opacity: 0.6 }]}
      onPress={onPress} onLongPress={onLongPress} delayLongPress={500} activeOpacity={actif ? 0.7 : 1} disabled={!actif}
    >
      <Pastille icone={icone} couleur={couleur || colors.primary} taille={38} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.itemTitre} numberOfLines={2}>{titre}</Text>
        {sous ? (typeof sous === 'string' ? <Text style={styles.petit}>{sous}</Text> : sous) : null}
      </View>
      {(droite != null || sousDroite) ? (
        <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: '42%' }}>
          {droite != null ? (typeof droite === 'string'
            ? <Text style={[styles.itemMontant, couleurDroite && { color: couleurDroite }]}>{droite}</Text>
            : droite) : null}
          {sousDroite || null}
        </View>
      ) : null}
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} /> : null}
    </TouchableOpacity>
  )
}

export function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
    zIndex: 2,
  },
  retourBtn: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerCentre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerIcone: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  back: { fontSize: 15, color: colors.headerText, fontWeight: '700' },
  headerTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText, letterSpacing: -0.3 },
  headerSous: { fontSize: 12, color: colors.primaryText, marginTop: 1, fontWeight: '600' },
  body: { flex: 1 },
  bodyContenu: { padding: 16, paddingTop: 18, paddingBottom: 60 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { fontSize: 14, color: colors.textMuted, marginTop: 12, textAlign: 'center', lineHeight: 20 },
  erreur: { fontSize: 14, color: colors.error, textAlign: 'center', lineHeight: 20 },
  carte: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  lbl: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.primary },
  grand: { fontSize: 32, fontWeight: '800', color: colors.text, marginTop: 4, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  sep: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.border, marginVertical: 8 },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 10 },
  ligneLabel: { fontSize: 14, color: colors.textSecondary, flex: 1 },
  ligneValeur: { fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  fort: { fontWeight: '800', color: colors.text },
  petit: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  tuiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tuile: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 20, padding: 14, paddingTop: 16,
    borderWidth: 1, borderColor: colors.borderLight, minHeight: 120, overflow: 'hidden',
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  tuileBande: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  tuileMontant: { fontSize: 15, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  bloc: { paddingLeft: 18, overflow: 'hidden' },
  blocTrait: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  blocHaut: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blocTitre: { fontSize: 16, fontWeight: '800', color: colors.text, letterSpacing: -0.2, flexShrink: 1 },
  blocNombre: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, minWidth: 22, alignItems: 'center' },
  blocNombreTxt: { fontSize: 12, fontWeight: '800' },
  blocValeur: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  blocContenu: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight },
  comptesGrille: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  compteCarte: { flexBasis: '47%', flexGrow: 1, marginBottom: 0, padding: 14, paddingTop: 16, overflow: 'hidden' },
  compteTrait: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  compteSolde: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 12, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  histoBouton: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: colors.primaryLight,
  },
  histoBoutonTxt: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.primary },
  lienDanger: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.errorLight },
  lienDangerTxt: { fontSize: 12, fontWeight: '800', color: colors.error },
  carteEntete: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  etatPilule: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  etatPiluleTxt: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lienHistorique: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 10, paddingVertical: 6 },
  lienHistoriqueTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  heroLigneBas: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)',
  },
  heroBasLbl: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  heroBasVal: { fontSize: 15, color: '#FFFFFF', fontWeight: '800', fontVariant: ['tabular-nums'] },
  tuileIcone: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8, backgroundColor: colors.primaryLight },
  tuileTitre: { fontSize: 14, fontWeight: '800', color: colors.text },
  tuileSous: { fontSize: 12, color: colors.textSecondary, marginTop: 3, lineHeight: 16 },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  btnSecondaire: { backgroundColor: colors.primaryLight },
  btnDanger: { backgroundColor: colors.error },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnContenu: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  btnTxtSecondaire: { color: colors.primary },
  btnPetit: { paddingVertical: 7, paddingHorizontal: 12, minHeight: 34 },
  rangee: { flexDirection: 'row', gap: 8 },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  puce: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, minHeight: 38, justifyContent: 'center' },
  puceActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 2,
  },
  puceTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  puceTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '800', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, padding: 12, fontSize: 15, color: colors.text },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  feuille: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingTop: 10, maxHeight: '88%' },
  poignee: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  feuilleEntete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10 },
  feuilleTitre: { fontSize: 19, fontWeight: '800', color: colors.text, flex: 1, letterSpacing: -0.3 },
  fermerBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  // Le fond est sur la barre (toute la largeur), pas sur son contenu.
  ongletsBarre: { flexGrow: 0, backgroundColor: colors.bg },
  onglets: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  onglet: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface,
  },
  ongletActif: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  ongletTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  ongletTxtActif: { color: '#fff', fontWeight: '800' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 12, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  itemTitre: { fontSize: 14, fontWeight: '700', color: colors.text },
  itemMontant: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  itemIcone: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8,
    backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight,
  },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeTxt: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  badgeLigne: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgePoint: { width: 6, height: 6, borderRadius: 3 },
  vide: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  avert: { backgroundColor: colors.warningLight, borderRadius: 14, padding: 12, marginBottom: 10 },
  avertTxt: { fontSize: 13, color: colors.warningDark, lineHeight: 18 },
  titreSection: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginBottom: 10 },
  titreSectionTxt: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  titreSectionDroite: { fontSize: 14, fontWeight: '800', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  hero: {
    backgroundColor: colors.headerBg, borderRadius: 24, padding: 18, marginBottom: 14, overflow: 'hidden',
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 18, elevation: 6,
  },
  heroRond: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroHaut: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIcone: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroLbl: { flex: 1, fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 },
  heroValeur: { fontSize: 34, fontWeight: '800', color: '#FFFFFF', marginTop: 12, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroSous: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4, fontWeight: '600', lineHeight: 18 },
  heroCases: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  heroCase: { flexGrow: 1, flexBasis: '30%', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9 },
  heroCaseHaut: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroPoint: { width: 8, height: 8, borderRadius: 4 },
  heroCaseLbl: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  heroCaseVal: { fontSize: 15, color: '#FFFFFF', fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
}) }
