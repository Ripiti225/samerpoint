// ──────────────────────────────────────────────────────────────────────────────
//  AVIS CLIENTS DES PLATEFORMES (Yango & Glovo)
//
//  Les avis sont extraits chaque jour des portails Yango et Glovo puis envoyés
//  à l'Edge Function `ingest-reviews`, qui les range dans `platform_reviews` et
//  crée un litige (`litiges_avis_clients`) pour chaque nouvel avis négatif.
//  Ce module porte la lecture côté app : chargement paginé, KPI et regroupement
//  des boutiques encore non rattachées à un restaurant.
//
//  ⚠️ Le seuil de négativité et le montant du litige sont aussi appliqués côté
//  serveur (supabase/functions/ingest-reviews + rattacher_avis). Les deux
//  copies doivent rester alignées : la base fait foi, l'app ne fait qu'afficher.
// ──────────────────────────────────────────────────────────────────────────────

// Note (ramenée sur 5) en dessous de laquelle un avis est « négatif ».
export const SEUIL_NEGATIF = 3

// Montant du litige créé pour un avis négatif — identique à TYPES_AVIS.mauvais
// dans app/litiges.js.
export const MONTANT_AVIS_MAUVAIS = 1000

export const PLATEFORMES = [
  { key: 'yango', label: 'Yango', couleur: '#EF9F27', note: true },   // étoiles 1-5
  { key: 'glovo', label: 'Glovo', couleur: '#2E7D32', note: false },  // pouce 👍/👎
]

export function plateforme(key) {
  return PLATEFORMES.find(p => p.key === key) || null
}

export const CLASSIFICATIONS = [
  { key: 'bon', label: '👍 Bon', couleur: '#2E7D32' },
  { key: 'negatif', label: '👎 Négatif', couleur: '#C62828' },
]

/**
 * Classification d'un avis : celle fournie par l'extraction si elle est
 * valide, sinon déduite de la note. Glovo n'a pas de note — sans
 * classification explicite, l'avis est considéré comme bon.
 * Miroir exact de la règle appliquée par l'Edge Function.
 */
export function classifierAvis(avis = {}) {
  if (avis.classification === 'bon' || avis.classification === 'negatif') return avis.classification
  const scale = Number(avis.rating_scale) || 5
  const brute = avis.rating_raw
  if (brute == null || brute === '' || !Number.isFinite(Number(brute))) return 'bon'
  return (Number(brute) / scale) * 5 < SEUIL_NEGATIF ? 'negatif' : 'bon'
}

/** Le client a écrit un texte (un tag ou un thème seul ne compte pas). */
export const aUnCommentaire = (avis = {}) => typeof avis.comment === 'string' && avis.comment.trim() !== ''

/**
 * Un avis négatif ne crée un litige que s'il dit pourquoi : un commentaire,
 * ou au moins un tag Yango (raw.tag) / thème Glovo (raw.theme). Un pouce
 * rouge muet reste compté dans les KPI mais ne coûte rien au restaurant.
 * Miroir exact de la règle de l'Edge Function et de avis_a_un_motif() (SQL).
 */
export function aUnMotif(avis = {}) {
  const plein = (v) => typeof v === 'string' ? v.trim() !== '' : v != null && v !== ''
  if (plein(avis.comment)) return true
  const raw = avis.raw || {}
  return [raw.tag, raw.theme].some((v) => Array.isArray(v) ? v.some(plein) : plein(v))
}

/** Note ramenée sur 5, ou null quand la plateforme ne note pas (Glovo). */
export function noteSur5(avis = {}) {
  if (avis.rating_normalized != null) return Number(avis.rating_normalized)
  const brute = avis.rating_raw
  if (brute == null || brute === '' || !Number.isFinite(Number(brute))) return null
  const scale = Number(avis.rating_scale) || 5
  if (!scale) return null
  return Math.round((Number(brute) / scale) * 5 * 100) / 100
}

/**
 * KPI d'une liste d'avis : nombre, part de négatifs et note moyenne.
 * La moyenne ne porte que sur les avis réellement notés (Yango) — inclure les
 * pouces Glovo comme des 5/5 gonflerait artificiellement la note.
 */
export function kpisAvis(avis = []) {
  const notes = avis.map(noteSur5).filter(n => n != null)
  const nbNegatifs = avis.filter(a => classifierAvis(a) === 'negatif').length
  return {
    nb: avis.length,
    nbNegatifs,
    nbBons: avis.length - nbNegatifs,
    pctNegatifs: avis.length ? Math.round((nbNegatifs / avis.length) * 1000) / 10 : 0,
    nbNotes: notes.length,
    noteMoyenne: notes.length
      ? Math.round((notes.reduce((s, n) => s + n, 0) / notes.length) * 100) / 100
      : null,
  }
}

/** Les mêmes KPI, éclatés par plateforme (toujours les deux clés). */
export function kpisParPlateforme(avis = []) {
  const par = {}
  for (const p of PLATEFORMES) par[p.key] = kpisAvis(avis.filter(a => a.platform === p.key))
  return par
}

/** Les mêmes KPI, éclatés par restaurant, du plus mauvais au meilleur. */
export function kpisParRestaurant(avis = [], nomsParId = {}) {
  const par = new Map()
  for (const a of avis) {
    const id = a.restaurant_id || null
    if (!par.has(id)) par.set(id, [])
    par.get(id).push(a)
  }
  return [...par.entries()]
    .map(([id, lignes]) => ({
      restaurant_id: id,
      nom: id ? (nomsParId[id] || 'Restaurant inconnu') : 'À rattacher',
      ...kpisAvis(lignes),
    }))
    .sort((a, b) => b.pctNegatifs - a.pctNegatifs || b.nb - a.nb)
}

/**
 * Boutiques plateforme vues dans les avis mais pas encore rattachées à un
 * restaurant : c'est la file de travail de l'onglet « À rattacher ».
 */
export function boutiquesARattacher(avis = []) {
  const par = new Map()
  for (const a of avis) {
    if (a.restaurant_id) continue
    const label = a.external_store_label || '(sans nom)'
    const cle = `${a.platform}::${label}`
    const acc = par.get(cle) || { platform: a.platform, label, nb: 0, nbNegatifs: 0, dernier: null }
    acc.nb += 1
    if (classifierAvis(a) === 'negatif') acc.nbNegatifs += 1
    if (a.review_date && (!acc.dernier || a.review_date > acc.dernier)) acc.dernier = a.review_date
    par.set(cle, acc)
  }
  return [...par.values()].sort((a, b) => b.nb - a.nb)
}

// ── Rappel « pense à cliquer sur le bouton avis » ───────────────────────────
// Les avis n'arrivent que quand quelqu'un clique sur le favori Chrome depuis
// le portail Glovo ou Yango. Sans envoi depuis 2 jours sur une plateforme,
// l'écran Avis clients et la cloche de l'accueil le rappellent.
export const SEUIL_RAPPEL_JOURS = 2

const JOUR_MS = 24 * 60 * 60 * 1000

/**
 * Plateformes dont le dernier envoi (`ingested_at` le plus récent) date d'au
 * moins `seuilJours` jours, ou qui n'ont encore rien reçu (jours = null).
 */
export function plateformesEnRetard(derniers = {}, maintenant = Date.now(), seuilJours = SEUIL_RAPPEL_JOURS) {
  return PLATEFORMES
    .map(p => {
      const t = derniers?.[p.key] ? Date.parse(derniers[p.key]) : NaN
      const jours = Number.isFinite(t) ? Math.floor((maintenant - t) / JOUR_MS) : null
      return { platform: p.key, label: p.label, jours }
    })
    .filter(x => x.jours == null || x.jours >= seuilJours)
}

/** Libellé affiché dans le bandeau et dans la cloche. */
export function texteRetard({ label, jours }) {
  return jours == null
    ? `${label} : aucun avis reçu pour le moment`
    : `${label} : derniers avis reçus il y a ${jours} jours`
}
