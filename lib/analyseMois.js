// ──────────────────────────────────────────────────────────────────────────────
// Analyse d'un mois (onglet Analyse de l'écran Rapports) : toutes les sources
// réunies, restaurant par restaurant, et les faits marquants écrits en clair.
//
// Sources : points (ventes, dépenses, bénéfice SC), résultat net de la
// Trésorerie, objectif mensuel, POS (ticket moyen, heure de pointe, canaux,
// plats), litiges, note des caissiers. Chaque source peut manquer (migration non
// passée, POS injoignable) : la ligne affiche alors « — », jamais un faux zéro.
//
// Pur : testé par lib/analyseMois.test.mjs. Chargement : lib/analyseMoisDb.js.
// ──────────────────────────────────────────────────────────────────────────────
import { venteRetenue, venteTheorique } from './venteMachine.js'
import { beneficeSC } from './beneficeCorrige.js'

const n = v => Number(v) || 0
const somme = (liste, champ) => (liste || []).reduce((s, x) => s + n(x[champ]), 0)

/** Variation en % (null sans base de comparaison). */
export function variationPct(actuel, precedent) {
  const a = n(actuel), p = n(precedent)
  if (!p) return null
  return Math.round(((a - p) / Math.abs(p)) * 100)
}

export function joursDuMois(mois) {
  const [a, m] = mois.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

export function moisPrecedentDe(mois) {
  const [a, m] = mois.split('-').map(Number)
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

/**
 * Une ligne par restaurant.
 * donnees = { restaurants, points, pointsPrec, resultats: { [id]: { [mois]: { net } } }, mois, moisPrec,
 *             litiges: [{ restaurant, total }], pos: stats_dashboard ou null,
 *             notes: calculerNotes(), jourCourant (mois en cours, sinon null) }
 */
export function lignesRestaurants(d) {
  const nbJours = joursDuMois(d.mois)
  return (d.restaurants || []).map(r => {
    const pts = (d.points || []).filter(p => p.restaurant_id === r.id)
    const prec = (d.pointsPrec || []).filter(p => p.restaurant_id === r.id)
    // CA = vente machine ; la théorique n'est que le comparatif (lib/venteMachine.js).
    const ca = pts.reduce((s, p) => s + venteRetenue(p), 0)
    const caTheo = pts.reduce((s, p) => s + venteTheorique(p), 0)
    const caPrec = prec.reduce((s, p) => s + venteRetenue(p), 0)
    const benefice = pts.reduce((s, p) => s + beneficeSC(p), 0) // écarts annulés compris
    const resultat = d.resultats?.[r.id]?.[d.mois] || null
    const resultatPrec = d.resultats?.[r.id]?.[d.moisPrec] || null
    const litige = (d.litiges || []).find(l => l.restaurant?.id === r.id)
    const posR = (d.pos?.par_resto || []).find(x => x.id === r.id)
    const notesR = (d.notes || []).filter(x => x.restaurantId === r.id && x.note !== null)
    const objectif = n(r.objectif_mensuel) || null
    // Mois en cours : l'objectif se juge au rythme actuel (projection), pas au cumul.
    const projection = d.jourCourant ? Math.round((ca / Math.max(1, d.jourCourant)) * nbJours) : ca
    return {
      id: r.id, nom: String(r.nom || '').trim(), couleur: r.couleur,
      nbJours: pts.length,
      ca, caTheo, caPrec, varCa: variationPct(ca, caPrec),
      depenses: somme(pts, 'depense_total'),
      benefice, marge: ca ? Math.round((benefice / ca) * 1000) / 10 : null,
      net: resultat ? n(resultat.net) : null,
      netPrec: resultatPrec ? n(resultatPrec.net) : null,
      objectif, pctObjectif: objectif ? Math.round((projection / objectif) * 100) : null, projection,
      litiges: litige ? n(litige.total) : null,
      commandes: posR ? n(posR.nb) : null,
      ticket: posR?.nb ? Math.round(n(posR.ca) / n(posR.nb)) : null,
      pic: posR?.pic ?? null,
      noteCaissiers: notesR.length ? Math.round((notesR.reduce((s, x) => s + x.note, 0) / notesR.length) * 10) / 10 : null,
      nbCaissiers: notesR.length,
    }
  }).filter(l => l.nbJours > 0 || l.ca > 0 || l.net !== null)
    .sort((a, b) => b.ca - a.ca)
}

export function totauxMois(lignes) {
  const avecNet = lignes.filter(l => l.net !== null)
  const avecObjectif = lignes.filter(l => l.objectif)
  const objectif = avecObjectif.reduce((s, l) => s + l.objectif, 0)
  return {
    ca: somme(lignes, 'ca'), caTheo: somme(lignes, 'caTheo'), caPrec: somme(lignes, 'caPrec'),
    varCa: variationPct(somme(lignes, 'ca'), somme(lignes, 'caPrec')),
    benefice: somme(lignes, 'benefice'), depenses: somme(lignes, 'depenses'),
    net: avecNet.length ? somme(avecNet, 'net') : null,
    netPrec: avecNet.some(l => l.netPrec !== null) ? somme(avecNet, 'netPrec') : null,
    objectif: objectif || null,
    pctObjectif: objectif ? Math.round((avecObjectif.reduce((s, l) => s + l.projection, 0) / objectif) * 100) : null,
    litiges: lignes.some(l => l.litiges !== null) ? somme(lignes, 'litiges') : null,
  }
}

/**
 * Résultat net du GROUPE, identique à Trésorerie → Résultat net : la somme des
 * restaurants moins les arriérés du groupe payés par la direction (CNPS,
 * anciens travailleurs sans restaurant), qui ne sont dans aucun restaurant.
 */
export function avecArrieresGroupe(totaux, arrieres = 0, arrieresPrec = 0) {
  const a = Number(arrieres) || 0
  const ap = Number(arrieresPrec) || 0
  return {
    ...totaux,
    arrieresGroupe: a,
    netGroupe: totaux.net == null ? null : totaux.net - a,
    netGroupePrec: totaux.netPrec == null ? null : totaux.netPrec - ap,
  }
}

/** Ventes cumulées jour par jour (1 → 31) : pour comparer deux mois sur la même courbe. */
export function serieParJourDuMois(points, mois) {
  const nb = joursDuMois(mois)
  const parJour = Array(nb).fill(0)
  for (const p of points || []) {
    if (String(p.date).slice(0, 7) !== mois) continue
    const j = Number(String(p.date).slice(8, 10)) - 1
    if (j >= 0 && j < nb) parJour[j] += venteRetenue(p)
  }
  return parJour
}

/** « Aucun restaurant sur 8 n'a atteint son objectif », « 3 restaurants sur 8 ont atteint leur objectif »… */
export function phraseObjectifs(nb, total, enCours = false) {
  if (enCours) {
    if (!nb) return `Aucun restaurant sur ${total} n’est en route pour atteindre son objectif.`
    return nb === 1 ? `1 restaurant sur ${total} est en route pour atteindre son objectif.`
      : `${nb} restaurants sur ${total} sont en route pour atteindre leur objectif.`
  }
  if (!nb) return `Aucun restaurant sur ${total} n’a atteint son objectif.`
  return nb === 1 ? `1 restaurant sur ${total} a atteint son objectif.` : `${nb} restaurants sur ${total} ont atteint leur objectif.`
}

const fmtF = v => `${Math.round(n(v)).toLocaleString('fr-FR')} F`
const pct = v => `${v > 0 ? '+' : ''}${v} %`

/**
 * Faits marquants, du plus important au moins important. Chaque fait :
 * { ton: 'bon' | 'alerte' | 'info', icone, texte }.
 */
export function faitsDuMois({ lignes = [], totaux, pos, posPrec, litiges, notes = [], enCours = false }) {
  const faits = []
  if (totaux?.varCa !== null && totaux?.varCa !== undefined) {
    faits.push({
      ton: totaux.varCa >= 0 ? 'bon' : 'alerte', icone: totaux.varCa >= 0 ? 'trending-up' : 'trending-down',
      texte: `Ventes du groupe ${pct(totaux.varCa)} par rapport au mois précédent${enCours ? ' (à date égale)' : ''}.`,
    })
  }
  const avecVar = lignes.filter(l => l.varCa !== null && l.caPrec > 0)
  if (avecVar.length > 1) {
    const meilleur = [...avecVar].sort((a, b) => b.varCa - a.varCa)[0]
    const pire = [...avecVar].sort((a, b) => a.varCa - b.varCa)[0]
    if (meilleur.varCa > 0) faits.push({ ton: 'bon', icone: 'rocket-launch-outline', texte: `${meilleur.nom} progresse le plus : ${pct(meilleur.varCa)}.` })
    if (pire.varCa < 0) faits.push({ ton: 'alerte', icone: 'arrow-down-bold-circle-outline', texte: `${pire.nom} recule le plus : ${pct(pire.varCa)}.` })
  }
  const pertes = lignes.filter(l => l.net !== null && l.net < 0)
  if (pertes.length) {
    faits.push({ ton: 'alerte', icone: 'alert-octagon-outline',
      texte: `${pertes.length === 1 ? `${pertes[0].nom} est` : `${pertes.map(l => l.nom).join(', ')} sont`} en perte après charges (${pertes.map(l => fmtF(l.net)).join(', ')}).` })
  }
  const objectifs = lignes.filter(l => l.pctObjectif !== null)
  if (objectifs.length) {
    const atteints = objectifs.filter(l => l.pctObjectif >= 100)
    faits.push({ ton: atteints.length === objectifs.length ? 'bon' : 'info', icone: 'target',
      texte: phraseObjectifs(atteints.length, objectifs.length, enCours) })
  }
  const parTicket = lignes.filter(l => l.ticket)
  if (parTicket.length > 1) {
    const top = [...parTicket].sort((a, b) => b.ticket - a.ticket)[0]
    faits.push({ ton: 'info', icone: 'receipt-text-outline', texte: `Meilleur ticket moyen : ${top.nom} (${fmtF(top.ticket)}).` })
  }
  const picGroupe = (pos?.par_heure || []).reduce((m, x) => (n(x.nb) > n(m?.nb) ? x : m), null)
  if (picGroupe) faits.push({ ton: 'info', icone: 'fire', texte: `Heure de pointe du groupe : ${picGroupe.h} h – ${(n(picGroupe.h) + 1) % 24} h.` })
  const plat = (pos?.top || [])[0]
  if (plat) {
    const avant = (posPrec?.top || []).find(x => x.nom === plat.nom)
    const v = avant ? variationPct(plat.qte, avant.qte) : null
    faits.push({ ton: 'info', icone: 'silverware-fork-knife',
      texte: `Plat le plus vendu : ${plat.nom} (${n(plat.qte).toLocaleString('fr-FR')}${v !== null ? `, ${pct(v)}` : ''}).` })
  }
  if (litiges?.total) {
    const principal = (litiges.categories || [])[0]
    faits.push({ ton: 'alerte', icone: 'scale-balance',
      texte: `${fmtF(litiges.total)} de litiges${principal ? `, surtout ${principal.nom.toLowerCase()}` : ''}.` })
  }
  const notees = notes.filter(x => x.note !== null)
  const aAccompagner = notees.filter(x => x.note < 10)
  if (aAccompagner.length) {
    faits.push({ ton: 'alerte', icone: 'account-alert-outline',
      texte: `${aAccompagner.length} caissier${aAccompagner.length > 1 ? 's' : ''} à accompagner (note sous 10/20) : ${aAccompagner.map(x => x.nom.trim()).join(', ')}.` })
  } else if (notees.length) {
    faits.push({ ton: 'bon', icone: 'account-star', texte: `Aucun caissier sous 10/20 ; meilleure note : ${notees[0].nom.trim()} (${String(notees[0].note).replace('.', ',')}/20).` })
  }
  return faits
}
