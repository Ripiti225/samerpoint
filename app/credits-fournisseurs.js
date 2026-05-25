/*
 * SQL: Tables already exist (créées par le fichier d'origine).
 * Statut automatique : credit_actuel >= 0 → Fournisseur / credit_actuel < 0 → Cotisation
 * Champ "type" supprimé — plus de sélection manuelle.
 *
 * Optionnel pour enrichir l'historique :
 *   ALTER TABLE historique_credit_fournisseurs ADD COLUMN IF NOT EXISTS montant NUMERIC
 *     GENERATED ALWAYS AS (nouveau_credit - ancien_credit) STORED;
 */

import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, Modal, Platform,
  SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import * as XLSX from 'xlsx'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import { supabase } from '../lib/supabase'

let _restoFilterCache = null

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }
function fmtShort(n) { return Math.round(n || 0).toLocaleString('fr-FR') }
function fmtDate(dateStr) {
  if (!dateStr) return ''
  const parts = dateStr.split('T')[0].split('-')
  if (parts.length < 3) return dateStr
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(parts[2])} ${mois[parseInt(parts[1]) - 1]}`
}

export default function CreditsFournisseursScreen() {
  const { roleActif, restaurantId, restaurantNom, userId } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const isGerant = roleActif === 'gerant'
  const peutModifier = roleActif === 'manager' || roleActif === 'directeur'

  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(() => _restoFilterCache)
  const [showRestoPicker, setShowRestoPicker] = useState(false)
  const [fournisseurs, setFournisseurs] = useState([])
  const [loading, setLoading] = useState(true)

  const [selectedFourn, setSelectedFourn] = useState(null)
  const [showEditCredit, setShowEditCredit] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [showHistorique, setShowHistorique] = useState(false)
  const [fournHisto, setFournHisto] = useState(null)
  const [histoMouvements, setHistoMouvements] = useState([])
  const [loadingHisto, setLoadingHisto] = useState(false)
  const [modalPhotoUri, setModalPhotoUri] = useState(null)

  const today = new Date().toISOString().split('T')[0]
  const [formCredit, setFormCredit] = useState({ montant: '', motif: '' })
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const [exportFilters, setExportFilters] = useState({ dateDebut: firstOfMonth, dateFin: today, restoId: null, fournId: null })

  function selectResto(id) {
    _restoFilterCache = id
    setRestoFilter(id)
  }

  useEffect(() => {
    if (roleActif === 'caissier' || roleActif === 'rh') {
      router.replace('/accueil')
    }
  }, [roleActif])

  useEffect(() => { charger() }, [restaurantId, restoFilter])

  async function charger() {
    setLoading(true)
    try {
      let restos = []
      if (peutModifier) {
        const { data } = await supabase.from('restaurants').select('id, nom').order('nom')
        restos = data || []
        setRestaurants(restos)
      }
      const restoMap = {}
      restos.forEach(r => { restoMap[r.id] = r.nom })
      if (isGerant) restoMap[restaurantId] = restaurantNom || ''

      let query = supabase.from('fournisseurs')
        .select('id, nom, credit_actuel, restaurant_id')
        .eq('actif', true)
      if (isGerant) query = query.eq('restaurant_id', restaurantId)
      else if (restoFilter) query = query.eq('restaurant_id', restoFilter)
      query = query.order('nom')
      const { data: fourn } = await query
      setFournisseurs((fourn || []).map(f => ({ ...f, restaurant_nom: restoMap[f.restaurant_id] || '' })))
    } catch {}
    setLoading(false)
  }

  // ── Modifier le crédit (delta +/-) ──────────────────────────────────────
  async function modifierCredit() {
    if (!selectedFourn) return
    const delta = parseFloat(formCredit.montant)
    if (isNaN(delta) || delta === 0) {
      Alert.alert('Montant invalide', 'Entrez un montant positif ou négatif (ex: +50000 ou -10000).')
      return
    }
    const ancienCredit = selectedFourn.credit_actuel || 0
    const nouveauCredit = ancienCredit + delta
    setSaving(true)
    try {
      await supabase.from('historique_credit_fournisseurs').insert({
        fournisseur_id: selectedFourn.id,
        restaurant_id: selectedFourn.restaurant_id,
        ancien_credit: ancienCredit,
        nouveau_credit: nouveauCredit,
        motif: formCredit.motif || null,
        modified_by: userId || null,
      }).then(() => {}, () => {})

      const { data: updated, error } = await supabase.from('fournisseurs')
        .update({ credit_actuel: nouveauCredit }).eq('id', selectedFourn.id).select('id')
      if (error) throw error
      if (!updated?.length) throw new Error('Modification refusée (droits insuffisants)')

      journaliser('modif_credit_fournisseur', {
        fournisseur: selectedFourn.nom, delta, ancien: ancienCredit, nouveau: nouveauCredit,
      }, { restaurantId: selectedFourn.restaurant_id, userId }).catch(() => {})

      setShowEditCredit(false)
      setFormCredit({ montant: '', motif: '' })
      await charger()
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Impossible de modifier le crédit')
    }
    setSaving(false)
  }

  // ── Historique d'un fournisseur ──────────────────────────────────────────
  async function chargerHistorique(f) {
    setFournHisto(f)
    setHistoMouvements([])
    setLoadingHisto(true)
    setShowHistorique(true)
    const { data } = await supabase
      .from('transactions_fournisseurs')
      .select('*')
      .eq('fournisseur_id', f.id)
      .order('created_at', { ascending: false })
    const mouvements = data || []
    setHistoMouvements(mouvements)
    // Sync credit_actuel si désynchronisé avec la transaction la plus récente
    if (mouvements.length > 0 && mouvements[0].reste != null) {
      const resteReel = mouvements[0].reste
      if (resteReel !== f.credit_actuel) {
        await supabase.from('fournisseurs').update({ credit_actuel: resteReel }).eq('id', f.id)
        setFournisseurs(prev => prev.map(item => item.id === f.id ? { ...item, credit_actuel: resteReel } : item))
        setFournHisto(prev => prev ? { ...prev, credit_actuel: resteReel } : prev)
      }
    }
    setLoadingHisto(false)
  }

  // ── Données export ───────────────────────────────────────────────────────
  async function fetchExportData() {
    const { dateDebut, dateFin, restoId, fournId } = exportFilters
    const restoMap = {}
    restaurants.forEach(r => { restoMap[r.id] = r.nom })
    if (isGerant) restoMap[restaurantId] = restaurantNom || ''

    const fourn = fournisseurs.filter(f =>
      (!restoId || f.restaurant_id === restoId) && (!fournId || f.id === fournId)
    )

    let histQuery = supabase.from('historique_credit_fournisseurs')
      .select('fournisseur_id, ancien_credit, nouveau_credit, motif, modified_at')
      .gte('modified_at', dateDebut)
      .lte('modified_at', dateFin + 'T23:59:59')
    if (restoId) histQuery = histQuery.eq('restaurant_id', restoId)
    if (fournId) histQuery = histQuery.eq('fournisseur_id', fournId)
    histQuery = histQuery.order('modified_at', { ascending: false })
    const { data: mouvements } = await histQuery

    return { fourn, mouvements: mouvements || [], restoMap }
  }

  // ── Export PDF ───────────────────────────────────────────────────────────
  async function exporterPdf() {
    setExporting(true)
    try {
      const { fourn, mouvements, restoMap } = await fetchExportData()
      const { dateDebut, dateFin, restoId } = exportFilters
      const fournList = fourn.filter(f => (f.credit_actuel || 0) >= 0)
      const cotisList = fourn.filter(f => (f.credit_actuel || 0) < 0)
      const totalDu = fournList.reduce((s, f) => s + (f.credit_actuel || 0), 0)
      const totalAvances = cotisList.reduce((s, f) => s + Math.abs(f.credit_actuel || 0), 0)
      const fournMap = {}
      fourn.forEach(f => { fournMap[f.id] = f })

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;margin:24px}
h1{font-size:18px;color:#EF9F27;margin-bottom:4px}h2{font-size:13px;margin:16px 0 8px;padding:6px 10px;border-radius:6px}
.sub{color:#666;font-size:10px;margin-bottom:14px}
.kpis{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.kpi{background:#f9f9f9;border:0.5px solid #ddd;border-radius:8px;padding:10px 14px;min-width:110px}
.kl{font-size:9px;color:#888}.kv{font-size:15px;font-weight:700}
table{width:100%;border-collapse:collapse;margin-bottom:14px}
th{background:#EF9F27;color:#412402;padding:7px 6px;text-align:left;font-size:10px}
td{padding:6px;border-bottom:0.5px solid #eee;font-size:10px}
.tot{background:#FFF3CD;font-weight:700}
.rouge{color:#A32D2D;font-weight:700}.vert{color:#3B6D11;font-weight:700}
.ft{font-size:9px;color:#aaa;text-align:center;margin-top:20px}
</style></head><body>
<h1>📋 Fournisseurs &amp; Cotisations</h1>
<div class="sub">Période : ${fmtDate(dateDebut)} → ${fmtDate(dateFin)}${restoId ? ' · ' + (restoMap[restoId] || '') : ''}</div>
<div class="kpis">
  <div class="kpi"><div class="kl">Total dû</div><div class="kv rouge">${fmt(totalDu)}</div></div>
  <div class="kpi"><div class="kl">Avances reçues</div><div class="kv vert">${fmt(totalAvances)}</div></div>
  <div class="kpi"><div class="kl">Fournisseurs actifs</div><div class="kv">${fourn.length}</div></div>
</div>
<h2 style="background:#FDE8E8;color:#A32D2D">🔴 FOURNISSEURS (crédit &gt;= 0)</h2>
<table><thead><tr><th>Fournisseur</th><th>Restaurant</th><th>Crédit dû</th><th>Statut</th></tr></thead><tbody>
${fournList.length === 0 ? '<tr><td colspan="4" style="color:#999">Aucun</td></tr>' : fournList.map(f =>
  `<tr><td><strong>${f.nom}</strong></td><td>${f.restaurant_nom || ''}</td><td class="rouge">${fmt(f.credit_actuel || 0)}</td><td>${(f.credit_actuel || 0) === 0 ? '✅ Soldé' : '🔴 Doit'}</td></tr>`
).join('')}
${fournList.length > 0 ? `<tr class="tot"><td colspan="2">Total</td><td class="rouge">${fmt(totalDu)}</td><td></td></tr>` : ''}
</tbody></table>
<h2 style="background:#E6F9EE;color:#3B6D11">🟢 COTISATIONS (crédit &lt; 0)</h2>
<table><thead><tr><th>Fournisseur</th><th>Restaurant</th><th>Avance reçue</th><th>Statut</th></tr></thead><tbody>
${cotisList.length === 0 ? '<tr><td colspan="4" style="color:#999">Aucune</td></tr>' : cotisList.map(f =>
  `<tr><td><strong>${f.nom}</strong></td><td>${f.restaurant_nom || ''}</td><td class="vert">${fmt(Math.abs(f.credit_actuel || 0))}</td><td>🟢 Avance</td></tr>`
).join('')}
${cotisList.length > 0 ? `<tr class="tot"><td colspan="2">Total</td><td class="vert">${fmt(totalAvances)}</td><td></td></tr>` : ''}
</tbody></table>
${mouvements.length > 0 ? `
<h2 style="background:#f0f0f8;color:#534AB7">📋 Mouvements de la période</h2>
<table><thead><tr><th>Date</th><th>Fournisseur</th><th>Mouvement</th><th>Solde</th><th>Motif</th></tr></thead><tbody>
${mouvements.map(m => {
  const delta = (m.nouveau_credit || 0) - (m.ancien_credit || 0)
  const f = fournMap[m.fournisseur_id]
  return `<tr>
    <td>${fmtDate(m.modified_at)}</td>
    <td>${f?.nom || '—'}</td>
    <td class="${delta > 0 ? 'rouge' : 'vert'}">${delta > 0 ? '+' : ''}${fmtShort(delta)}</td>
    <td style="font-weight:600;color:${(m.nouveau_credit || 0) >= 0 ? '#A32D2D' : '#3B6D11'}">${fmtShort(m.nouveau_credit || 0)}</td>
    <td style="color:#666">${m.motif || '—'}</td>
  </tr>`
}).join('')}
</tbody></table>` : ''}
<div class="ft">Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — SamerPoint</div>
</body></html>`

      if (Platform.OS === 'web') {
        await Print.printAsync({ html })
      } else {
        const { uri } = await Print.printToFileAsync({ html })
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Rapport fournisseurs' })
        }
      }
      setShowExportModal(false)
    } catch {
      Alert.alert('Erreur', 'Impossible de générer le PDF')
    }
    setExporting(false)
  }

  // ── Export Excel ─────────────────────────────────────────────────────────
  async function exporterExcel() {
    setExporting(true)
    try {
      const { fourn, mouvements } = await fetchExportData()
      const { dateDebut, dateFin } = exportFilters
      const fournMap = {}
      fourn.forEach(f => { fournMap[f.id] = f })

      const fournList = fourn.filter(f => (f.credit_actuel || 0) >= 0)
      const cotisList = fourn.filter(f => (f.credit_actuel || 0) < 0)

      const sheetFourn = [
        ['Fournisseur', 'Restaurant', 'Crédit dû', 'Statut'],
        ...fournList.map(f => [f.nom, f.restaurant_nom, f.credit_actuel || 0, (f.credit_actuel || 0) === 0 ? 'Soldé' : 'Doit']),
        ['', '', '', ''],
        ['TOTAL', '', fournList.reduce((s, f) => s + (f.credit_actuel || 0), 0), ''],
      ]
      const sheetCotis = [
        ['Fournisseur', 'Restaurant', 'Avance reçue', 'Statut'],
        ...cotisList.map(f => [f.nom, f.restaurant_nom, Math.abs(f.credit_actuel || 0), 'Avance']),
        ['', '', '', ''],
        ['TOTAL', '', cotisList.reduce((s, f) => s + Math.abs(f.credit_actuel || 0), 0), ''],
      ]
      const sheetMouv = [
        ['Date', 'Fournisseur', 'Restaurant', 'Mouvement', 'Solde après', 'Motif'],
        ...mouvements.map(m => {
          const delta = (m.nouveau_credit || 0) - (m.ancien_credit || 0)
          const f = fournMap[m.fournisseur_id]
          return [
            m.modified_at?.split('T')[0] || '',
            f?.nom || '—',
            f?.restaurant_nom || '',
            delta,
            m.nouveau_credit || 0,
            m.motif || '',
          ]
        }),
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetFourn), 'Fournisseurs')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetCotis), 'Cotisations')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetMouv), 'Mouvements')

      const filename = `fournisseurs-credits-${dateDebut}-${dateFin}.xlsx`
      if (Platform.OS === 'web') {
        XLSX.writeFile(wb, filename)
      } else {
        const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
        const fileUri = (FileSystem.documentDirectory || FileSystem.cacheDirectory || '') + filename
        await FileSystem.writeAsStringAsync(fileUri, wbout, { encoding: FileSystem.EncodingType.Base64 })
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Rapport fournisseurs',
            UTI: 'com.microsoft.excel.xlsx',
          })
        }
      }
      setShowExportModal(false)
    } catch (err) {
      Alert.alert('Erreur', err?.message || "Impossible de générer l'export Excel")
    }
    setExporting(false)
  }

  // ── Carte fournisseur ────────────────────────────────────────────────────
  function renderCard(f) {
    const credit = f.credit_actuel || 0
    const isCotisation = credit < 0
    const isSolde = credit === 0

    return (
      <View key={f.id} style={[
        styles.card,
        isCotisation && styles.cardCotis,
        !isCotisation && !isSolde && styles.cardDue,
      ]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardNom}>{f.nom}</Text>
            {peutModifier && f.restaurant_nom ? (
              <Text style={styles.cardResto}>{f.restaurant_nom}</Text>
            ) : null}
          </View>
          {isCotisation && (
            <View style={[styles.badge, styles.badgeCotis]}>
              <Text style={styles.badgeCotisTxt}>🟢 Avance</Text>
            </View>
          )}
          {isSolde && (
            <View style={[styles.badge, styles.badgeSolde]}>
              <Text style={styles.badgeSoldeTxt}>✅ Soldé</Text>
            </View>
          )}
          {!isCotisation && !isSolde && (
            <View style={[styles.badge, styles.badgeDue]}>
              <Text style={styles.badgeDueTxt}>🔴 Doit</Text>
            </View>
          )}
        </View>

        <View style={styles.creditBox}>
          {isCotisation ? (
            <>
              <Text style={styles.creditLabel}>Avance reçue</Text>
              <Text style={[styles.creditVal, { color: '#3B6D11' }]}>{fmt(Math.abs(credit))}</Text>
            </>
          ) : (
            <>
              <Text style={styles.creditLabel}>{isSolde ? 'Crédit' : 'Crédit dû'}</Text>
              <Text style={[styles.creditVal, { color: isSolde ? colors.textMuted : '#A32D2D' }]}>{fmt(credit)}</Text>
            </>
          )}
        </View>

        {peutModifier && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              setSelectedFourn(f)
              setFormCredit({ montant: '', motif: '' })
              setShowEditCredit(true)
            }}
          >
            <Text style={styles.actionBtnTxt}>✏️ Modifier le crédit</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.histoBtn} onPress={() => chargerHistorique(f)}>
          <Text style={styles.histoBtnTxt}>📋 Voir l'historique</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
            <Text style={styles.back}>‹ Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>Fournisseurs & Cotisations</Text>
          <View style={{ width: 80 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
        </View>
      </SafeAreaView>
    )
  }

  const fournList = fournisseurs.filter(f => (f.credit_actuel || 0) >= 0)
  const cotisList = fournisseurs.filter(f => (f.credit_actuel || 0) < 0)
  const totalDu = fournList.reduce((s, f) => s + (f.credit_actuel || 0), 0)
  const totalAvances = cotisList.reduce((s, f) => s + Math.abs(f.credit_actuel || 0), 0)

  // Aperçu en temps réel dans le formulaire
  if (roleActif === 'caissier' || roleActif === 'rh') return null

  const deltaPreview = parseFloat(formCredit.montant)
  const nouveauPreview = selectedFourn ? (selectedFourn.credit_actuel || 0) + (isNaN(deltaPreview) ? 0 : deltaPreview) : 0
  const showPreview = selectedFourn && !isNaN(deltaPreview) && deltaPreview !== 0

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitre}>Fournisseurs & Cotisations</Text>
          <Text style={styles.headerSub}>Statut automatique selon solde</Text>
        </View>
        <View style={{ width: 80, alignItems: 'flex-end' }}>
          {peutModifier && (
            <TouchableOpacity style={styles.exportBtn} onPress={() => {
              setExportFilters(p => ({ ...p, restoId: restoFilter, fournId: null }))
              setShowExportModal(true)
            }}>
              <Text style={styles.exportBtnTxt}>📄 Export</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* KPIs */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>Total dû</Text>
          <Text style={[styles.kpiVal, { color: '#A32D2D' }]}>{fmt(totalDu)}</Text>
        </View>
        <View style={[styles.kpiBox, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
          <Text style={styles.kpiLabel}>Avances reçues</Text>
          <Text style={[styles.kpiVal, { color: '#3B6D11' }]}>{fmt(totalAvances)}</Text>
        </View>
        <View style={[styles.kpiBox, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
          <Text style={styles.kpiLabel}>Total actifs</Text>
          <Text style={styles.kpiVal}>{fournisseurs.length}</Text>
        </View>
      </View>

      {/* Sélecteur restaurant */}
      {peutModifier && restaurants.length > 0 && (
        <TouchableOpacity style={styles.restoSelector} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoSelectorIcon}>🏪</Text>
          <Text style={styles.restoSelectorTxt} numberOfLines={1}>
            {restoFilter ? (restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant') : 'Tous les restaurants'}
          </Text>
          <Text style={styles.restoSelectorArrow}>▾</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* ─── Section Fournisseurs ─── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitre}>🔴 FOURNISSEURS</Text>
          <Text style={styles.sectionSub}>{fournList.length} · {fmt(totalDu)}</Text>
        </View>
        {fournList.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionTxt}>Aucun fournisseur</Text>
          </View>
        ) : (
          fournList.map(f => renderCard(f))
        )}

        {/* ─── Section Cotisations ─── */}
        <View style={[styles.sectionHeader, { marginTop: 10 }]}>
          <Text style={[styles.sectionTitre, { color: '#3B6D11' }]}>🟢 COTISATIONS</Text>
          <Text style={styles.sectionSub}>{cotisList.length} · {fmt(totalAvances)}</Text>
        </View>
        {cotisList.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionTxt}>Aucune cotisation</Text>
          </View>
        ) : (
          cotisList.map(f => renderCard(f))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Modal : Historique ── */}
      <Modal visible={showHistorique} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={[styles.modalHeader, { backgroundColor: '#1a1a2e' }]}>
            <TouchableOpacity onPress={() => setShowHistorique(false)}>
              <Text style={styles.modalClose}>Fermer</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.modalTitre}>📋 Historique</Text>
              {fournHisto && <Text style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{fournHisto.nom}</Text>}
            </View>
            <View style={{ width: 60 }} />
          </View>

          {loadingHisto ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#EF9F27" />
            </View>
          ) : (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {fournHisto && (
                <View style={styles.histoKpiRow}>
                  <View style={styles.histoKpi}>
                    <Text style={styles.histoKpiLabel}>Solde actuel</Text>
                    <Text style={[styles.histoKpiVal, {
                      color: (fournHisto.credit_actuel || 0) < 0 ? '#3B6D11' : '#A32D2D'
                    }]}>
                      {(fournHisto.credit_actuel || 0) < 0
                        ? fmt(Math.abs(fournHisto.credit_actuel || 0))
                        : fmt(fournHisto.credit_actuel || 0)}
                    </Text>
                    <Text style={[styles.histoKpiLabel, { marginTop: 2 }]}>
                      {(fournHisto.credit_actuel || 0) < 0 ? '🟢 Avance reçue' : (fournHisto.credit_actuel || 0) === 0 ? '✅ Soldé' : '🔴 Doit'}
                    </Text>
                  </View>
                  <View style={[styles.histoKpi, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
                    <Text style={styles.histoKpiLabel}>Mouvements</Text>
                    <Text style={styles.histoKpiVal}>{histoMouvements.length}</Text>
                  </View>
                </View>
              )}

              <Text style={styles.histoSection}>📈 Mouvements ({histoMouvements.length})</Text>

              {histoMouvements.length === 0 ? (
                <View style={styles.histoEmpty}>
                  <Text style={styles.histoEmptyTxt}>Aucun mouvement enregistré</Text>
                  <Text style={[styles.histoEmptyTxt, { fontSize: 11, marginTop: 4 }]}>
                    Les modifications de crédit apparaîtront ici
                  </Text>
                </View>
              ) : histoMouvements.map((m) => {
                const src = m.source || m.saisi_par || 'manuel'
                const sourceInfo = {
                  caissier: { icon: '💼', label: 'Caissier', bg: '#E6F1FB', txt: '#185FA5' },
                  gerant: { icon: '📊', label: 'Saisir Ventes', bg: '#EAF3DE', txt: '#3B6D11' },
                  gerant_caissier: { icon: '🔑', label: 'Gérant Caissier', bg: '#FAEEDA', txt: '#854F0B' },
                  deduction_gerant: { icon: '📋', label: 'Déduction Gérant', bg: '#FAEEDA', txt: '#854F0B' },
                  manuel: { icon: '✏️', label: 'Manuel', bg: '#f0f0f0', txt: '#888' },
                }[src] || { icon: '✏️', label: src, bg: '#f0f0f0', txt: '#888' }
                const facture = Number(m.facture) || 0
                const paye = Number(m.paye) || 0
                const solde = m.reste || 0

                return (
                  <View key={m.id} style={styles.histoMvtCard}>
                    <View style={styles.histoMvtHeader}>
                      <Text style={styles.histoMvtDate}>📅 {fmtDate(m.created_at)}</Text>
                      <View style={[styles.histoMvtBadge, { backgroundColor: sourceInfo.bg }]}>
                        <Text style={[styles.histoMvtBadgeTxt, { color: sourceInfo.txt }]}>{sourceInfo.icon} {sourceInfo.label}</Text>
                      </View>
                    </View>

                    {m.caissier_nom && (
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>👤 {m.caissier_nom}</Text>
                    )}

                    <View style={styles.histoMvtChiffres}>
                      <View style={styles.histoMvtChiffreItem}>
                        <Text style={styles.histoMvtChiffreLabel}>📦 Reçu (facture)</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: colors.text }]}>
                          {facture > 0 ? fmtShort(facture) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.histoMvtChiffreItem, styles.histoMvtChiffreSep]}>
                        <Text style={styles.histoMvtChiffreLabel}>💳 Payé</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: paye > 0 ? '#3B6D11' : colors.textMuted }]}>
                          {paye > 0 ? fmtShort(paye) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.histoMvtChiffreItem, styles.histoMvtChiffreSep]}>
                        <Text style={styles.histoMvtChiffreLabel}>⚠️ Reste dû</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: solde > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '700' }]}>
                          {fmtShort(solde)}
                        </Text>
                      </View>
                    </View>

                    {m.photo_url && (
                      <TouchableOpacity style={styles.histoMvtPhoto} onPress={() => setModalPhotoUri(m.photo_url)}>
                        <Image source={{ uri: m.photo_url }} style={styles.histoMvtPhotoThumb} resizeMode="cover" />
                        <Text style={styles.histoMvtPhotoTxt}>📷 Voir la facture</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )
              })}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Modal : Sélecteur restaurant ── */}
      <Modal visible={showRestoPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowRestoPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerBox} onPress={() => {}}>
            <Text style={styles.pickerTitre}>Filtrer par restaurant</Text>
            <TouchableOpacity
              style={[styles.pickerRow, !restoFilter && styles.pickerRowActive]}
              onPress={() => { selectResto(null); setShowRestoPicker(false) }}
            >
              <Text style={[styles.pickerRowTxt, !restoFilter && styles.pickerRowTxtActive]}>🏪 Tous les restaurants</Text>
              {!restoFilter && <Text style={styles.pickerCheck}>✓</Text>}
            </TouchableOpacity>
            {restaurants.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[styles.pickerRow, restoFilter === r.id && styles.pickerRowActive]}
                onPress={() => { selectResto(r.id); setShowRestoPicker(false) }}
              >
                <Text style={[styles.pickerRowTxt, restoFilter === r.id && styles.pickerRowTxtActive]} numberOfLines={1}>{r.nom}</Text>
                {restoFilter === r.id && <Text style={styles.pickerCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal : Modifier le crédit ── */}
      <Modal visible={showEditCredit} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={[styles.modalHeader, { backgroundColor: '#185FA5' }]}>
            <TouchableOpacity onPress={() => setShowEditCredit(false)}>
              <Text style={[styles.modalClose, { color: '#A8D4F5' }]}>Annuler</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitre}>✏️ Modifier le crédit</Text>
            <TouchableOpacity onPress={modifierCredit} disabled={saving}>
              <Text style={[styles.modalClose, saving && { opacity: 0.4 }]}>{saving ? '...' : 'Enregistrer'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {selectedFourn && (
              <View style={styles.fournInfo}>
                <Text style={styles.fournInfoNom}>{selectedFourn.nom}</Text>
                <Text style={styles.fournInfoSub}>
                  Solde actuel : {(selectedFourn.credit_actuel || 0) < 0
                    ? `🟢 ${fmt(Math.abs(selectedFourn.credit_actuel || 0))} avance reçue`
                    : (selectedFourn.credit_actuel || 0) === 0
                    ? '✅ Soldé (0 FCFA)'
                    : `🔴 ${fmt(selectedFourn.credit_actuel || 0)} dû`}
                </Text>
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Montant (+ ou -) *</Text>
              <TextInput
                style={[styles.formInput, { fontSize: 20, textAlign: 'center', fontWeight: '700' }]}
                value={formCredit.montant}
                onChangeText={v => setFormCredit(p => ({ ...p, montant: v }))}
                keyboardType="numbers-and-punctuation"
                placeholder="+50 000 ou -10 000"
                placeholderTextColor="#bbb"
              />
            </View>

            <View style={styles.examplesBox}>
              <Text style={styles.examplesTitre}>Exemples :</Text>
              <Text style={styles.examplesLine}>+50 000 → nouvelle facture reçue</Text>
              <Text style={styles.examplesLine}>-10 000 → paiement effectué / avance reçue</Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Motif (optionnel)</Text>
              <TextInput
                style={[styles.formInput, { minHeight: 60 }]}
                value={formCredit.motif}
                onChangeText={v => setFormCredit(p => ({ ...p, motif: v }))}
                placeholder="Ex: Facture semaine 20"
                placeholderTextColor="#bbb"
                multiline
              />
            </View>

            {showPreview && (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>Aperçu après modification :</Text>
                <Text style={styles.previewCalc}>
                  {fmtShort(selectedFourn.credit_actuel || 0)} {deltaPreview >= 0 ? '+' : '−'} {fmtShort(Math.abs(deltaPreview))} = {fmtShort(nouveauPreview)} FCFA
                </Text>
                <Text style={[styles.previewStatut, {
                  color: nouveauPreview < 0 ? '#3B6D11' : nouveauPreview === 0 ? colors.textMuted : '#A32D2D'
                }]}>
                  → {nouveauPreview < 0 ? '🟢 Cotisation (avance reçue)' : nouveauPreview === 0 ? '✅ Soldé' : '🔴 Fournisseur (doit)'}
                </Text>
              </View>
            )}

            <View style={styles.traceNote}>
              <Text style={styles.traceNoteTxt}>📝 Toutes les modifications sont tracées dans l'historique avec votre nom et la date.</Text>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: '#185FA5' }, saving && { opacity: 0.6 }]}
              onPress={modifierCredit}
              disabled={saving}
            >
              <Text style={styles.saveBtnTxt}>{saving ? 'Enregistrement...' : '💾 Enregistrer la modification'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal : Export ── */}
      <Modal visible={showExportModal} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={[styles.modalHeader, { backgroundColor: '#534AB7' }]}>
            <TouchableOpacity onPress={() => setShowExportModal(false)}>
              <Text style={[styles.modalClose, { color: '#CECBF6' }]}>Fermer</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitre}>📊 Exporter un rapport</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.exportSection}>Période</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Date début</Text>
                <TextInput
                  style={styles.formInput}
                  value={exportFilters.dateDebut}
                  onChangeText={v => setExportFilters(p => ({ ...p, dateDebut: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#bbb"
                />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Date fin</Text>
                <TextInput
                  style={styles.formInput}
                  value={exportFilters.dateFin}
                  onChangeText={v => setExportFilters(p => ({ ...p, dateFin: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#bbb"
                />
              </View>
            </View>

            {peutModifier && restaurants.length > 0 && (
              <>
                <Text style={styles.exportSection}>Restaurant</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                  <TouchableOpacity
                    style={[styles.filterPill, !exportFilters.restoId && styles.filterPillActive]}
                    onPress={() => setExportFilters(p => ({ ...p, restoId: null, fournId: null }))}
                  >
                    <Text style={[styles.filterTxt, !exportFilters.restoId && styles.filterTxtActive]}>Tous</Text>
                  </TouchableOpacity>
                  {restaurants.map(r => (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.filterPill, exportFilters.restoId === r.id && styles.filterPillActive]}
                      onPress={() => setExportFilters(p => ({ ...p, restoId: r.id, fournId: null }))}
                    >
                      <Text style={[styles.filterTxt, exportFilters.restoId === r.id && styles.filterTxtActive]}>{r.nom}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={styles.exportSection}>Fournisseur</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
              <TouchableOpacity
                style={[styles.filterPill, !exportFilters.fournId && styles.filterPillActive]}
                onPress={() => setExportFilters(p => ({ ...p, fournId: null }))}
              >
                <Text style={[styles.filterTxt, !exportFilters.fournId && styles.filterTxtActive]}>Tous</Text>
              </TouchableOpacity>
              {fournisseurs
                .filter(f => !exportFilters.restoId || f.restaurant_id === exportFilters.restoId)
                .map(f => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.filterPill, exportFilters.fournId === f.id && styles.filterPillActive]}
                    onPress={() => setExportFilters(p => ({ ...p, fournId: f.id }))}
                  >
                    <Text style={[styles.filterTxt, exportFilters.fournId === f.id && styles.filterTxtActive]}>{f.nom}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: '#A32D2D' }, exporting && { opacity: 0.6 }]}
                onPress={exporterPdf}
                disabled={exporting}
              >
                <Text style={styles.saveBtnTxt}>{exporting ? 'Génération...' : '📄 PDF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: '#2D7A3B' }, exporting && { opacity: 0.6 }]}
                onPress={exporterExcel}
                disabled={exporting}
              >
                <Text style={styles.saveBtnTxt}>{exporting ? 'Génération...' : '📊 Excel'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal photo facture ── */}
      <Modal visible={!!modalPhotoUri} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity
            style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }}
            onPress={() => setModalPhotoUri(null)}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Text style={{ fontSize: 30, color: '#fff', fontWeight: '300' }}>✕</Text>
          </TouchableOpacity>
          {modalPhotoUri && (
            <Image
              source={{ uri: modalPhotoUri }}
              style={{ width: '92%', height: '70%' }}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={{ marginTop: 20, backgroundColor: '#534AB7', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 12 }}
            onPress={() => setModalPhotoUri(null)}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: '#EF9F27', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 15, fontWeight: '600', color: '#412402' },
  headerSub: { fontSize: 10, color: '#854F0B', textAlign: 'center' },
  exportBtn: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  exportBtnTxt: { fontSize: 11, color: '#FAEEDA', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  kpiBox: { flex: 1, alignItems: 'center' },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  kpiVal: { fontSize: 15, fontWeight: '800', color: colors.text },
  restoSelector: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  restoSelectorIcon: { fontSize: 16 },
  restoSelectorTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  restoSelectorArrow: { fontSize: 12, color: colors.textMuted },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  pickerBox: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 32 },
  pickerTitre: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  pickerRowActive: { backgroundColor: '#FFF8ED' },
  pickerRowTxt: { flex: 1, fontSize: 15, color: colors.text },
  pickerRowTxtActive: { color: '#EF9F27', fontWeight: '600' },
  pickerCheck: { fontSize: 16, color: '#EF9F27', fontWeight: '700' },
  body: { flex: 1, padding: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitre: { fontSize: 12, fontWeight: '700', color: '#A32D2D', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionSub: { fontSize: 11, color: colors.textMuted },
  emptySection: { alignItems: 'center', paddingVertical: 14, backgroundColor: colors.surface, borderRadius: 10, marginBottom: 12, borderWidth: 0.5, borderColor: colors.border },
  emptySectionTxt: { fontSize: 13, color: colors.textPlaceholder },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  cardDue: { borderColor: '#F09595' },
  cardCotis: { borderColor: '#C0DD97', backgroundColor: '#F4FAF0' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardNom: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardResto: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeDue: { backgroundColor: '#FDE8E8' },
  badgeDueTxt: { fontSize: 10, color: '#A32D2D', fontWeight: '600' },
  badgeCotis: { backgroundColor: '#E6F9EE' },
  badgeCotisTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '600' },
  badgeSolde: { backgroundColor: '#EBEBF0' },
  badgeSoldeTxt: { fontSize: 10, color: '#555', fontWeight: '500' },
  creditBox: { alignItems: 'center', backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 10 },
  creditLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  creditVal: { fontSize: 20, fontWeight: '800' },
  actionBtn: { backgroundColor: '#E6F1FB', borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 6 },
  actionBtnTxt: { fontSize: 12, fontWeight: '600', color: '#185FA5' },
  histoBtn: { borderRadius: 8, padding: 9, alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 0.5, borderColor: colors.borderLight },
  histoBtnTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  histoKpiRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, marginBottom: 16, borderWidth: 0.5, borderColor: colors.border, overflow: 'hidden' },
  histoKpi: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  histoKpiLabel: { fontSize: 9, color: colors.textMuted, textAlign: 'center' },
  histoKpiVal: { fontSize: 16, fontWeight: '800', textAlign: 'center', color: colors.text, marginBottom: 2 },
  histoSection: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  histoCard: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 16, borderWidth: 0.5, borderColor: colors.border, overflow: 'hidden' },
  histoTableHead: { flexDirection: 'row', backgroundColor: colors.inputBg, paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  histoTH: { fontSize: 10, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase' },
  histoRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  histoTD: { fontSize: 12, color: colors.text },
  histoEmpty: { alignItems: 'center', paddingVertical: 24, backgroundColor: colors.surface, borderRadius: 12, marginBottom: 16 },
  histoEmptyTxt: { fontSize: 13, color: colors.textMuted },
  modalHeader: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitre: { fontSize: 15, fontWeight: '700', color: '#fff' },
  modalClose: { fontSize: 14, color: '#fff', fontWeight: '500' },
  modalBody: { flex: 1, padding: 16 },
  fournInfo: { backgroundColor: colors.inputBg, borderRadius: 10, padding: 12, marginBottom: 16 },
  fournInfoNom: { fontSize: 16, fontWeight: '700', color: colors.text },
  fournInfoSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500', marginBottom: 6 },
  formInput: { backgroundColor: colors.inputBg, borderRadius: 8, padding: 12, fontSize: 14, color: colors.text },
  examplesBox: { backgroundColor: '#EEF4FB', borderRadius: 8, padding: 10, marginBottom: 14 },
  examplesTitre: { fontSize: 11, fontWeight: '600', color: '#185FA5', marginBottom: 4 },
  examplesLine: { fontSize: 12, color: '#185FA5', marginBottom: 2 },
  previewBox: { backgroundColor: '#FFF8ED', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27' },
  previewLabel: { fontSize: 11, color: '#854F0B', marginBottom: 6 },
  previewCalc: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 4 },
  previewStatut: { fontSize: 14, fontWeight: '700' },
  traceNote: { backgroundColor: '#E6F1FB', borderRadius: 8, padding: 10, marginBottom: 14 },
  traceNoteTxt: { fontSize: 12, color: '#185FA5' },
  saveBtn: { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  saveBtnTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  filterPill: { paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 2 },
  filterPillActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  filterTxt: { fontSize: 12, color: colors.textMuted },
  filterTxtActive: { color: '#EF9F27', fontWeight: '600' },
  exportSection: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  histoMvtCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  histoMvtHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  histoMvtDate: { fontSize: 13, fontWeight: '600', color: colors.text },
  histoMvtBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  histoMvtBadgeTxt: { fontSize: 10, fontWeight: '600' },
  histoMvtChiffres: { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 10 },
  histoMvtChiffreItem: { flex: 1, alignItems: 'center' },
  histoMvtChiffreSep: { borderLeftWidth: 0.5, borderLeftColor: colors.border },
  histoMvtChiffreLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4, textAlign: 'center' },
  histoMvtChiffreVal: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  histoMvtPhoto: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.border },
  histoMvtPhotoThumb: { width: 48, height: 48, borderRadius: 8 },
  histoMvtPhotoTxt: { fontSize: 12, color: colors.primary, fontWeight: '500' },
}) }
