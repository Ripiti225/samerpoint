// ──────────────────────────────────────────────────────────────────────────────
// PDF d'un contrat de travail, construit avec jsPDF.
//
// Le texte vient de construireContrat() (lib/modelesContrat.js) — le même que
// celui affiché à l'écran au travailleur avant qu'il signe. Le PDF n'ajoute que
// la mise en page, le logo de la marque, la signature et le cachet.
//
// La signature est une liste de traits en coordonnées relatives (0 à 1),
// redessinée en lignes vectorielles : pas d'image à convertir, ni sur le web ni
// sur iPhone.
//
// Jamais expo-print : il ignore le HTML sur le web (cf. mémoire).
// ──────────────────────────────────────────────────────────────────────────────
import { cachetContrat } from './cachetsContrat.js'
import { LOGO_KAYAN, LOGO_SAMER } from './logos.js'
import { construireContrat, marqueContrat } from './modelesContrat.js'
import { normaliserPourPdf as T } from './pdfTexte.js'

const M = 20                 // marges (mm)
const TAILLE = 11
const INTERLIGNE = 5.2

const sansAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')

/** « Contrat_CDD_GBADIE_Gogre_2026-05-01.pdf » */
export function nomFichierContrat(d) {
  const nom = sansAccents(String(d?.nom_famille ?? '').trim().toUpperCase()).replace(/[^A-Z0-9]+/g, '_')
  const prenom = sansAccents(String(d?.prenoms ?? '').trim().split(/\s+/)[0] || '').replace(/[^A-Za-z0-9]+/g, '')
  return `Contrat_${d?.type || 'contrat'}_${[nom, prenom].filter(Boolean).join('_')}_${d?.date_debut || ''}.pdf`
}

function logoPour(marque) {
  if (marque === 'alkayan') return LOGO_KAYAN
  if (marque === 'samer') return LOGO_SAMER
  return null
}

/**
 * → { base64, nomFichier }
 * signature : { traits: [[[x, y], …], …], ratio: largeur / hauteur } ou null.
 * jsPDF : le constructeur, injectable pour les tests (sinon import dynamique).
 */
export async function genererPdfContrat({ donnees, signature = null, jsPDF = null, compress = true }) {
  const Ctor = jsPDF || (await import('jspdf')).jsPDF
  const doc = new Ctor({ orientation: 'portrait', unit: 'mm', format: 'a4', compress })
  const L = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const largeur = L - 2 * M
  const contrat = construireContrat(donnees)
  const marque = marqueContrat(donnees?.marque)
  let y = M

  const police = (style = 'normal', taille = TAILLE) => doc.setFont('times', style).setFontSize(taille).setTextColor(20, 20, 20)
  const place = h => { if (y + h > H - M) { doc.addPage(); y = M } }

  function paragraphe(texte, { style = 'normal', retrait = 0, apres = 2 } = {}) {
    police(style)
    const lignes = doc.splitTextToSize(T(texte), largeur - retrait)
    for (const l of lignes) {
      place(INTERLIGNE)
      doc.text(l, M + retrait, y + 4)
      y += INTERLIGNE
    }
    y += apres
  }

  function entete() {
    const logo = logoPour(donnees?.marque)
    let hauteurLogo = 0
    if (logo) {
      try {
        const p = doc.getImageProperties(logo)
        hauteurLogo = 20
        const l = Math.min(42, (p.width / p.height) * hauteurLogo)
        doc.addImage(logo, 'PNG', M, y, l, (p.height / p.width) * l)
        hauteurLogo = (p.height / p.width) * l
      } catch { hauteurLogo = 0 }
    }
    police('bolditalic', 16)
    doc.text(T(`RESTAURANT ${marque?.etablissement || ''}`), L / 2 + 15, y + Math.max(8, hauteurLogo / 2 + 2), { align: 'center' })
    y += Math.max(hauteurLogo, 12) + 8
  }

  function champs(items) {
    for (const [libelle, valeur] of items) {
      police('normal')
      const debut = T(`${libelle} : `)
      const lDebut = doc.getTextWidth(debut)
      police('bold')
      const lignes = doc.splitTextToSize(T(valeur), Math.max(40, largeur - lDebut))
      place(INTERLIGNE * lignes.length)
      police('normal')
      doc.text(debut, M, y + 4)
      police('bold')
      lignes.forEach((l, i) => doc.text(l, M + lDebut, y + 4 + i * INTERLIGNE))
      y += INTERLIGNE * lignes.length
    }
    y += 2
  }

  function article(texte) {
    y += 2
    place(INTERLIGNE * 3)
    police('bold')
    const lignes = doc.splitTextToSize(T(texte), largeur)
    for (const l of lignes) {
      doc.text(l, M, y + 4)
      doc.setLineWidth(0.25).setDrawColor(20, 20, 20).line(M, y + 4.8, M + doc.getTextWidth(l), y + 4.8)
      y += INTERLIGNE
    }
    y += 1.5
  }

  function signatures() {
    y += 6
    place(48)
    const colD = L / 2 + 10
    police('bold')
    doc.text(T('LE TRAVAILLEUR'), M, y + 4)
    doc.text(T("L'EMPLOYEUR"), colD, y + 4)
    doc.setLineWidth(0.25).line(M, y + 4.8, M + doc.getTextWidth('LE TRAVAILLEUR'), y + 4.8)
    doc.line(colD, y + 4.8, colD + doc.getTextWidth("L'EMPLOYEUR"), y + 4.8)
    police('normal', 10)
    doc.text(T('(Lu et approuvé)'), M, y + 9.5)
    const haut = y + 12

    // Signature : les traits remplissent au mieux un cadre de 60 × 28 mm.
    const traits = signature?.traits || []
    if (traits.length) {
      const ratio = signature.ratio || 2.5
      let w = 60
      let h = w / ratio
      if (h > 28) { h = 28; w = h * ratio }
      doc.setLineWidth(0.45).setDrawColor(30, 40, 120)
      for (const trait of traits) {
        for (let i = 1; i < trait.length; i++) {
          doc.line(M + trait[i - 1][0] * w, haut + trait[i - 1][1] * h, M + trait[i][0] * w, haut + trait[i][1] * h)
        }
      }
      doc.setDrawColor(20, 20, 20)
    }

    const cachet = cachetContrat(donnees?.marque)
    if (cachet) {
      try {
        const p = doc.getImageProperties(cachet)
        const w = 55
        doc.addImage(cachet, 'JPEG', colD, haut, w, (p.height / p.width) * w)
      } catch { /* sans cachet plutôt que sans contrat */ }
    }
    y = haut + 30
  }

  for (const b of contrat.blocs) {
    if (b.t === 'entete') entete()
    else if (b.t === 'titre') {
      place(14)
      police('bold', 14)
      for (const l of doc.splitTextToSize(T(b.texte), largeur)) {
        doc.text(l, L / 2, y + 5, { align: 'center' })
        y += 7
      }
      y += 5
    } else if (b.t === 'para') paragraphe(b.texte)
    else if (b.t === 'champs') champs(b.items)
    else if (b.t === 'puces') {
      for (const item of b.items) {
        police('normal')
        place(INTERLIGNE)
        doc.text('•', M + 2, y + 4)
        paragraphe(item, { retrait: 7, apres: 0.6 })
      }
      y += 1.5
    } else if (b.t === 'article') article(b.texte)
    else if (b.t === 'sous') paragraphe(`> ${b.texte.toUpperCase()}`, { style: 'bold', apres: 0.5 })
    else if (b.t === 'fait') {
      y += 4
      place(INTERLIGNE)
      police('bold')
      doc.text(T(b.texte), L - M, y + 4, { align: 'right' })
      y += INTERLIGNE
    } else if (b.t === 'signatures') signatures()
  }

  // Numéros de page : un contrat de 3 pages se reconstitue si on les mélange.
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    police('normal', 9)
    doc.setTextColor(120, 120, 120)
    doc.text(`${p} / ${total}`, L - M, H - 10, { align: 'right' })
  }

  const base64 = doc.output('datauristring').split(',')[1]
  return { base64, nomFichier: nomFichierContrat(donnees), pages: total }
}
