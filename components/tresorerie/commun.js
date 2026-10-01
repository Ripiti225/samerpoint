// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — briques partagées par les trois écrans (vue, banque, à payer).
// ──────────────────────────────────────────────────────────────────────────────
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'

import { useApp } from '../../context/AppContext'
import { useTheme } from '../../context/ThemeContext'
import { isOnlineNow } from '../../lib/networkStatus'
import { fmt, niveauTresorerie, peut } from '../../lib/tresorerie'
import { chargerDroits, chargerPartenaires, chargerTresorerie } from '../../lib/tresorerieDb'

// Charge les données + le niveau d'accès de l'utilisateur. Recharge à chaque
// retour sur l'écran (une saisie faite ailleurs apparaît tout de suite).
export function useTresorerie({ creerLoyers = false, avecPartenaires = false } = {}) {
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
      const [base, partenaires] = await Promise.all([
        chargerTresorerie({ creerLoyers, user }),
        avecPartenaires && peut(niv, 'voir_partenaires') ? chargerPartenaires() : Promise.resolve(undefined),
      ])
      setDonnees({ ...base, partenaires })
    } catch (e) {
      setErreur(e?.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [roleActif, userId, creerLoyers, avecPartenaires, user])

  useFocusEffect(useCallback(() => { recharger() }, [recharger]))

  const niveau = niveauTresorerie(roleActif, userId, droits)
  return { donnees, droits, niveau, loading, erreur, recharger, user }
}

export function useStylesTreso() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return { colors, styles }
}

export function Entete({ titre, sous, droite }) {
  const { styles } = useStylesTreso()
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.back}>‹ Retour</Text>
      </TouchableOpacity>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={styles.headerTitre}>{titre}</Text>
        {!!sous && <Text style={styles.headerSous}>{sous}</Text>}
      </View>
      <View style={{ minWidth: 60, alignItems: 'flex-end' }}>{droite}</View>
    </View>
  )
}

// États communs : chargement, erreur, accès refusé. Rend null si tout va bien.
export function EtatEcran({ loading, erreur, niveau, donnees, recharger, autorise = true }) {
  const { styles, colors } = useStylesTreso()
  if (loading && !donnees) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Chargement de la trésorerie…</Text>
      </View>
    )
  }
  if (erreur) {
    return (
      <View style={styles.centre}>
        <Text style={styles.erreur}>{erreur}</Text>
        <TouchableOpacity style={[styles.btn, { marginTop: 14 }]} onPress={recharger}>
          <Text style={styles.btnTxt}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    )
  }
  if (!niveau || !autorise) {
    return (
      <View style={styles.centre}>
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
  const { styles } = useStylesTreso()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onFermer} />
        <View style={styles.feuille}>
          <View style={styles.feuilleEntete}>
            <Text style={styles.feuilleTitre}>{titre}</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.fermer}>✕</Text>
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

export function Bouton({ titre, onPress, secondaire, danger, desactive, occupe, style }) {
  const { styles, colors } = useStylesTreso()
  return (
    <TouchableOpacity
      style={[styles.btn, secondaire && styles.btnSecondaire, danger && styles.btnDanger, (desactive || occupe) && { opacity: 0.5 }, style]}
      onPress={onPress}
      disabled={desactive || occupe}
    >
      {occupe
        ? <ActivityIndicator color={secondaire ? colors.primary : '#fff'} />
        : <Text style={[styles.btnTxt, secondaire && styles.btnTxtSecondaire]}>{titre}</Text>}
    </TouchableOpacity>
  )
}

export function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500', minWidth: 60 },
  headerTitre: { fontSize: 16, fontWeight: '700', color: colors.headerText },
  headerSous: { fontSize: 11, color: colors.primaryText, marginTop: 2 },
  body: { flex: 1 },
  bodyContenu: { padding: 14, paddingBottom: 60 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 10, textAlign: 'center' },
  erreur: { fontSize: 14, color: colors.error, textAlign: 'center', lineHeight: 20 },
  carte: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  lbl: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },
  grand: { fontSize: 30, fontWeight: '800', color: colors.text, marginTop: 4, fontVariant: ['tabular-nums'] },
  sep: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.border, marginVertical: 8 },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 10 },
  ligneLabel: { fontSize: 14, color: colors.textSecondary, flex: 1 },
  ligneValeur: { fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  fort: { fontWeight: '800', color: colors.text },
  petit: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  tuiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tuile: { flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: colors.border, minHeight: 64 },
  tuileTitre: { fontSize: 14, fontWeight: '700', color: colors.text },
  tuileSous: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  btn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnSecondaire: { backgroundColor: colors.primaryLight },
  btnDanger: { backgroundColor: colors.error },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnTxtSecondaire: { color: colors.primary },
  btnPetit: { paddingVertical: 7, paddingHorizontal: 12, minHeight: 34 },
  rangee: { flexDirection: 'row', gap: 8 },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  puce: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  puceActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  puceTxt: { fontSize: 13, color: colors.textSecondary },
  puceTxtActive: { color: colors.primary, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  input: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 11, fontSize: 15, color: colors.text },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  feuille: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '88%' },
  feuilleEntete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  feuilleTitre: { fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 },
  fermer: { fontSize: 18, color: colors.textMuted, paddingLeft: 12 },
  onglets: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  onglet: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  ongletActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  ongletTxt: { fontSize: 13, color: colors.textSecondary },
  ongletTxtActif: { color: '#fff', fontWeight: '700' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  itemTitre: { fontSize: 14, fontWeight: '600', color: colors.text },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeTxt: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  vide: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  avert: { backgroundColor: colors.warningLight, borderRadius: 10, padding: 10, marginBottom: 10 },
  avertTxt: { fontSize: 13, color: colors.warningDark, lineHeight: 18 },
}) }
