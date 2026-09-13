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
import * as XLSX from 'xlsx'
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { agregerMouvementsMensuels } from '../lib/creditsFournisseurs'
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
  const { roleActif, restaurantId, restaurantNom, userId } = useApp()
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
      let pQ = supabase.from('points').select('id, restaurant_id').gte('date', debut).lt('date', finExcl)
      if (isGerant) pQ = pQ.eq('restaurant_id', restaurantId)
      else if (restoFilter) pQ = pQ.eq('restaurant_id', restoFilter)
      const { data: pts } = await pQ
      const pointIds = (pts || []).map(p => p.id)
      if (pointIds.length === 0) {
        setMouvMois({ totalFacture: 0, totalPaye: 0, parFourn: [] })
        setLoadingMois(false)
        return
      }

      const { data: trans } = await supabase
        .from('transactions_fournisseurs')
        .select('id, fournisseur_id, fournisseur_nom, facture, paye, photo_url, date_point, created_at')
        .in('point_id', pointIds)

      const nomById = {}
      fournisseurs.forEach(f => { nomById[f.id] = f.nom })
      setMouvMois(agregerMouvementsMensuels(trans, nomById))
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

    const { data: transactions } = await supabase
      .from('transactions_fournisseurs')
      .select('*')
      .eq('fournisseur_id', f.id)
      .order('created_at', { ascending: false })

    const liste = transactions || []

    // `date_point` = date de la JOURNÉE de la facture, renseignée par le
    // déclencheur de supabase_date_point_transactions.sql. Tant que cette
    // migration n'est pas passée elle est vide : on retombe alors sur la date
    // du point. Sans ça, une facture réinjectée s'affiche à la date de la
    // réinjection et remonte en tête de liste, ce qui induit en erreur.
    const aResoudre = [...new Set(liste.filter(t => !t.date_point && t.point_id).map(t => t.point_id))]
    if (aResoudre.length) {
      const parPoint = {}
      for (let i = 0; i < aResoudre.length; i += 60) {   // lots courts : URL PostgREST
        const { data: pts } = await supabase.from('points')
          .select('id, date').in('id', aResoudre.slice(i, i + 60))
        ;(pts || []).forEach(p => { parPoint[p.id] = p.date })
      }
      liste.forEach(t => { if (!t.date_point) t.date_point = parPoint[t.point_id] || null })
    }

    // Tri sur la date de journée : une facture réinjectée reprend sa vraie
    // place chronologique. C'est déjà l'ordre qu'utilise le recalcul des soldes.
    const jour = t => t.date_point || String(t.created_at || '').slice(0, 10)
    liste.sort((a, b) => {
      const da = jour(a)
      const db = jour(b)
      if (da !== db) return da < db ? 1 : -1
      return String(a.created_at) < String(b.created_at) ? 1 : -1
    })

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
      .select('id, facture, paye, reste, created_at, point_id')
      .eq('fournisseur_id', fournId)
    if (transErr) throw transErr
    if (!trans || trans.length === 0) return null

    const pointIds = [...new Set(trans.map(t => t.point_id).filter(Boolean))]
    const { data: points, error: pointsErr } = await supabase
      .from('points').select('id, date').in('id', pointIds)
    if (pointsErr) throw pointsErr
    const dateByPoint = {}
    ;(points || []).forEach(p => { dateByPoint[p.id] = p.date })

    // Tri par date de journée ASC, puis created_at ASC
    const sorted = [...trans].sort((a, b) => {
      const da = dateByPoint[a.point_id] || a.created_at
      const db = dateByPoint[b.point_id] || b.created_at
      if (da !== db) return da < db ? -1 : 1
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
      // Trouver le point le plus récent du restaurant
      const { data: latestPoint, error: pointErr } = await supabase
        .from('points').select('id').eq('restaurant_id', f.restaurant_id)
        .order('date', { ascending: false }).limit(1).maybeSingle()
      if (pointErr) throw pointErr

      const pointId = latestPoint?.id || null

      // Créer une transaction qui annule l'avance : facture = avance → reste = 0
      const { error: insertErr } = await supabase.from('transactions_fournisseurs').insert({
        point_id: pointId,
        fournisseur_id: f.id,
        fournisseur_nom: f.nom,
        restaurant_id: f.restaurant_id,
        facture: avance,
        paye: 0,
        reste: 0,
        saisi_par: 'manager',
        caissier_nom: null,
        source: 'manager',
      })
      if (insertErr) throw insertErr

      const { error: updateErr } = await supabase.from('fournisseurs').update({ credit_actuel: 0 }).eq('id', f.id)
      if (updateErr) throw updateErr

      setFournisseurARemettre(null)
      await charger()
    } catch (err) {
      setRemettreAZeroErreur(err?.message || 'Impossible de remettre à 0')
    }
    setRemettreAZeroId(null)
  }

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
            {peutVoirRestaurants && f.restaurant_nom ? (
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
        {isCotisation && peutModifier && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#EAF3DE', borderColor: '#C0DD97', marginTop: 6 }]}
            onPress={() => remettreAZero(f)}
            disabled={remettreAZeroId === f.id}
          >
            <Text style={[styles.actionBtnTxt, { color: '#3B6D11' }]}>
              {remettreAZeroId === f.id ? 'En cours...' : '✅ Remettre à 0'}
            </Text>
          </TouchableOpacity>
        )}
        {isSolde && peutModifier && (
          <TouchableOpacity
            style={[styles.histoBtn, { marginTop: 6, borderColor: '#E57373', backgroundColor: '#FFF5F5' }]}
            onPress={() => { setArchivageErreur(null); setFournisseurAArchiver(f) }}
          >
            <Text style={[styles.histoBtnTxt, { color: '#C62828' }]}>🗑️ Archiver ce fournisseur</Text>
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
  if (roleActif === 'caissier') return null

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
        <View style={{ width: 80, alignItems: 'flex-end', gap: 6 }}>
          {peutModifier && (
            <TouchableOpacity style={styles.exportBtn} onPress={() => {
              setExportFilters(p => ({ ...p, restoId: restoFilter, fournId: null }))
              setShowExportModal(true)
            }}>
              <Text style={styles.exportBtnTxt}>📄 Export</Text>
            </TouchableOpacity>
          )}
          {peutModifier && (
            <TouchableOpacity style={styles.exportBtn} onPress={() => router.push('/brouillons-fournisseurs')}>
              <Text style={styles.exportBtnTxt}>🗂 Brouillons</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Fix tout — recalcule la chaîne de crédit de tous les fournisseurs */}
      {peutModifier && (
        <TouchableOpacity style={styles.fixAllBtn} onPress={confirmerFixTous} disabled={repairing}>
          <Text style={styles.fixAllTxt}>
            {repairing ? '🔧 Recalcul en cours…' : '🔧 Fix tout — recalculer tous les crédits'}
          </Text>
        </TouchableOpacity>
      )}

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
      {peutVoirRestaurants && restaurants.length > 0 && (
        <TouchableOpacity style={styles.restoSelector} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoSelectorIcon}>🏪</Text>
          <Text style={styles.restoSelectorTxt} numberOfLines={1}>
            {restoFilter ? (restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant') : 'Tous les restaurants'}
          </Text>
          <Text style={styles.restoSelectorArrow}>▾</Text>
        </TouchableOpacity>
      )}

      {/* Sélecteur de mois : soldes actuels ou mouvements d'un mois */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.moisBar}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}
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

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {moisSel ? (
          /* ─── Vue : mouvements du mois (factures + paiements) ─── */
          loadingMois ? (
            <View style={[styles.loadingBox, { paddingVertical: 40 }]}>
              <ActivityIndicator size="large" color="#EF9F27" />
            </View>
          ) : (
            <>
              <View style={styles.moisTotalRow}>
                <View style={styles.moisTotalBox}>
                  <Text style={styles.kpiLabel}>Factures {moisLabel(moisSel)}</Text>
                  <Text style={[styles.kpiVal, { color: '#A32D2D' }]}>{fmt(mouvMois?.totalFacture || 0)}</Text>
                </View>
                <View style={[styles.moisTotalBox, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
                  <Text style={styles.kpiLabel}>Payé {moisLabel(moisSel)}</Text>
                  <Text style={[styles.kpiVal, { color: '#3B6D11' }]}>{fmt(mouvMois?.totalPaye || 0)}</Text>
                </View>
              </View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitre}>📅 MOUVEMENTS DU MOIS</Text>
                <Text style={styles.sectionSub}>{mouvMois?.parFourn?.length || 0} fournisseur(s)</Text>
              </View>
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
                          <Text style={styles.moisCardValLabel}>📦 Factures</Text>
                          <Text style={[styles.moisCardValNum, { color: '#A32D2D' }]}>{fmt(g.facture)}</Text>
                        </View>
                        <View style={styles.moisCardVal}>
                          <Text style={styles.moisCardValLabel}>💳 Payé</Text>
                          <Text style={[styles.moisCardValNum, { color: '#3B6D11' }]}>{fmt(g.paye)}</Text>
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
          </>
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
            {peutModifier ? (
              <TouchableOpacity onPress={() => { setRepairCreditDepart(''); setRepairError(null); setShowRepairModal(true) }} disabled={repairing} style={{ width: 60, alignItems: 'flex-end' }}>
                <Text style={[styles.modalClose, { fontSize: 11, color: repairing ? '#666' : '#EF9F27' }]}>
                  {repairing ? '...' : '🔧 Fix'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 60 }} />
            )}
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
              ) : histoMouvements.map((m, idx) => {
                // ─ Transaction normale (fournisseur.js / point-shift) ─
                const src = m.source || m.saisi_par || 'manuel'
                const sourceInfo = {
                  caissier: { icon: '💼', label: 'Caissier', bg: '#E6F1FB', txt: '#185FA5' },
                  gerant: { icon: '📊', label: 'Saisir Ventes', bg: '#EAF3DE', txt: '#3B6D11' },
                  gerant_caissier: { icon: '🔑', label: 'Gérant Caissier', bg: '#FAEEDA', txt: '#854F0B' },
                  deduction_gerant: { icon: '📋', label: 'Déduction Gérant', bg: '#FAEEDA', txt: '#854F0B' },
                }[src] || { icon: '✏️', label: src, bg: '#f0f0f0', txt: '#888' }
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
                        <Text style={styles.histoMvtDate}>📅 {fmtDate(jourFacture)}</Text>
                        {saisieDecalee && (
                          <Text style={styles.histoMvtSaisie}>saisi le {fmtDate(m.created_at)}</Text>
                        )}
                      </View>
                      <View style={[styles.histoMvtBadge, { backgroundColor: sourceInfo.bg }]}>
                        <Text style={[styles.histoMvtBadgeTxt, { color: sourceInfo.txt }]}>{sourceInfo.icon} {sourceInfo.label}</Text>
                      </View>
                    </View>

                    {m.caissier_nom && (
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>👤 {m.caissier_nom}</Text>
                    )}

                    <View style={styles.histoMvtChiffres}>
                      <View style={styles.histoMvtChiffreItem}>
                        <Text style={styles.histoMvtChiffreLabel}>🔄 Crédit</Text>
                        <Text style={[styles.histoMvtChiffreVal, { color: creditVeille > 0 ? '#A32D2D' : creditVeille < 0 ? '#3B6D11' : colors.textMuted }]}>
                          {creditVeille !== 0 ? fmtShort(creditVeille) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.histoMvtChiffreItem, styles.histoMvtChiffreSep]}>
                        <Text style={styles.histoMvtChiffreLabel}>📦 Facture</Text>
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
                        <PhotoJustificatif uri={m.photo_url} style={styles.histoMvtPhotoThumb} compact />
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

      {/* ── Modal : Confirmation remise à 0 cotisation ── */}
      <Modal visible={!!fournisseurARemettre} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setFournisseurARemettre(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 20 }]} onPress={() => {}}>
            <Text style={[styles.pickerTitre, { marginBottom: 8 }]}>✅ Remettre à 0 ?</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16, textAlign: 'center' }}>
              L'avance de {fmt(Math.abs(fournisseurARemettre?.credit_actuel || 0))} pour {fournisseurARemettre?.nom} sera annulée via une transaction.{'\n'}
              Cette action est irréversible.
            </Text>
            {remettreAZeroErreur && (
              <Text style={{ color: '#C62828', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>⚠️ {remettreAZeroErreur}</Text>
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
            <Text style={[styles.pickerTitre, { marginBottom: 8 }]}>🗑️ Archiver ce fournisseur ?</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16, textAlign: 'center' }}>
              {fournisseurAArchiver?.nom} sera retiré de la liste active.{'\n'}
              Son historique sera conservé.
            </Text>
            {archivageErreur && (
              <Text style={{ color: '#C62828', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>⚠️ {archivageErreur}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.btnAnnuler, { flex: 1 }]} onPress={() => setFournisseurAArchiver(null)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnValider, { flex: 1, backgroundColor: '#C62828' }]}
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
            <Text style={[styles.pickerTitre, { marginBottom: 6 }]}>🔧 Recalculer la chaîne</Text>
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
              <Text style={{ color: '#C62828', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>⚠️ {repairError}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.btnAnnuler, { flex: 1 }]} onPress={() => setShowRepairModal(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnValider, { flex: 1, backgroundColor: '#EF9F27' }]}
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
            <PhotoJustificatif
              uri={modalPhotoUri}
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
  fixAllBtn: { backgroundColor: '#EEF3FB', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 11, alignItems: 'center' },
  fixAllTxt: { fontSize: 13, fontWeight: '700', color: '#185FA5' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  kpiBox: { flex: 1, alignItems: 'center' },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  kpiVal: { fontSize: 15, fontWeight: '800', color: colors.text },
  restoSelector: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  restoSelectorIcon: { fontSize: 16 },
  restoSelectorTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  restoSelectorArrow: { fontSize: 12, color: colors.textMuted },
  moisBar: { flexGrow: 0, backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border, paddingVertical: 8 },
  moisChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.bg },
  moisChipActive: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  moisChipTxt: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  moisChipTxtActive: { color: '#412402', fontWeight: '800' },
  moisTotalRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 0.5, borderColor: colors.border, paddingVertical: 14, marginBottom: 14 },
  moisTotalBox: { flex: 1, alignItems: 'center' },
  moisCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: colors.border },
  moisCardHeader: { flexDirection: 'row', alignItems: 'center' },
  moisCardNom: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  moisCardVals: { flexDirection: 'row', gap: 18 },
  moisCardVal: { alignItems: 'flex-end' },
  moisCardValLabel: { fontSize: 9, color: colors.textMuted },
  moisCardValNum: { fontSize: 13, fontWeight: '700' },
  moisFactureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.borderLight },
  moisFacturePhoto: { width: 44, height: 44, borderRadius: 8 },
  moisFactureDate: { fontSize: 11, color: colors.textMuted },
  moisFactureMontant: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },
  moisFactureVoir: { backgroundColor: '#E6F1FB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  moisFactureVoirTxt: { fontSize: 11, color: '#185FA5', fontWeight: '700' },
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
  btnAnnuler: { borderRadius: 12, padding: 14, alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 0.5, borderColor: colors.borderLight },
  btnAnnulerTxt: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  btnValider: { borderRadius: 12, padding: 14, alignItems: 'center', backgroundColor: '#3B6D11' },
  btnValiderTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  input: { backgroundColor: colors.inputBg, borderRadius: 8, padding: 12, fontSize: 14, color: colors.text },
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
  histoMvtSaisie: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
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
