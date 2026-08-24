// ─────────────────────────────────────────────────────────────────────────
//  RAPPORT MENSUEL — génération des fichiers PowerPoint / Excel / PDF
//
//  Consomme l'objet produit par lib/rapportMensuel.js.
//    • PPTX  : 37 slides agrégées, graphiques natifs Office (modifiables)
//    • XLSX  : le détail ligne par ligne, une feuille par domaine
//    • PDF   : version figée, construite avec jsPDF (surtout pas expo-print,
//              qui n'imprime rien d'utile sur le web — voir plus bas)
//
//  Les grosses dépendances (pptxgenjs, xlsx, jspdf) sont importées à la demande :
//  inutile de les embarquer dans le bundle de démarrage pour un écran que
//  seuls manager et directeur ouvrent, une fois par mois.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native'
import * as Sharing from 'expo-sharing'
import { File, Paths } from 'expo-file-system'
import { marquePourResto } from './logos'
import { normaliserPourPdf as T } from './pdfTexte'

// ─── Charte Samtrackly (lib/theme.js, en hexa sans '#' pour pptxgenjs) ───

const C = {
  violet: '5B52C8',
  violetFonce: '3E35A0',
  violetClair: 'ECEAFF',
  orange: 'F0A020',
  orangeClair: 'FEF0DA',
  orangeFonce: '7A4800',
  vert: '1FAD6B',
  vertClair: 'E0F9EE',
  rouge: 'D44040',
  rougeClair: 'FDEBEB',
  texte: '18182E',
  texteSecondaire: '48486A',
  texteDoux: '8888AA',
  blanc: 'FFFFFF',
  fondAlt: 'F4F4FC',
  bordure: 'E8E8F5',
}

const POLICE = 'Arial'
const L = 13.33          // largeur slide 16:9, en pouces
const H = 7.5            // hauteur slide
const MARGE = 0.55

// ─── Formatage ───────────────────────────────────────────────────────────

const fmtF = v => (v == null || Number.isNaN(Number(v)))
  ? '—'
  : Math.round(Number(v)).toLocaleString('fr-FR') + ' F'

const fmtNb = v => (v == null ? '—' : Number(v).toLocaleString('fr-FR'))

const fmtPct = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v} %`)

function fmtDateFr(iso) {
  if (!iso) return '—'
  const [a, m, j] = String(iso).slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

/** Couleur d'une variation : vert si ça monte, rouge si ça baisse. */
const couleurVar = v => (v == null ? C.texteDoux : v >= 0 ? C.vert : C.rouge)

/** Tronque une liste et renvoie la mention du reste. */
function limiter(liste, max) {
  const visibles = liste.slice(0, max)
  const reste = liste.length - visibles.length
  return { visibles, reste }
}

// ─── Briques de mise en page PPTX ────────────────────────────────────────

/** Slide standard : bandeau de titre violet + zone de contenu. */
function nouvelleSlide(pptx, titre, sousTitre) {
  const s = pptx.addSlide()
  s.background = { color: C.blanc }
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: L, h: 0.95, fill: { color: C.violet },
  })
  s.addText(titre, {
    x: MARGE, y: 0.12, w: L - MARGE * 2, h: 0.42,
    fontSize: 22, bold: true, color: C.blanc, fontFace: POLICE,
  })
  if (sousTitre) {
    s.addText(sousTitre, {
      x: MARGE, y: 0.54, w: L - MARGE * 2, h: 0.3,
      fontSize: 12, color: 'C9C4F8', fontFace: POLICE,
    })
  }
  return s
}

/** Bandeau de tuiles chiffrées. `tuiles` = [{ label, valeur, variation, couleur }] */
function ajouterTuiles(slide, pptx, tuiles, y = 1.25, hauteur = 1.25) {
  const n = tuiles.length
  if (n === 0) return
  const espace = 0.16
  const largeur = (L - MARGE * 2 - espace * (n - 1)) / n
  tuiles.forEach((t, i) => {
    const x = MARGE + i * (largeur + espace)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: largeur, h: hauteur, rectRadius: 0.08,
      fill: { color: C.fondAlt }, line: { color: C.bordure, width: 1 },
    })
    slide.addText(t.label, {
      x: x + 0.12, y: y + 0.1, w: largeur - 0.24, h: 0.26,
      fontSize: 10, color: C.texteDoux, fontFace: POLICE, align: 'center',
    })
    slide.addText(String(t.valeur), {
      x: x + 0.08, y: y + 0.36, w: largeur - 0.16, h: 0.42,
      fontSize: t.petit ? 15 : 18, bold: true, fontFace: POLICE, align: 'center',
      color: t.couleur || C.texte, shrinkText: true,
    })
    if (t.variation !== undefined) {
      slide.addText(
        t.variation == null ? '—' : `${fmtPct(t.variation)} vs mois précédent`,
        {
          x: x + 0.08, y: y + 0.82, w: largeur - 0.16, h: 0.3,
          fontSize: 9, fontFace: POLICE, align: 'center',
          color: couleurVar(t.variation),
        },
      )
    } else if (t.note) {
      slide.addText(t.note, {
        x: x + 0.08, y: y + 0.82, w: largeur - 0.16, h: 0.3,
        fontSize: 9, fontFace: POLICE, align: 'center', color: C.texteDoux,
      })
    }
  })
}

/** Tableau homogène : entêtes violettes, lignes zébrées. */
function ajouterTableau(slide, entetes, lignes, opts = {}) {
  const rows = [
    entetes.map(t => ({
      text: String(t),
      options: { bold: true, color: C.blanc, fill: { color: C.violet }, fontSize: opts.fontSize || 10 },
    })),
    ...lignes.map((ligne, i) => ligne.map((cell, j) => {
      const brut = typeof cell === 'object' && cell !== null ? cell : { text: cell }
      return {
        text: String(brut.text ?? '—'),
        options: {
          fontSize: opts.fontSize || 10,
          color: brut.couleur || C.texte,
          bold: brut.gras || false,
          fill: { color: i % 2 ? C.fondAlt : C.blanc },
          align: brut.align || (j === 0 ? 'left' : 'right'),
        },
      }
    })),
  ]
  slide.addTable(rows, {
    x: opts.x ?? MARGE,
    y: opts.y ?? 1.3,
    w: opts.w ?? (L - MARGE * 2),
    colW: opts.colW,
    border: { type: 'solid', color: C.bordure, pt: 0.5 },
    fontFace: POLICE,
    valign: 'middle',
    rowH: opts.rowH || 0.28,
    autoPage: false,
  })
}

/** Titre de section à l'intérieur d'une slide. */
function sousTitre(slide, texte, x, y, w) {
  slide.addText(texte, {
    x, y, w, h: 0.28,
    fontSize: 12, bold: true, color: C.violetFonce, fontFace: POLICE,
  })
}

/** Note discrète en bas de slide. */
function note(slide, texte, y = H - 0.5) {
  slide.addText(texte, {
    x: MARGE, y, w: L - MARGE * 2, h: 0.3,
    fontSize: 9, italic: true, color: C.texteDoux, fontFace: POLICE,
  })
}

// ─── Slides globales ─────────────────────────────────────────────────────

function slideCouverture(pptx, r) {
  const s = pptx.addSlide()
  s.background = { color: C.violet }
  s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 1.5, w: L, h: 1.5, fill: { color: C.violetFonce } })

  s.addText('RAPPORT MENSUEL', {
    x: MARGE, y: 2.1, w: L - MARGE * 2, h: 0.6,
    fontSize: 16, color: 'C9C4F8', fontFace: POLICE, charSpacing: 4,
  })
  s.addText(r.label, {
    x: MARGE, y: 2.65, w: L - MARGE * 2, h: 1.2,
    fontSize: 54, bold: true, color: C.blanc, fontFace: POLICE,
  })
  s.addText(
    `${r.global.nbRestaurants} restaurants · ${fmtNb(r.global.nbPointsValides)} journées validées · ` +
    `du ${fmtDateFr(r.debut)} au ${fmtDateFr(r.fin)}`,
    { x: MARGE, y: 3.9, w: L - MARGE * 2, h: 0.4, fontSize: 14, color: 'C9C4F8', fontFace: POLICE },
  )

  const dg = new Date(r.genereLe)
  s.addText(
    `Chiffre d'affaires ${fmtF(r.global.ca)}   ·   Bénéfice ${fmtF(r.global.benefice)}`,
    { x: MARGE, y: H - 1.15, w: L - MARGE * 2, h: 0.4, fontSize: 15, bold: true, color: C.blanc, fontFace: POLICE },
  )
  s.addText(
    `Document interne — Samtrackly · généré le ${dg.toLocaleDateString('fr-FR')} à ${dg.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
    { x: MARGE, y: H - 0.72, w: L - MARGE * 2, h: 0.3, fontSize: 10, color: 'A8A0E8', fontFace: POLICE },
  )
  return s
}

function slideSommaire(pptx, r) {
  const s = nouvelleSlide(pptx, 'Sommaire', `${r.label} · ${r.global.nbRestaurants} restaurants`)
  const gauche = [
    ['1', "Chiffres clés du mois"],
    ['2', 'Comparatif avec le mois précédent'],
    ['3', 'Classement des restaurants'],
    ['4', "Chiffre d'affaires jour par jour"],
    ['5', 'Dépenses et charges'],
    ['6', 'Fournisseurs'],
    ['7', 'Livraisons et commissions'],
  ]
  const droite = [
    ['8', 'Litiges par responsable'],
    ['9', "Écarts d'inventaire"],
    ['10', 'Écarts de caisse par caissier'],
    ['11', 'Ressources humaines'],
    ['12', 'Détail par restaurant'],
    ['13', 'Journées sans point validé'],
    ['14', 'Méthodologie'],
  ]
  const colonne = (items, x) => {
    items.forEach((it, i) => {
      const y = 1.5 + i * 0.62
      s.addShape(pptx.ShapeType.roundRect, {
        x, y, w: 0.45, h: 0.45, rectRadius: 0.06, fill: { color: C.violetClair },
      })
      s.addText(it[0], {
        x, y: y + 0.02, w: 0.45, h: 0.4, fontSize: 12, bold: true,
        color: C.violetFonce, align: 'center', fontFace: POLICE,
      })
      s.addText(it[1], {
        x: x + 0.62, y: y + 0.02, w: 5.2, h: 0.4, fontSize: 13,
        color: C.texte, fontFace: POLICE, valign: 'middle',
      })
    })
  }
  colonne(gauche, MARGE)
  colonne(droite, MARGE + 6.4)
  return s
}

function slideChiffresCles(pptx, r) {
  const g = r.global
  const p = r.precedent
  const v = (a, b) => (p ? variationLocale(a, b) : undefined)

  const s = nouvelleSlide(pptx, 'Chiffres clés du mois', r.label)
  ajouterTuiles(s, pptx, [
    { label: "CHIFFRE D'AFFAIRES", valeur: fmtF(g.ca), couleur: C.violetFonce, variation: v(g.ca, p?.ca) },
    { label: 'BÉNÉFICE (SANS CHARGES)', valeur: fmtF(g.benefice), couleur: C.vert, variation: v(g.benefice, p?.benefice) },
    { label: 'DÉPENSES', valeur: fmtF(g.depenses), couleur: C.rouge, variation: v(g.depenses, p?.depenses) },
    { label: 'CHARGES', valeur: fmtF(g.charges), couleur: C.rouge, variation: v(g.charges, p?.charges) },
    { label: 'BÉNÉFICE NET', valeur: fmtF(g.beneficeNet), couleur: g.beneficeNet >= 0 ? C.vert : C.rouge, variation: v(g.beneficeNet, p?.beneficeNet) },
  ], 1.2, 1.35)

  ajouterTuiles(s, pptx, [
    { label: 'MARGE', valeur: g.marge == null ? '—' : `${g.marge} %`, couleur: C.violetFonce, note: 'bénéfice / CA' },
    { label: 'JOURNÉES VALIDÉES', valeur: fmtNb(g.nbPointsValides), note: `sur ${g.nbPoints} points` },
    { label: 'CA MOYEN / JOUR', valeur: fmtF(g.caMoyenJour), note: 'toutes enseignes' },
    { label: 'SHIFTS CAISSIERS', valeur: fmtNb(g.nbShifts), note: `${g.ecartsCaissiers.length} caissiers` },
    { label: 'RESTAURANTS', valeur: fmtNb(g.nbRestaurants), note: 'ayant produit un point' },
  ], 2.75, 1.15)

  sousTitre(s, 'Points de vigilance', MARGE, 4.15, 6)
  const vigilance = [
    ['Écart de caisse cumulé', { text: fmtF(g.ecartCaisse), couleur: g.ecartCaisse < 0 ? C.rouge : C.texte }],
    ['Ajustements de fond', fmtF(g.ajustementFond)],
    ["Écarts d'inventaire déduits", { text: fmtF(g.inventaireDetail.totalDeduit), couleur: C.rouge }],
    ['Litiges du mois', { text: fmtF(g.litiges.total), couleur: C.rouge }],
    ['Journées sans point validé', { text: fmtNb(g.joursManquants.reduce((a, x) => a + x.dates.length, 0)), couleur: g.joursManquants.length ? C.rouge : C.vert }],
  ]
  ajouterTableau(s, ['Indicateur', 'Valeur'], vigilance, { y: 4.5, w: 6, colW: [4, 2] })

  sousTitre(s, 'Répartition du chiffre d\'affaires', MARGE + 6.5, 4.15, 6)
  const l = g.livraisons
  const especes = Math.max(0, g.ca - l.totalBrut)
  s.addChart(pptx.ChartType.doughnut,
    [{
      name: 'CA',
      labels: ['Espèces / salle', 'Yango', 'Glovo', 'Wave', 'Orange Money', 'Djamo'],
      values: [especes, l.yango.cse + l.yango.tab, l.glovo.cse + l.glovo.tab, l.wave.brut, l.om.brut, l.djamo.brut],
    }],
    {
      x: MARGE + 6.4, y: 4.5, w: 6.2, h: 2.4,
      chartColors: [C.violet, C.orange, C.vert, '2E86DE', 'E67E22', 'AA2288'],
      showLegend: true, legendPos: 'r', legendFontSize: 9,
      showValue: false, showPercent: true, dataLabelFontSize: 9, dataLabelColor: C.blanc,
      holeSize: 45,
    })
  return s
}

function slideComparatif(pptx, r) {
  const g = r.global
  const p = r.precedent
  const s = nouvelleSlide(pptx, 'Comparatif avec le mois précédent',
    p ? `${r.label} face à ${p.label}` : r.label)

  if (!p) {
    s.addText("Aucun mois précédent exploitable en base : le comparatif n'est pas disponible.", {
      x: MARGE, y: 3, w: L - MARGE * 2, h: 0.5, fontSize: 14, color: C.texteDoux,
      fontFace: POLICE, align: 'center',
    })
    return s
  }

  const lignes = [
    ["Chiffre d'affaires", g.ca, p.ca],
    ['Bénéfice sans charges', g.benefice, p.benefice],
    ['Dépenses', g.depenses, p.depenses],
    ['Charges', g.charges, p.charges],
    ['Bénéfice net', g.beneficeNet, p.beneficeNet],
    ["Écarts d'inventaire déduits", g.inventaireDetail.totalDeduit, p.inventaireDetail.totalDeduit],
    ['Litiges', g.litiges.total, p.litiges.total],
    ['Achats fournisseurs', g.fournisseurs.facture, p.fournisseurs.facture],
    ['Masse salariale', g.rh.masseSalariale, p.rh.masseSalariale],
    ['Journées validées', g.nbPointsValides, p.nbPointsValides],
  ].map(([label, actuel, precedent]) => {
    const va = variationLocale(actuel, precedent)
    const estMontant = label !== 'Journées validées'
    return [
      label,
      estMontant ? fmtF(actuel) : fmtNb(actuel),
      estMontant ? fmtF(precedent) : fmtNb(precedent),
      { text: fmtPct(va), couleur: couleurVar(va), gras: true },
    ]
  })

  ajouterTableau(s, ['Indicateur', r.label, p.label, 'Variation'], lignes,
    { y: 1.25, w: 7.2, colW: [3, 1.6, 1.6, 1], rowH: 0.34 })

  sousTitre(s, "Chiffre d'affaires par restaurant", MARGE + 7.5, 1.25, 5.2)
  const restos = r.restaurants.slice(0, 8)
  s.addChart(pptx.ChartType.bar,
    [{ name: r.label, labels: restos.map(x => x.nom), values: restos.map(x => x.ca) }],
    {
      x: MARGE + 7.4, y: 1.6, w: 5.3, h: 4.6,
      barDir: 'bar', chartColors: [C.violet],
      showLegend: false, showValue: true,
      dataLabelFormatCode: '#,##0', dataLabelFontSize: 8, dataLabelPosition: 'outEnd',
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 8,
      valAxisLabelFormatCode: '#,##0',
    })
  return s
}

function slideClassement(pptx, r) {
  const s = nouvelleSlide(pptx, 'Classement des restaurants', `${r.label} · classés par chiffre d'affaires`)
  const lignes = r.restaurants.map((x, i) => [
    `${i + 1}.  ${x.nom}`,
    fmtF(x.ca),
    { text: fmtF(x.benefice), couleur: x.benefice >= 0 ? C.vert : C.rouge },
    x.marge == null ? '—' : `${x.marge} %`,
    fmtF(x.depenses),
    fmtNb(x.nbPointsValides),
    x.tauxObjectif == null ? '—'
      : { text: `${x.tauxObjectif} %`, couleur: x.tauxObjectif >= 100 ? C.vert : C.orange, gras: true },
  ])
  const total = [
    { text: 'TOTAL', gras: true },
    { text: fmtF(r.global.ca), gras: true },
    { text: fmtF(r.global.benefice), gras: true, couleur: C.vert },
    { text: r.global.marge == null ? '—' : `${r.global.marge} %`, gras: true },
    { text: fmtF(r.global.depenses), gras: true },
    { text: fmtNb(r.global.nbPointsValides), gras: true },
    { text: r.global.tauxObjectif == null ? '—' : `${r.global.tauxObjectif} %`, gras: true },
  ]
  ajouterTableau(s,
    ['Restaurant', "Chiffre d'affaires", 'Bénéfice', 'Marge', 'Dépenses', 'Jours', 'Objectif'],
    [...lignes, total],
    { y: 1.3, rowH: 0.36, colW: [3.4, 2, 1.9, 1.1, 1.9, 0.9, 1.03] })

  const sansObjectif = r.restaurants.filter(x => x.tauxObjectif == null).length
  if (sansObjectif > 0) {
    note(s, `${sansObjectif} restaurant(s) sans objectif mensuel renseigné — à saisir depuis l'écran Restaurants pour activer la colonne « Objectif ».`)
  }
  return s
}

function slideCourbeCa(pptx, r) {
  const s = nouvelleSlide(pptx, "Chiffre d'affaires jour par jour", `${r.label} · toutes enseignes confondues`)
  const serie = r.global.serieJournaliere
  s.addChart(pptx.ChartType.line,
    [{ name: "CA du jour", labels: serie.map(x => String(x.jour)), values: serie.map(x => x.ca) }],
    {
      x: MARGE, y: 1.3, w: L - MARGE * 2, h: 4.1,
      chartColors: [C.violet], lineSize: 2.5, lineSmooth: true,
      showLegend: false, showValue: false,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      valAxisLabelFormatCode: '#,##0',
      catAxisTitle: 'Jour du mois', showCatAxisTitle: true, catAxisTitleFontSize: 10,
    })

  const jours = serie.filter(x => x.ca > 0)
  const meilleur = jours.reduce((a, b) => (b.ca > a.ca ? b : a), jours[0] || { jour: '—', ca: 0 })
  const pire = jours.reduce((a, b) => (b.ca < a.ca ? b : a), jours[0] || { jour: '—', ca: 0 })
  const moyenne = jours.length ? Math.round(jours.reduce((a, b) => a + b.ca, 0) / jours.length) : 0

  ajouterTuiles(s, pptx, [
    { label: 'MEILLEURE JOURNÉE', valeur: fmtF(meilleur.ca), couleur: C.vert, note: `le ${meilleur.jour} ${r.label.toLowerCase()}` },
    { label: 'PLUS FAIBLE JOURNÉE', valeur: fmtF(pire.ca), couleur: C.rouge, note: `le ${pire.jour} ${r.label.toLowerCase()}` },
    { label: 'MOYENNE JOURNALIÈRE', valeur: fmtF(moyenne), note: `${jours.length} journées avec activité` },
  ], 5.6, 1.2)
  return s
}

function slideDepenses(pptx, r) {
  const g = r.global
  const s = nouvelleSlide(pptx, 'Dépenses et charges', r.label)

  sousTitre(s, 'Dépenses par catégorie', MARGE, 1.2, 6)
  const cats = g.depensesParCategorie
  if (cats.length > 0) {
    s.addChart(pptx.ChartType.bar,
      [{ name: 'Dépenses', labels: cats.map(c => c.categorie), values: cats.map(c => c.montant) }],
      {
        x: MARGE, y: 1.55, w: 6.1, h: 3.1,
        barDir: 'bar', chartColors: [C.orange],
        showLegend: false, showValue: true,
        dataLabelFormatCode: '#,##0', dataLabelFontSize: 9, dataLabelPosition: 'outEnd',
        catAxisLabelFontSize: 10, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0',
      })
  }

  const totalDep = cats.reduce((a, c) => a + c.montant, 0)
  ajouterTableau(s, ['Catégorie', 'Montant', 'Part'],
    [...cats.map(c => [c.categorie, fmtF(c.montant),
      totalDep ? `${Math.round((c.montant / totalDep) * 1000) / 10} %` : '—']),
    [{ text: 'TOTAL', gras: true }, { text: fmtF(totalDep), gras: true }, { text: '100 %', gras: true }]],
    { x: MARGE, y: 4.85, w: 6.1, colW: [2.9, 1.9, 1.3], rowH: 0.26 })

  sousTitre(s, 'Charges du mois', MARGE + 6.6, 1.2, 6)
  const chg = limiter(g.detailCharges, 12)
  if (g.detailCharges.length === 0) {
    s.addShape(pptx.ShapeType.roundRect, {
      x: MARGE + 6.6, y: 1.55, w: 6.1, h: 1.1, rectRadius: 0.08,
      fill: { color: C.orangeClair }, line: { color: C.orange, width: 1 },
    })
    s.addText("Aucune charge saisie pour ce mois.\nLe bénéfice net est donc égal au bénéfice sans charges.", {
      x: MARGE + 6.7, y: 1.65, w: 5.9, h: 0.9, fontSize: 11, color: C.orangeFonce,
      fontFace: POLICE, align: 'center', valign: 'middle',
    })
  } else {
    ajouterTableau(s, ['Libellé', 'Montant'],
      [...chg.visibles.map(c => [c.libelle, fmtF(c.montant)]),
      [{ text: chg.reste > 0 ? `+ ${chg.reste} autre(s)` : 'TOTAL', gras: true },
        { text: fmtF(g.charges), gras: true }]],
      { x: MARGE + 6.6, y: 1.55, w: 6.1, colW: [4.3, 1.8], rowH: 0.28 })
  }

  sousTitre(s, 'Dépenses payées sur la caisse du gérant', MARGE + 6.6, 5.2, 6)
  s.addText(fmtF(g.depensesGerantCaisse), {
    x: MARGE + 6.6, y: 5.5, w: 6.1, h: 0.5, fontSize: 20, bold: true,
    color: C.violetFonce, fontFace: POLICE,
  })
  note(s, "Les dépenses sont rattachées à la journée via le point ; les charges sont saisies au mois depuis l'écran Charges.")
  return s
}

function slideFournisseurs(pptx, r) {
  const g = r.global
  const s = nouvelleSlide(pptx, 'Fournisseurs', `${r.label} · ${fmtNb(g.fournisseurs.nb)} transactions`)

  ajouterTuiles(s, pptx, [
    { label: 'TOTAL FACTURÉ', valeur: fmtF(g.fournisseurs.facture), couleur: C.violetFonce },
    { label: 'TOTAL PAYÉ', valeur: fmtF(g.fournisseurs.paye), couleur: C.vert },
    { label: 'PRIS À CRÉDIT', valeur: fmtF(g.fournisseurs.credit), couleur: C.orange },
    { label: 'TRANSACTIONS', valeur: fmtNb(g.fournisseurs.nb) },
  ], 1.2, 1.15)

  sousTitre(s, 'Dix premiers fournisseurs du mois', MARGE, 2.6, 6)
  const top = g.fournisseurs.top
  ajouterTableau(s, ['Fournisseur', 'Facturé', 'Payé', 'Crédit', 'Nb'],
    top.map(f => [f.nom, fmtF(f.facture), fmtF(f.paye),
      { text: fmtF(f.credit), couleur: f.credit > 0 ? C.orange : C.texte }, fmtNb(f.nb)]),
    { y: 2.95, w: 6.4, colW: [2.4, 1.3, 1.3, 1, 0.4], rowH: 0.3 })

  if (top.length > 0) {
    sousTitre(s, 'Poids des dix premiers', MARGE + 6.8, 2.6, 5.9)
    s.addChart(pptx.ChartType.bar,
      [{ name: 'Facturé', labels: top.map(f => f.nom), values: top.map(f => f.facture) }],
      {
        x: MARGE + 6.7, y: 2.95, w: 5.9, h: 3.3,
        barDir: 'bar', chartColors: [C.violet],
        showLegend: false, showValue: true,
        dataLabelFormatCode: '#,##0', dataLabelFontSize: 8, dataLabelPosition: 'outEnd',
        catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0',
      })
  }
  note(s, "Le crédit affiché est celui contracté sur le mois, pas l'encours total du fournisseur.")
  return s
}

function slideLivraisons(pptx, r) {
  const l = r.global.livraisons
  const s = nouvelleSlide(pptx, 'Livraisons et commissions', `${r.label} · ${fmtNb(l.nbCmd)} commandes Yango + Glovo`)

  ajouterTuiles(s, pptx, [
    { label: 'ENCAISSÉ BRUT', valeur: fmtF(l.totalBrut), couleur: C.violetFonce },
    { label: 'NET APRÈS COMMISSION', valeur: fmtF(l.totalNet), couleur: C.vert },
    { label: 'COMMISSIONS RETENUES', valeur: fmtF(l.totalCommission), couleur: C.rouge },
    { label: 'COMMANDES LIVRÉES', valeur: fmtNb(l.nbCmd), note: `Yango ${fmtNb(l.yango.nbCmd)} · Glovo ${fmtNb(l.glovo.nbCmd)}` },
  ], 1.2, 1.2)

  const lignes = [
    ['Yango — espèces', fmtF(l.yango.cse), '—', fmtF(l.yango.cse), fmtNb(l.yango.nbCmd)],
    ['Yango — tablette', fmtF(l.yango.tab), '× 0,77', fmtF(l.yango.tab * 0.77), ''],
    ['Glovo — espèces', fmtF(l.glovo.cse), '—', fmtF(l.glovo.cse), fmtNb(l.glovo.nbCmd)],
    ['Glovo — tablette', fmtF(l.glovo.tab), '× 0,705', fmtF(l.glovo.tab * 0.705), ''],
    ['Wave', fmtF(l.wave.brut), '× 0,99', fmtF(l.wave.net), ''],
    ['Orange Money', fmtF(l.om.brut), '× 0,99', fmtF(l.om.net), ''],
    ['Djamo', fmtF(l.djamo.brut), '× 0,99', fmtF(l.djamo.net), ''],
    [{ text: 'TOTAL', gras: true }, { text: fmtF(l.totalBrut), gras: true }, '',
      { text: fmtF(l.totalNet), gras: true, couleur: C.vert }, { text: fmtNb(l.nbCmd), gras: true }],
  ]
  ajouterTableau(s, ['Canal', 'Brut encaissé', 'Coefficient', 'Net perçu', 'Commandes'], lignes,
    { y: 2.65, w: 7, colW: [2.2, 1.5, 1.2, 1.5, 0.6], rowH: 0.32 })

  sousTitre(s, 'Commission retenue par canal', MARGE + 7.4, 2.6, 5.3)
  s.addChart(pptx.ChartType.bar,
    [{
      name: 'Commission',
      labels: ['Yango', 'Glovo', 'Wave', 'Orange Money', 'Djamo'],
      values: [l.yango.commission, l.glovo.commission, l.wave.commission, l.om.commission, l.djamo.commission],
    }],
    {
      x: MARGE + 7.3, y: 2.95, w: 5.4, h: 3.2,
      barDir: 'bar', chartColors: [C.rouge],
      showLegend: false, showValue: true,
      dataLabelFormatCode: '#,##0', dataLabelFontSize: 9, dataLabelPosition: 'outEnd',
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0',
    })
  note(s, 'Les coefficients ne portent que sur la part tablette : les espèces encaissées en direct ne subissent pas de commission.')
  return s
}

function slideLitiges(pptx, r) {
  const li = r.global.litiges
  const s = nouvelleSlide(pptx, 'Litiges du mois', `${r.label} · ${fmtF(li.total)} au total`)

  sousTitre(s, 'Par responsable', MARGE, 1.2, 6)
  const resp = limiter(li.parResponsable, 13)
  if (resp.visibles.length === 0) {
    s.addText('Aucun litige enregistré ce mois-ci.', {
      x: MARGE, y: 1.6, w: 6, h: 0.4, fontSize: 12, color: C.texteDoux, fontFace: POLICE,
    })
  } else {
    ajouterTableau(s, ['Responsable', 'Montant', 'Nb'],
      [...resp.visibles.map(x => [x.nom,
        { text: fmtF(x.montant), couleur: C.rouge, gras: true }, fmtNb(x.nb)]),
      ...(resp.reste > 0 ? [[{ text: `+ ${resp.reste} autre(s) responsable(s)`, couleur: C.texteDoux }, '', '']] : [])],
      { y: 1.55, w: 6.2, colW: [3.6, 1.9, 0.7], rowH: 0.3 })
  }

  sousTitre(s, 'Par type de litige', MARGE + 6.7, 1.2, 6)
  ajouterTableau(s, ['Type', 'Montant', 'Nb'],
    li.parType.map(x => [x.type, { text: fmtF(x.montant), couleur: C.rouge }, fmtNb(x.nb)]),
    { x: MARGE + 6.7, y: 1.55, w: 6, colW: [3.2, 2.1, 0.7], rowH: 0.3 })

  if (li.parType.length > 0) {
    s.addChart(pptx.ChartType.doughnut,
      [{ name: 'Litiges', labels: li.parType.map(x => x.type), values: li.parType.map(x => x.montant) }],
      {
        x: MARGE + 6.7, y: 3.3, w: 6, h: 3.1,
        chartColors: [C.rouge, C.orange, C.violet, '2E86DE'],
        showLegend: true, legendPos: 'b', legendFontSize: 10,
        showPercent: true, dataLabelFontSize: 10, dataLabelColor: C.blanc, holeSize: 45,
      })
  }
  note(s, "« Non attribué » regroupe les litiges sans responsable désigné dans l'écran Litiges.")
  return s
}

function slideInventaire(pptx, r) {
  const inv = r.global.inventaireDetail
  const s = nouvelleSlide(pptx, "Écarts d'inventaire", `${r.label} · ${fmtNb(inv.nbShifts)} inventaires de shift`)

  ajouterTuiles(s, pptx, [
    { label: 'MONTANT DÉDUIT', valeur: fmtF(inv.totalDeduit), couleur: C.rouge },
    { label: 'DÉDUCTIONS ANNULÉES', valeur: fmtF(inv.totalAnnule), couleur: C.vert },
    { label: 'ÉCARTS VALIDÉS', valeur: fmtNb(inv.decisions.validees), note: 'explication acceptée' },
    { label: 'ÉCARTS REFUSÉS', valeur: fmtNb(inv.decisions.refusees), note: 'déduction pleine' },
    { label: 'SANS DÉCISION', valeur: fmtNb(inv.decisions.sansDecision), couleur: inv.decisions.sansDecision > 0 ? C.orange : C.texte, note: 'à trancher' },
  ], 1.2, 1.2)

  sousTitre(s, 'Dix produits les plus touchés', MARGE, 2.65, 6)
  const top = inv.topProduits
  if (top.length === 0) {
    s.addText('Aucun écart d\'inventaire sur ce mois.', {
      x: MARGE, y: 3, w: 6, h: 0.4, fontSize: 12, color: C.texteDoux, fontFace: POLICE,
    })
  } else {
    ajouterTableau(s, ['Produit', 'Écart (qté)', 'Montant déduit', 'Occurrences'],
      top.map(p => [p.produit,
        { text: fmtNb(p.quantite), couleur: p.quantite < 0 ? C.rouge : C.vert },
        { text: fmtF(p.montant), couleur: C.rouge, gras: true },
        fmtNb(p.nb)]),
      { y: 3, w: 6.4, colW: [2.6, 1.3, 1.7, 0.8], rowH: 0.3 })

    sousTitre(s, 'Valeur déduite par produit', MARGE + 6.8, 2.65, 5.9)
    s.addChart(pptx.ChartType.bar,
      [{ name: 'Déduit', labels: top.map(p => p.produit), values: top.map(p => p.montant) }],
      {
        x: MARGE + 6.7, y: 3, w: 5.9, h: 3.2,
        barDir: 'bar', chartColors: [C.rouge],
        showLegend: false, showValue: true,
        dataLabelFormatCode: '#,##0', dataLabelFontSize: 8, dataLabelPosition: 'outEnd',
        catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0',
      })
  }
  note(s, "L'écart en quantité mélange les unités selon les produits (pièces, grammes) ; seule la valeur déduite est comparable d'un produit à l'autre.")
  return s
}

function slideEcartsCaisse(pptx, r) {
  const ec = r.global.ecartsCaissiers
  const s = nouvelleSlide(pptx, 'Écarts de caisse par caissier', `${r.label} · ${fmtNb(ec.length)} caissiers`)

  const manquants = ec.filter(c => c.total < 0)
  const totalManquant = manquants.reduce((a, c) => a + c.total, 0)
  ajouterTuiles(s, pptx, [
    { label: 'ÉCART CUMULÉ', valeur: fmtF(r.global.ecartCaisse), couleur: r.global.ecartCaisse < 0 ? C.rouge : C.vert },
    { label: 'TOTAL DES MANQUANTS', valeur: fmtF(totalManquant), couleur: C.rouge, note: `${manquants.length} caissiers concernés` },
    { label: 'AJUSTEMENTS DE FOND', valeur: fmtF(r.global.ajustementFond), note: 'corrections de fond de caisse' },
    { label: 'SHIFTS TRAVAILLÉS', valeur: fmtNb(r.global.nbShifts) },
  ], 1.2, 1.2)

  sousTitre(s, 'Détail par caissier — du plus gros manquant au plus gros excédent', MARGE, 2.65, 8)
  // 11 lignes au maximum : au-delà, le tableau descend sous la note de bas de page.
  const liste = limiter(ec, 11)
  ajouterTableau(s, ['Caissier', 'Écart cumulé', 'Shifts', 'Journées en écart'],
    [...liste.visibles.map(c => [c.nom,
      { text: fmtF(c.total), couleur: c.total < 0 ? C.rouge : c.total > 0 ? C.vert : C.texte, gras: true },
      fmtNb(c.nbShifts), fmtNb(c.nbJoursEcart)]),
    ...(liste.reste > 0 ? [[{ text: `+ ${liste.reste} autre(s) caissier(s)`, couleur: C.texteDoux }, '', '', '']] : [])],
    { y: 3, w: 7, colW: [3, 1.7, 1, 1.3], rowH: 0.28 })

  if (liste.visibles.length > 0) {
    sousTitre(s, 'Écart cumulé', MARGE + 7.4, 2.65, 5.3)
    s.addChart(pptx.ChartType.bar,
      [{ name: 'Écart', labels: liste.visibles.map(c => c.nom), values: liste.visibles.map(c => c.total) }],
      {
        x: MARGE + 7.3, y: 3, w: 5.4, h: 3.3,
        barDir: 'bar', chartColors: [C.rouge],
        showLegend: false, showValue: true,
        dataLabelFormatCode: '#,##0', dataLabelFontSize: 8,
        catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0',
      })
  }
  note(s, "Une journée tenue par plusieurs caissiers voit son écart réparti à parts égales entre eux : l'imputation nominative reste indicative.")
  return s
}

function slideRh(pptx, r) {
  const rh = r.global.rh
  const s = nouvelleSlide(pptx, 'Ressources humaines', r.label)

  ajouterTuiles(s, pptx, [
    { label: 'EFFECTIF DÉBUT DE MOIS', valeur: fmtNb(rh.effectifDebut) },
    { label: 'EFFECTIF FIN DE MOIS', valeur: fmtNb(rh.effectifFin), couleur: rh.effectifFin >= rh.effectifDebut ? C.vert : C.rouge },
    { label: 'ARRIVÉES', valeur: fmtNb(rh.arrivees.length), couleur: C.vert },
    { label: 'DÉPARTS', valeur: fmtNb(rh.departs.length), couleur: C.rouge },
    { label: 'MASSE SALARIALE', valeur: fmtF(rh.masseSalariale), couleur: C.violetFonce, petit: true },
    { label: 'TAUX DE PRÉSENCE', valeur: rh.tauxPresence == null ? '—' : `${rh.tauxPresence} %`, couleur: C.vert },
  ], 1.2, 1.2)

  sousTitre(s, `Arrivées du mois (${rh.arrivees.length})`, MARGE, 2.7, 4)
  const arr = limiter(rh.arrivees, 9)
  ajouterTableau(s, ['Date', 'Travailleur', 'Poste'],
    [...arr.visibles.map(a => [fmtDateFr(a.date), { text: a.nom, align: 'left' }, { text: a.poste, align: 'left' }]),
    ...(arr.reste > 0 ? [[{ text: `+ ${arr.reste}`, couleur: C.texteDoux }, '', '']] : [])],
    { y: 3.05, w: 4.1, colW: [0.9, 2.1, 1.1], rowH: 0.28, fontSize: 9 })

  sousTitre(s, `Départs du mois (${rh.departs.length})`, MARGE + 4.4, 2.7, 4.5)
  const dep = limiter(rh.departs, 9)
  ajouterTableau(s, ['Date', 'Travailleur', 'Motif'],
    [...dep.visibles.map(d => [fmtDateFr(d.date), { text: d.nom, align: 'left' }, { text: d.motif, align: 'left' }]),
    ...(dep.reste > 0 ? [[{ text: `+ ${dep.reste}`, couleur: C.texteDoux }, '', '']] : [])],
    { x: MARGE + 4.4, y: 3.05, w: 4.3, colW: [0.9, 2.2, 1.2], rowH: 0.28, fontSize: 9 })

  sousTitre(s, 'Répartition des pointages', MARGE + 9.1, 2.7, 3.6)
  if (rh.statuts.length > 0) {
    s.addChart(pptx.ChartType.doughnut,
      [{ name: 'Pointages', labels: rh.statuts.map(x => x.statut), values: rh.statuts.map(x => x.nb) }],
      {
        x: MARGE + 8.9, y: 3.05, w: 3.9, h: 3.2,
        chartColors: [C.vert, C.rouge, C.orange, C.violet, '2E86DE', 'AA2288'],
        showLegend: true, legendPos: 'b', legendFontSize: 9,
        showPercent: true, dataLabelFontSize: 9, dataLabelColor: C.blanc, holeSize: 45,
      })
  }
  note(s, `Masse salariale = somme des montants payés sur les ${fmtNb(rh.nbLignesPresence)} pointages du mois. Aucun salaire nominatif n'est publié dans ce rapport.`)
  return s
}

function slideJoursManquants(pptx, r) {
  const jm = r.global.joursManquants
  const s = nouvelleSlide(pptx, 'Journées sans point validé',
    `${r.label} · ${fmtNb(jm.reduce((a, x) => a + x.dates.length, 0))} journées manquantes`)

  if (jm.length === 0) {
    s.addShape(pptx.ShapeType.roundRect, {
      x: MARGE, y: 2.5, w: L - MARGE * 2, h: 1.4, rectRadius: 0.1,
      fill: { color: C.vertClair }, line: { color: C.vert, width: 1.5 },
    })
    s.addText('Aucune journée manquante : tous les restaurants ont validé leur point chaque jour du mois.', {
      x: MARGE, y: 2.5, w: L - MARGE * 2, h: 1.4, fontSize: 16, bold: true,
      color: '157548', fontFace: POLICE, align: 'center', valign: 'middle',
    })
    return s
  }

  ajouterTableau(s, ['Restaurant', 'Validés', 'Dates manquantes'],
    jm.map(x => [
      x.nom,
      { text: `${x.nbValides} / ${x.nbJours}`, couleur: C.rouge, gras: true },
      { text: x.dates.map(d => d.slice(8)).join('  ·  '), align: 'left', couleur: C.rouge },
    ]),
    { y: 1.3, colW: [3, 1.2, 8.03], rowH: 0.34 })
  note(s, 'Les numéros correspondent aux jours du mois. Une journée non validée ne remonte ni dans le chiffre d\'affaires ni dans les dépenses.')
  return s
}

function slideObjectifs(pptx, r) {
  const s = nouvelleSlide(pptx, 'Objectifs de chiffre d\'affaires', r.label)
  const avec = r.restaurants.filter(x => x.objectif)
  if (avec.length === 0) {
    s.addShape(pptx.ShapeType.roundRect, {
      x: MARGE, y: 2.4, w: L - MARGE * 2, h: 1.7, rectRadius: 0.1,
      fill: { color: C.orangeClair }, line: { color: C.orange, width: 1.5 },
    })
    s.addText(
      "Aucun objectif mensuel n'est renseigné.\n\n" +
      "Saisissez un objectif par restaurant depuis l'écran Restaurants pour que cette page affiche le taux d'atteinte.",
      { x: MARGE + 0.4, y: 2.4, w: L - MARGE * 2 - 0.8, h: 1.7, fontSize: 13,
        color: '7A4800', fontFace: POLICE, align: 'center', valign: 'middle' },
    )
    return s
  }
  ajouterTableau(s, ['Restaurant', 'Objectif', 'Réalisé', 'Écart', 'Atteinte'],
    avec.map(x => [
      x.nom, fmtF(x.objectif), fmtF(x.ca),
      { text: fmtF(x.ca - x.objectif), couleur: x.ca >= x.objectif ? C.vert : C.rouge },
      { text: `${x.tauxObjectif} %`, couleur: x.tauxObjectif >= 100 ? C.vert : C.orange, gras: true },
    ]),
    { y: 1.3, colW: [3.4, 2.2, 2.2, 2.2, 2.23], rowH: 0.36 })

  // Le tableau grandit avec le nombre de restaurants ; le graphique ne prend
  // la place restante que s'il en reste assez, sinon on le supprime plutôt
  // que de le laisser déborder sous le bas de la diapositive.
  const basTableau = 1.3 + 0.36 * (avec.length + 1)
  const hauteurDispo = H - basTableau - 0.6
  if (hauteurDispo >= 1.6) {
    s.addChart(pptx.ChartType.bar,
      [
        { name: 'Objectif', labels: avec.map(x => x.nom), values: avec.map(x => x.objectif) },
        { name: 'Réalisé', labels: avec.map(x => x.nom), values: avec.map(x => x.ca) },
      ],
      {
        x: MARGE, y: basTableau + 0.25, w: L - MARGE * 2, h: hauteurDispo - 0.25,
        barDir: 'col', barGrouping: 'clustered',
        chartColors: [C.texteDoux, C.violet],
        showLegend: true, legendPos: 'b', legendFontSize: 10,
        showValue: false, catAxisLabelFontSize: 9, valAxisLabelFontSize: 8,
        valAxisLabelFormatCode: '#,##0',
      })
  }
  return s
}

// ─── Slides par restaurant ───────────────────────────────────────────────

function slidesRestaurant(pptx, r, resto, index) {
  const marque = marquePourResto(resto.nom)
  const accent = (marque?.accent || '#5B52C8').replace('#', '')

  // ── Slide A : identité + chiffres clés + courbe ──
  const a = nouvelleSlide(pptx, resto.nom,
    `${r.label}${resto.localisation ? ` · ${resto.localisation}` : ''} · restaurant ${index + 1} sur ${r.restaurants.length}`)
  a.addShape(pptx.ShapeType.rect, { x: 0, y: 0.95, w: L, h: 0.06, fill: { color: accent } })

  ajouterTuiles(a, pptx, [
    { label: "CHIFFRE D'AFFAIRES", valeur: fmtF(resto.ca), couleur: C.violetFonce },
    { label: 'BÉNÉFICE', valeur: fmtF(resto.benefice), couleur: resto.benefice >= 0 ? C.vert : C.rouge },
    { label: 'DÉPENSES', valeur: fmtF(resto.depenses), couleur: C.rouge },
    { label: 'MARGE', valeur: resto.marge == null ? '—' : `${resto.marge} %` },
    { label: 'CA MOYEN / JOUR', valeur: fmtF(resto.caMoyenJour) },
    {
      label: 'OBJECTIF',
      valeur: resto.tauxObjectif == null ? '—' : `${resto.tauxObjectif} %`,
      couleur: resto.tauxObjectif == null ? C.texteDoux : resto.tauxObjectif >= 100 ? C.vert : C.orange,
      note: resto.objectif ? fmtF(resto.objectif) : 'non renseigné',
    },
  ], 1.25, 1.25)

  sousTitre(a, "Chiffre d'affaires jour par jour", MARGE, 2.75, 6)
  a.addChart(pptx.ChartType.line,
    [{ name: 'CA', labels: resto.serieJournaliere.map(x => String(x.jour)), values: resto.serieJournaliere.map(x => x.ca) }],
    {
      x: MARGE, y: 3.05, w: 7.6, h: 3.2,
      chartColors: [accent], lineSize: 2.5, lineSmooth: true,
      showLegend: false, catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
      valAxisLabelFormatCode: '#,##0',
    })

  sousTitre(a, 'Part du groupe', MARGE + 8, 2.75, 4.7)
  const partCa = r.global.ca ? Math.round((resto.ca / r.global.ca) * 1000) / 10 : 0
  ajouterTableau(a, ['Indicateur', 'Valeur'], [
    ['Part du CA du groupe', { text: `${partCa} %`, gras: true, couleur: C.violetFonce }],
    ['Rang au classement', { text: `${index + 1} / ${r.restaurants.length}`, gras: true }],
    ['Journées validées', `${resto.nbPointsValides} / ${resto.nbPoints}`],
    ['Shifts caissiers', fmtNb(resto.nbShifts)],
    ['Vente machine', fmtF(resto.venteMachine)],
    ['Kdo offerts', fmtF(resto.kdo)],
    ['Retours', fmtF(resto.retour)],
    ['Écart de caisse', { text: fmtF(resto.ecartCaisse), couleur: resto.ecartCaisse < 0 ? C.rouge : C.texte }],
    ['Litiges contacts', fmtF(resto.contactLitige)],
  ], { x: MARGE + 8, y: 3.05, w: 4.7, colW: [2.8, 1.9], rowH: 0.28, fontSize: 9 })

  // ── Slide B : exploitation ──
  const b = nouvelleSlide(pptx, `${resto.nom} — exploitation`, r.label)
  b.addShape(pptx.ShapeType.rect, { x: 0, y: 0.95, w: L, h: 0.06, fill: { color: accent } })

  sousTitre(b, 'Dépenses par catégorie', MARGE, 1.15, 4)
  const cats = resto.depensesParCategorie
  ajouterTableau(b, ['Catégorie', 'Montant'],
    [...cats.map(c => [c.categorie, fmtF(c.montant)]),
    [{ text: 'Total', gras: true }, { text: fmtF(cats.reduce((a2, c) => a2 + c.montant, 0)), gras: true }]],
    { y: 1.45, w: 4, colW: [2.3, 1.7], rowH: 0.27, fontSize: 9 })

  sousTitre(b, 'Cinq premiers fournisseurs', MARGE + 4.3, 1.15, 4.2)
  const topF = resto.fournisseurs.top.slice(0, 5)
  ajouterTableau(b, ['Fournisseur', 'Facturé', 'Crédit'],
    [...topF.map(f => [f.nom, fmtF(f.facture), fmtF(f.credit)]),
    [{ text: `Total (${resto.fournisseurs.nb} tr.)`, gras: true },
      { text: fmtF(resto.fournisseurs.facture), gras: true },
      { text: fmtF(resto.fournisseurs.credit), gras: true }]],
    { x: MARGE + 4.3, y: 1.45, w: 4.2, colW: [1.9, 1.25, 1.05], rowH: 0.27, fontSize: 9 })

  sousTitre(b, 'Livraisons', MARGE + 8.8, 1.15, 3.9)
  const rl = resto.livraisons
  ajouterTableau(b, ['Canal', 'Brut', 'Net'],
    [
      ['Yango', fmtF(rl.yango.cse + rl.yango.tab), fmtF(rl.yango.net)],
      ['Glovo', fmtF(rl.glovo.cse + rl.glovo.tab), fmtF(rl.glovo.net)],
      ['Wave', fmtF(rl.wave.brut), fmtF(rl.wave.net)],
      ['Orange Money', fmtF(rl.om.brut), fmtF(rl.om.net)],
      ['Djamo', fmtF(rl.djamo.brut), fmtF(rl.djamo.net)],
      [{ text: 'Commission', gras: true }, '', { text: fmtF(rl.totalCommission), gras: true, couleur: C.rouge }],
    ],
    { x: MARGE + 8.8, y: 1.45, w: 3.93, colW: [1.55, 1.19, 1.19], rowH: 0.27, fontSize: 9 })

  sousTitre(b, "Écarts d'inventaire — produits les plus touchés", MARGE, 3.75, 6)
  const topI = resto.inventaireDetail.topProduits.slice(0, 8)
  if (topI.length === 0) {
    b.addText("Aucun écart d'inventaire sur ce mois.", {
      x: MARGE, y: 4.05, w: 6, h: 0.4, fontSize: 11, color: C.texteDoux, fontFace: POLICE,
    })
  } else {
    ajouterTableau(b, ['Produit', 'Écart', 'Déduit'],
      topI.map(p => [p.produit,
        { text: fmtNb(p.quantite), couleur: p.quantite < 0 ? C.rouge : C.vert },
        { text: fmtF(p.montant), couleur: C.rouge }]),
      { y: 4.05, w: 6.1, colW: [3.1, 1.4, 1.6], rowH: 0.27, fontSize: 9 })
  }

  sousTitre(b, 'Synthèse inventaire et caisse', MARGE + 6.6, 3.75, 6)
  ajouterTableau(b, ['Indicateur', 'Valeur'], [
    ['Inventaires de shift', fmtNb(resto.inventaireDetail.nbShifts)],
    ['Montant déduit', { text: fmtF(resto.inventaireDetail.totalDeduit), couleur: C.rouge }],
    ['Déductions annulées', { text: fmtF(resto.inventaireDetail.totalAnnule), couleur: C.vert }],
    ['Écarts sans décision', { text: fmtNb(resto.inventaireDetail.decisions.sansDecision), couleur: resto.inventaireDetail.decisions.sansDecision > 0 ? C.orange : C.texte }],
    ['Montant inventaire du point', fmtF(resto.inventaire)],
    ['Ajustements de fond', fmtF(resto.ajustementFond)],
    ['Dépenses caisse gérant', fmtF(resto.depensesGerantCaisse)],
  ], { x: MARGE + 6.6, y: 4.05, w: 6.13, colW: [3.6, 2.53], rowH: 0.27, fontSize: 9 })

  // ── Slide C : personnel et incidents ──
  const c = nouvelleSlide(pptx, `${resto.nom} — personnel et incidents`, r.label)
  c.addShape(pptx.ShapeType.rect, { x: 0, y: 0.95, w: L, h: 0.06, fill: { color: accent } })

  ajouterTuiles(c, pptx, [
    { label: 'EFFECTIF FIN DE MOIS', valeur: fmtNb(resto.rh.effectifFin) },
    { label: 'ARRIVÉES', valeur: fmtNb(resto.rh.arrivees.length), couleur: C.vert },
    { label: 'DÉPARTS', valeur: fmtNb(resto.rh.departs.length), couleur: C.rouge },
    { label: 'MASSE SALARIALE', valeur: fmtF(resto.rh.masseSalariale), couleur: C.violetFonce, petit: true },
    { label: 'TAUX DE PRÉSENCE', valeur: resto.rh.tauxPresence == null ? '—' : `${resto.rh.tauxPresence} %`, couleur: C.vert },
    { label: 'LITIGES', valeur: fmtF(resto.litiges.total), couleur: C.rouge, petit: true },
  ], 1.2, 1.2)

  sousTitre(c, 'Mouvements du personnel', MARGE, 2.7, 5)
  const mouvements = [
    ...resto.rh.arrivees.map(x => ['Arrivée', fmtDateFr(x.date), x.nom, x.poste]),
    ...resto.rh.departs.map(x => ['Départ', fmtDateFr(x.date), x.nom, x.motif]),
  ].sort((x, y) => String(x[1]).localeCompare(String(y[1])))
  const mv = limiter(mouvements, 10)
  if (mouvements.length === 0) {
    c.addText('Aucun mouvement de personnel ce mois-ci.', {
      x: MARGE, y: 3, w: 6, h: 0.4, fontSize: 11, color: C.texteDoux, fontFace: POLICE,
    })
  } else {
    ajouterTableau(c, ['Type', 'Date', 'Travailleur', 'Poste / motif'],
      [...mv.visibles.map(m => [
        { text: m[0], couleur: m[0] === 'Arrivée' ? C.vert : C.rouge, gras: true, align: 'left' },
        m[1], { text: m[2], align: 'left' }, { text: m[3], align: 'left' },
      ]),
      ...(mv.reste > 0 ? [[{ text: `+ ${mv.reste} autre(s)`, couleur: C.texteDoux, align: 'left' }, '', '', '']] : [])],
      { y: 3, w: 6.2, colW: [0.9, 0.95, 2.35, 2], rowH: 0.28, fontSize: 9 })
  }

  sousTitre(c, 'Écarts de caisse par caissier', MARGE + 6.6, 2.7, 6)
  const ecr = limiter(resto.ecartsCaissiers, 8)
  ajouterTableau(c, ['Caissier', 'Écart', 'Shifts'],
    [...ecr.visibles.map(x => [x.nom,
      { text: fmtF(x.total), couleur: x.total < 0 ? C.rouge : x.total > 0 ? C.vert : C.texte, gras: true },
      fmtNb(x.nbShifts)]),
    ...(ecr.reste > 0 ? [[{ text: `+ ${ecr.reste} autre(s)`, couleur: C.texteDoux }, '', '']] : [])],
    { x: MARGE + 6.6, y: 3, w: 6.13, colW: [3.2, 1.9, 1.03], rowH: 0.28, fontSize: 9 })

  sousTitre(c, 'Litiges par responsable', MARGE + 6.6, 5.35, 6)
  const lr = limiter(resto.litiges.parResponsable, 3)
  if (resto.litiges.parResponsable.length === 0) {
    c.addText('Aucun litige.', {
      x: MARGE + 6.6, y: 5.65, w: 6, h: 0.3, fontSize: 10, color: C.texteDoux, fontFace: POLICE,
    })
  } else {
    ajouterTableau(c, ['Responsable', 'Montant', 'Nb'],
      [...lr.visibles.map(x => [x.nom, { text: fmtF(x.montant), couleur: C.rouge }, fmtNb(x.nb)]),
      ...(lr.reste > 0 ? [[{ text: `+ ${lr.reste} autre(s)`, couleur: C.texteDoux }, '', '']] : [])],
      { x: MARGE + 6.6, y: 5.65, w: 6.13, colW: [3.2, 1.9, 1.03], rowH: 0.26, fontSize: 9 })
  }
  return [a, b, c]
}

function slideMethodologie(pptx, r) {
  const s = nouvelleSlide(pptx, 'Méthodologie', 'Comment lire ce rapport')
  const blocs = [
    ["Chiffre d'affaires",
      "Somme du champ « vente totale » des points validés du mois. Une journée non validée n'est comptée nulle part."],
    ['Bénéfice sans charges (SC)',
      "Bénéfice calculé au point, avant déduction des charges mensuelles. Le bénéfice net retranche les charges saisies pour le mois."],
    ['Commissions de livraison',
      "Les coefficients (Yango 0,77 · Glovo 0,705 · Wave, Orange Money et Djamo 0,99) s'appliquent uniquement à la part tablette. Les espèces encaissées en direct sont perçues intégralement."],
    ['Dépenses et fournisseurs',
      "Rattachées au mois par le point du jour : ni les dépenses ni les transactions fournisseurs ne portent de date propre en base."],
    ["Écarts d'inventaire",
      "Seule la valeur effectivement déduite est comptée ; les déductions annulées sont suivies à part. Les quantités mélangent les unités selon les produits."],
    ['Écarts de caisse',
      "Portés par la journée, pas par le shift. Une journée tenue par plusieurs caissiers voit son écart réparti à parts égales : l'imputation nominative est indicative."],
    ['Ressources humaines',
      "Arrivée = date d'embauche, à défaut date de création de la fiche. Départ = date d'archivage du travailleur. La masse salariale agrège les montants payés sur les pointages, sans détail nominatif."],
    ['Litiges',
      "Regroupent Yango, Glovo, les avis clients et les écarts imputés à un responsable. « Non attribué » = aucun responsable désigné."],
  ]
  blocs.forEach((b, i) => {
    const col = i % 2
    const rang = Math.floor(i / 2)
    const x = MARGE + col * 6.4
    const y = 1.25 + rang * 1.52
    s.addText(b[0], { x, y, w: 6, h: 0.28, fontSize: 12, bold: true, color: C.violetFonce, fontFace: POLICE })
    s.addText(b[1], { x, y: y + 0.3, w: 6, h: 1.1, fontSize: 10, color: C.texteSecondaire, fontFace: POLICE, valign: 'top' })
  })
  note(s, `Rapport généré automatiquement par Samtrackly le ${new Date(r.genereLe).toLocaleString('fr-FR')} — document interne.`)
  return s
}

/** Variation locale (évite d'importer rapportMensuel juste pour ça). */
function variationLocale(actuel, precedent) {
  if (precedent == null || precedent === 0) return null
  return Math.round(((Number(actuel) - Number(precedent)) / Math.abs(Number(precedent))) * 1000) / 10
}

// ─── Génération PPTX ─────────────────────────────────────────────────────

export async function genererPptx(rapport, onProgres) {
  const dire = t => { if (typeof onProgres === 'function') onProgres(t) }
  dire('Construction des slides…')

  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  // ⚠️ LAYOUT_16x9 ne fait que 10 × 5,625 pouces chez pptxgenjs. C'est
  // LAYOUT_WIDE qui donne le vrai 16:9 de 13,333 × 7,5 sur lequel toute la
  // mise en page ci-dessus est calée (constantes L et H).
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Samtrackly'
  pptx.company = 'Chez Samer · Al Kayan'
  pptx.title = `Rapport mensuel — ${rapport.label}`
  pptx.subject = `Rapport d'activité ${rapport.label}`

  slideCouverture(pptx, rapport)
  slideSommaire(pptx, rapport)
  slideChiffresCles(pptx, rapport)
  slideComparatif(pptx, rapport)
  slideClassement(pptx, rapport)
  slideCourbeCa(pptx, rapport)
  slideDepenses(pptx, rapport)
  slideFournisseurs(pptx, rapport)
  slideLivraisons(pptx, rapport)
  slideLitiges(pptx, rapport)
  slideInventaire(pptx, rapport)
  slideEcartsCaisse(pptx, rapport)
  slideRh(pptx, rapport)

  rapport.restaurants.forEach((resto, i) => {
    dire(`Restaurant ${i + 1} / ${rapport.restaurants.length}…`)
    slidesRestaurant(pptx, rapport, resto, i)
  })

  slideJoursManquants(pptx, rapport)
  slideObjectifs(pptx, rapport)
  slideMethodologie(pptx, rapport)

  dire('Écriture du fichier PowerPoint…')
  const nomFichier = nomFichierRapport(rapport, 'pptx')

  // pptxgenjs n'honore `compression` que lorsque `outputType` est nul :
  // write({ outputType: 'base64' }) renvoie un zip simplement stocké, soit
  // ≈3,8 Mo au lieu de ≈0,5 Mo. Seul writeFile() emprunte la bonne branche —
  // et il déclenche lui-même le téléchargement navigateur.
  if (Platform.OS === 'web') {
    await pptx.writeFile({ fileName: nomFichier, compression: true })
    return { telecharge: true, nomFichier }
  }
  // Sur mobile, base64 reste le seul format exploitable par expo-file-system.
  return { base64: await pptx.write({ outputType: 'base64' }), nomFichier }
}

// ─── Génération XLSX ─────────────────────────────────────────────────────

export async function genererXlsx(rapport, onProgres) {
  const dire = t => { if (typeof onProgres === 'function') onProgres(t) }
  dire('Construction du classeur Excel…')

  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const g = rapport.global

  // Excel refuse les noms d'onglet au-delà de 31 caractères.
  const ajouterFeuille = (nom, lignes) => {
    const titre = nom.slice(0, 31)
    if (!lignes || lignes.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Aucune donnée pour ce mois']]), titre)
      return
    }
    const ws = XLSX.utils.json_to_sheet(lignes)
    // Largeurs calées sur le contenu (200 premières lignes), plafonnées.
    ws['!cols'] = Object.keys(lignes[0]).map(k => ({
      wch: Math.min(38, Math.max(10, k.length + 2,
        ...lignes.slice(0, 200).map(l => String(l[k] ?? '').length + 2))),
    }))
    ws['!autofilter'] = { ref: ws['!ref'] }
    XLSX.utils.book_append_sheet(wb, ws, titre)
  }

  // Feuille 1 — synthèse
  const synthese = [
    ['RAPPORT MENSUEL', rapport.label],
    ['Période', `${rapport.debut} → ${rapport.fin}`],
    ['Généré le', new Date(rapport.genereLe).toLocaleString('fr-FR')],
    [],
    ['INDICATEUR', 'VALEUR', 'MOIS PRÉCÉDENT', 'VARIATION %'],
    ...[
      ["Chiffre d'affaires", g.ca, rapport.precedent?.ca],
      ['Bénéfice sans charges', g.benefice, rapport.precedent?.benefice],
      ['Dépenses', g.depenses, rapport.precedent?.depenses],
      ['Charges', g.charges, rapport.precedent?.charges],
      ['Bénéfice net', g.beneficeNet, rapport.precedent?.beneficeNet],
      ['Marge %', g.marge, rapport.precedent?.marge],
      ['Achats fournisseurs', g.fournisseurs.facture, rapport.precedent?.fournisseurs.facture],
      ['Crédit fournisseurs', g.fournisseurs.credit, rapport.precedent?.fournisseurs.credit],
      ['Écart de caisse', g.ecartCaisse, rapport.precedent?.ecartCaisse],
      ['Ajustements de fond', g.ajustementFond, rapport.precedent?.ajustementFond],
      ["Écarts d'inventaire déduits", g.inventaireDetail.totalDeduit, rapport.precedent?.inventaireDetail.totalDeduit],
      ['Litiges', g.litiges.total, rapport.precedent?.litiges.total],
      ['Masse salariale', g.rh.masseSalariale, rapport.precedent?.rh.masseSalariale],
      ['Effectif fin de mois', g.rh.effectifFin, rapport.precedent?.rh.effectifFin],
      ['Arrivées', g.rh.arrivees.length, rapport.precedent?.rh.arrivees.length],
      ['Départs', g.rh.departs.length, rapport.precedent?.rh.departs.length],
      ['Journées validées', g.nbPointsValides, rapport.precedent?.nbPointsValides],
      ['Shifts caissiers', g.nbShifts, rapport.precedent?.nbShifts],
      ['Livraisons — brut', g.livraisons.totalBrut, rapport.precedent?.livraisons.totalBrut],
      ['Livraisons — commissions', g.livraisons.totalCommission, rapport.precedent?.livraisons.totalCommission],
      ['Commandes livrées', g.livraisons.nbCmd, rapport.precedent?.livraisons.nbCmd],
    ].map(([label, actuel, prec]) => [label, actuel ?? 0, prec ?? '', variationLocale(actuel, prec) ?? '']),
  ]
  const wsSynth = XLSX.utils.aoa_to_sheet(synthese)
  wsSynth['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, wsSynth, 'Synthèse')

  // Feuille 2 — par restaurant
  ajouterFeuille('Par restaurant', rapport.restaurants.map(x => ({
    Restaurant: x.nom,
    Localisation: x.localisation || '—',
    "Chiffre d'affaires": x.ca,
    'Bénéfice': x.benefice,
    'Dépenses': x.depenses,
    'Charges': x.charges,
    'Bénéfice net': x.beneficeNet,
    'Marge %': x.marge ?? '',
    'Objectif': x.objectif ?? '',
    'Atteinte %': x.tauxObjectif ?? '',
    'CA moyen/jour': x.caMoyenJour,
    'Journées validées': x.nbPointsValides,
    'Shifts': x.nbShifts,
    'Achats fournisseurs': x.fournisseurs.facture,
    'Crédit fournisseurs': x.fournisseurs.credit,
    'Écart de caisse': x.ecartCaisse,
    'Ajustement fond': x.ajustementFond,
    'Inventaire déduit': x.inventaireDetail.totalDeduit,
    'Litiges': x.litiges.total,
    'Masse salariale': x.rh.masseSalariale,
    'Effectif fin': x.rh.effectifFin,
    'Arrivées': x.rh.arrivees.length,
    'Départs': x.rh.departs.length,
    'Taux présence %': x.rh.tauxPresence ?? '',
    'Livraisons brut': x.livraisons.totalBrut,
    'Commissions': x.livraisons.totalCommission,
  })))

  // Feuille 3 — CA jour par jour, une colonne par restaurant
  const serie = g.serieJournaliere.map((jour, i) => {
    const ligne = { Jour: jour.jour, Date: jour.date, 'TOTAL groupe': jour.ca }
    rapport.restaurants.forEach(x => { ligne[x.nom] = x.serieJournaliere[i]?.ca ?? 0 })
    return ligne
  })
  ajouterFeuille('CA journalier', serie)

  dire('Ajout du détail ligne par ligne…')
  const li = rapport.lignes
  ajouterFeuille('Points', li.points)
  ajouterFeuille('Dépenses', li.depenses)
  ajouterFeuille('Dépenses caisse gérant', li.depensesGerant)
  ajouterFeuille('Fournisseurs', li.fournisseurs)
  ajouterFeuille('Présences', li.presences)
  ajouterFeuille('Shifts caissiers', li.shifts)
  ajouterFeuille("Écarts d'inventaire", li.inventaire)
  ajouterFeuille('Litiges', li.litiges)
  ajouterFeuille('Charges', li.charges)
  ajouterFeuille('Mouvements RH', li.mouvementsRh)

  // Feuilles d'analyse
  ajouterFeuille('Écarts caisse par caissier', g.ecartsCaissiers.map(c => ({
    Caissier: c.nom, 'Écart cumulé': c.total, Shifts: c.nbShifts, 'Journées en écart': c.nbJoursEcart,
  })))
  ajouterFeuille('Litiges par responsable', g.litiges.parResponsable.map(x => ({
    Responsable: x.nom, Montant: x.montant, 'Nombre de litiges': x.nb,
  })))
  ajouterFeuille('Top produits en écart', g.inventaireDetail.topProduits.map(p => ({
    Produit: p.produit, 'Écart quantité': p.quantite, 'Montant déduit': p.montant, Occurrences: p.nb,
  })))
  ajouterFeuille('Journées manquantes', g.joursManquants.flatMap(x =>
    x.dates.map(d => ({ Restaurant: x.nom, 'Date manquante': d, 'Validées': `${x.nbValides}/${x.nbJours}` }))))

  dire('Écriture du fichier Excel…')
  // `compression` est également désactivé par défaut chez SheetJS.
  return { base64: XLSX.write(wb, { type: 'base64', bookType: 'xlsx', compression: true }) }
}

// ─── Génération PDF ──────────────────────────────────────────────────────
//
//  Le PDF est construit directement avec jsPDF, et NON via expo-print :
//  sur le web, expo-print est un bouchon qui appelle window.print() en
//  ignorant le HTML fourni (voir ExponentPrint.web.ts). Résultat : aucune
//  fenêtre de téléchargement, et au mieux l'impression de l'écran de l'app
//  au lieu du rapport. jsPDF produit un vrai fichier, téléchargé comme le
//  PowerPoint et l'Excel, avec le même chemin sur mobile.

const PDF_C = {
  violet: [91, 82, 200],
  violetFonce: [62, 53, 160],
  texte: [24, 24, 46],
  texteDoux: [136, 136, 170],
  vert: [31, 173, 107],
  rouge: [212, 64, 64],
  orange: [240, 160, 32],
  fondAlt: [244, 244, 252],
}

/** Enveloppe jsPDF + autoTable avec les repères de mise en page du rapport. */
function creerDocument(rapport, jsPDF, autoTable) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const LARGEUR = doc.internal.pageSize.getWidth()
  const HAUTEUR = doc.internal.pageSize.getHeight()
  const M = 14
  let y = M

  const espace = h => { if (y + h > HAUTEUR - 16) nouvellePage(); }
  const nouvellePage = () => { doc.addPage(); y = M }

  function titre(texte) {
    espace(16)
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...PDF_C.violetFonce)
    doc.text(T(texte), M, y + 5)
    doc.setDrawColor(...PDF_C.violet).setLineWidth(0.5)
    doc.line(M, y + 7, LARGEUR - M, y + 7)
    y += 12
  }

  function tableau(entetes, lignes, options = {}) {
    if (!lignes || lignes.length === 0) {
      doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(...PDF_C.texteDoux)
      doc.text(T(options.vide || 'Aucune donnée.'), M, y + 3, { maxWidth: LARGEUR - M * 2 })
      y += 9
      return
    }
    autoTable(doc, {
      head: [entetes.map(T)],
      body: lignes.map(l => l.map(T)),
      startY: y,
      margin: { left: M, right: M },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: PDF_C.texte,
        lineColor: [232, 232, 245], lineWidth: 0.1 },
      headStyles: { fillColor: PDF_C.violet, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: PDF_C.fondAlt },
      columnStyles: options.colonnes || {},
      didDrawPage: () => { y = M },
    })
    y = doc.lastAutoTable.finalY + 7
  }

  /** Bandeau de tuiles chiffrées, réparties sur la largeur. */
  function tuiles(items) {
    espace(20)
    const largeur = (LARGEUR - M * 2 - 3 * (items.length - 1)) / items.length
    items.forEach((t, i) => {
      const x = M + i * (largeur + 3)
      doc.setFillColor(...PDF_C.fondAlt).roundedRect(x, y, largeur, 16, 1.5, 1.5, 'F')
      doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...PDF_C.texteDoux)
      doc.text(T(t.label).toUpperCase(), x + largeur / 2, y + 5, { align: 'center', maxWidth: largeur - 3 })
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...(t.couleur || PDF_C.texte))
      doc.text(T(t.valeur), x + largeur / 2, y + 11.5, { align: 'center', maxWidth: largeur - 3 })
    })
    y += 21
  }

  return { doc, LARGEUR, HAUTEUR, M, titre, tableau, tuiles,
    get y() { return y }, set y(v) { y = v }, nouvellePage }
}

export async function genererPdf(rapport, onProgres) {
  const dire = t => { if (typeof onProgres === 'function') onProgres(t) }
  dire('Mise en page du PDF…')

  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const g = rapport.global
  const D = creerDocument(rapport, jsPDF, autoTable)
  const { doc, LARGEUR, M } = D

  // ── Entête ──
  doc.setFillColor(...PDF_C.violet).rect(0, 0, LARGEUR, 30, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(255, 255, 255)
  doc.text('Rapport mensuel', M, 14)
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(201, 196, 248)
  doc.text(T(rapport.label), M, 22)
  doc.setFontSize(8)
  doc.text(T(
    `${g.nbRestaurants} restaurants · ${fmtNb(g.nbPointsValides)} journées validées · ` +
    `du ${fmtDateFr(rapport.debut)} au ${fmtDateFr(rapport.fin)}`),
    LARGEUR - M, 22, { align: 'right' },
  )
  D.y = 38

  D.tuiles([
    { label: "Chiffre d'affaires", valeur: fmtF(g.ca), couleur: PDF_C.violetFonce },
    { label: 'Bénéfice', valeur: fmtF(g.benefice), couleur: PDF_C.vert },
    { label: 'Dépenses', valeur: fmtF(g.depenses), couleur: PDF_C.rouge },
    { label: 'Charges', valeur: fmtF(g.charges), couleur: PDF_C.rouge },
  ])
  D.tuiles([
    { label: 'Bénéfice net', valeur: fmtF(g.beneficeNet), couleur: g.beneficeNet >= 0 ? PDF_C.vert : PDF_C.rouge },
    { label: 'Marge', valeur: g.marge == null ? '—' : `${g.marge} %` },
    { label: 'CA moyen / jour', valeur: fmtF(g.caMoyenJour) },
    { label: 'Shifts caissiers', valeur: fmtNb(g.nbShifts) },
  ])

  // ── Comparatif ──
  D.titre(`Comparatif avec le mois précédent${rapport.precedent ? ` — ${rapport.precedent.label}` : ''}`)
  if (!rapport.precedent) {
    D.tableau([], [], { vide: "Aucun mois précédent exploitable en base." })
  } else {
    const p = rapport.precedent
    D.tableau(['Indicateur', rapport.label, p.label, 'Variation'], [
      ["Chiffre d'affaires", g.ca, p.ca],
      ['Bénéfice sans charges', g.benefice, p.benefice],
      ['Dépenses', g.depenses, p.depenses],
      ['Charges', g.charges, p.charges],
      ['Bénéfice net', g.beneficeNet, p.beneficeNet],
      ['Achats fournisseurs', g.fournisseurs.facture, p.fournisseurs.facture],
      ["Écarts d'inventaire déduits", g.inventaireDetail.totalDeduit, p.inventaireDetail.totalDeduit],
      ['Litiges', g.litiges.total, p.litiges.total],
      ['Masse salariale', g.rh.masseSalariale, p.rh.masseSalariale],
      ['Journées validées', g.nbPointsValides, p.nbPointsValides],
    ].map(([label, a, b]) => {
      const estMontant = label !== 'Journées validées'
      return [label, estMontant ? fmtF(a) : fmtNb(a), estMontant ? fmtF(b) : fmtNb(b),
        fmtPct(variationLocale(a, b))]
    }), { colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } })
  }

  // ── Classement ──
  D.titre('Classement des restaurants')
  D.tableau(['Restaurant', "Chiffre d'affaires", 'Bénéfice', 'Marge', 'Dépenses', 'Jours', 'Objectif'],
    [
      ...rapport.restaurants.map((x, i) => [`${i + 1}. ${x.nom}`, fmtF(x.ca), fmtF(x.benefice),
        x.marge == null ? '—' : `${x.marge} %`, fmtF(x.depenses), fmtNb(x.nbPointsValides),
        x.tauxObjectif == null ? '—' : `${x.tauxObjectif} %`]),
      ['TOTAL', fmtF(g.ca), fmtF(g.benefice), g.marge == null ? '—' : `${g.marge} %`,
        fmtF(g.depenses), fmtNb(g.nbPointsValides), g.tauxObjectif == null ? '—' : `${g.tauxObjectif} %`],
    ],
    { colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } })

  // ── Dépenses et charges ──
  D.titre('Dépenses et charges')
  const totalDep = g.depensesParCategorie.reduce((a, c) => a + c.montant, 0)
  D.tableau(['Catégorie', 'Montant', 'Part'],
    [...g.depensesParCategorie.map(c => [c.categorie, fmtF(c.montant),
      totalDep ? `${Math.round((c.montant / totalDep) * 1000) / 10} %` : '—']),
    ['TOTAL', fmtF(totalDep), '100 %']],
    { colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' } } })

  D.tableau(['Charge', 'Montant'],
    g.detailCharges.map(c => [c.libelle, fmtF(c.montant)]),
    { vide: 'Aucune charge saisie pour ce mois : le bénéfice net est égal au bénéfice sans charges.',
      colonnes: { 1: { halign: 'right' } } })

  // ── Livraisons ──
  D.titre('Livraisons et commissions')
  const l = g.livraisons
  D.tableau(['Canal', 'Brut encaissé', 'Coefficient', 'Net perçu', 'Commission'], [
    ['Yango — espèces', fmtF(l.yango.cse), '—', fmtF(l.yango.cse), fmtF(0)],
    ['Yango — tablette', fmtF(l.yango.tab), '× 0,77', fmtF(l.yango.tab * 0.77), fmtF(l.yango.commission)],
    ['Glovo — espèces', fmtF(l.glovo.cse), '—', fmtF(l.glovo.cse), fmtF(0)],
    ['Glovo — tablette', fmtF(l.glovo.tab), '× 0,705', fmtF(l.glovo.tab * 0.705), fmtF(l.glovo.commission)],
    ['Wave', fmtF(l.wave.brut), '× 0,99', fmtF(l.wave.net), fmtF(l.wave.commission)],
    ['Orange Money', fmtF(l.om.brut), '× 0,99', fmtF(l.om.net), fmtF(l.om.commission)],
    ['Djamo', fmtF(l.djamo.brut), '× 0,99', fmtF(l.djamo.net), fmtF(l.djamo.commission)],
    ['TOTAL', fmtF(l.totalBrut), '', fmtF(l.totalNet), fmtF(l.totalCommission)],
  ], { colonnes: { 1: { halign: 'right' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } } })
  doc.setFont('helvetica', 'italic').setFontSize(7).setTextColor(...PDF_C.texteDoux)
  doc.text(T(`${fmtNb(l.nbCmd)} commandes livrées · Yango ${fmtNb(l.yango.nbCmd)} · Glovo ${fmtNb(l.glovo.nbCmd)}`), M, D.y)
  D.y += 6

  // ── Fournisseurs ──
  D.titre('Fournisseurs — dix premiers du mois')
  D.tableau(['Fournisseur', 'Facturé', 'Payé', 'Crédit', 'Nb'],
    [...g.fournisseurs.top.map(f => [f.nom, fmtF(f.facture), fmtF(f.paye), fmtF(f.credit), fmtNb(f.nb)]),
    ['TOTAL du mois', fmtF(g.fournisseurs.facture), fmtF(g.fournisseurs.paye),
      fmtF(g.fournisseurs.credit), fmtNb(g.fournisseurs.nb)]],
    { colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } })

  // ── Litiges ──
  D.titre('Litiges du mois')
  D.tableau(['Type', 'Montant', 'Nombre'],
    g.litiges.parType.map(x => [x.type, fmtF(x.montant), fmtNb(x.nb)]),
    { vide: 'Aucun litige enregistré ce mois-ci.',
      colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' } } })
  if (g.litiges.parResponsable.length > 0) {
    D.tableau(['Responsable', 'Montant', 'Nombre'],
      g.litiges.parResponsable.map(x => [x.nom, fmtF(x.montant), fmtNb(x.nb)]),
      { colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' } } })
  }

  // ── Inventaire ──
  D.titre("Écarts d'inventaire")
  D.tuiles([
    { label: 'Montant déduit', valeur: fmtF(g.inventaireDetail.totalDeduit), couleur: PDF_C.rouge },
    { label: 'Déductions annulées', valeur: fmtF(g.inventaireDetail.totalAnnule), couleur: PDF_C.vert },
    { label: 'Écarts validés', valeur: fmtNb(g.inventaireDetail.decisions.validees) },
    { label: 'Écarts refusés', valeur: fmtNb(g.inventaireDetail.decisions.refusees) },
    { label: 'Sans décision', valeur: fmtNb(g.inventaireDetail.decisions.sansDecision),
      couleur: g.inventaireDetail.decisions.sansDecision > 0 ? PDF_C.orange : PDF_C.texte },
  ])
  D.tableau(['Produit', 'Écart (qté)', 'Montant déduit', 'Occurrences'],
    g.inventaireDetail.topProduits.map(p => [p.produit, fmtNb(p.quantite), fmtF(p.montant), fmtNb(p.nb)]),
    { vide: "Aucun écart d'inventaire sur ce mois.",
      colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } })

  // ── Écarts de caisse ──
  D.titre('Écarts de caisse par caissier')
  D.tableau(['Caissier', 'Écart cumulé', 'Shifts', 'Journées en écart'],
    g.ecartsCaissiers.map(c => [c.nom, fmtF(c.total), fmtNb(c.nbShifts), fmtNb(c.nbJoursEcart)]),
    { vide: 'Aucun shift caissier sur ce mois.',
      colonnes: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } })

  // ── RH ──
  D.titre('Ressources humaines')
  D.tuiles([
    { label: 'Effectif début', valeur: fmtNb(g.rh.effectifDebut) },
    { label: 'Effectif fin', valeur: fmtNb(g.rh.effectifFin) },
    { label: 'Arrivées', valeur: fmtNb(g.rh.arrivees.length), couleur: PDF_C.vert },
    { label: 'Départs', valeur: fmtNb(g.rh.departs.length), couleur: PDF_C.rouge },
    { label: 'Masse salariale', valeur: fmtF(g.rh.masseSalariale), couleur: PDF_C.violetFonce },
    { label: 'Taux de présence', valeur: g.rh.tauxPresence == null ? '—' : `${g.rh.tauxPresence} %` },
  ])
  if (g.rh.arrivees.length) {
    D.tableau(['Arrivée', 'Travailleur', 'Poste'],
      g.rh.arrivees.map(a => [fmtDateFr(a.date), a.nom, a.poste]))
  }
  if (g.rh.departs.length) {
    D.tableau(['Départ', 'Travailleur', 'Motif'],
      g.rh.departs.map(d => [fmtDateFr(d.date), d.nom, d.motif]))
  }

  // ── Journées manquantes ──
  D.titre('Journées sans point validé')
  D.tableau(['Restaurant', 'Validées', 'Dates manquantes'],
    g.joursManquants.map(x => [x.nom, `${x.nbValides}/${x.nbJours}`, x.dates.map(d => d.slice(8)).join(' · ')]),
    { vide: 'Aucune journée manquante : tous les restaurants ont validé leur point chaque jour.',
      colonnes: { 1: { halign: 'center' } } })

  // ── Détail par restaurant ──
  D.titre('Détail par restaurant')
  rapport.restaurants.forEach(x => {
    D.tableau(
      [`${x.nom}${x.localisation ? ` — ${x.localisation}` : ''}`, ''],
      [
        ["Chiffre d'affaires", fmtF(x.ca)],
        ['Bénéfice sans charges', fmtF(x.benefice)],
        ['Dépenses', fmtF(x.depenses)],
        ['Marge', x.marge == null ? '—' : `${x.marge} %`],
        ['Objectif / atteinte', x.objectif ? `${fmtF(x.objectif)} · ${x.tauxObjectif} %` : '—'],
        ['Achats fournisseurs', fmtF(x.fournisseurs.facture)],
        ['Écart de caisse', fmtF(x.ecartCaisse)],
        ["Écarts d'inventaire déduits", fmtF(x.inventaireDetail.totalDeduit)],
        ['Litiges', fmtF(x.litiges.total)],
        ['Masse salariale', fmtF(x.rh.masseSalariale)],
        ['Effectif fin · arrivées · départs',
          `${x.rh.effectifFin} · +${x.rh.arrivees.length} · −${x.rh.departs.length}`],
      ],
      { colonnes: { 1: { halign: 'right' } } })
  })

  // ── Pieds de page ──
  const total = doc.internal.getNumberOfPages()
  const genere = new Date(rapport.genereLe).toLocaleString('fr-FR')
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...PDF_C.texteDoux)
    doc.text(T(`Samtrackly · rapport mensuel ${rapport.label} · document interne · généré le ${genere}`),
      M, doc.internal.pageSize.getHeight() - 8)
    doc.text(`${i} / ${total}`, LARGEUR - M, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
  }

  dire('Écriture du fichier PDF…')
  // datauristring → on ne garde que la charge utile base64.
  return { base64: doc.output('datauristring').split(',')[1] }
}

// ─── Enregistrement / partage ────────────────────────────────────────────

function base64VersOctets(base64) {
  const binaire = atob(base64)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

function base64VersBlob(base64, mime) {
  return new Blob([base64VersOctets(base64)], { type: mime })
}

/**
 * Web : téléchargement direct. iOS/Android : écriture puis feuille de partage.
 * `contenu` vaut soit { blob } (web, déjà compressé) soit { base64 }.
 * Le fichier est nommé « Rapport_Juillet_2026.pptx ».
 */
export async function enregistrer(nomFichier, contenu, mime) {
  const { blob, base64 } = contenu

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(blob || base64VersBlob(base64, mime))
    const a = document.createElement('a')
    a.href = url
    a.download = nomFichier
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Laisse au navigateur le temps de démarrer le téléchargement.
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return { telecharge: true, nomFichier }
  }

  const fichier = new File(Paths.document, nomFichier)
  if (fichier.exists) fichier.delete()
  fichier.create()
  fichier.write(base64VersOctets(base64))
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fichier.uri, { mimeType: mime, dialogTitle: nomFichier })
  }
  return { telecharge: true, nomFichier }
}

/** Nom de fichier du rapport : « Rapport_Juillet_2026.pptx ». */
export function nomFichierRapport(rapport, extension) {
  return `Rapport_${rapport.label.replace(/\s+/g, '_')}.${extension}`
}

const MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

/** Génère puis enregistre le PowerPoint. */
export async function exporterPptx(rapport, onProgres) {
  const res = await genererPptx(rapport, onProgres)
  // Sur le web, pptxgenjs a déjà poussé le téléchargement lui-même.
  if (res.telecharge) return res
  return enregistrer(res.nomFichier, { base64: res.base64 }, MIME.pptx)
}

/** Génère puis enregistre le classeur Excel. */
export async function exporterXlsx(rapport, onProgres) {
  const contenu = await genererXlsx(rapport, onProgres)
  return enregistrer(nomFichierRapport(rapport, 'xlsx'), contenu, MIME.xlsx)
}

/** Génère le PDF (impression sur web, partage sur mobile). */
/** Génère puis enregistre le PDF — même chemin que le PPTX et l'Excel. */
export async function exporterPdf(rapport, onProgres) {
  const contenu = await genererPdf(rapport, onProgres)
  return enregistrer(nomFichierRapport(rapport, 'pdf'), contenu, MIME.pdf)
}
