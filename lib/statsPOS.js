// ──────────────────────────────────────────────────────────────────────────────
// Statistiques du POS pour le Dashboard global : heures de pointe, jours forts,
// canaux, modes de paiement, plats les plus vendus.
//
// Les chiffres bruts viennent de la fonction `stats_dashboard` du cloud POS
// (pos_cloud_stats_dashboard.sql) ; ce module ne fait que les mettre en forme.
// Il reste pur (aucun import React ni Supabase) : testé par lib/statsPOS.test.mjs.
// Chargement : lib/statsPOSDb.js.
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0

// La journée commence à 6 h : la soirée et la nuit (jusqu'à 2 h) se lisent
// d'un seul tenant, comme le service qui les encaisse.
export const HEURE_DEBUT_SERVICE = 6
export const ORDRE_HEURES = Array.from({ length: 24 }, (_, i) => (i + HEURE_DEBUT_SERVICE) % 24)

export const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

export const libelleHeure = h => `${h}h`
export const libelleCreneau = h => `${h}h – ${(h + 1) % 24}h`

/** Les 24 heures dans l'ordre du service (6 h → 5 h), heures vides à 0. */
export function heuresDuService(parHeure = []) {
  const parH = new Map((parHeure || []).map(x => [n(x.h), x]))
  return ORDRE_HEURES.map(h => ({ h, nb: n(parH.get(h)?.nb), ca: n(parH.get(h)?.ca) }))
}

/** L'heure qui fait le plus de commandes (null si aucune). */
export function heurePic(parHeure = []) {
  let pic = null
  for (const x of parHeure || []) if (n(x.nb) > 0 && (!pic || n(x.nb) > n(pic.nb))) pic = x
  return pic ? { h: n(pic.h), nb: n(pic.nb), ca: n(pic.ca) } : null
}

/** Les créneaux d'une heure les plus chargés, du plus fort au moins fort. */
export function creneauxForts(parHeure = [], combien = 3) {
  return [...(parHeure || [])].filter(x => n(x.nb) > 0)
    .sort((a, b) => n(b.nb) - n(a.nb)).slice(0, combien)
    .map(x => ({ h: n(x.h), nb: n(x.nb), ca: n(x.ca) }))
}

/** Part des commandes faites entre deux heures (ex. 18 h → 23 h), en %. */
export function partEntre(parHeure = [], de, a) {
  const total = (parHeure || []).reduce((s, x) => s + n(x.nb), 0)
  if (!total) return 0
  const dans = h => (de <= a ? h >= de && h < a : h >= de || h < a)
  const part = (parHeure || []).filter(x => dans(n(x.h))).reduce((s, x) => s + n(x.nb), 0)
  return Math.round((part / total) * 100)
}

export function ticketMoyen(totaux) {
  return n(totaux?.nb) ? Math.round(n(totaux.ca) / n(totaux.nb)) : 0
}

/** Grille jours × heures (7 lignes lundi → dimanche, colonnes dans l'ordre du service). */
export function grilleSemaine(semaine = []) {
  const grille = JOURS_COURTS.map(() => ORDRE_HEURES.map(() => 0))
  for (const x of semaine || []) {
    const j = n(x.j) - 1
    const col = ORDRE_HEURES.indexOf(n(x.h))
    if (j >= 0 && j < 7 && col >= 0) grille[j][col] += n(x.nb)
  }
  const max = Math.max(0, ...grille.flat())
  return { grille, max }
}

/** Commandes par jour de la semaine, et le jour le plus fort. */
export function joursForts(semaine = []) {
  const parJour = JOURS_COURTS.map((court, i) => ({ j: i + 1, court, long: JOURS_LONGS[i], nb: 0 }))
  for (const x of semaine || []) {
    const j = n(x.j) - 1
    if (j >= 0 && j < 7) parJour[j].nb += n(x.nb)
  }
  const meilleur = parJour.reduce((m, x) => (x.nb > (m?.nb || 0) ? x : m), null)
  return { parJour, meilleur }
}

// Canaux de vente, du plus courant au plus rare. Couleurs fixes : un canal
// garde la même couleur sur tous les graphiques.
export const CANAUX_POS = [
  { cle: 'sur_place', nom: 'Sur place', couleur: '#6C63E0' },
  { cle: 'emporter', nom: 'À emporter', couleur: '#0EA5E9' },
  { cle: 'glovo', nom: 'Glovo', couleur: '#F59E0B' },
  { cle: 'yango', nom: 'Yango', couleur: '#E11D48' },
  { cle: 'samer_delly', nom: 'Samer Delly', couleur: '#EF9F27' },
  { cle: 'qr', nom: 'Commande QR', couleur: '#10B981' },
  { cle: 'autre', nom: 'Autre livraison', couleur: '#94A3B8' },
]

export function cleCanal(x) {
  if (x.origine === 'CLIENT_QR') return 'qr'
  if (x.type === 'SUR_PLACE') return 'sur_place'
  if (x.type === 'EMPORTER') return 'emporter'
  const p = String(x.partenaire || '').toLowerCase()
  if (p === 'glovo' || p === 'yango' || p === 'samer_delly') return p
  return 'autre'
}

/** Ventes par canal (montant, nombre, part), canaux vides retirés. */
export function mixCanaux(parType = []) {
  const acc = new Map(CANAUX_POS.map(c => [c.cle, { ...c, nb: 0, ca: 0 }]))
  for (const x of parType || []) {
    const c = acc.get(cleCanal(x))
    c.nb += n(x.nb); c.ca += n(x.ca)
  }
  const total = [...acc.values()].reduce((s, c) => s + c.ca, 0)
  return [...acc.values()].filter(c => c.nb > 0)
    .map(c => ({ ...c, part: total ? Math.round((c.ca / total) * 100) : 0 }))
    .sort((a, b) => b.ca - a.ca)
}

/**
 * Canaux de chaque heure : { [h]: mixCanaux(...) }. parHeureType vient de
 * `par_heure_type` (absent tant que le SQL du POS n'est pas repassé → {}).
 */
export function canauxParHeure(parHeureType = []) {
  const parH = new Map()
  for (const x of parHeureType || []) {
    const h = n(x.h)
    if (!parH.has(h)) parH.set(h, [])
    parH.get(h).push(x)
  }
  return Object.fromEntries([...parH].map(([h, lignes]) => [h, mixCanaux(lignes)]))
}

/**
 * Canaux de chaque plat : { [nom]: [{ cle, nom, couleur, qte, ca, part }] },
 * du canal qui en vend le plus au plus petit (part en % des quantités).
 * topType vient de `top_type` (absent tant que le SQL du POS n'est pas repassé → {}).
 */
export function canauxParPlat(topType = []) {
  const parPlat = new Map()
  for (const x of topType || []) {
    if (!parPlat.has(x.nom)) parPlat.set(x.nom, new Map(CANAUX_POS.map(c => [c.cle, { ...c, qte: 0, ca: 0 }])))
    const c = parPlat.get(x.nom).get(cleCanal(x))
    c.qte += n(x.qte); c.ca += n(x.ca)
  }
  return Object.fromEntries([...parPlat].map(([plat, acc]) => {
    const total = [...acc.values()].reduce((s, c) => s + c.qte, 0)
    return [plat, [...acc.values()].filter(c => c.qte > 0)
      .map(c => ({ ...c, part: total ? Math.round((c.qte / total) * 100) : 0 }))
      .sort((a, b) => b.qte - a.qte)]
  }))
}

export const MODES_PAIEMENT = {
  ESPECES: { nom: 'Espèces', couleur: '#10B981' },
  WAVE: { nom: 'Wave', couleur: '#0EA5E9' },
  ORANGE_MONEY: { nom: 'Orange Money', couleur: '#F97316' },
  MTN_MOMO: { nom: 'MTN MoMo', couleur: '#EAB308' },
  MOOV: { nom: 'Moov', couleur: '#2563EB' },
  CARTE: { nom: 'Carte', couleur: '#64748B' },
  DJAMO: { nom: 'Djamo', couleur: '#6366F1' },
  // Pas de l'argent : le violet de la caisse, pour ne jamais le confondre.
  POINTS: { nom: 'Points fidélité', couleur: '#7C3AED' },
}

/**
 * Comment les clients paient. Les livraisons Yango et Glovo sont réglées par
 * le partenaire, pas au comptoir : elles n'ont pas de paiement au POS et sont
 * ajoutées à part (« Payé par Yango / Glovo »), sinon le total ne tomberait pas.
 */
export function mixPaiements(paiements = [], parType = []) {
  const lignes = (paiements || []).map(p => ({
    cle: p.mode, nom: MODES_PAIEMENT[p.mode]?.nom || p.mode, couleur: MODES_PAIEMENT[p.mode]?.couleur || '#94A3B8',
    nb: n(p.nb), montant: n(p.montant),
  }))
  const partenaires = (parType || []).filter(x => ['glovo', 'yango'].includes(cleCanal(x)))
  const montantPart = partenaires.reduce((s, x) => s + n(x.ca), 0)
  if (montantPart > 0) {
    lignes.push({ cle: 'PARTENAIRES', nom: 'Payé par Yango / Glovo', couleur: '#F59E0B',
      nb: partenaires.reduce((s, x) => s + n(x.nb), 0), montant: montantPart })
  }
  const total = lignes.reduce((s, l) => s + l.montant, 0)
  return lignes.filter(l => l.montant > 0)
    .map(l => ({ ...l, part: total ? Math.round((l.montant / total) * 100) : 0 }))
    .sort((a, b) => b.montant - a.montant)
}

/** Phrases courtes pour le propriétaire (« Le pic est à 20 h… »). */
export function faitsMarquants(stats) {
  if (!stats || !n(stats.totaux?.nb)) return []
  const faits = []
  const pic = heurePic(stats.par_heure)
  if (pic) faits.push({ icone: 'fire', texte: `Le pic est entre ${libelleCreneau(pic.h)} : ${pic.nb} commandes sur la période.` })
  const soir = partEntre(stats.par_heure, 18, 24)
  if (soir) faits.push({ icone: 'weather-night', texte: `${soir} % des commandes se font entre 18 h et minuit.` })
  const { meilleur } = joursForts(stats.semaine)
  if (meilleur?.nb) faits.push({ icone: 'calendar-star', texte: `Le ${meilleur.long} est le jour le plus chargé.` })
  const top = (stats.top || [])[0]
  if (top) faits.push({ icone: 'silverware-fork-knife', texte: `${top.nom} est le plat le plus vendu (${n(top.qte)} fois).` })
  const livr = mixCanaux(stats.par_type).filter(c => ['glovo', 'yango', 'samer_delly', 'autre'].includes(c.cle))
    .reduce((s, c) => s + c.part, 0)
  if (livr) faits.push({ icone: 'moped', texte: `La livraison pèse ${livr} % du chiffre d'affaires.` })
  return faits
}
