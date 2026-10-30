// ──────────────────────────────────────────────────────────────────────────────
// PDF des bulletins (format des bulletins Sage) et de l'état de salaire.
// jsPDF (jamais expo-print : il ignore le HTML sur le web). Rien n'est stocké :
// tout est régénéré depuis le jsonb figé (lignes_etat_salaire.bulletin).
// Le découpage en lignes (lignesTableau) est pur et testé : lib/pdfBulletin.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { normaliserPourPdf as T } from './pdfTexte.js'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** 134700 → « 134 700 » (espace simple : les espaces fines cassent jsPDF). */
export const nb = v => (v === null || v === undefined || v === '' ? '' : Math.round(Number(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '))
/** 630 (pour dix mille) → « 6,30 ». */
export const tx = t => (t === null || t === undefined ? '' : (Number(t) / 100).toFixed(2).replace('.', ','))
/** '2026-11-30' → '30/11/26'. */
export const dateCourte = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '')

/**
 * Lignes du tableau central du bulletin :
 * [N°, Désignation, Nombre, Base, Taux sal., Gain, Retenue, Taux pat., Retenue pat.]
 */
export function lignesTableau(b) {
  const c = b.calcul
  const L = (code, lib, o = {}) => [code ?? '', lib, o.nombre ?? '', o.base ?? '', o.taux ?? '', o.gain ?? '', o.retenue ?? '', o.tauxPat ?? '', o.pat ?? '']
  const out = []
  for (const g of c.gains) {
    out.push(L(g.code, g.libelle, { nombre: g.nombre ? g.nombre.toFixed(2).replace('.', ',') : '', base: nb(g.base), taux: g.taux ? tx(g.taux) : '', gain: nb(g.gain) }))
  }
  out.push(L('', 'Total Brut', { gain: nb(c.brut) }))
  if (c.retenues.its) out.push(L(414, 'ITS', { retenue: nb(c.retenues.its), pat: '0' }))
  out.push(L(415, 'CMU', { retenue: nb(c.retenues.cmu), pat: nb(c.retenues.cmu) }))
  out.push(L(452, 'C.N.P.S', { base: nb(c.brut), taux: '6,30', retenue: nb(c.retenues.cnps) }))
  for (const p of c.patronal.filter(x => x.code !== 415)) {
    out.push(L(p.code, p.libelle, { base: nb(p.base), tauxPat: tx(p.taux), pat: nb(p.montant) }))
  }
  out.push(L('', 'Total Cotisations', { retenue: nb(c.chargesSalariales), pat: nb(c.chargesPatronales) }))
  out.push(L(412, 'Impôt brut avant RICF', { retenue: nb(c.retenues.impotBrut) }))
  if (c.retenues.ricf) out.push(L(413, 'RICF', { gain: nb(c.retenues.ricf) }))
  if (c.avance) out.push(L(661, 'AVANCE SUR SALAIRE', { retenue: nb(c.avance) }))
  if (c.transport) out.push(L(708, 'PRIME DE TRANSPORT', { nombre: c.joursPayes.toFixed(2).replace('.', ','), base: nb(Math.round(c.transport * 30 / Math.max(1, c.joursPayes))), gain: nb(c.transport) }))
  if (c.tenue) out.push(L(716, 'PRIME DE TENUE DE TRAVAIL', { gain: nb(c.tenue) }))
  if (c.arrondi) out.push(L(781, 'ARRONDI', { gain: nb(c.arrondi) }))
  return out
}

function moisLong(iso) {
  return `${NOMS_MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

function dessinerBulletin(doc, autoTable, b) {
  const M = 10
  const W = 210 - 2 * M
  const e = b.employeur || {}
  const s = b.salarie || {}
  doc.setDrawColor(120).setLineWidth(0.2)

  // Bandeau
  doc.setFillColor(225, 225, 225).rect(M, M, 60, 8, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0)
  doc.text('BULLETIN DE PAIE', M + 3, M + 6)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(`Période du : ${dateCourte(b.periode.debut)}   au : ${dateCourte(b.periode.fin)}`), M + 64, M + 5)
  doc.text(T(`Paiement le : ${dateCourte(b.periode.paiement_le)}   par : ${b.periode.mode_paiement === 'virement' ? 'Virement' : 'Espèces'}`), M + 130, M + 5)

  // Employeur
  doc.setFont('helvetica', 'bold').setFontSize(9)
  doc.text(T(e.raison_sociale || ''), M, M + 14)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(e.adresse || ''), M, M + 18)
  doc.text(T(e.ville || ''), M, M + 22)
  if (e.numero_cnps) doc.text(T(`N° CNPS employeur : ${e.numero_cnps}`), M, M + 26)

  // Identification
  const anc = b.calcul.anciennete
  autoTable(doc, {
    startY: M + 11, margin: { left: M + 64 }, tableWidth: W - 64, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['Matricule', 'Coefficient', 'Catégorie', 'Ancienneté', 'N° de Sécurité Sociale']],
    body: [[T(s.matricule || ''), T(String(s.coefficient ?? '').replace('.', ',')), T(s.categorie || ''), T(`${anc.ans} an(s) et ${anc.mois} mois`), T(s.numero_cnps || '')]],
  })
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY, margin: { left: M + 64 }, tableWidth: W - 64, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['Emploi occupé', 'Horaire', 'Convention']],
    body: [[T(s.emploi || ''), '173,330', 'CCN CONVENTION COLLECTIVE INTERPROFESSIONNELLE']],
  })

  // Salarié
  let y = doc.lastAutoTable.finalY + 4
  doc.setFillColor(235, 235, 235).rect(M + 64, y, W - 64, 16, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(10)
  doc.text(T(s.nom || ''), M + 68, y + 6)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(`${s.adresse || ''}${s.affectation ? `  ·  Affectation : ${s.affectation}` : ''}`), M + 68, y + 12)

  // Congés
  autoTable(doc, {
    startY: y, margin: { left: M }, tableWidth: 60, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'right' }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['', 'Acquis', 'Reste', 'Pris']],
    body: [['Congés', b.conges.acquis.toFixed(3).replace('.', ','), b.conges.reste.toFixed(3).replace('.', ','), b.conges.pris.toFixed(3).replace('.', ',')]],
  })

  // Lignes
  y = Math.max(doc.lastAutoTable.finalY, y + 16) + 5
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [225, 225, 225], textColor: 0 },
    head: [['N°', 'Désignation', 'Nombre', 'Base', 'Taux', 'Gain', 'Retenue', 'Taux pat.', 'Retenue pat.'].map(T)],
    body: lignesTableau(b).map(l => l.map(v => T(String(v)))),
    columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 55 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  })

  // Cumuls + net
  const cu = b.cumuls
  autoTable(doc, {
    startY: Math.max(doc.lastAutoTable.finalY + 6, 235), margin: { left: M, right: M + 40 }, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'right' }, headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'normal' },
    head: [['Cumuls', 'Salaire brut', 'Net imposable', 'Charges salariales', 'Charges patronales', 'Heures travaillées'].map(T)],
    body: [
      [T('Période'), nb(cu.periode.brut), nb(cu.periode.net_imposable), nb(cu.periode.charges_salariales), nb(cu.periode.charges_patronales), nb(cu.periode.heures)],
      [T('Année'), nb(cu.annee.brut), nb(cu.annee.net_imposable), nb(cu.annee.charges_salariales), nb(cu.annee.charges_patronales), nb(cu.annee.heures)],
    ],
  })
  const yNet = doc.lastAutoTable.finalY
  doc.setFillColor(225, 225, 225).rect(210 - M - 38, yNet - 16, 38, 16, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(8).text('NET A PAYER', 210 - M - 19, yNet - 11, { align: 'center' })
  doc.setFontSize(12).text(nb(b.calcul.net), 210 - M - 19, yNet - 3, { align: 'center' })

  doc.setFont('helvetica', 'normal').setFontSize(7)
  doc.text(T('Pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.'), M, yNet + 5)
  if (e.responsable) doc.text(T(`${e.responsable}${e.telephone ? ` · ${e.telephone}` : ''} — Responsable administratif`), M, yNet + 10)
}

async function enregistrerPdf(doc, nomFichier) {
  const { enregistrer } = await import('./exportRapportMensuel')
  return enregistrer(nomFichier, { base64: doc.output('datauristring').split(',')[1] }, 'application/pdf')
}

/** Document jsPDF, une page A4 par bulletin (séparé pour être testé sous Node). */
export function documentBulletins(jsPDF, autoTable, bulletins) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  bulletins.forEach((b, i) => {
    if (i > 0) doc.addPage()
    dessinerBulletin(doc, autoTable, b)
  })
  return doc
}

/** Télécharge un PDF, une page par bulletin. */
export async function telechargerBulletins(bulletins, nomFichier) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  return enregistrerPdf(documentBulletins(jsPDF, autoTable, bulletins), nomFichier)
}

/** État de salaire d'un restaurant (A4 paysage). */
export async function telechargerEtat({ resto, etat, lignes }) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold').setFontSize(14)
  doc.text(T(`État de salaire — ${resto.nom} — ${moisLong(etat.mois)}`), 10, 14)
  doc.setFont('helvetica', 'normal').setFontSize(8)
  doc.text(T(`Statut : ${etat.statut}${etat.valide_par_nom ? ` · validé par ${etat.valide_par_nom}` : ''}`), 10, 20)
  autoTable(doc, {
    startY: 25, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.2 }, headStyles: { fillColor: [47, 127, 216] },
    head: [['Travailleur', 'Contrat', 'Jours', 'Absences', 'Dû', 'Déjà versé', 'Reste à payer', 'Brut bulletin', 'Net bulletin'].map(T)],
    body: lignes.map(l => [T(l.nom), T(l.type_contrat || ''), l.jours_pointes, l.absences_non_justifiees, nb(l.du), nb(l.deja_verse), nb(l.reste_a_payer), nb(l.bulletin?.calcul?.brut), nb(l.bulletin?.calcul?.net)]),
    foot: [[T('Total'), '', '', '', nb(etat.totaux?.du), nb(etat.totaux?.deja_verse), nb(etat.totaux?.reste_a_payer), nb(etat.totaux?.brut), nb(etat.totaux?.net)]],
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  })
  return enregistrerPdf(doc, `Etat-salaire-${resto.nom}-${etat.mois.slice(0, 7)}.pdf`.replace(/\s+/g, '-'))
}
