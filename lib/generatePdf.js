import { File, Paths } from 'expo-file-system'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { Alert, Platform } from 'react-native'
import { supabase } from './supabase'

// ─── Conversion photo → base64 ────────────────────────────────────────────────
async function photoVersBase64(url) {
  if (!url) return null
  try {
    if (Platform.OS === 'web') {
      const response = await fetch(url)
      if (!response.ok) return null
      const blob = await response.blob()
      return new Promise(resolve => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } else {
      const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg'
      const tmpFile = new File(Paths.cache, `pdf_photo_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`)
      await File.downloadFileAsync(url, tmpFile)
      const base64 = await tmpFile.base64()
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      // Cleanup temp file (best-effort)
      tmpFile.delete().catch(() => {})
      return `data:${mime};base64,${base64}`
    }
  } catch {
    return null
  }
}

// ─── Formatage ────────────────────────────────────────────────────────────────
function fmt(n) {
  return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
}

// ─── Construction du HTML ─────────────────────────────────────────────────────
function buildHtml({ point, restoNom, dateStr, heureGen, depenses, fournisseurs, shifts, presences, inventaire, invParFournisseur, photosBase64 }) {

  // Calculs KPIs
  const totalVentes   = point.vente_total || 0
  const beneficeSC    = point.benefice_sc || 0
  const totalDepenses = point.depense_total || 0
  const totalFourn    = fournisseurs.reduce((s, f) => s + (f.paye || 0), 0)
  const totalEspeces  = point.reste_especes || shifts.reduce((s, sh) => s + (sh.espece || 0), 0)
  const totalWave     = point.wave  || shifts.reduce((s, sh) => s + (sh.wave  || 0), 0)
  const totalOm       = point.om    || shifts.reduce((s, sh) => s + (sh.om    || 0), 0)
  const totalDjamo    = point.djamo || shifts.reduce((s, sh) => s + (sh.djamo || 0), 0)
  const totalMobile   = totalWave + totalOm + totalDjamo
  const totalYango    = (point.yango_cse || 0) + (point.yango_tab || 0)
  const totalGlovo    = (point.glovo_cse || 0) + (point.glovo_tab || 0)
  const fcVeille      = point.fc_veille || 0
  const fcRecu        = point.fc_compte || 0

  // Section 1 — KPIs
  const kpis = [
    { label: 'Total ventes',            val: totalVentes,   color: '#EF9F27' },
    { label: 'Bénéfice sans charge',    val: beneficeSC,    color: '#3B6D11' },
    { label: 'Total dépenses',          val: totalDepenses, color: '#A32D2D' },
    { label: 'Total fournisseurs',      val: totalFourn,    color: '#534AB7' },
    { label: 'Total espèces',           val: totalEspeces,  color: '#1a1a1a' },
    { label: 'Total mobile money',      val: totalMobile,   color: '#185FA5' },
    { label: 'Total Yango',             val: totalYango,    color: '#185FA5' },
    { label: 'Total Glovo',             val: totalGlovo,    color: '#185FA5' },
    { label: 'Fc de la veille',         val: fcVeille,      color: '#534AB7' },
    { label: 'Fc reçu',                 val: fcRecu,        color: '#534AB7' },
  ]

  const kpiRows = kpis.map(k => `
    <tr>
      <td class="kpi-label">${k.label}</td>
      <td class="kpi-val" style="color:${k.color}">${fmt(k.val)}</td>
    </tr>`).join('')

  // Section 2 — Ventes (shifts)
  const shiftsHtml = shifts.length === 0
    ? '<p class="empty">Aucune donnée enregistrée</p>'
    : shifts.map((sh, i) => {
        const lignes = [
          { label: 'Dépenses',      val: sh.depenses  },
          { label: 'Fournisseurs',  val: sh.fournisseurs },
          { label: 'KDO',          val: sh.kdo       },
          { label: 'Retour',       val: sh.retour    },
          { label: 'Yango CSE',    val: sh.yango_cse },
          { label: 'Glovo CSE',    val: sh.glovo_cse },
          { label: 'Wave',         val: sh.wave      },
          { label: 'Djamo',        val: sh.djamo     },
          { label: 'Orange Money', val: sh.om        },
          { label: 'Espèces',      val: sh.espece    },
        ].filter(r => (r.val || 0) > 0)

        const rows = lignes.length === 0
          ? '<tr><td colspan="2" style="color:#888;font-style:italic">Aucun détail disponible</td></tr>'
          : lignes.map(r => `<tr><td>${r.label}</td><td class="right">${fmt(r.val)}</td></tr>`).join('')

        return `
        <div class="shift-card">
          <div class="shift-header">
            <span class="shift-badge">S${i + 1}</span>
            <span class="shift-heures">⏰ ${sh.heure_debut || '—'} → ${sh.heure_fin || '—'}</span>
            ${sh.caissier_nom ? `<span class="shift-caissier">👤 ${sh.caissier_nom}</span>` : ''}
            <span class="shift-vente">${fmt(sh.vente_shift)}</span>
          </div>
          <table class="inner-table"><tbody>${rows}</tbody></table>
        </div>`
      }).join('')

  // Section 3 — Dépenses
  const depensesHtml = depenses.length === 0
    ? '<p class="empty">Aucune donnée enregistrée</p>'
    : (() => {
        const rows = depenses.map(d => `
          <tr>
            <td>
              <strong>${d.libelle || 'Sans libellé'}</strong>
              <br><span class="sub">${d.categorie || ''} — ${d.saisi_par === 'gerant' ? '🔑 Gérant' : '💼 Caissier'}${d.caissier_nom ? ' · ' + d.caissier_nom : ''}</span>
            </td>
            <td class="right">${fmt(d.montant)}</td>
          </tr>`).join('')
        const total = depenses.reduce((s, d) => s + (d.montant || 0), 0)
        return `
        <table class="data-table">
          <thead><tr><th>Libellé</th><th class="right">Montant</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="total-row"><td>Total dépenses</td><td class="right">${fmt(total)}</td></tr></tfoot>
        </table>`
      })()

  // Section 4 — Fournisseurs (avec photos base64)
  const fournisseursHtml = fournisseurs.length === 0
    ? '<p class="empty">Aucune donnée enregistrée</p>'
    : fournisseurs.map(f => {
        const nom = f.fournisseurs?.nom || 'Fournisseur'
        const entrees = (invParFournisseur[f.fournisseur_id] || [])
          .map(l => `${l.produit_nom} — ${l.entrees} unité(s)`)
          .join(', ') || 'Aucune entrée inventaire'
        const photoBase64 = photosBase64[f.photo_url] || null
        const photoHtml = photoBase64
          ? `<div class="fourn-photo"><img src="${photoBase64}" class="fourn-img" /></div>`
          : f.photo_url
            ? '<p class="fourn-no-photo">📷 Photo non disponible</p>'
            : '<p class="fourn-no-photo">Aucune photo</p>'

        return `
        <div class="fourn-card">
          <div class="fourn-nom">🧾 ${nom}</div>
          <table class="fourn-table">
            <tr><td>Facture</td><td class="right">${fmt(f.facture)}</td></tr>
            <tr><td>Payé</td><td class="right" style="color:#3B6D11">${fmt(f.paye)}</td></tr>
            ${(f.reste || 0) > 0 ? `<tr><td>Reste dû</td><td class="right" style="color:#A32D2D">${fmt(f.reste)}</td></tr>` : ''}
          </table>
          <div class="fourn-inv">📦 ${entrees}</div>
          ${photoHtml}
        </div>`
      }).join('')

  // Section 5 — Présences & Paies
  const presencesHtml = presences.length === 0
    ? '<p class="empty">Aucune donnée enregistrée</p>'
    : (() => {
        const rows = presences.map(p => `
          <tr>
            <td>${p.travailleur_nom}</td>
            <td><span class="badge ${p.statut === 'Présent' ? 'badge-ok' : 'badge-abs'}">${p.statut}</span></td>
            <td class="right">${(p.paye || 0) > 0 ? fmt(p.paye) : '—'}</td>
          </tr>`).join('')
        const totalPaie = presences.reduce((s, p) => s + (p.paye || 0), 0)
        return `
        <table class="data-table">
          <thead><tr><th>Employé</th><th>Statut</th><th class="right">Paie</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="total-row"><td colspan="2">Total paie</td><td class="right">${fmt(totalPaie)}</td></tr></tfoot>
        </table>`
      })()

  // Section 6 — Inventaire
  const inventaireHtml = !inventaire || inventaire.length === 0
    ? '<p class="empty">Aucune donnée enregistrée</p>'
    : inventaire.map(shift => {
        const rows = shift.lignes.map(l => {
          const ecart = l.stock_final - (l.stock_initial + l.entrees - l.sorties)
          const hasEcart = Math.abs(ecart) > 0.01
          if (shift.numero === 0) {
            return `<tr><td>${l.produit_nom}</td><td class="right">${l.entrees} reçu(s)</td><td></td></tr>`
          }
          return `
          <tr ${hasEcart ? 'class="ecart-row"' : ''}>
            <td>${l.produit_nom}</td>
            <td class="right">Init: ${l.stock_initial} | Sorties: ${l.sorties} | Final: ${l.stock_final}</td>
            <td class="right ${hasEcart ? 'ecart-neg' : 'ecart-ok'}">${hasEcart ? (ecart >= 0 ? '+' : '') + ecart.toFixed(1) : '✅'}</td>
          </tr>`
        }).join('')

        return `
        <div class="inv-shift">
          <div class="inv-shift-header">
            <span class="inv-badge">${shift.numero === 0 ? '🚚' : 'S' + shift.numero}</span>
            <span class="inv-nom">${shift.nom}</span>
            ${shift.numero !== 0 && shift.heure_debut ? `<span class="inv-heure">${shift.heure_debut} → ${shift.heure_fin}</span>` : ''}
            <span class="inv-count">${shift.lignes.length} produit(s)</span>
          </div>
          <table class="data-table">
            <thead><tr><th>Produit</th><th class="right">Détail</th>${shift.numero !== 0 ? '<th class="right">Écart</th>' : '<th></th>'}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      }).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Point journalier — ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; }

  /* En-tête */
  .doc-header { background: #534AB7; color: #fff; padding: 20px 24px; margin-bottom: 0; }
  .doc-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .doc-header .sub { font-size: 11px; color: #CECBF6; }
  .doc-header .gen-time { font-size: 10px; color: #CECBF6; margin-top: 6px; }

  /* Sections */
  .section { padding: 16px 24px; border-bottom: 1px solid #f0f0f0; page-break-inside: avoid; }
  .section-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: #888; margin-bottom: 12px;
    padding-bottom: 6px; border-bottom: 2px solid #534AB7;
  }
  .empty { color: #aaa; font-style: italic; font-size: 12px; padding: 8px 0; }

  /* KPI table */
  .kpi-table { width: 100%; border-collapse: collapse; }
  .kpi-table tr { border-bottom: 1px solid #f5f5f5; }
  .kpi-label { padding: 7px 4px; font-size: 12px; color: #555; }
  .kpi-val { padding: 7px 4px; font-size: 14px; font-weight: 700; text-align: right; }

  /* Data tables */
  .data-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .data-table th { font-size: 10px; font-weight: 600; color: #888; text-transform: uppercase; padding: 6px 4px; border-bottom: 1px solid #eee; }
  .data-table td { padding: 7px 4px; font-size: 12px; border-bottom: 1px solid #f9f9f9; vertical-align: top; }
  .data-table tfoot .total-row td { font-weight: 700; font-size: 13px; color: #EF9F27; border-top: 2px solid #eee; border-bottom: none; padding-top: 10px; }
  .right { text-align: right; }
  .sub { font-size: 10px; color: #888; }
  .ecart-row { background: #fff8f8; }
  .ecart-neg { color: #A32D2D; font-weight: 600; }
  .ecart-ok { color: #3B6D11; }

  /* Shift cards */
  .shift-card { background: #f9f9f9; border-radius: 8px; padding: 12px; margin-bottom: 10px; border: 1px solid #eee; }
  .shift-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
  .shift-badge { background: #EF9F27; color: #412402; font-weight: 700; font-size: 11px; padding: 3px 8px; border-radius: 10px; }
  .shift-heures { font-weight: 600; font-size: 13px; }
  .shift-caissier { font-size: 11px; color: #534AB7; }
  .shift-vente { margin-left: auto; font-weight: 700; font-size: 15px; color: #EF9F27; }
  .inner-table { width: 100%; border-collapse: collapse; }
  .inner-table td { padding: 4px 2px; font-size: 11px; border-bottom: 1px solid #f0f0f0; }
  .inner-table td:last-child { text-align: right; font-weight: 500; }

  /* Fournisseurs */
  .fourn-card { background: #f9f9f9; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid #eee; page-break-inside: avoid; }
  .fourn-nom { font-size: 14px; font-weight: 700; color: #534AB7; margin-bottom: 8px; }
  .fourn-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .fourn-table td { padding: 4px 2px; font-size: 12px; }
  .fourn-inv { font-size: 11px; color: #3B6D11; background: #EAF3DE; padding: 6px 8px; border-radius: 6px; margin-bottom: 8px; }
  .fourn-photo { margin-top: 8px; }
  .fourn-img { width: 100%; max-height: 200px; object-fit: contain; border-radius: 8px; border: 1px solid #eee; }
  .fourn-no-photo { font-size: 11px; color: #aaa; font-style: italic; }

  /* Présences */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .badge-ok { background: #EAF3DE; color: #3B6D11; }
  .badge-abs { background: #FAECE7; color: #993C1D; }

  /* Inventaire */
  .inv-shift { background: #f9f9f9; border-radius: 8px; padding: 12px; margin-bottom: 10px; border: 1px solid #eee; }
  .inv-shift-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .inv-badge { background: #FAEEDA; color: #854F0B; font-weight: 700; font-size: 11px; padding: 3px 8px; border-radius: 10px; }
  .inv-nom { font-weight: 600; font-size: 13px; }
  .inv-heure { font-size: 11px; color: #888; }
  .inv-count { margin-left: auto; font-size: 11px; color: #888; }

  /* Footer */
  .doc-footer { padding: 14px 24px; text-align: center; font-size: 10px; color: #bbb; border-top: 1px solid #eee; margin-top: 8px; }
</style>
</head>
<body>

<div class="doc-header">
  <h1>SAMER — Point journalier</h1>
  <div class="sub">${restoNom} · ${dateStr}</div>
  <div class="gen-time">Généré le ${heureGen}</div>
</div>

<!-- Section 1 : KPIs -->
<div class="section">
  <div class="section-title">1 — Indicateurs clés du jour</div>
  <table class="kpi-table"><tbody>${kpiRows}</tbody></table>
</div>

<!-- Section 2 : Shifts & Ventes -->
<div class="section">
  <div class="section-title">2 — Récapitulatif des ventes par shift</div>
  ${shiftsHtml}
</div>

<!-- Section 3 : Dépenses -->
<div class="section">
  <div class="section-title">3 — Dépenses</div>
  ${depensesHtml}
</div>

<!-- Section 4 : Fournisseurs -->
<div class="section">
  <div class="section-title">4 — Fournisseurs</div>
  ${fournisseursHtml}
</div>

<!-- Section 5 : Présences -->
<div class="section">
  <div class="section-title">5 — Présences &amp; Paies</div>
  ${presencesHtml}
</div>

<!-- Section 6 : Inventaire -->
<div class="section">
  <div class="section-title">6 — Inventaire</div>
  ${inventaireHtml}
</div>

<div class="doc-footer">
  Document généré par SAMER · ${heureGen}
</div>

</body>
</html>`
}

// ─── PDF Écarts inventaire ────────────────────────────────────────────────────
export async function genererPdfEcarts({ ecarts, totalDeduit, point, restoNom }) {
  const dateStr = formatDate(point.date)
  const now = new Date()
  const heureGen = now.toLocaleDateString('fr-FR') + ' à ' +
    now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  const rows = ecarts.map(e => `
    <tr ${e.diffInexpliquee > 0 ? 'class="ecart-row"' : ''}>
      <td><strong>${e.produit_nom}</strong></td>
      <td class="right ${e.ecart < 0 ? 'ecart-neg' : 'ecart-pos'}">${(e.ecart || 0) > 0 ? '+' : ''}${(e.ecart || 0).toFixed(1)}</td>
      <td class="right">${e.nombreExplique > 0 ? e.nombreExplique.toFixed(1) : '—'}</td>
      <td>${e.explication_ecart || '—'}</td>
      <td class="right ${e.diffInexpliquee > 0 ? 'ecart-neg' : 'ecart-ok'}">${e.diffInexpliquee > 0 ? e.diffInexpliquee.toFixed(1) : '✅ 0'}</td>
      <td class="right ${e.montantDeduit > 0 ? 'ecart-neg' : ''}">${e.montantDeduit > 0 ? fmt(e.montantDeduit) : '—'}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Écarts inventaire — ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; }
  .doc-header { background: #534AB7; color: #fff; padding: 20px 24px; }
  .doc-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .doc-header .sub { font-size: 11px; color: #CECBF6; }
  .section { padding: 16px 24px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #A32D2D; }
  .data-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .data-table th { font-size: 10px; font-weight: 600; color: #888; text-transform: uppercase; padding: 6px 4px; border-bottom: 1px solid #eee; }
  .data-table td { padding: 7px 4px; font-size: 12px; border-bottom: 1px solid #f9f9f9; vertical-align: top; }
  .right { text-align: right; }
  .ecart-row { background: #fff8f8; }
  .ecart-neg { color: #A32D2D; font-weight: 600; }
  .ecart-pos { color: #3B6D11; font-weight: 600; }
  .ecart-ok { color: #3B6D11; }
  .total-row td { font-weight: 700; font-size: 14px; color: #A32D2D; border-top: 2px solid #eee; padding-top: 10px; }
  .doc-footer { padding: 14px 24px; text-align: center; font-size: 10px; color: #bbb; border-top: 1px solid #eee; margin-top: 8px; }
</style>
</head>
<body>
<div class="doc-header">
  <h1>SAMER — Rapport des écarts inventaire</h1>
  <div class="sub">${restoNom} · ${dateStr} · Généré le ${heureGen}</div>
</div>
<div class="section">
  <div class="section-title">Détail des écarts — Journée gérant</div>
  <table class="data-table">
    <thead>
      <tr>
        <th>Produit</th>
        <th class="right">Écart réel</th>
        <th class="right">Expliqué</th>
        <th>Explication gérant</th>
        <th class="right">Diff. inexpliquée</th>
        <th class="right">Montant à déduire</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="5">Total à déduire</td>
        <td class="right">${fmt(totalDeduit)}</td>
      </tr>
    </tfoot>
  </table>
</div>
<div class="doc-footer">Document généré par SAMER · ${heureGen}</div>
</body>
</html>`

  const { uri } = await Print.printToFileAsync({ html, base64: false })

  if (Platform.OS === 'web') {
    const nomFichier = `ecarts_inventaire_${point.date}.pdf`
    const response = await fetch(uri)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nomFichier
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { success: true, nomFichier }
  } else {
    const canShare = await Sharing.isAvailableAsync()
    if (canShare) {
      const nomFichier = `ecarts_inventaire_${point.date}.pdf`
      const destFile = new File(Paths.document, nomFichier)
      if (destFile.exists) destFile.delete()
      await new File(uri).copy(destFile)
      await Sharing.shareAsync(destFile.uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Écarts inventaire du ${dateStr}`,
        UTI: 'com.adobe.pdf',
      })
      return { success: true, nomFichier }
    } else {
      Alert.alert('Indisponible', 'Le partage de fichiers n\'est pas disponible sur cet appareil.')
      return { success: false }
    }
  }
}

// ─── Fonction principale ───────────────────────────────────────────────────────
export async function genererPdfPoint(detailPoint, pointSelectionne, restoSelectionne) {
  const dateStr = formatDate(pointSelectionne.date)
  const now = new Date()
  const heureGen = now.toLocaleDateString('fr-FR') + ' à ' +
    now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  // 1. Charger l'inventaire
  let inventaire = []
  try {
    const { data } = await supabase
      .from('inventaires')
      .select('*')
      .eq('point_id', pointSelectionne.id)
      .order('shift_numero')

    const shiftsInv = {}
    ;(data || []).forEach(l => {
      if (!shiftsInv[l.shift_numero]) {
        shiftsInv[l.shift_numero] = {
          numero: l.shift_numero,
          nom: l.shift_nom,
          heure_debut: l.heure_debut,
          heure_fin: l.heure_fin,
          lignes: [],
        }
      }
      shiftsInv[l.shift_numero].lignes.push(l)
    })
    inventaire = Object.values(shiftsInv).sort((a, b) => a.numero - b.numero)
  } catch { /* inventaire non disponible */ }

  // 2. Convertir les photos fournisseurs en base64
  const photosBase64 = {}
  const photoUrls = detailPoint.fournisseurs
    .map(f => f.photo_url)
    .filter(Boolean)

  await Promise.allSettled(
    photoUrls.map(async url => {
      const b64 = await photoVersBase64(url)
      if (b64) photosBase64[url] = b64
    })
  )

  // 3. Construire le HTML
  const html = buildHtml({
    point:          pointSelectionne,
    restoNom:       restoSelectionne?.nom || 'SAMER',
    dateStr,
    heureGen,
    depenses:       detailPoint.depenses,
    fournisseurs:   detailPoint.fournisseurs,
    shifts:         detailPoint.shifts,
    presences:      detailPoint.presences,
    inventaire,
    invParFournisseur: detailPoint.invParFournisseur,
    photosBase64,
  })

  // 4. Générer le PDF via expo-print
  const { uri } = await Print.printToFileAsync({ html, base64: false })

  // 5. Partager / sauvegarder
  if (Platform.OS === 'web') {
    // Sur web : créer un lien de téléchargement
    const nomFichier = `point_samer_${pointSelectionne.date}.pdf`
    const response = await fetch(uri)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nomFichier
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { success: true, nomFichier }
  } else {
    // Sur mobile natif : partager via le système (AirDrop, Drive, WhatsApp, etc.)
    const canShare = await Sharing.isAvailableAsync()
    if (canShare) {
      const nomFichier = `point_samer_${pointSelectionne.date}.pdf`
      // Copier dans un emplacement permanent avec un nom lisible
      const destFile = new File(Paths.document, nomFichier)
      // Supprimer l'ancienne version si elle existe (permet de re-télécharger)
      if (destFile.exists) destFile.delete()
      await new File(uri).copy(destFile)
      await Sharing.shareAsync(destFile.uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Point du ${dateStr}`,
        UTI: 'com.adobe.pdf',
      })
      return { success: true, nomFichier }
    } else {
      Alert.alert('Indisponible', 'Le partage de fichiers n\'est pas disponible sur cet appareil.')
      return { success: false }
    }
  }
}
