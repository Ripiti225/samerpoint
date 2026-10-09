/*
 * SQL: Tables already exist (créées par le fichier d'origine).
 * Statut automatique : credit_actuel >= 0 → Fournisseur / credit_actuel < 0 → Cotisation
 * Champ "type" supprimé — plus de sélection manuelle.
 *
 * Optionnel pour enrichir l'historique :
 *   ALTER TABLE historique_credit_fournisseurs ADD COLUMN IF NOT EXISTS montant NUMERIC
 *     GENERATED ALWAYS AS (nouveau_credit - ancien_credit) STORED;
 */

import * as FileSystem from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Modal, Platform,
  SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as XLSX from 'xlsx'
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import {
  agregerMouvementsMensuels,
  ecritureAjustementCredit,
  preparerHistoriqueFournisseur,
  restaurerPhotosFacturesDepuisPoints,
} from '../lib/creditsFournisseurs'
import { appliquerFacturesMensuelles } from '../lib/facturesMensuelles'
import { journaliser } from '../lib/journal'
import { supabase } from '../lib/supabase'
import { aujourdhuiISO } from '../lib/tresorerie'

let _restoFilterCache = null

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }
// Paramètres facture/payé d'inserer_transaction_hors_point pour un écart de crédit.
function ajustementRpc(delta) {
  const e = ecritureAjustementCredit(delta)
  return { p_facture: e?.facture || 0, p_paye: e?.paye || 0 }
}
function fmtShort(n) { return Math.round(n || 0).toLocaleString('fr-FR') }
function fmtDate(dateStr) {
  if (!dateStr) return ''
  const parts = dateStr.split('T')[0].split('-')
  if (parts.length < 3) return dateStr
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(parts[2])} ${mois[parseInt(parts[1]) - 1]}`
}
function moisLabel(key) {
  const [y, m] = key.split('-').map(Number)
  const noms = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']
  return `${noms[m - 1]} ${y}`
}
function derniersMois(n) {
  const arr = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return arr
}

export default function CreditsFournisseursScreen() {
  const { roleActif, restaurantId, restaurantNom, userId, userNom } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const isGerant = roleActif === 'gerant'
  const isRH = roleActif === 'rh'
  const peutModifier = roleActif === 'manager' || roleActif === 'directeur'
  const peutVoirRestaurants = peutModifier || isRH

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
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState(null)
  const [showRepairModal, setShowRepairModal] = useState(false)
  const [repairCreditDepart, setRepairCreditDepart] = useState('')
  const [remettreAZeroId, setRemettreAZeroId] = useState(null)
  const [fournisseurARemettre, setFournisseurARemettre] = useState(null)
  const [remettreAZeroErreur, setRemettreAZeroErreur] = useState(null)
  const [archivageId, setArchivageId] = useState(null)
  const [fournisseurAArchiver, setFournisseurAArchiver] = useState(null)
  const [archivageErreur, setArchivageErreur] = useState(null)
  const [modalPhotoUri, setModalPhotoUri] = useState(null)

  // Vue « mouvements par mois » (factures + paiements enregistrés du mois)
  const [moisSel, setMoisSel] = useState(null)      // null = vue soldes ; 'YYYY-MM' = vue mois
  const [mouvMois, setMouvMois] = useState(null)    // { totalFacture, totalPaye, parFourn: [] }
  const [loadingMois, setLoadingMois] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const [formCredit, setFormCredit] = useState({ montant: '', motif: '' })
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const [exportFilters, setExportFilters] = useState({ dateDebut: firstOfMonth, dateFin: today, restoId: null, fournId: null })

  function selectResto(id) {
    _restoFilterCache = id
    setRestoFilter(id)
  }

  useEffect(() => {
    if (roleActif === 'caissier') {
      router.replace('/accueil')
    }
  }, [roleActif])

  useEffect(() => { charger() }, [restaurantId, restoFilter])

  async function charger() {
    setLoading(true)
    try {
      await appliquerFacturesMensuelles(supabase)
      let restos = []
      if (peutVoirRestaurants) {
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
      // Source de vérité affichée = credit_actuel (solde officiel maintenu par les
      // saisies gérant/caissier et les déductions). On n'aligne PAS sur la dernière
      // transaction : la chaîne de transactions ne contient pas les déductions gérant.
      setFournisseurs((fourn || []).map(f => ({ ...f, restaurant_nom: restoMap[f.restaurant_id] || '' })))
    } catch {}
    setLoading(false)
  }

  // ── Mouvements enregistrés d'un mois (factures + paiements) ──────────────
  useEffect(() => {
    if (moisSel) chargerMois(moisSel)
    else setMouvMois(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moisSel, restoFilter, restaurantId])

  async function chargerMois(mois) {
    setLoadingMois(true)
    try {
      const debut = `${mois}-01`
      const [y, m] = mois.split('-').map(Number)
      const finExcl = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

      // Points du mois pour le périmètre restaurant courant
      let pQ = supabase.from('points').select('id, restaurant_id, draft_gerant').gte('date', debut).lt('date', finExcl)
      if (isGerant) pQ = pQ.eq('restaurant_id', restaurantId)
      else if (restoFilter) pQ = pQ.eq('restaurant_id', restoFilter)
      const { data: pts } = await pQ
      const pointIds = (pts || []).map(p => p.id)

      // Factures mensuelles automatiques : sans journée, datées du 1er.
      let mQ = supabase.from('transactions_fournisseurs')
        .select('id, point_id, fournisseur_id, fournisseur_nom, facture, paye, photo_url, date_point, created_at, saisi_par, source')
        .eq('saisi_par', 'mensuel').is('point_id', null)
        .gte('date_point', debut).lt('date_point', finExcl)
      if (isGerant) mQ = mQ.eq('restaurant_id', restaurantId)
      else if (restoFilter) mQ = mQ.eq('restaurant_id', restoFilter)
      const { data: mensuelles } = await mQ

      if (pointIds.length === 0 && !mensuelles?.length) {
        setMouvMois({ totalFacture: 0, totalPaye: 0, parFourn: [] })
        setLoadingMois(false)
        return
      }

      const { data: transPoints } = pointIds.length
        ? await supabase
          .from('transactions_fournisseurs')
          .select('id, point_id, fournisseur_id, fournisseur_nom, facture, paye, photo_url, date_point, created_at, saisi_par, source')
          .in('point_id', pointIds)
        : { data: [] }
      const trans = [...(transPoints || []), ...(mensuelles || [])]

      const nomById = {}
      fournisseurs.forEach(f => { nomById[f.id] = f.nom })
      const transactionsAvecPhotos = restaurerPhotosFacturesDepuisPoints(trans, pts)
      setMouvMois(agregerMouvementsMensuels(transactionsAvecPhotos, nomById))
    } catch {
      setMouvMois({ totalFacture: 0, totalPaye: 0, parFourn: [] })
    }
    setLoadingMois(false)
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
      // Écriture datée du jour dans la chaîne des restes : le crédit veille du
      // gérant en repart (voir ecritureAjustementCredit). La fonction met aussi
      // à jour credit_actuel.
      const { data: txId, error } = await supabase.rpc('inserer_transaction_hors_point', {
        p_fournisseur: selectedFourn.id, p_date: aujourdhuiISO(),
        ...ajustementRpc(delta),
        p_saisi_par: 'manager', p_source: 'ajustement_manager', p_caissier_nom: userNom || null,
      })
      if (error) throw error
      // Le motif s'affiche sous la ligne dans l'historique (pas de colonne note).
      const motif = formCredit.motif.trim()
      if (txId && motif) {
        await supabase.from('transactions_fournisseurs')
          .update({ facture_correction_raison: motif }).eq('id', txId)
      }

      journaliser('modif_credit_fournisseur', {
        fournisseur: selectedFourn.nom, delta, ancien: ancienCredit, nouveau: nouveauCredit,
        motif: formCredit.motif.trim() || null,
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

    const { data: transactions } = await supabase
      .from('transactions_fournisseurs')
      .select('*')
      .eq('fournisseur_id', f.id)
      .order('created_at', { ascending: false })

    // Les points servent à la fois à retrouver la vraie date de journée et la
    // photo du brouillon gérant que Vérification affiche pour les anciennes
    // transactions dont `photo_url` est vide.
    const pointIds = [...new Set((transactions || []).map(t => t.point_id).filter(Boolean))]
    const points = []
    for (let i = 0; i < pointIds.length; i += 60) {   // lots courts : URL PostgREST
      const { data: pts } = await supabase.from('points')
        .select('id, date, draft_gerant').in('id', pointIds.slice(i, i + 60))
      points.push(...(pts || []))
    }
    const liste = preparerHistoriqueFournisseur(transactions, points)

    setHistoMouvements(liste)
    setLoadingHisto(false)
  }

  // ── Cœur du recalcul (réutilisable, 1 fournisseur) ───────────────────────
  // Préserve le crédit d'OUVERTURE (avant la 1ʳᵉ transaction) : si creditDepart
  // n'est pas fourni, il est back-calculé depuis la 1ʳᵉ transaction (reste − facture
  // + payé), ce qui laisse ce montant inchangé et recalcule seulement la suite.
  async function recalcChaineFournisseur(fournId, creditDepart) {
    const { data: trans, error: transErr } = await supabase
      .from('transactions_fournisseurs')
      .select('id, facture, paye, reste, created_at, point_id, date_point, saisi_par')
      .eq('fournisseur_id', fournId)
    if (transErr) throw transErr
    if (!trans || trans.length === 0) return null

    const pointIds = [...new Set(trans.map(t => t.point_id).filter(Boolean))]
    const { data: points, error: pointsErr } = await supabase
      .from('points').select('id, date').in('id', pointIds)
    if (pointsErr) throw pointsErr
    const dateByPoint = {}
    ;(points || []).forEach(p => { dateByPoint[p.id] = p.date })

    // Tri par date de journée ASC, puis created_at ASC. Une écriture sans journée
    // (facture mensuelle, cotisation reçue) est datée par date_point et passe en
    // tête de son jour — même ordre que supabase_factures_mensuelles.sql.
    const jour = t => dateByPoint[t.point_id] || t.date_point || String(t.created_at || '').slice(0, 10)
    const sorted = [...trans].sort((a, b) => {
      const da = jour(a)
      const db = jour(b)
      if (da !== db) return da < db ? -1 : 1
      const ma = a.point_id ? 1 : 0
      const mb = b.point_id ? 1 : 0
      if (ma !== mb) return ma - mb
      return a.created_at < b.created_at ? -1 : 1
    })

    let prevReste = creditDepart !== undefined && creditDepart !== null
      ? creditDepart
      : (sorted[0].reste || 0) - (sorted[0].facture || 0) + (sorted[0].paye || 0)

    for (const t of sorted) {
      const newReste = prevReste + (t.facture || 0) - (t.paye || 0)
      if (newReste !== t.reste) {
        const { error: updErr } = await supabase.from('transactions_fournisseurs')
          .update({ reste: newReste }).eq('id', t.id)
        if (updErr) throw updErr
      }
      prevReste = newReste
    }

    const { error: fournErr } = await supabase.from('fournisseurs')
      .update({ credit_actuel: prevReste }).eq('id', fournId)
    if (fournErr) throw fournErr
    return prevReste
  }

  // ── Recalcul d'UN fournisseur (depuis le modal historique) ───────────────
  async function repairerChaine(creditDepart) {
    if (!fournHisto) return
    setRepairError(null)
    setRepairing(true)
    setShowRepairModal(false)
    try {
      await recalcChaineFournisseur(fournHisto.id, creditDepart)
      await chargerHistorique(fournHisto)
      await charger()
    } catch (err) {
      setRepairError(err?.message || 'Impossible de recalculer')
    }
    setRepairing(false)
  }

  // ── Fix TOUT : recalcule la chaîne de tous les fournisseurs affichés ─────
  function confirmerFixTous() {
    if (repairing) return
    Alert.alert(
      '🔧 Fix tout',
      `Recalculer la chaîne de crédit de ${fournisseurs.length} fournisseur(s) ?\n\nLe crédit d'ouverture (avant la 1ʳᵉ transaction) de chacun est conservé ; seule la suite est recalculée.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: '🔧 Recalculer tout', onPress: repairerTous },
      ]
    )
  }

  async function repairerTous() {
    setRepairing(true)
    let ok = 0, erreurs = 0
    for (const f of fournisseurs) {
      try {
        const r = await recalcChaineFournisseur(f.id)
        if (r !== null) ok++
      } catch { erreurs++ }
    }
    await charger()
    setRepairing(false)
    Alert.alert('✅ Fix terminé', `${ok} fournisseur(s) recalculé(s)${erreurs ? ` — ${erreurs} en erreur` : ''}.`)
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
  async function confirmerArchivage() {
    const f = fournisseurAArchiver
    if (!f) return
    setArchivageErreur(null)
    setArchivageId(f.id)
    try {
      const { data: trans } = await supabase
        .from('transactions_fournisseurs')
        .select('id').eq('fournisseur_id', f.id).limit(1)

      if (trans && trans.length > 0) {
        const { error } = await supabase.from('fournisseurs').update({ actif: false }).eq('id', f.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('fournisseurs').delete().eq('id', f.id)
        if (error) throw error
      }
      setFournisseurAArchiver(null)
      await charger()
    } catch (err) {
      setArchivageErreur(err?.message || 'Impossible d\'archiver ce fournisseur')
    }
    setArchivageId(null)
  }

  function remettreAZero(f) {
    const avance = Math.abs(f.credit_actuel || 0)
    if (avance === 0) return
    setRemettreAZeroErreur(null)
    setFournisseurARemettre(f)
  }

  async function confirmerRemiseAZero() {
    const f = fournisseurARemettre
    if (!f) return
    const avance = Math.abs(f.credit_actuel || 0)
    setRemettreAZeroErreur(null)
    setRemettreAZeroId(f.id)
    try {
      // L'avance est annulée par une écriture sans journée (facture = avance).
      // Rattachée au dernier point, comme avant, elle était exclue du crédit
      // veille du gérant de ce jour-là et l'avance revenait.
      const { error } = await supabase.rpc('inserer_transaction_hors_point', {
        p_fournisseur: f.id, p_date: aujourdhuiISO(),
        ...ajustementRpc(avance),
        p_saisi_par: 'manager', p_source: 'ajustement_manager', p_caissier_nom: userNom || null,
      })
      if (error) throw error

      setFournisseurARemettre(null)
      await charger()
    } catch (err) {
      setRemettreAZeroErreur(err?.message || 'Impossible de remettre à 0')
    }
    setRemettreAZeroId(null)
  }

  // Couleurs et libellé selon le solde : doit / avance / soldé
  function tonCredit(credit) {
    if (credit < 0) return { c: colors.successDark, bg: colors.successLight, label: 'Avance', icone: 'arrow-down-circle-outline' }
    if (credit === 0) return { c: colors.textMuted, bg: colors.surfaceAlt, label: 'Soldé', icone: 'check-circle-outline' }
    return { c: colors.error, bg: colors.errorLight, label: 'Doit', icone: 'alert-circle-outline' }
  }

  function renderCard(f) {
    const credit = f.credit_actuel || 0
    const isCotisation = credit < 0
    const isSolde = credit === 0
    const ton = tonCredit(credit)
    const initiales = (f.nom || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase()

    return (
      <View key={f.id} style={[styles.card, !isSolde && { borderColor: ton.c + '40' }]}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => chargerHistorique(f)} activeOpacity={0.7}>
          <View style={[styles.avatar, { backgroundColor: ton.bg }]}>
            <Text style={[styles.avatarTxt, { color: ton.c }]}>{initiales}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardNom} numberOfLines={1}>{f.nom}</Text>
            {peutVoirRestaurants && f.restaurant_nom ? (
              <Text style={styles.cardResto} numberOfLines={1}>{f.restaurant_nom}</Text>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: ton.bg }]}>
            <MaterialCommunityIcons name={ton.icone} size={13} color={ton.c} />
            <Text style={[styles.badgeTxt, { color: ton.c }]}>{ton.label}</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.creditLigne}>
          <Text style={styles.creditLabel}>{isCotisation ? 'Avance reçue' : isSolde ? 'Crédit' : 'Crédit dû'}</Text>
          <Text style={[styles.creditVal, { color: ton.c }]}>{fmt(Math.abs(credit))}</Text>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.cardBtn} onPress={() => chargerHistorique(f)}>
            <MaterialCommunityIcons name="history" size={16} color={colors.textSecondary} />
            <Text style={styles.cardBtnTxt}>Historique</Text>
          </TouchableOpacity>
          {peutModifier && (
            <TouchableOpacity
              style={[styles.cardBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => {
                setSelectedFourn(f)
                setFormCredit({ montant: '', motif: '' })
                setShowEditCredit(true)
              }}
            >
              <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.primary} />
              <Text style={[styles.cardBtnTxt, { color: colors.primary }]}>Modifier</Text>
            </TouchableOpacity>
          )}
          {isCotisation && peutModifier && (
            <TouchableOpacity
              style={[styles.cardBtn, { backgroundColor: colors.successLight }]}
              onPress={() => remettreAZero(f)}
              disabled={remettreAZeroId === f.id}
            >
              <MaterialCommunityIcons name="restore" size={16} color={colors.successDark} />
              <Text style={[styles.cardBtnTxt, { color: colors.successDark }]}>
                {remettreAZeroId === f.id ? 'En cours…' : 'Remettre à 0'}
              </Text>
            </TouchableOpacity>
          )}
          {isSolde && peutModifier && (
            <TouchableOpacity
              style={[styles.cardBtn, { backgroundColor: colors.errorLight }]}
              onPress={() => { setArchivageErreur(null); setFournisseurAArchiver(f) }}
            >
              <MaterialCommunityIcons name="archive-outline" size={16} color={colors.error} />
              <Text style={[styles.cardBtnTxt, { color: colors.error }]}>Archiver</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  // En-tête commun (chargement et écran)
  function entete(sousTitre) {
    return (
      <View style={styles.header}>
        <View style={styles.headerLigne}>
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}
            style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Retour"
          >
            <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCentre}>
            <View style={styles.headerIcone}>
              <MaterialCommunityIcons name="credit-card-clock" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.headerTitre} numberOfLines={1}>Fournisseurs</Text>
              <Text style={styles.headerSub} numberOfLines={1}>{sousTitre}</Text>
            </View>
          </View>
          <View style={{ width: 40 }} />
        </View>
        {peutVoirRestaurants && restaurants.length > 0 && (
          <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)} accessibilityRole="button" accessibilityLabel="Filtrer par restaurant">
            <MaterialCommunityIcons name={restoFilter ? 'storefront-outline' : 'earth'} size={17} color="#FFFFFF" />
            <Text style={styles.restoTxt} numberOfLines={1}>
              {restoFilter ? (restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant') : 'Tous les restaurants'}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>
    )
  }

  // Tuile du résumé (total dû, avances…)
  function tuileKpi(icone, label, valeur, couleur, fond) {
    return (
      <View style={styles.kpiTuile}>
        <View style={[styles.kpiIcone, { backgroundColor: fond }]}>
          <MaterialCommunityIcons name={icone} size={18} color={couleur} />
        </View>
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={[styles.kpiVal, { color: couleur }]} numberOfLines={1} adjustsFontSizeToFit>{valeur}</Text>
      </View>
    )
  }

  // Titre de section avec pastille d'icône
  function titreSection(icone, titre, sous, couleur, fond) {
    return (
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionPastille, { backgroundColor: fond }]}>
          <MaterialCommunityIcons name={icone} size={15} color={couleur} />
        </View>
        <Text style={styles.sectionTitre}>{titre}</Text>
        <Text style={styles.sectionSub}>{sous}</Text>
      </View>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        {entete('Crédits et cotisations')}
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    )
  }

  const fournList = fournisseurs.filter(f => (f.credit_actuel || 0) >= 0)
  const cotisList = fournisseurs.filter(f => (f.credit_actuel || 0) < 0)
  const totalDu = fournList.reduce((s, f) => s + (f.credit_actuel || 0), 0)
  const totalAvances = cotisList.reduce((s, f) => s + Math.abs(f.credit_actuel || 0), 0)

  // Aperçu en temps réel dans le formulaire
  if (roleActif === 'caissier') return null

  const deltaPreview = parseFloat(formCredit.montant)
  const nouveauPreview = selectedFourn ? (selectedFourn.credit_actuel || 0) + (isNaN(deltaPreview) ? 0 : deltaPreview) : 0
  const showPreview = selectedFourn && !isNaN(deltaPreview) && deltaPreview !== 0

  return (
    <SafeAreaView style={styles.container}>
      {entete(`Crédits et cotisations · ${fournisseurs.length} actif${fournisseurs.length > 1 ? 's' : ''}`)}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu} showsVerticalScrollIndicator={false}>
        {/* Résumé */}
        <View style={styles.kpiRow}>
          {tuileKpi('alert-circle-outline', 'Total dû', fmt(totalDu), colors.error, colors.errorLight)}
          {tuileKpi('arrow-down-circle-outline', 'Avances reçues', fmt(totalAvances), colors.successDark, colors.successLight)}
        </View>

        {/* Outils du manager */}
        {peutModifier && (
          <View style={styles.outilsRangee}>
            <TouchableOpacity style={styles.outilBtn} onPress={() => {
              setExportFilters(p => ({ ...p, restoId: restoFilter, fournId: null }))
              setShowExportModal(true)
            }}>
              <MaterialCommunityIcons name="file-export-outline" size={17} color={colors.primary} />
              <Text style={styles.outilTxt}>Exporter</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.outilBtn} onPress={() => router.push('/brouillons-fournisseurs')}>
              <MaterialCommunityIcons name="file-document-edit-outline" size={17} color={colors.primary} />
              <Text style={styles.outilTxt}>Brouillons</Text>
            </TouchableOpacity>
            {/* Recalcule la chaîne de crédit de tous les fournisseurs */}
            <TouchableOpacity style={[styles.outilBtn, repairing && { opacity: 0.6 }]} onPress={confirmerFixTous} disabled={repairing}>
              {repairing
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <MaterialCommunityIcons name="wrench-outline" size={17} color={colors.primary} />}
              <Text style={styles.outilTxt}>{repairing ? 'Recalcul…' : 'Tout recalculer'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sélecteur de mois : soldes actuels ou mouvements d'un mois */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.moisBar}
          contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 4 }}
        >
          <TouchableOpacity
            style={[styles.moisChip, !moisSel && styles.moisChipActive]}
            onPress={() => setMoisSel(null)}
          >
            <Text style={[styles.moisChipTxt, !moisSel && styles.moisChipTxtActive]}>Soldes actuels</Text>
          </TouchableOpacity>
          {derniersMois(6).map(mk => (
            <TouchableOpacity
              key={mk}
              style={[styles.moisChip, moisSel === mk && styles.moisChipActive]}
              onPress={() => setMoisSel(mk)}
            >
              <Text style={[styles.moisChipTxt, moisSel === mk && styles.moisChipTxtActive]}>{moisLabel(mk)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {moisSel ? (
          /* ─── Vue : mouvements du mois (factures + paiements) ─── */
          loadingMois ? (
            <View style={[styles.loadingBox, { paddingVertical: 40 }]}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.kpiRow}>
                {tuileKpi('receipt-text-outline', `Factures ${moisLabel(moisSel)}`, fmt(mouvMois?.totalFacture || 0), colors.error, colors.errorLight)}
                {tuileKpi('cash-check', `Payé ${moisLabel(moisSel)}`, fmt(mouvMois?.totalPaye || 0), colors.successDark, colors.successLight)}
              </View>
              {titreSection('calendar-month-outline', 'Mouvements du mois', `${mouvMois?.parFourn?.length || 0} fournisseur(s)`, colors.primary, colors.primaryLight)}
              {(mouvMois?.parFourn?.length || 0) === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionTxt}>Aucun mouvement enregistré ce mois</Text>
                </View>
              ) : (
                mouvMois.parFourn.map(g => (
                  <View key={g.id} style={styles.moisCard}>
                    <View style={styles.moisCardHeader}>
                      <Text style={styles.moisCardNom} numberOfLines={1}>{g.nom}</Text>
                      <View style={styles.moisCardVals}>
                        <View style={styles.moisCardVal}>
                          <Text style={styles.moisCardValLabel}>Factures</Text>
                          <Text style={[styles.moisCardValNum, { color: colors.error }]}>{fmt(g.facture)}</Text>
                        </View>
                        <View style={styles.moisCardVal}>
                          <Text style={styles.moisCardValLabel}>Payé</Text>
                          <Text style={[styles.moisCardValNum, { color: colors.successDark }]}>{fmt(g.paye)}</Text>
                        </View>
                      </View>
                    </View>
                    {g.factures.map((facture, index) => (
                      <View key={facture.id || `${g.id}-${facture.date}-${index}`} style={styles.moisFactureRow}>
                        {facture.photo_url ? (
                          <TouchableOpacity onPress={() => setModalPhotoUri(facture.photo_url)} activeOpacity={0.85}>
                            <PhotoJustificatif uri={facture.photo_url} style={styles.moisFacturePhoto} compact />
                          </TouchableOpacity>
                        ) : (
                          <PhotoJustificatif uri={null} style={styles.moisFacturePhoto} compact />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.moisFactureDate}>Facture du {fmtDate(facture.date)}</Text>
                          <Text style={styles.moisFactureMontant}>{fmt(facture.montant)}</Text>
                        </View>
                        {facture.photo_url && (
                          <TouchableOpacity onPress={() => setModalPhotoUri(facture.photo_url)} style={styles.moisFactureVoir}>
                            <MaterialCommunityIcons name="image-outline" size={15} color={colors.primary} />
                            <Text style={styles.moisFactureVoirTxt}>Voir</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                ))
              )}
            </>
          )
        ) : (
          <>
            {/* ─── Section Fournisseurs ─── */}
            {titreSection('truck-outline', 'Fournisseurs', `${fournList.length} · ${fmt(totalDu)}`, colors.error, colors.errorLight)}
            {fournList.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionTxt}>Aucun fournisseur</Text>
              </View>
            ) : (
              fournList.map(f => renderCard(f))
            )}

            {/* ─── Section Cotisations ─── */}
            <View style={{ height: 8 }} />
            {titreSection('piggy-bank-outline', 'Cotisations', `${cotisList.length} · ${fmt(totalAvances)}`, colors.successDark, colors.successLight)}
            {cotisList.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionTxt}>Aucune cotisation</Text>
              </View>
            ) : (
              cotisList.map(f => renderCard(f))
            )}
          </>
        )}
      </ScrollView>

      {/* ── Modal : Historique ── */}
      <Modal visible={showHistorique} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowHistorique(false)} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Fermer">
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.modalTitre}>Historique</Text>
              {fournHisto && <Text style={styles.modalSous} numberOfLines={1}>{fournHisto.nom}</Text>}
            </View>
            {peutModifier ? (
              <TouchableOpacity
                onPress={() => { setRepairCreditDepart(''); setRepairError(null); setShowRepairModal(true) }}
                disabled={repairing} style={[styles.enteteBtn, repairing && { opacity: 0.5 }]}
                accessibilityRole="button" accessibilityLabel="Recalculer la chaîne"
              >
                {repairing
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <MaterialCommunityIcons name="wrench-outline" size={20} color="#FFFFFF" />}
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40 }} />
            )}
          </View>

          {loadingHisto ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {fournHisto && (
                <View style={styles.histoKpiRow}>
                  <View style={styles.histoKpi}>
                    <Text style={styles.histoKpiLabel}>Solde actuel</Text>
                    <Text style={[styles.histoKpiVal, { color: tonCredit(fournHisto.credit_actuel || 0).c }]}>
                      {(fournHisto.credit_actuel || 0) < 0
                        ? fmt(Math.abs(fournHisto.credit_actuel || 0))
                        : fmt(fournHisto.credit_actuel || 0)}
                    </Text>
                    <View style={[styles.badge, { alignSelf: 'center', marginTop: 4, backgroundColor: tonCredit(fournHisto.credit_actuel || 0).bg }]}>
                      <MaterialCommunityIcons name={tonCredit(fournHisto.credit_actuel || 0).icone} size={13} color={tonCredit(fournHisto.credit_actuel || 0).c} />
                      <Text style={[styles.badgeTxt, { color: tonCredit(fournHisto.credit_actuel || 0).c }]}>
                        {(fournHisto.credit_actuel || 0) < 0 ? 'Avance reçue' : (fournHisto.credit_actuel || 0) === 0 ? 'Soldé' : 'Doit'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.histoKpi, { borderLeftWidth: 1, borderLeftColor: colors.borderLight }]}>
                    <Text style={styles.histoKpiLabel}>Mouvements</Text>
                    <Text style={styles.histoKpiVal}>{histoMouvements.length}</Text>
                  </View>
                </View>
              )}

              <Text style={styles.histoSection}>Mouvements ({histoMouvements.length})</Text>

              {histoMouvements.length === 0 ? (
                <View style={styles.histoEmpty}>
                  <Text style={styles.histoEmptyTxt}>Aucun mouvement enregistré</Text>
                  <Text style={[styles.histoEmptyTxt, { fontSize: 11, marginTop: 4 }]}>
                    Les modifications de crédit apparaîtront ici
                  </Text>
                </View>
              ) : histoMouvements.map((m, idx) => {
                // ─ Transaction normale (fournisseur.js / point-shift) ─
                const src = m.source || m.saisi_par || 'manuel'
                const sourceInfo = {
                  caissier: { icon: 'cash-register', label: 'Caissier', bg: colors.primaryLight, txt: colors.primary },
                  gerant: { icon: 'chart-box-outline', label: 'Saisir Ventes', bg: colors.successLight, txt: colors.successDark },
                  gerant_caissier: { icon: 'key-outline', label: 'Gérant Caissier', bg: colors.warningLight, txt: colors.warningDark },
                  deduction_gerant: { icon: 'clipboard-text-outline', label: 'Déduction Gérant', bg: colors.warningLight, txt: colors.warningDark },
                  facture_mensuelle: { icon: 'calendar-refresh', label: 'Facture mensuelle', bg: colors.primaryLight, txt: colors.primary },
                  cotisation_remise: { icon: 'bank-transfer-in', label: 'Cotisation reçue (RH)', bg: colors.successLight, txt: colors.successDark },
                  ajustement_manager: { icon: 'pencil-outline', label: 'Modifié directement', bg: colors.surfaceAlt, txt: colors.textMuted },
                }[src] || { icon: 'pencil-outline', label: src, bg: colors.surfaceAlt, txt: colors.textMuted }
                const facture = Number(m.facture) || 0
                const paye = Number(m.paye) || 0
                const solde = Number(m.reste) || 0
                // Crédit reporté de la veille = reste - facture + paye
                const creditVeille = solde - facture + paye

                // Date de la JOURNÉE en principal, date de SAISIE en second et
                // seulement si elle diffère : c'est ce qui révèle qu'une facture
                // a été réinjectée après coup.
                const jourFacture = m.date_point || m.created_at
                const jourSaisie = String(m.created_at || '').slice(0, 10)
                const saisieDecalee = jourFacture && jourSaisie
                  && String(jourFacture).slice(0, 10) !== jourSaisie

                return (
                  <View key={`t-${m.id || idx}`} style={styles.histoMvtCard}>
                    <View style={styles.histoMvtHeader}>
                      <View>
                        <Text style={styles.histoMvtDate}>{fmtDate(jourFacture)}</Text>
                        {saisieDecalee && (
                          <Text style={styles.histoMvtSaisie}>saisi le {fmtDate(m.created_at)}</Text>
                        )}
                      </View>
                      <View style={[styles.histoMvtBadge, { backgroundColor: sourceInfo.bg }]}>
                        <MaterialCommunityIcons name={sourceInfo.icon} size={12} color={sourceInfo.txt} />
                        <Text style={[styles.histoMvtBadgeTxt, { color: sourceInfo.txt }]}>{sourceInfo.label}</Text>
                      </View>
                    </View>

                    {m.caissier_nom && (
                      <View style={styles.histoMvtPersonne}>
                        <MaterialCommunityIcons name="account-outline" size={13} color={colors.textMuted} />
                        <Text style={{ fontSize: 12, color: colors.textMuted }}>{m.caissier_nom}</Text>
                      </View>
                    )}

                    {src === 'ajustement_manager' && m.facture_correction_raison && (
                      <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginBottom: 6 }}>
                        « {m.facture_correction_raison} »
                      </Text>
                    )}

                    <View style={styles.histoMvtChiffres}>
                      <View style={styles.histoMvtChiffreItem}>
                        <Text style={styles.histoMvtChiffreLabel}>Crédit</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: creditVeille > 0 ? colors.error : creditVeille < 0 ? colors.successDark : colors.textMuted }]}>
                          {creditVeille !== 0 ? fmtShort(creditVeille) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.histoMvtChiffreItem, styles.histoMvtChiffreSep]}>
                        <Text style={styles.histoMvtChiffreLabel}>Facture</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: colors.text }]}>
                          {facture > 0 ? fmtShort(facture) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.histoMvtChiffreItem, styles.histoMvtChiffreSep]}>
                        <Text style={styles.histoMvtChiffreLabel}>Payé</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: paye > 0 ? colors.successDark : colors.textMuted }]}>
                          {paye > 0 ? fmtShort(paye) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.histoMvtChiffreItem, styles.histoMvtChiffreSep]}>
                        <Text style={styles.histoMvtChiffreLabel}>Reste dû</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: solde > 0 ? colors.error : colors.successDark, fontWeight: '800' }]}>
                          {fmtShort(solde)}
                        </Text>
                      </View>
                    </View>

                    {m.photo_url && (
                      <TouchableOpacity style={styles.histoMvtPhoto} onPress={() => setModalPhotoUri(m.photo_url)}>
                        <PhotoJustificatif uri={m.photo_url} style={styles.histoMvtPhotoThumb} compact />
                        <Text style={styles.histoMvtPhotoTxt}>Voir la facture</Text>
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

      {/* ── Modal : Confirmation remise à 0 cotisation ── */}
      <Modal visible={!!fournisseurARemettre} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setFournisseurARemettre(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 20 }]} onPress={() => {}}>
            <View style={[styles.confirmIcone, { backgroundColor: colors.successLight }]}>
              <MaterialCommunityIcons name="restore" size={24} color={colors.successDark} />
            </View>
            <Text style={styles.confirmTitre}>Remettre à 0 ?</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16, textAlign: 'center' }}>
              L'avance de {fmt(Math.abs(fournisseurARemettre?.credit_actuel || 0))} pour {fournisseurARemettre?.nom} sera annulée via une transaction.{'\n'}
              Cette action est irréversible.
            </Text>
            {remettreAZeroErreur && (
              <Text style={{ color: colors.error, fontSize: 12, marginBottom: 10, textAlign: 'center' }}>{remettreAZeroErreur}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.btnAnnuler, { flex: 1 }]} onPress={() => setFournisseurARemettre(null)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnValider, { flex: 1 }]}
                onPress={confirmerRemiseAZero}
                disabled={!!remettreAZeroId}
              >
                <Text style={styles.btnValiderTxt}>{remettreAZeroId ? 'En cours...' : 'Confirmer'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal : Confirmation archivage fournisseur ── */}
      <Modal visible={!!fournisseurAArchiver} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setFournisseurAArchiver(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 20 }]} onPress={() => {}}>
            <View style={[styles.confirmIcone, { backgroundColor: colors.errorLight }]}>
              <MaterialCommunityIcons name="archive-outline" size={24} color={colors.error} />
            </View>
            <Text style={styles.confirmTitre}>Archiver ce fournisseur ?</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16, textAlign: 'center' }}>
              {fournisseurAArchiver?.nom} sera retiré de la liste active.{'\n'}
              Son historique sera conservé.
            </Text>
            {archivageErreur && (
              <Text style={{ color: colors.error, fontSize: 12, marginBottom: 10, textAlign: 'center' }}>{archivageErreur}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.btnAnnuler, { flex: 1 }]} onPress={() => setFournisseurAArchiver(null)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnValider, { flex: 1, backgroundColor: colors.error }]}
                onPress={confirmerArchivage}
                disabled={!!archivageId}
              >
                <Text style={styles.btnValiderTxt}>{archivageId ? 'En cours...' : 'Archiver'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal : Saisie crédit de départ pour Fix ── */}
      <Modal visible={showRepairModal} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowRepairModal(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 20 }]} onPress={() => {}}>
            <View style={[styles.confirmIcone, { backgroundColor: colors.primaryLight }]}>
              <MaterialCommunityIcons name="wrench-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.confirmTitre}>Recalculer la chaîne</Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14, textAlign: 'center' }}>
              Entrez le crédit correct <Text style={{ fontWeight: '700' }}>avant</Text> la toute première transaction de ce fournisseur.{'\n'}
              (0 si le fournisseur n'avait aucune dette au départ)
            </Text>
            <TextInput
              style={[styles.input, { marginBottom: 16, textAlign: 'center', fontSize: 16 }]}
              placeholder="Ex: 0 ou 150000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={repairCreditDepart}
              onChangeText={setRepairCreditDepart}
            />
            {repairError && (
              <Text style={{ color: colors.error, fontSize: 12, marginBottom: 10, textAlign: 'center' }}>{repairError}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.btnAnnuler, { flex: 1 }]} onPress={() => setShowRepairModal(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnValider, { flex: 1, backgroundColor: colors.primary }]}
                onPress={() => {
                  const val = parseFloat(repairCreditDepart.replace(',', '.'))
                  if (isNaN(val)) { setRepairError('Entrez un nombre valide (ex: 0 ou 150000)'); return }
                  repairerChaine(val)
                }}
              >
                <Text style={styles.btnValiderTxt}>Recalculer</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
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
              <Text style={[styles.pickerRowTxt, !restoFilter && styles.pickerRowTxtActive]}>Tous les restaurants</Text>
              {!restoFilter && <MaterialCommunityIcons name="check" size={20} color={colors.primary} />}
            </TouchableOpacity>
            {restaurants.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[styles.pickerRow, restoFilter === r.id && styles.pickerRowActive]}
                onPress={() => { selectResto(r.id); setShowRestoPicker(false) }}
              >
                <Text style={[styles.pickerRowTxt, restoFilter === r.id && styles.pickerRowTxtActive]} numberOfLines={1}>{r.nom}</Text>
                {restoFilter === r.id && <MaterialCommunityIcons name="check" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal : Modifier le crédit ── */}
      <Modal visible={showEditCredit} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditCredit(false)} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Annuler">
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={[styles.modalTitre, { flex: 1, textAlign: 'center' }]}>Modifier le crédit</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {selectedFourn && (
              <View style={styles.fournInfo}>
                <Text style={styles.fournInfoNom}>{selectedFourn.nom}</Text>
                <Text style={styles.fournInfoSub}>
                  Solde actuel :{' '}
                  <Text style={{ color: tonCredit(selectedFourn.credit_actuel || 0).c, fontWeight: '800' }}>
                    {(selectedFourn.credit_actuel || 0) < 0
                      ? `${fmt(Math.abs(selectedFourn.credit_actuel || 0))} avance reçue`
                      : (selectedFourn.credit_actuel || 0) === 0
                      ? 'soldé (0 FCFA)'
                      : `${fmt(selectedFourn.credit_actuel || 0)} dû`}
                  </Text>
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
                placeholderTextColor={colors.textPlaceholder}
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
                placeholderTextColor={colors.textPlaceholder}
                multiline
              />
            </View>

            {showPreview && (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>Aperçu après modification :</Text>
                <Text style={styles.previewCalc}>
                  {fmtShort(selectedFourn.credit_actuel || 0)} {deltaPreview >= 0 ? '+' : '−'} {fmtShort(Math.abs(deltaPreview))} = {fmtShort(nouveauPreview)} FCFA
                </Text>
                <Text style={[styles.previewStatut, { color: tonCredit(nouveauPreview).c }]}>
                  → {nouveauPreview < 0 ? 'Cotisation (avance reçue)' : nouveauPreview === 0 ? 'Soldé' : 'Fournisseur (doit)'}
                </Text>
              </View>
            )}

            <View style={styles.traceNote}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.traceNoteTxt}>Toutes les modifications sont tracées dans l'historique avec votre nom et la date.</Text>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}
              onPress={modifierCredit}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <MaterialCommunityIcons name="content-save-outline" size={18} color="#FFFFFF" />}
              <Text style={styles.saveBtnTxt}>{saving ? 'Enregistrement…' : 'Enregistrer la modification'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal : Export ── */}
      <Modal visible={showExportModal} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowExportModal(false)} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Fermer">
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={[styles.modalTitre, { flex: 1, textAlign: 'center' }]}>Exporter un rapport</Text>
            <View style={{ width: 40 }} />
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
                  placeholderTextColor={colors.textPlaceholder}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Date fin</Text>
                <TextInput
                  style={styles.formInput}
                  value={exportFilters.dateFin}
                  onChangeText={v => setExportFilters(p => ({ ...p, dateFin: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textPlaceholder}
                />
              </View>
            </View>

            {peutModifier && restaurants.length > 0 && (
              <>
                <Text style={styles.exportSection}>Restaurant</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 16 }}>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 24 }}>
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
                style={[styles.saveBtn, { flex: 1, backgroundColor: colors.errorDark }, exporting && { opacity: 0.6 }]}
                onPress={exporterPdf}
                disabled={exporting}
              >
                <MaterialCommunityIcons name="file-pdf-box" size={18} color="#FFFFFF" />
                <Text style={styles.saveBtnTxt}>{exporting ? 'Génération…' : 'PDF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: '#1D6F42' }, exporting && { opacity: 0.6 }]}
                onPress={exporterExcel}
                disabled={exporting}
              >
                <MaterialCommunityIcons name="file-excel-outline" size={18} color="#FFFFFF" />
                <Text style={styles.saveBtnTxt}>{exporting ? 'Génération…' : 'Excel'}</Text>
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
            <MaterialCommunityIcons name="close" size={30} color="#FFFFFF" />
          </TouchableOpacity>
          {modalPhotoUri && (
            <PhotoJustificatif
              uri={modalPhotoUri}
              style={{ width: '92%', height: '70%' }}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={{ marginTop: 20, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 13 }}
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
  // Couleurs du groupe Trésorerie (thème selon l'écran, lib/groupesAccueil.js).
  header: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, gap: 12,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22, zIndex: 2,
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  headerLigne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  enteteBtn: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerCentre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerIcone: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  headerTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: colors.primaryText, fontWeight: '600', marginTop: 1 },
  restoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  restoTxt: { fontSize: 15, color: '#FFFFFF', fontWeight: '700', flex: 1 },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  bodyContenu: { padding: 14, paddingBottom: 60 },

  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  kpiTuile: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  kpiIcone: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  kpiLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  kpiVal: { fontSize: 18, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },

  outilsRangee: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  outilBtn: {
    flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  outilTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },

  moisBar: { flexGrow: 0, marginBottom: 14 },
  moisChip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, minHeight: 38, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface,
  },
  moisChipActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 2,
  },
  moisChipTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  moisChipTxtActive: { color: '#FFFFFF', fontWeight: '800' },

  moisCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.borderLight },
  moisCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moisCardNom: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  moisCardVals: { flexDirection: 'row', gap: 16 },
  moisCardVal: { alignItems: 'flex-end' },
  moisCardValLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  moisCardValNum: { fontSize: 13, fontWeight: '800' },
  moisFactureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  moisFacturePhoto: { width: 46, height: 46, borderRadius: 10 },
  moisFactureDate: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  moisFactureMontant: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 2 },
  moisFactureVoir: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
  },
  moisFactureVoirTxt: { fontSize: 12, color: colors.primary, fontWeight: '800' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerBox: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingBottom: 32 },
  pickerTitre: { fontSize: 16, fontWeight: '800', color: colors.text, paddingHorizontal: 20, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  pickerRowActive: { backgroundColor: colors.primaryLight },
  pickerRowTxt: { flex: 1, fontSize: 15, color: colors.text },
  pickerRowTxtActive: { color: colors.primary, fontWeight: '800' },
  confirmIcone: {
    width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 10,
  },
  confirmTitre: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 8 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 4 },
  sectionPastille: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sectionTitre: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  sectionSub: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  emptySection: {
    alignItems: 'center', paddingVertical: 18, backgroundColor: colors.surface, borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.borderLight, borderStyle: 'dashed',
  },
  emptySectionTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },

  card: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '800' },
  cardNom: { fontSize: 15, fontWeight: '800', color: colors.text },
  cardResto: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  badgeTxt: { fontSize: 11, fontWeight: '800' },
  creditLigne: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  creditLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  creditVal: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  cardBtn: {
    flexGrow: 1, flexBasis: 0, minWidth: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    minHeight: 40, borderRadius: 12, paddingHorizontal: 8, backgroundColor: colors.surfaceAlt,
  },
  cardBtnTxt: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },

  btnAnnuler: { borderRadius: 14, padding: 14, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  btnAnnulerTxt: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  btnValider: { borderRadius: 14, padding: 14, alignItems: 'center', backgroundColor: colors.successDark },
  btnValiderTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  input: { backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.inputBorder },

  histoKpiRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 18, marginBottom: 16, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  histoKpi: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  histoKpiLabel: { fontSize: 11, color: colors.textMuted, textAlign: 'center', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  histoKpiVal: { fontSize: 20, fontWeight: '800', textAlign: 'center', color: colors.text, letterSpacing: -0.3 },
  histoSection: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  histoEmpty: { alignItems: 'center', paddingVertical: 24, backgroundColor: colors.surface, borderRadius: 16, marginBottom: 16 },
  histoEmptyTxt: { fontSize: 13, color: colors.textMuted },

  modalHeader: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, gap: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
  },
  modalTitre: { fontSize: 17, fontWeight: '800', color: colors.headerText },
  modalSous: { fontSize: 12, color: colors.primaryText, marginTop: 1, fontWeight: '600' },
  modalBody: { flex: 1, padding: 16 },
  fournInfo: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.borderLight },
  fournInfoNom: { fontSize: 17, fontWeight: '800', color: colors.text },
  fournInfoSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  formInput: { backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.inputBorder },
  examplesBox: { backgroundColor: colors.primaryLight, borderRadius: 14, padding: 12, marginBottom: 14 },
  examplesTitre: { fontSize: 12, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  examplesLine: { fontSize: 12, color: colors.primary, marginBottom: 2, fontWeight: '600' },
  previewBox: { backgroundColor: colors.warningLight, borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: colors.warning + '66' },
  previewLabel: { fontSize: 11, color: colors.warningDark, marginBottom: 6, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewCalc: { fontSize: 14, color: colors.text, fontWeight: '700', marginBottom: 4 },
  previewStatut: { fontSize: 14, fontWeight: '800' },
  traceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 14 },
  traceNoteTxt: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  saveBtn: {
    borderRadius: 14, padding: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, marginTop: 4,
  },
  saveBtnTxt: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderRadius: 999, minHeight: 36, justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  filterTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  exportSection: { fontSize: 11, fontWeight: '800', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },

  histoMvtCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.borderLight },
  histoMvtHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  histoMvtDate: { fontSize: 15, fontWeight: '800', color: colors.text },
  histoMvtSaisie: { fontSize: 11, color: colors.warningDark, marginTop: 1, fontWeight: '600' },
  histoMvtBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  histoMvtBadgeTxt: { fontSize: 11, fontWeight: '800' },
  histoMvtPersonne: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  histoMvtChiffres: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 12, paddingVertical: 10 },
  histoMvtChiffreItem: { flex: 1, alignItems: 'center' },
  histoMvtChiffreSep: { borderLeftWidth: 1, borderLeftColor: colors.border },
  histoMvtChiffreLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4, textAlign: 'center', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  histoMvtChiffreVal: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  histoMvtPhoto: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  histoMvtPhotoThumb: { width: 48, height: 48, borderRadius: 10 },
  histoMvtPhotoTxt: { fontSize: 13, color: colors.primary, fontWeight: '800' },
}) }
