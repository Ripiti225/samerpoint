import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Modal, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { supabase } from '../lib/supabase'

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }
function fmtShort(n) { return Math.round(n || 0).toLocaleString('fr-FR') }

const TODAY = new Date().toISOString().split('T')[0]

const PERIODES = [
  { key: '1jour', label: '1 jour' },
  { key: 'semaine', label: '7 jours' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'mois_prec', label: 'Mois préc.' },
  { key: 'perso', label: '🗓 Perso' },
]

const ONGLETS = [
  { key: 'ecarts', label: 'Écarts' },
  { key: 'inventaire', label: 'Inventaire' },
  { key: 'avis', label: 'Avis clients' },
  { key: 'yango', label: 'Yango' },
  { key: 'glovo', label: 'Glovo' },
  { key: 'contact', label: 'Contacts' },
]

const TYPES_AVIS = [
  { key: 'mauvais', label: '👎 Mauvais avis', montant: 1000, couleur: '#C62828' },
  { key: 'bon', label: '👍 Bon avis', montant: -500, couleur: '#2E7D32' },
]
const TYPES_YANGO = [
  { key: 'tape_moins', label: 'Tapé −', couleur: '#C62828' },
  { key: 'tape_plus', label: 'Tapé +', couleur: '#2E7D32' },
]
const TYPES_GLOVO = [
  { key: 'tape_moins', label: 'Tapé −', couleur: '#C62828' },
  { key: 'tape_plus', label: 'Tapé +', couleur: '#2E7D32' },
  { key: 'remboursement', label: 'Remboursement', couleur: '#185FA5' },
  { key: 'temps_attente', label: 'Temps attente', couleur: '#F59E0B' },
]

// Map produit_id → nom de catégorie
const PRODUIT_TO_CAT = {}
CATEGORIES_INVENTAIRE.forEach(cat => {
  cat.produits.forEach(p => { PRODUIT_TO_CAT[p.id] = cat.nom })
})

const SHIFT_LABELS = {
  matin: '🌅 Matin',
  soir: '🌆 Soir',
  nuit: '🌙 Nuit',
  double: '🔄 Double',
  personnalise: '✏️ Perso',
}

function getPlage(periodeKey, dateUnique, dateDebut, dateFin) {
  if (periodeKey === '1jour') return { debut: dateUnique, fin: dateUnique }
  if (periodeKey === 'semaine') {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return { debut: d.toISOString().split('T')[0], fin: TODAY }
  }
  if (periodeKey === 'mois') {
    const now = new Date()
    const debut = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    return { debut, fin: TODAY }
  }
  if (periodeKey === 'mois_prec') {
    const firstOfThisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const lastOfPrev = new Date(firstOfThisMonth - 1)
    const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1)
    return {
      debut: firstOfPrev.toISOString().split('T')[0],
      fin: lastOfPrev.toISOString().split('T')[0],
    }
  }
  return { debut: dateDebut, fin: dateFin }
}

function formDateDefaut(periodeKey, dateUnique) {
  return periodeKey === '1jour' ? dateUnique : TODAY
}

export default function LitigesScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { userNom, userId } = useApp()

  // ── Restaurant ──────────────────────────────────────────────
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  // ── Période ─────────────────────────────────────────────────
  const [periodeKey, setPeriodeKey] = useState('1jour')
  const [dateUnique, setDateUnique] = useState(TODAY)
  const [dateDebut, setDateDebut] = useState(TODAY)
  const [dateFin, setDateFin] = useState(TODAY)
  const [showCalUnique, setShowCalUnique] = useState(false)
  const [showCalDebut, setShowCalDebut] = useState(false)
  const [showCalFin, setShowCalFin] = useState(false)
  const [datesAvec, setDatesAvec] = useState({})

  // ── Mode global (tous restaurants) ──────────────────────────
  const [modeGlobal, setModeGlobal] = useState(false)
  const [donneesGlobales, setDonneesGlobales] = useState([])
  const [generatingPdf, setGeneratingPdf] = useState(false)

  // ── UI ───────────────────────────────────────────────────────
  const [onglet, setOnglet] = useState('ecarts')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmSuppr, setConfirmSuppr] = useState(null)

  // ── Volet 1 — écarts ────────────────────────────────────────
  const [ecartsListe, setEcartsListe] = useState([])

  // ── Volet 2 — inventaire ────────────────────────────────────
  const [inventaireShifts, setInventaireShifts] = useState([])

  // ── Volet 3 — avis clients ──────────────────────────────────
  const [avisClients, setAvisClients] = useState([])
  const [showFormAvis, setShowFormAvis] = useState(false)
  const [formAvis, setFormAvis] = useState({ type: 'mauvais', notes: '', numero_commande: '', date_saisie: TODAY, id: null })

  // ── Volet 4 — Yango ─────────────────────────────────────────
  const [litigesYango, setLitigesYango] = useState([])
  const [showFormYango, setShowFormYango] = useState(false)
  const [formYango, setFormYango] = useState({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: TODAY, id: null })

  // ── Volet 5 — Glovo ─────────────────────────────────────────
  const [litigesGlovo, setLitigesGlovo] = useState([])
  const [showFormGlovo, setShowFormGlovo] = useState(false)
  const [formGlovo, setFormGlovo] = useState({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: TODAY, id: null })

  // ── Volet 6 — Écart Contact ──────────────────────────────────
  const [ecartContacts, setEcartContacts] = useState([])

  const plage = useMemo(
    () => getPlage(periodeKey, dateUnique, dateDebut, dateFin),
    [periodeKey, dateUnique, dateDebut, dateFin]
  )

  useEffect(() => { chargerRestaurants() }, [])

  useEffect(() => {
    if (modeGlobal) chargerTousRestaurants()
    else if (restoSelectionne) chargerTout()
  }, [modeGlobal, restoSelectionne, plage])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
    if (data?.length) {
      setRestoSelectionne(data[0])
      chargerDatesAvec(data[0].id)
    }
  }

  async function chargerDatesAvec(restoId) {
    const { data } = await supabase.from('points').select('date').eq('restaurant_id', restoId)
    const marked = {}
    ;(data || []).forEach(p => { marked[p.date] = { marked: true, dotColor: '#185FA5' } })
    setDatesAvec(marked)
  }

  async function chargerTout() {
    if (!restoSelectionne) return
    setLoading(true)
    await Promise.all([chargerEcarts(), chargerInventaire(), chargerAvis(), chargerYango(), chargerGlovo(), chargerEcartContacts()])
    setLoading(false)
  }

  async function chargerEcarts() {
    const { debut, fin } = plage
    const { data: pointsData } = await supabase
      .from('points')
      .select('id, date, vente_machine')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut)
      .lte('date', fin)
      .order('date', { ascending: false })

    if (!pointsData?.length) { setEcartsListe([]); return }

    const pointIds = pointsData.map(p => p.id)
    const { data: allShifts } = await supabase
      .from('points_shifts').select('point_id, vente_shift').in('point_id', pointIds)

    const shiftsByPoint = {}
    ;(allShifts || []).forEach(s => {
      if (!shiftsByPoint[s.point_id]) shiftsByPoint[s.point_id] = []
      shiftsByPoint[s.point_id].push(s)
    })

    setEcartsListe(pointsData.map(p => {
      const shifts = shiftsByPoint[p.id] || []
      const cumulShifts = shifts.reduce((s, x) => s + (x.vente_shift || 0), 0)
      return {
        date: p.date,
        venteMachine: p.vente_machine || 0,
        cumulShifts,
        ecart: (p.vente_machine || 0) - cumulShifts,
        nbShifts: shifts.length,
      }
    }))
  }

  async function chargerInventaire() {
    const { debut, fin } = plage

    const { data: shifts } = await supabase
      .from('inventaires_shifts')
      .select('id, caissier_id, type_shift, montant_a_deduire, date')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .eq('valide', true)
      .order('date', { ascending: false })

    if (!shifts?.length) { setInventaireShifts([]); return }

    // Noms des caissiers
    const caissierIds = [...new Set(shifts.map(s => s.caissier_id).filter(Boolean))]
    const { data: utilisateurs } = await supabase
      .from('utilisateurs').select('id, nom').in('id', caissierIds)
    const nomById = {}
    ;(utilisateurs || []).forEach(u => { nomById[u.id] = u.nom })

    // Lignes avec écart par shift
    const shiftIds = shifts.map(s => s.id)
    const { data: lignes } = await supabase
      .from('inventaire_lignes')
      .select('inventaire_id, produit_id, produit_nom, montant_deduit')
      .in('inventaire_id', shiftIds)
      .gt('montant_deduit', 0)

    const lignesByShift = {}
    ;(lignes || []).forEach(l => {
      if (!lignesByShift[l.inventaire_id]) lignesByShift[l.inventaire_id] = []
      lignesByShift[l.inventaire_id].push(l)
    })

    setInventaireShifts(shifts.map(s => ({
      ...s,
      caissier_nom: nomById[s.caissier_id] || 'Caissier',
      lignes: lignesByShift[s.id] || [],
    })))
  }

  async function chargerAvis() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_avis_clients').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setAvisClients(data || [])
  }

  async function chargerYango() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_yango').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setLitigesYango(data || [])
  }

  async function chargerGlovo() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_glovo').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setLitigesGlovo(data || [])
  }

  async function chargerEcartContacts() {
    const { debut, fin } = plage

    const { data: points } = await supabase
      .from('points').select('id, date')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })

    if (!points?.length) { setEcartContacts([]); return }

    const pointIds = points.map(p => p.id)
    const dateByPoint = {}
    points.forEach(p => { dateByPoint[p.id] = p.date })

    const { data: shifts } = await supabase
      .from('points_shifts').select('id, point_id, caissier_nom, caissier_id, heure_debut, heure_fin')
      .in('point_id', pointIds)
      .order('created_at', { ascending: true })

    if (!shifts?.length) { setEcartContacts([]); return }

    const { data: cmds } = await supabase
      .from('commandes').select('id, point_id, caissier_id, contact_client')
      .in('point_id', pointIds)

    // Grouper par point_id + caissier_id
    const statsByKey = {}
    ;(cmds || []).forEach(c => {
      const key = `${c.point_id}__${c.caissier_id}`
      if (!statsByKey[key]) statsByKey[key] = { total: 0, avecContact: 0 }
      statsByKey[key].total++
      if (c.contact_client && c.contact_client.trim() !== '') statsByKey[key].avecContact++
    })

    setEcartContacts(shifts.map(s => {
      const key = `${s.point_id}__${s.caissier_id}`
      const stats = statsByKey[key] || { total: 0, avecContact: 0 }
      const nbCommandes = stats.total
      const nbContacts = stats.avecContact
      const ecart = nbCommandes - nbContacts
      const taux = nbCommandes > 0 ? Math.round((ecart / nbCommandes) * 1000) / 10 : 0
      const litige = taux > 20 ? ecart * 500 : 0
      return {
        caissierNom: s.caissier_nom || '—',
        heureDebut: s.heure_debut || '',
        heureFin: s.heure_fin || '',
        date: dateByPoint[s.point_id] || '',
        nbCommandes,
        nbContacts,
        ecart,
        taux,
        litige,
      }
    }))
  }

  // ── Mode global : toutes données par restaurant ─────────────
  async function chargerTousRestaurants() {
    if (!restaurants.length) return
    setLoading(true)
    const { debut, fin } = plage

    const resultats = await Promise.all(restaurants.map(async resto => {
      // Écarts
      const { data: pointsData } = await supabase
        .from('points').select('id, date, vente_machine')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
      let ecartTotal = 0
      if (pointsData?.length) {
        const ids = pointsData.map(p => p.id)
        const { data: shifts } = await supabase
          .from('points_shifts').select('point_id, vente_shift').in('point_id', ids)
        const byPoint = {}
        ;(shifts || []).forEach(s => { byPoint[s.point_id] = (byPoint[s.point_id] || 0) + (s.vente_shift || 0) })
        pointsData.forEach(p => { ecartTotal += (p.vente_machine || 0) - (byPoint[p.id] || 0) })
      }

      // Inventaire + détail
      const { data: invShifts } = await supabase
        .from('inventaires_shifts').select('id, caissier_id, type_shift, montant_a_deduire, date')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).eq('valide', true)
      let invEnriched = []
      let invTotal = 0
      if (invShifts?.length) {
        invTotal = invShifts.reduce((s, x) => s + (x.montant_a_deduire || 0), 0)
        const caissierIds = [...new Set(invShifts.map(s => s.caissier_id).filter(Boolean))]
        const { data: users } = await supabase.from('utilisateurs').select('id, nom').in('id', caissierIds)
        const nomById = {}
        ;(users || []).forEach(u => { nomById[u.id] = u.nom })
        const shiftIds = invShifts.map(s => s.id)
        const { data: lignes } = await supabase
          .from('inventaire_lignes').select('inventaire_id, produit_id, produit_nom, montant_deduit')
          .in('inventaire_id', shiftIds).gt('montant_deduit', 0)
        const lignesByShift = {}
        ;(lignes || []).forEach(l => {
          if (!lignesByShift[l.inventaire_id]) lignesByShift[l.inventaire_id] = []
          lignesByShift[l.inventaire_id].push(l)
        })
        invEnriched = invShifts.map(s => ({
          ...s,
          caissier_nom: nomById[s.caissier_id] || 'Caissier',
          lignes: lignesByShift[s.id] || [],
        }))
      }

      // Avis / Yango / Glovo
      const [{ data: avis }, { data: yango }, { data: glovo }] = await Promise.all([
        supabase.from('litiges_avis_clients').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
        supabase.from('litiges_yango').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
        supabase.from('litiges_glovo').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
      ])
      const avisTotal  = (avis  || []).reduce((s, x) => s + (x.montant || 0), 0)
      const yangoTotal = (yango || []).reduce((s, x) => s + (x.montant || 0), 0)
      const glovoTotal = (glovo || []).reduce((s, x) => s + (x.montant || 0), 0)

      return {
        restaurant: resto, ecartTotal, invTotal, invEnriched,
        avis: avis || [], avisTotal,
        yango: yango || [], yangoTotal,
        glovo: glovo || [], glovoTotal,
        total: ecartTotal + invTotal + avisTotal + yangoTotal + glovoTotal,
      }
    }))

    setDonneesGlobales(resultats)
    setLoading(false)
  }

  // ── Génération PDF + partage natif ───────────────────────────
  async function genererEtPartagePDF() {
    setGeneratingPdf(true)
    try {
      const periode = plageLabel()
      let html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#333;padding:20px;margin:0}
        h1{font-size:18px;color:#534AB7;margin:0 0 4px}
        .sub{font-size:11px;color:#888;margin-bottom:20px}
        .resto{margin-bottom:20px;border:1px solid #ddd;border-radius:8px;overflow:hidden;page-break-inside:avoid}
        .resto-h{background:#534AB7;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}
        .resto-nom{font-size:14px;font-weight:bold}
        .resto-tot{font-size:13px;font-weight:bold}
        .volet{padding:8px 14px;border-bottom:1px solid #f0f0f0}
        .volet-h{display:flex;justify-content:space-between;font-weight:bold;font-size:12px;color:#444;margin-bottom:4px}
        .item{padding:3px 0 3px 12px;border-left:2px solid #e0e0e0;margin:3px 0;font-size:11px}
        .cmd{color:#185FA5;font-weight:bold}
        .r{color:#C62828}.g{color:#2E7D32}.b{color:#185FA5}
        .recap{background:#f8f8f8;padding:14px;margin-top:20px;border-radius:8px;border:1px solid #ddd}
        .recap-h{font-size:14px;font-weight:bold;margin-bottom:10px;color:#333}
        .recap-l{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px}
        .gt{border-top:1px solid #ccc;margin-top:8px;padding-top:8px;font-size:15px;font-weight:bold}
        .ok{color:#2E7D32;font-style:italic;font-size:11px}
      </style></head><body>
      <h1>⚖️ Rapport Litiges</h1>
      <p class="sub">Période : ${periode} — Généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`

      let grandTotal = 0

      for (const d of donneesGlobales) {
        grandTotal += d.total
        const tc = d.total > 0 ? 'r' : d.total < 0 ? 'g' : ''
        html += `<div class="resto"><div class="resto-h">
          <span class="resto-nom">${d.restaurant.nom}</span>
          <span class="resto-tot ${tc}">${d.total > 0 ? '+' : ''}${Math.round(d.total).toLocaleString('fr-FR')} FCFA</span>
        </div>`

        const vide = !d.ecartTotal && !d.invTotal && !d.avis.length && !d.yango.length && !d.glovo.length
        if (vide) {
          html += `<div class="volet"><span class="ok">✅ Aucun litige sur la période</span></div>`
        }

        // Écart
        if (d.ecartTotal !== 0) {
          const ec = d.ecartTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>📊 Écart point</span><span class="${ec}">${d.ecartTotal > 0 ? '+' : ''}${Math.round(d.ecartTotal).toLocaleString('fr-FR')} FCFA</span></div></div>`
        }

        // Inventaire
        if (d.invTotal > 0) {
          html += `<div class="volet"><div class="volet-h"><span>📦 Inventaire</span><span class="r">−${Math.round(d.invTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.invEnriched.forEach(inv => {
            const sl = SHIFT_LABELS[inv.type_shift] || inv.type_shift
            const parCat = {}
            inv.lignes.forEach(l => { const c = PRODUIT_TO_CAT[l.produit_id] || l.produit_nom; parCat[c] = (parCat[c] || 0) + (l.montant_deduit || 0) })
            const cats = Object.entries(parCat).filter(([, v]) => v > 0).map(([c, v]) => `${c} : ${Math.round(v).toLocaleString('fr-FR')} FCFA`).join(' · ')
            html += `<div class="item"><strong>${inv.caissier_nom} — ${sl}</strong>${cats ? ' — ' + cats : ''}</div>`
          })
          html += `</div>`
        }

        // Avis
        if (d.avis.length) {
          const ac = d.avisTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>👁 Avis clients (${d.avis.length})</span><span class="${ac}">${d.avisTotal > 0 ? '+' : ''}${Math.round(d.avisTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.avis.forEach(a => {
            const tl = TYPES_AVIS.find(t => t.key === a.type)?.label || a.type
            const mc = a.montant > 0 ? 'r' : 'g'
            html += `<div class="item">${a.numero_commande ? `<span class="cmd">#${a.numero_commande}</span> — ` : ''}${tl}${a.notes ? ` — ${a.notes}` : ''} <span class="${mc}"><strong>${a.montant > 0 ? '+' : ''}${Math.round(a.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Yango
        if (d.yango.length) {
          const yc = d.yangoTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>🛵 Yango (${d.yango.length})</span><span class="${yc}">${d.yangoTotal > 0 ? '+' : ''}${Math.round(d.yangoTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.yango.forEach(y => {
            const tl = TYPES_YANGO.find(t => t.key === y.type)?.label || y.type
            const mc = y.montant > 0 ? 'r' : 'g'
            html += `<div class="item">${y.numero_commande ? `<span class="cmd">#${y.numero_commande}</span> — ` : ''}${tl}${y.notes ? ` — ${y.notes}` : ''} <span class="${mc}"><strong>${y.montant > 0 ? '+' : ''}${Math.round(y.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Glovo
        if (d.glovo.length) {
          const gc = d.glovoTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>🟡 Glovo (${d.glovo.length})</span><span class="${gc}">${d.glovoTotal > 0 ? '+' : ''}${Math.round(d.glovoTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.glovo.forEach(g => {
            const tl = TYPES_GLOVO.find(t => t.key === g.type)?.label || g.type
            const mc = g.montant > 0 ? 'r' : 'g'
            html += `<div class="item">${g.numero_commande ? `<span class="cmd">#${g.numero_commande}</span> — ` : ''}${tl}${g.notes ? ` — ${g.notes}` : ''} <span class="${mc}"><strong>${g.montant > 0 ? '+' : ''}${Math.round(g.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        html += `</div>` // .resto
      }

      // Récap global
      const gtc = grandTotal > 0 ? '#C62828' : grandTotal < 0 ? '#2E7D32' : '#333'
      html += `<div class="recap"><div class="recap-h">📋 Récapitulatif global</div>`
      donneesGlobales.forEach(d => {
        const c = d.total > 0 ? '#C62828' : d.total < 0 ? '#2E7D32' : '#888'
        html += `<div class="recap-l"><span>${d.restaurant.nom}</span><span style="color:${c};font-weight:bold">${d.total > 0 ? '+' : ''}${Math.round(d.total).toLocaleString('fr-FR')} FCFA</span></div>`
      })
      html += `<div class="recap-l gt"><span>TOTAL GLOBAL</span><span style="color:${gtc}">${grandTotal > 0 ? '+' : ''}${Math.round(grandTotal).toLocaleString('fr-FR')} FCFA</span></div></div></body></html>`

      const { uri } = await Print.printToFileAsync({ html })
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Partager le rapport litiges',
        UTI: 'com.adobe.pdf',
      })
    } catch (e) {
      Alert.alert('Erreur PDF', e.message || 'Impossible de générer le PDF')
    } finally {
      setGeneratingPdf(false)
    }
  }

  // ── Render mode global ───────────────────────────────────────
  function renderModeGlobal() {
    if (!donneesGlobales.length) return (
      <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucune donnée pour cette période</Text></View>
    )
    const grandTotal = donneesGlobales.reduce((s, d) => s + d.total, 0)
    const gtc = grandTotal > 0 ? '#C62828' : grandTotal < 0 ? '#2E7D32' : colors.textMuted

    return (
      <View style={styles.section}>
        {/* Grand total + bouton PDF */}
        <View style={[styles.totalBanner, {
          backgroundColor: grandTotal > 0 ? '#FFF0F0' : grandTotal < 0 ? '#F0FFF4' : colors.surface,
          borderColor: grandTotal > 0 ? '#FFCDD2' : grandTotal < 0 ? '#C8E6C9' : colors.borderLight,
        }]}>
          <View>
            <Text style={styles.totalBannerLabel}>Total global — {plageLabel()}</Text>
            <Text style={styles.totalBannerLabel}>{donneesGlobales.length} restaurants</Text>
          </View>
          <Text style={[styles.totalBannerValue, { color: gtc }]}>
            {grandTotal > 0 ? '+' : ''}{fmt(grandTotal)}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.btnPdf, generatingPdf && { opacity: 0.6 }]}
          onPress={genererEtPartagePDF}
          disabled={generatingPdf}
        >
          <Text style={styles.btnPdfTxt}>{generatingPdf ? '⏳ Génération PDF...' : '📄 Télécharger & partager PDF'}</Text>
        </TouchableOpacity>

        {/* Un card par restaurant */}
        {donneesGlobales.map(d => {
          const tc = d.total > 0 ? '#C62828' : d.total < 0 ? '#2E7D32' : colors.textMuted
          const vide = !d.ecartTotal && !d.invTotal && !d.avis.length && !d.yango.length && !d.glovo.length
          return (
            <View key={d.restaurant.id} style={styles.restoGlobalCard}>
              {/* Header restaurant */}
              <View style={styles.restoGlobalHeader}>
                <Text style={styles.restoGlobalNom}>{d.restaurant.nom}</Text>
                <Text style={[styles.restoGlobalTotal, { color: tc }]}>
                  {d.total > 0 ? '+' : ''}{fmt(d.total)}
                </Text>
              </View>

              {vide ? (
                <Text style={[styles.ligneSous, { padding: 10, fontStyle: 'italic' }]}>✅ Aucun litige</Text>
              ) : (
                <View style={styles.restoGlobalBody}>
                  {/* Écart */}
                  {d.ecartTotal !== 0 && (
                    <View style={styles.globalVoletRow}>
                      <Text style={styles.globalVoletLabel}>📊 Écart point</Text>
                      <Text style={[styles.globalVoletVal, { color: d.ecartTotal > 0 ? '#C62828' : '#2E7D32' }]}>
                        {d.ecartTotal > 0 ? '+' : ''}{fmtShort(d.ecartTotal)}
                      </Text>
                    </View>
                  )}
                  {/* Inventaire */}
                  {d.invTotal > 0 && (
                    <View style={styles.globalVoletRow}>
                      <Text style={styles.globalVoletLabel}>📦 Inventaire</Text>
                      <Text style={[styles.globalVoletVal, { color: '#C62828' }]}>−{fmtShort(d.invTotal)}</Text>
                    </View>
                  )}
                  {/* Avis */}
                  {d.avis.map(a => {
                    const type = TYPES_AVIS.find(t => t.key === a.type)
                    return (
                      <View key={a.id} style={styles.globalItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.globalItemTxt} numberOfLines={2}>
                            {type?.label || a.type}
                            {a.numero_commande ? <Text style={styles.globalItemCmd}> #{a.numero_commande}</Text> : null}
                            {a.notes ? ` — ${a.notes}` : ''}
                          </Text>
                        </View>
                        <Text style={[styles.globalItemMontant, { color: a.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                          {a.montant > 0 ? '+' : ''}{fmtShort(a.montant)}
                        </Text>
                      </View>
                    )
                  })}
                  {/* Yango */}
                  {d.yango.map(y => {
                    const type = TYPES_YANGO.find(t => t.key === y.type)
                    return (
                      <View key={y.id} style={styles.globalItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.globalItemTxt} numberOfLines={2}>
                            🛵 {type?.label || y.type}
                            {y.numero_commande ? <Text style={styles.globalItemCmd}> #{y.numero_commande}</Text> : null}
                            {y.notes ? ` — ${y.notes}` : ''}
                          </Text>
                        </View>
                        <Text style={[styles.globalItemMontant, { color: y.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                          {y.montant > 0 ? '+' : ''}{fmtShort(y.montant)}
                        </Text>
                      </View>
                    )
                  })}
                  {/* Glovo */}
                  {d.glovo.map(g => {
                    const type = TYPES_GLOVO.find(t => t.key === g.type)
                    return (
                      <View key={g.id} style={styles.globalItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.globalItemTxt} numberOfLines={2}>
                            🟡 {type?.label || g.type}
                            {g.numero_commande ? <Text style={styles.globalItemCmd}> #{g.numero_commande}</Text> : null}
                            {g.notes ? ` — ${g.notes}` : ''}
                          </Text>
                        </View>
                        <Text style={[styles.globalItemMontant, { color: g.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                          {g.montant > 0 ? '+' : ''}{fmtShort(g.montant)}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          )
        })}
      </View>
    )
  }

  // ── KPI totaux ──────────────────────────────────────────────
  const totalEcart = ecartsListe.reduce((s, j) => s + j.ecart, 0)
  const totalInventaire = inventaireShifts.reduce((s, x) => s + (x.montant_a_deduire || 0), 0)
  const totalAvis = avisClients.reduce((s, x) => s + (x.montant || 0), 0)
  const totalYango = litigesYango.reduce((s, x) => s + (x.montant || 0), 0)
  const totalGlovo = litigesGlovo.reduce((s, x) => s + (x.montant || 0), 0)
  const totalContact = ecartContacts.reduce((s, x) => s + x.litige, 0)
  const totalGlobal = totalEcart + totalInventaire + totalAvis + totalYango + totalGlovo + totalContact

  // ── Sauvegarde ───────────────────────────────────────────────
  async function sauvegarderAvis() {
    if (!restoSelectionne) return
    setSaving(true)
    const montant = formAvis.type === 'bon' ? -500 : 1000
    const dateToSave = formAvis.date_saisie || TODAY
    if (formAvis.id) {
      await supabase.from('litiges_avis_clients').update({
        type: formAvis.type, montant,
        notes: formAvis.notes || null,
        numero_commande: formAvis.numero_commande || null,
        date: dateToSave,
      }).eq('id', formAvis.id)
    } else {
      await supabase.from('litiges_avis_clients').insert({
        restaurant_id: restoSelectionne.id,
        date: dateToSave,
        type: formAvis.type, montant,
        notes: formAvis.notes || null,
        numero_commande: formAvis.numero_commande || null,
        created_by: userNom || userId,
      })
    }
    setSaving(false)
    setShowFormAvis(false)
    chargerAvis()
  }

  async function sauvegarderYango() {
    const montant = parseFloat(formYango.montant) || 0
    if (!montant || !restoSelectionne) return
    setSaving(true)
    const dateToSave = formYango.date_saisie || TODAY
    if (formYango.id) {
      await supabase.from('litiges_yango').update({
        type: formYango.type, montant,
        notes: formYango.notes || null,
        numero_commande: formYango.numero_commande || null,
        date: dateToSave,
      }).eq('id', formYango.id)
    } else {
      await supabase.from('litiges_yango').insert({
        restaurant_id: restoSelectionne.id,
        date: dateToSave,
        type: formYango.type, montant,
        notes: formYango.notes || null,
        numero_commande: formYango.numero_commande || null,
        created_by: userNom || userId,
      })
    }
    setSaving(false)
    setShowFormYango(false)
    chargerYango()
  }

  async function sauvegarderGlovo() {
    const montant = parseFloat(formGlovo.montant) || 0
    if (!montant || !restoSelectionne) return
    setSaving(true)
    const dateToSave = formGlovo.date_saisie || TODAY
    if (formGlovo.id) {
      await supabase.from('litiges_glovo').update({
        type: formGlovo.type, montant,
        notes: formGlovo.notes || null,
        numero_commande: formGlovo.numero_commande || null,
        date: dateToSave,
      }).eq('id', formGlovo.id)
    } else {
      await supabase.from('litiges_glovo').insert({
        restaurant_id: restoSelectionne.id,
        date: dateToSave,
        type: formGlovo.type, montant,
        notes: formGlovo.notes || null,
        numero_commande: formGlovo.numero_commande || null,
        created_by: userNom || userId,
      })
    }
    setSaving(false)
    setShowFormGlovo(false)
    chargerGlovo()
  }

  async function supprimerItem() {
    if (!confirmSuppr) return
    setSaving(true)
    const { table, id } = confirmSuppr
    await supabase.from(table).delete().eq('id', id)
    setSaving(false)
    setConfirmSuppr(null)
    if (table === 'litiges_avis_clients') chargerAvis()
    else if (table === 'litiges_yango') chargerYango()
    else chargerGlovo()
  }

  // ── Helpers UI ───────────────────────────────────────────────
  const multiJour = periodeKey !== '1jour'

  function ouvrirAddAvis() {
    setFormAvis({ type: 'mauvais', notes: '', numero_commande: '', date_saisie: formDateDefaut(periodeKey, dateUnique), id: null })
    setShowFormAvis(true)
  }
  function ouvrirEditAvis(a) {
    setFormAvis({ type: a.type, notes: a.notes || '', numero_commande: a.numero_commande || '', date_saisie: a.date || TODAY, id: a.id })
    setShowFormAvis(true)
  }
  function ouvrirAddYango() {
    setFormYango({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: formDateDefaut(periodeKey, dateUnique), id: null })
    setShowFormYango(true)
  }
  function ouvrirEditYango(y) {
    setFormYango({ type: y.type, montant: y.montant?.toString() || '', notes: y.notes || '', numero_commande: y.numero_commande || '', date_saisie: y.date || TODAY, id: y.id })
    setShowFormYango(true)
  }
  function ouvrirAddGlovo() {
    setFormGlovo({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: formDateDefaut(periodeKey, dateUnique), id: null })
    setShowFormGlovo(true)
  }
  function ouvrirEditGlovo(g) {
    setFormGlovo({ type: g.type, montant: g.montant?.toString() || '', notes: g.notes || '', numero_commande: g.numero_commande || '', date_saisie: g.date || TODAY, id: g.id })
    setShowFormGlovo(true)
  }

  // ── Render volets ────────────────────────────────────────────
  function renderEcarts() {
    if (!ecartsListe.length) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTxt}>Aucun point trouvé pour cette période</Text>
          <Text style={styles.emptySubTxt}>Sélectionnez une période avec des points enregistrés</Text>
        </View>
      )
    }

    // Vue 1 jour : grande carte
    if (!multiJour && ecartsListe.length === 1) {
      const item = ecartsListe[0]
      const c = item.ecart > 0 ? '#C62828' : item.ecart < 0 ? '#F57F17' : '#2E7D32'
      return (
        <View style={styles.section}>
          <View style={styles.kpiRow}>
            <View style={[styles.kpiBox, { flex: 1 }]}>
              <Text style={styles.kpiLabel}>Vente machine</Text>
              <Text style={[styles.kpiValue, { color: colors.text }]}>{fmt(item.venteMachine)}</Text>
            </View>
            <View style={[styles.kpiBox, { flex: 1 }]}>
              <Text style={styles.kpiLabel}>Cumul shifts ({item.nbShifts})</Text>
              <Text style={[styles.kpiValue, { color: colors.text }]}>{fmt(item.cumulShifts)}</Text>
            </View>
          </View>
          <View style={[styles.ecartCard, {
            backgroundColor: item.ecart !== 0 ? (item.ecart > 0 ? '#FFF0F0' : '#FFF8E1') : '#F0FFF4',
            borderColor: c + '44',
          }]}>
            <Text style={styles.ecartLabel}>Écart constaté</Text>
            <Text style={[styles.ecartValeur, { color: c }]}>{item.ecart > 0 ? '+' : ''}{fmt(item.ecart)}</Text>
            <Text style={[styles.ecartSous, { color: c }]}>
              {item.ecart > 0 ? 'Machine supérieure aux shifts déclarés'
                : item.ecart < 0 ? 'Shifts supérieurs à la machine'
                : '✅ Aucun écart — tout est aligné'}
            </Text>
          </View>
        </View>
      )
    }

    // Vue multi-jour : liste
    const c = totalEcart > 0 ? '#C62828' : totalEcart < 0 ? '#F57F17' : '#2E7D32'
    return (
      <View style={styles.section}>
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Écart total période</Text>
          <Text style={[styles.totalBannerValue, { color: c }]}>{totalEcart > 0 ? '+' : ''}{fmt(totalEcart)}</Text>
        </View>
        {ecartsListe.map(j => {
          const cj = j.ecart > 0 ? '#C62828' : j.ecart < 0 ? '#F57F17' : '#2E7D32'
          return (
            <View key={j.date} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ligneNom}>{j.date}</Text>
                <Text style={styles.ligneSous}>Machine {fmtShort(j.venteMachine)} — Shifts {fmtShort(j.cumulShifts)} ({j.nbShifts})</Text>
              </View>
              <Text style={[styles.montantTxt, { color: cj }]}>{j.ecart > 0 ? '+' : ''}{fmtShort(j.ecart)}</Text>
            </View>
          )
        })}
      </View>
    )
  }

  function renderInventaire() {
    if (!inventaireShifts.length) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTxt}>Aucune déduction inventaire validée</Text>
          <Text style={styles.emptySubTxt}>Les déductions apparaissent quand un shift inventaire est validé</Text>
        </View>
      )
    }

    return (
      <View style={styles.section}>
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Total déductions inventaire</Text>
          <Text style={[styles.totalBannerValue, { color: '#C62828' }]}>{fmt(totalInventaire)}</Text>
        </View>
        {inventaireShifts.map(inv => {
          const shiftLabel = SHIFT_LABELS[inv.type_shift] || inv.type_shift || 'Shift'
          // Grouper les lignes par catégorie
          const parCat = {}
          inv.lignes.forEach(l => {
            const cat = PRODUIT_TO_CAT[l.produit_id] || l.produit_nom || '?'
            parCat[cat] = (parCat[cat] || 0) + (l.montant_deduit || 0)
          })
          const catEntries = Object.entries(parCat).filter(([, v]) => v > 0)

          return (
            <View key={inv.id} style={[styles.ligneCard, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
              {/* En-tête shift */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={styles.ligneNom}>{inv.caissier_nom} — {shiftLabel}</Text>
                  {multiJour && inv.date ? <Text style={styles.ligneSous}>📅 {inv.date}</Text> : null}
                </View>
                <Text style={[styles.montantTxt, { color: '#C62828' }]}>−{fmtShort(inv.montant_a_deduire)}</Text>
              </View>
              {/* Détail par catégorie */}
              {catEntries.length > 0 && (
                <View style={styles.catDetail}>
                  {catEntries.map(([cat, montant]) => (
                    <View key={cat} style={styles.catLigne}>
                      <Text style={styles.catNom}>{cat}</Text>
                      <Text style={styles.catMontant}>{fmtShort(montant)} FCFA</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        })}
      </View>
    )
  }

  function renderAvis() {
    return (
      <View style={styles.section}>
        {avisClients.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total avis</Text>
            <Text style={[styles.totalBannerValue, { color: totalAvis > 0 ? '#C62828' : '#2E7D32' }]}>
              {totalAvis > 0 ? '+' : ''}{fmt(totalAvis)}
            </Text>
          </View>
        )}
        {avisClients.map(a => {
          const type = TYPES_AVIS.find(t => t.key === a.type)
          return (
            <View key={a.id} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || a.type}</Text>
                {a.numero_commande ? <Text style={styles.ligneCmd}>🔖 Cmd #{a.numero_commande}</Text> : null}
                {multiJour && a.date ? <Text style={styles.ligneSous}>📅 {a.date}</Text> : null}
                {a.notes ? <Text style={styles.ligneSous}>{a.notes}</Text> : null}
                {a.created_by ? <Text style={styles.ligneCreer}>par {a.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: a.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                  {a.montant > 0 ? '+' : ''}{fmtShort(a.montant)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => ouvrirEditAvis(a)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_avis_clients', id: a.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )
        })}
        {!avisClients.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun avis enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddAvis}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un avis client</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderYango() {
    return (
      <View style={styles.section}>
        {litigesYango.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total Yango</Text>
            <Text style={[styles.totalBannerValue, { color: totalYango > 0 ? '#C62828' : '#2E7D32' }]}>
              {totalYango > 0 ? '+' : ''}{fmt(totalYango)}
            </Text>
          </View>
        )}
        {litigesYango.map(y => {
          const type = TYPES_YANGO.find(t => t.key === y.type)
          return (
            <View key={y.id} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || y.type}</Text>
                {y.numero_commande ? <Text style={styles.ligneCmd}>🔖 Cmd #{y.numero_commande}</Text> : null}
                {multiJour && y.date ? <Text style={styles.ligneSous}>📅 {y.date}</Text> : null}
                {y.notes ? <Text style={styles.ligneSous}>{y.notes}</Text> : null}
                {y.created_by ? <Text style={styles.ligneCreer}>par {y.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: y.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                  {y.montant > 0 ? '+' : ''}{fmtShort(y.montant)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => ouvrirEditYango(y)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_yango', id: y.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )
        })}
        {!litigesYango.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun litige Yango enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddYango}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un litige Yango</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderGlovo() {
    return (
      <View style={styles.section}>
        {litigesGlovo.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total Glovo</Text>
            <Text style={[styles.totalBannerValue, { color: totalGlovo > 0 ? '#C62828' : '#2E7D32' }]}>
              {totalGlovo > 0 ? '+' : ''}{fmt(totalGlovo)}
            </Text>
          </View>
        )}
        {litigesGlovo.map(g => {
          const type = TYPES_GLOVO.find(t => t.key === g.type)
          return (
            <View key={g.id} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || g.type}</Text>
                {g.numero_commande ? <Text style={styles.ligneCmd}>🔖 Cmd #{g.numero_commande}</Text> : null}
                {multiJour && g.date ? <Text style={styles.ligneSous}>📅 {g.date}</Text> : null}
                {g.notes ? <Text style={styles.ligneSous}>{g.notes}</Text> : null}
                {g.created_by ? <Text style={styles.ligneCreer}>par {g.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: g.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                  {g.montant > 0 ? '+' : ''}{fmtShort(g.montant)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => ouvrirEditGlovo(g)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_glovo', id: g.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )
        })}
        {!litigesGlovo.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun litige Glovo enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddGlovo}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un litige Glovo</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderEcartContacts() {
    const multiJour = periodeKey !== '1jour'
    const avecLitige = ecartContacts.filter(x => x.litige > 0)
    return (
      <View style={styles.section}>
        {totalContact > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Total litige contacts</Text>
            <Text style={[styles.totalBannerValue, { color: '#C62828' }]}>{fmt(totalContact)}</Text>
          </View>
        )}
        {ecartContacts.length === 0 ? (
          <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun shift trouvé sur cette période</Text></View>
        ) : (
          ecartContacts.map((item, idx) => {
            const parfait = item.taux === 0
            const tolere = item.taux > 0 && item.taux <= 20
            const litige = item.taux > 20
            return (
              <View key={idx} style={[styles.ligneCard, litige && { borderColor: '#C62828', borderWidth: 1 }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  {multiJour && item.date ? (
                    <Text style={styles.ligneSous}>📅 {item.date}</Text>
                  ) : null}
                  <Text style={[styles.ligneNom, { color: colors.text }]}>
                    👤 {item.caissierNom}{item.heureDebut ? ` — ${item.heureDebut}→${item.heureFin}` : ''}
                  </Text>
                  <Text style={styles.ligneSous}>
                    Commandes : {item.nbCommandes}  ·  Contacts : {item.nbContacts}  ·  Écart : {item.ecart}  ·  Taux : {item.taux}%
                  </Text>
                  {parfait && <Text style={{ fontSize: 12, color: '#2E7D32', fontWeight: '600' }}>✅ Parfait</Text>}
                  {tolere && <Text style={{ fontSize: 12, color: '#F57F17', fontWeight: '600' }}>✅ Toléré</Text>}
                  {litige && (
                    <Text style={{ fontSize: 12, color: '#C62828', fontWeight: '600' }}>
                      ⚠️ Litige : {item.ecart} × 500 = {fmtShort(item.litige)}
                    </Text>
                  )}
                </View>
                {litige && (
                  <Text style={[styles.montantTxt, { color: '#C62828' }]}>{fmtShort(item.litige)}</Text>
                )}
              </View>
            )
          })
        )}
        {ecartContacts.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
            <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '600' }}>Total litige contacts</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: totalContact > 0 ? '#C62828' : '#2E7D32' }}>
              {totalContact > 0 ? fmtShort(totalContact) : '0 FCFA ✅'}
            </Text>
          </View>
        )}
      </View>
    )
  }

  // ── Label plage affichée ─────────────────────────────────────
  function plageLabel() {
    if (periodeKey === '1jour') return dateUnique
    return `${plage.debut} → ${plage.fin}`
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>⚖️ Litiges</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Restaurant */}
      <View style={styles.restoRow}>
        <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoTxt} numberOfLines={1}>
            {modeGlobal ? '🌐 Tous les restaurants' : '🏪 ' + (restoSelectionne?.nom || 'Restaurant...')}
          </Text>
          <Text style={styles.restoArrow}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Sélecteur de période */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodeScroll} contentContainerStyle={styles.periodeContent}>
        {PERIODES.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodePill, periodeKey === p.key && styles.periodePillActive]}
            onPress={() => setPeriodeKey(p.key)}
          >
            <Text style={[styles.periodePillTxt, periodeKey === p.key && styles.periodePillTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Date(s) sélectionnée(s) */}
      <View style={styles.dateRow}>
        {periodeKey === '1jour' ? (
          <TouchableOpacity style={styles.datePill} onPress={() => setShowCalUnique(true)}>
            <Text style={styles.datePillTxt}>📅 {dateUnique}</Text>
          </TouchableOpacity>
        ) : periodeKey === 'perso' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity style={styles.datePill} onPress={() => setShowCalDebut(true)}>
              <Text style={styles.datePillTxt}>Du {dateDebut}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textMuted, fontSize: 14 }}>→</Text>
            <TouchableOpacity style={styles.datePill} onPress={() => setShowCalFin(true)}>
              <Text style={styles.datePillTxt}>Au {dateFin}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.datePill}>
            <Text style={styles.datePillTxt}>📅 {plage.debut} → {plage.fin}</Text>
          </View>
        )}
      </View>

      {/* KPI global — masqué en mode tous restaurants */}
      {!modeGlobal && restoSelectionne && (
        <View style={[styles.kpiGlobal, {
          backgroundColor: totalGlobal > 0 ? '#FFF0F0' : totalGlobal < 0 ? '#F0FFF4' : colors.surface,
          borderColor: totalGlobal > 0 ? '#FFCDD2' : totalGlobal < 0 ? '#C8E6C9' : colors.borderLight,
        }]}>
          <Text style={styles.kpiGlobalLabel}>Impact total — {plageLabel()}</Text>
          <Text style={[styles.kpiGlobalValue, {
            color: totalGlobal > 0 ? '#C62828' : totalGlobal < 0 ? '#2E7D32' : colors.textMuted,
          }]}>
            {totalGlobal > 0 ? '+' : ''}{fmt(totalGlobal)}
          </Text>
        </View>
      )}

      {/* Onglets — masqués en mode tous restaurants */}
      {!modeGlobal && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
          {ONGLETS.map(o => (
            <TouchableOpacity key={o.key} style={[styles.tab, onglet === o.key && styles.tabActive]} onPress={() => setOnglet(o.key)}>
              <Text style={[styles.tabTxt, onglet === o.key && styles.tabTxtActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Contenu */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color='#185FA5' />
      ) : modeGlobal ? (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
          {renderModeGlobal()}
        </ScrollView>
      ) : !restoSelectionne ? (
        <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Sélectionnez un restaurant</Text></View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
          {onglet === 'ecarts' && renderEcarts()}
          {onglet === 'inventaire' && renderInventaire()}
          {onglet === 'avis' && renderAvis()}
          {onglet === 'yango' && renderYango()}
          {onglet === 'glovo' && renderGlovo()}
          {onglet === 'contact' && renderEcartContacts()}
        </ScrollView>
      )}

      {/* ── Modal Restaurant ── */}
      <Modal visible={showRestoPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowRestoPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerBox}>
            <Text style={styles.pickerTitre}>Sélectionner un restaurant</Text>
            <ScrollView>
              {/* Option "Tous les restaurants" */}
              <TouchableOpacity
                style={[styles.pickerLigne, modeGlobal && styles.pickerLigneActive, { borderBottomWidth: 1, borderBottomColor: '#e0e0e0' }]}
                onPress={() => { setModeGlobal(true); setRestoSelectionne(null); setShowRestoPicker(false) }}
              >
                <Text style={[styles.pickerLigneTxt, modeGlobal && { color: '#534AB7', fontWeight: '700' }]}>🌐 Tous les restaurants</Text>
              </TouchableOpacity>
              {restaurants.map(r => (
                <TouchableOpacity key={r.id}
                  style={[styles.pickerLigne, !modeGlobal && restoSelectionne?.id === r.id && styles.pickerLigneActive]}
                  onPress={() => { setModeGlobal(false); setRestoSelectionne(r); chargerDatesAvec(r.id); setShowRestoPicker(false) }}
                >
                  <Text style={[styles.pickerLigneTxt, !modeGlobal && restoSelectionne?.id === r.id && { color: '#185FA5', fontWeight: '600' }]}>{r.nom}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier 1 jour ── */}
      <Modal visible={showCalUnique} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalUnique(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <Calendar
              current={dateUnique}
              onDayPress={day => { setDateUnique(day.dateString); setShowCalUnique(false) }}
              markedDates={{ ...datesAvec, [dateUnique]: { selected: true, selectedColor: '#185FA5' } }}
              theme={{ selectedDayBackgroundColor: '#185FA5', todayTextColor: '#185FA5', arrowColor: '#185FA5' }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier Début (perso) ── */}
      <Modal visible={showCalDebut} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalDebut(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <Calendar
              current={dateDebut}
              onDayPress={day => { setDateDebut(day.dateString); setShowCalDebut(false) }}
              markedDates={{ [dateDebut]: { selected: true, selectedColor: '#185FA5' } }}
              theme={{ selectedDayBackgroundColor: '#185FA5', todayTextColor: '#185FA5', arrowColor: '#185FA5' }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier Fin (perso) ── */}
      <Modal visible={showCalFin} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalFin(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <Calendar
              current={dateFin}
              onDayPress={day => { setDateFin(day.dateString); setShowCalFin(false) }}
              markedDates={{ [dateFin]: { selected: true, selectedColor: '#185FA5' } }}
              theme={{ selectedDayBackgroundColor: '#185FA5', todayTextColor: '#185FA5', arrowColor: '#185FA5' }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal Avis Client ── */}
      <Modal visible={showFormAvis} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formAvis.id ? "Modifier l'avis" : 'Ajouter un avis client'}</Text>

            <Text style={styles.formLabel}>Type d'avis</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {TYPES_AVIS.map(t => (
                <TouchableOpacity key={t.key}
                  style={[styles.typeBtn, { flex: 1 }, formAvis.type === t.key && { backgroundColor: t.couleur, borderColor: t.couleur }]}
                  onPress={() => setFormAvis(p => ({ ...p, type: t.key }))}
                >
                  <Text style={[styles.typeBtnTxt, formAvis.type === t.key && { color: '#fff' }]}>{t.label}</Text>
                  <Text style={[styles.typeBtnMontant, formAvis.type === t.key && { color: '#ffffffbb' }]}>
                    {t.montant > 0 ? '+' : ''}{t.montant} FCFA
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>N° de commande (optionnel)</Text>
            <TextInput style={styles.formInput} value={formAvis.numero_commande}
              onChangeText={v => setFormAvis(p => ({ ...p, numero_commande: v }))}
              placeholder="Ex: 48291" placeholderTextColor="#bbb" keyboardType="default" />

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formAvis.date_saisie}
              onChangeText={v => setFormAvis(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.formInput, { height: 56 }]} value={formAvis.notes}
              onChangeText={v => setFormAvis(p => ({ ...p, notes: v }))}
              placeholder="Détails du litige..." placeholderTextColor="#bbb" multiline />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setShowFormAvis(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderAvis} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Yango ── */}
      <Modal visible={showFormYango} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formYango.id ? 'Modifier Yango' : 'Ajouter litige Yango'}</Text>

            <Text style={styles.formLabel}>Type</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {TYPES_YANGO.map(t => (
                <TouchableOpacity key={t.key}
                  style={[styles.typeBtn, { flex: 1 }, formYango.type === t.key && { backgroundColor: t.couleur, borderColor: t.couleur }]}
                  onPress={() => setFormYango(p => ({ ...p, type: t.key }))}
                >
                  <Text style={[styles.typeBtnTxt, formYango.type === t.key && { color: '#fff' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>N° de commande (optionnel)</Text>
            <TextInput style={styles.formInput} value={formYango.numero_commande}
              onChangeText={v => setFormYango(p => ({ ...p, numero_commande: v }))}
              placeholder="Ex: 48291" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Montant (FCFA)</Text>
            <TextInput style={styles.formInput} value={formYango.montant}
              onChangeText={v => setFormYango(p => ({ ...p, montant: v }))}
              placeholder="Ex: 2500" placeholderTextColor="#bbb" keyboardType="numeric" />

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formYango.date_saisie}
              onChangeText={v => setFormYango(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={styles.formInput} value={formYango.notes}
              onChangeText={v => setFormYango(p => ({ ...p, notes: v }))}
              placeholder="Détails..." placeholderTextColor="#bbb" />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setShowFormYango(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderYango} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Glovo ── */}
      <Modal visible={showFormGlovo} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formGlovo.id ? 'Modifier Glovo' : 'Ajouter litige Glovo'}</Text>

            <Text style={styles.formLabel}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {TYPES_GLOVO.map(t => (
                  <TouchableOpacity key={t.key}
                    style={[styles.typeBtn, formGlovo.type === t.key && { backgroundColor: t.couleur, borderColor: t.couleur }]}
                    onPress={() => setFormGlovo(p => ({ ...p, type: t.key }))}
                  >
                    <Text style={[styles.typeBtnTxt, formGlovo.type === t.key && { color: '#fff' }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.formLabel}>N° de commande (optionnel)</Text>
            <TextInput style={styles.formInput} value={formGlovo.numero_commande}
              onChangeText={v => setFormGlovo(p => ({ ...p, numero_commande: v }))}
              placeholder="Ex: 48291" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Montant (FCFA)</Text>
            <TextInput style={styles.formInput} value={formGlovo.montant}
              onChangeText={v => setFormGlovo(p => ({ ...p, montant: v }))}
              placeholder="Ex: 2500" placeholderTextColor="#bbb" keyboardType="numeric" />

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formGlovo.date_saisie}
              onChangeText={v => setFormGlovo(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={styles.formInput} value={formGlovo.notes}
              onChangeText={v => setFormGlovo(p => ({ ...p, notes: v }))}
              placeholder="Détails..." placeholderTextColor="#bbb" />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setShowFormGlovo(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderGlovo} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Confirmation Suppression ── */}
      <Modal visible={!!confirmSuppr} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.formModal, { alignItems: 'center', gap: 16 }]}>
            <Text style={[styles.formTitre, { color: '#C62828' }]}>Supprimer cet élément ?</Text>
            <Text style={{ fontSize: 13, color: '#666', textAlign: 'center' }}>Cette action est irréversible.</Text>
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setConfirmSuppr(null)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnValider, { backgroundColor: '#C62828' }]} onPress={supprimerItem} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Supprimer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#534AB7',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 28, color: '#fff', lineHeight: 32 },
  headerTitre: { fontSize: 17, fontWeight: '700', color: '#fff' },

  restoRow: {
    padding: 10, paddingBottom: 6,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  restoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 0.5, borderColor: colors.border,
  },
  restoTxt: { fontSize: 14, color: colors.text, fontWeight: '500', flex: 1 },
  restoArrow: { fontSize: 12, color: colors.textMuted, marginLeft: 6 },

  periodeScroll: { maxHeight: 44, backgroundColor: colors.surface },
  periodeContent: { paddingHorizontal: 10, paddingVertical: 7, gap: 6, alignItems: 'center' },
  periodePill: {
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
    backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border,
  },
  periodePillActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  periodePillTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  periodePillTxtActive: { color: '#fff', fontWeight: '600' },

  dateRow: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
    flexDirection: 'row',
  },
  datePill: {
    backgroundColor: '#EBF3FF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 0.5, borderColor: '#B8D4F5',
  },
  datePillTxt: { fontSize: 12, color: '#185FA5', fontWeight: '600' },

  kpiGlobal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 10, marginTop: 8, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9, borderWidth: 0.5,
  },
  kpiGlobalLabel: { fontSize: 11, color: '#666', fontWeight: '500' },
  kpiGlobalValue: { fontSize: 17, fontWeight: '800' },

  tabsScroll: { maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  tabsContent: { paddingHorizontal: 10, paddingVertical: 6, gap: 6, alignItems: 'center' },
  tab: {
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
  },
  tabActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  tabTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  tabTxtActive: { color: '#fff', fontWeight: '600' },

  body: { flex: 1, padding: 10 },
  section: { gap: 10 },

  kpiRow: { flexDirection: 'row', gap: 10 },
  kpiBox: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4, fontWeight: '500' },
  kpiValue: { fontSize: 16, fontWeight: '700' },

  ecartCard: { borderRadius: 14, padding: 18, alignItems: 'center', gap: 6, borderWidth: 1 },
  ecartLabel: { fontSize: 12, color: '#666', fontWeight: '500' },
  ecartValeur: { fontSize: 28, fontWeight: '800' },
  ecartSous: { fontSize: 12, fontWeight: '500', textAlign: 'center' },

  totalBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  totalBannerLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  totalBannerValue: { fontSize: 17, fontWeight: '700' },

  ligneCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  ligneNom: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  ligneCmd: { fontSize: 12, color: '#185FA5', fontWeight: '500', marginBottom: 2 },
  ligneSous: { fontSize: 12, color: colors.textMuted },
  ligneCreer: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  montantTxt: { fontSize: 15, fontWeight: '700' },
  btnAction: { fontSize: 17 },

  catDetail: {
    backgroundColor: colors.bg, borderRadius: 8, padding: 10,
    borderWidth: 0.5, borderColor: colors.borderLight, gap: 4,
  },
  catLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catNom: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  catMontant: { fontSize: 12, fontWeight: '700', color: '#C62828' },

  emptyBox: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySubTxt: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },

  btnAjout: {
    backgroundColor: '#185FA5', borderRadius: 12, padding: 14,
    alignItems: 'center', marginTop: 4,
  },
  btnAjoutTxt: { fontSize: 14, color: '#fff', fontWeight: '600' },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 18,
  },
  pickerBox: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', maxHeight: 420 },
  pickerTitre: {
    fontSize: 14, fontWeight: '700', color: colors.textMuted,
    padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  pickerLigne: { padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  pickerLigneActive: { backgroundColor: '#EBF3FF' },
  pickerLigneTxt: { fontSize: 15, color: colors.text },

  formModal: { backgroundColor: colors.surface, borderRadius: 20, padding: 20 },
  formTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
  formLabel: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6,
  },
  formInput: {
    backgroundColor: colors.bg, borderRadius: 10, padding: 12,
    fontSize: 15, color: colors.text, marginBottom: 12,
    borderWidth: 0.5, borderColor: colors.border,
  },
  formBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },

  typeBtn: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg, alignItems: 'center',
  },
  typeBtnTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  typeBtnMontant: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  btnAnnuler: {
    flex: 1, padding: 13, borderRadius: 10,
    backgroundColor: colors.bg, alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.border,
  },
  btnAnnulerTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  btnValider: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: '#185FA5', alignItems: 'center' },
  btnValiderTxt: { fontSize: 14, color: '#fff', fontWeight: '600' },

  btnPdf: {
    backgroundColor: '#534AB7', borderRadius: 12, padding: 14,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  btnPdfTxt: { fontSize: 14, color: '#fff', fontWeight: '700' },

  restoGlobalCard: {
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 0.5, borderColor: colors.borderLight, overflow: 'hidden',
  },
  restoGlobalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#534AB7', paddingHorizontal: 14, paddingVertical: 10,
  },
  restoGlobalNom: { fontSize: 14, fontWeight: '700', color: '#fff', flex: 1 },
  restoGlobalTotal: { fontSize: 14, fontWeight: '800', color: '#fff' },
  restoGlobalBody: { padding: 10, gap: 6 },

  globalVoletRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: 4,
    borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  globalVoletLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  globalVoletVal: { fontSize: 13, fontWeight: '700' },

  globalItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4, paddingLeft: 10,
    borderLeftWidth: 2, borderLeftColor: colors.borderLight,
    marginLeft: 4,
  },
  globalItemTxt: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  globalItemCmd: { fontSize: 12, color: '#185FA5', fontWeight: '600' },
  globalItemMontant: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
}) }
