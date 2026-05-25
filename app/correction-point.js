import { useState, useEffect, useMemo } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, ActivityIndicator, TextInput, Alert,
} from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import { COEFFICIENTS } from '../lib/constants'

const SECTION_CONFIG = {
  partenaires: { icon: '🛵', label: 'Partenaires', color: '#EF9F27' },
  fournisseurs: { icon: '🧾', label: 'Fournisseurs', color: '#185FA5' },
  photos:       { icon: '📷', label: 'Photos',      color: '#534AB7' },
  inventaire:   { icon: '📦', label: 'Inventaire',  color: '#3B6D11' },
}

export default function CorrectionPointScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { restaurantId, restaurantNom, userId, userNom, roleActif } = useApp() ?? {}

  const [corrections, setCorrections] = useState([])
  const [pointsData, setPointsData] = useState({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState({})

  useEffect(() => { if (restaurantId) chargerCorrections() }, [restaurantId])

  async function chargerCorrections() {
    setLoading(true)
    const { data } = await supabase
      .from('deverouillages_points')
      .select('*, points(id, date, restaurant_id, yango_tab, glovo_tab, wave, om, djamo, reste_especes, depenses_gerant_caisse_total, fc_veille, fc_compte, benefice_sc, depense_total)')
      .eq('restaurant_id', restaurantId)
      .eq('statut', 'ouvert')
      .order('created_at', { ascending: false })

    const corrs = data || []
    setCorrections(corrs)

    const pointIds = [...new Set(corrs.map(c => c.point_id))]
    const pd = {}
    await Promise.all(pointIds.map(async pid => {
      const [{ data: shifts }, { data: transactions }] = await Promise.all([
        supabase.from('points_shifts').select('*').eq('point_id', pid).order('created_at'),
        supabase.from('transactions_fournisseurs').select('id, facture, paye, fournisseurs(nom)').eq('point_id', pid),
      ])
      const pt = corrs.find(c => c.point_id === pid)?.points
      pd[pid] = { point: pt, shifts: shifts || [], transactions: transactions || [] }
    }))
    setPointsData(pd)
    setLoading(false)
  }

  async function recalculerTotaux(pointId) {
    const { data: pt } = await supabase.from('points').select('*').eq('id', pointId).single()
    const { data: txList } = await supabase.from('transactions_fournisseurs').select('paye').eq('point_id', pointId)
    const { data: depList } = await supabase.from('depenses').select('montant').eq('point_id', pointId)
    const { data: shifts } = await supabase.from('points_shifts').select('wave, om, djamo').eq('point_id', pointId)
    if (!pt) return

    const sh = shifts || []
    const wave  = sh.reduce((s, x) => s + (x.wave  || 0), 0) || (pt.wave  || 0)
    const om    = sh.reduce((s, x) => s + (x.om    || 0), 0) || (pt.om    || 0)
    const djamo = sh.reduce((s, x) => s + (x.djamo || 0), 0) || (pt.djamo || 0)

    // BSC = TAB commissionné + mobile × 0.99 + resteEspeces (déjà net dans points)
    const bsc = Math.round(
      ((pt.yango_tab || 0) * COEFFICIENTS.YANGO) +
      ((pt.glovo_tab || 0) * COEFFICIENTS.GLOVO) +
      (wave  * COEFFICIENTS.WAVE) +
      (om    * COEFFICIENTS.OM) +
      (djamo * COEFFICIENTS.DJAMO) +
      (pt.reste_especes || 0)
    )

    const depTotal = Math.round(
      (depList  || []).reduce((s, d) => s + (d.montant || 0), 0) +
      (txList   || []).reduce((s, t) => s + (t.paye    || 0), 0) +
      (pt.depenses_gerant_caisse_total || 0)
    )

    await supabase.from('points').update({ benefice_sc: bsc, depense_total: depTotal }).eq('id', pointId)
  }

  function initEdits(corr) {
    const pd = pointsData[corr.point_id]
    if (!pd) return {}
    if (corr.section === 'partenaires') {
      const sh = pd.shifts
      return {
        yango_tab: String(pd.point?.yango_tab || ''),
        glovo_tab: String(pd.point?.glovo_tab || ''),
        wave:  String(sh.reduce((s, x) => s + (x.wave  || 0), 0) || pd.point?.wave  || ''),
        om:    String(sh.reduce((s, x) => s + (x.om    || 0), 0) || pd.point?.om    || ''),
        djamo: String(sh.reduce((s, x) => s + (x.djamo || 0), 0) || pd.point?.djamo || ''),
      }
    }
    if (corr.section === 'fournisseurs') {
      return {
        transactions: pd.transactions.map(tx => ({
          id: tx.id,
          nom: tx.fournisseurs?.nom || 'Fournisseur',
          facture: String(tx.facture || ''),
          paye: String(tx.paye || ''),
        }))
      }
    }
    return {}
  }

  function toggleExpand(corrId, corr) {
    const open = !expanded[corrId]
    setExpanded(p => ({ ...p, [corrId]: open }))
    if (open && !edits[corrId]) {
      setEdits(p => ({ ...p, [corrId]: initEdits(corr) }))
    }
  }

  function setEdit(corrId, field, value) {
    setEdits(p => ({ ...p, [corrId]: { ...p[corrId], [field]: value } }))
  }

  function setTxEdit(corrId, idx, field, value) {
    setEdits(p => {
      const curr = { ...(p[corrId] || {}) }
      const txs = [...(curr.transactions || [])]
      txs[idx] = { ...txs[idx], [field]: value }
      return { ...p, [corrId]: { ...curr, transactions: txs } }
    })
  }

  async function sauvegarder(corr) {
    const cid = corr.id
    const pid = corr.point_id
    const edit = edits[cid]
    if (!edit) return
    setSaving(p => ({ ...p, [cid]: true }))
    try {
      if (corr.section === 'partenaires') {
        const updates = {}
        if (edit.yango_tab !== '') updates.yango_tab = parseFloat(edit.yango_tab) || 0
        if (edit.glovo_tab !== '') updates.glovo_tab = parseFloat(edit.glovo_tab) || 0
        if (edit.wave  !== '') updates.wave  = parseFloat(edit.wave)  || 0
        if (edit.om    !== '') updates.om    = parseFloat(edit.om)    || 0
        if (edit.djamo !== '') updates.djamo = parseFloat(edit.djamo) || 0
        const { error } = await supabase.from('points').update(updates).eq('id', pid)
        if (error) throw error
      } else if (corr.section === 'fournisseurs') {
        for (const tx of (edit.transactions || [])) {
          const { error } = await supabase.from('transactions_fournisseurs').update({
            facture: parseFloat(tx.facture) || 0,
            paye:    parseFloat(tx.paye)    || 0,
          }).eq('id', tx.id)
          if (error) throw error
        }
      }
      await recalculerTotaux(pid)
      await _marquerCorrige(cid, pid, corr.section)
    } catch (err) {
      Alert.alert('Erreur', err.message)
      setSaving(p => ({ ...p, [cid]: false }))
    }
  }

  async function marquerSansEdit(corrId, pointId, section) {
    setSaving(p => ({ ...p, [corrId]: true }))
    try {
      await _marquerCorrige(corrId, pointId, section)
    } catch (err) {
      Alert.alert('Erreur', err.message)
      setSaving(p => ({ ...p, [corrId]: false }))
    }
  }

  async function _marquerCorrige(corrId, pointId, section) {
    await supabase.from('deverouillages_points').update({
      statut: 'corrige',
      corrige_par: userId || null,
      corrige_at: new Date().toISOString(),
    }).eq('id', corrId)
    journaliser('correction_point', { correction_id: corrId, point_id: pointId, section }, { par: userNom || roleActif }).catch(() => {})
    setCorrections(p => p.filter(c => c.id !== corrId))
    setSaving(p => { const n = { ...p }; delete n[corrId]; return n })
    Alert.alert('✅ Correction enregistrée', 'Les données ont été mises à jour et les totaux recalculés.')
  }

  function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' F' }

  function formatDate(d) {
    if (!d) return ''
    const [y, m, j] = d.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(j)} ${mois[parseInt(m) - 1]} ${y}`
  }

  const corrByPoint = corrections.reduce((acc, c) => {
    if (!acc[c.point_id]) acc[c.point_id] = []
    acc[c.point_id].push(c)
    return acc
  }, {})

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitre}>Corrections en attente</Text>
          <Text style={styles.headerSub}>{restaurantNom || 'Mon restaurant'}</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement...</Text>
        </View>
      ) : Object.keys(corrByPoint).length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>✅</Text>
          <Text style={styles.emptyTitre}>Aucune correction en attente</Text>
          <Text style={styles.emptySub}>Toutes les corrections ont été traitées</Text>
        </View>
      ) : (
        <ScrollView style={{ padding: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerTxt}>
              ⚠️ Le manager a demandé des corrections sur {Object.keys(corrByPoint).length} point(s). Apportez les modifications demandées puis marquez chaque section comme corrigée.
            </Text>
          </View>

          {Object.entries(corrByPoint).map(([pointId, corrs]) => {
            const pd = pointsData[pointId]
            const point = pd?.point
            return (
              <View key={pointId} style={styles.pointGroup}>
                <View style={styles.pointGroupHeader}>
                  <Text style={styles.pointGroupDate}>📅 {formatDate(point?.date)}</Text>
                  <View style={styles.corrBadge}>
                    <Text style={styles.corrBadgeTxt}>{corrs.length} section(s)</Text>
                  </View>
                </View>

                {corrs.map(corr => {
                  const cfg = SECTION_CONFIG[corr.section] || { icon: '⚙️', label: corr.section, color: '#888' }
                  const isExp = !!expanded[corr.id]
                  const edit = edits[corr.id] || {}
                  const isSaving = !!saving[corr.id]

                  return (
                    <View key={corr.id} style={styles.corrCard}>
                      <TouchableOpacity
                        style={styles.corrCardHeader}
                        onPress={() => toggleExpand(corr.id, corr)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.sectionIconBox, { backgroundColor: cfg.color + '22' }]}>
                          <Text style={{ fontSize: 20 }}>{cfg.icon}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.sectionLabel, { color: cfg.color }]}>{cfg.label}</Text>
                          <Text style={styles.motifTxt} numberOfLines={isExp ? undefined : 2}>
                            "{corr.motif}"
                          </Text>
                        </View>
                        <Text style={styles.chevron}>{isExp ? '▲' : '▼'}</Text>
                      </TouchableOpacity>

                      {isExp && (
                        <View style={styles.corrForm}>

                          {/* ── Partenaires ── */}
                          {corr.section === 'partenaires' && (
                            <View>
                              <Text style={styles.formHint}>Modifiez les montants incorrects. Laissez vide pour ne pas changer.</Text>
                              {[
                                { key: 'yango_tab', label: '🛵 Yango TAB' },
                                { key: 'glovo_tab', label: '🟡 Glovo TAB' },
                                { key: 'wave',      label: '💙 Wave (total)' },
                                { key: 'om',        label: '🟠 Orange Money (total)' },
                                { key: 'djamo',     label: '💳 Djamo (total)' },
                              ].map(f => (
                                <View key={f.key} style={styles.formRow}>
                                  <Text style={styles.formLabel}>{f.label}</Text>
                                  <TextInput
                                    style={styles.formInput}
                                    value={edit[f.key] ?? ''}
                                    onChangeText={v => setEdit(corr.id, f.key, v)}
                                    keyboardType="numeric"
                                    placeholder="0"
                                    placeholderTextColor="#bbb"
                                  />
                                </View>
                              ))}
                              <TouchableOpacity
                                style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
                                onPress={() => sauvegarder(corr)}
                                disabled={isSaving}
                              >
                                {isSaving
                                  ? <ActivityIndicator color="#fff" size="small" />
                                  : <Text style={styles.saveBtnTxt}>💾 Enregistrer & marquer corrigé</Text>
                                }
                              </TouchableOpacity>
                            </View>
                          )}

                          {/* ── Fournisseurs ── */}
                          {corr.section === 'fournisseurs' && (
                            <View>
                              <Text style={styles.formHint}>Modifiez les montants facture/payé pour chaque fournisseur.</Text>
                              {(edit.transactions || []).length === 0 ? (
                                <Text style={styles.noDataTxt}>Aucune transaction enregistrée pour ce point</Text>
                              ) : (
                                (edit.transactions || []).map((tx, i) => (
                                  <View key={tx.id} style={styles.txRow}>
                                    <Text style={styles.txNom}>{tx.nom}</Text>
                                    <View style={styles.txInputsRow}>
                                      <View style={styles.txInputGroup}>
                                        <Text style={styles.txInputLabel}>Facture</Text>
                                        <TextInput
                                          style={styles.txInput}
                                          value={tx.facture}
                                          onChangeText={v => setTxEdit(corr.id, i, 'facture', v)}
                                          keyboardType="numeric"
                                          placeholder="0"
                                          placeholderTextColor="#bbb"
                                        />
                                      </View>
                                      <View style={styles.txInputGroup}>
                                        <Text style={styles.txInputLabel}>Payé</Text>
                                        <TextInput
                                          style={styles.txInput}
                                          value={tx.paye}
                                          onChangeText={v => setTxEdit(corr.id, i, 'paye', v)}
                                          keyboardType="numeric"
                                          placeholder="0"
                                          placeholderTextColor="#bbb"
                                        />
                                      </View>
                                    </View>
                                  </View>
                                ))
                              )}
                              <TouchableOpacity
                                style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
                                onPress={() => sauvegarder(corr)}
                                disabled={isSaving}
                              >
                                {isSaving
                                  ? <ActivityIndicator color="#fff" size="small" />
                                  : <Text style={styles.saveBtnTxt}>💾 Enregistrer & marquer corrigé</Text>
                                }
                              </TouchableOpacity>
                            </View>
                          )}

                          {/* ── Photos ── */}
                          {corr.section === 'photos' && (
                            <View>
                              <View style={styles.infoBox}>
                                <Text style={styles.infoTxt}>
                                  📷 Pour corriger les photos, retournez dans la section correspondante (Ventes, Shift…) et re-uploadez les photos manquantes ou incorrectes.
                                </Text>
                                <Text style={[styles.infoTxt, { marginTop: 8 }]}>
                                  Une fois les photos mises à jour, appuyez sur le bouton ci-dessous.
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[styles.saveBtn, { backgroundColor: '#534AB7' }, isSaving && { opacity: 0.6 }]}
                                onPress={() => marquerSansEdit(corr.id, corr.point_id, corr.section)}
                                disabled={isSaving}
                              >
                                {isSaving
                                  ? <ActivityIndicator color="#fff" size="small" />
                                  : <Text style={styles.saveBtnTxt}>✅ Photos corrigées — marquer comme corrigé</Text>
                                }
                              </TouchableOpacity>
                            </View>
                          )}

                          {/* ── Inventaire ── */}
                          {corr.section === 'inventaire' && (
                            <View>
                              <View style={styles.infoBox}>
                                <Text style={styles.infoTxt}>
                                  📦 Pour corriger l'inventaire, rendez-vous dans la section <Text style={{ fontWeight: '700' }}>Inventaire</Text> et apportez les corrections nécessaires.
                                </Text>
                                <Text style={[styles.infoTxt, { marginTop: 8 }]}>
                                  Une fois l'inventaire corrigé, appuyez sur le bouton ci-dessous.
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[styles.saveBtn, { backgroundColor: '#3B6D11' }, isSaving && { opacity: 0.6 }]}
                                onPress={() => marquerSansEdit(corr.id, corr.point_id, corr.section)}
                                disabled={isSaving}
                              >
                                {isSaving
                                  ? <ActivityIndicator color="#fff" size="small" />
                                  : <Text style={styles.saveBtnTxt}>✅ Inventaire corrigé — marquer comme corrigé</Text>
                                }
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            )
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#854F0B', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  back: { fontSize: 16, color: '#FAEEDA', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff' },
  headerSub: { fontSize: 11, color: '#FAEEDA', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  emptyTitre: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 6 },
  emptySub: { fontSize: 12, color: colors.textMuted },
  infoBanner: { backgroundColor: '#FAEEDA', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27' },
  infoBannerTxt: { fontSize: 13, color: '#854F0B', lineHeight: 19 },
  pointGroup: { marginBottom: 20 },
  pointGroupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pointGroupDate: { fontSize: 15, fontWeight: '700', color: colors.text },
  corrBadge: { backgroundColor: '#FAEEDA', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  corrBadgeTxt: { fontSize: 11, fontWeight: '600', color: '#854F0B' },
  corrCard: {
    backgroundColor: colors.surface, borderRadius: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: colors.border, overflow: 'hidden',
  },
  corrCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  sectionIconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  motifTxt: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', lineHeight: 17 },
  chevron: { fontSize: 10, color: colors.textMuted, width: 16, textAlign: 'center' },
  corrForm: { padding: 14, paddingTop: 0, borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 0 },
  formHint: { fontSize: 11, color: colors.textMuted, marginBottom: 12, marginTop: 10, fontStyle: 'italic' },
  formRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  formLabel: { fontSize: 13, color: colors.text, flex: 1 },
  formInput: {
    backgroundColor: colors.bg, borderRadius: 10, padding: 10,
    fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border,
    width: 120, textAlign: 'right',
  },
  txRow: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  txNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 },
  txInputsRow: { flexDirection: 'row', gap: 10 },
  txInputGroup: { flex: 1 },
  txInputLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  txInput: {
    backgroundColor: colors.bg, borderRadius: 10, padding: 10,
    fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border, textAlign: 'right',
  },
  noDataTxt: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginVertical: 10 },
  infoBox: { backgroundColor: colors.bg, borderRadius: 10, padding: 14, marginVertical: 10, borderWidth: 1, borderColor: colors.border },
  infoTxt: { fontSize: 13, color: colors.text, lineHeight: 19 },
  saveBtn: { backgroundColor: '#854F0B', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 14 },
  saveBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
}) }
