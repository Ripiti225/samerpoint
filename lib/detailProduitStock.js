// ─────────────────────────────────────────────────────────────────────────
//  DÉTAIL DES MOUVEMENTS D'UN PRODUIT
//
//  Alimente le mode « un seul produit » de l'écran Gestion de stock : pour un
//  produit, un restaurant (ou tous) et une période, la liste shift par shift
//  du stock initial, des entrées, des sorties, du stock final et de l'écart.
//
//  L'apport principal est la ventilation des entrées PAR FOURNISSEUR, tirée
//  de `entrees_shift` : cette information existe en base depuis l'origine
//  mais n'était affichée nulle part.
//
//  ⚠️ Comme partout ailleurs, les lectures sont paginées : Supabase plafonne
//  à 1000 lignes sans lever d'erreur (inventaire_lignes compte ~42 000 lignes).
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { normaliserPourPdf as T } from './pdfTexte'
import { enregistrer } from './exportRapportMensuel'

const PAGE = 1000
const MAX_PAGES = 60
const LOT_IDS = 60

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

async function fetchPagine(construire, colonneTri = 'id') {
  const lignes = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const debut = page * PAGE
    const { data, error } = await construire()
      .order(colonneTri, { ascending: true })
      .range(debut, debut + PAGE - 1)
    if (error) throw error
    const lot = data || []
    lignes.push(...lot)
    if (lot.length < PAGE) break
  }
  return lignes
}

/** Libellé lisible d'un shift, et son rang chronologique pour le tri. */
const ORDRE_SHIFT = ['matin', 'midi', 'soir', 'nuit']
function libelleShift(type) {
  if (!type) return '—'
  const t = String(type).toLowerCase()
  for (const s of ORDRE_SHIFT) if (t.includes(s)) return s[0].toUpperCase() + s.slice(1)
  if (t === '1') return 'Midi'
  if (t === '2') return 'Soir'
  return String(type)
}
// Trier sur le libellé donnerait « Soir » avant « matin » : on classe sur le
// moment de la journée, pas sur l'alphabet.
function rangShift(libelle) {
  const i = ORDRE_SHIFT.indexOf(String(libelle).toLowerCase())
  return i === -1 ? ORDRE_SHIFT.length : i
}

export function formaterDateFr(iso) {
  if (!iso) return '—'
  const [a, m, j] = String(iso).slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

/**
 * Charge le détail d'un produit.
 * `restaurantId` à null = tous les restaurants.
 */
export async function chargerDetailProduit({ produitId, produitNom, restaurantId, debut, fin }) {
  const [lignes, restaurants, utilisateurs] = await Promise.all([
    fetchPagine(() => {
      let q = supabase.from('inventaire_lignes')
        .select('id, inventaire_id, produit_id, produit_nom, stock_initial, entrees, ' +
          'sorties, stock_reel, ecart, montant_deduit, deduction_annulee, ' +
          'inventaires_shifts!inner(id, date, restaurant_id, type_shift, caissier_id, valide)')
        .eq('produit_id', produitId)
        .gte('inventaires_shifts.date', debut)
        .lte('inventaires_shifts.date', fin)
      if (restaurantId) q = q.eq('inventaires_shifts.restaurant_id', restaurantId)
      return q
    }),
    fetchPagine(() => supabase.from('restaurants').select('id, nom'), 'nom'),
    fetchPagine(() => supabase.from('utilisateurs').select('id, nom'), 'nom'),
  ])

  const nomResto = {}; restaurants.forEach(r => { nomResto[r.id] = (r.nom || '').trim() })
  const nomUser = {}; utilisateurs.forEach(u => { nomUser[u.id] = (u.nom || '').trim() })

  // Ventilation des entrées par fournisseur, rattachée au shift d'inventaire.
  const invIds = [...new Set(lignes.map(l => l.inventaire_id).filter(Boolean))]
  const entrees = []
  for (let i = 0; i < invIds.length; i += LOT_IDS) {
    const lot = invIds.slice(i, i + LOT_IDS)
    const partiel = await fetchPagine(() => supabase.from('entrees_shift')
      .select('inventaire_id, fournisseur_nom, produit_id, quantite, source')
      .eq('produit_id', produitId).in('inventaire_id', lot))
    entrees.push(...partiel)
  }
  const parInventaire = {}
  entrees.forEach(e => {
    (parInventaire[e.inventaire_id] = parInventaire[e.inventaire_id] || []).push({
      nom: (e.fournisseur_nom || '').trim() || 'Fournisseur non identifié',
      quantite: n(e.quantite),
      source: e.source || '—',
    })
  })

  const mouvements = lignes.map(l => {
    const s = l.inventaires_shifts || {}
    return {
      date: s.date,
      shift: libelleShift(s.type_shift),
      restaurant: nomResto[s.restaurant_id] || '—',
      caissier: nomUser[s.caissier_id] || '—',
      valide: !!s.valide,
      stockInitial: n(l.stock_initial),
      entrees: n(l.entrees),
      sorties: n(l.sorties),
      stockFinal: l.stock_reel == null ? null : n(l.stock_reel),
      ecart: n(l.ecart),
      montantDeduit: l.deduction_annulee ? 0 : n(l.montant_deduit),
      deductionAnnulee: !!l.deduction_annulee,
      fournisseurs: (parInventaire[l.inventaire_id] || [])
        .sort((a, b) => b.quantite - a.quantite),
    }
  }).sort((a, b) => String(a.date).localeCompare(String(b.date))
    || a.restaurant.localeCompare(b.restaurant)
    || rangShift(a.shift) - rangShift(b.shift))

  // Cumul par fournisseur sur toute la période : le plus utile pour savoir
  // qui approvisionne réellement ce produit.
  const cumulFournisseurs = {}
  mouvements.forEach(m => m.fournisseurs.forEach(f => {
    cumulFournisseurs[f.nom] = (cumulFournisseurs[f.nom] || 0) + f.quantite
  }))

  const totaux = {
    entrees: mouvements.reduce((s, m) => s + m.entrees, 0),
    sorties: mouvements.reduce((s, m) => s + m.sorties, 0),
    ecart: mouvements.reduce((s, m) => s + m.ecart, 0),
    montantDeduit: mouvements.reduce((s, m) => s + m.montantDeduit, 0),
    nbMouvements: mouvements.length,
    nbJours: new Set(mouvements.map(m => m.date)).size,
    fournisseurs: Object.entries(cumulFournisseurs)
      .map(([nom, quantite]) => ({ nom, quantite }))
      .sort((a, b) => b.quantite - a.quantite),
  }

  return {
    produitId,
    produitNom: produitNom || lignes[0]?.produit_nom || produitId,
    restaurant: restaurantId ? (nomResto[restaurantId] || '—') : 'Tous les restaurants',
    debut, fin,
    genereLe: new Date().toISOString(),
    mouvements,
    totaux,
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────

function nomFichier(detail, extension) {
  const propre = String(detail.produitNom).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')
  return `Stock_${propre}_${detail.debut}_${detail.fin}.${extension}`
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function exporterDetailXlsx(detail) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const entete = [
    ['DÉTAIL DE STOCK', detail.produitNom],
    ['Restaurant', detail.restaurant],
    ['Période', `${formaterDateFr(detail.debut)} au ${formaterDateFr(detail.fin)}`],
    ['Généré le', new Date(detail.genereLe).toLocaleString('fr-FR')],
    [],
    ['Total entrées', detail.totaux.entrees],
    ['Total sorties', detail.totaux.sorties],
    ['Écart cumulé', detail.totaux.ecart],
    ['Montant déduit', detail.totaux.montantDeduit],
    ['Mouvements', detail.totaux.nbMouvements],
    ['Journées concernées', detail.totaux.nbJours],
  ]
  const wsE = XLSX.utils.aoa_to_sheet(entete)
  wsE['!cols'] = [{ wch: 24 }, { wch: 34 }]
  XLSX.utils.book_append_sheet(wb, wsE, 'Résumé')

  const feuille = (nom, data) => {
    if (!data.length) data = [{ '': 'Aucune donnée' }]
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = Object.keys(data[0]).map(k => ({
      wch: Math.min(32, Math.max(10, k.length + 2,
        ...data.slice(0, 200).map(d => String(d[k] ?? '').length + 2))),
    }))
    ws['!autofilter'] = { ref: ws['!ref'] }
    XLSX.utils.book_append_sheet(wb, ws, nom.slice(0, 31))
  }

  feuille('Mouvements', detail.mouvements.map(m => ({
    Date: m.date, Shift: m.shift, Restaurant: m.restaurant, Caissier: m.caissier,
    'Stock initial': m.stockInitial, Entrées: m.entrees, Sorties: m.sorties,
    'Stock final': m.stockFinal ?? '', Écart: m.ecart,
    'Montant déduit': m.montantDeduit,
    Fournisseurs: m.fournisseurs.map(f => `${f.nom} (${f.quantite})`).join(' · ') || '—',
    Validé: m.valide ? 'Oui' : 'Non',
  })))

  feuille('Entrées par fournisseur', detail.mouvements.flatMap(m =>
    m.fournisseurs.map(f => ({
      Date: m.date, Shift: m.shift, Restaurant: m.restaurant,
      Fournisseur: f.nom, Quantité: f.quantite, Source: f.source,
    }))))

  feuille('Cumul fournisseurs', detail.totaux.fournisseurs.map(f => ({
    Fournisseur: f.nom, 'Quantité livrée': f.quantite,
    'Part des entrées': detail.totaux.entrees
      ? Math.round((f.quantite / detail.totaux.entrees) * 1000) / 10 + ' %' : '—',
  })))

  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', compression: true })
  return enregistrer(nomFichier(detail, 'xlsx'), { base64 }, MIME_XLSX)
}

export async function exporterDetailPdf(detail) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  // `compress` divise le poids par ~4 sur les longues périodes (19 pages :
  // 1,4 Mo sans, ~0,35 Mo avec).
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const L = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12
  const VIOLET = [91, 82, 200]
  const DOUX = [136, 136, 170]

  doc.setFillColor(...VIOLET).rect(0, 0, L, 24, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(255, 255, 255)
  doc.text(T(detail.produitNom), M, 11)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(201, 196, 248)
  doc.text(T(`${detail.restaurant} · du ${formaterDateFr(detail.debut)} au ${formaterDateFr(detail.fin)}`), M, 18)
  doc.text(T(`Entrées ${detail.totaux.entrees} · Sorties ${detail.totaux.sorties} · ` +
    `Écart ${detail.totaux.ecart} · ${detail.totaux.nbMouvements} mouvements`),
    L - M, 18, { align: 'right' })

  autoTable(doc, {
    head: [['Date', 'Shift', 'Restaurant', 'Caissier', 'Initial', 'Entrées',
      'Sorties', 'Final', 'Écart', 'Fournisseurs'].map(T)],
    body: detail.mouvements.map(m => [
      formaterDateFr(m.date), m.shift, m.restaurant, m.caissier,
      m.stockInitial, m.entrees, m.sorties, m.stockFinal ?? '—', m.ecart,
      m.fournisseurs.map(f => `${f.nom} (${f.quantite})`).join(', ') || '—',
    ].map(T)),
    startY: 30,
    margin: { left: M, right: M },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.4, lineColor: [232, 232, 245], lineWidth: 0.1 },
    headStyles: { fillColor: VIOLET, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [244, 244, 252] },
    columnStyles: {
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { cellWidth: 70 },
    },
  })

  if (detail.totaux.fournisseurs.length) {
    let y = doc.lastAutoTable.finalY + 8
    if (y > H - 40) { doc.addPage(); y = M + 6 }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(62, 53, 160)
    doc.text(T('Cumul par fournisseur sur la période'), M, y)
    autoTable(doc, {
      head: [['Fournisseur', 'Quantité livrée', 'Part des entrées'].map(T)],
      body: detail.totaux.fournisseurs.map(f => [
        T(f.nom), T(f.quantite),
        T(detail.totaux.entrees
          ? Math.round((f.quantite / detail.totaux.entrees) * 1000) / 10 + ' %' : '—'),
      ]),
      startY: y + 3,
      margin: { left: M, right: M },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [232, 232, 245], lineWidth: 0.1 },
      headStyles: { fillColor: VIOLET, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 244, 252] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    })
  }

  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...DOUX)
    doc.text(T(`Samtrackly · détail de stock · généré le ${new Date(detail.genereLe).toLocaleString('fr-FR')}`),
      M, H - 6)
    doc.text(`${i} / ${total}`, L - M, H - 6, { align: 'right' })
  }

  return enregistrer(nomFichier(detail, 'pdf'),
    { base64: doc.output('datauristring').split(',')[1] }, 'application/pdf')
}
