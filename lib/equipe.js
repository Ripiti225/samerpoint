// ──────────────────────────────────────────────────────────────────────────────
// Équipe globale (ex-écran « Ressources Humaines ») : logique pure.
// Périodes, déduplication des présences, statistiques par travailleur et par
// restaurant, recherche, lignes de l'export Excel.
// `restoId === null` partout = vue « Tous les restaurants ».
// Chargement en base : lib/equipeDb.js — Tests : lib/equipe.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const BLEU = '#185FA5'

export const PERIODES = [
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: '📅 Période', key: 'custom' },
]

export const ONGLETS = ['Dashboard', 'Travailleurs', 'Présences', 'Salaires', 'Archivés']
export const MOTIFS_ARCHIVE = ['Démission', 'Renvoi', 'Fin de contrat', 'Autre']

// Couleur de chaque statut de présence (texte et pastille ; le fond est une
// teinte de la couleur pour rester lisible en mode clair comme en sombre).
export const STATUTS = {
  'Présent': '#3B8D2F',
  'Absent': '#C2462B',
  'Repos': '#2F7FD8',
  'Congé': '#6C63E0',
  'Malade': '#C27C1A',
  'Permission': '#7A7A72',
}

// La tuile « Ressources Humaines » (id `rh`) a été fusionnée dans « Équipe
// globale » (id `equipe`). Les accès enregistrés en base peuvent encore
// contenir `rh` : on les convertit pour que personne ne perde l'écran.
const TUILES_FUSIONNEES = { rh: 'equipe' }

export function migrerIdsTuiles(ids) {
  const vus = new Set()
  const out = []
  for (const id of ids || []) {
    const cible = TUILES_FUSIONNEES[id] || id
    if (!vus.has(cible)) { vus.add(cible); out.push(cible) }
  }
  return out
}

const iso = d => d.toISOString().split('T')[0]

/** { debut, fin } au format AAAA-MM-JJ, ou null si la période perso est incomplète. */
export function plageDates(periodeKey, perso = {}, aujourdhui = new Date()) {
  const t = aujourdhui
  if (periodeKey === '7days') {
    const d = new Date(t); d.setDate(d.getDate() - 6)
    return { debut: iso(d), fin: iso(t) }
  }
  if (periodeKey === 'month') {
    return { debut: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), fin: iso(t) }
  }
  if (periodeKey === 'lastmonth') {
    return {
      debut: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))),
      fin: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))),
    }
  }
  if (periodeKey === 'custom' && perso.debut && perso.fin) return { debut: perso.debut, fin: perso.fin }
  return null
}

const MOIS_COURTS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']

export function formatDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${parseInt(d)} ${MOIS_COURTS[parseInt(m) - 1]} ${y}`
}

export function titrePeriode(periodeKey, perso = {}) {
  if (periodeKey === '7days') return '7 derniers jours'
  if (periodeKey === 'month') return 'Ce mois'
  if (periodeKey === 'lastmonth') return 'Mois précédent'
  if (periodeKey === 'custom' && perso.debut && perso.fin) return `${formatDate(perso.debut)} → ${formatDate(perso.fin)}`
  return 'Période personnalisée'
}

export function initiales(nom) {
  return String(nom || '?').trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export function fmt(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`
}

/** Vert ≥ 80 %, orange ≥ 50 %, rouge en dessous. */
export function couleurTaux(taux) {
  return taux >= 80 ? '#3B8D2F' : taux >= 50 ? '#D98A0B' : '#C2462B'
}

const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Vrai si `recherche` (accents et casse ignorés) apparaît dans l'un des champs. */
export function correspondRecherche(recherche, ...champs) {
  const q = sansAccents(recherche).trim()
  if (!q) return true
  return champs.some(c => sansAccents(c).includes(q))
}

// Un travailleur pointé sur plusieurs shifts le même jour compte pour UN jour :
// présent sur n'importe quel shift = présent ; les paies s'additionnent.
export function dedupPresences(pres) {
  const map = {}
  for (const p of pres || []) {
    const key = `${p.travailleur_id}|${p.point_id}`
    if (!map[key]) {
      map[key] = { ...p, paye: parseFloat(p.paye) || 0 }
    } else {
      if (p.statut === 'Présent') map[key].statut = 'Présent'
      map[key].paye += parseFloat(p.paye) || 0
    }
  }
  return Object.values(map)
}

const CLES_STATUT = {
  'Présent': 'present', 'Absent': 'absent', 'Repos': 'repos',
  'Congé': 'conge', 'Malade': 'malade', 'Permission': 'permission',
}

function compteurVide() {
  return { present: 0, absent: 0, repos: 0, conge: 0, malade: 0, permission: 0, totalPaye: 0, jours: 0 }
}

function compter(c, p) {
  c.jours++
  const cle = CLES_STATUT[p.statut]
  if (cle) c[cle]++
  if (p.statut === 'Présent') c.totalPaye += p.paye || 0
}

const taux = c => (c.jours > 0 ? (c.present / c.jours) * 100 : 0)

/** Statistiques d'un travailleur sur ses présences (déjà filtrées). */
export function statsTravailleur(presences) {
  const c = compteurVide()
  dedupPresences(presences).forEach(p => compter(c, p))
  return { ...c, total: c.jours, taux: taux(c) }
}

/**
 * Une ligne par travailleur ayant au moins un jour sur la période.
 * Un travailleur absent de `travailleurs` (archivé, transféré) garde ses jours
 * sous le nom saisi dans la présence.
 */
export function statsParTravailleur(travailleurs, presences) {
  const stats = {}
  for (const t of travailleurs || []) {
    stats[t.id] = { id: t.id, nom: t.nom, poste: t.poste, restaurant_id: t.restaurant_id, ...compteurVide() }
  }
  for (const p of dedupPresences(presences)) {
    if (!stats[p.travailleur_id]) {
      stats[p.travailleur_id] = {
        id: p.travailleur_id, nom: p.travailleur_nom || 'Travailleur', poste: '',
        restaurant_id: p.restaurant_id || null, ...compteurVide(),
      }
    }
    compter(stats[p.travailleur_id], p)
  }
  return Object.values(stats).filter(s => s.jours > 0).map(s => ({ ...s, taux: taux(s) }))
}

export function totalPaiesGerant(paies) {
  return (paies || []).reduce((sum, d) => sum + (parseFloat(d.montant) || 0), 0)
}

export function statsGlobales(travailleurs, presences, paiesGerant) {
  const s = statsParTravailleur(travailleurs, presences)
  const totalPayePresences = s.reduce((sum, t) => sum + t.totalPaye, 0)
  const totalPayeGerant = totalPaiesGerant(paiesGerant)
  const dedup = dedupPresences(presences)
  const parStatut = compteurVide()
  dedup.forEach(p => compter(parStatut, p))
  return {
    totalPresences: parStatut.present,
    totalAbsences: parStatut.absent,
    totalAutres: parStatut.repos + parStatut.conge + parStatut.malade + parStatut.permission,
    parStatut,
    totalPaye: totalPayePresences + totalPayeGerant,
    totalPayePresences,
    totalPayeGerant,
    nbJours: new Set((presences || []).map(p => p.date)).size,
    nbTravailleurs: (travailleurs || []).length,
    taux: taux(parStatut),
  }
}

/** Taux de présence par restaurant (vue « Tous »), du meilleur au moins bon. */
export function tauxParRestaurant(restaurants, presences) {
  const parResto = {}
  for (const p of dedupPresences(presences)) {
    if (!p.restaurant_id) continue
    if (!parResto[p.restaurant_id]) parResto[p.restaurant_id] = compteurVide()
    compter(parResto[p.restaurant_id], p)
  }
  return (restaurants || [])
    .filter(r => parResto[r.id])
    .map(r => ({ id: r.id, nom: r.nom, present: parResto[r.id].present, jours: parResto[r.id].jours, taux: taux(parResto[r.id]) }))
    .sort((a, b) => b.taux - a.taux)
}

/**
 * Paies versées par le gérant de caisse, regroupées par bénéficiaire
 * (et par restaurant en vue « Tous », deux homonymes ne se confondant pas).
 */
export function lignesPaiesGerant(paies, nomResto = () => '') {
  const g = {}
  for (const d of paies || []) {
    const nom = d.libelle || 'Paie gérant'
    const key = `${nom}|${d.restaurant_id || ''}`
    if (!g[key]) g[key] = { nom, restaurant: nomResto(d.restaurant_id), montant: 0 }
    g[key].montant += parseFloat(d.montant) || 0
  }
  return Object.values(g).sort((a, b) => b.montant - a.montant)
}

/**
 * Feuilles de l'export Excel (tableaux de lignes). En vue « Tous », chaque
 * feuille gagne une colonne « Restaurant ».
 */
export function feuillesExcel({ travailleurs, presences, paiesGerant, tous, nomResto = () => '' }) {
  const statsT = statsParTravailleur(travailleurs, presences)
  const g = statsGlobales(travailleurs, presences, paiesGerant)
  const R = tous ? ['Restaurant'] : []
  const r = id => (tous ? [nomResto(id)] : [])
  const vide = tous ? [''] : []

  const resume = [
    ['Nom', ...R, 'Poste', 'Jours présent', 'Jours absent', 'Repos', 'Congé', 'Malade', 'Permission', 'Total payé (FCFA)'],
    ...statsT.map(t => [t.nom, ...r(t.restaurant_id), t.poste || '', t.present, t.absent, t.repos, t.conge, t.malade, t.permission, t.totalPaye]),
    [],
    ['TOTAL', ...vide, '', g.totalPresences, g.totalAbsences, '', '', '', '', g.totalPayePresences],
  ]

  const detail = [
    ['Date', ...R, 'Travailleur', 'Statut', 'Shift', 'Heure début', 'Heure fin', 'Paie (FCFA)'],
    ...[...(presences || [])]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(p => [p.date, ...r(p.restaurant_id), p.travailleur_nom, p.statut, p.shift_nom || '', p.heure_debut || '', p.heure_fin || '', parseFloat(p.paye) || 0]),
  ]

  const salaires = [
    ['Nom', ...R, 'Poste', 'Jours travaillés', 'Total salaire (FCFA)', '% masse salariale'],
    ...[...statsT].sort((a, b) => b.totalPaye - a.totalPaye).map(t => [
      t.nom, ...r(t.restaurant_id), t.poste || '', t.present, t.totalPaye,
      g.totalPayePresences > 0 ? `${((t.totalPaye / g.totalPayePresences) * 100).toFixed(1)}%` : '0%',
    ]),
    [],
    ['TOTAL', ...vide, '', g.totalPresences, g.totalPayePresences, '100%'],
  ]

  return { resume, detail, salaires }
}

/**
 * Frise des derniers jours d'un travailleur (petit graphique de la fiche) :
 * une case par jour, du plus ancien au plus récent, statut ou null.
 */
export function friseJours(presences, fin, nbJours = 30) {
  const parDate = {}
  for (const p of dedupPresences(presences)) parDate[p.date] = p.statut
  const out = []
  const [y, m, d] = fin.split('-').map(Number)
  for (let i = nbJours - 1; i >= 0; i--) {
    const date = iso(new Date(Date.UTC(y, m - 1, d - i)))
    out.push({ date, statut: parDate[date] || null })
  }
  return out
}
