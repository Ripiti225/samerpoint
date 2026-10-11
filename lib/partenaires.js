// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — partenaires à recevoir (Yango, Glovo, Wave, OM, Djamo).
// Logique pure : périodes, estimés depuis les points, situation d'une période.
//
// Règles (validées avec M. Zreik, 01/10/2026) :
//  - Périodes : Yango ven→jeu · Glovo 1–7, 8–14, 15–21, 22–28, 29→fin ·
//    Wave et Djamo lun→dim · OM le mois.
//  - Estimé = points de la période × coefficient (tab pour Yango / Glovo).
//    L'export importé le remplace (il ne s'additionne jamais).
//  - Pub (Yango / Glovo, après import) déduite, par restaurant.
//  - Seules les périodes TERMINÉES comptent dans « à recevoir ».
//  - Seul Glovo verse restaurant par restaurant ; Yango, Wave, OM et Djamo
//    versent en une fois (corrigé le 01/10/2026). Chaque partenaire a ses réceptions.
//
// Tests : lib/partenaires.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { COEFFICIENTS } from './constants.js'

export const PARTENAIRES = ['yango', 'glovo', 'wave', 'om', 'djamo']

export const INFOS_PARTENAIRE = {
  yango: { nom: 'Yango', icone: '🛵', champ: 'yango_tab', coeff: COEFFICIENTS.YANGO, importable: true, rythme: 'Vendredi → jeudi' },
  glovo: { nom: 'Glovo', icone: '🟡', champ: 'glovo_tab', coeff: COEFFICIENTS.GLOVO, importable: true, rythme: '1–7, 8–14, 15–21, 22–28, 29 → fin' },
  wave: { nom: 'Wave', icone: '🔵', champ: 'wave', coeff: COEFFICIENTS.WAVE, importable: false, rythme: 'Lundi → dimanche' },
  om: { nom: 'Orange Money', icone: '🟠', champ: 'om', coeff: COEFFICIENTS.OM, importable: false, rythme: 'Le mois' },
  djamo: { nom: 'Djamo', icone: '🟣', champ: 'djamo', coeff: COEFFICIENTS.DJAMO, importable: false, rythme: 'Lundi → dimanche' },
}

// Mode de versement par défaut :
//  - 'restaurant' : un virement par restaurant (Glovo) ;
//  - 'groupe' : un virement unique pour tous (Yango) ;
//  - 'tete_de_fond' : l'argent de chaque restaurant arrive sur la tête de fond
//    du partenaire (OM, Wave, Djamo) ; on note le reçu de chaque restaurant
//    (il peut dépasser l'attendu) et leur total entre sur ce compte, d'où un
//    virement l'envoie ensuite vers la banque. Calculé comme 'restaurant'.
export const MODE_PAR_DEFAUT = { yango: 'groupe', glovo: 'restaurant', wave: 'tete_de_fond', om: 'tete_de_fond', djamo: 'tete_de_fond' }

// Compte « tête de fond » de chaque partenaire (tresorerie_comptes.nom).
export const COMPTE_TETE_DE_FOND = { om: 'Tête de fond OM', wave: 'Tête de fond Wave', djamo: 'Tête de fond Djamo' }

const n = v => Number(v) || 0

// ── Dates ISO (AAAA-MM-JJ), calculs en UTC pour éviter les fuseaux ──────────

function versDate(iso) {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))
}

function versIso(d) {
  return d.toISOString().slice(0, 10)
}

export function ajouterJours(iso, k) {
  const d = versDate(iso)
  d.setUTCDate(d.getUTCDate() + k)
  return versIso(d)
}

function dernierJourDuMois(iso) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0))
  return versIso(d)
}

// Période qui contient `iso`, pour un partenaire : { debut, fin } (bornes incluses).
export function periodeDe(partenaire, iso) {
  if (partenaire === 'yango' || partenaire === 'wave' || partenaire === 'djamo') {
    const premierJour = partenaire === 'yango' ? 5 : 1 // vendredi / lundi
    const dow = versDate(iso).getUTCDay()
    const debut = ajouterJours(iso, -((dow - premierJour + 7) % 7))
    return { debut, fin: ajouterJours(debut, 6) }
  }
  if (partenaire === 'glovo') {
    const jour = Number(iso.slice(8, 10))
    const mois = iso.slice(0, 8)
    const bornes = [[1, 7], [8, 14], [15, 21], [22, 28]]
    for (const [a, b] of bornes) {
      if (jour <= b) return { debut: `${mois}${String(a).padStart(2, '0')}`, fin: `${mois}${String(b).padStart(2, '0')}` }
    }
    return { debut: `${mois}29`, fin: dernierJourDuMois(iso) }
  }
  if (partenaire === 'om') {
    return { debut: `${iso.slice(0, 8)}01`, fin: dernierJourDuMois(iso) }
  }
  throw new Error(`Partenaire inconnu : ${partenaire}`)
}

// Périodes suivies : celles qui commencent le jour de départ ou après, jusqu'à
// celle qui contient aujourd'hui. Plus récente d'abord.
export function periodesSuivies(partenaire, dateDepart, aujourdhui) {
  if (!dateDepart || dateDepart > aujourdhui) return []
  const out = []
  let p = periodeDe(partenaire, dateDepart)
  if (p.debut < dateDepart) p = periodeDe(partenaire, ajouterJours(p.fin, 1))
  while (p.debut <= aujourdhui && out.length < 2000) {
    out.push(p)
    p = periodeDe(partenaire, ajouterJours(p.fin, 1))
  }
  return out.reverse()
}

export function periodeTerminee(periode, aujourdhui) {
  return periode.fin < aujourdhui
}

export function libellePeriode(periode) {
  const f = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  return `${f(periode.debut)} → ${f(periode.fin)}`
}

// ── Estimé depuis les points ────────────────────────────────────────────────

// { [restaurant_id]: montant estimé } pour une période.
export function estimerPeriode(points, partenaire, periode) {
  const { champ, coeff } = INFOS_PARTENAIRE[partenaire]
  const brut = {}
  for (const p of points || []) {
    if (!p.date || p.date < periode.debut || p.date > periode.fin) continue
    const v = n(p[champ])
    if (!v) continue
    brut[p.restaurant_id] = (brut[p.restaurant_id] || 0) + v
  }
  const out = {}
  for (const [r, v] of Object.entries(brut)) out[r] = Math.round(v * coeff)
  return out
}

// ── Situation d'une période ─────────────────────────────────────────────────
// lignes : tresorerie_partenaire_lignes de CE partenaire et CETTE période
//   type 'reel' (montant de l'export, par resto), 'pub' (par resto),
//   'recu' (par resto, ou restaurant_id null pour un versement groupé).
//
// Un restaurant peut être payé en PLUSIEURS virements (KMS : deux magasins
// Glovo, l'un payé sur la BACI, l'autre sur la SIB) : toutes ses réceptions
// s'additionnent. Pas de détection automatique d'un virement manquant : Glovo
// paie toujours un peu à côté de l'export (−4 % à −16 % constatés en sept. 2026),
// un manque de KMS ne se distingue pas d'un écart normal. Une réception clôt
// donc le restaurant ; l'écran permet d'en ajouter une autre (« + Virement »).

export function situationPeriode({ periode, estimes = {}, lignes = [], mode = 'restaurant', aujourdhui }) {
  const reels = lignes.filter(l => l.type === 'reel')
  const exportImporte = reels.length > 0
  const restos = new Set([...Object.keys(estimes), ...reels.map(l => l.restaurant_id)])
  lignes.filter(l => l.type !== 'reel' && l.restaurant_id).forEach(l => restos.add(l.restaurant_id))

  const somme = (type, r) => lignes.filter(l => l.type === type && l.restaurant_id === r).reduce((s, l) => s + n(l.montant), 0)

  const parResto = [...restos].map(r => {
    const estime = n(estimes[r])
    const reel = exportImporte ? somme('reel', r) : null
    const pub = somme('pub', r)
    const attendu = reel !== null ? reel - pub : estime
    const recus = lignes.filter(l => l.type === 'recu' && l.restaurant_id === r)
    const recu = recus.reduce((s, l) => s + n(l.montant), 0)
    return {
      restaurant_id: r, estime, reel, pub, attendu,
      recu, nbRecus: recus.length, reste: Math.max(0, attendu - recu),
      recuFait: recus.length > 0, ecart: recus.length ? recu - attendu : 0,
    }
  })

  const attendu = parResto.reduce((s, x) => s + x.attendu, 0)
  const recusGroupe = lignes.filter(l => l.type === 'recu' && !l.restaurant_id)
  const recuGroupe = recusGroupe.reduce((s, l) => s + n(l.montant), 0)
  const terminee = periodeTerminee(periode, aujourdhui)

  let aRecevoir = 0
  let recuFait
  if (mode === 'groupe') {
    recuFait = recusGroupe.length > 0
    aRecevoir = terminee && !recuFait ? attendu : 0
  } else {
    recuFait = parResto.length > 0 && parResto.every(x => x.recuFait || x.attendu === 0)
    aRecevoir = terminee ? parResto.filter(x => !x.recuFait).reduce((s, x) => s + Math.max(0, x.attendu), 0) : 0
  }

  return {
    periode, terminee, exportImporte, parResto, attendu, aRecevoir, recuFait,
    recuGroupe, ecartGroupe: mode === 'groupe' && recusGroupe.length ? recuGroupe - attendu : 0,
  }
}

// Total « à recevoir » de tous les partenaires.
// reglages : { [partenaire]: { date_depart, mode_versement } }
export function totalPartenaires({ reglages = {}, points = [], lignes = [], aujourdhui }) {
  let total = 0
  const parPartenaire = {}
  for (const p of PARTENAIRES) {
    const reg = reglages[p] || {}
    const periodes = periodesSuivies(p, reg.date_depart, aujourdhui)
    let sous = 0
    for (const per of periodes) {
      if (!periodeTerminee(per, aujourdhui)) continue
      const s = situationPeriode({
        periode: per,
        estimes: estimerPeriode(points, p, per),
        lignes: lignes.filter(l => l.partenaire === p && l.periode_debut === per.debut),
        mode: reg.mode_versement || MODE_PAR_DEFAUT[p],
        aujourdhui,
      })
      sous += s.aRecevoir
    }
    parPartenaire[p] = sous
    total += sous
  }
  return { total, parPartenaire }
}

// Toutes les périodes suivies de chaque partenaire, avec leur situation.
// donnees : { reglages, points, lignes } (chargerPartenaires).
// → { [partenaire]: { reg, mode, situations (plus récente d'abord), total à recevoir } }
export function vuesPartenaires({ reglages = {}, points = [], lignes = [] }, aujourdhui) {
  const out = {}
  for (const p of PARTENAIRES) {
    const reg = reglages[p] || {}
    const mode = reg.mode_versement || MODE_PAR_DEFAUT[p]
    const situations = periodesSuivies(p, reg.date_depart, aujourdhui).map(per => situationPeriode({
      periode: per,
      estimes: estimerPeriode(points, p, per),
      lignes: lignes.filter(l => l.partenaire === p && l.periode_debut === per.debut),
      mode,
      aujourdhui,
    }))
    out[p] = { reg, mode, situations, total: situations.reduce((s, x) => s + x.aRecevoir, 0) }
  }
  return out
}

// ── Historique : périodes entièrement reçues ────────────────────────────────

// Ce qui est arrivé sur une période (réceptions par restaurant + virement unique).
export function recuPeriode(s) {
  return n(s.recuGroupe) + s.parResto.reduce((t, r) => t + n(r.recu), 0)
}

// Terminée, plus rien à recevoir, et de l'argent arrivé : la période quitte
// « Partenaires à recevoir » pour l'Historique. Une période terminée sans
// vente ni réception n'apparaît nulle part.
export function periodeSoldee(s) {
  return s.terminee && s.aRecevoir === 0 && recuPeriode(s) > 0
}

// Périodes soldées de tous les partenaires, la plus récente d'abord.
// filtre.partenaire : un seul partenaire (null = tous) ;
// filtre.periode : { an, mois|null } sur le début de la période.
// → [{ partenaire, situation, recu, ecart, recuLe, comptes: [compte_id] }]
export function historiquePartenaires(vues, lignes = [], { partenaire = null, periode = null } = {}) {
  const out = []
  for (const p of PARTENAIRES) {
    if (partenaire && p !== partenaire) continue
    for (const s of vues[p]?.situations || []) {
      if (!periodeSoldee(s)) continue
      const d = s.periode.debut
      if (periode && (Number(d.slice(0, 4)) !== periode.an || (periode.mois && Number(d.slice(5, 7)) !== periode.mois))) continue
      const recus = lignes.filter(l => l.partenaire === p && l.periode_debut === d && l.type === 'recu')
      const recu = recuPeriode(s)
      out.push({
        partenaire: p, situation: s, recu, ecart: recu - s.attendu,
        recuLe: recus.map(l => l.date).filter(Boolean).sort().pop() || null,
        comptes: [...new Set(recus.map(l => l.compte_id).filter(Boolean))],
      })
    }
  }
  return out.sort((a, b) => b.situation.periode.debut.localeCompare(a.situation.periode.debut) || a.partenaire.localeCompare(b.partenaire))
}
