// ──────────────────────────────────────────────────────────────────────────────
//  AVIS CLIENTS — Résumé et attribution aux caissiers (pur, testé)
//
//  Périodes et période précédente (pour les flèches ↑↓), chiffres clés,
//  caissier d'un avis, classements et motifs de l'onglet Résumé de l'écran
//  Avis clients, et bons avis pour la note des caissiers.
//
//  Caissier d'un avis : le responsable de son litige s'il en a un (le manager
//  peut l'avoir corrigé), sinon le caissier présent à l'heure de la commande
//  (lib/attributionAvis.js, règle du 03/10). Abidjan = UTC.
//  Tests : lib/avisResume.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
import { caissierAuMoment } from './attributionAvis.js'
import { classifierAvis, kpisAvis } from './avisPlateformes.js'

const JOUR = 86_400_000

export const PERIODES_AVIS = [
  { cle: 'jour', label: "Aujourd'hui" },
  { cle: 'hier', label: 'Hier' },
  { cle: 'semaine', label: '7 jours' },
  { cle: 'mois', label: '30 jours' },
  { cle: 'mois_calendaire', label: 'Ce mois' },
  { cle: 'mois_dernier', label: 'Mois dernier' },
  { cle: 'perso', label: '📅 Dates au choix' },
]

export const decalerJour = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * JOUR).toISOString().slice(0, 10)

export function plagePeriode(cle, aujourdhui, perso = {}) {
  switch (cle) {
    case 'jour': return { debut: aujourdhui, fin: aujourdhui }
    case 'hier': { const h = decalerJour(aujourdhui, -1); return { debut: h, fin: h } }
    case 'semaine': return { debut: decalerJour(aujourdhui, -6), fin: aujourdhui }
    case 'mois_calendaire': return { debut: `${aujourdhui.slice(0, 8)}01`, fin: aujourdhui }
    case 'mois_dernier': {
      const fin = decalerJour(`${aujourdhui.slice(0, 8)}01`, -1)
      return { debut: `${fin.slice(0, 8)}01`, fin }
    }
    case 'perso': {
      if (!perso?.debut || !perso?.fin) return null
      return perso.debut <= perso.fin ? { debut: perso.debut, fin: perso.fin } : { debut: perso.fin, fin: perso.debut }
    }
    default: return { debut: decalerJour(aujourdhui, -29), fin: aujourdhui }
  }
}

export function periodePrecedente({ debut, fin }) {
  const duree = Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / JOUR) + 1
  return { debut: decalerJour(debut, -duree), fin: decalerJour(debut, -1) }
}

/** Évolution d'un chiffre ; `mieux` dit si le sens du changement est une bonne nouvelle. */
export function evolution(actuel, precedent, plusEstMieux = true) {
  if (actuel == null || precedent == null) return null
  const delta = Math.round((actuel - precedent) * 100) / 100
  if (delta === 0) return { delta, sens: 'egal', mieux: null }
  const monte = delta > 0
  return { delta, sens: monte ? 'hausse' : 'baisse', mieux: monte === plusEstMieux }
}

/** Chiffres clés : ceux de kpisAvis + les litiges nés des avis de la période. */
export function resumeChiffres(avis = [], litiges = []) {
  const ids = new Set(avis.map(a => a.id))
  const lies = (litiges || []).filter(l => ids.has(l.review_id))
  return {
    ...kpisAvis(avis),
    nbLitiges: lies.length,
    montantLitiges: lies.reduce((s, l) => s + (Number(l.montant) || 0), 0),
  }
}

export function caissierDeLAvis(avis, { shifts = [], litigeParReview = {} } = {}) {
  const l = litigeParReview?.[avis.id]
  if (l && (l.responsable_id || (l.responsable_nom && String(l.responsable_nom).trim()))) {
    return { caissier_id: l.responsable_id || null, caissier_nom: String(l.responsable_nom || '').trim(), source: 'litige' }
  }
  if (!avis.commande_le || !avis.restaurant_id) return null
  const t = Date.parse(avis.commande_le)
  if (!Number.isFinite(t)) return null
  const iso = new Date(t).toISOString()
  const r = caissierAuMoment(shifts, { restaurantId: avis.restaurant_id, date: iso.slice(0, 10), heure: iso.slice(11, 16) })
  return r.caissier_id || r.caissier_nom
    ? { caissier_id: r.caissier_id || null, caissier_nom: r.caissier_nom || '', source: 'shift' }
    : null
}

export function classementCaissiers(avis = [], caissierPar = {}) {
  const par = new Map()
  for (const a of avis) {
    const c = caissierPar[a.id]
    const cle = c ? (c.caissier_id ? `id:${c.caissier_id}` : `nom:${String(c.caissier_nom).toLowerCase()}`) : 'aucun'
    const acc = par.get(cle) || { cle, nom: c ? (c.caissier_nom || 'Caissier') : 'Sans caissier', bons: 0, mauvais: 0 }
    if (classifierAvis(a) === 'negatif') acc.mauvais += 1
    else acc.bons += 1
    par.set(cle, acc)
  }
  return [...par.values()]
    .map(x => ({ ...x, nb: x.bons + x.mauvais, pctNegatifs: Math.round((x.mauvais / (x.bons + x.mauvais)) * 1000) / 10 }))
    .sort((a, b) => (a.cle === 'aucun') - (b.cle === 'aucun') || b.mauvais - a.mauvais || b.pctNegatifs - a.pctNegatifs || a.nom.localeCompare(b.nom))
}

const liste = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x).trim()).filter(Boolean)

/** Plaintes les plus fréquentes parmi les avis négatifs. */
export function topMotifs(avis = [], n = 6) {
  const compte = new Map()
  for (const a of avis) {
    if (classifierAvis(a) !== 'negatif') continue
    const raw = a.raw?.raw || {}
    const motifs = [...liste(raw.theme), ...liste(raw.tag)]
    const finaux = motifs.length ? motifs : (a.comment && String(a.comment).trim() ? ['Commentaire sans motif'] : [])
    for (const m of new Set(finaux)) compte.set(m, (compte.get(m) || 0) + 1)
  }
  return [...compte.entries()]
    .map(([motif, nb]) => ({ motif, nb }))
    .sort((a, b) => b.nb - a.nb || a.motif.localeCompare(b.motif))
    .slice(0, n)
}

/** Bons avis plateforme attribués, au format des « incidents » de la note. */
export function bonsAvisAttribues(avis = [], shifts = []) {
  const out = []
  for (const a of avis) {
    if (classifierAvis(a) === 'negatif') continue
    const c = caissierDeLAvis(a, { shifts })
    if (!c) continue
    out.push({
      responsable_id: c.caissier_id, responsable_nom: c.caissier_nom,
      date: new Date(a.commande_le).toISOString().slice(0, 10), bon: true, nature: 'bon avis',
    })
  }
  return out
}

