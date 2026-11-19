// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — rapport des dépenses direction sur une période (19/11/2026).
//
// Les dépenses identiques (même catégorie, même restaurant : « Fond · Zabad »)
// sont regroupées : un total par groupe, puis en dessous les jours et les
// sommes. Les lignes de correction d'un fond sont comptées avec leur signe.
// Écran : app/tresorerie-direction.js · tests : lib/rapportDirection.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { categorieDirection } from './direction.js'

const n = v => Number(v) || 0

// depenses : lignes de tresorerie_depenses_direction ; debut / fin : 'AAAA-MM-JJ'
// inclus. Groupes du plus gros total au plus petit ; jours du plus ancien au
// plus récent (même jour : sommes additionnées).
export function rapportDepensesDirection(depenses = [], { debut, fin }, nomResto = id => id || 'Groupe') {
  const groupes = new Map()
  for (const d of depenses) {
    if (!d?.date || d.date < debut || d.date > fin || n(d.montant) === 0) continue
    const cle = `${d.categorie}|${d.restaurant_id || ''}`
    let g = groupes.get(cle)
    if (!g) {
      g = {
        cle,
        titre: `${categorieDirection(d.categorie)?.label || 'Dépense'} · ${nomResto(d.restaurant_id || null)}`,
        total: 0, nb: 0, jours: new Map(),
      }
      groupes.set(cle, g)
    }
    g.total += n(d.montant)
    g.nb += 1
    g.jours.set(d.date, (g.jours.get(d.date) || 0) + n(d.montant))
  }
  const liste = [...groupes.values()]
    .map(g => ({
      cle: g.cle, titre: g.titre, total: g.total, nb: g.nb,
      jours: [...g.jours.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, montant]) => ({ date, montant })),
    }))
    .sort((a, b) => b.total - a.total || a.titre.localeCompare(b.titre))
  return { groupes: liste, total: liste.reduce((s, g) => s + g.total, 0), nb: liste.reduce((s, g) => s + g.nb, 0) }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmtF = v => `${n(v) < 0 ? '− ' : ''}${Math.abs(Math.round(n(v))).toLocaleString('fr-FR').replace(/ | /g, ' ')} F`
const dateFR = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

// HTML du PDF (lib/pdfDocuments.js → exporterPdf).
export function htmlRapportDirection(rapport, { debut, fin, auteur = '' }) {
  const groupes = rapport.groupes.map(g => `
    <div class="g">
      <div class="g-h"><span>${esc(g.titre)}</span><span>${fmtF(g.total)}</span></div>
      <div class="g-nb">${g.nb} dépense${g.nb > 1 ? 's' : ''}</div>
      <table>${g.jours.map(j => `<tr><td>${dateFR(j.date)}</td><td class="m">${fmtF(j.montant)}</td></tr>`).join('')}</table>
    </div>`).join('')
  return `<html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#333;padding:20px;margin:0}
    h1{font-size:18px;color:#475569;margin:0 0 4px}
    .sub{font-size:11px;color:#888;margin-bottom:16px}
    .resume{border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin-bottom:16px}
    .resume div{display:flex;justify-content:space-between;padding:3px 0}
    .resume .tot{font-weight:bold;font-size:14px;border-top:1px solid #ddd;margin-top:4px;padding-top:6px}
    .g{border:1px solid #ddd;border-radius:8px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid}
    .g-h{background:#475569;color:#fff;padding:8px 14px;display:flex;justify-content:space-between;font-weight:bold;font-size:13px}
    .g-nb{padding:4px 14px;font-size:10px;color:#888}
    table{width:100%;border-collapse:collapse}
    td{padding:4px 14px;border-top:1px solid #f0f0f0}
    td.m{text-align:right}
    .pied{margin-top:30px;font-size:11px;color:#555;text-align:right}
  </style></head><body>
    <h1>Dépenses direction</h1>
    <div class="sub">Du ${dateFR(debut)} au ${dateFR(fin)}</div>
    <div class="resume">
      ${rapport.groupes.map(g => `<div><span>${esc(g.titre)}</span><span>${fmtF(g.total)}</span></div>`).join('')}
      <div class="tot"><span>Total (${rapport.nb} dépense${rapport.nb > 1 ? 's' : ''})</span><span>${fmtF(rapport.total)}</span></div>
    </div>
    ${groupes || '<p>Aucune dépense sur cette période.</p>'}
    ${auteur ? `<div class="pied">Tiré par ${esc(auteur)}</div>` : ''}
  </body></html>`
}
